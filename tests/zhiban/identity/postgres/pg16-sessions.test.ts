import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { User, instant, userId } from '@/lib/zhiban/domain/identity';
import {
  credentialId,
  type CredentialAuditContext,
} from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { SessionAuthenticator } from '@/lib/zhiban/infrastructure/identity/sessions/session-authenticator';
import {
  bearerForCookie,
  newApprovedSession,
  DEFAULT_SESSION_POLICY,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import {
  configured,
  prepareSchema,
  verifyPg16,
  resetDisposableIdentity,
  runtimePool,
  runtimeClient,
  adminClient,
  expectDenied,
} from './pg16-harness';

const audit: CredentialAuditContext = {
  actor: { kind: 'SYSTEM' },
  requestId: null,
  reason: 'SECURITY_POLICY',
};
const provider = new Argon2PasswordHasher({ isCompromised: async () => false }); // Explicit synthetic test corpus, never production default.
const secret = 'Synthetic-session-PG16-password!';
let handle: PasswordVerifierHandle,
  sequence = 96000;
const fresh = () => credentialId(`018f0000-0000-7000-8000-${String(sequence++).padStart(12, '0')}`);
describe
  .skipIf(!configured)
  .sequential('real PG16 Sessions: global auth runtime, expiry, revocation and races', () => {
    const pools = new Set<Pool>();
    function pool(role: 'zhiban_auth_runtime' | 'zhiban_control_runtime' = 'zhiban_auth_runtime') {
      const p = runtimePool(role);
      p.options.statement_timeout = 4000;
      p.options.connectionTimeoutMillis = 4000;
      pools.add(p);
      return p;
    }
    beforeAll(async () => {
      console.info(`1B-6 REAL server_version: ${await verifyPg16()}`);
      await prepareSchema();
      handle = await provider.hash(secret);
    });
    afterEach(async () => {
      await Promise.all([...pools].map((p) => p.end()));
      pools.clear();
    });
    afterAll(resetDisposableIdentity);
    async function seed(issue = true) {
      const id = userId(fresh()),
        control = new PostgresIdentityRepository(pool('zhiban_control_runtime'));
      const user = await control.create(User.create(id, instant(1000)));
      const auth = pool(),
        credentials = new PostgresCredentialRepository(auth),
        sessions = new PostgresSessionRepository(auth);
      const credential = fresh();
      await credentials.createPassword(id, credential, handle, instant(1000), audit);
      const snapshot = (await credentials.verificationSnapshot(id))!;
      const issued = newApprovedSession(
        snapshot,
        user.revision,
        instant(1000),
        DEFAULT_SESSION_POLICY,
      );
      const loaded = issue ? await sessions.create(issued.record) : null;
      return {
        id,
        user,
        control,
        auth,
        credentials,
        credential,
        sessions,
        issued,
        loaded,
        raw: bearerForCookie(issued.bearer),
      };
    }
    async function state(id: string) {
      const c = adminClient();
      await c.connect();
      try {
        return {
          rows: (
            await c.query(
              'SELECT session_id,token_digest,security_epoch,user_revision,repository_revision,revoked_at,last_seen_at,absolute_expires_at,idle_expires_at FROM zhiban_identity.sessions WHERE user_id=$1 ORDER BY session_id',
              [id],
            )
          ).rows,
          audit: (
            await c.query(
              "SELECT event_payload FROM zhiban_identity.audit_events WHERE subject_user_id=$1 AND event_type='SESSION_REVOKED' ORDER BY event_id",
              [id],
            )
          ).rows,
        };
      } finally {
        await c.end();
      }
    }
    function injected(p: Pool, prefix: string): TransactionPool {
      return {
        async connect() {
          const c = await p.connect();
          return {
            query: (async (sql: string, values?: unknown[]) => {
              const result = await c.query(sql, values);
              if (sql.startsWith(prefix)) await c.query('SELECT 1/0');
              return result;
            }) as PoolClient['query'],
            release: c.release.bind(c),
          };
        },
      };
    }
    function gatePool(p: Pool, prefix: string) {
      let release!: () => void, ready!: () => void;
      const held = new Promise<void>((resolve) => {
          release = resolve;
        }),
        reached = new Promise<void>((resolve) => {
          ready = resolve;
        });
      const wrapped: TransactionPool = {
        async connect() {
          const c = await p.connect();
          return {
            query: (async (sql: string, values?: unknown[]) => {
              const result = await c.query(sql, values);
              if (sql.startsWith(prefix)) {
                ready();
                await held;
              }
              return result;
            }) as PoolClient['query'],
            release: c.release.bind(c),
          };
        },
      };
      return { wrapped, reached, release };
    }
    async function pid(p: Pool) {
      const c = await p.connect();
      try {
        return (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      } finally {
        c.release();
      }
    }
    async function blocked(process: number) {
      const c = adminClient();
      await c.connect();
      try {
        const deadline = performance.now() + 3000;
        do {
          if (
            (await c.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS waiting', [process]))
              .rows[0].waiting
          )
            return;
        } while (performance.now() < deadline);
        throw new Error('Session database lock wait not acknowledged');
      } finally {
        await c.end();
      }
    }
    it('SESS-PG01 migration/catalog: bound columns, global no RLS, owner not runtime', async () => {
      const c = adminClient();
      await c.connect();
      try {
        expect(
          (
            await c.query(
              "SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='zhiban_identity.sessions'::regclass",
            )
          ).rows[0],
        ).toEqual({
          relrowsecurity: false,
          relforcerowsecurity: false,
          owner: 'zhiban_identity_owner',
        });
        expect(
          (
            await c.query('SELECT version FROM zhiban_identity.schema_migrations ORDER BY version')
          ).rows.map((row) => row.version),
        ).toEqual([
          '0001',
          '0002',
          '0003',
          '0004',
          '0005',
          '0006',
          '0007',
          '0008',
          '0009',
          '0010',
          '0011',
          '0012',
        ]);
        expect(
          (
            await c.query(
              "SELECT column_name FROM information_schema.columns WHERE table_schema='zhiban_identity' AND table_name='sessions' AND column_name IN ('security_epoch','user_revision')",
            )
          ).rowCount,
        ).toBe(2);
      } finally {
        await c.end();
      }
    });
    it('SESS-PG02 auth minimum privileges: digest read/insert, lifecycle update, no DELETE or binding/user writes', async () => {
      const c = adminClient();
      await c.connect();
      try {
        expect(
          (
            await c.query(
              "SELECT has_column_privilege('zhiban_auth_runtime','zhiban_identity.sessions','token_digest','SELECT') AS digest, has_column_privilege('zhiban_auth_runtime','zhiban_identity.sessions','security_epoch','UPDATE') AS binding, has_table_privilege('zhiban_auth_runtime','zhiban_identity.sessions','DELETE,TRUNCATE,UPDATE') AS broad,has_table_privilege('zhiban_auth_runtime','zhiban_identity.users','UPDATE') AS users",
            )
          ).rows[0],
        ).toEqual({ digest: true, binding: false, broad: false, users: false });
      } finally {
        await c.end();
      }
    });
    it('SESS-PG03 tenant cannot read or write sessions', async () => {
      const c = runtimeClient('zhiban_runtime');
      await c.connect();
      try {
        await expectDenied(c, 'SELECT * FROM zhiban_identity.sessions');
        await expectDenied(c, 'UPDATE zhiban_identity.sessions SET revoked_at=1000 WHERE false');
      } finally {
        await c.end();
      }
    });
    it('SESS-PG04 control cannot read digest/binding or insert sessions', async () => {
      const c = runtimeClient('zhiban_control_runtime');
      await c.connect();
      try {
        await expectDenied(c, 'SELECT token_digest FROM zhiban_identity.sessions');
        await expectDenied(c, 'SELECT security_epoch FROM zhiban_identity.sessions');
        await expectDenied(
          c,
          "INSERT INTO zhiban_identity.sessions(session_id) VALUES('forbidden')",
        );
      } finally {
        await c.end();
      }
    });
    it('SESS-PG05 PUBLIC table, column and function capability denied in catalog', async () => {
      const c = adminClient();
      await c.connect();
      try {
        expect(
          (
            await c.query(
              "SELECT count(*)::int AS count FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid='zhiban_identity.sessions'::regclass AND acl.grantee=0",
            )
          ).rows[0].count,
        ).toBe(0);
        expect(
          (
            await c.query(
              "SELECT count(*)::int AS count FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid='zhiban_identity.sessions'::regclass AND a.attacl IS NOT NULL AND acl.grantee=0",
            )
          ).rows[0].count,
        ).toBe(0);
        expect(
          (
            await c.query(
              "SELECT count(*)::int AS count FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.pronamespace='zhiban_identity'::regnamespace AND p.proname IN ('session_binding_guard','session_user_barrier','session_user_disable') AND acl.grantee=0",
            )
          ).rows[0].count,
        ).toBe(0);
      } finally {
        await c.end();
      }
    });
    it('SESS-PG06 real credential hash/verification composed with issue, digest lookup and no raw token storage', async () => {
      const s = await seed(false),
        authenticator = await SessionAuthenticator.create(s.credentials, s.sessions, provider);
      const issued = await authenticator.issue({ identifier: s.id, secret }, instant(1000));
      expect(issued !== null).toBe(true);
      const raw = bearerForCookie(issued!.bearer);
      expect((await s.sessions.findByDigest(issued!.session.value.tokenDigest))?.revision).toBe(
        '1',
      );
      expect(await s.sessions.validateAndTouch(raw, instant(2000))).toBe(s.id);
      const evidence = JSON.stringify(await state(s.id));
      expect(evidence.includes(raw) || evidence.includes(secret)).toBe(false);
    });
    it('SESS-PG07 wrong token rejects', async () => {
      const s = await seed();
      expect(await s.sessions.validateAndTouch('A'.repeat(43), instant(2000))).toBeNull();
    });
    it('SESS-PG08 disabled User revokes/audits all sessions atomically', async () => {
      const s = await seed();
      await s.control.save(s.user.value.disable(instant(2000), 'security-test'), s.user.revision);
      expect(await s.sessions.validateAndTouch(s.raw, instant(3000))).toBeNull();
      const stored = await state(s.id);
      expect(stored.rows[0].revoked_at).toBe('2000');
      expect(stored.audit).toEqual([{ event_payload: { sessionId: s.issued.record.id } }]);
    });
    it('SESS-PG09 restore cannot revive old token; fresh verification can issue new', async () => {
      const s = await seed(),
        disabled = await s.control.save(
          s.user.value.disable(instant(2000), 'security-test'),
          s.user.revision,
        );
      await s.control.save(disabled.value.restore(instant(3000)), disabled.revision);
      expect(await s.sessions.validateAndTouch(s.raw, instant(4000))).toBeNull();
      const authenticator = await SessionAuthenticator.create(s.credentials, s.sessions, provider);
      expect(
        (await authenticator.issue({ identifier: s.id, secret }, instant(4000))) !== null,
      ).toBe(true);
    });
    it.each(['replace', 'revoke'] as const)(
      'SESS-PG10 credential %s epoch change immediately rejects old session',
      async (mutation) => {
        const s = await seed();
        if (mutation === 'replace')
          await s.credentials.replacePassword(
            s.id,
            repositoryRevision('1'),
            s.credential,
            fresh(),
            handle,
            instant(2000),
            audit,
          );
        else
          await s.credentials.revokePassword(
            s.id,
            repositoryRevision('1'),
            s.credential,
            instant(2000),
            audit,
          );
        expect(await s.sessions.validateAndTouch(s.raw, instant(3000))).toBeNull();
      },
    );
    it('SESS-PG11 absolute expiry is strict even after sliding idle', async () => {
      const s = await seed();
      for (let at = 1000 + 1700000; at < 28801000; at += 1700000)
        expect(await s.sessions.validateAndTouch(s.raw, instant(at))).toBe(s.id);
      expect(await s.sessions.validateAndTouch(s.raw, instant(28801000))).toBeNull();
    });
    it('SESS-PG12 idle expiry boundary rejects without UPDATE', async () => {
      const s = await seed();
      expect(await s.sessions.validateAndTouch(s.raw, instant(1801000))).toBeNull();
      expect((await state(s.id)).rows[0].repository_revision).toBe('1');
    });
    it('SESS-PG13 touch CAS advances once; stale-before-no-op and current no-op preserved', async () => {
      const s = await seed(),
        a = await s.sessions.touch(
          s.issued.record.id,
          instant(2000),
          instant(1802000),
          repositoryRevision('1'),
        );
      expect(a?.revision).toBe('2');
      await expect(
        s.sessions.touch(
          s.issued.record.id,
          instant(2000),
          instant(1802000),
          repositoryRevision('1'),
        ),
      ).rejects.toMatchObject({ code: 'STALE_WRITE' });
      expect(
        (
          await s.sessions.touch(
            s.issued.record.id,
            instant(2000),
            instant(1802000),
            repositoryRevision('2'),
          )
        )?.revision,
      ).toBe('2');
    });
    it('SESS-PG14 revoke idempotent, terminal, audit exactly once', async () => {
      const s = await seed();
      await s.sessions.revoke(s.issued.record.id, instant(2000));
      await s.sessions.revoke(s.issued.record.id, instant(3000));
      expect(await s.sessions.validateAndTouch(s.raw, instant(4000))).toBeNull();
      expect((await state(s.id)).audit).toHaveLength(1);
      const c = runtimeClient('zhiban_auth_runtime');
      await c.connect();
      try {
        await expect(
          c.query(
            'UPDATE zhiban_identity.sessions SET revoked_at=NULL,repository_revision=repository_revision+1 WHERE session_id=$1',
            [s.issued.record.id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await c.end();
      }
    });
    it('SESS-PG15 revokeAll is user-scoped and audited', async () => {
      const s = await seed(),
        other = await seed();
      await s.sessions.revokeAllForUser(s.id, instant(2000));
      expect(await s.sessions.validateAndTouch(s.raw, instant(3000))).toBeNull();
      expect(await other.sessions.validateAndTouch(other.raw, instant(3000))).toBe(other.id);
    });
    it('SESS-PG16 touch before revoke: independent backend waits, revoke wins terminal state', async () => {
      const s = await seed(),
        revokePool = pool(),
        backend = await pid(revokePool);
      const gate = gatePool(s.auth, 'UPDATE zhiban_identity.sessions SET last_seen_at');
      const touch = new PostgresSessionRepository(gate.wrapped).touch(
        s.issued.record.id,
        instant(2000),
        instant(1802000),
        repositoryRevision('1'),
      );
      let revoke: Promise<void> | undefined;
      try {
        await gate.reached;
        revoke = new PostgresSessionRepository(revokePool).revoke(
          s.issued.record.id,
          instant(3000),
        );
        await blocked(backend);
      } finally {
        gate.release();
      }
      await touch;
      await revoke;
      expect((await state(s.id)).rows[0]).toMatchObject({
        revoked_at: '3000',
        repository_revision: '3',
      });
    });
    it('SESS-PG17 revoke before touch: competing stale touch rejected, no revival', async () => {
      const s = await seed(),
        touchPool = pool(),
        backend = await pid(touchPool);
      const gate = gatePool(s.auth, 'UPDATE zhiban_identity.sessions SET revoked_at');
      const revoke = new PostgresSessionRepository(gate.wrapped).revoke(
        s.issued.record.id,
        instant(2000),
      );
      let touch: Promise<unknown> | undefined;
      try {
        await gate.reached;
        touch = new PostgresSessionRepository(touchPool)
          .touch(s.issued.record.id, instant(3000), instant(1803000), repositoryRevision('1'))
          .catch((error) => error);
        await blocked(backend);
      } finally {
        gate.release();
      }
      await revoke;
      expect(await touch).toMatchObject({ code: 'STALE_WRITE' });
      expect((await state(s.id)).rows[0].last_seen_at).toBe('1000');
    });
    it.each(['replace', 'revoke'] as const)(
      'SESS-PG18 issue vs credential %s: blocked issuance cannot bind stale verification',
      async (mutation) => {
        const s = await seed(false),
          issuePool = pool(),
          backend = await pid(issuePool);
        const gate = gatePool(s.auth, 'UPDATE zhiban_identity.credential_slots');
        const creds = new PostgresCredentialRepository(gate.wrapped);
        const change =
          mutation === 'replace'
            ? creds.replacePassword(
                s.id,
                repositoryRevision('1'),
                s.credential,
                fresh(),
                handle,
                instant(2000),
                audit,
              )
            : creds.revokePassword(
                s.id,
                repositoryRevision('1'),
                s.credential,
                instant(2000),
                audit,
              );
        let issue: Promise<unknown> | undefined;
        try {
          await gate.reached;
          issue = new PostgresSessionRepository(issuePool)
            .create(s.issued.record)
            .catch((error) => error);
          await blocked(backend);
        } finally {
          gate.release();
        }
        await change;
        expect(await issue).toHaveProperty('code');
        expect((await state(s.id)).rows).toHaveLength(0);
      },
    );
    it('SESS-PG19 disable holding User row first: issue waits FK, then rejects; no User/barrier deadlock', async () => {
      const s = await seed(false),
        backend = await pid(s.auth),
        c = runtimeClient('zhiban_control_runtime');
      await c.connect();
      let issue: Promise<unknown> | undefined;
      try {
        await c.query('BEGIN');
        await c.query('SELECT user_id FROM zhiban_identity.users WHERE user_id=$1 FOR UPDATE', [
          s.id,
        ]);
        issue = s.sessions.create(s.issued.record).catch((error) => error);
        await blocked(backend);
        await c.query(
          "UPDATE zhiban_identity.users SET status='DISABLED',updated_at=2000,disabled_at=2000,disabled_reason='security-test',repository_revision=repository_revision+1 WHERE user_id=$1",
          [s.id],
        );
        await c.query('COMMIT');
        expect(await issue).toHaveProperty('code');
        expect((await state(s.id)).rows).toHaveLength(0);
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
        await c.end();
        if (issue) await issue;
      }
    });
    it('SESS-PG20 issue holding FK first: disable waits, then revokes newly issued token', async () => {
      const s = await seed(false),
        controlPool = pool('zhiban_control_runtime'),
        backend = await pid(controlPool);
      const gate = gatePool(s.auth, 'INSERT INTO zhiban_identity.sessions');
      const issue = new PostgresSessionRepository(gate.wrapped).create(s.issued.record);
      let disable: ReturnType<PostgresIdentityRepository['save']> | undefined;
      try {
        await gate.reached;
        disable = new PostgresIdentityRepository(controlPool).save(
          s.user.value.disable(instant(2000), 'security-test'),
          s.user.revision,
        );
        await blocked(backend);
      } finally {
        gate.release();
      }
      await issue;
      await disable;
      expect(await s.sessions.validateAndTouch(s.raw, instant(3000))).toBeNull();
      expect((await state(s.id)).rows[0].revoked_at).toBe('2000');
    });
    it('SESS-PG21 rotation is atomic, old rejects/new validates, absolute lifetime cannot be extended', async () => {
      const s = await seed(),
        rotated = await s.sessions.rotate(s.raw, instant(2000), repositoryRevision('1'));
      expect(rotated !== null).toBe(true);
      expect(rotated!.session.value.absoluteExpiresAt).toBe(s.issued.record.absoluteExpiresAt);
      expect(await s.sessions.validateAndTouch(s.raw, instant(3000))).toBeNull();
      expect(
        await s.sessions.validateAndTouch(bearerForCookie(rotated!.bearer), instant(3000)),
      ).toBe(s.id);
    });
    it('SESS-PG22 competing rotations exactly one succeeds, no orphan new session/history', async () => {
      const s = await seed(),
        first = pool(),
        second = pool();
      const pids = [await pid(first), await pid(second)];
      expect(pids[0]).not.toBe(pids[1]);
      const blocker = runtimeClient('zhiban_auth_runtime');
      await blocker.connect();
      let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
      let results: PromiseSettledResult<unknown>[];
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          'SELECT session_id FROM zhiban_identity.sessions WHERE session_id=$1 FOR UPDATE',
          [s.issued.record.id],
        );
        pending = Promise.allSettled([
          new PostgresSessionRepository(first).rotate(
            s.raw,
            instant(2000),
            repositoryRevision('1'),
          ),
          new PostgresSessionRepository(second).rotate(
            s.raw,
            instant(2000),
            repositoryRevision('1'),
          ),
        ]);
        await blocked(pids[0]);
        await blocked(pids[1]);
        await blocker.query('ROLLBACK');
        results = await pending;
      } finally {
        await blocker.query('ROLLBACK').catch(() => undefined);
        await blocker.end();
        if (pending) await pending;
      }
      expect(
        results.filter((result) => result.status === 'fulfilled' && result.value !== null),
      ).toHaveLength(1);
      const stored = await state(s.id);
      expect(stored.rows).toHaveLength(2);
      expect(stored.rows.filter((row) => row.revoked_at === null)).toHaveLength(1);
    });
    it.each(['revoke', 'rotate', 'all'] as const)(
      'SESS-PG23 %s audit failure: real SQL abort rolls entire mutation back',
      async (operation) => {
        const s = await seed(),
          before = await state(s.id),
          repo = new PostgresSessionRepository(
            injected(s.auth, 'INSERT INTO zhiban_identity.audit_events'),
          );
        await expect(
          operation === 'revoke'
            ? repo.revoke(s.issued.record.id, instant(2000))
            : operation === 'rotate'
              ? repo.rotate(s.raw, instant(2000), repositoryRevision('1'))
              : repo.revokeAllForUser(s.id, instant(2000)),
        ).rejects.toHaveProperty('code');
        expect(await state(s.id)).toEqual(before);
      },
    );
    it('SESS-PG24 malformed/unbound persisted record fails closed', async () => {
      const s = await seed(),
        c = adminClient();
      await c.connect();
      try {
        await c.query('ALTER TABLE zhiban_identity.sessions DISABLE TRIGGER USER');
        await c.query(
          'UPDATE zhiban_identity.sessions SET security_epoch=NULL,user_revision=NULL WHERE session_id=$1',
          [s.issued.record.id],
        );
      } finally {
        await c.query('ALTER TABLE zhiban_identity.sessions ENABLE TRIGGER USER');
        await c.end();
      }
      await expect(s.sessions.validateAndTouch(s.raw, instant(2000))).rejects.toMatchObject({
        code: 'INTEGRITY_FAILURE',
      });
    });
    it('SESS-PG25 pool=max1 physical connection reused after rollback; no token/tenant context leakage', async () => {
      const s = await seed(),
        before = await pid(s.auth);
      await expect(
        new PostgresSessionRepository(injected(s.auth, 'UPDATE zhiban_identity.sessions')).revoke(
          s.issued.record.id,
          instant(2000),
        ),
      ).rejects.toHaveProperty('code');
      expect(await pid(s.auth)).toBe(before);
      expect(await s.sessions.validateAndTouch(s.raw, instant(3000))).toBe(s.id);
      const c = await s.auth.connect();
      try {
        expect(
          (
            await c.query(
              "SELECT nullif(current_setting('app.tenant_id',true),'') IS NULL AS clean",
            )
          ).rows[0].clean,
        ).toBe(true);
      } finally {
        c.release();
      }
    });
    it('SESS-PG26 issue wins slot share first: credential mutation waits then invalidates token', async () => {
      const s = await seed(false),
        credentialPool = pool(),
        backend = await pid(credentialPool);
      const gate = gatePool(s.auth, 'INSERT INTO zhiban_identity.sessions');
      const issue = new PostgresSessionRepository(gate.wrapped).create(s.issued.record);
      let change: ReturnType<PostgresCredentialRepository['replacePassword']> | undefined;
      try {
        await gate.reached;
        change = new PostgresCredentialRepository(credentialPool).replacePassword(
          s.id,
          repositoryRevision('1'),
          s.credential,
          fresh(),
          handle,
          instant(2000),
          audit,
        );
        await blocked(backend);
      } finally {
        gate.release();
      }
      await issue;
      await change;
      expect(await s.sessions.validateAndTouch(s.raw, instant(3000))).toBeNull();
    });
    it('SESS-PG27 disable audit failure rolls back User and Session in the SAME control transaction', async () => {
      const s = await seed(),
        before = await state(s.id),
        c = adminClient();
      await c.connect();
      try {
        await c.query(
          "ALTER TABLE zhiban_identity.audit_events ADD CONSTRAINT session_audit_failure_probe CHECK(event_type <> 'SESSION_REVOKED') NOT VALID",
        );
        await expect(
          s.control.save(s.user.value.disable(instant(2000), 'security-test'), s.user.revision),
        ).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
        expect(await state(s.id)).toEqual(before);
        expect((await s.control.findById(s.id))?.value.status).toBe('ACTIVE');
      } finally {
        await c.query(
          'ALTER TABLE zhiban_identity.audit_events DROP CONSTRAINT session_audit_failure_probe',
        );
        await c.end();
      }
    });
    it('SESS-PG28 max revision rejects mutation, cannot return authenticated User', async () => {
      const s = await seed(),
        c = adminClient();
      await c.connect();
      try {
        await c.query('ALTER TABLE zhiban_identity.sessions DISABLE TRIGGER USER');
        await c.query(
          'UPDATE zhiban_identity.sessions SET repository_revision=9223372036854775807 WHERE session_id=$1',
          [s.issued.record.id],
        );
      } finally {
        await c.query('ALTER TABLE zhiban_identity.sessions ENABLE TRIGGER USER');
        await c.end();
      }
      await expect(s.sessions.validateAndTouch(s.raw, instant(2000))).rejects.toMatchObject({
        code: 'INTEGRITY_FAILURE',
      });
      expect((await state(s.id)).rows[0].last_seen_at).toBe('1000');
    });
    it('SESS-PG29 database refuses monotonicity, absolute-expiry and epoch-binding tampering', async () => {
      const s = await seed(),
        c = runtimeClient('zhiban_auth_runtime');
      await c.connect();
      try {
        await expect(
          c.query(
            'UPDATE zhiban_identity.sessions SET last_seen_at=999,repository_revision=repository_revision+1 WHERE session_id=$1',
            [s.issued.record.id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          c.query(
            'UPDATE zhiban_identity.sessions SET idle_expires_at=28801001,repository_revision=repository_revision+1 WHERE session_id=$1',
            [s.issued.record.id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expectDenied(
          c,
          'UPDATE zhiban_identity.sessions SET security_epoch=2 WHERE session_id=$1',
          [s.issued.record.id],
        );
        // Nonsecret malformed fixture: do not send a live bearer token to SQL.
        await expect(
          c.query(
            "INSERT INTO zhiban_identity.sessions(session_id,user_id,token_digest,created_at,last_seen_at,absolute_expires_at,idle_expires_at) VALUES('invalid-digest-fixture',$1,'not-a-digest',1000,1000,9000,5000)",
            [s.id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await c.end();
      }
    });
  });
