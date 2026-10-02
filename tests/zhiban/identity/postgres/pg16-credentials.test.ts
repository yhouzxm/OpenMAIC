import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { User, instant, userId, type UserId } from '@/lib/zhiban/domain/identity';
import {
  credentialId,
  type CredentialAuditContext,
} from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { CredentialVerifier } from '@/lib/zhiban/infrastructure/identity/credentials/credential-verifier';
import { issueVerifier } from '@/lib/zhiban/infrastructure/identity/credentials/verifier-material';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
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
import { hash } from '@node-rs/argon2';
import { PASSWORD_HASH_POLICY } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';

const audit: CredentialAuditContext = {
  actor: { kind: 'SERVICE', serviceCode: 'credential-service' },
  requestId: 'credential-pg16',
  reason: 'SECURITY_POLICY',
};
const secretA = 'Synthetic-PG16-first-password!',
  secretB = 'Synthetic-PG16-second-password!';
let sequence = 50000;
function fresh() {
  return credentialId(`018f0000-0000-7000-8000-${String(sequence++).padStart(12, '0')}`);
}
const provider = new Argon2PasswordHasher(syntheticPasswordScreening);
let handleA: PasswordVerifierHandle, handleB: PasswordVerifierHandle;
describe
  .skipIf(!configured)
  .sequential('real PG16 Credential security and concurrency (auth runtime)', () => {
    const pools = new Set<Pool>();
    function pool(role: 'zhiban_auth_runtime' | 'zhiban_control_runtime' = 'zhiban_auth_runtime') {
      const value = runtimePool(role);
      // Bound broken SQL coordination, never establish race ordering or change Vitest timeouts.
      value.options.statement_timeout = 3000;
      value.options.connectionTimeoutMillis = 3000;
      pools.add(value);
      return value;
    }
    beforeAll(async () => {
      console.info(`1B-5B REAL server_version: ${await verifyPg16()}`);
      console.info(
        `1B-5B KDF runtime: ${process.version} ${process.platform}/${process.arch}; Argon2id m=32768 t=3 p=1`,
      );
      await prepareSchema();
      [handleA, handleB] = await Promise.all([provider.hash(secretA), provider.hash(secretB)]);
    });
    afterEach(async () => {
      await Promise.all([...pools].map((value) => value.end()));
      pools.clear();
    });
    afterAll(resetDisposableIdentity);
    async function seed(create = true) {
      const id = userId(fresh()),
        credential = fresh();
      const control = new PostgresIdentityRepository(pool('zhiban_control_runtime'));
      const user = await control.create(User.create(id, instant(1000)));
      const auth = pool(),
        repo = new PostgresCredentialRepository(auth);
      if (create) await repo.createPassword(id, credential, handleA, instant(1000), audit);
      return { id, credential, repo, auth, user, control };
    }
    async function state(id: UserId) {
      const admin = adminClient();
      await admin.connect();
      try {
        return {
          slot: (
            await admin.query(
              'SELECT user_id, active_credential_id, generation, repository_revision, security_epoch, created_at, updated_at FROM zhiban_identity.credential_slots WHERE user_id=$1',
              [id],
            )
          ).rows,
          history: (
            await admin.query(
              'SELECT credential_id, generation, status, slot_revision, verifier_material IS NULL AS cleared, replaced_by_credential_id, created_at, updated_at, replaced_at, revoked_at FROM zhiban_identity.credentials WHERE user_id=$1 ORDER BY generation',
              [id],
            )
          ).rows,
          audit: (
            await admin.query(
              'SELECT event_type, event_scope, event_payload FROM zhiban_identity.audit_events WHERE subject_user_id=$1 ORDER BY event_id',
              [id],
            )
          ).rows,
        };
      } finally {
        await admin.end();
      }
    }
    function injected(real: Pool, prefix: string): TransactionPool {
      return {
        async connect() {
          const client = await real.connect();
          const query = async (sql: string, parameters?: unknown[]) => {
            const result = await client.query(sql, parameters);
            if (sql.startsWith(prefix)) await client.query('SELECT 1 / 0'); // REAL SQL failure AFTER the acknowledged write.
            return result;
          };
          return { query: query as PoolClient['query'], release: client.release.bind(client) };
        },
      };
    }
    async function pid(value: Pool) {
      const client = await value.connect();
      try {
        return (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      } finally {
        client.release();
      }
    }
    async function blocked(pids: number[]) {
      const admin = adminClient();
      await admin.connect();
      try {
        const deadline = performance.now() + 2500;
        do {
          const result = await admin.query(
            'SELECT pid, cardinality(pg_blocking_pids(pid)) > 0 AS blocked FROM unnest($1::int[]) AS pid',
            [pids],
          );
          if (result.rows.length === pids.length && result.rows.every((row) => row.blocked)) return;
        } while (performance.now() < deadline);
        throw new Error('Credential race lock acknowledgements not observed');
      } finally {
        await admin.end();
      }
    }
    async function race<T>(
      id: UserId,
      a: Pool,
      b: Pool,
      first: () => Promise<T>,
      second: () => Promise<T>,
      initial = false,
    ) {
      const blocker = runtimeClient('zhiban_auth_runtime');
      await blocker.connect();
      let result: Promise<PromiseSettledResult<T>[]> | undefined;
      try {
        await blocker.query("SET statement_timeout='3s'");
        await blocker.query('BEGIN');
        if (initial) {
          // One uncommitted anchor forces BOTH initial INSERTs into a real uniqueness wait.
          await blocker.query(
            "INSERT INTO zhiban_identity.credential_slots(user_id,credential_type,active_credential_id,generation,repository_revision,security_epoch,created_at,updated_at) VALUES($1,'PASSWORD',NULL,1,1,1,1000,1000)",
            [id],
          );
        } else
          await blocker.query(
            'SELECT user_id FROM zhiban_identity.credential_slots WHERE user_id=$1 FOR UPDATE',
            [id],
          );
        const pids = [await pid(a), await pid(b)];
        expect(pids[0]).not.toBe(pids[1]);
        result = Promise.allSettled([first(), second()]);
        await blocked(pids);
        await blocker.query('ROLLBACK');
        return await result;
      } finally {
        await blocker.query('ROLLBACK').catch(() => undefined);
        await blocker.end();
        if (result) await result;
      }
    }
    it('CRED-PG01 global schema, RLS not required, permanent anchor and deferred constraints in catalog', async () => {
      const admin = adminClient();
      await admin.connect();
      try {
        const result = await admin.query(
          "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='zhiban_identity' AND c.relname IN ('credentials','credential_slots') ORDER BY c.relname",
        );
        expect(result.rows).toEqual([
          {
            relname: 'credential_slots',
            relrowsecurity: false,
            relforcerowsecurity: false,
            owner: 'zhiban_identity_owner',
          },
          {
            relname: 'credentials',
            relrowsecurity: false,
            relforcerowsecurity: false,
            owner: 'zhiban_identity_owner',
          },
        ]);
        const triggers = await admin.query(
          "SELECT tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname IN ('credential_slot_consistency','credential_history_consistency')",
        );
        expect(triggers.rowCount).toBe(2);
        expect(triggers.rows.every((row) => row.tgdeferrable && row.tginitdeferred)).toBe(true);
      } finally {
        await admin.end();
      }
    });
    it('CRED-PG02 auth runtime minimum column privileges and secure role attributes', async () => {
      const admin = adminClient();
      await admin.connect();
      try {
        expect(
          (
            await admin.query(
              "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname='zhiban_auth_runtime'",
            )
          ).rows[0],
        ).toEqual({
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
        });
        for (const table of ['credentials', 'credential_slots']) {
          expect(
            (
              await admin.query(
                "SELECT (has_table_privilege('zhiban_auth_runtime',$1,'SELECT') AND has_table_privilege('zhiban_auth_runtime',$1,'INSERT')) AS rw, has_table_privilege('zhiban_auth_runtime',$1,'DELETE,TRUNCATE,UPDATE') AS overgrant",
                [`zhiban_identity.${table}`],
              )
            ).rows[0],
          ).toEqual({ rw: true, overgrant: false });
        }
        expect(
          (
            await admin.query(
              "SELECT has_column_privilege('zhiban_auth_runtime','zhiban_identity.credentials','verifier_material','UPDATE') AS permitted, has_column_privilege('zhiban_auth_runtime','zhiban_identity.credentials','user_id','UPDATE') AS ownership",
            )
          ).rows[0],
        ).toEqual({ permitted: true, ownership: false });
      } finally {
        await admin.end();
      }
    });
    for (const role of ['zhiban_runtime', 'zhiban_control_runtime'] as const) {
      it(`CRED-PG03/04 ${role} effective read/write credential denial`, async () => {
        const client = runtimeClient(role);
        await client.connect();
        try {
          await expectDenied(client, 'SELECT verifier_material FROM zhiban_identity.credentials');
          await expectDenied(client, 'SELECT user_id FROM zhiban_identity.credential_slots');
          await expectDenied(
            client,
            'UPDATE zhiban_identity.credentials SET verifier_material=NULL WHERE false',
          );
          await expectDenied(
            client,
            "INSERT INTO zhiban_identity.credential_slots(user_id,credential_type,generation,security_epoch,created_at,updated_at) VALUES($1,'PASSWORD',1,1,1000,1000)",
            [fresh()],
          );
        } finally {
          await client.end();
        }
      });
    }
    it('CRED-PG05 PUBLIC has neither table/column/function secret capability', async () => {
      const admin = adminClient();
      await admin.connect();
      try {
        const result = await admin.query(
          "SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='zhiban_identity' AND c.relname IN ('credentials','credential_slots') AND a.grantee=0",
        );
        expect(result.rows[0].count).toBe(0);
        expect(
          (
            await admin.query(
              "SELECT count(*)::int AS count FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE n.nspname='zhiban_identity' AND c.relname IN ('credentials','credential_slots') AND a.attacl IS NOT NULL AND acl.grantee=0",
            )
          ).rows[0].count,
        ).toBe(0);
        expect(
          (
            await admin.query(
              "SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='zhiban_identity' AND (p.proname LIKE 'credential_%' OR p.proname='audit_payload_valid') AND acl.grantee=0",
            )
          ).rows[0].count,
        ).toBe(0);
      } finally {
        await admin.end();
      }
    });
    it('CRED-PG06 initial create revision/epoch 1 and safe metadata', async () => {
      const base = await seed();
      expect(await base.repo.findSlot(base.id)).toMatchObject({
        revision: '1',
        value: { activeCredentialId: base.credential, securityEpoch: '1', generation: '1' },
      });
      expect(JSON.stringify(await base.repo.findSlot(base.id))).not.toMatch(/verifier|secret|hash/);
    });
    it('initial creation requires real global User FK; failure leaves no slot/history/audit', async () => {
      const repo = new PostgresCredentialRepository(pool()),
        id = userId(fresh());
      await expect(
        repo.createPassword(id, fresh(), handleA, instant(1000), audit),
      ).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
      expect(await state(id)).toEqual({ slot: [], history: [], audit: [] });
    });
    it('CRED-PG07 two real initial creates exactly one success, stable slot never overwritten', async () => {
      const base = await seed(false),
        b = pool();
      const ids = [base.credential, fresh()];
      const results = await race(
        base.id,
        base.auth,
        b,
        () => base.repo.createPassword(base.id, ids[0], handleA, instant(1000), audit),
        () =>
          new PostgresCredentialRepository(b).createPassword(
            base.id,
            ids[1],
            handleB,
            instant(1000),
            audit,
          ),
        true,
      );
      expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((row) => row.status === 'rejected');
      expect(loser?.status === 'rejected' && loser.reason).toMatchObject({ code: 'CONFLICT' });
      const stored = await state(base.id);
      expect(stored.history).toHaveLength(1);
      expect(stored.slot[0].repository_revision).toBe('1');
      expect(stored.slot[0].active_credential_id).toBe(
        ids[results.findIndex((row) => row.status === 'fulfilled')],
      );
    });
    for (const [label, password, expected] of [
      ['CRED-PG08 correct', secretA, 'VERIFIED'],
      ['CRED-PG09 wrong', secretB, 'REJECTED'],
    ] as const) {
      it(label, async () => {
        const base = await seed();
        const verifier = await CredentialVerifier.create(base.repo, provider);
        expect(
          (await verifier.verifyCredential({ identifier: base.id, secret: password })).status,
        ).toBe(expected);
      });
    }
    it('CRED-PG10 unknown User/missing credential execute a real dummy KDF', async () => {
      const base = await seed(false);
      const verify = vi.fn(provider.verify.bind(provider));
      const hashing = {
        hash: provider.hash.bind(provider),
        verify,
        needsRehash: provider.needsRehash.bind(provider),
        rehashVerified: provider.rehashVerified.bind(provider),
      };
      const verifier = await CredentialVerifier.create(base.repo, hashing);
      for (const id of [base.id, fresh()])
        expect(await verifier.verifyCredential({ identifier: id, secret: secretA })).toEqual({
          status: 'REJECTED',
        });
      expect(verify).toHaveBeenCalledTimes(2);
    });
    it('real/dummy KDF timing samples on CI runtime (distribution evidence, NOT overall constant-time)', async () => {
      const base = await seed(),
        verifier = await CredentialVerifier.create(base.repo, provider);
      // Explicit approved legacy fixture, not a lowered production/test default policy.
      const legacyBase = await seed(false);
      const legacyHandle = issueVerifier(
        await hash(secretA, { ...PASSWORD_HASH_POLICY, memoryCost: 19456, timeCost: 2 }),
      );
      await legacyBase.repo.createPassword(
        legacyBase.id,
        legacyBase.credential,
        legacyHandle,
        instant(1000),
        audit,
      );
      const legacyVerifier = await CredentialVerifier.create(legacyBase.repo, provider);
      const samples = { real: [] as number[], dummy: [] as number[], legacy: [] as number[] };
      for (let i = 0; i < 5; i++)
        for (const kind of ['real', 'dummy', 'legacy'] as const) {
          const start = performance.now();
          const adapter = kind === 'legacy' ? legacyVerifier : verifier;
          const identifier =
            kind === 'legacy' ? legacyBase.id : kind === 'real' ? base.id : fresh();
          expect((await adapter.verifyCredential({ identifier, secret: secretB })).status).toBe(
            'REJECTED',
          );
          samples[kind].push(performance.now() - start);
        }
      for (const kind of ['real', 'dummy', 'legacy'] as const) {
        const sorted = samples[kind].sort((a, b) => a - b);
        console.info(
          `1B-5B ${kind} KDF samples n=5 p50=${sorted[2].toFixed(1)}ms max=${sorted[4].toFixed(1)}ms; no constant-time claim`,
        );
      }
    });
    it('CRED-PG11 User disabled rejects real correct password; restore does not revive terminal credential', async () => {
      const base = await seed();
      const disabled = await base.control.save(
        base.user.value.disable(instant(2000), 'security-test'),
        base.user.revision,
      );
      const verifier = await CredentialVerifier.create(base.repo, provider);
      expect(await verifier.verifyCredential({ identifier: base.id, secret: secretA })).toEqual({
        status: 'REJECTED',
      });
      await base.repo.revokePassword(
        base.id,
        repositoryRevision('1'),
        base.credential,
        instant(2000),
        audit,
      );
      await base.control.save(disabled.value.restore(instant(3000)), disabled.revision);
      expect(await verifier.verifyCredential({ identifier: base.id, secret: secretA })).toEqual({
        status: 'REJECTED',
      });
    });
    it('current User disabled BETWEEN crypto and final validation fails closed', async () => {
      const base = await seed();
      const hashing = {
        hash: provider.hash.bind(provider),
        verify: async (secret: string, handle: PasswordVerifierHandle) => {
          const valid = await provider.verify(secret, handle);
          await base.control.save(
            base.user.value.disable(instant(2000), 'during-verification'),
            base.user.revision,
          );
          return valid;
        },
        needsRehash: provider.needsRehash.bind(provider),
        rehashVerified: provider.rehashVerified.bind(provider),
      };
      const verifier = await CredentialVerifier.create(base.repo, hashing);
      expect(await verifier.verifyCredential({ identifier: base.id, secret: secretA })).toEqual({
        status: 'REJECTED',
      });
    });
    it('CRED-PG12–16 atomic replace: old cleared/unusable, new valid, revision and epoch each +1', async () => {
      const base = await seed(),
        next = fresh();
      expect(
        await base.repo.replacePassword(
          base.id,
          repositoryRevision('1'),
          base.credential,
          next,
          handleB,
          instant(2000),
          audit,
        ),
      ).toMatchObject({
        revision: '2',
        value: { securityEpoch: '2', activeCredentialId: next, generation: '2' },
      });
      const verifier = await CredentialVerifier.create(base.repo, provider);
      expect(
        (await verifier.verifyCredential({ identifier: base.id, secret: secretA })).status,
      ).toBe('REJECTED');
      expect(
        (await verifier.verifyCredential({ identifier: base.id, secret: secretB })).status,
      ).toBe('VERIFIED');
      expect((await state(base.id)).history).toMatchObject([
        {
          credential_id: base.credential,
          status: 'REPLACED',
          cleared: true,
          replaced_by_credential_id: next,
        },
        { credential_id: next, status: 'ACTIVE', cleared: false },
      ]);
    });
    it('CRED-PG17 stale replace rejected; revoked true no-op only current revision', async () => {
      const base = await seed();
      await base.repo.revokePassword(
        base.id,
        repositoryRevision('1'),
        base.credential,
        instant(2000),
        audit,
      );
      const before = await state(base.id);
      await expect(
        base.repo.replacePassword(
          base.id,
          repositoryRevision('1'),
          null,
          fresh(),
          handleB,
          instant(3000),
          audit,
        ),
      ).rejects.toMatchObject({ code: 'STALE_WRITE' });
      await expect(
        base.repo.revokePassword(base.id, repositoryRevision('1'), null, instant(3000), audit),
      ).rejects.toMatchObject({ code: 'STALE_WRITE' });
      expect(
        (
          await base.repo.revokePassword(
            base.id,
            repositoryRevision('2'),
            null,
            instant(3000),
            audit,
          )
        ).revision,
      ).toBe('2');
      expect(await state(base.id)).toEqual(before);
    });
    it('CRED-PG18 two real replacements exactly one success, one stale, revision/epoch +1 not +2', async () => {
      const base = await seed(),
        b = pool(),
        ids = [fresh(), fresh()];
      const result = await race(
        base.id,
        base.auth,
        b,
        () =>
          base.repo.replacePassword(
            base.id,
            repositoryRevision('1'),
            base.credential,
            ids[0],
            handleA,
            instant(2000),
            audit,
          ),
        () =>
          new PostgresCredentialRepository(b).replacePassword(
            base.id,
            repositoryRevision('1'),
            base.credential,
            ids[1],
            handleB,
            instant(2000),
            audit,
          ),
      );
      expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
      const lost = result.find((row) => row.status === 'rejected');
      expect(lost?.status === 'rejected' && lost.reason).toMatchObject({ code: 'STALE_WRITE' });
      const winner = result.findIndex((row) => row.status === 'fulfilled');
      const stored = await state(base.id);
      expect(stored.slot[0]).toMatchObject({
        repository_revision: '2',
        security_epoch: '2',
        generation: '2',
        active_credential_id: ids[winner],
      });
      expect(stored.history).toMatchObject([
        {
          credential_id: base.credential,
          status: 'REPLACED',
          cleared: true,
          replaced_by_credential_id: ids[winner],
        },
        { credential_id: ids[winner], status: 'ACTIVE', cleared: false, generation: '2' },
      ]);
      expect(stored.history).toHaveLength(2);
      const verifier = await CredentialVerifier.create(base.repo, provider);
      expect(
        (
          await verifier.verifyCredential({
            identifier: base.id,
            secret: winner === 0 ? secretA : secretB,
          })
        ).status,
      ).toBe('VERIFIED');
      expect(
        (
          await verifier.verifyCredential({
            identifier: base.id,
            secret: winner === 0 ? secretB : secretA,
          })
        ).status,
      ).toBe('REJECTED');
    });
    for (const prefix of [
      'UPDATE zhiban_identity.credential_slots',
      'UPDATE zhiban_identity.credentials',
      'INSERT INTO zhiban_identity.credentials',
      'INSERT INTO zhiban_identity.audit_events',
    ]) {
      it(`CRED-PG19/25 controlled REAL SQL failure after ${prefix}: whole aggregate/audit rollback`, async () => {
        const base = await seed(),
          before = await state(base.id);
        await expect(
          new PostgresCredentialRepository(injected(base.auth, prefix)).replacePassword(
            base.id,
            repositoryRevision('1'),
            base.credential,
            fresh(),
            handleB,
            instant(2000),
            audit,
          ),
        ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
        expect(await state(base.id)).toEqual(before);
      });
    }
    it('CRED-PG20/21 revoke clears verifier, increments epoch, authentication rejects', async () => {
      const base = await seed();
      expect(
        await base.repo.revokePassword(
          base.id,
          repositoryRevision('1'),
          base.credential,
          instant(2000),
          audit,
        ),
      ).toMatchObject({ revision: '2', value: { securityEpoch: '2', activeCredentialId: null } });
      const verifier = await CredentialVerifier.create(base.repo, provider);
      expect(
        (await verifier.verifyCredential({ identifier: base.id, secret: secretA })).status,
      ).toBe('REJECTED');
      expect((await state(base.id)).history[0]).toMatchObject({ status: 'REVOKED', cleared: true });
    });
    it('revoke plus real audit failure rolls back status/pointer/epoch/revision together', async () => {
      const base = await seed(),
        before = await state(base.id);
      await expect(
        new PostgresCredentialRepository(
          injected(base.auth, 'INSERT INTO zhiban_identity.audit_events'),
        ).revokePassword(base.id, repositoryRevision('1'), base.credential, instant(2000), audit),
      ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      expect(await state(base.id)).toEqual(before);
    });
    it('CRED-PG22 terminal history cannot revive; reuse old ID rejected; fresh replacement allowed', async () => {
      const base = await seed();
      await base.repo.revokePassword(
        base.id,
        repositoryRevision('1'),
        base.credential,
        instant(2000),
        audit,
      );
      const client = runtimeClient('zhiban_auth_runtime');
      await client.connect();
      try {
        await expectDenied(
          client,
          "UPDATE zhiban_identity.credentials SET status='ACTIVE' WHERE credential_id=$1",
          [base.credential],
        );
      } finally {
        await client.end();
      }
      await expect(
        base.repo.replacePassword(
          base.id,
          repositoryRevision('2'),
          null,
          base.credential,
          handleB,
          instant(3000),
          audit,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(
        (
          await base.repo.replacePassword(
            base.id,
            repositoryRevision('2'),
            null,
            fresh(),
            handleB,
            instant(3000),
            audit,
          )
        ).value.securityEpoch,
      ).toBe('3');
    });
    for (const field of ['repository_revision', 'security_epoch'] as const) {
      it(`CRED-PG23/24 ${field} maximum fails closed without overflow or partial write`, async () => {
        const base = await seed();
        const admin = adminClient();
        await admin.connect();
        try {
          // Administrator-only fixture setup, never used for the runtime operation.
          await admin.query('BEGIN');
          await admin.query("SET LOCAL session_replication_role='replica'");
          await admin.query(
            `UPDATE zhiban_identity.credential_slots SET ${field}=9223372036854775807 WHERE user_id=$1`,
            [base.id],
          );
          if (field === 'repository_revision')
            await admin.query(
              'UPDATE zhiban_identity.credentials SET slot_revision=9223372036854775807 WHERE user_id=$1',
              [base.id],
            );
          await admin.query('COMMIT');
        } finally {
          await admin.end();
        }
        const before = await state(base.id);
        await expect(
          base.repo.revokePassword(
            base.id,
            repositoryRevision(field === 'repository_revision' ? '9223372036854775807' : '1'),
            base.credential,
            instant(2000),
            audit,
          ),
        ).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
        expect(await state(base.id)).toEqual(before);
      });
    }
    it('CRED-PG26 closed audit payload rejects verifier injection and remains GLOBAL/auth-only', async () => {
      const base = await seed();
      const events = (await state(base.id)).audit;
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        event_type: 'CREDENTIAL_CREATED',
        event_scope: 'GLOBAL',
        event_payload: {
          credentialId: base.credential,
          repositoryRevisionAfter: '1',
          securityEpochAfter: '1',
        },
      });
      const client = runtimeClient('zhiban_auth_runtime');
      await client.connect();
      try {
        for (const payload of [
          {
            credentialId: base.credential,
            repositoryRevisionAfter: '1',
            securityEpochAfter: '1',
            verifier: 'forbidden-test-marker',
          },
          { credentialId: base.credential, repositoryRevisionAfter: '1', securityEpochAfter: 1 },
          { credentialId: base.credential, repositoryRevisionAfter: 1, securityEpochAfter: '1' },
        ])
          await expectDenied(
            client,
            "INSERT INTO zhiban_identity.audit_events(event_shape_version,event_type,event_scope,occurred_at,actor_type,request_id,reason,subject_user_id,event_payload) VALUES(1,'CREDENTIAL_CREATED','GLOBAL',1000,'SYSTEM',NULL,'SECURITY_POLICY',$1,$2::jsonb)",
            [base.id, JSON.stringify(payload)],
          );
      } finally {
        await client.end();
      }
    });
    it('CRED-PG27 malformed PHC accepted by coarse DB shape still fails private runtime mapper', async () => {
      const base = await seed();
      const client = runtimeClient('zhiban_auth_runtime');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE zhiban_identity.credential_slots SET repository_revision=2 WHERE user_id=$1',
          [base.id],
        );
        await client.query(
          'UPDATE zhiban_identity.credentials SET slot_revision=2, verifier_material=$1 WHERE user_id=$2',
          [
            '$argon2id$v=19$m=32768,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAB$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
            base.id,
          ],
        );
        await client.query('COMMIT');
      } finally {
        await client.end();
      }
      await expect(base.repo.findSlot(base.id)).rejects.toMatchObject({
        code: 'INTEGRITY_FAILURE',
      });
    });
    it('CRED-PG30 max=1 pool physical reuse, no tenant GUC, released after failures and success', async () => {
      const base = await seed(),
        beforePid = await pid(base.auth);
      await expect(
        base.repo.revokePassword(
          base.id,
          repositoryRevision('99'),
          base.credential,
          instant(2000),
          audit,
        ),
      ).rejects.toMatchObject({ code: 'STALE_WRITE' });
      expect(await pid(base.auth)).toBe(beforePid);
      const client = await base.auth.connect();
      try {
        expect(
          (
            await client.query(
              "SELECT current_user, current_setting('app.tenant_id',true) AS tenant",
            )
          ).rows[0],
        ).toEqual({ current_user: 'zhiban_auth_runtime', tenant: null });
      } finally {
        client.release();
      }
      expect((await base.repo.findSlot(base.id))?.revision).toBe('1');
    });
    it('real technical rehash advances ONLY revision, never epoch or identity', async () => {
      const base = await seed(false);
      const legacy = issueVerifier(
        await hash(secretA, { ...PASSWORD_HASH_POLICY, memoryCost: 19456, timeCost: 2 }),
      );
      await base.repo.createPassword(base.id, base.credential, legacy, instant(1000), audit);
      const proof = await provider.rehashVerified(secretA, legacy);
      expect(proof).not.toBeNull();
      expect(
        await base.repo.rehashPassword(
          base.id,
          repositoryRevision('1'),
          base.credential,
          proof!,
          instant(2000),
          audit,
        ),
      ).toMatchObject({
        revision: '2',
        value: { securityEpoch: '1', activeCredentialId: base.credential, generation: '1' },
      });
      expect((await state(base.id)).history).toHaveLength(1);
    });
    it('real revoke vs replacement race linearizes through one permanent slot', async () => {
      const base = await seed(),
        other = pool();
      const result = await race(
        base.id,
        base.auth,
        other,
        () =>
          base.repo.revokePassword(
            base.id,
            repositoryRevision('1'),
            base.credential,
            instant(2000),
            audit,
          ),
        () =>
          new PostgresCredentialRepository(other).replacePassword(
            base.id,
            repositoryRevision('1'),
            base.credential,
            fresh(),
            handleB,
            instant(2000),
            audit,
          ),
      );
      expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
      const loser = result.find((row) => row.status === 'rejected');
      expect(loser?.status === 'rejected' && loser.reason).toMatchObject({ code: 'STALE_WRITE' });
      expect((await state(base.id)).slot[0]).toMatchObject({
        repository_revision: '2',
        security_epoch: '2',
      });
    });
    it('rehash prepared before replacement cannot revive or overwrite the old generation', async () => {
      const base = await seed(false),
        legacy = issueVerifier(
          await hash(secretA, { ...PASSWORD_HASH_POLICY, memoryCost: 19456, timeCost: 2 }),
        );
      await base.repo.createPassword(base.id, base.credential, legacy, instant(1000), audit);
      const proof = await provider.rehashVerified(secretA, legacy);
      expect(proof).not.toBeNull();
      await base.repo.replacePassword(
        base.id,
        repositoryRevision('1'),
        base.credential,
        fresh(),
        handleB,
        instant(2000),
        audit,
      );
      const before = await state(base.id);
      await expect(
        base.repo.rehashPassword(
          base.id,
          repositoryRevision('1'),
          base.credential,
          proof!,
          instant(3000),
          audit,
        ),
      ).rejects.toMatchObject({ code: 'STALE_WRITE' });
      expect(await state(base.id)).toEqual(before);
    });
    it('replacement DURING real KDF invalidates final authentication decision', async () => {
      const base = await seed();
      const hashing = {
        hash: provider.hash.bind(provider),
        verify: async (secret: string, handle: PasswordVerifierHandle) => {
          const valid = await provider.verify(secret, handle);
          await base.repo.replacePassword(
            base.id,
            repositoryRevision('1'),
            base.credential,
            fresh(),
            handleB,
            instant(2000),
            audit,
          );
          return valid;
        },
        needsRehash: provider.needsRehash.bind(provider),
        rehashVerified: provider.rehashVerified.bind(provider),
      };
      expect(
        await (
          await CredentialVerifier.create(base.repo, hashing)
        ).verifyCredential({ identifier: base.id, secret: secretA }),
      ).toEqual({ status: 'REJECTED' });
    });
    it('direct verifier rewrite without parent revision CAS fails at the database boundary', async () => {
      const base = await seed(),
        client = runtimeClient('zhiban_auth_runtime');
      await client.connect();
      try {
        await expectDenied(
          client,
          'UPDATE zhiban_identity.credentials SET updated_at=2000 WHERE credential_id=$1',
          [base.credential],
        );
      } finally {
        await client.end();
      }
    });
    it('deferred aggregate constraint blocks COMMIT of an empty/orphan initial slot', async () => {
      const base = await seed(false),
        client = runtimeClient('zhiban_auth_runtime');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "INSERT INTO zhiban_identity.credential_slots(user_id,credential_type,active_credential_id,generation,repository_revision,security_epoch,created_at,updated_at) VALUES($1,'PASSWORD',NULL,1,1,1,1000,1000)",
          [base.id],
        );
        await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
      } finally {
        await client.query('ROLLBACK');
        await client.end();
      }
      expect(await base.repo.findSlot(base.id)).toBeNull();
    });
    // Real 40001/40P01 originate in the existing pg16-repository-signoff suite, run in BOTH workflow passes.
  });
import { syntheticPasswordScreening } from '../credentials/fixture-policy';
