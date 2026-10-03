import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { User, instant, userId } from '@/lib/zhiban/domain/identity';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { SessionCsrfPolicy } from '@/lib/zhiban/infrastructure/identity/sessions/browser-security';
import {
  bearerForCookie,
  digestBearer,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import {
  SharedAdmission,
  observedTransport,
  purposes,
  type AdmissionConfig,
  admissionPolicyDigest,
} from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  PlatformIdentityOperator,
  platformManifestDigest,
  type PlatformApproval,
} from '@/lib/zhiban/infrastructure/identity/composition/operator';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { catalogConfig } from '../authorization/fixtures';
import { syntheticPasswordScreening } from '../credentials/fixture-policy';
import {
  adminClient,
  configured,
  expectDenied,
  prepareSchema,
  resetDisposableIdentity,
  runtimeClient,
  runtimePool,
  verifyPg16,
} from './pg16-harness';

const original = 'Synthetic-composition-original-password!',
  replacement = 'Synthetic-composition-replacement-password!';
const transport = observedTransport('127.0.0.1'),
  ids = new IdentityIds();
const config: AdmissionConfig = {
  environment: 'synthetic',
  approvalRef: 'synthetic-only',
  hmacKey: new Uint8Array(32).fill(33),
  policyDigests: Object.fromEntries(
    purposes.map((p) => [
      p,
      admissionPolicyDigest({
        purpose: p,
        environment_ref: 'synthetic',
        approval_ref: 'synthetic-only',
        created_at: '0',
        window_ms: '3600000',
        global_limit: '100',
        ip_limit: p === 'INITIAL_PROVISION' ? null : '100',
        locator_limit: p === 'INITIAL_PROVISION' ? null : '100',
        pair_limit: p === 'INITIAL_PROVISION' ? null : '100',
        user_limit: p === 'LOGIN' ? null : '100',
        max_buckets: '1000',
      }),
    ]),
  ) as AdmissionConfig['policyDigests'],
};
const hasher = new Argon2PasswordHasher(syntheticPasswordScreening);
const pools = new Set<Pool>();
function pool(
  role: 'zhiban_auth_runtime' | 'zhiban_control_runtime' | 'zhiban_runtime' = 'zhiban_auth_runtime',
) {
  const p = runtimePool(role);
  p.options.statement_timeout = 5000;
  p.options.connectionTimeoutMillis = 5000;
  pools.add(p);
  return p;
}
async function rows(sql: string, parameters?: unknown[]) {
  const c = adminClient();
  await c.connect();
  try {
    return (await c.query(sql, parameters)).rows;
  } finally {
    await c.end();
  }
}
async function policies(limit = 100, maxBuckets = 1000) {
  const p = pool('zhiban_control_runtime');
  for (const purpose of purposes) {
    const provision = purpose === 'INITIAL_PROVISION',
      login = purpose === 'LOGIN';
    await p.query(
      `INSERT INTO zhiban_identity.admission_policies(purpose,policy_digest,approval_ref,environment_ref,created_at,window_ms,global_limit,ip_limit,locator_limit,pair_limit,user_limit,max_buckets)
      VALUES($1,$2,'synthetic-only','synthetic',0,3600000,$3,$4,$4,$4,$5,$6)`,
      [
        purpose,
        config.policyDigests[purpose],
        limit,
        provision ? null : limit,
        login ? null : limit,
        maxBuckets,
      ],
    );
    await p.query('INSERT INTO zhiban_identity.admission_gate(purpose) VALUES($1)', [purpose]);
  }
}
async function setup() {
  const auth = pool(),
    control = pool('zhiban_control_runtime'),
    id = ids.nextUserId();
  const users = new PostgresIdentityRepository(control),
    credentials = new PostgresCredentialRepository(auth),
    sessions = new PostgresSessionRepository(auth);
  await users.create(User.create(id, instant(Date.now())));
  await credentials.createPassword(
    id,
    ids.nextCredentialId(),
    await hasher.hash(original),
    instant(Date.now()),
    { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: 'fixture' },
  );
  const admission = new SharedAdmission(auth, config),
    security = await IdentityAuthentication.create(
      auth,
      sessions,
      credentials,
      hasher,
      admission,
      new SessionCsrfPolicy('https://synthetic.example'),
      ids,
    );
  const login = await security.login(id, original, transport, 'login');
  if (login.status !== 'ISSUED') throw new Error('Synthetic login rejected.');
  const raw = bearerForCookie(login.bearer),
    handle = await security.authenticate(raw);
  if (!handle) throw new Error('Synthetic session rejected.');
  return { auth, control, id, users, credentials, sessions, security, raw, handle };
}
function manifest(): PlatformApproval {
  const at = Date.now(),
    m = {
      purpose: 'FIRST_PLATFORM_ADMIN' as const,
      approvalId: ids.nextCommandId(),
      commandId: ids.nextCommandId(),
      userId: ids.nextUserId(),
      existingUserRevision: null,
      grantId: ids.nextSystemAdminGrantId(),
      provisionApprovalId: ids.nextCommandId(),
      environment: 'synthetic',
      approvalRef: ids.nextCommandId(),
      operatorRef: 'synthetic-operator',
      approverRef: 'synthetic-approver',
      requestId: ids.nextCommandId(),
      issuedAt: at - 1000,
      expiresAt: at + 600000,
    };
  return { ...m, manifestDigest: platformManifestDigest(m) };
}
function operator(m: PlatformApproval, control = pool('zhiban_control_runtime'), auth = pool()) {
  return new PlatformIdentityOperator(
    control,
    auth,
    { load: async (ref) => (ref === m.approvalRef ? m : null) },
    'synthetic',
    hasher,
    new SharedAdmission(auth, config),
    ids,
  );
}
/** Independent connection barrier acknowledges actual PostgreSQL blocking; no sleep-only race. */
async function blocked(pids: number[], blocker: number) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    // PostgreSQL tuple-lock queues can make the second waiter block on the first
    // waiter rather than directly on the barrier holder; acknowledge the whole chain.
    const state = await rows(
      `WITH RECURSIVE chain(origin,pid,path) AS (
      SELECT s.pid,s.pid,ARRAY[s.pid] FROM pg_stat_activity AS s WHERE s.pid=ANY($1::int[])
      UNION ALL SELECT c.origin,b.pid,c.path||b.pid FROM chain AS c
        CROSS JOIN LATERAL unnest(pg_blocking_pids(c.pid)) AS b(pid)
        WHERE NOT b.pid=ANY(c.path))
      SELECT origin AS pid,bool_or(pid=$2::int) AS blocked FROM chain GROUP BY origin`,
      [pids, blocker],
    );
    if (state.length === pids.length && state.every((r) => r.blocked)) return;
  }
  throw new Error('Expected acknowledged database lock not observed.');
}
describe
  .skipIf(!configured)
  .sequential('real PG16 identity authentication composition / B8-S01–S06', () => {
    beforeAll(async () => {
      expect(await verifyPg16()).toMatch(/^16\./);
    });
    beforeEach(async () => {
      await prepareSchema();
      await policies();
    });
    afterEach(async () => {
      await Promise.all([...pools].map((p) => p.end()));
      pools.clear();
    });
    afterAll(resetDisposableIdentity);

    it('B8-PG01 migration 0001–0008 exists, global tables have no RLS and owner is NOLOGIN', async () => {
      expect(
        (await rows('SELECT version FROM zhiban_identity.schema_migrations ORDER BY version')).map(
          (r) => r.version,
        ),
      ).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008']);
      const tables = await rows(
        "SELECT relname,relrowsecurity,relowner::regrole::text AS owner FROM pg_class WHERE relnamespace='zhiban_identity'::regnamespace AND relname=ANY($1::text[])",
        [
          [
            'admission_policies',
            'admission_gate',
            'admission_buckets',
            'identity_platform_bootstrap',
            'identity_credential_provisions',
          ],
        ],
      );
      expect(tables).toHaveLength(5);
      expect(tables.every((t) => t.owner === 'zhiban_identity_owner' && !t.relrowsecurity)).toBe(
        true,
      );
    });
    it('B8-PG02 auth anchor acquires user lock while direct auth FOR SHARE/UPDATE remains denied', async () => {
      const e = await setup(),
        c = runtimeClient('zhiban_auth_runtime');
      await c.connect();
      try {
        await c.query('BEGIN');
        expect(
          (await c.query('SELECT * FROM zhiban_identity.identity_auth_user_anchor($1)', [e.id]))
            .rows[0],
        ).toEqual({ user_id: e.id, user_status: 'ACTIVE', user_revision: '1' });
        await c.query('ROLLBACK');
        await expectDenied(c, 'SELECT * FROM zhiban_identity.users WHERE user_id=$1 FOR SHARE', [
          e.id,
        ]);
        await expectDenied(c, "UPDATE zhiban_identity.users SET status='ACTIVE' WHERE user_id=$1", [
          e.id,
        ]);
      } finally {
        await c.end();
      }
    });
    it('B8-PG03 tenant/control guard returns only five safe columns and no direct secret privilege', async () => {
      const e = await setup();
      for (const role of ['zhiban_runtime', 'zhiban_control_runtime'] as const) {
        const c = runtimeClient(role);
        await c.connect();
        try {
          const proof = (
            await c.query('SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
              digestBearer(e.raw),
              e.id,
            ])
          ).rows[0];
          expect(Object.keys(proof).sort()).toEqual(
            [
              'user_id',
              'user_revision',
              'security_epoch',
              'absolute_expires_at',
              'idle_expires_at',
            ].sort(),
          );
          await expectDenied(c, 'SELECT token_digest FROM zhiban_identity.sessions');
          await expectDenied(c, 'SELECT verifier_material FROM zhiban_identity.credentials');
        } finally {
          await c.end();
        }
      }
    });
    it('B8-PG04 guard rejects foreign subject, malformed digest and auth caller', async () => {
      const e = await setup(),
        c = runtimeClient('zhiban_runtime');
      await c.connect();
      try {
        await expectDenied(c, 'SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          digestBearer(e.raw),
          ids.nextUserId(),
        ]);
        await expectDenied(c, 'SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          'invalid',
          e.id,
        ]);
        await expectDenied(c, 'SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          null,
          e.id,
        ]);
      } finally {
        await c.end();
      }
      await expect(
        e.auth.query('SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          digestBearer(e.raw),
          e.id,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
    it('B8-PG05 PUBLIC has no table, column or function capability on new objects', async () => {
      const result = await rows(`SELECT count(*)::integer AS n FROM (
      SELECT acl.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
       WHERE c.relnamespace='zhiban_identity'::regnamespace
      UNION ALL SELECT acl.grantee FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
       CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE c.relnamespace='zhiban_identity'::regnamespace AND a.attacl IS NOT NULL
      UNION ALL SELECT acl.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
       WHERE p.pronamespace='zhiban_identity'::regnamespace) grants WHERE grantee=0`);
      expect(result[0].n).toBe(0);
    });
    it('B8-PG06 narrow table/column ACL prevents auth approval, control consumption, tenant budget reads', async () => {
      for (const role of [
        'zhiban_runtime',
        'zhiban_auth_runtime',
        'zhiban_control_runtime',
      ] as const) {
        const c = runtimeClient(role);
        await c.connect();
        try {
          await expectDenied(c, 'SELECT * FROM zhiban_identity.admission_buckets');
          await expectDenied(c, 'SELECT * FROM zhiban_identity.admission_gate');
          await expectDenied(c, 'UPDATE zhiban_identity.admission_gate SET bucket_count=0');
          await expectDenied(c, 'SELECT * FROM zhiban_identity.audit_events');
          if (role === 'zhiban_auth_runtime')
            await expectDenied(c, 'SELECT * FROM zhiban_identity.identity_platform_bootstrap');
          if (role === 'zhiban_control_runtime')
            await expectDenied(
              c,
              'UPDATE zhiban_identity.identity_credential_provisions SET consumed_at=1',
            );
        } finally {
          await c.end();
        }
      }
    });
    it('B8-PG07 trigger functions are not callable by any runtime', async () => {
      for (const role of [
        'zhiban_runtime',
        'zhiban_auth_runtime',
        'zhiban_control_runtime',
      ] as const) {
        const result = await rows(
          `SELECT has_function_privilege($1,p.oid,'EXECUTE') AS allowed FROM pg_proc p
        WHERE p.pronamespace='zhiban_identity'::regnamespace AND p.proname=ANY($2::text[])`,
          [
            role,
            [
              'identity_bootstrap_guard',
              'identity_provision_guard',
              'identity_bootstrap_consistency',
              'identity_provision_consistency',
              'identity_admission_policy_immutable',
            ],
          ],
        );
        expect(result).toHaveLength(5);
        expect(result.every((r) => r.allowed === false)).toBe(true);
      }
    });
    it('B8-PG08 login resolver equivalence, wrong/unknown/invalid all reject without identifier in audit', async () => {
      const e = await setup();
      expect(
        (await e.security.login(' ' + e.id.toUpperCase() + '\t', original, transport, 'normalized'))
          .status,
      ).toBe('ISSUED');
      for (const id of [e.id, ids.nextUserId(), 'not-a-user'])
        expect(await e.security.login(id, replacement, transport, 'rejected')).toEqual({
          status: 'REJECTED',
        });
      const events = await rows(
        "SELECT event_payload,subject_user_id FROM zhiban_identity.audit_events WHERE event_type='AUTHENTICATION_REJECTED'",
      );
      expect(events).toHaveLength(3);
      expect(
        events.every(
          (e) => e.subject_user_id === null && Object.keys(e.event_payload).length === 0,
        ),
      ).toBe(true);
    });
    it('B8-PG09 me/csrf handles serialize no material, forged handle rejected', async () => {
      const e = await setup();
      expect(Object.keys(await e.security.me(e.handle)).sort()).toEqual(
        ['userId', 'absoluteExpiresAt', 'idleExpiresAt'].sort(),
      );
      expect(JSON.stringify(e.handle)).toBe('{"kind":"AUTHENTICATED_REQUEST"}');
      await expect(e.security.me({ kind: 'AUTHENTICATED_REQUEST' })).rejects.toThrow();
      const proof = await e.security.csrfToken(e.handle);
      await e.security.assertUnsafe(e.handle, 'https://synthetic.example', proof);
      await expect(
        e.security.assertUnsafe(e.handle, 'https://foreign.example', proof),
      ).rejects.toThrow();
    });
    it('B8-PG10 logout is atomic/idempotent, audit contains neither bearer nor digest', async () => {
      const e = await setup();
      await e.security.logout(e.handle, 'logout');
      await e.security.logout(e.handle, 'logout');
      await expect(e.security.me(e.handle)).rejects.toThrow();
      const events = await rows(
        "SELECT event_payload FROM zhiban_identity.audit_events WHERE event_type='SESSION_REVOKED'",
      );
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain(e.raw);
      expect(JSON.stringify(events)).not.toContain(digestBearer(e.raw));
    });
    it('B8-PG11 logout-all step-up revokes own sessions only', async () => {
      const e = await setup(),
        other = await setup();
      await e.security.login(e.id, original, transport, 'extra');
      await e.security.logoutAll(e.handle, original, transport, 'logout-all');
      expect(
        (
          await rows('SELECT revoked_at FROM zhiban_identity.sessions WHERE user_id=$1', [e.id])
        ).every((s) => s.revoked_at !== null),
      ).toBe(true);
      expect((await other.security.me(other.handle)).userId).toBe(other.id);
    });
    it('B8-PG12 wrong step-up performs no revoke or credential mutation', async () => {
      const e = await setup();
      await expect(
        e.security.logoutAll(e.handle, replacement, transport, 'bad-step-up'),
      ).rejects.toThrow();
      await expect(
        e.security.changePassword(
          e.handle,
          replacement,
          replacement,
          transport,
          'bad-password',
          '1',
        ),
      ).rejects.toThrow();
      expect((await e.security.me(e.handle)).userId).toBe(e.id);
      expect((await e.credentials.findSlot(e.id))?.revision).toBe('1');
    });
    it('B8-PG13 password change is same-transaction epoch/revision +1 and invalidates old session', async () => {
      const e = await setup();
      await e.security.changePassword(
        e.handle,
        original,
        replacement,
        transport,
        'password-change',
        '1',
      );
      const slot = await e.credentials.findSlot(e.id);
      expect(slot?.revision).toBe('2');
      expect(slot?.value.securityEpoch).toBe('2');
      await expect(e.security.me(e.handle)).rejects.toThrow();
      expect(await e.security.login(e.id, original, transport, 'old')).toEqual({
        status: 'REJECTED',
      });
      expect((await e.security.login(e.id, replacement, transport, 'new')).status).toBe('ISSUED');
    });
    it('B8-PG14 stale password request rejects before state mutation', async () => {
      const e = await setup();
      await expect(
        e.security.changePassword(e.handle, original, replacement, transport, 'stale', '2'),
      ).rejects.toThrow();
      expect((await e.credentials.findSlot(e.id))?.revision).toBe('1');
    });
    it('B8-PG15 audit INSERT failure rolls back replacement and old password remains valid', async () => {
      const e = await setup(),
        c = adminClient();
      await c.connect();
      try {
        await c.query(
          'REVOKE INSERT(event_id) ON zhiban_identity.audit_events FROM zhiban_auth_runtime',
        );
        await expect(
          e.security.changePassword(
            e.handle,
            original,
            replacement,
            transport,
            'audit-failure',
            '1',
          ),
        ).rejects.toThrow();
        expect((await e.credentials.findSlot(e.id))?.revision).toBe('1');
      } finally {
        await c.query(
          'GRANT INSERT(event_id) ON zhiban_identity.audit_events TO zhiban_auth_runtime',
        );
        await c.end();
      }
      expect((await e.security.me(e.handle)).userId).toBe(e.id);
    });
    it('B8-PG16 disable/restore cannot revive request handle or session guard', async () => {
      const e = await setup(),
        current = await e.users.findById(e.id);
      if (!current) throw new Error('Synthetic user missing.');
      expect(current.value.status).toBe('ACTIVE');
      expect(current.revision).toBe('1');
      const disabledAt = instant(Date.now()),
        disabled = await e.users.save(
          current.value.disable(disabledAt, 'security fixture'),
          current.revision,
        );
      const disabledRevision = (BigInt(current.revision) + BigInt(1)).toString();
      expect(disabled).toMatchObject({
        revision: disabledRevision,
        value: { status: 'DISABLED', disabledAt, disabledReason: 'security fixture' },
      });
      expect(await e.users.findById(e.id)).toMatchObject({
        revision: disabledRevision,
        value: { status: 'DISABLED', disabledAt, disabledReason: 'security fixture' },
      });
      await expect(e.security.me(e.handle)).rejects.toThrow();
      await expect(
        e.control.query('SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          digestBearer(e.raw),
          e.id,
        ]),
      ).rejects.toThrow();
      const restored = await e.users.save(
        disabled.value.restore(instant(Date.now())),
        disabled.revision,
      );
      const restoredRevision = (BigInt(disabled.revision) + BigInt(1)).toString();
      expect(restored).toMatchObject({
        revision: restoredRevision,
        value: { status: 'ACTIVE', disabledAt: null, disabledReason: null },
      });
      expect(await e.users.findById(e.id)).toMatchObject({
        revision: restoredRevision,
        value: { status: 'ACTIVE', disabledAt: null, disabledReason: null },
      });
      await expect(e.security.me(e.handle)).rejects.toThrow();
      await expect(
        e.control.query('SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          digestBearer(e.raw),
          e.id,
        ]),
      ).rejects.toThrow();
      expect((await e.security.login(e.id, original, transport, 'restored')).status).toBe('ISSUED');
    });
    it('B8-PG17 discovery ignores malicious tenant/discovery GUC, restores prior value, exact cursor', async () => {
      const e = await setup(),
        other = await setup(),
        ta = ids.nextTenantId(),
        tb = ids.nextTenantId(),
        ma = ids.nextMembershipId(),
        mb = ids.nextMembershipId();
      for (const [t, m, u, code] of [
        [ta, ma, e.id, 'own'],
        [tb, mb, other.id, 'foreign'],
      ]) {
        await rows(
          "INSERT INTO zhiban_identity.tenants(tenant_id,code,display_name,status,created_at,updated_at) VALUES($1,$2,$2,'ACTIVE',0,0)",
          [t, code],
        );
        await rows(
          "INSERT INTO zhiban_identity.memberships(membership_id,tenant_id,user_id,status,created_at,updated_at) VALUES($1,$2,$3,'ACTIVE',0,0)",
          [m, t, u],
        );
      }
      const c = runtimeClient('zhiban_auth_runtime');
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query(
          "SELECT set_config('app.identity_discovery_user',$1,true),set_config('app.tenant_id',$2,true)",
          [other.id, tb],
        );
        const spaces = await c.query(
          'SELECT * FROM zhiban_identity.identity_session_spaces($1,NULL,25)',
          [digestBearer(e.raw)],
        );
        expect(spaces.rows.map((s) => s.membership_id)).toEqual([ma]);
        expect(
          (await c.query("SELECT current_setting('app.identity_discovery_user') AS value")).rows[0]
            .value,
        ).toBe(other.id);
        await c.query('ROLLBACK');
      } finally {
        await c.end();
      }
      expect((await e.security.spaces(e.handle, null, 25)).map((s) => s.tenantId)).toEqual([ta]);
      expect(await e.security.spaces(e.handle, ma, 25)).toEqual([]);
    });
    it('B8-PG18 expired/legacy sessions fail closed in SQL guard', async () => {
      const e = await setup(),
        c = runtimeClient('zhiban_runtime');
      await c.connect();
      try {
        await rows('ALTER TABLE zhiban_identity.sessions DISABLE TRIGGER USER');
        await rows(
          'UPDATE zhiban_identity.sessions SET security_epoch=NULL,user_revision=NULL WHERE user_id=$1',
          [e.id],
        );
        await rows('ALTER TABLE zhiban_identity.sessions ENABLE TRIGGER USER');
        await expectDenied(c, 'SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          digestBearer(e.raw),
          e.id,
        ]);
      } finally {
        await c.end();
      }
    });
    it('B8-PG19 all required dimensions consume together; denial leaves counters unchanged', async () => {
      // Policies are immutable: use INITIAL_PROVISION fixture with a distinct capacity below number of required keys.
      const a = new SharedAdmission(pool(), config);
      await a.reserve('LOGIN', transport, 'invalid');
      expect(
        (
          await rows(
            'SELECT dimension,used_count FROM zhiban_identity.admission_buckets WHERE purpose=$1',
            ['LOGIN'],
          )
        ).map((b) => b.used_count),
      ).toEqual(['1', '1', '1', '1']);
      const before = await rows(
        "SELECT bucket_count,repository_revision FROM zhiban_identity.admission_gate WHERE purpose='LOGIN'",
      );
      await expect(
        pool().query('SELECT zhiban_identity.identity_admission_reserve($1,$2,$3::text[])', [
          'LOGIN',
          config.policyDigests.LOGIN,
          [],
        ]),
      ).rejects.toThrow();
      expect(
        await rows(
          "SELECT bucket_count,repository_revision FROM zhiban_identity.admission_gate WHERE purpose='LOGIN'",
        ),
      ).toEqual(before);
    });
    it('B8-PG20 concurrent independent budgets cannot both exceed global limit', async () => {
      // Explicit fixture-only admin config repair, never a production policy update path.
      await rows('ALTER TABLE zhiban_identity.admission_policies DISABLE TRIGGER USER');
      await rows(
        "UPDATE zhiban_identity.admission_policies SET global_limit=1 WHERE purpose='LOGIN'",
      );
      await rows('ALTER TABLE zhiban_identity.admission_policies ENABLE TRIGGER USER');
      const p1 = pool(),
        p2 = pool(),
        a1 = new SharedAdmission(p1, config),
        a2 = new SharedAdmission(p2, config);
      const pids = [
        (await p1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        (await p2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
      ];
      // control has no gate lock privilege; use disposable admin for the barrier.
      const c = adminClient();
      await c.connect();
      let pending: Promise<PromiseSettledResult<boolean>[]> | undefined;
      try {
        await c.query('BEGIN');
        await c.query(
          "SELECT * FROM zhiban_identity.admission_gate WHERE purpose='LOGIN' FOR UPDATE",
        );
        const blocker = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending = Promise.allSettled([
          a1.reserve('LOGIN', transport, 'invalid-a'),
          a2.reserve('LOGIN', transport, 'invalid-b'),
        ]);
        await blocked(pids, blocker);
        await c.query('COMMIT');
        const results = await pending;
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null)).sort()).toEqual([
          false,
          true,
        ]);
        expect(
          (
            await rows(
              "SELECT used_count FROM zhiban_identity.admission_buckets WHERE purpose='LOGIN' AND dimension='GLOBAL'",
            )
          )[0].used_count,
        ).toBe('1');
      } finally {
        await c.query('ROLLBACK');
        await c.end();
        await pending;
      }
    });
    it('B8-PG21 capacity exhaustion fails without partial rows; bounded expired cleanup repairs count', async () => {
      await rows('ALTER TABLE zhiban_identity.admission_policies DISABLE TRIGGER USER');
      await rows(
        "UPDATE zhiban_identity.admission_policies SET max_buckets=4 WHERE purpose='LOGIN'",
      );
      await rows('ALTER TABLE zhiban_identity.admission_policies ENABLE TRIGGER USER');
      const a = new SharedAdmission(pool(), config);
      expect(await a.reserve('LOGIN', transport, 'first')).toBe(true);
      expect(await a.reserve('LOGIN', transport, 'other')).toBe(false);
      expect(
        (
          await rows(
            "SELECT count(*)::int AS n FROM zhiban_identity.admission_buckets WHERE purpose='LOGIN'",
          )
        )[0].n,
      ).toBe(4);
      await rows(
        "UPDATE zhiban_identity.admission_buckets SET expires_at=window_start+1 WHERE purpose='LOGIN'",
      );
      expect(await a.prune('LOGIN', 2)).toBe(2);
      expect(
        (
          await rows(
            "SELECT bucket_count FROM zhiban_identity.admission_gate WHERE purpose='LOGIN'",
          )
        )[0].bucket_count,
      ).toBe('2');
    });
    it('B8-PG22 maximum gate revision fails closed and prune no-op does not advance', async () => {
      const a = new SharedAdmission(pool(), config);
      expect(await a.prune('LOGIN', 10)).toBe(0);
      expect(
        (
          await rows(
            "SELECT repository_revision FROM zhiban_identity.admission_gate WHERE purpose='LOGIN'",
          )
        )[0].repository_revision,
      ).toBe('1');
      await rows(
        "UPDATE zhiban_identity.admission_gate SET repository_revision=9223372036854775807 WHERE purpose='LOGIN'",
      );
      expect(await a.reserve('LOGIN', transport, 'invalid')).toBe(false);
    });
    it('B8-PG23 bootstrap + initial provisioning commits separately, safe outcome confirmation emits no duplicate audit', async () => {
      const m = manifest(),
        op = operator(m);
      expect((await op.bootstrap(m.approvalRef)).userId).toBe(m.userId);
      expect((await op.bootstrap(m.approvalRef)).userId).toBe(m.userId);
      expect(
        (await rows('SELECT count(*)::int AS n FROM zhiban_identity.system_admin_grants'))[0].n,
      ).toBe(1);
      const first = await op.provision(m.approvalRef, original),
        second = await op.provision(m.approvalRef, original);
      expect(second).toEqual(first);
      expect(
        (
          await rows(
            "SELECT count(*)::int AS n FROM zhiban_identity.audit_events WHERE event_type='CREDENTIAL_CREATED'",
          )
        )[0].n,
      ).toBe(1);
    });
    it('B8-PG24 wrong environment/manifest and expired approval do not bootstrap', async () => {
      const m = manifest();
      for (const bad of [
        { ...m, environment: 'foreign' },
        { ...m, manifestDigest: '0'.repeat(64) },
      ])
        await expect(operator(bad).bootstrap(bad.approvalRef)).rejects.toThrow();
      const expired = { ...m, issuedAt: 0, expiresAt: 1 };
      expired.manifestDigest = platformManifestDigest(expired);
      await expect(operator(expired).bootstrap(expired.approvalRef)).rejects.toThrow();
      expect(
        (
          await rows('SELECT repository_revision FROM zhiban_identity.identity_platform_bootstrap')
        )[0].repository_revision,
      ).toBe('1');
    });
    it('B8-PG25 any historical SystemAdminGrant blocks re-bootstrap, even revoked', async () => {
      const id = ids.nextUserId();
      await rows(
        "INSERT INTO zhiban_identity.users(user_id,status,created_at,updated_at) VALUES($1,'ACTIVE',0,0)",
        [id],
      );
      await rows(
        'INSERT INTO zhiban_identity.system_admin_grants(grant_id,user_id,created_at,valid_from,revoked_at) VALUES($1,$2,0,0,1)',
        [ids.nextSystemAdminGrantId(), id],
      );
      const m = manifest();
      await expect(operator(m).bootstrap(m.approvalRef)).rejects.toThrow();
      expect(
        (
          await rows('SELECT repository_revision FROM zhiban_identity.identity_platform_bootstrap')
        )[0].repository_revision,
      ).toBe('1');
    });
    it('B8-PG26 two independently approved bootstrap commands mutate exactly once under acknowledged anchor contention', async () => {
      const m1 = manifest(),
        m2 = manifest(),
        p1 = pool('zhiban_control_runtime'),
        p2 = pool('zhiban_control_runtime');
      const op1 = operator(m1, p1),
        op2 = operator(m2, p2),
        pids = [
          (await p1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
          (await p2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        ];
      const c = adminClient();
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query(
          "SELECT * FROM zhiban_identity.identity_platform_bootstrap WHERE singleton_key='PLATFORM' FOR UPDATE",
        );
        const blocker = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const pending = Promise.allSettled([
          op1.bootstrap(m1.approvalRef),
          op2.bootstrap(m2.approvalRef),
        ]);
        await blocked(pids, blocker);
        await c.query('COMMIT');
        expect((await pending).filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(
          (await rows('SELECT count(*)::int AS n FROM zhiban_identity.system_admin_grants'))[0].n,
        ).toBe(1);
      } finally {
        await c.query('ROLLBACK');
        await c.end();
      }
    });
    it('B8-PG27 unbound provision approval cannot commit despite control INSERT privilege', async () => {
      const m = manifest(),
        p = pool('zhiban_control_runtime');
      await rows(
        "INSERT INTO zhiban_identity.users(user_id,status,created_at,updated_at) VALUES($1,'ACTIVE',0,0)",
        [m.userId],
      );
      await expect(
        p.query(
          `INSERT INTO zhiban_identity.identity_credential_provisions
      (approval_id,command_id,user_id,expected_user_revision,purpose,environment_ref,approval_ref,operator_ref,approver_ref,request_id,manifest_digest,issued_at,expires_at)
      VALUES($1,$2,$3,1,'FIRST_PASSWORD','synthetic','fixture','operator','approver','request',$4,0,1000)`,
          [m.provisionApprovalId, m.commandId, m.userId, m.manifestDigest],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        await rows('SELECT approval_id FROM zhiban_identity.identity_credential_provisions'),
      ).toEqual([]);
    });
    it('B8-PG28 old slot history blocks first-password approval consumption', async () => {
      const m = manifest(),
        op = operator(m);
      await op.bootstrap(m.approvalRef);
      const repo = new PostgresCredentialRepository(pool());
      await repo.createPassword(
        userId(m.userId),
        ids.nextCredentialId(),
        await hasher.hash(original),
        instant(Date.now()),
        { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: 'other' },
      );
      await expect(op.provision(m.approvalRef, replacement)).rejects.toThrow();
      expect(
        (await rows('SELECT consumed_at FROM zhiban_identity.identity_credential_provisions'))[0]
          .consumed_at,
      ).toBeNull();
    });
    it('B8-PG29 bootstrap audit failure fully rolls back User/grant/provision/anchor', async () => {
      const m = manifest(),
        op = operator(m);
      await rows(
        'REVOKE INSERT(event_id) ON zhiban_identity.audit_events FROM zhiban_control_runtime',
      );
      await expect(op.bootstrap(m.approvalRef)).rejects.toThrow();
      expect(await rows('SELECT user_id FROM zhiban_identity.users')).toEqual([]);
      expect(await rows('SELECT grant_id FROM zhiban_identity.system_admin_grants')).toEqual([]);
      expect(
        await rows('SELECT approval_id FROM zhiban_identity.identity_credential_provisions'),
      ).toEqual([]);
      expect(
        (
          await rows('SELECT repository_revision FROM zhiban_identity.identity_platform_bootstrap')
        )[0].repository_revision,
      ).toBe('1');
    });
    it('B8-PG30 provision audit failure fully rolls back slot/credential/consumption, not committed control phase', async () => {
      const m = manifest(),
        op = operator(m);
      await op.bootstrap(m.approvalRef);
      await rows(
        'REVOKE INSERT(event_id) ON zhiban_identity.audit_events FROM zhiban_auth_runtime',
      );
      await expect(op.provision(m.approvalRef, original)).rejects.toThrow();
      expect(await rows('SELECT user_id FROM zhiban_identity.credential_slots')).toEqual([]);
      expect(await rows('SELECT credential_id FROM zhiban_identity.credentials')).toEqual([]);
      expect(
        (await rows('SELECT consumed_at FROM zhiban_identity.identity_credential_provisions'))[0]
          .consumed_at,
      ).toBeNull();
      expect(
        (
          await rows('SELECT repository_revision FROM zhiban_identity.identity_platform_bootstrap')
        )[0].repository_revision,
      ).toBe('2');
    });
    it('B8-PG31 consumed ticket is terminal and cannot revive credential after later replacement', async () => {
      const m = manifest(),
        op = operator(m);
      await op.bootstrap(m.approvalRef);
      await op.provision(m.approvalRef, original);
      const repo = new PostgresCredentialRepository(pool()),
        slot = await repo.findSlot(userId(m.userId));
      if (!slot) throw new Error('Synthetic slot missing.');
      await repo.replacePassword(
        userId(m.userId),
        slot.revision,
        slot.value.activeCredentialId,
        ids.nextCredentialId(),
        await hasher.hash(replacement),
        instant(Date.now()),
        { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: 'replacement' },
      );
      await expect(op.provision(m.approvalRef, original)).rejects.toThrow();
      const c = runtimeClient('zhiban_auth_runtime');
      await c.connect();
      try {
        await expectDenied(
          c,
          'UPDATE zhiban_identity.identity_credential_provisions SET consumed_at=NULL,credential_id=NULL,credential_event_id=NULL',
        );
      } finally {
        await c.end();
      }
    });
    it('B8-PG32 production root verifies three actual roles/database/inventory/config, no operator fallback', async () => {
      const auth = pool(),
        tenant = pool('zhiban_runtime'),
        control = pool('zhiban_control_runtime'),
        values = ['synthetic-public-compromised-vector'];
      const cfg = {
        origin: 'https://synthetic.example',
        sessionPolicy: { absoluteMs: 28800000, idleMs: 1800000 },
        catalog: catalogConfig(),
        admission: config,
        corpus: {
          approvalRef: 'test-only',
          expectedDigest: createHash('sha256').update(JSON.stringify(values)).digest('hex'),
          values,
        },
        operator: null,
        transportApprovalRef: 'synthetic-direct-transport',
        deployment: 'SINGLE_PROCESS_HTTPS' as const,
      };
      const root = await createIdentityComposition({ auth, tenant, control }, cfg);
      expect(root.operator).toBeNull();
      expect(root.cookiePolicy.name).toBe('__Host-zhiban_session');
      await expect(
        createIdentityComposition({ auth: control, tenant, control: auth }, cfg),
      ).rejects.toThrow();
      await expect(
        createIdentityComposition(
          { auth, tenant, control },
          { ...cfg, corpus: { ...cfg.corpus, expectedDigest: '0'.repeat(64) } },
        ),
      ).rejects.toThrow();
    });
    it('B8-PG33 concurrent same approval provisioning consumes exactly once; safe confirmation returns same outcome', async () => {
      const m = manifest();
      await operator(m).bootstrap(m.approvalRef);
      const p1 = pool(),
        p2 = pool(),
        op1 = operator(m, undefined, p1),
        op2 = operator(m, undefined, p2),
        pids = [
          (await p1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
          (await p2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        ];
      const c = adminClient();
      await c.connect();
      const outcomes: Promise<PromiseSettledResult<unknown>[]>[] = [];
      try {
        await c.query('BEGIN');
        await c.query(
          'SELECT * FROM zhiban_identity.identity_credential_provisions WHERE approval_id=$1 FOR UPDATE',
          [m.provisionApprovalId],
        );
        const blocker = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const pending = Promise.allSettled([
          op1.provision(m.approvalRef, original),
          op2.provision(m.approvalRef, original),
        ]);
        outcomes.push(pending);
        await blocked(pids, blocker);
        await c.query('COMMIT');
        const result = await pending;
        expect(result.every((r) => r.status === 'fulfilled')).toBe(true);
        expect(result[0]).toEqual(result[1]);
        expect(
          (
            await rows(
              "SELECT count(*)::int AS n FROM zhiban_identity.audit_events WHERE event_type='CREDENTIAL_CREATED'",
            )
          )[0].n,
        ).toBe(1);
        expect(
          (await rows('SELECT count(*)::int AS n FROM zhiban_identity.credentials'))[0].n,
        ).toBe(1);
      } finally {
        await c.query('ROLLBACK');
        await c.end();
        await Promise.all(outcomes);
      }
    });
    it('B8-PG34 pre-existing grant writer bypassing anchor still serializes before fresh bootstrap history', async () => {
      const u = ids.nextUserId();
      await rows(
        "INSERT INTO zhiban_identity.users(user_id,status,created_at,updated_at) VALUES($1,'ACTIVE',0,0)",
        [u],
      );
      const writer = runtimeClient('zhiban_control_runtime');
      await writer.connect();
      const m = manifest(),
        control = pool('zhiban_control_runtime'),
        op = operator(m, control),
        pid = (await control.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      let outcome: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await writer.query('BEGIN');
        await writer.query(
          'INSERT INTO zhiban_identity.system_admin_grants(grant_id,user_id,created_at,valid_from) VALUES($1,$2,0,0)',
          [ids.nextSystemAdminGrantId(), u],
        );
        const blocker = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        outcome = Promise.allSettled([op.bootstrap(m.approvalRef)]);
        await blocked([pid], blocker);
        await writer.query('COMMIT');
        expect((await outcome)[0].status).toBe('rejected');
        expect(
          (
            await rows(
              'SELECT repository_revision FROM zhiban_identity.identity_platform_bootstrap',
            )
          )[0].repository_revision,
        ).toBe('1');
        expect(
          await rows('SELECT user_id FROM zhiban_identity.users WHERE user_id=$1', [m.userId]),
        ).toEqual([]);
      } finally {
        await writer.query('ROLLBACK');
        await writer.end();
        await outcome;
      }
    });
    it('B8-PG35 session guard rereads after User lock; disable/restore cannot revive stale proof', async () => {
      const e = await setup(),
        client = runtimeClient('zhiban_runtime'),
        writer = runtimeClient('zhiban_control_runtime');
      await client.connect();
      await writer.connect();
      let outcome: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await writer.query('BEGIN');
        await writer.query(
          'SELECT user_id FROM zhiban_identity.users WHERE user_id=$1 FOR UPDATE',
          [e.id],
        );
        const blocker = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
          pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        outcome = Promise.allSettled([
          client.query('SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
            digestBearer(e.raw),
            e.id,
          ]),
        ]);
        await blocked([pid], blocker);
        const at = String(Date.now());
        await writer.query(
          "UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=$2,disabled_reason='synthetic',updated_at=$2,repository_revision=repository_revision+1 WHERE user_id=$1",
          [e.id, at],
        );
        await writer.query(
          "UPDATE zhiban_identity.users SET status='ACTIVE',disabled_at=NULL,disabled_reason=NULL,updated_at=$2,repository_revision=repository_revision+1 WHERE user_id=$1",
          [e.id, at],
        );
        await writer.query('COMMIT');
        expect((await outcome)[0].status).toBe('rejected');
      } finally {
        await writer.query('ROLLBACK');
        await writer.end();
        await outcome;
        await client.end();
      }
    });
    it('B8-PG36 discovery capacity counts non-active candidates and rejects rather than silently truncating', async () => {
      const e = await setup(),
        tenantIds = Array.from({ length: 1001 }, () => ids.nextTenantId()),
        memberIds = tenantIds.map(() => ids.nextMembershipId()),
        codes = tenantIds.map((_, i) => 'capacity_' + i);
      await rows(
        "INSERT INTO zhiban_identity.tenants(tenant_id,code,display_name,status,created_at,updated_at) SELECT id,code,code,'ACTIVE',0,0 FROM unnest($1::uuid[],$2::text[]) AS t(id,code)",
        [tenantIds, codes],
      );
      await rows(
        "INSERT INTO zhiban_identity.memberships(membership_id,tenant_id,user_id,status,created_at,updated_at) SELECT id,tenant,$3::uuid,'PENDING',0,0 FROM unnest($1::uuid[],$2::uuid[]) AS m(id,tenant)",
        [memberIds, tenantIds, e.id],
      );
      await expect(e.security.spaces(e.handle, null, 1)).rejects.toThrow();
      expect(
        (
          await rows(
            'SELECT count(*)::int AS n FROM zhiban_identity.memberships WHERE user_id=$1',
            [e.id],
          )
        )[0].n,
      ).toBe(1001);
    });
    it('B8-PG37 closed but wrong audit provenance cannot consume approval', async () => {
      const m = manifest(),
        op = operator(m);
      await op.bootstrap(m.approvalRef);
      const auth = pool(),
        repo = new PostgresCredentialRepository(auth),
        cid = ids.nextCredentialId();
      await repo.createPassword(
        userId(m.userId),
        cid,
        await hasher.hash(original),
        instant(Date.now()),
        {
          actor: { kind: 'SYSTEM' },
          reason: 'SECURITY_POLICY',
          requestId: 'not-approved-provision',
        },
      );
      const event = (
        await rows(
          "SELECT event_id,occurred_at FROM zhiban_identity.audit_events WHERE event_type='CREDENTIAL_CREATED'",
        )
      )[0];
      await expect(
        auth.query(
          'UPDATE zhiban_identity.identity_credential_provisions SET consumed_at=$1,credential_id=$2,credential_event_id=$3 WHERE approval_id=$4',
          [event.occurred_at, cid, event.event_id, m.provisionApprovalId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        (await rows('SELECT consumed_at FROM zhiban_identity.identity_credential_provisions'))[0]
          .consumed_at,
      ).toBeNull();
    });
    it('B8-PG38 runtime TEMP capability is denied and guard rejects real absolute/idle expiry', async () => {
      const e = await setup(),
        client = runtimeClient('zhiban_runtime');
      await client.connect();
      try {
        await expectDenied(client, 'CREATE TEMP TABLE users(user_id uuid,status text)');
        expect(
          (
            await client.query('SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
              digestBearer(e.raw),
              e.id,
            ])
          ).rows[0].user_id,
        ).toBe(e.id);
        // Disposable corruption fixture only: retain CHECK-valid rows but move deadlines
        // to the issuance instant (before the real provider work already completed).
        await rows('ALTER TABLE zhiban_identity.sessions DISABLE TRIGGER USER');
        await rows(
          'UPDATE zhiban_identity.sessions SET last_seen_at=created_at,idle_expires_at=created_at+1 WHERE user_id=$1',
          [e.id],
        );
        await rows('ALTER TABLE zhiban_identity.sessions ENABLE TRIGGER USER');
        await expectDenied(client, 'SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          digestBearer(e.raw),
          e.id,
        ]);
        await rows('ALTER TABLE zhiban_identity.sessions DISABLE TRIGGER USER');
        await rows(
          'UPDATE zhiban_identity.sessions SET absolute_expires_at=created_at+1 WHERE user_id=$1',
          [e.id],
        );
        await rows('ALTER TABLE zhiban_identity.sessions ENABLE TRIGGER USER');
        await expectDenied(client, 'SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          digestBearer(e.raw),
          e.id,
        ]);
      } finally {
        await client.end();
      }
    });
  });
