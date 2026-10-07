import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Pool, Client } from 'pg';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  configured,
  adminClient,
  verifyPg16,
  prepareSchema,
  insertBaseFixtures,
  runtimePool,
  ids,
  resetDisposableIdentity,
  runtimeClient,
} from './pg16-harness';
import { PgRuntimeFixture, bindingFields } from '../../runtime/pg-store';
import { pendingBinding } from '../../runtime/fakes';
import { sharedRuntimeContract } from '../../runtime/shared-contract';
import { RuntimeProtocol } from '@/lib/zhiban/infrastructure/openmaic/runtime/protocol';
import { RuntimeDeadline } from '@/lib/zhiban/infrastructure/openmaic/runtime/admission';
import {
  allocateId,
  allocateRef,
  RuntimeFailure,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';
import type { RuntimeBinding } from '@/lib/zhiban/infrastructure/openmaic/runtime/records';
import { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  SharedAdmission,
  purposes,
  type AdmissionConfig,
} from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { SessionCsrfPolicy } from '@/lib/zhiban/infrastructure/identity/sessions/browser-security';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { syntheticPasswordScreening } from '../credentials/fixture-policy';
import {
  newApprovedSession,
  DEFAULT_SESSION_POLICY,
  bearerForCookie,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { credentialId } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { instant, userId } from '@/lib/zhiban/domain/identity';
import type { PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';

const required = process.env.C9_PG16_REQUIRED === '1';
if (required && !configured) throw Error('C9 PG16 URL required');
const schema = 'zhiban_runtime_contract_test';
async function admin<T>(body: (c: Client) => Promise<T>) {
  const c = adminClient();
  await c.connect();
  try {
    return await body(c);
  } finally {
    await c.end();
  }
}
const query = async (sql: string, args?: unknown[]) =>
  (await admin((c) => c.query(sql, args))).rows;
describe
  .skipIf(!required)
  .sequential('C9-I authentic Identity and disposable Runtime contract', () => {
    const pools: Pool[] = [];
    let verifier: PasswordVerifierHandle;
    function pool(role: 'zhiban_bridge_runtime' | 'zhiban_auth_runtime') {
      const p = runtimePool(role);
      p.options.max = 2;
      p.options.connectionTimeoutMillis = 1000;
      pools.push(p);
      return p;
    }
    beforeAll(async () => {
      console.info(`C9 REAL server_version: ${await verifyPg16()}`);
      const path = process.env.C9_PROVIDER_RECEIPT;
      if (!path) throw Error('C9 provider receipt required');
      execFileSync(process.execPath, [
        'tests/zhiban/runtime/prepare-provider.mjs',
        '--verify',
        path,
      ]);
      const proof = JSON.parse(await readFile(path, 'utf8'));
      expect(proof).toMatchObject({
        head:
          process.env.ZB_PG16_EXECUTION_MODE === 'LOCAL'
            ? process.env.ZB_PG16_EXPECTED_HEAD
            : process.env.GITHUB_SHA,
        executionMode: process.env.ZB_PG16_EXECUTION_MODE === 'LOCAL' ? 'LOCAL' : 'GITHUB_ACTIONS',
        official: '1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce',
        platform: 'linux',
        architecture: 'x64',
        runtimeProtocol: '0.1.0',
      });
      expect(process.version).toMatch(/^v22\./);
      const artifact = new URL(import.meta.resolve('@openmaic/storage/runtime/pg'));
      const bytes = await readFile(artifact);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(proof.artifactDigest);
      verifier = await new Argon2PasswordHasher(syntheticPasswordScreening).hash(
        'Synthetic-C9-PG16-password!',
      );
    });
    beforeEach(async () => {
      await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await prepareSchema();
      await insertBaseFixtures();
      const sql = await readFile(new URL('../../runtime/schema.sql', import.meta.url), 'utf8');
      await admin(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(sql);
          await c.query('COMMIT');
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        }
      });
    });
    afterEach(async () => {
      const cleanup = await Promise.allSettled(pools.map((p) => p.end()));
      pools.length = 0;
      await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      expect(cleanup.every((r) => r.status === 'fulfilled')).toBe(true);
    });
    afterAll(async () => {
      await resetDisposableIdentity();
    });
    async function fixture() {
      const authPool = pool('zhiban_auth_runtime'),
        credentials = new PostgresCredentialRepository(authPool),
        sessions = new PostgresSessionRepository(authPool),
        hasher = new Argon2PasswordHasher(syntheticPasswordScreening);
      await credentials.createPassword(
        userId(ids.userA),
        credentialId(allocateId()),
        verifier,
        instant(Date.now()),
        { actor: { kind: 'SYSTEM' }, requestId: null, reason: 'SECURITY_POLICY' },
      );
      const snapshot = (await credentials.verificationSnapshot(userId(ids.userA)))!;
      const issued = newApprovedSession(
        snapshot,
        repositoryRevision('1'),
        instant(Date.now()),
        DEFAULT_SESSION_POLICY,
      );
      await sessions.create(issued.record);
      const admission = new SharedAdmission(authPool, {
        environment: 'synthetic',
        approvalRef: 'synthetic',
        hmacKey: new Uint8Array(32).fill(7),
        policyDigests: Object.fromEntries(
          purposes.map((p) => [p, 'a'.repeat(64)]),
        ) as AdmissionConfig['policyDigests'],
      });
      const auth = await IdentityAuthentication.create(
        authPool,
        sessions,
        credentials,
        hasher,
        admission,
        new SessionCsrfPolicy('https://synthetic.invalid'),
        new IdentityIds(),
      );
      const handle = await auth.authenticate(bearerForCookie(issued.bearer));
      expect(handle).not.toBeNull();
      const template = pendingBinding();
      template.tenantId = ids.tenantA;
      template.learnerMembershipId = ids.membershipA;
      const stage = allocateRef();
      await query(`INSERT INTO ${schema}.resources VALUES($1,$2,$3,$4,'ENABLED')`, [
        template.tenantId,
        template.slotId,
        template.generationId,
        stage,
      ]);
      await query(`INSERT INTO ${schema}.attempts VALUES($1,$2,$3,$4,$5,'ACTIVE')`, [
        template.tenantId,
        template.attemptId,
        template.slotId,
        template.generationId,
        template.learnerMembershipId,
      ]);
      const actor = {
        userId: ids.userA,
        membershipId: ids.membershipA,
        authorizationVersion: 0,
        requestId: 'synthetic-c9-pg',
      };
      const store = new PgRuntimeFixture(
        pool('zhiban_bridge_runtime'),
        template,
        auth.bridgeSecurity(),
        handle!,
      );
      return {
        store,
        template,
        actor,
        credentials,
        sessions,
        issued,
        auth,
        binding: async () => {
          const rows = await query(
            `SELECT * FROM ${schema}.runtime_bindings WHERE runtime_binding_id=$1`,
            [template.bindingId],
          );
          if (!rows.length) return null;
          const r = rows[0];
          return {
            revision: String(r.repository_revision),
            status: r.status,
            outstandingOperationId: r.outstanding_operation_id,
            recordCount: Number(r.record_count),
            recordBytes: Number(r.record_bytes),
            lastSeq: r.expected_last_seq === null ? null : Number(r.expected_last_seq),
          } as RuntimeBinding;
        },
        events: () =>
          query(
            `SELECT * FROM ${schema}.runtime_audit_events ORDER BY occurred_at,operation_revision`,
          ),
      };
    }
    sharedRuntimeContract('C9 PG adapter shared persistence', fixture);
    it('C9-I01 applied inventory/gate stays closed; no production Runtime table', async () => {
      expect(
        (await query('SELECT count(*)::int AS n FROM zhiban_identity.schema_migrations'))[0].n,
      ).toBe(13);
      expect(
        (await query('SELECT zhiban_bridge.business_resource_ready(NULL,NULL) AS ready'))[0].ready,
      ).toBe(false);
      expect(
        (
          await query(
            "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname IN ('zhiban_identity','zhiban_bridge') AND tablename IN ('runtime_bindings','runtime_operations','runtime_audit_events')",
          )
        )[0].n,
      ).toBe(0);
    });
    it('C9-I02 every fixture table has FORCE RLS and closed capabilities', async () => {
      const rows = await query(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'",
        [schema],
      );
      expect(rows).toHaveLength(6);
      expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
      expect(
        (
          await query(
            `SELECT has_table_privilege('zhiban_bridge_runtime','${schema}.resources','UPDATE') AS update,has_table_privilege('zhiban_bridge_runtime','${schema}.runtime_audit_events','UPDATE,DELETE') AS audit`,
          )
        )[0],
      ).toEqual({ update: false, audit: false });
      const publicAcl = (
        await query(
          `SELECT
        (SELECT count(*) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname=$1 AND a.grantee=0)::int AS schema,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname=$1 AND a.grantee=0)::int AS tables,
        (SELECT count(*) FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE n.nspname=$1 AND a.grantee=0)::int AS columns,
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname=$1 AND a.grantee=0)::int AS functions`,
          [schema],
        )
      )[0];
      expect(publicAcl).toEqual({ schema: 0, tables: 0, columns: 0, functions: 0 });
      expect(
        (
          await query(
            `SELECT has_column_privilege('zhiban_bridge_runtime','${schema}.runtime_bindings','runtime_ref','UPDATE') AS native_ref,has_column_privilege('zhiban_bridge_runtime','${schema}.runtime_operations','intent_digest','UPDATE') AS intent,has_table_privilege('zhiban_bridge_runtime','${schema}.runtime_bindings','UPDATE,DELETE,TRUNCATE') AS broad,has_function_privilege('zhiban_bridge_runtime','${schema}.runtime_parent_context(uuid,uuid,uuid,uuid,uuid)','EXECUTE') AS parent`,
          )
        )[0],
      ).toEqual({ native_ref: false, intent: false, broad: false, parent: true });
    });
    it.each(['zhiban_runtime', 'zhiban_auth_runtime', 'zhiban_control_runtime'] as const)(
      'C9-I03 %s has no fixture access',
      async (role) => {
        const c = runtimeClient(role);
        await c.connect();
        try {
          await expect(c.query(`SELECT * FROM ${schema}.runtime_bindings`)).rejects.toMatchObject({
            code: '42501',
          });
        } finally {
          await c.end();
        }
      },
    );
    it('C9-I04 missing context/foreign tenant sees no local bindings or parents', async () => {
      await fixture();
      const c = runtimeClient('zhiban_bridge_runtime');
      await c.connect();
      try {
        await c.query('BEGIN');
        expect((await c.query(`SELECT * FROM ${schema}.resources`)).rows).toHaveLength(0);
        await c.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantB]);
        expect((await c.query(`SELECT * FROM ${schema}.resources`)).rows).toHaveLength(0);
      } finally {
        await c.query('ROLLBACK');
        await c.end();
      }
    });
    it('C9-I05 same-transaction audit failure rolls back binding + reservation', async () => {
      const f = await fixture();
      await query(
        `CREATE FUNCTION ${schema}.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$`,
      );
      await query(
        `CREATE TRIGGER fail_audit BEFORE INSERT ON ${schema}.runtime_audit_events FOR EACH ROW EXECUTE FUNCTION ${schema}.fail_audit()`,
      );
      let calls = 0;
      const p = new RuntimeProtocol(f.store, {
        dispatch: async () => {
          calls++;
        },
      });
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ status: 'FAILED' });
      expect(await f.binding()).toBeNull();
      expect(await f.events()).toHaveLength(0);
      expect(calls).toBe(0);
    });
    it('C9-I06 current authVersion cannot be advanced by caller to reuse reserved intent', async () => {
      const f = await fixture();
      await query(
        'UPDATE zhiban_identity.memberships SET authorization_version=authorization_version+1,repository_revision=repository_revision+1 WHERE membership_id=$1',
        [ids.membershipA],
      );
      const p = new RuntimeProtocol(f.store, {
        dispatch: async () => {
          throw Error('Forbidden');
        },
      });
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ status: 'FAILED' });
      expect(await f.binding()).toBeNull();
    });
    it('C9-I07 secret-free audit contains only approved metadata', async () => {
      const f = await fixture(),
        p = new RuntimeProtocol(f.store, { dispatch: async () => {} });
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      });
      await p.execute('APPEND_USER_RECORD', f.actor, f.template.bindingId, '3', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
        content: 'sentinel-private-content',
        sceneBindingId: null,
      });
      const events = await f.events(),
        json = JSON.stringify(events);
      expect(events).toHaveLength(6);
      for (const forbidden of [
        'sentinel-private',
        f.template.runtimeRef,
        f.template.learnerHandle,
        'token',
        'digest',
        'verifier',
        'payload',
      ])
        expect(json.includes(forbidden)).toBe(false);
    });
    it('C9-I08 malformed persisted mapper row fails closed', async () => {
      const f = await fixture(),
        p = new RuntimeProtocol(f.store, { dispatch: async () => {} });
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      });
      await query(`ALTER TABLE ${schema}.runtime_bindings DISABLE TRIGGER USER`);
      await query(
        `UPDATE ${schema}.runtime_bindings SET runtime_ref=$2 WHERE runtime_binding_id=$1`,
        [f.template.bindingId, 'A'.repeat(42) + 'B'],
      );
      await query(`ALTER TABLE ${schema}.runtime_bindings ENABLE TRIGGER USER`);
      expect(
        await p.execute('COMPLETE_RUNTIME', f.actor, f.template.bindingId, '3', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ status: 'FAILED' });
    });
    it('C9-I09 max revision cannot reserve a dispatch', async () => {
      const f = await fixture(),
        p = new RuntimeProtocol(f.store, { dispatch: async () => {} });
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      });
      await query(`ALTER TABLE ${schema}.runtime_bindings DISABLE TRIGGER USER`);
      await query(
        `UPDATE ${schema}.runtime_bindings SET repository_revision=9223372036854775807 WHERE runtime_binding_id=$1`,
        [f.template.bindingId],
      );
      await query(`ALTER TABLE ${schema}.runtime_bindings ENABLE TRIGGER USER`);
      expect(
        await p.execute('COMPLETE_RUNTIME', f.actor, f.template.bindingId, '9223372036854775807', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ status: 'FAILED' });
      expect((await f.binding())?.revision).toBe('9223372036854775807');
    });
    it('C9-I10 terminal native state cannot revive via direct SQL', async () => {
      const f = await fixture(),
        p = new RuntimeProtocol(f.store, { dispatch: async () => {} });
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      });
      await p.execute('ARCHIVE_RUNTIME', f.actor, f.template.bindingId, '3', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      });
      await expect(
        f.store.transaction(f.actor, f.template.bindingId, new RuntimeDeadline(), async (tx) => {
          const b = await tx.load();
          b.status = 'ACTIVE';
          b.revision = '6';
          await tx.saveBinding(b);
        }),
      ).rejects.toThrow(RuntimeFailure);
      expect((await f.binding())?.status).toBe('ARCHIVED');
    });
    it('C9-I11 parent lock actually waits behind acknowledged independent revocation', async () => {
      const f = await fixture(),
        holder = adminClient(),
        observer = adminClient();
      await holder.connect();
      await observer.connect();
      let result: Promise<unknown> | undefined;
      try {
        await holder.query('BEGIN');
        await holder.query(`UPDATE ${schema}.attempts SET state='REVOKED' WHERE attempt_id=$1`, [
          f.template.attemptId,
        ]);
        const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        result = new RuntimeProtocol(f.store, {
          dispatch: async () => {
            throw Error('Forbidden');
          },
        }).execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        });
        const until = performance.now() + 900;
        let blocked = false;
        while (performance.now() < until) {
          const r = await observer.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.usename='zhiban_bridge_runtime' AND $1=ANY(pg_blocking_pids(a.pid))) AS blocked",
            [pid],
          );
          if (r.rows[0].blocked) {
            blocked = true;
            break;
          }
        }
        expect(blocked).toBe(true);
        await holder.query('COMMIT');
        expect(await result).toMatchObject({ status: 'FAILED' });
        expect(await f.binding()).toBeNull();
      } finally {
        await holder.query('ROLLBACK');
        await Promise.allSettled([holder.end(), observer.end(), ...(result ? [result] : [])]);
      }
    });
    it('C9-I12 guard rejects an acknowledged expired Session fixture', async () => {
      const f = await fixture();
      let dispatched = false;
      const p = new RuntimeProtocol(f.store, {
        dispatch: async (_b, _op, _stage, _payload, _scene, _deadline, authority) => {
          dispatched = true;
          await authority();
        },
      });
      // Explicit test-only clock fixture, not a production expiry-shortening operation.
      await query('ALTER TABLE zhiban_identity.sessions DISABLE TRIGGER USER');
      try {
        await query(
          'UPDATE zhiban_identity.sessions SET absolute_expires_at=last_seen_at+1,idle_expires_at=last_seen_at+1 WHERE session_id=$1',
          [f.issued.record.id],
        );
      } finally {
        await query('ALTER TABLE zhiban_identity.sessions ENABLE TRIGGER USER');
      }
      expect(
        (
          await query(
            'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint>=idle_expires_at AS expired FROM zhiban_identity.sessions WHERE session_id=$1',
            [f.issued.record.id],
          )
        )[0].expired,
      ).toBe(true);
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ status: 'FAILED' });
      expect(dispatched).toBe(false);
    });
    it.each([
      'replace',
      'credential-revoke',
      'logout',
      'user',
      'tenant',
      'membership',
      'grant',
    ] as const)(
      'C9-I14 acknowledged %s writer serializes against dispatch and denies subsequent use',
      async (kind) => {
        const f = await fixture(),
          observer = adminClient();
        await observer.connect();
        let ready!: () => void, release!: () => void;
        const held = new Promise<void>((r) => {
            ready = r;
          }),
          gate = new Promise<void>((r) => {
            release = r;
          });
        let writer: Client | undefined, mutation: Promise<unknown> | undefined;
        const p = new RuntimeProtocol(f.store, {
          dispatch: async (_b, _op, _stage, _payload, _scene, _deadline, authority) => {
            await authority();
            ready();
            await gate;
            await authority();
          },
        });
        const running = p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        });
        try {
          await Promise.race([
            held,
            running.then(() => {
              throw Error('Holder failed before barrier');
            }),
          ]);
          const pid = (
            await observer.query(
              "SELECT pid FROM pg_stat_activity WHERE usename='zhiban_bridge_runtime' AND state='idle in transaction' ORDER BY pid",
            )
          ).rows[0]?.pid;
          expect(typeof pid).toBe('number');
          const audit = {
            actor: { kind: 'SYSTEM' as const },
            requestId: null,
            reason: 'SECURITY_POLICY' as const,
          };
          if (kind === 'replace' || kind === 'credential-revoke') {
            const slot = (await f.credentials.findSlot(userId(ids.userA)))!;
            mutation =
              kind === 'replace'
                ? f.credentials.replacePassword(
                    userId(ids.userA),
                    slot.revision,
                    slot.value.activeCredentialId,
                    credentialId(allocateId()),
                    verifier,
                    instant(Date.now()),
                    audit,
                  )
                : f.credentials.revokePassword(
                    userId(ids.userA),
                    slot.revision,
                    slot.value.activeCredentialId,
                    instant(Date.now()),
                    audit,
                  );
          } else if (kind === 'logout')
            mutation = f.sessions.revokeAllForUser(userId(ids.userA), instant(Date.now()));
          else {
            writer = runtimeClient(
              kind === 'user' || kind === 'tenant' ? 'zhiban_control_runtime' : 'zhiban_runtime',
            );
            await writer.connect();
            await writer.query('BEGIN');
            await writer.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantA]);
            const sql =
              kind === 'user'
                ? "UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=$1,disabled_reason='synthetic',updated_at=$1,repository_revision=repository_revision+1 WHERE user_id=$2"
                : kind === 'tenant'
                  ? "UPDATE zhiban_identity.tenants SET status='DISABLED',disabled_at=$1,disabled_reason='synthetic',updated_at=$1,repository_revision=repository_revision+1 WHERE tenant_id=$2"
                  : kind === 'membership'
                    ? "UPDATE zhiban_identity.memberships SET status='DISABLED',disabled_at=$1,disabled_reason='synthetic',updated_at=$1,repository_revision=repository_revision+1,authorization_version=authorization_version+1 WHERE membership_id=$2"
                    : 'UPDATE zhiban_identity.role_grants SET revoked_at=$1 WHERE grant_id=$2';
            mutation = writer.query(sql, [
              Date.now(),
              kind === 'user'
                ? ids.userA
                : kind === 'tenant'
                  ? ids.tenantA
                  : kind === 'membership'
                    ? ids.membershipA
                    : ids.grantA,
            ]);
          }
          const observed = mutation.then(
            () => true,
            () => false,
          );
          const until = performance.now() + 900;
          let blocked = false;
          while (performance.now() < until) {
            if (
              (
                await observer.query(
                  'SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid))) AS blocked',
                  [pid],
                )
              ).rows[0].blocked
            ) {
              blocked = true;
              break;
            }
          }
          expect(blocked).toBe(true);
          release();
          expect(await observed).toBe(true);
          if (writer) await writer.query('COMMIT');
          await running;
          if (kind === 'user')
            await query(
              "UPDATE zhiban_identity.users SET status='ACTIVE',disabled_at=NULL,disabled_reason=NULL,updated_at=$1,repository_revision=repository_revision+1 WHERE user_id=$2",
              [Date.now(), ids.userA],
            );
          expect(
            await p.execute(
              'CREATE_RUNTIME',
              f.actor,
              f.template.bindingId,
              (await f.binding())?.revision ?? '1',
              { idempotencyKey: allocateRef(), expectedLastSeq: null },
            ),
          ).toMatchObject({ status: 'FAILED' });
        } finally {
          release();
          if (writer) {
            await writer.query('ROLLBACK').catch(() => {});
            await writer.end();
          }
          if (mutation) await mutation.catch(() => {});
          await running;
          await observer.end();
        }
      },
    );
    it('C9-I13 pool/client cleanup and no fixture schema survives teardown contract', async () => {
      const f = await fixture();
      await f.store.transaction(
        f.actor,
        f.template.bindingId,
        new RuntimeDeadline(),
        async (tx) => {
          await tx.assertCurrent();
        },
      );
      expect(pools.every((p) => p.waitingCount === 0 && p.idleCount === p.totalCount)).toBe(true);
      expect(bindingFields.length).toBe(18);
    });
    it('C9-I15 nullable CHECK branches reject malformed tail and missing status target at database level', async () => {
      const f = await fixture(),
        p = new RuntimeProtocol(f.store, { dispatch: async () => {} });
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ status: 'SUCCEEDED' });
      await query(`ALTER TABLE ${schema}.runtime_bindings DISABLE TRIGGER USER`);
      await query(`ALTER TABLE ${schema}.runtime_operations DISABLE TRIGGER USER`);
      try {
        const tailFailure = await query(
          `UPDATE ${schema}.runtime_bindings SET record_count=1,record_bytes=1,expected_last_seq=NULL WHERE runtime_binding_id=$1`,
          [f.template.bindingId],
        ).then(
          () => 'COMMITTED',
          (e) => e.code,
        );
        expect(tailFailure).toBe('23514');
        const targetFailure = await query(
          `UPDATE ${schema}.runtime_operations SET command='COMPLETE_RUNTIME',prior_status='ACTIVE',target_status=NULL WHERE runtime_binding_id=$1`,
          [f.template.bindingId],
        ).then(
          () => 'COMMITTED',
          (e) => e.code,
        );
        expect(targetFailure).toBe('23514');
      } finally {
        await query(`ALTER TABLE ${schema}.runtime_bindings ENABLE TRIGGER USER`);
        await query(`ALTER TABLE ${schema}.runtime_operations ENABLE TRIGGER USER`);
      }
      expect(await f.binding()).toMatchObject({ revision: '3', recordCount: 0, lastSeq: null });
      expect(
        (
          await query(
            `SELECT command FROM ${schema}.runtime_operations WHERE runtime_binding_id=$1`,
            [f.template.bindingId],
          )
        )[0].command,
      ).toBe('CREATE_RUNTIME');
    });
  });
