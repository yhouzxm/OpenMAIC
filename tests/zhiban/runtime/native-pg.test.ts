import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client, Pool } from 'pg';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PgRuntimeStore } from '@openmaic/storage/runtime/pg';
import { NativeRuntime } from '@/lib/zhiban/infrastructure/openmaic/runtime/native';
import {
  provisionRuntimeNative,
  verifyRuntimeProvisioning,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/provision';
import {
  RuntimeProtocol,
  type RuntimeOutcomeProof,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/protocol';
import { validateNativeSession } from '@/lib/zhiban/infrastructure/openmaic/runtime/records';
import { runtimeTransaction } from '@/lib/zhiban/infrastructure/openmaic/runtime/transactions';
import { RuntimeDeadline } from '@/lib/zhiban/infrastructure/openmaic/runtime/admission';
import {
  allocateRef,
  RuntimeFailure,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';
import { official } from '@/lib/zhiban/infrastructure/openmaic/catalog';
import { FakeRuntimePersistence, pendingBinding } from './fakes';

const configured = process.env.C9_NATIVE_REQUIRED === '1',
  database = 'zhiban_9c_native_test',
  password = 'synthetic-c9-native-password';
function url(native = false) {
  const value = process.env.PG_CONTRACT_URL;
  if (!value) throw Error('C9 native URL required');
  const u = new URL(value);
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    !['postgres:', 'postgresql:'].includes(u.protocol) ||
    !['localhost', '127.0.0.1'].includes(u.hostname) ||
    u.username !== 'postgres' ||
    u.pathname !== '/openmaic'
  )
    throw Error('C9 native fixture is not disposable');
  if (native) u.pathname = '/' + database;
  return u;
}
async function admin<T>(body: (c: Client) => Promise<T>, native = true) {
  const c = new Client({ connectionString: url(native).toString() });
  await c.connect();
  try {
    return await body(c);
  } finally {
    await c.end();
  }
}
const pools: Pool[] = [];
function rolePool(role: string) {
  const u = url(true);
  u.username = role;
  u.password = password;
  const p = new Pool({ connectionString: u.toString(), max: 2, connectionTimeoutMillis: 1000 });
  pools.push(p);
  return p;
}
describe.skipIf(!configured).sequential('C9-N real public Runtime PG16', () => {
  let runtime: Pool,
    migrator: Pool,
    receipt: Awaited<ReturnType<typeof provisionRuntimeNative>>,
    created = false;
  const createdRoles: string[] = [];
  const serviceRoles = [
    'zhiban_runtime',
    'zhiban_auth_runtime',
    'zhiban_control_runtime',
    'zhiban_bridge_runtime',
  ];
  beforeAll(async () => {
    const proof = JSON.parse(
      await readFile(new URL('../openmaic/artifact-provenance.json', import.meta.url), 'utf8'),
    );
    expect(proof).toMatchObject({
      baseHead: process.env.GITHUB_SHA,
      officialTag: official.sha,
      freshBuild: true,
      platform: 'linux',
      architecture: 'x64',
    });
    expect(process.version).toMatch(/^v22\./);
    await admin(async (c) => {
      expect((await c.query('SHOW server_version')).rows[0].server_version).toMatch(/^16\./);
      expect(
        (await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount,
      ).toBe(0);
      const found = await c.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1)', [
        ['zhiban_openmaic_owner', 'zhiban_openmaic_migrator', 'zhiban_openmaic_runtime'],
      ]);
      // Existing credentials are never changed. A separately owned native service requires isolation.
      if (found.rows.some((r) => r.rolname !== 'zhiban_openmaic_owner'))
        throw Error('C9 fixture refuses existing native login credentials');
      for (const role of [
        'zhiban_openmaic_owner',
        'zhiban_openmaic_migrator',
        'zhiban_openmaic_runtime',
      ])
        if (!found.rows.some((r) => r.rolname === role)) createdRoles.push(role);
      await c.query(`CREATE DATABASE ${database}`);
      created = true;
      for (const role of serviceRoles) {
        if (!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
          await c.query(
            `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD '${password}'`,
          );
          createdRoles.unshift(role);
        }
        const properties = (
          await c.query(
            'SELECT rolsuper,rolinherit,rolcanlogin,rolcreatedb,rolcreaterole,rolbypassrls,rolreplication FROM pg_roles WHERE rolname=$1',
            [role],
          )
        ).rows[0];
        expect(properties).toEqual({
          rolsuper: false,
          rolinherit: false,
          rolcanlogin: true,
          rolcreatedb: false,
          rolcreaterole: false,
          rolbypassrls: false,
          rolreplication: false,
        });
      }
    }, false);
    const u = url();
    const result = spawnSync(
      'psql',
      [
        '-X',
        '-f',
        fileURLToPath(
          new URL(
            '../../../lib/zhiban/infrastructure/openmaic/bootstrap-native-roles.pg16.sql',
            import.meta.url,
          ),
        ),
      ],
      {
        env: {
          ...process.env,
          PGHOST: u.hostname,
          PGPORT: u.port || '5432',
          PGDATABASE: database,
          PGUSER: 'postgres',
          PGPASSWORD: decodeURIComponent(u.password),
        },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    await admin(async (c) => {
      for (const role of createdRoles.filter((r) =>
        ['zhiban_openmaic_migrator', 'zhiban_openmaic_runtime'].includes(r),
      ))
        await c.query(`ALTER ROLE ${role} PASSWORD '${password}'`);
    });
    runtime = rolePool('zhiban_openmaic_runtime');
    migrator = rolePool('zhiban_openmaic_migrator');
  });
  afterAll(async () => {
    const cleanup = await Promise.allSettled(pools.map((p) => p.end()));
    if (created)
      await admin(async (c) => {
        await c.query(`DROP DATABASE ${database} WITH (FORCE)`);
      }, false);
    await admin(async (c) => {
      for (const role of [...createdRoles].reverse()) await c.query(`DROP ROLE IF EXISTS ${role}`);
    }, false);
    expect(cleanup.every((r) => r.status === 'fulfilled')).toBe(true);
  });
  function fixture(pool = runtime) {
    const b = pendingBinding(),
      store = new FakeRuntimePersistence(b),
      actor = {
        userId: store.ownerUserId,
        membershipId: b.learnerMembershipId,
        authorizationVersion: 0,
        requestId: 'synthetic-native',
      };
    return { b, store, actor, protocol: new RuntimeProtocol(store, new NativeRuntime(pool)) };
  }
  const create = async (f: ReturnType<typeof fixture>) => {
    expect(
      await f.protocol.execute('CREATE_RUNTIME', f.actor, f.b.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      }),
    ).toMatchObject({ status: 'SUCCEEDED', revision: '3' });
  };
  const append = (f: ReturnType<typeof fixture>, revision = '3', last: number | null = null) =>
    f.protocol.execute('APPEND_USER_RECORD', f.actor, f.b.bindingId, revision, {
      idempotencyKey: allocateRef(),
      expectedLastSeq: last,
      content: 'Synthetic native PG record',
      sceneBindingId: null,
    });
  it('C9-N01 explicit provisioning and readonly receipt match exact public schema', async () => {
    let createdTables = 0,
      rolledBack = 0;
    const failedProvision = {
      connect: async () => {
        const c = await migrator.connect();
        return {
          release: (bad?: boolean) => c.release(bad),
          query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
            if (sql.startsWith('GRANT SELECT,INSERT')) throw Error('synthetic-provision-fault');
            const r = await c.query<R>(sql, params);
            if (/CREATE TABLE IF NOT EXISTS runtime_(sessions|records)/.test(sql)) createdTables++;
            if (sql === 'ROLLBACK' && r.command === 'ROLLBACK') rolledBack++;
            return r;
          },
        };
      },
    };
    await expect(
      provisionRuntimeNative(
        failedProvision as unknown as TransactionPool,
        database,
        'synthetic-failed-approval',
      ),
    ).rejects.toThrow(RuntimeFailure);
    expect(createdTables).toBe(2);
    expect(rolledBack).toBe(1);
    expect(
      (
        await admin((c) =>
          c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"),
        )
      ).rows[0].n,
    ).toBe(0);
    receipt = await provisionRuntimeNative(migrator, database, 'synthetic-c9-approval');
    expect(await verifyRuntimeProvisioning(migrator, receipt)).toEqual({ status: 'VERIFIED' });
    expect(receipt).toMatchObject({
      capability: 'RUNTIME_FOUNDATION',
      runtimeProtocol: '0.1.0',
      sha: official.sha,
    });
    await expect(provisionRuntimeNative(migrator, database, 'another')).rejects.toThrow(
      RuntimeFailure,
    );
    expect(await verifyRuntimeProvisioning(migrator, receipt)).toEqual({ status: 'VERIFIED' });
  });
  it('C9-N02 global schema, exact columns and no native private guard', async () => {
    const r = await admin((c) =>
      c.query(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY relname",
      ),
    );
    expect(r.rows).toEqual([
      { relname: 'runtime_records', relrowsecurity: false, relforcerowsecurity: false },
      { relname: 'runtime_sessions', relrowsecurity: false, relforcerowsecurity: false },
    ]);
  });
  it('C9-N03 owner/migrator/runtime and PUBLIC capabilities remain exact', async () => {
    for (const role of serviceRoles) {
      const denied = await admin((c) =>
        c.query(
          `SELECT has_database_privilege($1,current_database(),'CONNECT,TEMP,CREATE') AS database,has_table_privilege($1,'runtime_sessions','SELECT,INSERT,UPDATE,DELETE') AS table`,
          [role],
        ),
      );
      expect(denied.rows[0]).toEqual({ database: false, table: false });
      if (createdRoles.includes(role))
        await expect(rolePool(role).connect()).rejects.toMatchObject({ code: '42501' });
    }
    const rows = await admin((c) =>
      c.query(
        "SELECT has_table_privilege('zhiban_openmaic_runtime','runtime_sessions','SELECT,INSERT') AS read_write,has_table_privilege('zhiban_openmaic_runtime','runtime_sessions','UPDATE,DELETE,TRUNCATE') AS broad,has_column_privilege('zhiban_openmaic_runtime','runtime_sessions','id','UPDATE') AS id_update,has_column_privilege('zhiban_openmaic_runtime','runtime_sessions','data','UPDATE') AS data_update,has_database_privilege('zhiban_openmaic_runtime',current_database(),'CREATE,TEMP') AS ddl",
      ),
    );
    expect(rows.rows[0]).toEqual({
      read_write: true,
      broad: false,
      id_update: false,
      data_update: true,
      ddl: false,
    });
    expect(
      (
        await admin((c) =>
          c.query(
            "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) acl WHERE n.nspname='public' AND acl.grantee=0",
          ),
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await admin((c) =>
          c.query(
            "SELECT count(*)::int AS n FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE n.nspname='public' AND a.attacl IS NOT NULL AND acl.grantee=0",
          ),
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await admin((c) =>
          c.query(
            "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='public' AND acl.grantee=0",
          ),
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('C9-N04 create/get and unique native partition handles', async () => {
    const f = fixture();
    await create(f);
    const c = await runtime.connect();
    try {
      const store = new PgRuntimeStore(c, {
        withTransaction: async () => {
          throw Error('unused');
        },
      });
      expect(await store.getSession(f.b.runtimeRef)).toMatchObject({
        id: f.b.runtimeRef,
        learnerKey: f.b.learnerHandle,
        runtimeDslVersion: '0.1.0',
      });
    } finally {
      c.release();
    }
  });
  it('C9-N05 append and terminal transitions update tail exactly once', async () => {
    const f = fixture();
    await create(f);
    expect(await append(f)).toMatchObject({ status: 'SUCCEEDED', lastSeq: 0, revision: '5' });
    expect(
      await f.protocol.execute('COMPLETE_RUNTIME', f.actor, f.b.bindingId, '5', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: 0,
      }),
    ).toMatchObject({ status: 'SUCCEEDED', state: 'COMPLETED' });
    expect(await append(f, '7', 0)).toMatchObject({ status: 'FAILED', reason: 'DENIED' });
  });
  it('C9-N06 concurrent tail reservations permit one append', async () => {
    const f = fixture();
    await create(f);
    const out = await Promise.all([append(f), append(f)]);
    expect(out.filter((r) => r.status === 'SUCCEEDED')).toHaveLength(1);
    expect(
      (
        await admin((c) =>
          c.query('SELECT count(*)::int AS n FROM runtime_records WHERE session_id=$1', [
            f.b.runtimeRef,
          ]),
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it.each(['23505', '40001', '40P01'])(
    'C9-N07 actual %s driver error has exactly one provider transaction and no leaked detail',
    async (code) => {
      const f = fixture();
      await create(f);
      let attempts = 0;
      const counted = {
        connect: async () => {
          attempts++;
          return runtime.connect();
        },
      };
      const p = new RuntimeProtocol(f.store, new NativeRuntime(counted));
      await admin(async (c) => {
        await c.query(
          `CREATE FUNCTION public.c9_fail_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sentinel-native-private' USING ERRCODE='${code}'; END $$`,
        );
        await c.query(
          'REVOKE ALL ON FUNCTION public.c9_fail_record() FROM PUBLIC,zhiban_openmaic_runtime',
        );
        await c.query(
          'CREATE TRIGGER c9_fault BEFORE INSERT ON runtime_records FOR EACH ROW EXECUTE FUNCTION public.c9_fail_record()',
        );
      });
      try {
        await expect(verifyRuntimeProvisioning(migrator, receipt)).rejects.toThrow(RuntimeFailure);
        const result = await p.execute('APPEND_USER_RECORD', f.actor, f.b.bindingId, '3', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
          content: 'Synthetic native PG record',
          sceneBindingId: null,
        });
        expect(result).toEqual({ status: 'FAILED', reason: 'STORAGE_FAILURE' });
        expect(attempts).toBe(1);
        expect(JSON.stringify(result)).not.toContain('sentinel');
        expect(
          (
            await admin((c) =>
              c.query('SELECT count(*)::int AS n FROM runtime_records WHERE session_id=$1', [
                f.b.runtimeRef,
              ]),
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await admin(async (c) => {
          await c.query('DROP TRIGGER c9_fault ON runtime_records');
          await c.query('DROP FUNCTION public.c9_fail_record()');
        });
      }
      expect(await verifyRuntimeProvisioning(migrator, receipt)).toEqual({ status: 'VERIFIED' });
    },
  );
  it('C9-N08 failed final authority check rolls back public create', async () => {
    const f = fixture();
    const native = new NativeRuntime(runtime);
    const p = new RuntimeProtocol(f.store, {
      dispatch: async (b, op, stage, payload, scene, deadline) =>
        native.dispatch(b, op, stage, payload, scene, deadline, async () => {
          throw new RuntimeFailure('DENIED');
        }),
    });
    expect(
      await p.execute('CREATE_RUNTIME', f.actor, f.b.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      }),
    ).toMatchObject({ status: 'FAILED' });
    expect(
      (
        await admin((c) =>
          c.query('SELECT count(*)::int AS n FROM runtime_sessions WHERE id=$1', [f.b.runtimeRef]),
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it.each(['id', 'stageId', 'learnerKey', 'kind', 'runtimeDslVersion'])(
    'C9-N09 malformed %s JSON rejects and does not repair',
    async (field) => {
      const f = fixture();
      await create(f);
      await admin((c) =>
        c.query(
          'UPDATE runtime_sessions SET data=jsonb_set(data,$2::text[],$3::jsonb) WHERE id=$1',
          [f.b.runtimeRef, [field], JSON.stringify('malformed')],
        ),
      );
      expect(await append(f)).toMatchObject({ status: 'FAILED' });
      expect(
        (
          await admin((c) =>
            c.query('SELECT data FROM runtime_sessions WHERE id=$1', [f.b.runtimeRef]),
          )
        ).rows[0].data[field],
      ).toBe('malformed');
    },
  );
  it('C9-N10 legacy missing stamp rejects before public migration/read-repair', async () => {
    const f = fixture();
    await create(f);
    await admin((c) =>
      c.query("UPDATE runtime_sessions SET data=data-'runtimeDslVersion' WHERE id=$1", [
        f.b.runtimeRef,
      ]),
    );
    expect(await append(f)).toMatchObject({ status: 'FAILED' });
    expect(
      (
        await admin((c) =>
          c.query('SELECT data FROM runtime_sessions WHERE id=$1', [f.b.runtimeRef]),
        )
      ).rows[0].data,
    ).not.toHaveProperty('runtimeDslVersion');
  });
  it('C9-N11 scalar-only corruption demonstrates unsupported getter integrity; production facade stays closed', async () => {
    const f = fixture();
    await create(f);
    await admin((c) =>
      c.query('UPDATE runtime_sessions SET learner_key=$2 WHERE id=$1', [
        f.b.runtimeRef,
        allocateRef(),
      ]),
    );
    const c = await runtime.connect();
    try {
      expect(
        (
          await new PgRuntimeStore(c, {
            withTransaction: async () => {
              throw Error('unused');
            },
          }).getSession(f.b.runtimeRef)
        )?.learnerKey,
      ).toBe(f.b.learnerHandle);
    } finally {
      c.release();
    }
    const { createRuntimeFoundation } =
      await import('@/lib/zhiban/infrastructure/openmaic/runtime/root');
    expect(
      await createRuntimeFoundation().runtime.execute('APPEND_USER_RECORD', {} as never, {}),
    ).toEqual({ status: 'DENIED' });
  });
  it('C9-N12 raw native delete, id rewrite and sweeping privileges are absent', async () => {
    for (const sql of [
      'DELETE FROM runtime_sessions',
      'UPDATE runtime_sessions SET id=id',
      'TRUNCATE runtime_records',
    ]) {
      const c = await runtime.connect();
      try {
        await expect(c.query(sql)).rejects.toMatchObject({ code: '42501' });
      } finally {
        c.release();
      }
    }
  });
  it('C9-N13 pool/client cleanup after acknowledged transaction', async () => {
    await runtimeTransaction(runtime, new RuntimeDeadline(), async (c) => {
      expect((await c.query('SELECT 1 AS n')).rows[0].n).toBe(1);
    });
    expect(runtime.waitingCount).toBe(0);
    expect(runtime.idleCount).toBe(runtime.totalCount);
  });
  it('C9-N14 lost COMMIT acknowledgement after real PG commit stays fenced and discards connection', async () => {
    let discard = false;
    const lost = {
      connect: async () => {
        const c = await runtime.connect();
        return {
          release: (bad?: boolean) => {
            discard = Boolean(bad);
            c.release(bad);
          },
          query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
            const r = await c.query<R>(sql, params);
            if (sql === 'COMMIT') throw Error('synthetic-acknowledgement-loss');
            return r;
          },
        };
      },
    };
    const f = fixture(),
      p = new RuntimeProtocol(f.store, new NativeRuntime(lost as unknown as TransactionPool));
    expect(
      await p.execute('CREATE_RUNTIME', f.actor, f.b.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      }),
    ).toMatchObject({ status: 'FAILED', reason: 'OUTCOME_UNKNOWN' });
    expect(discard).toBe(true);
    expect(f.store.binding).toMatchObject({ revision: '2', status: 'PENDING' });
    expect(f.store.binding!.outstandingOperationId).not.toBeNull();
    expect(
      (
        await admin((c) =>
          c.query('SELECT count(*)::int AS n FROM runtime_sessions WHERE id=$1', [f.b.runtimeRef]),
        )
      ).rows[0].n,
    ).toBe(1);
    // Exclusive disposable create proof only: no competing writer, exact public envelope.
    const c = await runtime.connect();
    try {
      const session = await new PgRuntimeStore(c, {
        withTransaction: async () => {
          throw Error('unused');
        },
      }).getSession(f.b.runtimeRef);
      validateNativeSession(session, f.b, f.store.stageRef, 'active', f.b.createdAt);
    } finally {
      c.release();
    }
    const proof = {},
      proofs = new WeakMap<object, RuntimeOutcomeProof>(),
      operationId = f.store.binding!.outstandingOperationId!;
    proofs.set(proof, { operationId, outcome: 'COMMITTED' });
    expect(
      await new RuntimeProtocol(f.store, new NativeRuntime(runtime), undefined, proofs).reconcile(
        f.actor,
        f.b.bindingId,
        '2',
        operationId,
        proof,
      ),
    ).toMatchObject({ status: 'SUCCEEDED', revision: '3', state: 'ACTIVE' });
    expect(f.store.events).toHaveLength(4);
  });
});
