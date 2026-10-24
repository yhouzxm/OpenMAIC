import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { PgDocumentStore } from '@openmaic/storage/document/pg';
import {
  directory,
  database,
  pgPort,
  privateFile,
  loadRuntime,
  requirePrivateClusterDirectories,
} from './config';
import { readContentConfiguration, validateContentInstallation } from './content-receipt';
import {
  ContentInspector,
  readSnapshot,
  type InspectionScope,
} from '@/lib/zhiban/infrastructure/content/inspection';
import { ContentService } from '@/lib/zhiban/infrastructure/content/service';
import { canonical, hash, document } from '@/lib/zhiban/infrastructure/content/model';
import { Deadline, admittedOperation } from '@/lib/zhiban/infrastructure/openmaic/transactions';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { observedTransport } from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { bearerForCookie } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '@/lib/zhiban/infrastructure/identity/credentials/password-screening';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  Membership,
  RoleGrant,
  User,
  instant,
  tenantId,
  tenantScope,
} from '@/lib/zhiban/domain/identity';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
const run = promisify(execFile);
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Real transaction barrier timed out')), 6000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
function hooked(
  pool: Pool,
  callback: (sql: string, params: any[], next: () => Promise<any>, c: any) => Promise<any>,
): Pool {
  return {
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (sql: string, params: any[] = []) =>
          callback(sql, params, () => client.query(sql, params), client),
        release: (discard?: boolean) => client.release(discard),
      };
    },
  } as Pool;
}
async function main() {
  await requirePrivateClusterDirectories();
  const runtime = await loadRuntime(),
    { config, receipt } = await readContentConfiguration();
  const fixture = JSON.parse((await privateFile('m5-last-fixture.json')).toString());
  const pools: Pool[] = [];
  const pool = (dsn: string) => {
    const p = new Pool({
      connectionString: dsn,
      max: 3,
      connectionTimeoutMillis: 3000,
      statement_timeout: 8000,
    });
    pools.push(p);
    return p;
  };
  const auth = pool(runtime.secrets.LOCAL_M1_AUTH),
    tenant = pool(runtime.secrets.LOCAL_M1_TENANT),
    control = pool(runtime.secrets.LOCAL_M1_CONTROL);
  const bridge = pool(config.bridge),
    native = pool(config.native);
  const admin = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 2,
  });
  pools.push(admin);
  const passed: string[] = [],
    created: string[] = [];
  const record = (name: string) => {
    passed.push(name);
    console.log('PASS ' + name);
  };
  try {
    const ep = (
      await admin.query(
        "SELECT current_setting('data_directory') AS dir,current_database() AS db,current_setting('server_version_num')::int AS pg",
      )
    ).rows[0];
    assert.equal(ep.dir, join(directory, 'pgdata'));
    assert.equal(ep.db, database);
    assert.ok(ep.pg >= 160000 && ep.pg < 170000);
    await validateContentInstallation(bridge, native, receipt, config);
    const old = (
      await admin.query(
        "SELECT DISTINCT resource_id FROM zhiban_content.operations WHERE state IN ('RESERVED','OUTCOME_UNKNOWN') ORDER BY resource_id",
      )
    ).rows.map((r) => r.resource_id);
    const stateHash = async (resources: string[]) => {
      const rows: any = {};
      for (const table of ['resources', 'operations', 'publications', 'audit_events']) {
        rows['content_' + table] = (
          await admin.query(
            `SELECT to_jsonb(t) AS row FROM zhiban_content.${table} t WHERE ${table === 'resources' ? 'id' : 'resource_id'}=ANY($1::uuid[]) ORDER BY to_jsonb(t)::text`,
            [resources],
          )
        ).rows;
      }
      for (const table of [
        'resource_slots',
        'resource_generations',
        'operations',
        'audit_events',
      ]) {
        rows['bridge_' + table] = (
          await admin.query(
            `SELECT to_jsonb(t) AS row FROM zhiban_bridge.${table} t WHERE (tenant_id,slot_id) IN (SELECT tenant_id,slot_id FROM zhiban_bridge.resource_slots WHERE activity_id=ANY($1::uuid[])) ORDER BY to_jsonb(t)::text`,
            [resources],
          )
        ).rows;
      }
      return hash(canonical(rows));
    };
    const oldBefore = await stateHash(old);
    const root = await createIdentityComposition({ auth, tenant, control }, runtime.composition);
    // One new actor, new resources only. Never restore/rewrite existing pending actors or rows.
    const ids = new IdentityIds(),
      uid = ids.nextUserId(),
      password = randomBytes(24).toString('base64url'),
      now = instant(Date.now());
    const users = new PostgresIdentityRepository(control),
      members = new PostgresMembershipRepository(tenant);
    await users.create(User.create(uid, now));
    const hasher = new Argon2PasswordHasher(
      new LocalCompromisedPasswordScreening(runtime.composition.corpus.values),
    );
    await new PostgresCredentialRepository(auth).createPassword(
      uid,
      ids.nextCredentialId(),
      await hasher.hash(password),
      now,
      {
        actor: { kind: 'SERVICE', serviceCode: 'local_m5_inspection_seed' },
        requestId: 'LOCAL_INSPECTION_SEED',
        reason: 'SYSTEM_MAINTENANCE',
      },
    );
    const member = Membership.create({
      id: ids.nextMembershipId(),
      userId: uid,
      tenantId: tenantId(fixture.tenant),
      now,
    }).activatePending({
      expectedAuthorizationVersion: 0,
      now,
      approvedGrants: [
        RoleGrant.create({
          id: ids.nextRoleGrantId(),
          roleCode: 'TEACHER',
          scope: tenantScope(),
          createdAt: now,
          validFrom: now,
          validUntil: null,
        }),
      ],
    });
    await members.create(tenantScopeContext(tenantId(fixture.tenant)), member);
    await admin.query(
      "INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
      [fixture.tenant, v7(), fixture.offering, member.id, Date.now()],
    );
    const login = await root.security.login(
      uid,
      password,
      observedTransport('127.0.0.1'),
      'LOCAL_INSPECTION_TEST',
    );
    assert.equal(login.status, 'ISSUED');
    if (login.status !== 'ISSUED') throw new Error('Synthetic login failed');
    const handle = await root.security.authenticate(bearerForCookie(login.bearer));
    assert.ok(handle);
    const actor = { handle, tenant: fixture.tenant, member: member.id, offering: fixture.offering };
    const plain = new ContentService(bridge, native, root.security, config.deploymentId);
    const call = (service: ContentService, command: any) =>
      admittedOperation((deadline) =>
        service.execute({ ...actor, deadline }, command, v7().replaceAll('-', '')),
      );
    const resource = async () => {
      const { id } = await call(plain, {
        type: 'CREATE_CONTENT',
        title: 'LOCAL inspection fixture',
      });
      created.push(id);
      await call(plain, {
        type: 'SAVE_CONTENT',
        id,
        revision: '1',
        title: 'LOCAL inspection fixture',
        slides: [
          {
            id: v7(),
            elements: [
              {
                id: v7(),
                text: 'Private synthetic content must not appear in report',
                x: 1,
                y: 1,
                width: 120,
                height: 40,
              },
            ],
          },
        ],
      });
      return id;
    };
    const scopeFor = async (resource: string): Promise<InspectionScope> => ({
      tenant: fixture.tenant,
      offering: fixture.offering,
      resource,
      operation: (
        await admin.query(
          "SELECT id FROM zhiban_content.operations WHERE resource_id=$1 AND action='PUBLISH_CONTENT'",
          [resource],
        )
      ).rows[0].id,
    });
    const candidate = async (scope: InspectionScope) => {
      const r = (
        await admin.query('SELECT * FROM zhiban_content.resources WHERE id=$1', [scope.resource])
      ).rows[0];
      const co = (
        await admin.query('SELECT * FROM zhiban_content.operations WHERE id=$1', [scope.operation])
      ).rows[0];
      const p = (
        await admin.query('SELECT * FROM zhiban_bridge.operations WHERE operation_id=$1', [
          co.prepare_operation_id,
        ])
      ).rows[0];
      const g = (
        await admin.query(
          'SELECT * FROM zhiban_bridge.resource_generations WHERE generation_id=$1',
          [p.generation_id],
        )
      ).rows[0];
      const scenes = (
        await admin.query(
          'SELECT * FROM zhiban_bridge.scene_bindings WHERE generation_id=$1 ORDER BY scene_ordinal',
          [g.generation_id],
        )
      ).rows;
      return {
        g,
        doc: document(
          r.draft,
          g.stage_ref,
          scenes.map((s) => s.scene_ref),
          Number(co.created_at),
        ),
      };
    };
    const pending = async (phase: 'reservation' | 'dispatch' | 'native') => {
      const id = await resource();
      let armed = false,
        fired = false;
      const faulty = hooked(phase === 'native' ? native : bridge, async (sql, _params, next) => {
        if (
          (phase === 'reservation' && sql.includes('SET prepare_operation_id=')) ||
          (phase === 'dispatch' && sql.includes('SET dispatch_started_at=')) ||
          (phase === 'native' && /INSERT INTO document_stages/.test(sql))
        )
          armed = true;
        const result = await next();
        if (armed && !fired && sql === 'COMMIT') {
          fired = true;
          throw new Error('Synthetic lost commit acknowledgement');
        }
        return result;
      });
      const service = new ContentService(
        phase === 'native' ? bridge : faulty,
        phase === 'native' ? faulty : native,
        root.security,
        config.deploymentId,
      );
      await assert.rejects(() => call(service, { type: 'PUBLISH_CONTENT', id, revision: '2' }));
      assert.ok(fired);
      return scopeFor(id);
    };
    let nativeReads = 0,
      readOnlyTransactions = 0;
    const readOnly = (p: Pool, isNative = false) =>
      hooked(p, async (sql, _params, next) => {
        if (isNative) nativeReads++;
        assert.ok(!/FOR\s+(?:SHARE|UPDATE)/i.test(sql), 'Inspector attempted row lock');
        assert.ok(
          !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i.test(sql),
          'Inspector attempted mutation or row lock',
        );
        if (sql.startsWith('BEGIN')) {
          assert.equal(sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          readOnlyTransactions++;
        }
        return next();
      });
    const authority = {
      kind: 'LOCAL_SERVICE_INSPECTION' as const,
      purpose: 'CONTENT_PENDING_READ_ONLY' as const,
      serviceRef: 'local_m5_readonly_inspector',
      uid: process.getuid!(),
      implementationBindingHash: receipt.bindingHash,
      installationReceiptSha256: hash(canonical(receipt)),
      deploymentId: config.deploymentId,
    };
    const inspector = new ContentInspector(readOnly(bridge), readOnly(native, true), authority);
    const check = async (scope: InspectionScope, expected: string, tool = inspector) => {
      const before = await stateHash([scope.resource]),
        report = await tool.inspect(scope);
      assert.equal(report.classification, expected);
      assert.equal(report.fenceAction, 'KEEP');
      assert.equal(report.settlementAllowed, false);
      assert.equal(report.replayAllowed, false);
      assert.equal(report.publicationChanged, false);
      assert.equal(await stateHash([scope.resource]), before);
      const { g, doc } = await candidate(scope),
        encoded = JSON.stringify(report);
      for (const secret of [
        g.owner_handle,
        g.stage_ref,
        doc.stage.name,
        doc.scenes[0].id,
        doc.scenes[0].content.canvas.elements[0].content,
        password,
        config.bridge,
        config.native,
      ])
        assert.ok(!encoded.includes(secret));
      return report;
    };
    const reserved = await pending('reservation');
    await check(reserved, 'NATIVE_NOT_OBSERVED');
    record('RESERVED after reservation COMMIT remains fenced; no Native result inferred');
    const absent = await pending('dispatch');
    const missing = await check(absent, 'NATIVE_NOT_OBSERVED');
    assert.equal(missing.recorded.state, 'OUTCOME_UNKNOWN');
    record('UNKNOWN after dispatch COMMIT: owner-scoped null is not proof of failure');
    const matched = await pending('native');
    const match = await check(matched, 'NATIVE_MANIFEST_MATCHED_CONTENT_UNPROVEN');
    assert.equal(match.recorded.state, 'OUTCOME_UNKNOWN');
    record(
      'Native COMMIT acknowledgement loss: recorded manifest matched; content/outcome unproven',
    );
    const save = async (owner: string, doc: any) => {
      const withTransaction = async (work: any) => {
        const c = await native.connect();
        try {
          await c.query('BEGIN');
          const value = await work({ query: (sql: string, p: any[]) => c.query(sql, p) });
          await c.query('COMMIT');
          return value;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      };
      await new PgDocumentStore(
        { query: (sql, p) => native.query(sql, p) },
        { ownerId: owner, trackAssetReferences: true, withTransaction },
      ).saveDocument(doc);
    };
    const foreign = await pending('reservation'),
      foreignCandidate = await candidate(foreign);
    await save(v7(), foreignCandidate.doc);
    await check(foreign, 'NATIVE_NOT_OBSERVED');
    record('Existing foreign-owner Native document remains indistinguishable from missing');
    const mismatch = await pending('native'),
      changedCandidate = await candidate(mismatch);
    changedCandidate.doc.stage.name = 'Different synthetic Native content';
    await save(changedCandidate.g.owner_handle, changedCandidate.doc);
    await check(mismatch, 'NATIVE_MANIFEST_MATCHED_CONTENT_UNPROVEN');
    record('Changed Native text is never misreported as document equality by matching manifest');
    changedCandidate.doc.scenes[0].order = 1;
    await save(changedCandidate.g.owner_handle, changedCandidate.doc);
    await check(mismatch, 'NATIVE_MANIFEST_MISMATCH');
    record('Native scene order mismatch preserves all fences');
    const secretMarker = 'SECRET_SYNTHETIC_DATABASE_ERROR';
    const unavailable = new ContentInspector(
      readOnly(bridge),
      hooked(native, async (sql, _p, next) => {
        if (sql.includes('document_stages')) throw new Error(secretMarker);
        return next();
      }),
      authority,
    );
    const unproven = await check(matched, 'NATIVE_UNPROVEN', unavailable);
    assert.ok(!JSON.stringify(unproven).includes(secretMarker));
    record('Native read failure is sanitized and cannot clear UNKNOWN');
    const priorNativeReads = nativeReads;
    const badBinding = new ContentInspector(
      hooked(readOnly(bridge), async (sql, _params, next) => {
        const result = await next();
        if (sql.startsWith('SELECT * FROM zhiban_bridge.operations'))
          return {
            ...result,
            rows: result.rows.map((row: any) => ({
              ...row,
              reserved_slot_revision: '9223372036854775807',
            })),
          };
        return result;
      }),
      readOnly(native, true),
      authority,
    );
    await check(matched, 'LOCAL_BINDING_MISMATCH', badBinding);
    assert.equal(nativeReads, priorNativeReads);
    record(
      'Injected inconsistent local binding fails closed before Native access without DB mutation',
    );
    let localSnapshots = 0;
    const recheckFailure = new ContentInspector(
      hooked(readOnly(bridge), async (sql, _params, next) => {
        if (sql.includes('to_jsonb(r) AS resource') && ++localSnapshots === 2)
          throw new Error(secretMarker);
        return next();
      }),
      readOnly(native, true),
      authority,
    );
    await check(matched, 'LOCAL_RECHECK_UNAVAILABLE', recheckFailure);
    record('Injected final local recheck failure cannot issue a stable result');
    const nativeAdmin = new Pool({
      host: join(directory, 'socket'),
      port: pgPort,
      database: 'zhiban_m5_native',
      user: 'postgres',
      max: 1,
    });
    pools.push(nativeAdmin);
    const lock = await nativeAdmin.connect();
    try {
      await lock.query('BEGIN');
      await lock.query('LOCK TABLE public.document_stages IN ACCESS EXCLUSIVE MODE');
      const started = performance.now();
      await check(matched, 'NATIVE_UNPROVEN');
      assert.ok(performance.now() - started < 5000, 'Native lock failure must be bounded');
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    record(
      'Real Native table-lock contention times out conservatively and releases failed snapshot',
    );

    for (const key of ['tenant', 'offering', 'resource', 'operation'] as const) {
      const before = nativeReads;
      await assert.rejects(() => inspector.inspect({ ...matched, [key]: v7() }));
      assert.equal(nativeReads, before);
    }
    await assert.rejects(() => inspector.inspect({ ...matched, force: true } as any));
    record('Exact scope substitution and extra authority flags rejected before Native access');
    await assert.rejects(
      () =>
        readSnapshot(bridge, fixture.tenant, new Deadline(), (c) =>
          c.query('UPDATE zhiban_content.resources SET title=title WHERE id=$1', [
            reserved.resource,
          ]),
        ),
      (e: any) => e.code === '25006',
    );
    await assert.rejects(
      () =>
        readSnapshot(native, null, new Deadline(), async (c) =>
          c.query('DELETE FROM public.document_stages WHERE id=$1', [
            (await candidate(matched)).g.stage_ref,
          ]),
        ),
      (e: any) => e.code === '25006',
    );
    record('PostgreSQL READ ONLY rejects real business and Native mutation attempts');
    const p1 = await inspector.list(fixture.tenant, fixture.offering, null, 1);
    assert.equal(p1.rows.length, 1);
    assert.ok(p1.next);
    const p2 = await inspector.list(fixture.tenant, fixture.offering, p1.next, 1);
    assert.notEqual(p1.rows[0].operation, p2.rows[0].operation);
    assert.equal((await inspector.list(v7(), fixture.offering)).rows.length, 0);
    for (const limit of [0, 21, 1.5])
      await assert.rejects(() => inspector.list(fixture.tenant, fixture.offering, null, limit));
    record('Bounded tenant/offering seek pagination and input limits');
    // Real publisher is held before its Native COMMIT; readonly Native snapshot sees no result.
    const racing = await resource(),
      nativeHeld = latch(),
      publishRelease = latch(),
      inspected = latch(),
      inspectionRelease = latch();
    let writeArmed = false;
    const racingNative = hooked(native, async (sql, _params, next) => {
      if (sql.includes('INSERT INTO document_stages')) writeArmed = true;
      if (writeArmed && sql === 'COMMIT') {
        writeArmed = false;
        nativeHeld.resolve();
        await bounded(publishRelease.promise);
      }
      return next();
    });
    const publisher = call(
      new ContentService(bridge, racingNative, root.security, config.deploymentId),
      { type: 'PUBLISH_CONTENT', id: racing, revision: '2' },
    );
    // Register rejection immediately so a failed assertion never creates unhandled rejections.
    const publishDone = publisher.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    let inspectionDone: Promise<any> | undefined;
    try {
      await bounded(nativeHeld.promise);
      const raceScope = await scopeFor(racing);
      const raceInspector = new ContentInspector(
        readOnly(bridge),
        hooked(readOnly(native), async (sql, _p, next) => {
          if (sql === 'COMMIT') {
            inspected.resolve();
            await bounded(inspectionRelease.promise);
          }
          return next();
        }),
        authority,
      );
      inspectionDone = raceInspector.inspect(raceScope).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await bounded(inspected.promise);
      publishRelease.resolve();
      const completed = await bounded(publishDone);
      assert.ok(!('error' in completed));
      inspectionRelease.resolve();
      const result = await bounded(inspectionDone);
      assert.ok(!result.error);
      assert.equal(result.value.classification, 'LOCAL_STATE_CHANGED');
      assert.equal(result.value.settlementAllowed, false);
      record('Real Native/publish COMMIT race detected by fresh local recheck');
      const before = nativeReads;
      await check(raceScope, 'NOT_PENDING');
      assert.equal(nativeReads, before);
      record('Terminal operation is reported without reading or replaying Native');
    } finally {
      publishRelease.resolve();
      inspectionRelease.resolve();
      await publishDone;
      if (inspectionDone) await inspectionDone;
    }
    // Revocation only on the newly created fixture assignment; no restoration is required.
    await admin.query(
      "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$1,revision=revision+1 WHERE tenant_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [Date.now(), fixture.tenant, member.id],
    );
    await check(matched, 'NATIVE_MANIFEST_MATCHED_CONTENT_UNPROVEN');
    await assert.rejects(() =>
      call(plain, { type: 'PUBLISH_CONTENT', id: matched.resource, revision: '2' }),
    );
    record(
      'Readonly maintenance inspection remains possible after fixture teaching revocation; user publish still denied',
    );
    const executeCLI = async (args: string[]) => {
      const stdout = (
        await run(process.execPath, [join(directory, 'm5-inspector.mjs'), ...args], {
          timeout: 15000,
        })
      ).stdout;
      const result = JSON.parse(stdout);
      assert.equal(result.evidenceOrigin, 'LOCAL');
      assert.equal(result.settlementAllowed, false);
      assert.equal((await stat(result.output)).mode & 0o777, 0o600);
      const envelope = JSON.parse(await readFile(result.output, 'utf8'));
      assert.equal(hash(canonical(envelope.report)), envelope.reportSha256);
      assert.equal(envelope.reportSha256, result.reportSha256);
      return envelope.report;
    };
    const beforeCLI = await stateHash(created);
    const cliReport = await executeCLI([
      'inspect',
      ...Object.entries(matched).flatMap(([key, value]) => ['--' + key, value]),
    ]);
    assert.equal(cliReport.classification, 'NATIVE_MANIFEST_MATCHED_CONTENT_UNPROVEN');
    const cliList = await executeCLI([
      'list',
      '--tenant',
      fixture.tenant,
      '--offering',
      fixture.offering,
      '--limit',
      '2',
    ]);
    assert.equal(cliList.rows.length, 2);
    record(
      'Compiled local CLI issues owner-only reports with verified canonical SHA256 and exact installation binding',
    );
    for (const args of [
      ['settle'],
      [
        'inspect',
        ...Object.entries(matched).flatMap(([key, value]) => ['--' + key, value]),
        '--force',
        'true',
      ],
      ['list', '--tenant', fixture.tenant, '--offering', fixture.offering, '--limit', '21'],
    ])
      await assert.rejects(() =>
        run(process.execPath, [join(directory, 'm5-inspector.mjs'), ...args], { timeout: 15000 }),
      );
    assert.equal(await stateHash(created), beforeCLI);
    record('CLI settle/force/oversized list rejected; no fixture state changes');
    assert.equal(await stateHash(old), oldBefore);
    record('All pre-existing pending resource/operation/publication/Bridge/audit rows unchanged');
    await validateContentInstallation(bridge, native, receipt, config);
    assert.ok(readOnlyTransactions > 0);
    record(
      'Final live catalog/ACL/ledger/source binding unchanged; every inspected data transaction READ ONLY',
    );
    const evidence = {
      evidenceOrigin: 'LOCAL',
      at: new Date().toISOString(),
      kind: 'M5_READ_ONLY_INSPECTION_VERIFICATION',
      implementationBindingHash: receipt.bindingHash,
      installationReceiptSha256: hash(canonical(receipt)),
      candidateMigrationSha256: receipt.candidateMigrationSha256,
      candidateInventorySha256: receipt.candidateInventorySha256,
      verifierSha256: hash(await readFile('scripts/zhiban-local/verify-m5-inspection.mts', 'utf8')),
      passed: passed.length,
      cases: passed,
      protectedPreexistingPendingResources: old.length,
      protectedPreexistingStateSha256: oldBefore,
      syntheticResourceCount: created.length,
      readOnlyTransactions,
      fenceAction: 'KEEP',
      terminalSettlementImplemented: false,
      ci: 'NOT_RUN',
      limits: [
        'New synthetic LOCAL data only; no production signoff',
        'Snapshot observations do not authorize settlement or replay',
        'No global historical Native integrity audit',
      ],
    };
    await writeFile(
      'docs/v2/evidence/m5-readonly-reconciliation-local.json',
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(`LOCAL M5 read-only inspection: ${passed.length}/${passed.length} PASS`);
  } finally {
    await Promise.allSettled(pools.map((p) => p.end()));
  }
}
void main().catch((e) => {
  console.error(
    'LOCAL inspection verification failed:',
    e instanceof assert.AssertionError ? e.message : (e?.code ?? e?.name ?? 'failure'),
  );
  process.exitCode = 1;
});
