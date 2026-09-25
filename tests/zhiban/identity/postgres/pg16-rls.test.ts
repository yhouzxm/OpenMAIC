import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  adminClient,
  configured,
  expectDenied,
  ids,
  insertBaseFixtures,
  prepareSchema,
  resetDisposableIdentity,
  runtimeClient,
  runtimePool,
  verifyPg16,
} from './pg16-harness';

const tenantEvents = [
  'MEMBERSHIP_DISABLED', 'MEMBERSHIP_LEFT', 'MEMBERSHIP_REACTIVATED',
  'MEMBERSHIP_ACTIVATED', 'MEMBERSHIP_REJOINED', 'ROLE_GRANTS_REPLACED',
  'ROLE_GRANT_GRANTED', 'ROLE_GRANT_REVOKED',
] as const;
const controlEvents = [
  'USER_CREATED', 'USER_DISABLED', 'USER_RESTORED',
  'TENANT_CREATED', 'TENANT_DISABLED', 'TENANT_RESTORED',
  'SYSTEM_ADMIN_GRANT_GRANTED', 'SYSTEM_ADMIN_GRANT_REVOKED',
] as const;
const authEvents = ['SESSION_REVOKED', 'AUTHENTICATION_REJECTED'] as const;
type AuditType = (typeof tenantEvents)[number] | (typeof controlEvents)[number] | (typeof authEvents)[number];

const grantFact = {
  id: ids.grantA,
  roleCode: 'STUDENT',
  scope: { type: 'SELF', scopeId: null },
  validFrom: 1000,
  validUntil: null,
};

function auditPayload(type: AuditType): object {
  if (type === 'MEMBERSHIP_REACTIVATED') {
    return { mode: 'PRESERVE_EXISTING_VALID_GRANTS', priorGrantIds: [ids.grantA], approvedGrants: [grantFact] };
  }
  if (['MEMBERSHIP_ACTIVATED', 'MEMBERSHIP_REJOINED', 'ROLE_GRANTS_REPLACED'].includes(type)) {
    return { priorGrantIds: [], approvedGrants: [grantFact] };
  }
  if (type === 'ROLE_GRANT_GRANTED' || type === 'ROLE_GRANT_REVOKED') return { grant: grantFact };
  if (type === 'SYSTEM_ADMIN_GRANT_GRANTED' || type === 'SYSTEM_ADMIN_GRANT_REVOKED') {
    return { grantId: ids.grantA };
  }
  if (type === 'SESSION_REVOKED') return { sessionId: 'test-session' };
  return {};
}

type AuditChange = {
  eventType?: string;
  eventScope?: string;
  tenantId?: string | null;
  actorType?: string;
  actorUserId?: string | null;
  reason?: string;
  subjectUserId?: string | null;
  subjectMembershipId?: string | null;
  payload?: object;
};

async function insertAudit(client: Client, type: AuditType, change: AuditChange = {}): Promise<void> {
  const tenantEvent = tenantEvents.some((item) => item === type);
  const tenantControl = type.startsWith('TENANT_');
  const userSubject = tenantEvent || type.startsWith('USER_') || type.startsWith('SYSTEM_ADMIN_') || type === 'SESSION_REVOKED';
  await client.query(
    `INSERT INTO zhiban_identity.audit_events
      (event_shape_version,event_type,event_scope,occurred_at,actor_type,actor_user_id,reason,
       tenant_id,subject_user_id,subject_membership_id,authorization_version_before,
       authorization_version_after,event_payload)
     VALUES (1,$1,$2,2000,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      change.eventType ?? type,
      change.eventScope ?? (tenantEvent ? 'TENANT' : 'GLOBAL'),
      change.actorType ?? 'SYSTEM',
      change.actorUserId ?? null,
      change.reason ?? 'ADMIN_REQUEST',
      change.tenantId === undefined ? (tenantEvent || tenantControl ? ids.tenantA : null) : change.tenantId,
      change.subjectUserId === undefined ? (userSubject ? ids.userA : null) : change.subjectUserId,
      change.subjectMembershipId === undefined ? (tenantEvent ? ids.membershipA : null) : change.subjectMembershipId,
      tenantEvent ? 0 : null,
      tenantEvent ? 1 : null,
      JSON.stringify(change.payload ?? auditPayload(type)),
    ],
  );
}

async function tenantTransaction<T>(client: Pick<Client, 'query'>, tenantId: string, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function tenantDenied(client: Client, tenantId: string, sql: string, params: unknown[] = []): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    await expect(client.query(sql, params)).rejects.toMatchObject({
      code: expect.stringMatching(/^(42501|23514|23503)$/),
    });
  } finally {
    await client.query('ROLLBACK');
  }
}

describe.skipIf(!configured).sequential('real PostgreSQL 16 Identity RLS and audit', () => {
  beforeAll(async () => {
    expect(await verifyPg16()).toMatch(/^16\./);
    await prepareSchema();
    await insertBaseFixtures();
  });
  afterAll(resetDisposableIdentity);

  it('fails closed for missing, empty, malformed, v4 and unknown tenant context', async () => {
    const runtime = runtimeClient('zhiban_runtime');
    await runtime.connect();
    try {
      expect((await runtime.query('SELECT zhiban_identity.current_tenant_id() AS tenant')).rows[0].tenant).toBeNull();
      for (const value of ['', 'garbage', '00000000-0000-7000-8000-bad', '00000000-0000-4000-8000-000000000001']) {
        await tenantTransaction(runtime, value, async () => {
          expect((await runtime.query('SELECT zhiban_identity.current_tenant_id() AS tenant')).rows[0].tenant).toBeNull();
          expect((await runtime.query('SELECT * FROM zhiban_identity.memberships')).rows).toHaveLength(0);
        });
      }
      await tenantTransaction(runtime, ids.tenantUnknown, async () => {
        expect((await runtime.query('SELECT zhiban_identity.current_tenant_id() AS tenant')).rows[0].tenant).toBe(ids.tenantUnknown);
        expect((await runtime.query('SELECT * FROM zhiban_identity.memberships')).rows).toHaveLength(0);
      });
    } finally {
      await runtime.end();
    }
  });

  it('isolates Membership and RoleGrant read/insert/update/delete by tenant', async () => {
    const runtime = runtimeClient('zhiban_runtime');
    await runtime.connect();
    try {
      await tenantTransaction(runtime, ids.tenantA, async () => {
        expect((await runtime.query('SELECT membership_id FROM zhiban_identity.memberships')).rows).toEqual([{ membership_id: ids.membershipA }]);
        expect((await runtime.query('SELECT grant_id FROM zhiban_identity.role_grants')).rows).toEqual([{ grant_id: ids.grantA }]);
      });
      await tenantTransaction(runtime, ids.tenantB, async () => {
        expect((await runtime.query('SELECT membership_id FROM zhiban_identity.memberships')).rows).toEqual([{ membership_id: ids.membershipB }]);
        expect((await runtime.query('SELECT grant_id FROM zhiban_identity.role_grants')).rows).toEqual([{ grant_id: ids.grantB }]);
      });
      await tenantDenied(runtime, ids.tenantA,
        "INSERT INTO zhiban_identity.memberships(membership_id,tenant_id,user_id,status,created_at,updated_at) VALUES($1,$2,$3,'PENDING',1000,1000)",
        [ids.weak, ids.tenantB, ids.userA]);
      await tenantDenied(runtime, ids.tenantA,
        "INSERT INTO zhiban_identity.role_grants(grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,created_at,valid_from) VALUES($1,$2,$3,1,'STUDENT','SELF',1000,1000)",
        [ids.weak, ids.tenantB, ids.membershipB]);
      await tenantDenied(runtime, ids.tenantA,
        'UPDATE zhiban_identity.memberships SET tenant_id=$1, repository_revision=2 WHERE membership_id=$2',
        [ids.tenantB, ids.membershipA]);
      await tenantDenied(runtime, ids.tenantA,
        'UPDATE zhiban_identity.role_grants SET tenant_id=$1 WHERE grant_id=$2',
        [ids.tenantB, ids.grantA]);
      await expectDenied(runtime, 'DELETE FROM zhiban_identity.memberships');
      await expectDenied(runtime, 'DELETE FROM zhiban_identity.role_grants');
    } finally {
      await runtime.end();
    }
  });

  it('enforces composite tenant FK, immutable history, one-way revoke and tenant-role catalog', async () => {
    const admin = adminClient();
    await admin.connect();
    try {
      await expect(admin.query(
        "INSERT INTO zhiban_identity.role_grants(grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,created_at,valid_from) VALUES($1,$2,$3,1,'STUDENT','SELF',1000,1000)",
        [ids.weak, ids.tenantB, ids.membershipA],
      )).rejects.toMatchObject({ code: '23503' });
      await expectDenied(admin, 'UPDATE zhiban_identity.memberships SET user_id=$1, repository_revision=2 WHERE membership_id=$2', [ids.userB, ids.membershipA]);
      await expectDenied(admin, "UPDATE zhiban_identity.role_grants SET role_code='TEACHER' WHERE grant_id=$1", [ids.grantA]);
      await expect(admin.query(
        "INSERT INTO zhiban_identity.role_grants(grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,created_at,valid_from) VALUES($1,$2,$3,1,'SYSTEM_ADMIN','SELF',1000,1000)",
        [ids.weak, ids.tenantA, ids.membershipA],
      )).rejects.toMatchObject({ code: '23514' });
      await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=2000 WHERE grant_id=$1', [ids.grantA]);
      await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=2000 WHERE grant_id=$1', [ids.grantA]);
      await expectDenied(admin, 'UPDATE zhiban_identity.role_grants SET revoked_at=NULL WHERE grant_id=$1', [ids.grantA]);
      await expectDenied(admin, 'UPDATE zhiban_identity.role_grants SET revoked_at=3000 WHERE grant_id=$1', [ids.grantA]);
      expect((await admin.query('SELECT revoked_at FROM zhiban_identity.role_grants WHERE grant_id=$1', [ids.grantA])).rows[0].revoked_at).toBe('2000');
    } finally {
      await admin.end();
    }
  });

  it('accepts all 18 closed event types through their designated restricted writer', async () => {
    for (const type of tenantEvents) {
      const client = runtimeClient('zhiban_runtime');
      await client.connect();
      try {
        await tenantTransaction(client, ids.tenantA, () => insertAudit(client, type));
      } finally {
        await client.end();
      }
    }
    for (const type of controlEvents) {
      const client = runtimeClient('zhiban_control_runtime');
      await client.connect();
      try {
        await insertAudit(client, type);
      } finally {
        await client.end();
      }
    }
    for (const type of authEvents) {
      const client = runtimeClient('zhiban_auth_runtime');
      await client.connect();
      try {
        await insertAudit(client, type);
      } finally {
        await client.end();
      }
    }
    const admin = adminClient();
    await admin.connect();
    try {
      const result = await admin.query('SELECT count(*)::int AS count, count(DISTINCT event_type)::int AS types, min(event_id) AS first_id FROM zhiban_identity.audit_events');
      expect(result.rows[0]).toMatchObject({ count: 18, types: 18 });
      expect(Number(result.rows[0].first_id)).toBeGreaterThan(0);
    } finally {
      await admin.end();
    }
  });

  it('rejects invalid audit scope, enums, excess secrets and nested extra fields', async () => {
    const runtime = runtimeClient('zhiban_runtime');
    await runtime.connect();
    try {
      const invalid: AuditChange[] = [
        { eventScope: 'GLOBAL' },
        { eventType: 'UNKNOWN_EVENT' },
        { reason: 'UNKNOWN_REASON' },
        { payload: { password: 'secret' } },
        { payload: { tokenDigest: 'digest' } },
        { payload: { unexpected: true } },
      ];
      for (const change of invalid) {
        await runtime.query('BEGIN');
        try {
          await runtime.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantA]);
          await expect(insertAudit(runtime, 'MEMBERSHIP_DISABLED', change)).rejects.toMatchObject({
            code: expect.stringMatching(/^(23514|42501)$/),
          });
        } finally {
          await runtime.query('ROLLBACK');
        }
      }
      for (const payload of [
        { grant: { ...grantFact, password: 'secret' } },
        { grant: { ...grantFact, scope: { ...grantFact.scope, tenantId: ids.tenantB } } },
      ]) {
        await runtime.query('BEGIN');
        try {
          await runtime.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantA]);
          await expect(insertAudit(runtime, 'ROLE_GRANT_GRANTED', { payload })).rejects.toMatchObject({ code: '23514' });
        } finally {
          await runtime.query('ROLLBACK');
        }
      }
    } finally {
      await runtime.end();
    }
    const admin = adminClient();
    await admin.connect();
    try {
      await expect(insertAudit(admin, 'MEMBERSHIP_DISABLED', { tenantId: ids.tenantUnknown })).rejects.toMatchObject({ code: '23503' });
    } finally {
      await admin.end();
    }
  });

  it('allows documented weak actor and subject references without creating cross-tenant row access', async () => {
    const runtime = runtimeClient('zhiban_runtime');
    await runtime.connect();
    try {
      await tenantTransaction(runtime, ids.tenantA, () => insertAudit(runtime, 'MEMBERSHIP_DISABLED', {
        actorType: 'USER', actorUserId: ids.weak, subjectUserId: ids.weak, subjectMembershipId: ids.weak,
      }));
    } finally {
      await runtime.end();
    }
  });

  it('separates tenant/global audit writers and denies tenant audit reads or mutation', async () => {
    const tenant = runtimeClient('zhiban_runtime');
    const auth = runtimeClient('zhiban_auth_runtime');
    const control = runtimeClient('zhiban_control_runtime');
    await Promise.all([tenant.connect(), auth.connect(), control.connect()]);
    try {
      await tenantDenied(tenant, ids.tenantA,
        "INSERT INTO zhiban_identity.audit_events(event_shape_version,event_type,event_scope,occurred_at,actor_type,reason,event_payload) VALUES(1,'AUTHENTICATION_REJECTED','GLOBAL',2000,'SYSTEM','CREDENTIAL_REJECTED','{}'::jsonb)");
      await expectDenied(auth, 'SELECT * FROM zhiban_identity.memberships');
      await expectDenied(control, 'SELECT * FROM zhiban_identity.role_grants');
      await expectDenied(tenant, 'SELECT * FROM zhiban_identity.audit_events');
      await expectDenied(tenant, 'UPDATE zhiban_identity.audit_events SET reason=reason');
      await expectDenied(tenant, 'DELETE FROM zhiban_identity.audit_events');
      await expectDenied(tenant, 'TRUNCATE zhiban_identity.audit_events');
      await expectDenied(auth, "INSERT INTO zhiban_identity.audit_events(event_shape_version,event_type,event_scope,occurred_at,actor_type,reason,tenant_id,subject_user_id,subject_membership_id,authorization_version_before,authorization_version_after,event_payload) VALUES(1,'MEMBERSHIP_DISABLED','TENANT',2000,'SYSTEM','ADMIN_REQUEST',$1,$2,$3,0,1,'{}'::jsonb)", [ids.tenantA, ids.userA, ids.membershipA]);
      await expectDenied(control, "INSERT INTO zhiban_identity.audit_events(event_shape_version,event_type,event_scope,occurred_at,actor_type,reason,tenant_id,subject_user_id,subject_membership_id,authorization_version_before,authorization_version_after,event_payload) VALUES(1,'MEMBERSHIP_DISABLED','TENANT',2000,'SYSTEM','ADMIN_REQUEST',$1,$2,$3,0,1,'{}'::jsonb)", [ids.tenantA, ids.userA, ids.membershipA]);
    } finally {
      await Promise.all([tenant.end(), auth.end(), control.end()]);
    }
  });

  it('clears transaction-local tenant context on commit, rollback, switch and failed transaction reuse', async () => {
    const pool = runtimePool('zhiban_runtime');
    try {
      const first = await pool.connect();
      try {
        await tenantTransaction(first, ids.tenantA, async () => {
          expect((await first.query('SELECT membership_id FROM zhiban_identity.memberships')).rows).toEqual([{ membership_id: ids.membershipA }]);
        });
      } finally {
        first.release();
      }
      const second = await pool.connect();
      try {
        expect((await second.query('SELECT zhiban_identity.current_tenant_id() AS tenant')).rows[0].tenant).toBeNull();
        expect((await second.query('SELECT membership_id FROM zhiban_identity.memberships')).rows).toHaveLength(0);
        await second.query('BEGIN');
        await second.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantA]);
        await second.query('ROLLBACK');
        expect((await second.query('SELECT membership_id FROM zhiban_identity.memberships')).rows).toHaveLength(0);
        await tenantTransaction(second, ids.tenantB, async () => {
          expect((await second.query('SELECT membership_id FROM zhiban_identity.memberships')).rows).toEqual([{ membership_id: ids.membershipB }]);
        });
        await second.query('BEGIN');
        await second.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantA]);
        await expect(second.query('SELECT 1/0')).rejects.toMatchObject({ code: '22012' });
        await second.query('ROLLBACK');
      } finally {
        second.release();
      }
      const third = await pool.connect();
      try {
        expect((await third.query('SELECT zhiban_identity.current_tenant_id() AS tenant')).rows[0].tenant).toBeNull();
        expect((await third.query('SELECT membership_id FROM zhiban_identity.memberships')).rows).toHaveLength(0);
      } finally {
        third.release();
      }
    } finally {
      await pool.end();
    }
  });
});
