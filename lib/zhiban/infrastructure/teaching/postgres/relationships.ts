import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { RoleGrant, TenantId, MembershipId } from '@/lib/zhiban/domain/identity';
import type { TeacherRelationships } from '../../identity/composition/teacher-relationships';
import type { Client } from '../../identity/composition/support';
export class PostgresTeacherRelationships implements TeacherRelationships {
  private constructor() {}
  static async create(pool: Pool, expected: string) {
    if (!/^[0-9a-f]{64}$/.test(expected)) throw Error('Teacher relationship reference required');
    const client = await pool.connect();
    try {
      // Attest public catalogs only; the runtime cannot read Academic rows directly.
      const shape = (
        await client.query(`SELECT p.prosecdef,p.provolatile,p.proparallel,p.proconfig,
        pg_get_userbyid(p.proowner) AS owner,session_user,current_user,
        (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee NOT IN(p.proowner,(SELECT oid FROM pg_roles WHERE rolname='zhiban_runtime'))) AS extra_acl
        FROM pg_proc p WHERE p.oid=to_regprocedure('zhiban_teaching.identity_teacher_relationship(uuid,uuid,text,uuid)')`)
      ).rows[0];
      if (
        !shape ||
        !shape.prosecdef ||
        shape.owner !== 'zhiban_identity_owner' ||
        shape.session_user !== 'zhiban_runtime' ||
        shape.current_user !== 'zhiban_runtime' ||
        Number(shape.extra_acl) !== 0 ||
        shape.provolatile !== 'v' ||
        shape.proparallel !== 'u' ||
        JSON.stringify(shape.proconfig) !==
          JSON.stringify(['search_path=pg_catalog', 'row_security=on'])
      )
        throw Error('Teacher relationship helper rejected');
      // Expected digest binds the helper body and its policies; public catalogs expose no business rows.
      const actual = await teacherRelationshipPublicProfile(client);
      if (actual !== expected) throw Error('Teacher relationship helper/profile mismatch');
      return new PostgresTeacherRelationships();
    } finally {
      client.release();
    }
  }
  async verify(client: Client, tenant: TenantId, member: MembershipId, grant: RoleGrant) {
    if (grant.roleCode !== 'TEACHER' || !['CLASS', 'COURSE'].includes(grant.scope.type))
      return false;
    const r = await client.query(
      'SELECT * FROM zhiban_teaching.identity_teacher_relationship($1,$2,$3,$4)',
      [tenant, member, grant.scope.type, grant.scope.scopeId],
    );
    if (r.command !== 'SELECT' || r.rowCount !== 1 || r.rows.length !== 1) return false;
    const x = r.rows[0];
    return (
      x.tenant_id === tenant &&
      x.membership_id === member &&
      x.scope_kind === grant.scope.type &&
      x.scope_id === grant.scope.scopeId &&
      ['course_id', 'offering_id', 'assignment_id'].every(
        (k) => typeof x[k] === 'string' && /^[0-9a-f-]{36}$/.test(x[k]),
      ) &&
      ['course_revision', 'offering_revision', 'assignment_revision'].every((k) =>
        /^[1-9][0-9]*$/.test(String(x[k])),
      )
    );
  }
}
export async function teacherRelationshipPublicProfile(client: Pick<PoolClient, 'query'>) {
  const previous = (await client.query("SELECT current_setting('search_path') AS path")).rows[0]
    .path;
  await client.query("SELECT set_config('search_path','pg_catalog',false)");
  try {
    const helper = (
      await client.query(`SELECT pg_get_functiondef(p.oid) AS definition,pg_get_userbyid(p.proowner) AS owner,
    (SELECT jsonb_agg(jsonb_build_object('role',coalesce(r.rolname,'PUBLIC'),'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) AS acl
    FROM pg_proc p WHERE p.oid=to_regprocedure('zhiban_teaching.identity_teacher_relationship(uuid,uuid,text,uuid)')`)
    ).rows;
    const policies = (
      await client.query(
        `SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='zhiban_academic' AND policyname LIKE 'teacher_relationship_owner_%' ORDER BY tablename,policyname`,
      )
    ).rows;
    if (helper.length !== 1 || policies.length !== 6)
      throw Error('Teacher relationship profile rejected');
    return createHash('sha256').update(JSON.stringify({ helper, policies })).digest('hex');
  } finally {
    await client.query("SELECT set_config('search_path',$1,false)", [previous]);
  }
}
