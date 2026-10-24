#!/usr/bin/env node
// LOCAL disposable PG16 validation only. No existing cluster or secret reads.
// Uses a unique 0700 Unix socket directory, listen_addresses='', fixed isolated
// socket port. Normal migrations compile here; product/Native scope is synthetic.
const { Client } = require('pg');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const bin = '/usr/lib/postgresql/16/bin';
const terminal = require('./terminal-installation.cjs');
const recovery = require('./terminal-recovery.cjs');
const { adoptTechnicalBroker } = require('../m5-terminal-preparation/technical-broker.cjs');
async function bootstrap(state, options = {}) {
  const dir = state.dir;
  const bin = '/usr/lib/postgresql/16/bin';
  const data = path.join(dir, 'data');
  const socket = path.join(dir, 'socket');
  fs.mkdirSync(socket, { mode: 0o700 });
  const port = state.port;
  execFileSync(
    path.join(bin, 'initdb'),
    [
      '-D',
      data,
      '-U',
      'postgres',
      '--auth-local=trust',
      '--auth-host=reject',
      '--no-locale',
      '--encoding=UTF8',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    path.join(bin, 'pg_ctl'),
    [
      '-D',
      data,
      '-l',
      path.join(dir, 'server.log'),
      '-o',
      `-c listen_addresses='' -c unix_socket_directories='${socket}' -c port=${port} -c max_prepared_transactions=0 -c log_parameter_max_length=0`,
      '-w',
      'start',
    ],
    { stdio: 'ignore' },
  );

  Object.assign(state, { data, socket, root, bin });
  const bootstrapClients = [];
  async function connection(db = 'postgres', user = 'postgres') {
    const c = new Client({ host: socket, port, database: db, user });
    await c.connect();
    bootstrapClients.push(c);
    return c;
  }
  try {
    const admin = await connection();
    for (const role of [
      'zhiban_identity_owner',
      'zhiban_migrator',
      'zhiban_runtime',
      'zhiban_auth_runtime',
      'zhiban_control_runtime',
      'zhiban_bridge_runtime',
      'zhiban_academic_runtime',
      'zhiban_openmaic_owner',
      'zhiban_openmaic_migrator',
      'zhiban_openmaic_runtime',
    ])
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
    await admin.query('CREATE DATABASE zhiban_m1_dev OWNER zhiban_identity_owner');
    await admin.query('CREATE DATABASE zhiban_m5_native OWNER zhiban_openmaic_owner');
    for (const db of ['zhiban_m1_dev', 'zhiban_m5_native'])
      await admin.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    const business = await connection('zhiban_m1_dev');
    await business.query('SET ROLE zhiban_identity_owner');
    for (const group of ['identity', 'academic', 'learning', 'assessment']) {
      const folder = path.join(root, `lib/zhiban/infrastructure/${group}/postgres/migrations`);
      for (const name of fs
        .readdirSync(folder)
        .filter((n) => n.endsWith('.sql'))
        .sort()) {
        const sql = fs.readFileSync(path.join(folder, name), 'utf8');
        await business.query(sql);
        await business.query(
          `INSERT INTO zhiban_${group}.schema_migrations(version,checksum) VALUES($1,$2)`,
          [name.slice(0, 4), crypto.createHash('sha256').update(sql).digest('hex')],
        );
      }
    }
    const folder = path.join(root, 'docs/v2/candidates/m5-content');
    await business.query('BEGIN');
    for (const n of ['01-schema.sql', '02-helpers-and-guards.sql', '03-acl.sql'])
      await business.query(fs.readFileSync(path.join(folder, n), 'utf8'));
    await business.query(
      "INSERT INTO zhiban_content.schema_migrations VALUES('0001','e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324')",
    );
    await business.query('COMMIT');
    await business.query('RESET ROLE');
    for (const role of [
      'zhiban_identity_owner',
      'zhiban_migrator',
      'zhiban_runtime',
      'zhiban_auth_runtime',
      'zhiban_control_runtime',
      'zhiban_bridge_runtime',
      'zhiban_academic_runtime',
    ])
      await admin.query('GRANT CONNECT ON DATABASE zhiban_m1_dev TO ' + role);
    const candidate = path.join(root, 'docs/v2/candidates/m5-terminal');
    const native = await connection('zhiban_m5_native');
    await native.query('SET ROLE zhiban_openmaic_owner');
    await native.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    for (const t of [
      'document_stages',
      'document_scenes',
      'document_outlines',
      'document_stage_revision',
      'document_scene_revision',
    ])
      await native.query(`CREATE TABLE public.${t}(id text PRIMARY KEY,payload jsonb)`);
    await native.query('RESET ROLE');
    state.before = await terminal.collectComplete(business, native, false);
    if (!options.legacyOnly) {
      await admin.query(fs.readFileSync(path.join(candidate, '00-role-bootstrap.sql'), 'utf8'));
      await business.query(
        fs.readFileSync(path.join(candidate, '00-business-connect.sql'), 'utf8'),
      );
      await business.query(
        fs.readFileSync(path.join(candidate, '00-catalog-observer.sql'), 'utf8'),
      );
      await business.query('BEGIN');
      await business.query('SET LOCAL ROLE zhiban_identity_owner');
      for (const n of [
        '01-schema.sql',
        '02-common-and-history.sql',
        '03-operation-helpers.sql',
        '04-control-and-lookup.sql',
        '05-existing-constraint-supplement.sql',
        '06-guards.sql',
        '07-acl.sql',
      ])
        await business.query(fs.readFileSync(path.join(candidate, n), 'utf8'));
      await business.query("INSERT INTO zhiban_content.schema_migrations VALUES('0002',$1)", [
        terminal.sources().migrationSha256,
      ]);
      await business.query('COMMIT');
      await native.query('BEGIN');
      await native.query('SET LOCAL ROLE zhiban_openmaic_owner');
      await native.query(fs.readFileSync(path.join(candidate, '08-native-proof-acl.sql'), 'utf8'));
      await native.query('COMMIT');
      state.after = await terminal.collectAfter(business, native);
    }
    await business.end();
    await native.end();
    await admin.end();
  } finally {
    for (const c of bootstrapClients)
      try {
        await c.end();
      } catch {}
  }
}
async function directed(state) {
  const assert = require('node:assert/strict');
  const candidate = path.join(root, 'docs/v2/candidates/m5-terminal');
  const results = [];
  const clients = [];
  const id = (n) => `0199aabb-ccdd-7000-8000-${n.toString().padStart(12, '0')}`;
  const deployment = id(1),
    old = id(2),
    next = id(3),
    request = id(4),
    tenant = id(5),
    resource = id(6),
    operation = id(7),
    prep = id(8),
    slot = id(9),
    actor = id(10),
    lookup = id(11),
    lookupRequest = id(12),
    later = id(13),
    laterRequest = id(14);
  const secret = 'a'.repeat(64),
    lookupSecret = 'b'.repeat(64),
    provenance = 'c'.repeat(64),
    hash = crypto.createHash('sha256').update(secret).digest('hex');
  async function connect(db = 'zhiban_m1_dev', user = 'postgres') {
    const c = new Client({ host: state.socket, port: state.port, database: db, user });
    await c.connect();
    clients.push(c);
    return c;
  }
  async function test(name, work) {
    await work();
    results.push({ name, status: 'PASS' });
    console.log('PASS', name);
  }
  async function rejects(work) {
    await assert.rejects(work);
  }
  async function profiles(b, n) {
    return {
      business: (
        await b.query(fs.readFileSync(path.join(candidate, '09-catalog-inspect.sql'), 'utf8'))
      ).rows[0].terminal_catalog,
      native: (
        await n.query(
          fs.readFileSync(path.join(candidate, '10-native-catalog-inspect.sql'), 'utf8'),
        )
      ).rows[0].terminal_native_catalog,
    };
  }
  async function profileCheck(expected, actual, shouldPass) {
    const e = path.join(state.dir, 'expected.json'),
      a = path.join(state.dir, 'actual.json');
    fs.writeFileSync(e, JSON.stringify(expected));
    fs.writeFileSync(a, JSON.stringify(actual));
    let pass = true;
    try {
      execFileSync(
        'python3',
        [path.join(candidate, 'verify-profile.py'), '--expected', e, '--actual', a],
        { stdio: 'pipe' },
      );
    } catch {
      pass = false;
    }
    assert.equal(pass, shouldPass);
  }
  async function authorize(admin, controller) {
    await admin.query(
      `INSERT INTO zhiban_reconcile.controller_authorizations(deployment_id,token_digest,backend_pid,backend_start,nonce_digest,expires_at,provenance_digest,status)
 SELECT $1,$2,pid,backend_start,$3,(extract(epoch FROM clock_timestamp())*1000)::bigint+300000,$3,'ACTIVE' FROM pg_stat_activity WHERE pid=$4
 ON CONFLICT(deployment_id) DO UPDATE SET backend_pid=excluded.backend_pid,backend_start=excluded.backend_start,expires_at=excluded.expires_at`,
      [deployment, hash, provenance, controller.processID],
    );
  }
  try {
    let business = await connect();
    const native = await connect('zhiban_m5_native');
    const admin = await connect('postgres');
    await test('new UUID domain accepts nullable initial-window field', async () => {
      assert.equal((await business.query('SELECT NULL::zhiban_reconcile.v7 v')).rows[0].v, null);
    });
    await test('new UUID domain still rejects non-v7 and required NULL ids', async () => {
      await assert.rejects(
        () => business.query("SELECT '00000000-0000-4000-8000-000000000000'::zhiban_reconcile.v7"),
        { code: '23514' },
      );
      await assert.rejects(
        () => business.query('INSERT INTO zhiban_reconcile.windows(window_id) VALUES(NULL)'),
        { code: '23502', column: 'window_id' },
      );
    });
    await test('closed profile accepts exact isolated fixture', async () => {
      const p = await profiles(business, native);
      await profileCheck(p, p, true);
    });
    const baseline = await profiles(business, native);
    for (const [name, c, sql] of [
      [
        'Native whole-table UPDATE drift',
        native,
        'GRANT UPDATE ON public.document_stages TO zhiban_reconcile_native_proof',
      ],
      [
        'Native necessary id privilege revoked',
        native,
        'REVOKE UPDATE(id) ON public.document_stages FROM zhiban_reconcile_native_proof',
      ],
      ['PUBLIC table UPDATE drift', native, 'GRANT UPDATE ON public.document_stages TO PUBLIC'],
      [
        'PUBLIC column UPDATE drift',
        native,
        'GRANT UPDATE(payload) ON public.document_stages TO PUBLIC',
      ],
      [
        'observer whole subscription SELECT drift',
        business,
        'GRANT SELECT ON pg_catalog.pg_subscription TO zhiban_reconcile_observer',
      ],
      [
        'observer explicit control function ACL drift',
        business,
        'REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM zhiban_reconcile_observer',
      ],
      [
        'cross-database CONNECT drift',
        admin,
        'GRANT CONNECT ON DATABASE zhiban_m5_native TO zhiban_reconcile_executor',
      ],
      ['PUBLIC database CREATE drift', admin, 'GRANT CREATE ON DATABASE zhiban_m1_dev TO PUBLIC'],
    ])
      await test(name, async () => {
        await c.query('BEGIN');
        await c.query(sql);
        if (c === admin) await c.query('COMMIT');
        await profileCheck(baseline, await profiles(business, native), false);
        if (c === admin) await c.query(sql.replace('GRANT', 'REVOKE').replace(' TO ', ' FROM '));
        else await c.query('ROLLBACK');
      });
    await test('missing collector part rejected', async () => {
      await profileCheck(baseline, { business: baseline.business }, false);
    });
    // Synthetic scope fixture only: privileged replica seeding bypasses FK/trigger
    // setup for unrelated product objects. Full reconciliation acceptance NOT tested.
    const catalogs = (
      await business.query(
        "SELECT (SELECT system_identifier::text FROM pg_control_system()) cluster,pg_postmaster_start_time() start,(SELECT oid FROM pg_database WHERE datname='zhiban_m1_dev') business,(SELECT oid FROM pg_database WHERE datname='zhiban_m5_native') native",
      )
    ).rows[0];
    await business.query('BEGIN');
    await business.query("SET LOCAL session_replication_role='replica'");
    await business.query(
      `INSERT INTO zhiban_bridge.deployment_registry VALUES($1,'fixture',$2,'0.31.1','0.11.2','0.1.11',$3,'VERIFIED',1,0,0)`,
      [deployment, 'd'.repeat(40), provenance],
    );
    await business.query(
      `INSERT INTO zhiban_reconcile.installations VALUES($1,'terminal-reconciliation-local-v1',$2,$3,$4,$5,$5,$5,$5,$5,true)`,
      [deployment, catalogs.cluster, catalogs.business, catalogs.native, provenance],
    );
    await business.query(
      `INSERT INTO zhiban_reconcile.services VALUES('fixture-service',$1,'RECONCILE',1,'ACTIVE','zhiban_reconcile_executor')`,
      [deployment],
    );
    await business.query(
      `INSERT INTO zhiban_reconcile.service_versions VALUES('fixture-service',1,'ACTIVE',$1,0)`,
      [provenance],
    );
    await business.query(`INSERT INTO zhiban_reconcile.epoch_counters VALUES($1,1)`, [deployment]);
    await business.query(
      `INSERT INTO zhiban_reconcile.windows(window_id,service_ref,deployment_id,epoch,phase,cluster_identifier,business_oid,native_oid,postmaster_start,nonce_digest,build_digest,allowlist,lease_until,created_at)
 VALUES($1,'fixture-service',$2,1,'BLOCKED',$3,$4,$5,$6,$7,$7,$8,1,0)`,
      [
        old,
        deployment,
        catalogs.cluster,
        catalogs.business,
        catalogs.native,
        catalogs.start,
        provenance,
        JSON.stringify([
          {
            pid: -1,
            start: '2000-01-01T00:00:00+00:00',
            role: 'zhiban_reconcile_controller',
            databaseOid: String(catalogs.business),
            type: 'client backend',
          },
        ]),
      ],
    );
    await business.query(
      `INSERT INTO zhiban_reconcile.window_database_claims VALUES($1,$2,$4),($1,$3,$4)`,
      [catalogs.cluster, catalogs.business, catalogs.native, old],
    );
    await business.query(
      `INSERT INTO zhiban_content.resources VALUES($1,$2,$3,'SLIDE_CONTENT','content-text-v1','fixture',$4,'DRAFT',1,NULL,0,$5,$5,0,0)`,
      [
        tenant,
        resource,
        id(20),
        { title: 'fixture', slides: [{ id: id(21), elements: [] }] },
        actor,
      ],
    );
    await business.query(
      `INSERT INTO zhiban_bridge.resource_slots(tenant_id,slot_id,activity_id,deployment_id,owner_membership_id,state,last_generation,repository_revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'SUSPENDED',0,2,0,0)`,
      [tenant, slot, resource, deployment, actor],
    );
    await business.query(
      `INSERT INTO zhiban_bridge.operations(tenant_id,operation_id,slot_id,generation_id,actor_kind,actor_user_id,actor_membership_id,operation,actor_key,key_digest,intent_digest,expected_slot_revision,reserved_slot_revision,expected_authorization_version,state,repository_revision,reserved_stage_ref,created_at,updated_at,reason)
 VALUES($1,$2,$3,$4,'USER',$5,$5,'PREPARE_CONTENT',$6,$7,$7,1,2,1,'RESERVED',1,'stage',0,0,'NONE')`,
      [tenant, prep, slot, id(22), actor, `user:${actor}`, provenance],
    );
    await business.query(
      `INSERT INTO zhiban_content.operations(tenant_id,id,resource_id,actor_id,action,key_digest,intent_digest,state,source_revision,source_digest,expected_native_digest,prepare_operation_id,created_at) VALUES($1,$2,$3,$4,'PUBLISH_CONTENT',$5,$5,'RESERVED',1,$5,$5,$6,0)`,
      [tenant, operation, resource, actor, provenance, prep],
    );
    await business.query('COMMIT');
    await business.query('ALTER ROLE zhiban_reconcile_controller LOGIN');
    await business.query('ALTER ROLE zhiban_reconcile_executor LOGIN');
    await business.query('ALTER ROLE zhiban_reconcile_issuer LOGIN');
    await business.query('ALTER ROLE zhiban_bridge_runtime LOGIN');
    const controller = await connect('zhiban_m1_dev', 'zhiban_reconcile_controller');
    await authorize(business, controller);
    await controller.query("SELECT set_config('app.tenant_id',$1,false)", [tenant]);
    const queryTake = (o = old, n = next, r = request, d = deployment, token = secret) =>
      controller.query('SELECT zhiban_reconcile.read_takeover_result($1,$2,$3,$4,$5) value', [
        d,
        o,
        n,
        r,
        token,
      ]);
    await test('exact uncommitted takeover reports NOT_OBSERVED, replay false', async () => {
      const q = (await queryTake()).rows[0].value;
      assert.equal(q.status, 'NOT_OBSERVED');
      assert.equal(q.currentWindowId, old);
      assert.equal(q.replayAllowed, false);
    });
    await test('recovery ACK wiring observes NOT_OBSERVED without replay authority or secret journal', async () => {
      const f = path.join(state.dir, 'ack-before.jsonl');
      const r = await recovery.readTakeoverAck({
        controller,
        request: {
          deploymentId: deployment,
          oldWindowId: old,
          newWindowId: next,
          takeoverRequestId: request,
        },
        controllerSecret: secret,
        ackJournalPath: f,
      });
      assert.equal(r.ack.status, 'NOT_OBSERVED');
      assert.equal(r.replayAllowed, false);
      assert.ok(!fs.readFileSync(f, 'utf8').includes(secret));
    });
    await test('wrong deployment/window/secret rejected', async () => {
      await rejects(() => queryTake(old, next, request, id(31)));
      await rejects(() => queryTake(id(32)));
      await rejects(() => queryTake(old, next, request, deployment, 'f'.repeat(64)));
    });
    await test('controller raw windows/claims SELECT denied', async () => {
      await rejects(() => controller.query('SELECT * FROM zhiban_reconcile.windows'));
      await rejects(() =>
        controller.query('SELECT * FROM zhiban_reconcile.window_database_claims'),
      );
    });
    // Audit lifecycle and transactional rollback.
    const issue = (l = lookup, prov = provenance) =>
      controller.query('SELECT zhiban_reconcile.issue_result_lookup($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        tenant,
        l,
        deployment,
        operation,
        lookupRequest,
        'zhiban_reconcile_executor',
        lookupSecret,
        prov,
        secret,
      ]);
    const revoke = (prov = provenance) =>
      controller.query('SELECT zhiban_reconcile.revoke_result_lookup($1,$2,$3,$4)', [
        tenant,
        lookup,
        prov,
        secret,
      ]);
    await test('lookup issue event bound to scope, identity and provenance', async () => {
      await issue();
      const events = (
        await business.query(
          "SELECT * FROM zhiban_reconcile.control_events WHERE event_type='LOOKUP_ISSUED'",
        )
      ).rows;
      assert.equal(events.length, 1);
      assert.equal(events[0].facts.lookupId, lookup);
      assert.equal(events[0].facts.requestId, lookupRequest);
      assert.equal(events[0].actor_role, 'zhiban_reconcile_controller');
      assert.equal(events[0].provenance_digest, provenance);
      assert.ok(!JSON.stringify(events).includes(lookupSecret));
    });
    await test('invalid issue provenance rejected without permission', async () => {
      await rejects(() => issue(id(40), null));
      assert.equal(
        (
          await business.query(
            'SELECT count(*)::int n FROM zhiban_reconcile.lookup_permissions WHERE lookup_id=$1',
            [id(40)],
          )
        ).rows[0].n,
        0,
      );
    });
    await test('issue audit insertion failure rolls back prior permission write', async () => {
      // Only the disposable fixture: valid input reaches AFTER permission insert.
      await business.query(`CREATE FUNCTION public.fail_lookup_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.event_type='LOOKUP_ISSUED' THEN RAISE EXCEPTION 'fixture audit failure' USING ERRCODE='ZX001'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_lookup_audit_fixture BEFORE INSERT ON zhiban_reconcile.control_events FOR EACH ROW EXECUTE FUNCTION public.fail_lookup_audit_fixture()`);
      try {
        await assert.rejects(() => issue(id(41), provenance), { code: 'ZX001' });
        assert.equal(
          (
            await business.query(
              'SELECT count(*)::int n FROM zhiban_reconcile.lookup_permissions WHERE lookup_id=$1',
              [id(41)],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await business.query(
              "SELECT count(*)::int n FROM zhiban_reconcile.control_events WHERE facts->>'lookupId'=$1",
              [id(41)],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await business.query(
          'DROP TRIGGER fail_lookup_audit_fixture ON zhiban_reconcile.control_events; DROP FUNCTION public.fail_lookup_audit_fixture()',
        );
      }
    });
    await test('revoke audit error rolls back status', async () => {
      await rejects(() => revoke(null));
      assert.equal(
        (
          await business.query(
            'SELECT status FROM zhiban_reconcile.lookup_permissions WHERE lookup_id=$1',
            [lookup],
          )
        ).rows[0].status,
        'ACTIVE',
      );
    });
    const executor = await connect('zhiban_m1_dev', 'zhiban_reconcile_executor');
    await executor.query("SELECT set_config('app.tenant_id',$1,false)", [tenant]);
    await test('lookup revocation serializes behind result reader', async () => {
      await executor.query('BEGIN');
      await executor.query('SELECT zhiban_reconcile.read_resolution($1,$2,$3,$4,$5)', [
        tenant,
        operation,
        lookupRequest,
        lookup,
        lookupSecret,
      ]);
      await controller.query("SET lock_timeout='100ms'");
      await assert.rejects(() => revoke(), { code: '55P03' });
      await executor.query('COMMIT');
      await controller.query("SET lock_timeout='0'");
      await revoke();
    });
    await test('repeat revoke emits one immutable event', async () => {
      await revoke();
      assert.equal(
        (
          await business.query(
            "SELECT count(*)::int n FROM zhiban_reconcile.control_events WHERE event_type='LOOKUP_REVOKED'",
          )
        ).rows[0].n,
        1,
      );
      await rejects(() =>
        business.query(
          "UPDATE zhiban_reconcile.control_events SET facts='{}' WHERE event_type='LOOKUP_REVOKED'",
        ),
      );
    });
    await test('revoked lookup and wrong tenant denied', async () => {
      await rejects(() =>
        executor.query('SELECT zhiban_reconcile.read_resolution($1,$2,$3,$4,$5)', [
          tenant,
          operation,
          lookupRequest,
          lookup,
          lookupSecret,
        ]),
      );
      await rejects(() =>
        controller.query('SELECT zhiban_reconcile.revoke_result_lookup($1,$2,$3,$4)', [
          id(99),
          lookup,
          provenance,
          secret,
        ]),
      );
    });
    await executor.end();
    await admin.query('GRANT CONNECT ON DATABASE zhiban_m1_dev TO zhiban_bridge_runtime');
    const runtime = await connect('zhiban_m1_dev', 'zhiban_bridge_runtime');
    await test('runtime cannot use takeover lookup', async () => {
      await rejects(() =>
        runtime.query('SELECT zhiban_reconcile.read_takeover_result($1,$2,$3,$4,$5)', [
          deployment,
          old,
          next,
          request,
          secret,
        ]),
      );
    });
    await runtime.end();
    await native.end();
    await admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS false');
    await admin.query('ALTER ROLE zhiban_bridge_runtime NOLOGIN');
    await business.end();
    await test('fresh sole controller commits atomic takeover', async () => {
      await controller.query('SELECT zhiban_reconcile.takeover_blocked_window($1,$2,$3,$4,$5)', [
        old,
        next,
        request,
        provenance,
        secret,
      ]);
      const q = (await queryTake()).rows[0].value;
      assert.equal(q.status, 'COMMITTED');
      assert.equal(q.successorIsCurrent, true);
      assert.equal(q.currentEpoch, '2');
      assert.ok(q.claims.every((v) => v.windowId === next));
    });
    await test('recovery ACK wiring observes committed exact pair with no takeover DML', async () => {
      const r = await recovery.readTakeoverAck({
        controller,
        request: {
          deploymentId: deployment,
          oldWindowId: old,
          newWindowId: next,
          takeoverRequestId: request,
        },
        controllerSecret: secret,
        ackJournalPath: path.join(state.dir, 'ack-after.jsonl'),
      });
      assert.equal(r.ack.status, 'COMMITTED');
      assert.equal(r.ack.newEpoch, '2');
      assert.equal(r.replayAllowed, false);
    });
    await test('same takeover not replayed and wrong request/new rejected', async () => {
      await rejects(() =>
        controller.query('SELECT zhiban_reconcile.takeover_blocked_window($1,$2,$3,$4,$5)', [
          old,
          next,
          request,
          provenance,
          secret,
        ]),
      );
      await rejects(() => queryTake(old, id(33), request));
      await rejects(() => queryTake(old, next, id(34)));
    });
    // Fresh controller with same durable request after lost acknowledgement.
    await controller.end();
    business = await connect();
    const restored = await connect('zhiban_m1_dev', 'zhiban_reconcile_controller');
    await authorize(business, restored);
    await business.end();
    await test('fresh backend recovers committed acknowledgement', async () => {
      const q = (
        await restored.query('SELECT zhiban_reconcile.read_takeover_result($1,$2,$3,$4,$5) value', [
          deployment,
          old,
          next,
          request,
          secret,
        ])
      ).rows[0].value;
      assert.equal(q.status, 'COMMITTED');
      assert.equal(q.successorIsCurrent, true);
    });
    await test('successor further superseded preserves historical query', async () => {
      await restored.query('SELECT zhiban_reconcile.takeover_blocked_window($1,$2,$3,$4,$5)', [
        next,
        later,
        laterRequest,
        'd'.repeat(64),
        secret,
      ]);
      const q = (
        await restored.query('SELECT zhiban_reconcile.read_takeover_result($1,$2,$3,$4,$5) value', [
          deployment,
          old,
          next,
          request,
          secret,
        ])
      ).rows[0].value;
      assert.equal(q.status, 'COMMITTED');
      assert.equal(q.successorIsCurrent, false);
      assert.equal(q.currentWindowId, later);
      assert.equal(q.currentEpoch, '3');
    });

    await test('recovery ACK commit acknowledgement loss is BLOCKED and never retried', async () => {
      const query = restored.query.bind(restored);
      let commits = 0;
      restored.query = async (sql, args) => {
        const r = await query(sql, args);
        if (sql === 'COMMIT') {
          commits++;
          throw Error('DISPOSABLE_ACK_LOST');
        }
        return r;
      };
      const f = path.join(state.dir, 'ack-lost.jsonl'),
        ctx = {
          controller: restored,
          request: {
            deploymentId: deployment,
            oldWindowId: old,
            newWindowId: next,
            takeoverRequestId: request,
          },
          controllerSecret: secret,
          ackJournalPath: f,
        };
      await assert.rejects(() => recovery.readTakeoverAck(ctx));
      await assert.rejects(() => recovery.readTakeoverAck(ctx));
      assert.equal(commits, 1);
      const journal = fs.readFileSync(f, 'utf8');
      assert.ok(journal.includes('ACK_UNKNOWN_OR_UNAUTHORIZED'));
      assert.ok(!journal.includes(secret));
    });
    return {
      checks: results,
      pgMajor: 16,
      scope:
        'disposable candidate DDL/controller/lookup/ACL; synthetic product fixtures, minimal Native tables',
    };
  } finally {
    for (const c of clients)
      try {
        await c.end();
      } catch {}
  }
}

async function installerDirected(reference, injectFailure = false) {
  const assert = require('node:assert/strict');
  const results = [];
  const state = {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-terminal-install-')),
    port: 56491,
  };
  fs.chmodSync(state.dir, 0o700);
  const clients = [];
  const source = terminal.sources();
  const pair = crypto.generateKeyPairSync('ed25519');
  const put = (name, value) => {
    const file = path.join(state.dir, name);
    fs.writeFileSync(file, value, { mode: 0o600 });
    return file;
  };
  const publicFile = put('pin.pem', pair.publicKey.export({ format: 'pem', type: 'spki' }));
  const privateFile = put('issuer.pem', pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  const pin = terminal.publicPin(publicFile);
  const envelope = (p) =>
    terminal.signed(
      {
        formatVersion: 1,
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        authorityKeySha256: pin.digest,
        ...p,
      },
      fs.readFileSync(privateFile),
      pin,
    );
  const expected = envelope({
    purpose: 'REVIEWED_TERMINAL_EXPECTED_PROFILE',
    profile: 'terminal-reconciliation-local-v1',
    candidateInventorySha256: source.inventorySha256,
    candidateMigrationSha256: source.migrationSha256,
    review: {
      approvalRef: 'LOCAL_DISPOSABLE_SHADOW_FIXTURE_ONLY',
      sourceKind: 'INDEPENDENT_SHADOW_PG16',
      referenceEvidenceSha256: terminal.sha(
        terminal.canonical({ before: reference.before, after: reference.after }),
      ),
    },
    before: reference.before,
    after: reference.after,
  });
  const expectedFile = put('expected.json', JSON.stringify(expected));
  const test = async (name, fn) => {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS', name);
  };
  try {
    await bootstrap(state, { legacyOnly: true });
    for (const [name, db] of [
      ['admin', 'postgres'],
      ['business', 'zhiban_m1_dev'],
      ['native', 'zhiban_m5_native'],
    ]) {
      const c = new Client({
        host: state.socket,
        port: state.port,
        database: db,
        user: 'postgres',
      });
      await c.connect();
      clients.push(c);
      state[name] = c;
    }
    const ctx = {
      admin: state.admin,
      business: state.business,
      native: state.native,
      trustPinPath: publicFile,
      expectedPath: expectedFile,
      issuerKeyPath: privateFile,
      receiptPath: path.join(state.dir, 'receipt.json'),
      journalPath: path.join(state.dir, 'journal.jsonl'),
      closeAdmissions: true,
    };
    const target = await terminal.targetFacts(ctx.admin, ctx.business, ctx.native);
    const authorization = envelope({
      purpose: 'INSTALL_LOCAL_TERMINAL_BLOCKED',
      approvalRef: 'LOCAL_DISPOSABLE_INSTALL_FIXTURE_ONLY',
      expectedArtifactSha256: terminal.sha(fs.readFileSync(expectedFile)),
      candidateInventorySha256: source.inventorySha256,
      target,
      expiresAt: Date.now() + 290000,
      maintenanceAttestation: 'HOST_STOPPED_KEEP_BOTH_DATABASES_CLOSED',
    });
    ctx.approvalPath = put('approval.json', JSON.stringify(authorization));
    if (injectFailure === 'late-barrier') {
      await test('installer rejects admission drift after last catalog query before signing', async () => {
        const realQuery = ctx.native.query.bind(ctx.native),
          sql = fs.readFileSync(path.join(__dirname, '10-native-catalog-inspect.sql'), 'utf8');
        let injected = false;
        ctx.native.query = async (q, args) => {
          const r = await realQuery(q, args);
          if (q === sql) {
            injected = true;
            await ctx.admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS true');
          }
          return r;
        };
        await assert.rejects(() => terminal.installBlocked(ctx));
        ctx.native.query = realQuery;
        assert.ok(injected);
        assert.equal(fs.existsSync(ctx.receiptPath), false);
        assert.ok(fs.readFileSync(ctx.journalPath, 'utf8').includes('BLOCKED'));
        // Harness closes a deliberately opened gate; installer never claims it stayed closed.
        await ctx.admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS false');
      });
      return results;
    }
    if (injectFailure) {
      await test('Native installation failure preserves Business ledger and BLOCKED journal without receipt or reopen', async () => {
        const realQuery = ctx.native.query.bind(ctx.native);
        const nativeSql = fs.readFileSync(path.join(__dirname, '08-native-proof-acl.sql'), 'utf8');
        ctx.native.query = async (sql, args) => {
          if (sql === nativeSql) throw Error('DISPOSABLE_NATIVE_INSTALL_FAILURE');
          return realQuery(sql, args);
        };
        await assert.rejects(() => terminal.installBlocked(ctx), {
          message:
            'Terminal installation blocked; keep admissions closed and inspect private journal',
        });
        ctx.native.query = realQuery;
        assert.equal(fs.existsSync(ctx.receiptPath), false);
        assert.equal(
          (
            await ctx.business.query(
              "SELECT count(*)::int n FROM zhiban_content.schema_migrations WHERE version='0002'",
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await ctx.admin.query(
              "SELECT bool_or(datallowconn) open FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
            )
          ).rows[0].open,
          false,
        );
        assert.equal(
          (
            await ctx.native.query(
              "SELECT has_table_privilege('zhiban_reconcile_native_proof','public.document_stages','SELECT') allowed",
            )
          ).rows[0].allowed,
          false,
        );
        assert.ok(fs.readFileSync(ctx.journalPath, 'utf8').includes('BLOCKED'));
        assert.equal(
          (await ctx.business.query('SELECT count(*)::int n FROM zhiban_reconcile.installations'))
            .rows[0].n,
          0,
        );
      });
      await test('recovery observation classifies partial installation from actual ledgers/catalog and bound journal', async () => {
        const r = await recovery.inspectPartialInstallation({
          ...ctx,
          installJournalPath: ctx.journalPath,
        });
        assert.equal(r.observedStatus, 'BUSINESS_LEDGER_PRESENT_CATALOG_INCOMPLETE_OR_DRIFTED');
        assert.equal(r.replayAllowed, false);
        assert.equal(r.requiresFreshApproval, true);
        assert.equal(r.lastRecordedStatus, 'BLOCKED');
      });
      await test('broker adopts partial installation and retains closed physical sessions without replay', async () => {
        const broker = await adoptTechnicalBroker(
          { ...ctx, installJournalPath: ctx.journalPath },
          'partial-recovery',
        );
        assert.equal(broker.status().state, 'HELD_BLOCKED_RECOVERY_OBSERVATION');
        assert.equal(
          broker.status().observedInstallationStatus,
          'BUSINESS_LEDGER_PRESENT_CATALOG_INCOMPLETE_OR_DRIFTED',
        );
        await broker.inspect();
        assert.equal(broker.status().terminalActionsAllowed, false);
        await broker.close();
      });
      return results;
    }
    await test('reviewed shadow profile passes fixed authority/source verification', async () => {
      assert.equal(
        terminal.trustedExpected(expectedFile, pin).payload.review.sourceKind,
        'INDEPENDENT_SHADOW_PG16',
      );
    });
    await test('unsigned actual-as-expected and altered signature rejected', async () => {
      const p = put('unsigned.json', JSON.stringify(reference.after));
      assert.throws(() => terminal.trustedExpected(p, pin));
      const altered = structuredClone(expected);
      altered.payload.review.approvalRef = 'tampered';
      const f = put('altered.json', JSON.stringify(altered));
      assert.throws(() => terminal.trustedExpected(f, pin));
    });
    await test('signed wrong expected source and LIVE_TARGET reference rejected', async () => {
      for (const changes of [
        { candidateMigrationSha256: 'f'.repeat(64) },
        { review: { ...expected.payload.review, sourceKind: 'LIVE_TARGET' } },
      ]) {
        const f = put(
          'wrong-source.json',
          JSON.stringify(envelope({ ...expected.payload, ...changes })),
        );
        assert.throws(() => terminal.trustedExpected(f, pin));
      }
    });
    await test('untrusted authority pin and nonprivate artifact rejected', async () => {
      const wrong = crypto.generateKeyPairSync('ed25519');
      const f = put('wrong-pin.pem', wrong.publicKey.export({ format: 'pem', type: 'spki' }));
      assert.throws(() => terminal.trustedExpected(expectedFile, terminal.publicPin(f)));
      fs.chmodSync(expectedFile, 0o644);
      assert.throws(() => terminal.trustedExpected(expectedFile, pin));
      fs.chmodSync(expectedFile, 0o600);
    });
    await test('wrong target and expired install approval reject before DDL', async () => {
      for (const changes of [
        { target: { ...target, clusterSystemIdentifier: '0' } },
        { expiresAt: Date.now() - 1 },
      ]) {
        const f = put(
          'wrong-approval.json',
          JSON.stringify(envelope({ ...authorization.payload, ...changes })),
        );
        await assert.rejects(() => terminal.installBlocked({ ...ctx, approvalPath: f }));
      }
      assert.equal(
        (
          await ctx.business.query(
            "SELECT count(*)::int n FROM pg_namespace WHERE nspname='zhiban_reconcile'",
          )
        ).rows[0].n,
        0,
      );
    });
    await test('unreviewed Business CONNECT ACL is rejected before admission or DDL', async () => {
      await ctx.admin.query('CREATE ROLE unreviewed_connect_fixture NOLOGIN');
      await ctx.admin.query(
        'GRANT CONNECT ON DATABASE zhiban_m1_dev TO unreviewed_connect_fixture',
      );
      try {
        await assert.rejects(() => terminal.installBlocked(ctx), {
          message: 'Unreviewed Business admission ACL',
        });
      } finally {
        await ctx.admin.query(
          'REVOKE CONNECT ON DATABASE zhiban_m1_dev FROM unreviewed_connect_fixture',
        );
        await ctx.admin.query('DROP ROLE unreviewed_connect_fixture');
      }
      assert.equal(
        (
          await ctx.admin.query(
            "SELECT bool_and(datallowconn) open FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
          )
        ).rows[0].open,
        true,
      );
    });
    await test('pre-install profile drift rejected before DDL/admission change', async () => {
      await ctx.native.query(
        'CREATE FUNCTION public.before_profile_drift_fixture() RETURNS int LANGUAGE sql AS $$SELECT 1$$',
      );
      try {
        await assert.rejects(() => terminal.installBlocked(ctx), {
          message: 'Reviewed pre-install profile drift',
        });
        assert.equal(
          (
            await ctx.admin.query(
              "SELECT bool_and(datallowconn) open FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
            )
          ).rows[0].open,
          true,
        );
      } finally {
        await ctx.native.query('DROP FUNCTION public.before_profile_drift_fixture()');
      }
    });
    let receipt;
    await test('real installer matches independent shadow profile and commits ledger atomically', async () => {
      receipt = await terminal.installBlocked(ctx);
      assert.equal(receipt.payload.status, 'INSTALLED_BLOCKED');
      assert.equal(receipt.payload.runtimeAccepted, false);
      assert.equal(receipt.payload.installationReady, false);
      assert.equal(
        (
          await ctx.business.query(
            "SELECT checksum FROM zhiban_content.schema_migrations WHERE version='0002'",
          )
        ).rows[0].checksum,
        source.migrationSha256,
      );
      assert.ok(fs.readFileSync(ctx.journalPath, 'utf8').includes('CONFIRMED'));
    });
    await test('receipt loader accepts blocked technical purpose while retaining isolation', async () => {
      const r = await terminal.loadBlockedReceipt(ctx);
      assert.equal(r.status, 'LOCAL_TERMINAL_TECHNICAL_INSTALLED_BLOCKED');
      assert.equal(r.terminalActionsAllowed, false);
      assert.equal(
        (
          await ctx.admin.query(
            "SELECT bool_or(datallowconn) open FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
          )
        ).rows[0].open,
        false,
      );
    });
    await test('recovery observation confirms both actual profiles without reissuing receipt', async () => {
      const r = await recovery.inspectPartialInstallation({
        ...ctx,
        installJournalPath: ctx.journalPath,
      });
      assert.equal(r.observedStatus, 'BOTH_CATALOGS_MATCH_BLOCKED');
      assert.equal(r.replayAllowed, false);
      assert.deepEqual(JSON.parse(fs.readFileSync(ctx.receiptPath, 'utf8')), receipt);
    });
    await test('repeat installation rejected without replaying migrations', async () => {
      await assert.rejects(() => terminal.installBlocked(ctx));
      assert.equal(
        (await ctx.business.query('SELECT count(*)::int n FROM zhiban_content.schema_migrations'))
          .rows[0].n,
        2,
      );
    });
    await test('receipt tamper and signed false runtime acceptance rejected', async () => {
      const broken = structuredClone(receipt);
      broken.payload.runtimeAccepted = true;
      const f = put('bad-receipt.json', JSON.stringify(broken));
      await assert.rejects(() => terminal.loadBlockedReceipt({ ...ctx, receiptPath: f }));
      const g = put('bad-semantic-receipt.json', JSON.stringify(envelope(broken.payload)));
      await assert.rejects(() => terminal.loadBlockedReceipt({ ...ctx, receiptPath: g }));
    });
    await test('loader rejects Native PUBLIC function/default privilege drift', async () => {
      await ctx.native.query(
        'CREATE FUNCTION public.unreviewed_native_function() RETURNS int LANGUAGE sql AS $$SELECT 1$$',
      );
      try {
        await assert.rejects(() => terminal.loadBlockedReceipt(ctx));
      } finally {
        await ctx.native.query('DROP FUNCTION public.unreviewed_native_function()');
      }
      await ctx.native.query(
        'ALTER DEFAULT PRIVILEGES FOR ROLE zhiban_openmaic_owner GRANT SELECT ON TABLES TO zhiban_reconcile_native_proof',
      );
      try {
        await assert.rejects(() => terminal.loadBlockedReceipt(ctx));
      } finally {
        await ctx.native.query(
          'ALTER DEFAULT PRIVILEGES FOR ROLE zhiban_openmaic_owner REVOKE SELECT ON TABLES FROM zhiban_reconcile_native_proof',
        );
      }
    });
    await test('loader rejects table ACL/role LOGIN and ledger drift', async () => {
      await ctx.native.query(
        'GRANT UPDATE ON public.document_stages TO zhiban_reconcile_native_proof',
      );
      try {
        await assert.rejects(() => terminal.loadBlockedReceipt(ctx));
      } finally {
        await ctx.native.query(
          'REVOKE UPDATE ON public.document_stages FROM zhiban_reconcile_native_proof',
        );
        await ctx.native.query(
          'GRANT UPDATE(id) ON public.document_stages TO zhiban_reconcile_native_proof',
        );
      }
      await ctx.admin.query('ALTER ROLE zhiban_reconcile_executor LOGIN');
      try {
        await assert.rejects(() => terminal.loadBlockedReceipt(ctx));
      } finally {
        await ctx.admin.query('ALTER ROLE zhiban_reconcile_executor NOLOGIN');
      }
      await ctx.business.query("DELETE FROM zhiban_content.schema_migrations WHERE version='0002'");
      try {
        await assert.rejects(() => terminal.loadBlockedReceipt(ctx));
      } finally {
        await ctx.business.query("INSERT INTO zhiban_content.schema_migrations VALUES('0002',$1)", [
          source.migrationSha256,
        ]);
      }
    });
    await test('loader rejects opened admission; close remains required', async () => {
      await ctx.admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS true');
      try {
        await assert.rejects(() => terminal.loadBlockedReceipt(ctx));
      } finally {
        await ctx.admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS false');
      }
    });
    await test('restored exact profile accepted; no services or ready installation seeded', async () => {
      assert.equal((await terminal.loadBlockedReceipt(ctx)).installationReady, false);
      assert.equal(
        (await ctx.business.query('SELECT count(*)::int n FROM zhiban_reconcile.services')).rows[0]
          .n,
        0,
      );
      assert.equal(
        (await ctx.business.query('SELECT count(*)::int n FROM zhiban_reconcile.installations'))
          .rows[0].n,
        0,
      );
    });
    return results;
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    const data = path.join(state.dir, 'data');
    if (fs.existsSync(path.join(data, 'postmaster.pid')))
      execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], {
        stdio: 'ignore',
      });
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
}

if (require.main === module)
  (async () => {
    const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, 'inventory.json'), 'utf8'));
    for (const [name, expected] of Object.entries(inventory.filesSha256))
      if (sha(path.join(__dirname, name)) !== expected)
        throw Error('Candidate source binding drift');
    for (const [name, expected] of Object.entries(inventory.prerequisitesSha256))
      if (sha(path.join(root, name)) !== expected) throw Error('Applied prerequisite source drift');
    const state = {
      dir: fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-terminal-r3-')),
      port: 56491,
    };
    fs.chmodSync(state.dir, 0o700);
    let result;
    try {
      await bootstrap(state);
      result = await directed(state);
    } finally {
      const data = path.join(state.dir, 'data');
      // Stop only the uniquely created checkout-owned temporary cluster.
      if (fs.existsSync(path.join(data, 'postmaster.pid')))
        execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], {
          stdio: 'ignore',
        });
      fs.rmSync(state.dir, { recursive: true, force: true });
    }
    const installationChecks = await installerDirected(state);
    const failureChecks = await installerDirected(state, true);
    const lateBarrierChecks = await installerDirected(state, 'late-barrier');
    result.checks.push(...installationChecks, ...failureChecks, ...lateBarrierChecks);
    const evidence = {
      formatVersion: 1,
      kind: 'LOCAL_M5_TERMINAL_INSTALLER_WIRING_DIRECTED',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      gitBaselineSha: inventory.gitBaselineSha,
      candidateInventorySha256: sha(path.join(__dirname, 'inventory.json')),
      candidateMigrationSha256: inventory.migration.aggregateSha256,
      status: 'PASS',
      ...result,
      disposableClusterOnly: true,
      tcpListening: false,
      existingClustersConnected: false,
      appliedToExistingDatabase: false,
      receiptIssued: false,
      disposableBlockedReceiptIssued: true,
      independentShadowProfileCompared: true,
      runtimeAccepted: false,
      temporaryClusterStoppedAndRemoved: true,
      limitations: [
        'Synthetic Business FK/trigger-bypassed setup; not full product provenance',
        'Minimal Native ACL fixture, not public Storage worker',
        'No full finalize/host regression/HBA credential or crash execution driver',
      ],
    };
    const index = process.argv.indexOf('--output');
    if (index >= 0)
      fs.writeFileSync(process.argv[index + 1], JSON.stringify(evidence, null, 2) + '\n');
    console.log(
      JSON.stringify({
        status: 'PASS',
        checksPassed: result.checks.length,
        disposableClusterCleaned: true,
      }),
    );
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { bootstrap };
