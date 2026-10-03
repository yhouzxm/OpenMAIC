import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { catalogConfig } from '../authorization/fixtures';
import { canonicalLoginIdentifier } from '@/lib/zhiban/infrastructure/identity/composition/identifier';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  SharedAdmission,
  observedTransport,
  purposes,
  admissionPolicyDigest,
  type AdmissionPolicyRecord,
} from '@/lib/zhiban/infrastructure/identity/composition/admission';
import {
  platformManifestDigest,
  PlatformIdentityOperator,
} from '@/lib/zhiban/infrastructure/identity/composition/operator';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { run, audit } from '@/lib/zhiban/infrastructure/identity/composition/support';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
const id = '018f0000-0000-7000-8000-000000000001';
const config = () => ({
  environment: 'synthetic',
  approvalRef: 'fixture-only',
  hmacKey: new Uint8Array(32).fill(42),
  policyDigests: Object.fromEntries(
    purposes.map((p, i) => [p, String(i + 1).repeat(64)]),
  ) as Record<(typeof purposes)[number], string>,
});
function db(allowed: unknown = true) {
  const calls: { sql: string; params: unknown }[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, params?: unknown) => {
    calls.push({ sql, params });
    if (sql.includes('identity_admission_reserve'))
      return { command: 'SELECT', rowCount: 1, rows: [{ allowed }] };
    if (sql.includes('identity_admission_prune'))
      return { command: 'SELECT', rowCount: 1, rows: [{ deleted: 2 }] };
    if (sql.includes('nextval'))
      return { command: 'SELECT', rowCount: 1, rows: [{ id: '9007199254740993' }] };
    if (sql.startsWith('INSERT')) return { command: 'INSERT', rowCount: 1, rows: [] };
    return { command: sql.startsWith('BEGIN') ? 'BEGIN' : sql, rowCount: 0, rows: [] };
  });
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as TransactionPool, calls, query, release };
}
afterEach(() => vi.restoreAllMocks());
describe('1B-8B identifier / UUIDv7 security services', () => {
  it.each([id, id.toUpperCase(), ' \t' + id + '\r\n'])(
    'normalizes only ASCII perimeter and case',
    (input) => expect(canonicalLoginIdentifier(input)).toBe(id),
  );
  it.each([
    null,
    undefined,
    42,
    '',
    '{' + id + '}',
    'urn:uuid:' + id,
    id.replaceAll('-', ''),
    '\u00a0' + id,
    id + '\u00a0',
    id + '\nX',
    'x'.repeat(129),
    id.replace('-7000-', '-4000-'),
  ])('rejects unapproved locator forms', (input) =>
    expect(canonicalLoginIdentifier(input)).toBeNull(),
  );
  it('issues six Domain IDs plus security IDs with provider randomness and uniqueness', () => {
    const ids = new IdentityIds(),
      values = Array.from({ length: 1000 }, () => ids.nextUserId());
    expect(new Set(values).size).toBe(1000);
    for (const value of [
      ids.nextTenantId(),
      ids.nextMembershipId(),
      ids.nextRoleId(),
      ids.nextRoleGrantId(),
      ids.nextSystemAdminGrantId(),
      ids.nextCredentialId(),
      ids.nextCommandId(),
    ])
      expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/);
  });
  it('fails closed on backwards wall clock, does not supply provider custom timestamp', () => {
    const ids = new IdentityIds();
    ids.nextUserId();
    vi.spyOn(Date, 'now').mockReturnValue(0);
    expect(() => ids.nextUserId()).toThrow(IdentityPortError);
  });
  it.each([-1, NaN, Infinity, 281474976710656])(
    'rejects timestamp outside UUIDv7 range',
    (value) => {
      vi.spyOn(Date, 'now').mockReturnValue(value);
      expect(() => new IdentityIds().nextUserId()).toThrow(IdentityPortError);
    },
  );
});
describe('shared admission / atomic sanitized transaction boundary', () => {
  it('HMACs every login dimension; commits budget before any external KDF and hides key', async () => {
    const h = db(),
      admission = new SharedAdmission(h.pool, config());
    expect(await admission.reserve('LOGIN', observedTransport('127.0.0.1'), id)).toBe(true);
    const call = h.calls.find((c) => c.sql.includes('identity_admission_reserve'))!;
    const params = call.params as [string, string, string[]];
    expect(params[0]).toBe('LOGIN');
    expect(params[2]).toHaveLength(4);
    expect(new Set(params[2]).size).toBe(4);
    expect(params[2].every((v) => /^[0-9a-f]{64}$/.test(v))).toBe(true);
    expect(JSON.stringify(call)).not.toContain(id);
    expect(JSON.stringify(call)).not.toContain('127.0.0.1');
    expect(h.calls.at(-1)?.sql).toBe('COMMIT');
    expect(h.release).toHaveBeenCalledWith(false);
    expect(JSON.stringify(admission)).not.toContain('hmacKey');
  });
  it('canonicalizes IPv6 aliases into the same budget key', async () => {
    const h = db(),
      a = new SharedAdmission(h.pool, config());
    await a.reserve('LOGIN', observedTransport('::1'), id);
    await a.reserve('LOGIN', observedTransport('0:0:0:0:0:0:0:1'), id);
    const calls = h.calls.filter((c) => c.sql.includes('identity_admission_reserve'));
    expect(calls[0].params).toEqual(calls[1].params);
  });
  it.each(['REAUTHENTICATE', 'PASSWORD_CHANGE'] as const)('adds USER for %s', async (p) => {
    const h = db();
    await new SharedAdmission(h.pool, config()).reserve(p, observedTransport('127.0.0.1'), id, id);
    expect(
      (h.calls.find((c) => c.sql.includes('identity_admission_reserve'))!.params as unknown[][])[2],
    ).toHaveLength(5);
  });
  it('operator provisioning has GLOBAL/USER only and forbids web transport', async () => {
    const h = db(),
      a = new SharedAdmission(h.pool, config());
    await a.reserve('INITIAL_PROVISION', null, id, id);
    expect(
      (h.calls.find((c) => c.sql.includes('identity_admission_reserve'))!.params as unknown[][])[2],
    ).toHaveLength(2);
    await expect(
      a.reserve('INITIAL_PROVISION', observedTransport('127.0.0.1'), id, id),
    ).rejects.toThrow();
  });
  it('rejects forged transport before DB/KDF', async () => {
    const h = db(),
      a = new SharedAdmission(h.pool, config());
    await expect(a.reserve('LOGIN', { kind: 'SERVER_TRANSPORT' }, id)).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
  it('normal denial commits no assumed success', async () => {
    const h = db(false);
    expect(
      await new SharedAdmission(h.pool, config()).reserve(
        'LOGIN',
        observedTransport('127.0.0.1'),
        id,
      ),
    ).toBe(false);
  });
  it.each([null, undefined, 'true', 1, {}])(
    'non-boolean backend output fails closed',
    async (value) => {
      const h = db(value);
      // undefined explicitly must not become default success in this harness.
      h.query.mockImplementationOnce(async () => ({ command: 'BEGIN', rowCount: 0, rows: [] }));
      h.query.mockImplementationOnce(async () => ({
        command: 'SELECT',
        rowCount: 1,
        rows: [{ allowed: value }],
      }));
      await expect(
        new SharedAdmission(h.pool, config()).reserve('LOGIN', observedTransport('127.0.0.1'), id),
      ).rejects.toThrow();
      expect(h.calls.some((c) => c.sql === 'COMMIT')).toBe(false);
    },
  );
  it('prune has hard bounds and accepts only validated deletion count', async () => {
    const h = db(),
      a = new SharedAdmission(h.pool, config());
    expect(await a.prune('LOGIN', 2)).toBe(2);
    expect(() => a.prune('LOGIN', 501)).toThrow();
  });
  it('aborted COMMIT never returns callback result', async () => {
    const h = db();
    h.query.mockImplementation(async (sql) => ({
      command: sql === 'COMMIT' ? 'ROLLBACK' : sql,
      rowCount: 0,
      rows: [],
    }));
    await expect(run(h.pool, async () => true)).rejects.toThrow();
    expect(h.release).toHaveBeenCalledWith(true);
  });
  it('reconstructs errors without cause/code/SQL material', async () => {
    const h = db(),
      sentinel = 'synthetic-sensitive-sentinel';
    h.query.mockRejectedValue(
      Object.assign(new Error(sentinel), { code: sentinel, cause: sentinel, detail: sentinel }),
    );
    try {
      await run(h.pool, async () => true);
      throw new Error('Expected rejection');
    } catch (e) {
      expect(e).toBeInstanceOf(IdentityPortError);
      expect(JSON.stringify(e)).not.toContain(sentinel);
      expect(String(e)).not.toContain(sentinel);
    }
    expect(h.release).toHaveBeenCalledWith(true);
  });
  it('audit nextval stays int8 string and same client, no RETURNING/read grant', async () => {
    const h = db();
    const event = await run(h.pool, (c) =>
      audit(c, 'USER_CREATED', id, 1000, { service: 'identity_bootstrap' }, 'fixture-request', {}),
    );
    expect(event).toBe('9007199254740993');
    const insert = h.calls.find((c) => c.sql.startsWith('INSERT'))!;
    expect(insert.sql).toContain('OVERRIDING SYSTEM VALUE');
    expect(insert.sql).not.toContain('RETURNING');
    expect((insert.params as unknown[])[0]).toBe('9007199254740993');
    expect(h.calls[1].sql).toContain('nextval');
    expect(h.calls.at(-1)?.sql).toBe('COMMIT');
    expect(h.pool.connect).toHaveBeenCalledTimes(1);
  });
});
describe('default-closed production composition / operator evidence', () => {
  it('missing config fails before pool lookup, without fixture fallback', async () => {
    const h = db();
    await expect(
      createIdentityComposition(
        { auth: h.pool, tenant: h.pool, control: h.pool },
        undefined as never,
      ),
    ).rejects.toThrow(IdentityPortError);
    expect(h.calls).toHaveLength(0);
  });
  it('operator does not accept absent approval or caller approved boolean', async () => {
    const h = db(),
      operator = new PlatformIdentityOperator(
        h.pool,
        h.pool,
        { load: async () => null },
        'synthetic',
        {} as never,
        new SharedAdmission(h.pool, config()),
        new IdentityIds(),
      );
    await expect(operator.bootstrap('fixture')).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
  it('closed manifest digest binds every nonsecret field', () => {
    const m = {
      purpose: 'FIRST_PLATFORM_ADMIN' as const,
      approvalId: id,
      commandId: id,
      userId: id,
      existingUserRevision: null,
      grantId: id,
      provisionApprovalId: id,
      environment: 'synthetic',
      approvalRef: 'fixture',
      operatorRef: 'operator',
      approverRef: 'approver',
      requestId: 'request',
      issuedAt: 1000,
      expiresAt: 2000,
    };
    const digest = platformManifestDigest(m);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(platformManifestDigest({ ...m, expiresAt: 2001 })).not.toBe(digest);
    expect(platformManifestDigest({ ...m, userId: id.slice(0, -1) + '2' })).not.toBe(digest);
  });
  it('operator approval storage cannot leak raw cause or custom fields', async () => {
    const h = db(),
      sentinel = 'synthetic-approval-private';
    const operator = new PlatformIdentityOperator(
      h.pool,
      h.pool,
      {
        load: async () => {
          throw Object.assign(new Error(sentinel), { cause: sentinel, code: sentinel });
        },
      },
      'synthetic',
      {} as never,
      new SharedAdmission(h.pool, config()),
      new IdentityIds(),
    );
    try {
      await operator.bootstrap('fixture');
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityPortError);
      expect(String(error) + JSON.stringify(error)).not.toContain(sentinel);
    }
    expect(h.calls).toHaveLength(0);
  });
  it('policy digest binds actual limits/config, rejects noncanonical int8 and missing dimension', () => {
    const policy: AdmissionPolicyRecord = {
      purpose: 'LOGIN',
      environment_ref: 'synthetic',
      approval_ref: 'fixture-only',
      created_at: '0',
      window_ms: '1000',
      global_limit: '10',
      ip_limit: '10',
      locator_limit: '10',
      pair_limit: '10',
      user_limit: null,
      max_buckets: '100',
    };
    expect(admissionPolicyDigest(policy)).not.toBe(
      admissionPolicyDigest({ ...policy, global_limit: '11' }),
    );
    expect(() => admissionPolicyDigest({ ...policy, window_ms: '01000' })).toThrow();
    expect(() => admissionPolicyDigest({ ...policy, ip_limit: null })).toThrow();
  });
  it.each([
    'valid',
    'wrong_role',
    'cross_database',
    'role_membership',
    'missing_schema',
    'tampered_threshold',
  ] as const)(
    'composition startup %s has explicit approved configuration and no fallback',
    async (scenario) => {
      const policyRows = purposes.map((p) => ({
        purpose: p,
        environment_ref: 'synthetic',
        approval_ref: 'fixture-only',
        created_at: '0',
        window_ms: '1000',
        global_limit: '10',
        ip_limit: p === 'INITIAL_PROVISION' ? null : '10',
        locator_limit: p === 'INITIAL_PROVISION' ? null : '10',
        pair_limit: p === 'INITIAL_PROVISION' ? null : '10',
        user_limit: p === 'LOGIN' ? null : '10',
        max_buckets: '100',
      }));
      const admission = {
        ...config(),
        policyDigests: Object.fromEntries(
          policyRows.map((p) => [p.purpose, admissionPolicyDigest(p)]),
        ) as ReturnType<typeof config>['policyDigests'],
      };
      const values = ['synthetic-public-compromised-value'];
      const cfg = {
        origin: 'https://synthetic.example',
        sessionPolicy: { absoluteMs: 28800000, idleMs: 1800000 },
        catalog: catalogConfig(),
        admission,
        corpus: {
          values,
          approvalRef: 'test-only',
          expectedDigest: createHash('sha256').update(JSON.stringify(values)).digest('hex'),
        },
        operator: null,
        transportApprovalRef: 'synthetic-transport',
        deployment: 'SINGLE_PROCESS_HTTPS' as const,
      };
      const poolFor = (role: string) =>
        ({
          connect: async () => ({
            release: vi.fn(),
            query: async (sql: string) => {
              if (sql.includes('FROM pg_catalog.pg_roles'))
                return {
                  command: 'SELECT',
                  rowCount: 1,
                  rows: [
                    {
                      session_user: scenario === 'wrong_role' ? 'zhiban_identity_owner' : role,
                      current_user: role,
                      database: scenario === 'cross_database' ? role : 'same-database',
                      safe: true,
                      memberships: scenario === 'role_membership' ? 1 : 0,
                    },
                  ],
                };
              if (sql.includes('AS ready'))
                return {
                  command: 'SELECT',
                  rowCount: 1,
                  rows: [{ ready: scenario !== 'missing_schema' }],
                };
              if (sql.includes('FROM zhiban_identity.admission_policies'))
                return {
                  command: 'SELECT',
                  rowCount: 4,
                  rows: policyRows.map((p) => ({
                    ...p,
                    policy_digest: admission.policyDigests[p.purpose],
                    global_limit: scenario === 'tampered_threshold' ? '100' : p.global_limit,
                  })),
                };
              return { command: sql.startsWith('BEGIN') ? 'BEGIN' : sql, rowCount: 0, rows: [] };
            },
          }),
        }) as unknown as TransactionPool;
      const result = createIdentityComposition(
        {
          auth: poolFor('zhiban_auth_runtime'),
          tenant: poolFor('zhiban_runtime'),
          control: poolFor('zhiban_control_runtime'),
        },
        cfg,
      );
      if (scenario === 'valid') expect((await result).operator).toBeNull();
      else await expect(result).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    },
  );
});
