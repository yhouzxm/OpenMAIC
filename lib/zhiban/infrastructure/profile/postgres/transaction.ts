import { createHash } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { academicAdmin, requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import type { ProfileCommand } from '../../../domain/profile/model';
import type { ProfileTransaction, MemberQuery } from '../../../application/profile/service';
type Row = QueryResultRow;
export class ProfilePgTransaction implements ProfileTransaction {
  constructor(
    private readonly business: PoolClient,
    private readonly identity: PoolClient,
  ) {}
  async rows(sql: string, args: unknown[] = []): Promise<Row[]> {
    return (await this.business.query(sql, args)).rows;
  }
  async own(a: AcademicActor) {
    const [record] = await this.rows(
      `SELECT (SELECT jsonb_build_object('png',av.png,'revision',av.revision::text) FROM zhiban_profile.avatars av WHERE av.tenant_id=x.tenant_id AND av.membership_id=x.membership_id) AS avatar,coalesce(v.display_name,p.display_name,'') AS "displayName",coalesce(v.email,'') AS email,coalesce(v.qq,'') AS qq,coalesce(v.wechat,'') AS wechat,coalesce(v.bio,'') AS bio,v.revision::text,
      coalesce(d.formal_name,'') AS "formalName",coalesce(d.student_no,'') AS "studentNo",coalesce(d.employee_no,'') AS "employeeNo"
      FROM (SELECT $1::uuid AS tenant_id,$2::uuid AS membership_id) x
      LEFT JOIN zhiban_academic.people p USING(tenant_id,membership_id)
      LEFT JOIN zhiban_profile.profiles v USING(tenant_id,membership_id)
      LEFT JOIN zhiban_profile.directory_records d USING(tenant_id,membership_id)`,
      [a.tenantId, a.membershipId],
    );
    return {
      ...record,
      userId: a.userId,
      membershipId: a.membershipId,
      status: 'ACTIVE',
      roles: a.grants.map((g) => ({
        roleCode: g.roleCode,
        scopeKind: g.scopeKind,
        scopeId: g.scopeId,
      })),
    };
  }
  async members(a: AcademicActor, q: MemberQuery) {
    requireAcademic(academicAdmin(a), 'FORBIDDEN');
    const exact = /^[0-9a-f-]{36}$/i.test(q.q) ? q.q.toLowerCase() : null;
    // Bounded identity window; only permitted business columns are joined across the two clients.
    const candidates = (
      await this.identity.query(
        `SELECT m.membership_id AS "membershipId",m.user_id AS "userId",m.status,
      coalesce((SELECT jsonb_agg(x.role_code ORDER BY x.role_code) FROM (SELECT DISTINCT g.role_code FROM zhiban_identity.role_grants g WHERE g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id AND g.revoked_at IS NULL AND g.valid_from<=$3 AND (g.valid_until IS NULL OR g.valid_until>$3)) x),'[]'::jsonb) AS roles
      FROM zhiban_identity.memberships m WHERE m.tenant_id=$1 AND ($2::uuid IS NULL OR m.membership_id>$2)
      AND ($4='ALL' OR m.status=$4) AND ($5::uuid IS NULL OR m.membership_id=$5)
      AND ($7::uuid IS NULL OR m.user_id=$7)
      AND ($6='ALL' OR ($6='MEMBER' AND NOT EXISTS(SELECT 1 FROM zhiban_identity.role_grants g WHERE g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id AND g.revoked_at IS NULL AND g.valid_from<=$3 AND (g.valid_until IS NULL OR g.valid_until>$3))) OR EXISTS(SELECT 1 FROM zhiban_identity.role_grants g WHERE g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id AND g.role_code=$6 AND g.revoked_at IS NULL AND g.valid_from<=$3 AND (g.valid_until IS NULL OR g.valid_until>$3)))
      ORDER BY m.membership_id LIMIT 201`,
        [a.tenantId, q.after, a.now, q.state, exact, q.role, q.loginUserId ?? null],
      )
    ).rows;
    const window = candidates.slice(0, 200);
    if (!window.length) return { rows: [], next: null };
    const names = await this.rows(
      `SELECT (SELECT jsonb_build_object('png',av.png,'revision',av.revision::text) FROM zhiban_profile.avatars av WHERE av.tenant_id=$1 AND av.membership_id=x.id) AS avatar,x.id AS "membershipId",coalesce(p.display_name,'') AS "displayName",coalesce(d.formal_name,'') AS "formalName",coalesce(d.student_no,'') AS "studentNo",coalesce(d.employee_no,'') AS "employeeNo",d.revision::text
      FROM unnest($2::uuid[]) x(id) LEFT JOIN zhiban_academic.people p ON p.tenant_id=$1 AND p.membership_id=x.id LEFT JOIN zhiban_profile.directory_records d ON d.tenant_id=$1 AND d.membership_id=x.id`,
      [a.tenantId, window.map((m) => m.membershipId)],
    );
    const map = new Map(names.map((n) => [n.membershipId, n]));
    const lower = q.q.toLowerCase();
    const matched = window
      .map((m) => ({ ...m, ...map.get(m.membershipId) }))
      .filter(
        (m) =>
          !lower ||
          q.loginUserId ||
          exact ||
          [m.displayName, m.formalName, m.studentNo, m.employeeNo].some((v: string) =>
            v.toLowerCase().includes(lower),
          ),
      );
    const rows = matched.slice(0, q.limit);
    return {
      rows,
      next:
        matched.length > q.limit
          ? rows.at(-1)!.membershipId
          : candidates.length > 200
            ? window.at(-1)!.membershipId
            : null,
    };
  }
  async avatar(a: AcademicActor, c: Extract<ProfileCommand, { type: 'SAVE_AVATAR' }>, key: string) {
    const digest = createHash('sha256').update(JSON.stringify(c)).digest('hex');
    await this.business.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `avatar-command:${a.tenantId}:${key}`,
    ]);
    const [prior] = await this.rows(
      'SELECT actor_id,payload_digest,result FROM zhiban_profile.avatar_commands WHERE tenant_id=$1 AND command_key=$2',
      [a.tenantId, key],
    );
    if (prior) {
      requireAcademic(
        prior.actor_id === a.membershipId && prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result as Row;
    }
    await this.business.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `avatar:${a.tenantId}:${a.membershipId}`,
    ]);
    const [before] = await this.rows(
      'SELECT revision::text FROM zhiban_profile.avatars WHERE tenant_id=$1 AND membership_id=$2 FOR UPDATE',
      [a.tenantId, a.membershipId],
    );
    requireAcademic((before?.revision ?? null) === c.revision, 'CONFLICT');
    const [result] = await this.rows(
      `INSERT INTO zhiban_profile.avatars(tenant_id,membership_id,png,updated_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(tenant_id,membership_id) DO UPDATE SET png=excluded.png,revision=zhiban_profile.avatars.revision+1,updated_at=excluded.updated_at RETURNING revision::text`,
      [a.tenantId, a.membershipId, c.png, a.now],
    );
    await this.business.query(
      'INSERT INTO zhiban_profile.avatar_commands VALUES($1,$2,$3,$4,$5,$6)',
      [a.tenantId, key, a.membershipId, digest, JSON.stringify(result), a.now],
    );
    return result;
  }
  async execute(a: AcademicActor, c: ProfileCommand, key: string) {
    if (c.type === 'SAVE_AVATAR') return this.avatar(a, c, key);
    const own = c.type === 'SAVE_PROFILE';
    requireAcademic(own || academicAdmin(a), 'FORBIDDEN');
    const target = own ? a.membershipId : c.membershipId;
    const binding = (
      await this.identity.query(
        'SELECT membership_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2',
        [a.tenantId, target],
      )
    ).rows;
    requireAcademic(binding.length === 1, 'NOT_FOUND');
    const digest = createHash('sha256').update(JSON.stringify(c)).digest('hex');
    await this.business.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `profile-command:${a.tenantId}:${key}`,
    ]);
    const [prior] = await this.rows(
      'SELECT actor_id,target_id,payload_digest,result FROM zhiban_profile.commands WHERE tenant_id=$1 AND command_key=$2',
      [a.tenantId, key],
    );
    if (prior) {
      requireAcademic(
        prior.actor_id === a.membershipId &&
          prior.target_id === target &&
          prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result as Row;
    }
    await this.business.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `profile-target:${a.tenantId}:${target}:${own ? 'own' : 'directory'}`,
    ]);
    const table = own ? 'profiles' : 'directory_records';
    const [before] = await this.rows(
      `SELECT revision::text FROM zhiban_profile.${table} WHERE tenant_id=$1 AND membership_id=$2 FOR UPDATE`,
      [a.tenantId, target],
    );
    requireAcademic((before?.revision ?? null) === c.revision, 'CONFLICT');
    const now = String(
      (
        await this.rows('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now')
      )[0].now,
    );
    let result: Row;
    if (c.type === 'SAVE_PROFILE') {
      [result] = await this.rows(
        `INSERT INTO zhiban_profile.profiles(tenant_id,membership_id,display_name,email,qq,wechat,bio,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(tenant_id,membership_id) DO UPDATE SET display_name=excluded.display_name,email=excluded.email,qq=excluded.qq,wechat=excluded.wechat,bio=excluded.bio,revision=zhiban_profile.profiles.revision+1,updated_at=excluded.updated_at RETURNING revision::text`,
        [a.tenantId, target, c.displayName, c.email, c.qq, c.wechat, c.bio, now],
      );
      await this.business.query(
        'INSERT INTO zhiban_academic.people(tenant_id,membership_id,display_name) VALUES($1,$2,$3) ON CONFLICT(tenant_id,membership_id) DO UPDATE SET display_name=excluded.display_name',
        [a.tenantId, target, c.displayName],
      );
    } else {
      [result] = await this.rows(
        `INSERT INTO zhiban_profile.directory_records(tenant_id,membership_id,formal_name,student_no,employee_no,updated_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(tenant_id,membership_id) DO UPDATE SET formal_name=excluded.formal_name,student_no=excluded.student_no,employee_no=excluded.employee_no,revision=zhiban_profile.directory_records.revision+1,updated_at=excluded.updated_at RETURNING revision::text`,
        [a.tenantId, target, c.formalName, c.studentNo, c.employeeNo, now],
      );
    }
    const outcome = { membershipId: target, revision: result.revision };
    await this.business.query(
      'INSERT INTO zhiban_profile.commands(tenant_id,command_key,actor_id,target_id,payload_digest,action,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [a.tenantId, key, a.membershipId, target, digest, c.type, JSON.stringify(outcome), now],
    );
    return outcome;
  }
}
