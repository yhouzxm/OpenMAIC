import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import type { Pool, Client } from 'pg';
import { tenantId, userId, instant } from '@/lib/zhiban/domain/identity';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { credentialId } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import {
  newApprovedSession,
  DEFAULT_SESSION_POLICY,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import type { PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import {
  BridgeRepository,
  type Actor,
  type Reservation,
} from '@/lib/zhiban/infrastructure/openmaic/repository';
import {
  bridgeTransaction,
  Deadline,
  type BridgePgClient,
} from '@/lib/zhiban/infrastructure/openmaic/transactions';
import { GuardedBridgeProtocol } from '@/lib/zhiban/infrastructure/openmaic/protocol';
import { BridgeError } from '@/lib/zhiban/infrastructure/openmaic/validation';
import { planCandidate } from '@/lib/zhiban/infrastructure/openmaic/candidate';
import { preview, validateDocument } from '@/lib/zhiban/infrastructure/openmaic/content';
import type { MaicDocument } from '@openmaic/storage';
import { DSL_VERSION, type Slide } from '@openmaic/dsl';
import { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  SharedAdmission,
  purposes,
  type AdmissionConfig,
} from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { SessionCsrfPolicy } from '@/lib/zhiban/infrastructure/identity/sessions/browser-security';
import { bearerForCookie } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { membershipId } from '@/lib/zhiban/domain/identity';
import {
  adminClient,
  configured,
  ids,
  insertBaseFixtures,
  prepareSchema,
  resetDisposableIdentity,
  runtimeClient,
  runtimePool,
  verifyPg16,
  expectDenied,
} from './pg16-harness';

const context = tenantScopeContext(tenantId(ids.tenantA)),
  contextB = tenantScopeContext(tenantId(ids.tenantB));
const actor: Actor = {
  user: ids.userA,
  member: ids.membershipA,
  authorizationVersion: 0,
  requestId: 'synthetic-bridge',
};
const deployment = v7(),
  activity = v7();
const audit = {
  actor: { kind: 'SYSTEM' as const },
  requestId: null,
  reason: 'SECURITY_POLICY' as const,
};
let verifier: PasswordVerifierHandle;
describe
  .skipIf(!configured)
  .sequential('1B-9B real PG16: shipped closure and disposable synthetic contracts', () => {
    const pools: Pool[] = [];
    function pool(role: 'zhiban_bridge_runtime' | 'zhiban_auth_runtime' = 'zhiban_bridge_runtime') {
      const p = runtimePool(role);
      p.options.connectionTimeoutMillis = 1000;
      pools.push(p);
      return p;
    }
    async function admin<T>(work: (client: Client) => Promise<T>) {
      const c = adminClient();
      await c.connect();
      try {
        return await work(c);
      } finally {
        await c.end();
      }
    }
    async function query(sql: string, params?: unknown[]) {
      return admin(async (c) => (await c.query(sql, params)).rows);
    }
    async function acknowledgedRace(
      first: (client: BridgePgClient) => Promise<unknown>,
      second: (client: BridgePgClient) => Promise<unknown>,
      firstContext = context,
      secondContext = context,
    ) {
      let release!: () => void, ready!: (pid: number) => void, secondReady!: (pid: number) => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const held = new Promise<number>((r) => {
          ready = r;
        }),
        waiting = new Promise<number>((r) => {
          secondReady = r;
        });
      const settle = (p: Promise<unknown>) =>
        p.then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason) => ({ status: 'rejected' as const, reason }),
        );
      const one = settle(
        bridgeTransaction(pool(), firstContext, new Deadline(), async (c) => {
          const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
          const result = await first(c);
          ready(pid);
          await gate;
          return result;
        }),
      );
      let two: ReturnType<typeof settle> | undefined;
      try {
        const blocker = await Promise.race([
          held,
          one.then(() => {
            throw new Error('Fixture holder failed before barrier');
          }),
        ]);
        two = settle(
          bridgeTransaction(pool(), secondContext, new Deadline(), async (c) => {
            secondReady((await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number);
            return second(c);
          }),
        );
        const waiter = await Promise.race([
          waiting,
          two.then(() => {
            throw new Error('Fixture waiter failed before barrier');
          }),
        ]);
        const until = performance.now() + 900;
        let blocked = false;
        while (performance.now() < until) {
          const rows = await query('SELECT $1=ANY(pg_blocking_pids($2)) AS blocked', [
            blocker,
            waiter,
          ]);
          if (rows[0].blocked === true) {
            blocked = true;
            break;
          }
        }
        expect(blocked).toBe(true); // Real acknowledged row/unique-index wait, not sleep-only timing.
        release();
        return await Promise.all([one, two]);
      } finally {
        release();
        await one;
        if (two) await two;
      }
    }
    async function publish(r: Awaited<ReturnType<typeof reserve>>) {
      return bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        const repo = new BridgeRepository(c, ids.tenantA);
        const prepared = await repo.markDispatch(
          await repo.loadOperation(String(r.op.operation_id)),
          1001,
        );
        await repo.finish(
          prepared,
          'SUCCEEDED',
          'NONE',
          'GENERATION_PREPARED',
          actor.requestId,
          1001,
        );
        const activation = await repo.reserve(
          {
            ...r.plan,
            operation: 'ACTIVATE_GENERATION',
            expectedRevision: '2',
            generationId: String(r.op.generation_id),
            keyDigest: 'e'.repeat(64),
          },
          actor,
          1001,
        );
        const next = await repo.activate(r.slot, String(r.op.generation_id), '3', 1001);
        await repo.finish(
          activation.operation,
          'SUCCEEDED',
          'NONE',
          'GENERATION_ACTIVATED',
          actor.requestId,
          1001,
        );
        return next;
      });
    }
    async function sceneId(generation: unknown) {
      return String(
        (
          await query(
            'SELECT scene_binding_id FROM zhiban_bridge.scene_bindings WHERE generation_id=$1',
            [generation],
          )
        )[0].scene_binding_id,
      );
    }
    const asset = (ref: string, length = 1) => ({
      ref,
      purpose: 'IMAGE' as const,
      mime: 'image/png',
      length,
      digest: 'f'.repeat(64),
      revision: '1',
    });
    async function seed() {
      const p = pool('zhiban_auth_runtime'),
        credentials = new PostgresCredentialRepository(p);
      await credentials.createPassword(
        userId(ids.userA),
        credentialId(v7()),
        verifier,
        instant(1000),
        audit,
      );
      const snapshot = (await credentials.verificationSnapshot(userId(ids.userA)))!;
      const issued = newApprovedSession(
        snapshot,
        repositoryRevision('1'),
        instant(Date.now()),
        DEFAULT_SESSION_POLICY,
      );
      await new PostgresSessionRepository(p).create(issued.record);
      return { issued, credentials, p };
    }
    const helper = (client: Pick<BridgePgClient, 'query'>, token: string, related: string[] = []) =>
      client.query('SELECT * FROM zhiban_identity.bridge_identity_context($1,$2,$3,$4,$5)', [
        ids.tenantA,
        token,
        ids.userA,
        ids.membershipA,
        related,
      ]);
    async function synthetic() {
      // Only this verified disposable CI DB can substitute a future business FK/gate.
      await verifyPg16();
      await admin(async (c) => {
        await c.query('CREATE SCHEMA zhiban_bridge_test');
        await c.query(
          'CREATE TABLE zhiban_bridge_test.activity(tenant_id uuid NOT NULL,activity_id uuid NOT NULL,PRIMARY KEY(tenant_id,activity_id))',
        );
        await c.query('INSERT INTO zhiban_bridge_test.activity VALUES($1,$2),($3,$2)', [
          ids.tenantA,
          activity,
          ids.tenantB,
        ]);
        await c.query(
          'ALTER TABLE zhiban_bridge.resource_slots ADD FOREIGN KEY(tenant_id,activity_id) REFERENCES zhiban_bridge_test.activity(tenant_id,activity_id)',
        );
        await c.query(
          'GRANT USAGE ON SCHEMA zhiban_bridge_test TO zhiban_bridge_runtime,zhiban_identity_owner',
        );
        await c.query(
          'GRANT SELECT ON zhiban_bridge_test.activity TO zhiban_bridge_runtime,zhiban_identity_owner',
        );
        await c.query(
          `CREATE OR REPLACE FUNCTION zhiban_bridge.business_resource_ready(p_tenant_id uuid,p_activity_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM zhiban_bridge_test.activity AS a WHERE a.tenant_id=p_tenant_id AND a.activity_id=p_activity_id) $$`,
        );
      });
    }
    async function reserve(ctx = context, owner: string = ids.membershipA) {
      return bridgeTransaction(pool(), ctx, new Deadline(), async (c) => {
        const repo = new BridgeRepository(c, ctx.tenantId),
          slot = await repo.createSlot(activity, deployment, owner, 1000);
        const plan: Reservation = {
          slotId: slot,
          expectedRevision: '1',
          operation: 'PREPARE_CONTENT',
          keyDigest: 'a'.repeat(64),
          intentDigest: 'b'.repeat(64),
          contentDigest: 'c'.repeat(64),
          sceneIntents: [{ ref: 'scene', ordinal: 0, digest: 'd'.repeat(64) }],
        };
        const current =
          ctx === context ? actor : { ...actor, user: ids.userB, member: ids.membershipB };
        const result = await repo.reserve(plan, current, 1000);
        return { slot, plan, op: result.operation };
      });
    }
    beforeAll(async () => {
      console.info(`B9 REAL server_version: ${await verifyPg16()}`);
      verifier = await new Argon2PasswordHasher({ isCompromised: async () => false }).hash(
        'Synthetic-Bridge-PG-password!',
      );
    });
    beforeEach(async () => {
      await admin(async (c) => {
        await c.query('DROP SCHEMA IF EXISTS zhiban_bridge_test CASCADE');
      });
      await prepareSchema();
      await insertBaseFixtures();
      await query(
        `INSERT INTO zhiban_bridge.deployment_registry VALUES($1,'synthetic','1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce','0.31.1','0.11.2','0.1.11',$2,'VERIFIED',1,1000,1000)`,
        [deployment, 'e'.repeat(64)],
      );
    });
    afterEach(async () => {
      await Promise.all(pools.map((p) => p.end()));
      pools.length = 0;
      await admin(async (c) => {
        await c.query('DROP SCHEMA IF EXISTS zhiban_bridge_test CASCADE');
      });
    });
    afterAll(resetDisposableIdentity);
    it('B9-PG01 inventory contains thirteen applied checksummed migrations', async () => {
      expect(
        (await query('SELECT version FROM zhiban_identity.schema_migrations ORDER BY version')).map(
          (r) => r.version,
        ),
      ).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 1).padStart(4, '0')));
    });
    it('B9-PG02 six tenant tables FORCE RLS; global deployment is not tenant state', async () => {
      const rows = await query(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='zhiban_bridge' AND c.relkind='r' ORDER BY relname",
      );
      expect(rows).toHaveLength(7);
      for (const r of rows) {
        expect(r.relrowsecurity).toBe(r.relname !== 'deployment_registry');
        expect(r.relforcerowsecurity).toBe(r.relname !== 'deployment_registry');
      }
    });
    it.each(['zhiban_runtime', 'zhiban_auth_runtime', 'zhiban_control_runtime'] as const)(
      'B9-PG03 existing %s cannot read or call bridge capabilities',
      async (role) => {
        const c = runtimeClient(role);
        await c.connect();
        try {
          await expectDenied(c, 'SELECT * FROM zhiban_bridge.resource_slots');
          await expectDenied(
            c,
            'SELECT * FROM zhiban_identity.bridge_identity_context($1,$2,$3,$4,$5)',
            [ids.tenantA, 'a'.repeat(64), ids.userA, ids.membershipA, []],
          );
        } finally {
          await c.end();
        }
      },
    );
    it('B9-PG04 PUBLIC table, column and direct trigger capabilities absent', async () => {
      const grants = await query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='zhiban_bridge' AND a.grantee=0`,
      );
      expect(grants[0].n).toBe(0);
      expect(
        (
          await query(
            `SELECT count(*)::int AS n FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE n.nspname='zhiban_bridge' AND acl.grantee=0`,
          )
        )[0].n,
      ).toBe(0);
      expect(
        (
          await query(
            `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE n.nspname='zhiban_bridge' AND a.grantee=0`,
          )
        )[0].n,
      ).toBe(0);
    });
    it('B9-PG05 bridge role graph, exact column grants and no identity secret access', async () => {
      const c = runtimeClient('zhiban_bridge_runtime');
      await c.connect();
      try {
        expect(
          (
            await c.query(
              'SELECT NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AS safe FROM pg_roles WHERE rolname=session_user',
            )
          ).rows[0].safe,
        ).toBe(true);
        expect(
          (
            await c.query(
              'SELECT count(*)::int AS n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user) OR roleid=(SELECT oid FROM pg_roles WHERE rolname=session_user)',
            )
          ).rows[0].n,
        ).toBe(0);
        await expectDenied(c, 'SELECT token_digest FROM zhiban_identity.sessions');
        await expectDenied(c, 'SELECT verifier_material FROM zhiban_identity.credentials');
        await expectDenied(c, 'DELETE FROM zhiban_bridge.resource_slots');
        expect(
          (
            await c.query(
              "SELECT has_column_privilege(session_user,'zhiban_bridge.operations','dispatch_started_at','UPDATE') AS allowed,has_column_privilege(session_user,'zhiban_bridge.operations','intent_digest','UPDATE') AS denied",
            )
          ).rows[0],
        ).toEqual({ allowed: true, denied: false });
      } finally {
        await c.end();
      }
    });
    it('B9-PG06 VERIFIED deployment never opens production gate', async () => {
      await expect(
        bridgeTransaction(pool(), context, new Deadline(), (c) =>
          new BridgeRepository(c, ids.tenantA).createSlot(
            activity,
            deployment,
            ids.membershipA,
            1000,
          ),
        ),
      ).rejects.toThrow(BridgeError);
      expect(
        (await query('SELECT count(*)::int AS n FROM zhiban_bridge.resource_slots'))[0].n,
      ).toBe(0);
    });
    it('B9-PG07 owner-mediated writes also reject shipped false gate', async () => {
      await admin(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query('SET LOCAL ROLE zhiban_identity_owner');
          await c.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantA]);
          await expect(
            c.query(
              "INSERT INTO zhiban_bridge.resource_slots VALUES($1,$2,$3,$4,$5,'SUSPENDED',0,NULL,1,1000,1000,NULL)",
              [ids.tenantA, v7(), activity, deployment, ids.membershipA],
            ),
          ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await c.query('ROLLBACK');
        }
      });
    });
    it('B9-PG08 authentic session helper returns closed current facts, no token/verifier', async () => {
      const { issued } = await seed();
      await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        const r = await helper(c, issued.record.tokenDigest);
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0]).toMatchObject({
          membership_id: ids.membershipA,
          user_id: ids.userA,
          security_epoch: '1',
          authorization_version: '0',
        });
        expect(Object.keys(r.rows[0])).toHaveLength(13);
        expect(r.rows[0]).not.toHaveProperty('token_digest');
        expect(r.rows[0].effective_grants).toHaveLength(1);
      });
    });
    it.each(['missing', 'empty', 'invalid', 'foreign'])(
      'B9-PG09 %s context fails closed',
      async (kind) => {
        const { issued } = await seed();
        const c = runtimeClient('zhiban_bridge_runtime');
        await c.connect();
        try {
          await c.query('BEGIN');
          if (kind !== 'missing')
            await c.query("SELECT set_config('app.tenant_id',$1,true)", [
              kind === 'empty' ? '' : kind === 'invalid' ? 'invalid' : ids.tenantB,
            ]);
          await expect(helper(c, issued.record.tokenDigest)).rejects.toMatchObject({
            code: '42501',
          });
        } finally {
          await c.query('ROLLBACK');
          await c.end();
        }
      },
    );
    it.each(['token', 'foreign-user', 'related-limit', 'foreign-member'])(
      'B9-PG10 helper rejects %s',
      async (kind) => {
        const { issued } = await seed();
        await expect(
          bridgeTransaction(pool(), context, new Deadline(), (c) =>
            c.query('SELECT * FROM zhiban_identity.bridge_identity_context($1,$2,$3,$4,$5)', [
              ids.tenantA,
              kind === 'token' ? 'a'.repeat(64) : issued.record.tokenDigest,
              kind === 'foreign-user' ? ids.userB : ids.userA,
              ids.membershipA,
              kind === 'related-limit'
                ? [v7(), v7(), v7()]
                : kind === 'foreign-member'
                  ? [ids.membershipB]
                  : [],
            ]),
          ),
        ).rejects.toThrow(BridgeError);
      },
    );
    it.each(['credential', 'logout', 'user', 'tenant', 'membership'])(
      'B9-PG11 %s mutation immediately denies old session authority',
      async (kind) => {
        const { issued, credentials, p } = await seed();
        if (kind === 'credential') {
          const slot = (await credentials.findSlot(userId(ids.userA)))!;
          await credentials.revokePassword(
            userId(ids.userA),
            slot.revision,
            slot.value.activeCredentialId,
            instant(Date.now()),
            audit,
          );
        }
        if (kind === 'logout')
          await new PostgresSessionRepository(p).revokeAllForUser(
            userId(ids.userA),
            instant(Date.now()),
          );
        if (kind === 'user')
          await query(
            "UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=$1,disabled_reason='synthetic',updated_at=$1,repository_revision=repository_revision+1 WHERE user_id=$2",
            [Date.now(), ids.userA],
          );
        if (kind === 'tenant')
          await query(
            "UPDATE zhiban_identity.tenants SET status='DISABLED',disabled_at=$1,disabled_reason='synthetic',updated_at=$1,repository_revision=repository_revision+1 WHERE tenant_id=$2",
            [Date.now(), ids.tenantA],
          );
        if (kind === 'membership')
          await query(
            "UPDATE zhiban_identity.memberships SET status='DISABLED',disabled_at=$1,disabled_reason='synthetic',updated_at=$1,repository_revision=repository_revision+1,authorization_version=authorization_version+1 WHERE membership_id=$2",
            [Date.now(), ids.membershipA],
          );
        await expect(
          bridgeTransaction(pool(), context, new Deadline(), (c) =>
            helper(c, issued.record.tokenDigest),
          ),
        ).rejects.toThrow(BridgeError);
      },
    );
    it('B9-PG12 grant revoke is visible and historical grants do not revive', async () => {
      const { issued } = await seed();
      await query('UPDATE zhiban_identity.role_grants SET revoked_at=$1 WHERE grant_id=$2', [
        Date.now(),
        ids.grantA,
      ]);
      await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        expect((await helper(c, issued.record.tokenDigest)).rows[0].effective_grants).toEqual([]);
      });
    });
    it('B9-PG13 synthetic reservation increments once and stale fails before replay', async () => {
      await synthetic();
      const r = await reserve();
      expect(r.op.reserved_slot_revision).toBe('2');
      await expect(
        bridgeTransaction(pool(), context, new Deadline(), (c) =>
          new BridgeRepository(c, ids.tenantA).reserve(r.plan, actor, 1000),
        ),
      ).rejects.toThrow(BridgeError);
      expect(
        (
          await query(
            'SELECT repository_revision,last_generation FROM zhiban_bridge.resource_slots',
          )
        )[0],
      ).toEqual({ repository_revision: '2', last_generation: '1' });
    });
    it('B9-PG14 audit failure rolls back slot/generation/operation together', async () => {
      await synthetic();
      await query(
        'ALTER TABLE zhiban_bridge.audit_events ADD CONSTRAINT synthetic_no_audit CHECK(false)',
      );
      await expect(reserve()).rejects.toThrow(BridgeError);
      for (const table of ['resource_slots', 'resource_generations', 'operations'])
        expect((await query(`SELECT count(*)::int AS n FROM zhiban_bridge.${table}`))[0].n).toBe(0);
    });
    it('B9-PG15 dispatch mark commits exactly once; second dispatcher cannot replay', async () => {
      await synthetic();
      const r = await reserve();
      await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        const repo = new BridgeRepository(c, ids.tenantA);
        await repo.loadSlot(r.slot, 'UPDATE');
        await repo.markDispatch(await repo.loadOperation(String(r.op.operation_id)), 1001);
      });
      await expect(
        bridgeTransaction(pool(), context, new Deadline(), async (c) => {
          const repo = new BridgeRepository(c, ids.tenantA);
          await repo.loadSlot(r.slot, 'UPDATE');
          await repo.markDispatch(await repo.loadOperation(String(r.op.operation_id)), 1002);
        }),
      ).rejects.toThrow(BridgeError);
      expect(
        (
          await query(
            'SELECT repository_revision,dispatch_started_at FROM zhiban_bridge.operations',
          )
        )[0],
      ).toEqual({ repository_revision: '2', dispatch_started_at: '1001' });
    });
    it('B9-PG16 external completion is checked, audited and durable', async () => {
      await synthetic();
      const slot = await bridgeTransaction(pool(), context, new Deadline(), (c) =>
        new BridgeRepository(c, ids.tenantA).createSlot(
          activity,
          deployment,
          ids.membershipA,
          1000,
        ),
      );
      const protocol = new GuardedBridgeProtocol(pool(), context, async () => {});
      let calls = 0;
      await protocol.prepare(
        {
          slotId: slot,
          expectedRevision: '1',
          keyDigest: 'a'.repeat(64),
          intentDigest: 'b'.repeat(64),
          operation: 'PREPARE_CONTENT',
          contentDigest: 'c'.repeat(64),
          sceneIntents: [{ ref: 'scene', ordinal: 0, digest: 'd'.repeat(64) }],
        },
        actor,
        new Deadline(),
        async (_id, _repo, final) => {
          calls++;
          await final();
          return null;
        },
        async (repo, id, _result, at) =>
          repo.finish(
            await repo.loadOperation(id),
            'SUCCEEDED',
            'NONE',
            'GENERATION_PREPARED',
            actor.requestId,
            at,
          ),
      );
      expect(calls).toBe(1);
      expect(
        (await query('SELECT state,repository_revision FROM zhiban_bridge.operations'))[0],
      ).toEqual({ state: 'SUCCEEDED', repository_revision: '3' });
    });
    it('B9-PG17 unknown native outcome quarantines, never redispatches', async () => {
      await synthetic();
      const slot = await bridgeTransaction(pool(), context, new Deadline(), (c) =>
        new BridgeRepository(c, ids.tenantA).createSlot(
          activity,
          deployment,
          ids.membershipA,
          1000,
        ),
      );
      const plan: Reservation = {
        slotId: slot,
        expectedRevision: '1',
        operation: 'PREPARE_CONTENT',
        keyDigest: 'a'.repeat(64),
        intentDigest: 'b'.repeat(64),
        contentDigest: 'c'.repeat(64),
        sceneIntents: [{ ref: 'scene', ordinal: 0, digest: 'd'.repeat(64) }],
      };
      let calls = 0;
      const protocol = new GuardedBridgeProtocol(pool(), context, async () => {});
      const external = async () => {
        calls++;
        throw new Error('uncertain');
      };
      await expect(
        protocol.prepare(plan, actor, new Deadline(), external, async () => {}),
      ).rejects.toThrow(BridgeError);
      expect((await query('SELECT state,reason FROM zhiban_bridge.operations'))[0]).toEqual({
        state: 'OUTCOME_UNKNOWN',
        reason: 'UNKNOWN_OUTCOME',
      });
      await expect(
        protocol.prepare(
          { ...plan, expectedRevision: '2' },
          actor,
          new Deadline(),
          external,
          async () => {},
        ),
      ).rejects.toThrow(BridgeError);
      expect(calls).toBe(1);
    });
    it('B9-PG18 active pointer switching is atomic and history is immutable', async () => {
      await synthetic();
      const r = await reserve();
      await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        const repo = new BridgeRepository(c, ids.tenantA);
        const prepared = await repo.markDispatch(
          await repo.loadOperation(String(r.op.operation_id)),
          1001,
        );
        await repo.finish(
          prepared,
          'SUCCEEDED',
          'NONE',
          'GENERATION_PREPARED',
          actor.requestId,
          1001,
        );
        const activation = await repo.reserve(
          {
            ...r.plan,
            expectedRevision: '2',
            operation: 'ACTIVATE_GENERATION',
            generationId: String(r.op.generation_id),
            keyDigest: 'e'.repeat(64),
          },
          actor,
          1001,
        );
        await repo.activate(r.slot, String(r.op.generation_id), '3', 1001);
        await repo.finish(
          activation.operation,
          'SUCCEEDED',
          'NONE',
          'GENERATION_ACTIVATED',
          actor.requestId,
          1001,
        );
      });
      expect(
        (await query('SELECT state,repository_revision FROM zhiban_bridge.resource_slots'))[0],
      ).toEqual({ state: 'ENABLED', repository_revision: '4' });
      await expect(
        bridgeTransaction(pool(), context, new Deadline(), (c) =>
          c.query(
            'UPDATE zhiban_bridge.resource_generations SET content_digest=$1 WHERE generation_id=$2',
            ['f'.repeat(64), r.op.generation_id],
          ),
        ),
      ).rejects.toThrow(BridgeError);
    });
    it('B9-PG19 independent concurrent reservations yield exactly one success', async () => {
      await synthetic();
      const slot = await bridgeTransaction(pool(), context, new Deadline(), (c) =>
        new BridgeRepository(c, ids.tenantA).createSlot(
          activity,
          deployment,
          ids.membershipA,
          1000,
        ),
      );
      const plan: Reservation = {
        slotId: slot,
        expectedRevision: '1',
        operation: 'PREPARE_CONTENT',
        keyDigest: 'a'.repeat(64),
        intentDigest: 'b'.repeat(64),
        contentDigest: 'c'.repeat(64),
        sceneIntents: [{ ref: 'scene', ordinal: 0, digest: 'd'.repeat(64) }],
      };
      const results = await acknowledgedRace(
        (c) => new BridgeRepository(c, ids.tenantA).reserve(plan, actor, 1000),
        (c) =>
          new BridgeRepository(c, ids.tenantA).reserve(
            { ...plan, keyDigest: 'f'.repeat(64) },
            actor,
            1000,
          ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        (await query('SELECT count(*)::int AS n FROM zhiban_bridge.resource_generations'))[0].n,
      ).toBe(1);
    });
    it('B9-PG20 synthetic foreign tenant mappings are invisible', async () => {
      await synthetic();
      const r = await reserve();
      await expect(
        bridgeTransaction(pool(), contextB, new Deadline(), (c) =>
          new BridgeRepository(c, ids.tenantB).loadSlot(r.slot, 'SHARE'),
        ),
      ).rejects.toThrow(BridgeError);
    });
    it('B9-PG21 child writes after activation cannot amend published content', async () => {
      await synthetic();
      const r = await reserve();
      await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        const repo = new BridgeRepository(c, ids.tenantA);
        const prepared = await repo.markDispatch(
          await repo.loadOperation(String(r.op.operation_id)),
          1001,
        );
        await repo.finish(
          prepared,
          'SUCCEEDED',
          'NONE',
          'GENERATION_PREPARED',
          actor.requestId,
          1001,
        );
        const activation = await repo.reserve(
          {
            ...r.plan,
            expectedRevision: '2',
            operation: 'ACTIVATE_GENERATION',
            generationId: String(r.op.generation_id),
            keyDigest: 'e'.repeat(64),
          },
          actor,
          1001,
        );
        await repo.activate(r.slot, String(r.op.generation_id), '3', 1001);
        await repo.finish(
          activation.operation,
          'SUCCEEDED',
          'NONE',
          'GENERATION_ACTIVATED',
          actor.requestId,
          1001,
        );
      });
      await expect(
        bridgeTransaction(pool(), context, new Deadline(), (c) =>
          c.query('INSERT INTO zhiban_bridge.scene_bindings VALUES($1,$2,$3,$4,1,$5,1001)', [
            ids.tenantA,
            v7(),
            r.op.generation_id,
            'another-scene',
            'd'.repeat(64),
          ]),
        ),
      ).rejects.toThrow(BridgeError);
    });
    it('B9-PG22 malformed persisted data never becomes a mapper result', async () => {
      await synthetic();
      const r = await reserve();
      await query('ALTER TABLE zhiban_bridge.resource_slots DISABLE TRIGGER USER');
      await query('UPDATE zhiban_bridge.resource_slots SET last_generation=2 WHERE slot_id=$1', [
        r.slot,
      ]);
      await query('ALTER TABLE zhiban_bridge.resource_slots ENABLE TRIGGER USER');
      await expect(
        bridgeTransaction(pool(), context, new Deadline(), (c) =>
          new BridgeRepository(c, ids.tenantA).reserve(
            { ...r.plan, expectedRevision: '2' },
            actor,
            1001,
          ),
        ),
      ).rejects.toThrow(BridgeError);
    });
    it('B9-PG23 real registry collaborator rejects copied handles and fixes final participant/version set', async () => {
      const { issued, credentials, p } = await seed(),
        sessions = new PostgresSessionRepository(p),
        hasher = new Argon2PasswordHasher({ isCompromised: async () => false });
      const admission = new SharedAdmission(p, {
        environment: 'synthetic',
        approvalRef: 'synthetic',
        hmacKey: new Uint8Array(32).fill(7),
        policyDigests: Object.fromEntries(
          purposes.map((purpose) => [purpose, 'a'.repeat(64)]),
        ) as AdmissionConfig['policyDigests'],
      });
      const auth = await IdentityAuthentication.create(
        p,
        sessions,
        credentials,
        hasher,
        admission,
        new SessionCsrfPolicy('https://synthetic.invalid'),
        new IdentityIds(),
      );
      const handle = await auth.authenticate(bearerForCookie(issued.bearer));
      expect(handle).not.toBeNull();
      const security = auth.bridgeSecurity();
      expect(auth.bridgeSecurity()).toBe(security);
      await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        expect(
          (await security.guard(handle!, context, membershipId(ids.membershipA), [], 0)(c)).actor,
        ).toBe(ids.membershipA);
        await expect(
          security.assertCurrent(c, { ...handle! }, context, membershipId(ids.membershipA), []),
        ).rejects.toThrow(BridgeError);
      });
      await expect(
        bridgeTransaction(pool(), context, new Deadline(), (c) =>
          security.guard(handle!, context, membershipId(ids.membershipA), [], 1)(c),
        ),
      ).rejects.toThrow(BridgeError);
    });
    it.each(['credential', 'logout', 'user', 'tenant', 'membership', 'grant'] as const)(
      'B9-PG24 acknowledged %s lock race serializes current authority',
      async (kind) => {
        const { issued, credentials, p } = await seed();
        const holder = runtimeClient('zhiban_bridge_runtime');
        await holder.connect();
        const observer = adminClient();
        await observer.connect();
        let writer: Client | undefined, mutation: Promise<unknown> | undefined;
        try {
          await holder.query('BEGIN');
          await holder.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantA]);
          await helper(holder, issued.record.tokenDigest);
          const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          if (kind === 'credential')
            mutation = credentials.revokePassword(
              userId(ids.userA),
              repositoryRevision('1'),
              (await credentials.findSlot(userId(ids.userA)))!.value.activeCredentialId,
              instant(Date.now()),
              audit,
            );
          else if (kind === 'logout')
            mutation = new PostgresSessionRepository(p).revokeAllForUser(
              userId(ids.userA),
              instant(Date.now()),
            );
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
            (result) => !writer || (result as { rowCount: number }).rowCount === 1,
            () => false,
          ); // Attach rejection handler before observing wait.
          const deadline = performance.now() + 4000;
          let blocked = false;
          while (performance.now() < deadline) {
            const r = await observer.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid))) AS blocked',
              [pid],
            );
            if (r.rows[0].blocked) {
              blocked = true;
              break;
            }
          }
          expect(blocked).toBe(true);
          expect((await helper(holder, issued.record.tokenDigest)).rows[0].membership_status).toBe(
            'ACTIVE',
          );
          await holder.query('COMMIT');
          expect(await observed).toBe(true);
          if (writer) await writer.query('COMMIT');
          if (kind === 'membership') {
            const [member] = await query(
              'SELECT status,repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
              [ids.membershipA],
            );
            expect(member).toMatchObject({
              status: 'DISABLED',
              repository_revision: '2',
              authorization_version: '1',
            });
          }
          if (kind === 'grant')
            await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
              expect((await helper(c, issued.record.tokenDigest)).rows[0].effective_grants).toEqual(
                [],
              );
            });
          else
            await expect(
              bridgeTransaction(pool(), context, new Deadline(), (c) =>
                helper(c, issued.record.tokenDigest),
              ),
            ).rejects.toThrow(BridgeError);
        } finally {
          await holder.query('ROLLBACK').catch(() => {});
          if (mutation) await mutation.catch(() => {});
          if (writer) {
            await writer.query('ROLLBACK').catch(() => {});
            await writer.end();
          }
          await holder.end();
          await observer.end();
        }
      },
    );
    it('B9-PG25 a restored User cannot revive its pre-disable session', async () => {
      const { issued } = await seed();
      await query(
        "UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=$1,disabled_reason='synthetic',updated_at=$1,repository_revision=2 WHERE user_id=$2",
        [Date.now(), ids.userA],
      );
      await query(
        "UPDATE zhiban_identity.users SET status='ACTIVE',disabled_at=NULL,disabled_reason=NULL,updated_at=$1,repository_revision=3 WHERE user_id=$2",
        [Date.now(), ids.userA],
      );
      await expect(
        bridgeTransaction(pool(), context, new Deadline(), (c) =>
          helper(c, issued.record.tokenDigest),
        ),
      ).rejects.toThrow(BridgeError);
    });
    it('B9-PG26 global Asset ID uniqueness arbitrates acknowledged cross-tenant claims', async () => {
      await synthetic();
      const a = await reserve(),
        b = await reserve(contextB, ids.membershipB);
      const sa = await sceneId(a.op.generation_id),
        sb = await sceneId(b.op.generation_id);
      const result = await acknowledgedRace(
        (c) =>
          new BridgeRepository(c, ids.tenantA).attachAsset(
            a.slot,
            String(a.op.generation_id),
            sa,
            '2',
            asset('same-public-ID'),
            1001,
          ),
        (c) =>
          new BridgeRepository(c, ids.tenantB).attachAsset(
            b.slot,
            String(b.op.generation_id),
            sb,
            '2',
            asset('same-public-ID'),
            1001,
          ),
        context,
        contextB,
      );
      expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(
        (await query('SELECT count(*)::int AS n FROM zhiban_bridge.asset_bindings'))[0].n,
      ).toBe(1);
      expect((await query('SELECT tenant_id FROM zhiban_bridge.asset_bindings'))[0].tenant_id).toBe(
        ids.tenantA,
      );
    });
    it.each(['bindings', 'bytes'] as const)(
      'B9-PG27 parallel %s budget checks serialize and reject overflow at COMMIT',
      async (kind) => {
        await synthetic();
        const r = await reserve(),
          scene = await sceneId(r.op.generation_id);
        const count = kind === 'bindings' ? 31 : 7,
          length = kind === 'bindings' ? 1 : 4194304;
        await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
          const repo = new BridgeRepository(c, ids.tenantA);
          for (let i = 0; i < count; i++)
            await repo.attachAsset(
              r.slot,
              String(r.op.generation_id),
              scene,
              '2',
              asset(`registered-${i}`, length),
              1001,
            );
        });
        const results = await acknowledgedRace(
          (c) =>
            new BridgeRepository(c, ids.tenantA).attachAsset(
              r.slot,
              String(r.op.generation_id),
              scene,
              '2',
              asset('winner', length),
              1001,
            ),
          (c) =>
            new BridgeRepository(c, ids.tenantA).attachAsset(
              r.slot,
              String(r.op.generation_id),
              scene,
              '2',
              asset('overflow', length),
              1001,
            ),
        );
        expect(results.map((v) => v.status)).toEqual(['fulfilled', 'rejected']);
        expect(
          (await query('SELECT count(*)::int AS n FROM zhiban_bridge.asset_bindings'))[0].n,
        ).toBe(count + 1);
      },
    );
    it('B9-PG28 activation wins acknowledged child race; published generation cannot gain new bindings', async () => {
      await synthetic();
      const r = await reserve(),
        scene = await sceneId(r.op.generation_id);
      const result = await acknowledgedRace(
        async (c) => {
          const repo = new BridgeRepository(c, ids.tenantA);
          const prepared = await repo.markDispatch(
            await repo.loadOperation(String(r.op.operation_id)),
            1001,
          );
          await repo.finish(
            prepared,
            'SUCCEEDED',
            'NONE',
            'GENERATION_PREPARED',
            actor.requestId,
            1001,
          );
          const activation = await repo.reserve(
            {
              ...r.plan,
              operation: 'ACTIVATE_GENERATION',
              expectedRevision: '2',
              generationId: String(r.op.generation_id),
              keyDigest: 'e'.repeat(64),
            },
            actor,
            1001,
          );
          await repo.activate(r.slot, String(r.op.generation_id), '3', 1001);
          await repo.finish(
            activation.operation,
            'SUCCEEDED',
            'NONE',
            'GENERATION_ACTIVATED',
            actor.requestId,
            1001,
          );
        },
        (c) =>
          new BridgeRepository(c, ids.tenantA).attachAsset(
            r.slot,
            String(r.op.generation_id),
            scene,
            '2',
            asset('late'),
            1001,
          ),
      );
      expect(result.map((v) => v.status)).toEqual(['fulfilled', 'rejected']);
      expect(
        (await query('SELECT count(*)::int AS n FROM zhiban_bridge.asset_bindings'))[0].n,
      ).toBe(0);
      expect((await query('SELECT state FROM zhiban_bridge.resource_generations'))[0].state).toBe(
        'ACTIVE',
      );
    });
    it('B9-PG29 retirement is atomic and terminal history cannot revive even through maintenance owner', async () => {
      await synthetic();
      const r = await reserve();
      await publish(r);
      await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        const repo = new BridgeRepository(c, ids.tenantA);
        const retiring = await repo.reserve(
          {
            ...r.plan,
            operation: 'RETIRE',
            expectedRevision: '4',
            generationId: String(r.op.generation_id),
            keyDigest: 'f'.repeat(64),
          },
          actor,
          1002,
        );
        expect(await repo.setState(r.slot, '5', 'RETIRED', 1002)).toBe('6');
        await repo.finish(
          retiring.operation,
          'SUCCEEDED',
          'NONE',
          'MAPPING_RETIRED',
          actor.requestId,
          1002,
        );
      });
      expect(
        (
          await query(
            'SELECT state,active_generation_id,repository_revision FROM zhiban_bridge.resource_slots',
          )
        )[0],
      ).toEqual({ state: 'RETIRED', active_generation_id: null, repository_revision: '6' });
      for (const sql of [
        "UPDATE zhiban_bridge.resource_slots SET state='SUSPENDED',retired_at=NULL,updated_at=1003,repository_revision=7 WHERE slot_id=$1",
        "UPDATE zhiban_bridge.resource_generations SET state='ACTIVE',terminal_at=NULL,updated_at=1003,repository_revision=4 WHERE generation_id=$1",
      ]) {
        await expect(
          admin(async (c) => {
            await c.query('BEGIN');
            try {
              await c.query('SET LOCAL ROLE zhiban_identity_owner');
              await c.query("SELECT set_config('app.tenant_id',$1,true)", [ids.tenantA]);
              await c.query(sql, [sql.includes('resource_slots') ? r.slot : r.op.generation_id]);
              await c.query('COMMIT');
            } catch (error) {
              await c.query('ROLLBACK');
              throw error;
            }
          }),
        ).rejects.toMatchObject({ code: '23514' });
      }
    });
    it('B9-PG30 owner transfer creates a fresh generation/principal and preserves historical ownership', async () => {
      await synthetic();
      const r = await reserve();
      await publish(r);
      const newOwner = v7();
      await query(
        "INSERT INTO zhiban_identity.memberships(membership_id,tenant_id,user_id,status,created_at,updated_at) VALUES($1,$2,$3,'ACTIVE',1000,1000)",
        [newOwner, ids.tenantA, ids.userB],
      );
      const transferred = await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        const repo = new BridgeRepository(c, ids.tenantA);
        const next = await repo.reserve(
          {
            ...r.plan,
            operation: 'TRANSFER',
            expectedRevision: '4',
            keyDigest: 'f'.repeat(64),
            targetOwner: newOwner,
          },
          actor,
          1002,
        );
        expect((await repo.loadSlot(r.slot, 'UPDATE')).state).toBe('TRANSFERRING');
        const op = await repo.markDispatch(next.operation, 1002);
        expect(await repo.activate(r.slot, String(op.generation_id), '5', 1002)).toBe('6');
        await repo.finish(op, 'SUCCEEDED', 'NONE', 'TRANSFER_COMPLETED', actor.requestId, 1002);
        return String(op.generation_id);
      });
      const history = await query(
        'SELECT generation_id,generation,state,owner_membership_id,owner_handle,stage_ref FROM zhiban_bridge.resource_generations ORDER BY generation',
      );
      expect(history.map((g) => [g.generation, g.state, g.owner_membership_id])).toEqual([
        ['1', 'RETIRED', ids.membershipA],
        ['2', 'ACTIVE', newOwner],
      ]);
      expect(history[0].owner_handle).not.toBe(history[1].owner_handle);
      expect(history[0].stage_ref).not.toBe(history[1].stage_ref);
      expect(
        (
          await query(
            'SELECT owner_membership_id,active_generation_id FROM zhiban_bridge.resource_slots',
          )
        )[0],
      ).toEqual({ owner_membership_id: newOwner, active_generation_id: transferred });
    });
    it('B9-PG31 stale-before-true-no-op emits no new ledger, revision or external call', async () => {
      await synthetic();
      const r = await reserve();
      let external = 0;
      const protocol = new GuardedBridgeProtocol(pool(), context, async () => {});
      const plan = { ...r.plan, operation: 'SUSPEND' as const, expectedRevision: '2' };
      expect(
        await protocol.prepare(
          plan,
          actor,
          new Deadline(),
          async () => {
            external++;
          },
          async () => {},
        ),
      ).toEqual({ status: 'SUCCEEDED', revision: '2' });
      await expect(
        protocol.prepare(
          { ...plan, expectedRevision: '1' },
          actor,
          new Deadline(),
          async () => {
            external++;
          },
          async () => {},
        ),
      ).rejects.toThrow(BridgeError);
      expect(external).toBe(0);
      expect((await query('SELECT count(*)::int AS n FROM zhiban_bridge.operations'))[0].n).toBe(1);
      expect(
        (await query('SELECT repository_revision FROM zhiban_bridge.resource_slots'))[0]
          .repository_revision,
      ).toBe('2');
    });
    it('B9-PG32 exact successful intent replay returns only the current durable receipt; mismatch denies', async () => {
      await synthetic();
      const r = await reserve();
      await bridgeTransaction(pool(), context, new Deadline(), async (c) => {
        const repo = new BridgeRepository(c, ids.tenantA),
          op = await repo.markDispatch(await repo.loadOperation(String(r.op.operation_id)), 1001);
        await repo.finish(op, 'SUCCEEDED', 'NONE', 'GENERATION_PREPARED', actor.requestId, 1001);
      });
      const protocol = new GuardedBridgeProtocol(pool(), context, async () => {});
      let calls = 0;
      const external = async () => {
        calls++;
      };
      expect(
        await protocol.prepare(
          { ...r.plan, expectedRevision: '2' },
          actor,
          new Deadline(),
          external,
          async () => {},
        ),
      ).toEqual({ status: 'SUCCEEDED', revision: '2' });
      await expect(
        protocol.prepare(
          { ...r.plan, expectedRevision: '2', intentDigest: 'f'.repeat(64) },
          actor,
          new Deadline(),
          external,
          async () => {},
        ),
      ).rejects.toThrow(BridgeError);
      expect(calls).toBe(0);
      expect(
        (await query('SELECT count(*)::int AS n FROM zhiban_bridge.resource_generations'))[0].n,
      ).toBe(1);
    });
    it('B9-PG33 known exact prepared StageRef can be reconciled by fresh authority without redispatch', async () => {
      await synthetic();
      const candidate = planCandidate();
      const canvas = preview(
        {
          id: 'slide',
          viewportSize: 960,
          viewportRatio: 0.5625,
          elements: [],
          theme: {
            backgroundColor: '#ffffff',
            themeColors: ['#111111'],
            fontColor: '#111111',
            fontName: 'sans-serif',
          },
        } as Slide,
        () => 'unused',
      );
      const doc: MaicDocument = {
        dslVersion: DSL_VERSION,
        stage: { id: candidate.stageRef, name: 'Synthetic', createdAt: 1000, updatedAt: 1000 },
        scenes: [
          {
            id: 'scene',
            stageId: candidate.stageRef,
            title: 'Synthetic',
            order: 0,
            type: 'slide',
            content: { type: 'slide', canvas },
          },
        ],
      };
      const identity = validateDocument(doc, candidate.stageRef, new Set());
      const slot = await bridgeTransaction(pool(), context, new Deadline(), (c) =>
        new BridgeRepository(c, ids.tenantA).createSlot(
          activity,
          deployment,
          ids.membershipA,
          1000,
        ),
      );
      const protocol = new GuardedBridgeProtocol(pool(), context, async () => {});
      const plan: Reservation = {
        slotId: slot,
        expectedRevision: '1',
        operation: 'PREPARE_CONTENT',
        keyDigest: 'a'.repeat(64),
        intentDigest: 'b'.repeat(64),
        contentDigest: identity.digest,
        sceneIntents: identity.scenes,
        candidate,
      };
      await expect(
        protocol.prepare(
          plan,
          actor,
          new Deadline(),
          async () => {
            throw new Error('Acknowledgement lost');
          },
          async () => {},
        ),
      ).rejects.toThrow(BridgeError);
      const op = String(
        (await query('SELECT operation_id FROM zhiban_bridge.operations'))[0].operation_id,
      );
      let reads = 0;
      const known = {
        load: async (
          owner: string,
          stage: string,
          _refs: unknown,
          _deadline: Deadline,
          check: () => Promise<void>,
          digest: string,
        ) => {
          reads++;
          expect(owner).toBe(candidate.ownerHandle);
          expect(stage).toBe(candidate.stageRef);
          expect(digest).toBe(identity.digest);
          await check();
          return doc;
        },
      };
      expect(await protocol.reconcilePrepared(op, actor, new Deadline(), known)).toEqual({
        status: 'SUCCEEDED',
        revision: '2',
      });
      expect(reads).toBe(1);
      expect((await query('SELECT state FROM zhiban_bridge.operations'))[0].state).toBe(
        'SUCCEEDED',
      );
      expect((await query('SELECT state FROM zhiban_bridge.resource_generations'))[0].state).toBe(
        'PENDING',
      );
      expect(
        (
          await query(
            "SELECT count(*)::int AS n FROM zhiban_bridge.audit_events WHERE event_type='OUTCOME_RECONCILED'",
          )
        )[0].n,
      ).toBe(1);
    });
    it('B9-PG34 max int8 mutation rejects without wrap or partial reservation', async () => {
      await synthetic();
      const r = await reserve();
      // Maintenance corruption fixture, not a production mutation path.
      await query('ALTER TABLE zhiban_bridge.resource_slots DISABLE TRIGGER ALL');
      await query(
        'UPDATE zhiban_bridge.resource_slots SET repository_revision=9223372036854775807 WHERE slot_id=$1',
        [r.slot],
      );
      await query('ALTER TABLE zhiban_bridge.resource_slots ENABLE TRIGGER ALL');
      await expect(
        bridgeTransaction(pool(), context, new Deadline(), (c) =>
          new BridgeRepository(c, ids.tenantA).reserve(
            { ...r.plan, expectedRevision: '9223372036854775807', keyDigest: 'f'.repeat(64) },
            actor,
            1001,
          ),
        ),
      ).rejects.toThrow(BridgeError);
      expect(
        (await query('SELECT repository_revision FROM zhiban_bridge.resource_slots'))[0]
          .repository_revision,
      ).toBe('9223372036854775807');
      expect(
        (await query('SELECT count(*)::int AS n FROM zhiban_bridge.resource_generations'))[0].n,
      ).toBe(1);
    });
    it.each(['member', 'grant'] as const)(
      'B9-PG35 %s owner lock-only policy cannot become a DML capability',
      async (kind) => {
        await synthetic();
        await query(`CREATE FUNCTION zhiban_bridge_test.try_identity_write(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$ BEGIN
        ${kind === 'member' ? 'UPDATE zhiban_identity.memberships SET repository_revision=repository_revision+1,updated_at=floor(extract(epoch FROM clock_timestamp())*1000)::bigint WHERE membership_id=p_id;' : 'UPDATE zhiban_identity.role_grants SET revoked_at=floor(extract(epoch FROM clock_timestamp())*1000)::bigint WHERE grant_id=p_id;'}
      END; $$`);
        await query(
          'ALTER FUNCTION zhiban_bridge_test.try_identity_write(uuid) OWNER TO zhiban_identity_owner',
        );
        await query(
          'REVOKE ALL ON FUNCTION zhiban_bridge_test.try_identity_write(uuid) FROM PUBLIC',
        );
        await query(
          'GRANT EXECUTE ON FUNCTION zhiban_bridge_test.try_identity_write(uuid) TO zhiban_bridge_runtime',
        );
        await expect(
          bridgeTransaction(pool(), context, new Deadline(), (c) =>
            c.query('SELECT zhiban_bridge_test.try_identity_write($1)', [
              kind === 'member' ? ids.membershipA : ids.grantA,
            ]),
          ),
        ).rejects.toThrow(BridgeError);
        expect(
          (
            await query(
              'SELECT repository_revision FROM zhiban_identity.memberships WHERE membership_id=$1',
              [ids.membershipA],
            )
          )[0].repository_revision,
        ).toBe('1');
        expect(
          (
            await query('SELECT revoked_at FROM zhiban_identity.role_grants WHERE grant_id=$1', [
              ids.grantA,
            ])
          )[0].revoked_at,
        ).toBeNull();
      },
    );
  });
