/** LOCAL isolated PG16 candidate verification; no shared cluster or Native provider. */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { v7 } from 'uuid';
import { createRequire } from 'node:module';
import type {
  BridgeRepository as BridgeRepo,
  Actor,
} from '../../lib/zhiban/infrastructure/openmaic/repository';
const require = createRequire(import.meta.url);
const { contentProfile } = require('./content-profile.ts');
const { BridgeRepository } = require('../../lib/zhiban/infrastructure/openmaic/repository.ts');
const { planCandidate } = require('../../lib/zhiban/infrastructure/openmaic/candidate.ts');
const root = process.cwd(),
  candidate = join(root, 'docs/v2/candidates/m5-content');
const bin = '/usr/lib/postgresql/16/bin',
  port = 55439,
  database = 'zhiban_m5_disposable';
const owned = await mkdtemp(join(tmpdir(), 'zhiban-m5-pg16-')),
  data = join(owned, 'data'),
  socket = join(owned, 'socket');
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const checks: { name: string; status: string }[] = [];
const clients = new Set<Client>();
const sourceHashes: Record<string, string> = {};
let actualServerVersionNum: number | null = null;
let started = false,
  failure: unknown;
const tenant = v7(),
  user = v7(),
  member = v7(),
  course = v7(),
  term = v7(),
  offering = v7(),
  deployment = v7();
const actor: Actor = { user, member, authorizationVersion: 0, requestId: 'local-m5-synthetic' };
const epoch = Date.now();
let tick = 0;
const at = () => epoch + ++tick;
const connect = async (role = 'postgres', db = database) => {
  const c = new Client({ host: socket, port, database: db, user: role });
  await c.connect();
  clients.add(c);
  c.on('end', () => clients.delete(c));
  return c;
};
async function transaction<T>(work: (c: Client, repo: BridgeRepo) => Promise<T>) {
  const c = await connect('zhiban_bridge_runtime');
  try {
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    const value = await work(c, new BridgeRepository(c, tenant));
    await c.query('COMMIT');
    return value;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}
async function test(name: string, work: () => Promise<void>) {
  await work();
  checks.push({ name, status: 'PASS' });
  console.log('PASS', name);
}
async function denied(work: () => Promise<unknown>, codes: string[] = ['23514']) {
  let e: any;
  try {
    await work();
  } catch (x) {
    e = x;
  }
  assert.ok(e, 'expected rejection');
  assert.ok(codes.includes(e.code), `expected ${codes}, got ${e.code}: ${e.message}`);
}
const draft = (title = 'A') => ({
  title,
  slides: [{ id: v7(), elements: [{ id: v7(), text: title, x: 0, y: 0, width: 120, height: 40 }] }],
});
async function audit(
  c: Client,
  id: string,
  operation: string,
  event: string,
  before: number | null,
  after: number,
  time: number,
) {
  await c.query('INSERT INTO zhiban_content.audit_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    tenant,
    v7(),
    id,
    operation,
    member,
    event,
    before,
    after,
    time,
  ]);
}
async function op(
  c: Client,
  id: string,
  action: string,
  source: number,
  result: number | null,
  time: number,
  digest: string | null = null,
  bridge: string | null = null,
) {
  const oid = v7();
  await c.query(
    `INSERT INTO zhiban_content.operations(tenant_id,id,resource_id,actor_id,action,key_digest,intent_digest,state,source_revision,source_digest,expected_native_digest,result_revision,created_at,completed_at,bridge_operation_id)
 SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,zhiban_content.draft_digest(r.draft),$10,$11,$12,$13,$14 FROM zhiban_content.resources r WHERE r.tenant_id=$1 AND r.id=$3`,
    [
      tenant,
      oid,
      id,
      member,
      action,
      hash(oid),
      hash(action + oid),
      action === 'PUBLISH_CONTENT' ? 'RESERVED' : 'SUCCEEDED',
      source,
      digest,
      result,
      time,
      action === 'PUBLISH_CONTENT' ? null : time,
      bridge,
    ],
  );
  return oid;
}
async function resource() {
  const id = v7();
  await transaction(async (c) => {
    const t = at();
    const d = draft();
    await c.query(
      `INSERT INTO zhiban_content.resources VALUES($1,$2,$3,'SLIDE_CONTENT','content-text-v1',$4,$5,'DRAFT',1,NULL,0,$6,$6,$7,$7)`,
      [tenant, id, offering, d.title, d, member, t],
    );
    const oid = await op(c, id, 'CREATE_CONTENT', 1, 1, t);
    await audit(c, id, oid, 'CONTENT_CREATED', null, 1, t);
  });
  return id;
}
type Reserved = {
  id: string;
  slot: string;
  co: string;
  prep: string;
  generation: string;
  digest: string;
};
async function reserve(
  id: string,
  expected = hash('A'),
  actual = expected,
  existingSlot?: string,
  prepareOverride?: string,
  registrationDeployment = deployment,
  registerBinding = true,
) {
  return transaction(async (c, repo) => {
    const t = at();
    const row = (
      await c.query(
        'SELECT revision FROM zhiban_content.resources WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenant, id],
      )
    ).rows[0];
    const co = await op(c, id, 'PUBLISH_CONTENT', Number(row.revision), null, t, expected);
    await audit(c, id, co, 'PUBLISH_RESERVED', Number(row.revision), Number(row.revision), t);
    let slot = existingSlot;
    if (!slot) {
      slot = v7();
      await c.query(
        `INSERT INTO zhiban_bridge.resource_slots VALUES($1,$2,$3,$4,$5,'SUSPENDED',0,NULL,1,$6,$6,NULL)`,
        [tenant, slot, id, registrationDeployment, member, t],
      );
    }
    const current = await repo.loadSlot(slot, 'UPDATE');
    const result = await repo.reserve(
      {
        slotId: slot,
        expectedRevision: current.revision,
        operation: 'PREPARE_CONTENT',
        keyDigest: hash(v7()),
        intentDigest: hash(v7()),
        contentDigest: actual,
        sceneIntents: [{ ref: 'scene_' + v7(), ordinal: 0, digest: hash('scene') }],
        candidate: planCandidate(),
      },
      actor,
      t,
    );
    const prep = String(result.operation.operation_id),
      generation = String(result.operation.generation_id);
    if (registerBinding) {
      await c.query(
        'UPDATE zhiban_content.operations SET prepare_operation_id=$1 WHERE tenant_id=$2 AND id=$3',
        [prepareOverride ?? prep, tenant, co],
      );
    } else {
      await c.query(
        "UPDATE zhiban_content.operations SET state='FAILED',completed_at=$1 WHERE tenant_id=$2 AND id=$3",
        [t, tenant, co],
      );
      await audit(c, id, co, 'OPERATION_FAILED', Number(row.revision), Number(row.revision), t);
    }

    return { id, slot, co, prep, generation, digest: expected };
  });
}
async function prepared(r: Reserved, state: 'SUCCEEDED' | 'OUTCOME_UNKNOWN' = 'SUCCEEDED') {
  await transaction(async (_c, repo) => {
    const t = at();
    let b = await repo.loadOperation(r.prep);
    if (b.dispatch_started_at === null) b = await repo.markDispatch(b, t);
    await repo.finish(
      b,
      state,
      state === 'SUCCEEDED' ? 'NONE' : 'UNKNOWN_OUTCOME',
      state === 'SUCCEEDED' ? 'GENERATION_PREPARED' : 'OUTCOME_QUARANTINED',
      actor.requestId,
      t,
    );
  });
}
async function activate(
  r: Reserved,
  complete: boolean,
  omitContentAudit = false,
  terminalBinding = false,
) {
  await transaction(async (c, repo) => {
    const t = at(),
      slot = await repo.loadSlot(r.slot, 'UPDATE');
    const b = await repo.reserve(
      {
        slotId: r.slot,
        expectedRevision: slot.revision,
        operation: 'ACTIVATE_GENERATION',
        generationId: r.generation,
        keyDigest: hash(v7()),
        intentDigest: hash(v7()),
      },
      actor,
      t,
    );
    if (!terminalBinding)
      await c.query(
        'UPDATE zhiban_content.operations SET bridge_operation_id=$1 WHERE tenant_id=$2 AND id=$3',
        [b.operation.operation_id, tenant, r.co],
      );
    await repo.activate(r.slot, r.generation, String(b.operation.reserved_slot_revision), t);
    await repo.finish(b.operation, 'SUCCEEDED', 'NONE', 'GENERATION_ACTIVATED', actor.requestId, t);
    if (complete) {
      const row = (
          await c.query(
            'SELECT * FROM zhiban_content.resources WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
            [tenant, r.id],
          )
        ).rows[0],
        pid = v7(),
        rev = Number(row.revision);
      await c.query(
        `INSERT INTO zhiban_content.publications VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'content-text-v1',$13,$14)`,
        [
          tenant,
          pid,
          r.id,
          offering,
          row.last_publication_no + 1,
          rev,
          r.slot,
          r.generation,
          r.prep,
          b.operation.operation_id,
          row.title,
          r.digest,
          member,
          t,
        ],
      );
      await c.query(
        "UPDATE zhiban_content.operations SET state='SUCCEEDED',result_publication_id=$1,result_revision=$2,completed_at=$3,bridge_operation_id=$6 WHERE tenant_id=$4 AND id=$5",
        [pid, rev + 1, t, tenant, r.co, b.operation.operation_id],
      );
      await c.query(
        "UPDATE zhiban_content.resources SET state='PUBLISHED',revision=revision+1,active_publication_id=$1,last_publication_no=last_publication_no+1,updated_at=$2,updated_by=$3 WHERE tenant_id=$4 AND id=$5",
        [pid, t, member, tenant, r.id],
      );
      if (!omitContentAudit) await audit(c, r.id, r.co, 'CONTENT_PUBLISHED', rev, rev + 1, t);
    }
  });
}
async function failContent(r: Reserved, finishBridge = false) {
  await transaction(async (c, repo) => {
    const t = at();
    if (finishBridge) {
      const b = await repo.loadOperation(r.prep);
      await repo.finish(
        b,
        'FAILED',
        'STORAGE_FAILURE',
        b.state === 'OUTCOME_UNKNOWN' ? 'OUTCOME_RECONCILED' : 'OPERATION_FAILED',
        actor.requestId,
        t,
      );
    }
    await c.query(
      "UPDATE zhiban_content.operations SET state='FAILED',completed_at=$1 WHERE tenant_id=$2 AND id=$3",
      [t, tenant, r.co],
    );
    const source = (
      await c.query(
        'SELECT source_revision FROM zhiban_content.operations WHERE tenant_id=$1 AND id=$2',
        [tenant, r.co],
      )
    ).rows[0].source_revision;
    await audit(c, r.id, r.co, 'OPERATION_FAILED', Number(source), Number(source), t);
  });
}
try {
  await mkdir(socket, { mode: 0o700 });
  execFileSync(
    join(bin, 'initdb'),
    [
      '-D',
      data,
      '-U',
      'postgres',
      '--auth-local=trust',
      '--auth-host=reject',
      '--encoding=UTF8',
      '--no-locale',
    ],
    { stdio: 'pipe' },
  );
  execFileSync(
    join(bin, 'pg_ctl'),
    [
      '-D',
      data,
      '-l',
      join(owned, 'postgres.log'),
      '-o',
      `-p ${port} -k ${socket} -c listen_addresses=''`,
      '-w',
      'start',
    ],
    { stdio: 'pipe' },
  );
  started = true;
  let admin = await connect('postgres', 'postgres');
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
  for (const f of ['bootstrap-roles.pg16.sql', 'bootstrap-bridge-roles.pg16.sql'])
    execFileSync(
      join(bin, 'psql'),
      [
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        socket,
        '-p',
        String(port),
        '-U',
        'postgres',
        '-d',
        database,
        '-f',
        join(root, 'lib/zhiban/infrastructure/identity/postgres', f),
      ],
      { stdio: 'pipe' },
    );
  admin = await connect();
  assert.equal(
    Math.floor(
      Number((await admin.query("SELECT current_setting('server_version_num') AS v")).rows[0].v) /
        10000,
    ),
    16,
  );
  await admin.query(
    'CREATE ROLE zhiban_academic_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',
  );
  actualServerVersionNum = Number(
    (await admin.query("SELECT current_setting('server_version_num') AS v")).rows[0].v,
  );
  for (const f of ['bootstrap-roles.pg16.sql', 'bootstrap-bridge-roles.pg16.sql'])
    sourceHashes['identity/' + f] = hash(
      await readFile(join(root, 'lib/zhiban/infrastructure/identity/postgres', f)),
    );
  for (const f of [
    'repository.ts',
    'candidate.ts',
    'records.ts',
    'validation.ts',
    'transactions.ts',
  ])
    sourceHashes['bridge/' + f] = hash(
      await readFile(join(root, 'lib/zhiban/infrastructure/openmaic', f)),
    );
  const declaredInventory = JSON.parse(await readFile(join(candidate, 'inventory.json'), 'utf8'));
  for (const [f, digest] of Object.entries(declaredInventory.filesSha256)) {
    const bytes = await readFile(join(candidate, f));
    assert.equal(hash(bytes), digest);
    sourceHashes['candidate/' + f] = hash(bytes);
  }
  for (const context of ['identity', 'academic', 'learning', 'assessment']) {
    const dir = join(root, `lib/zhiban/infrastructure/${context}/postgres/migrations`);
    for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = await readFile(join(dir, f), 'utf8');
      sourceHashes[context + '/' + f] = hash(sql);
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE zhiban_identity_owner');
      await admin.query(sql);
      await admin.query(
        `INSERT INTO zhiban_${context}.schema_migrations(version,checksum) VALUES($1,$2)`,
        [f.slice(0, 4), hash(sql)],
      );
      await admin.query('COMMIT');
    }
  }
  const baselineProfile = await contentProfile(admin, false);
  await test('exact dev preflight rejects isolated fixture target', async () => {
    await denied(
      async () => admin.query(await readFile(join(candidate, '00-preflight.sql'), 'utf8')),
      ['P0001'],
    );
  });
  // Execute only the unchanged role-edge predicate from the actual preflight;
  // never rewrite exact target boundary to make this temporary cluster production.
  const preflight = await readFile(join(candidate, '00-preflight.sql'), 'utf8');
  const edges = preflight.slice(
    preflight.indexOf(' IF (SELECT count(*) FROM pg_auth_members m'),
    preflight.indexOf(' IF EXISTS(SELECT 1 FROM pg_default_acl'),
  );
  const edgeCheck = () => admin.query('DO $$ BEGIN\n' + edges + 'END $$;');
  await test('F4 exact baseline PG16 role edges accepted', async () => {
    await edgeCheck();
  });
  for (const variant of ['INHERIT TRUE', 'SET FALSE'])
    await test('F4 rejects role edge ' + variant, async () => {
      await admin.query('BEGIN');
      try {
        await admin.query('GRANT zhiban_identity_owner TO zhiban_migrator WITH ' + variant);
        await denied(edgeCheck, ['P0001']);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  await test('F4 rejects unapproved incoming owner edge', async () => {
    await admin.query('BEGIN');
    try {
      await admin.query('CREATE ROLE m5_extra NOLOGIN');
      await admin.query(
        'GRANT zhiban_identity_owner TO m5_extra WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
      );
      await denied(edgeCheck, ['P0001']);
    } finally {
      await admin.query('ROLLBACK');
    }
  });
  await admin.query('BEGIN');
  await admin.query('SET LOCAL ROLE zhiban_identity_owner');
  for (const f of ['01-schema.sql', '02-helpers-and-guards.sql', '03-acl.sql'])
    await admin.query(await readFile(join(candidate, f), 'utf8'));
  await admin.query('COMMIT');
  const enabledProfile = await contentProfile(admin);
  if (process.argv.includes('--emit-profile'))
    await writeFile(
      join(root, 'docs/v2/evidence/m5-profile-reference-openmaic-120.json'),
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          scope: 'ISOLATED_PG16_REFERENCE_PROFILE',
          candidateMigrationSha256: declaredInventory.migration.aggregateSha256,
          sourceHashes,
          baselineProfile,
          enabledProfile,
        },
        null,
        2,
      ) + '\n',
    );
  checks.push({
    name: 'actual candidate DDL applied to owned isolated fixture only',
    status: 'PASS',
  });
  await admin.query(
    "INSERT INTO zhiban_identity.tenants(tenant_id,code,display_name,status,created_at,updated_at) VALUES($1,'m5','M5','ACTIVE',1000,1000)",
    [tenant],
  );
  await admin.query(
    "INSERT INTO zhiban_identity.users(user_id,status,created_at,updated_at) VALUES($1,'ACTIVE',1000,1000)",
    [user],
  );
  await admin.query(
    "INSERT INTO zhiban_identity.memberships(membership_id,tenant_id,user_id,status,created_at,updated_at) VALUES($1,$2,$3,'ACTIVE',1000,1000)",
    [member, tenant, user],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.courses VALUES($1,$2,'c','Course','',$3,'PUBLISHED',1,1,1000,1000)",
    [tenant, course, member],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.course_versions VALUES($1,$2,1,'Course','',$3,1000)",
    [tenant, course, member],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.terms VALUES($1,$2,'t','Term','2026-01-01','2026-12-31',1)",
    [tenant, term],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.offerings VALUES($1,$2,$3,1,$4,NULL,'o','Offering',30,'OPEN',1)",
    [tenant, offering, course, term],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,'ACTIVE',1000,NULL,1)",
    [tenant, v7(), offering, member],
  );
  await admin.query(
    "INSERT INTO zhiban_bridge.deployment_registry VALUES($1,'synthetic-m5','a9da60b3b4adb429369c0da13d5637a904ead2b0','0.37.3','0.11.3','0.1.14',$2,'VERIFIED',1,1000,1000)",
    [deployment, hash('synthetic')],
  );
  await test('1.2.0 provider tuple rejects mixed package versions', async () => {
    await denied(
      () =>
        admin.query(
          "UPDATE zhiban_bridge.deployment_registry SET storage_version='0.31.1' WHERE deployment_id=$1",
          [deployment],
        ),
      ['23514'],
    );
  });
  await test('F4 actual receipt queries include INHERIT and SET', async () => {
    const snapshots: any = await admin.query(
      await readFile(join(candidate, '04-receipt-inspect.sql'), 'utf8'),
    );
    assert.ok(
      snapshots.some(
        (r: any) =>
          r.fields.some((f: any) => f.name === 'inherit_option') &&
          r.fields.some((f: any) => f.name === 'set_option'),
      ),
    );
  });
  await test('helper real owner FOR SHARE and closed projection', () =>
    transaction(async (c) => {
      const x = await c.query(
        "SELECT * FROM zhiban_content.lock_business_context($1,NULL,$2,$3,'TEACHER_WRITE')",
        [tenant, offering, member],
      );
      assert.equal(x.rows.length, 1);
      assert.equal(x.fields.length, 10);
    }));
  await test('Bridge raw Academic UPDATE denied', () =>
    denied(
      () =>
        transaction(async (c) => {
          await c.query(
            'UPDATE zhiban_academic.offerings SET revision=revision+1 WHERE tenant_id=$1',
            [tenant],
          );
        }),
      ['42501'],
    ));
  await admin.query(
    `CREATE FUNCTION zhiban_content.fixture_owner_write() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,zhiban_academic,pg_temp SET row_security=on AS $$ UPDATE zhiban_academic.offerings SET revision=revision+1 WHERE tenant_id=zhiban_identity.current_tenant_id() $$`,
  );
  await admin.query(
    'ALTER FUNCTION zhiban_content.fixture_owner_write() OWNER TO zhiban_identity_owner',
  );
  await admin.query('REVOKE ALL ON FUNCTION zhiban_content.fixture_owner_write() FROM PUBLIC');
  await admin.query(
    'GRANT EXECUTE ON FUNCTION zhiban_content.fixture_owner_write() TO zhiban_bridge_runtime',
  );
  await test('owner lock-only policy rejects actual Academic write', () =>
    denied(
      () =>
        transaction(async (c) => {
          await c.query('SELECT zhiban_content.fixture_owner_write()');
        }),
      ['42501'],
    ));
  const id = await resource(),
    r = await reserve(id);
  await prepared(r);
  await test('structural gate accepts DRAFT and rejects null/wrong tenant/unregistered', () =>
    transaction(async (c) => {
      const values = (
        await c.query(
          'SELECT zhiban_bridge.business_resource_ready($1,$2) AS ready,zhiban_bridge.business_resource_ready(NULL,NULL) AS empty,zhiban_bridge.business_resource_ready($3,$2) AS wrong,zhiban_bridge.business_resource_ready($1,$4) AS absent',
          [tenant, id, v7(), v7()],
        )
      ).rows[0];
      assert.deepEqual(values, { ready: true, empty: false, wrong: false, absent: false });
    }));
  await test('F1 Bridge-only first activation fails deferred COMMIT', () =>
    denied(() => activate(r, false)));
  await test('F1 rollback retains DRAFT and no ACTIVE generation', () =>
    transaction(async (c) => {
      assert.equal(
        (
          await c.query('SELECT state FROM zhiban_content.resources WHERE tenant_id=$1 AND id=$2', [
            tenant,
            id,
          ])
        ).rows[0].state,
        'DRAFT',
      );
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM zhiban_bridge.resource_generations WHERE tenant_id=$1 AND slot_id=$2 AND state='ACTIVE'",
            [tenant, r.slot],
          )
        ).rows[0].n,
        0,
      );
    }));
  await test('publication missing content audit rolls back both pointers', () =>
    denied(() => activate(r, true, true)));
  await test('F1 complete publication atomic settlement succeeds', () => activate(r, true));
  await test('withdrawal preserves suspended ACTIVE history', () =>
    transaction(async (c, repo) => {
      const t = at(),
        slot = await repo.loadSlot(r.slot, 'UPDATE');
      const b = await repo.reserve(
        {
          slotId: r.slot,
          expectedRevision: slot.revision,
          operation: 'SUSPEND',
          generationId: r.generation,
          keyDigest: hash(v7()),
          intentDigest: hash(v7()),
        },
        actor,
        t,
      );
      await repo.setState(r.slot, String(b.operation.reserved_slot_revision), 'SUSPENDED', t);
      await repo.finish(b.operation, 'SUCCEEDED', 'NONE', 'MAPPING_SUSPENDED', actor.requestId, t);
      const co = await op(
        c,
        id,
        'WITHDRAW_CONTENT',
        2,
        3,
        t,
        null,
        String(b.operation.operation_id),
      );
      await c.query(
        "UPDATE zhiban_content.resources SET state='WITHDRAWN',revision=3,updated_at=$1 WHERE tenant_id=$2 AND id=$3",
        [t, tenant, id],
      );
      await audit(c, id, co, 'CONTENT_WITHDRAWN', 2, 3, t);
    }));
  const deployment2 = v7();
  await admin.query(
    "INSERT INTO zhiban_bridge.deployment_registry VALUES($1,'synthetic-m5-alternate','a9da60b3b4adb429369c0da13d5637a904ead2b0','0.37.3','0.11.3','0.1.14',$2,'VERIFIED',1,1000,1000)",
    [deployment2, hash('synthetic')],
  );
  const alternate = await reserve(
    id,
    hash('alternate'),
    hash('alternate'),
    undefined,
    undefined,
    deployment2,
  );
  await prepared(alternate);
  await test('1.2.0 generation rejects a DSL stamp from another deployment version', async () => {
    await denied(
      () =>
        transaction((c) =>
          c.query(
            `INSERT INTO zhiban_bridge.resource_generations
            SELECT tenant_id,$2,slot_id,deployment_id,owner_membership_id,generation+100,
              $3,stage_ref||'-mismatch',content_digest,'0.11.2','PENDING',1,created_at,updated_at,NULL,NULL
            FROM zhiban_bridge.resource_generations WHERE deployment_id=$1 LIMIT 1`,
            [deployment2, v7(), 'Q'.repeat(43)],
          ),
        ),
      ['23503'],
    );
  });
  await test('F1 alternate deployment unbound activation rejected', () =>
    denied(() => activate(alternate, false)));
  const unboundId = await resource();
  await test('F2 cancelled content cannot hide unbound Bridge prepare', () =>
    denied(() =>
      reserve(unboundId, hash('A'), hash('A'), undefined, undefined, deployment, false),
    ));
  const unknown = await reserve(await resource());
  await prepared(unknown, 'OUTCOME_UNKNOWN');
  await test('F2 UNKNOWN prepare cannot release fence through FAILED', () =>
    denied(() => failContent(unknown)));
  await test('F2 preserved fence denies save', () =>
    denied(() =>
      transaction(async (c) => {
        await op(c, unknown.id, 'SAVE_CONTENT', 1, 2, at());
      }),
    ));
  await test('F2 atomic known failure releases fence', () => failContent(unknown, true));
  await test('F2 save after safe terminal failure succeeds', () =>
    transaction(async (c) => {
      const t = at(),
        co = await op(c, unknown.id, 'SAVE_CONTENT', 1, 2, t),
        d = draft('B');
      await c.query(
        'UPDATE zhiban_content.resources SET title=$1,draft=$2,revision=2,updated_at=$3 WHERE tenant_id=$4 AND id=$5',
        [d.title, d, t, tenant, unknown.id],
      );
      await audit(c, unknown.id, co, 'DRAFT_SAVED', 1, 2, t);
    }));
  const dispatched = await reserve(await resource());
  await transaction(async (_c, repo) => {
    await repo.markDispatch(await repo.loadOperation(dispatched.prep), at());
  });
  await test('F2 dispatched RESERVED prepare cannot release fence', () =>
    denied(() => failContent(dispatched)));
  const mismatchId = await resource();
  await test('F3 wrong prepared Native digest rejected at COMMIT', () =>
    denied(() => reserve(mismatchId, hash('B'), hash('A'))));
  await test('F3 mismatch rollback leaves no reservation or Bridge generation', () =>
    transaction(async (c) => {
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM zhiban_content.operations WHERE tenant_id=$1 AND resource_id=$2 AND action='PUBLISH_CONTENT'",
            [tenant, mismatchId],
          )
        ).rows[0].n,
        0,
      );
    }));
  await test('F3 expected Native digest is immutable', () =>
    denied(
      () =>
        transaction(async (c) => {
          await c.query(
            'UPDATE zhiban_content.operations SET expected_native_digest=$1 WHERE tenant_id=$2 AND id=$3',
            [hash('changed'), tenant, dispatched.co],
          );
        }),
      ['42501', '23514'],
    ));
  await admin.query(
    'GRANT UPDATE(expected_native_digest) ON zhiban_content.operations TO zhiban_bridge_runtime',
  );
  try {
    await test('F3 trigger rejects digest mutation under controlled extra fixture grant', () =>
      denied(() =>
        transaction(async (c) => {
          await c.query(
            'UPDATE zhiban_content.operations SET expected_native_digest=$1 WHERE tenant_id=$2 AND id=$3',
            [hash('changed'), tenant, dispatched.co],
          );
        }),
      ));
  } finally {
    await admin.query(
      'REVOKE UPDATE(expected_native_digest) ON zhiban_content.operations FROM zhiban_bridge_runtime',
    );
  }
  await test('F3 existing reservation completes after rejected mutation', async () => {
    await prepared(dispatched);
    await activate(dispatched, true);
  });
  const abandoned = await reserve(await resource());
  await prepared(abandoned);
  await test('F2 prepared known success with no activation may safely cancel', () =>
    failContent(abandoned));
  await test('F3 another reservation cannot reuse prior prepare', () =>
    denied(
      () => reserve(abandoned.id, hash('A'), hash('A'), abandoned.slot, abandoned.prep),
      ['23505'],
    ));

  // SM-01: exercise actual deferred COMMIT rejection, not an application mock.
  async function reserveActivation(
    c: Client,
    repo: BridgeRepo,
    r: Reserved,
    state: 'RESERVED' | 'OUTCOME_UNKNOWN',
    bind: boolean,
  ) {
    const t = at(),
      slot = await repo.loadSlot(r.slot, 'UPDATE');
    const b = await repo.reserve(
      {
        slotId: r.slot,
        expectedRevision: slot.revision,
        operation: 'ACTIVATE_GENERATION',
        generationId: r.generation,
        keyDigest: hash(v7()),
        intentDigest: hash(v7()),
      },
      actor,
      t,
    );
    if (bind)
      await c.query(
        'UPDATE zhiban_content.operations SET bridge_operation_id=$1 WHERE tenant_id=$2 AND id=$3',
        [b.operation.operation_id, tenant, r.co],
      );
    if (state === 'OUTCOME_UNKNOWN')
      await repo.finish(
        b.operation,
        'OUTCOME_UNKNOWN',
        'UNKNOWN_OUTCOME',
        'OUTCOME_QUARANTINED',
        actor.requestId,
        t,
      );
    return String(b.operation.operation_id);
  }
  async function saveAfterFailure(r: Reserved) {
    await transaction(async (c) => {
      const t = at(),
        co = await op(c, r.id, 'SAVE_CONTENT', 1, 2, t),
        d = draft('after-safe-failure');
      await c.query(
        'UPDATE zhiban_content.resources SET title=$1,draft=$2,revision=2,updated_at=$3 WHERE tenant_id=$4 AND id=$5',
        [d.title, d, t, tenant, r.id],
      );
      await audit(c, r.id, co, 'DRAFT_SAVED', 1, 2, t);
    });
  }
  async function quarantineContent(r: Reserved) {
    await transaction(async (c) => {
      const t = at();
      await c.query(
        "UPDATE zhiban_content.operations SET state='OUTCOME_UNKNOWN' WHERE tenant_id=$1 AND id=$2",
        [tenant, r.co],
      );
      await audit(c, r.id, r.co, 'OUTCOME_QUARANTINED', 1, 1, t);
    });
  }
  for (const state of ['RESERVED', 'OUTCOME_UNKNOWN'] as const) {
    const pending = await reserve(await resource());
    await prepared(pending);
    const before = await transaction(
      async (_c, repo) => (await repo.loadSlot(pending.slot, 'UPDATE')).revision,
    );
    for (const cancel of [false, true]) {
      await test(`SM01 unbound ${state} activation rejects COMMIT (cancel=${cancel})`, () =>
        assert.rejects(
          () =>
            transaction(async (c, repo) => {
              await reserveActivation(c, repo, pending, state, false);
              if (cancel) {
                const t = at();
                await c.query(
                  "UPDATE zhiban_content.operations SET state='FAILED',completed_at=$1 WHERE tenant_id=$2 AND id=$3",
                  [t, tenant, pending.co],
                );
                await audit(c, pending.id, pending.co, 'OPERATION_FAILED', 1, 1, t);
              }
            }),
          { code: '23514', message: 'Unbound Bridge activation' },
        ));
    }
    await test(`SM01 rejected ${state} activation rolls back ledger, slot and content`, () =>
      transaction(async (c, repo) => {
        assert.equal((await repo.loadSlot(pending.slot, 'UPDATE')).revision, before);
        assert.equal(
          (
            await c.query(
              "SELECT count(*)::int AS n FROM zhiban_bridge.operations WHERE tenant_id=$1 AND slot_id=$2 AND operation='ACTIVATE_GENERATION'",
              [tenant, pending.slot],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await c.query(
              'SELECT state FROM zhiban_content.operations WHERE tenant_id=$1 AND id=$2',
              [tenant, pending.co],
            )
          ).rows[0].state,
          'RESERVED',
        );
      }));
    const activation = await transaction((c, repo) =>
      reserveActivation(c, repo, pending, state, true),
    );
    await test(`SM01 bound ${state} activation prevents content FAILED`, () =>
      denied(() => failContent(pending)));
    await test(`SM01 bound ${state} activation retains SAVE fence`, () =>
      denied(() => saveAfterFailure(pending)));
    await test(`SM01 bound ${state} activation cannot be replaced`, () =>
      denied(() =>
        transaction((c, repo) => reserveActivation(c, repo, pending, 'RESERVED', true)),
      ));
    await test(`SM01 bound ${state} activation reconciled FAILED allows atomic content failure`, () =>
      transaction(async (c, repo) => {
        const t = at(),
          b = await repo.loadOperation(activation);
        await repo.finish(
          b,
          'FAILED',
          'STORAGE_FAILURE',
          state === 'OUTCOME_UNKNOWN' ? 'OUTCOME_RECONCILED' : 'OPERATION_FAILED',
          actor.requestId,
          t,
        );
        await c.query(
          "UPDATE zhiban_content.operations SET state='FAILED',completed_at=$1 WHERE tenant_id=$2 AND id=$3",
          [t, tenant, pending.co],
        );
        await audit(c, pending.id, pending.co, 'OPERATION_FAILED', 1, 1, t);
      }));
    await test(`SM01 SAVE after ${state} activation safely failed succeeds`, () =>
      saveAfterFailure(pending));
  }
  // A prior failed publish cannot donate its generation to a new activation.
  const prior = await reserve(await resource());
  await prepared(prior);
  await failContent(prior);
  const next = await reserve(prior.id, hash('next'), hash('next'), prior.slot);
  await prepared(next);
  await test('SM01 activation binding rejects a different prepared generation', () =>
    assert.rejects(
      () =>
        transaction((c, repo) =>
          reserveActivation(c, repo, { ...next, generation: prior.generation }, 'RESERVED', true),
        ),
      { code: '23514', message: 'Unbound Bridge activation' },
    ));
  await test('SM01 correct generation still publishes after mismatched binding rollback', () =>
    activate(next, true));
  const recovery = await reserve(await resource());
  await prepared(recovery);
  await test('SM01 content RESERVED to UNKNOWN retains durable preparation', () =>
    quarantineContent(recovery));
  await test('SM01 content UNKNOWN prevents SAVE', () => denied(() => saveAfterFailure(recovery)));
  await test('SM01 content UNKNOWN atomically binds successful activation and publication', () =>
    activate(recovery, true, false, true));
  const unknownBoth = await reserve(await resource());
  await prepared(unknownBoth, 'OUTCOME_UNKNOWN');
  await quarantineContent(unknownBoth);
  await test('SM01 content UNKNOWN cannot fail while prepare UNKNOWN', () =>
    denied(() => failContent(unknownBoth)));
  await test('SM01 content UNKNOWN can fail with reconciled prepare', () =>
    failContent(unknownBoth, true));

  await admin.end();
} catch (e) {
  failure = e;
  console.error(e);
} finally {
  await Promise.allSettled([...clients].map((c) => c.end()));
  if (started)
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], {
      stdio: 'pipe',
    });
  await rm(owned, { recursive: true, force: true });
  const inventory = JSON.parse(await readFile(join(candidate, 'inventory.json'), 'utf8'));
  await writeFile(
    join(root, 'docs/v2/evidence/m5-sm01-fix-openmaic-120-local.json'),
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        scope: 'OWNED_EPHEMERAL_PG16_CANDIDATE_ONLY',
        at: new Date().toISOString(),
        pgMajor: 16,
        actualServerVersionNum,
        nodeVersion: process.version,
        pnpmVersion: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
        lockfileSha256: hash(await readFile(join(root, 'pnpm-lock.yaml'))),
        sourceHashes,
        guardScope:
          'Real SQL/RLS and shipped BridgeRepository primitives; synthetic actor, no Session/Role/Scope/Native end-to-end signoff',
        port,
        database,
        unixSocketOnly: true,
        fixtureRemoved: true,
        sharedClustersTouched: false,
        nativeProviderCalls: 0,
        receiptIssued: false,
        developmentMigrationApplied: false,
        candidateMigrationSha256: inventory.migration.aggregateSha256,
        runnerSha256: hash(
          await readFile(resolve(import.meta.filename ?? new URL(import.meta.url).pathname)),
        ),
        checks,
        status: failure ? 'FAIL' : 'PASS',
        failure: failure instanceof Error ? failure.message : null,
      },
      null,
      2,
    ) + '\n',
  );
}
if (failure) process.exitCode = 1;
