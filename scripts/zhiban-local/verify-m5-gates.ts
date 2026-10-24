import {
  readContentConfiguration,
  validateContentInstallation,
  implementationBindings,
} from './content-receipt';
import { contentProfile } from './content-profile';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { randomUUID, X509Certificate, createHash } from 'node:crypto';
import { readFile, writeFile, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import { directory, origin, privateFile, trustedDevelopmentCa, digest } from './config';
type Row = any;
type Account = {
  userId: string;
  password: string;
  label: string;
  tenantId: string;
  membershipId: string;
};
type Session = { account: Account; cookie: string; csrf: string };
async function main() {
  const ca = await trustedDevelopmentCa();
  const { accounts } = JSON.parse((await privateFile('accounts.json')).toString()) as {
    accounts: Account[];
  };
  const passed: string[] = [];
  const record = (name: string) => {
    passed.push(name);
    console.log(`PASS ${name}`);
  };
  const http = (
    path: string,
    session?: Session,
    command?: unknown,
    key = randomUUID().replaceAll('-', ''),
    extra: Record<string, string> = {},
  ) =>
    new Promise<{ status: number; data: Row; cookie?: string }>((done, reject) => {
      const r = request(
        origin + path,
        {
          ca,
          servername: '',
          method: command ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(session ? { Cookie: session.cookie } : {}),
            ...(command
              ? {
                  Origin: origin,
                  'Content-Type': 'application/json',
                  'x-zhiban-command': key,
                  ...(session ? { 'x-zhiban-csrf': session.csrf } : {}),
                }
              : {}),
            ...extra,
          },
        },
        (response) => {
          const parts: Buffer[] = [];
          response.on('data', (b) => parts.push(b));
          response.on('end', () => {
            try {
              const raw = Buffer.concat(parts).toString();
              done({
                status: response.statusCode!,
                data: raw ? JSON.parse(raw) : null,
                cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      r.on('error', reject);
      r.setTimeout(10000, () => r.destroy(new Error('HTTPS timeout')));
      r.end(command ? JSON.stringify(command) : undefined);
    });
  const login = async (label: string) => {
    const account = accounts.find((a) => a.label === label)!;
    assert.ok(account);
    const result = await http('/api/zhiban/identity/login', undefined, {
      userId: account.userId,
      password: account.password,
    });
    assert.equal(result.status, 200);
    const s = { account, cookie: result.cookie!, csrf: '' };
    s.csrf = (await http('/api/zhiban/identity/csrf', s)).data.csrfToken;
    return s;
  };
  const teacher = await login('任教教师'),
    teacher2 = await login('任教教师'),
    adminSession = await login('本地教务管理员');
  const fixture = JSON.parse((await privateFile('m5-last-fixture.json')).toString()),
    { config, receipt } = await readContentConfiguration();
  const path = `/api/zhiban/content/${fixture.tenant}/offerings/${fixture.offering}`;
  const bridge = new Pool({ connectionString: config.bridge, max: 2 }),
    native = new Pool({ connectionString: config.native, max: 2 });
  const admin = new Pool({
    host: join(directory, 'socket'),
    port: 55433,
    database: 'zhiban_m1_dev',
    user: 'postgres',
    max: 2,
  });
  const nativeAdmin = new Pool({
    host: join(directory, 'socket'),
    port: 55433,
    database: 'zhiban_m5_native',
    user: 'postgres',
    max: 1,
  });
  const peers = [bridge, native, admin, nativeAdmin];
  try {
    await validateContentInstallation(bridge, native, receipt, config);
    record(
      'issued LOCAL receipt accepted with exact current source/catalog/ledger/Native/TLS bindings',
    );
    for (const [field, value] of [
      ['status', 'UNISSUED'],
      ['formatVersion', 999],
      ['approvalRef', ''],
      ['issuedAt', 'invalid'],
      ['target', { ...receipt.target, database: 'wrong' }],
      ['candidateInventorySha256', '0'.repeat(64)],
      ['candidateMigrationSha256', '0'.repeat(64)],
      ['profile', '0'.repeat(64)],
      ['nativeFingerprint', '0'.repeat(64)],
      ['githubActions', true],
      ['bindingHash', '0'.repeat(64)],
    ] as const) {
      await assert.rejects(() =>
        validateContentInstallation(bridge, native, { ...receipt, [field]: value }, config),
      );
      record(`receipt ${field} drift rejected`);
    }
    await assert.rejects(() =>
      validateContentInstallation(bridge, native, receipt, { ...config, deploymentId: v7() }),
    );
    record('configuration/deployment substitution rejected');
    for (const path of [
      'scripts/zhiban-local/config.ts',
      'lib/zhiban/infrastructure/openmaic/security.ts',
    ]) {
      const source = await readFile(path);
      try {
        await writeFile(path, Buffer.concat([source, Buffer.from('\n// LOCAL binding probe\n')]));
        await assert.rejects(() => validateContentInstallation(bridge, native, receipt, config));
      } finally {
        await writeFile(path, source);
      }
      record(`entry/security source drift rejected: ${path}`);
    }
    const bundlePath = 'app/zhiban/local/content-client.js',
      original = await readFile(bundlePath);
    try {
      await writeFile(
        bundlePath,
        Buffer.concat([original, Buffer.from('\n// LOCAL source drift probe\n')]),
      );
      await assert.rejects(() => validateContentInstallation(bridge, native, receipt, config));
      record('actual browser artifact byte drift rejected');
    } finally {
      await writeFile(bundlePath, original);
    }
    await nativeAdmin.query('GRANT TEMP ON DATABASE zhiban_m5_native TO zhiban_openmaic_runtime');
    try {
      await assert.rejects(() => validateContentInstallation(bridge, native, receipt, config));
      record('actual Native TEMP privilege drift rejected');
    } finally {
      await nativeAdmin.query(
        'REVOKE TEMP ON DATABASE zhiban_m5_native FROM zhiban_openmaic_runtime',
      );
    }
    const local = await admin.connect();
    try {
      await local.query('BEGIN');
      await local.query('ALTER TABLE zhiban_content.resources DISABLE ROW LEVEL SECURITY');
      assert.notEqual((await contentProfile(local)).fingerprint, receipt.profile);
      record('catalog detects actual RLS drift');
    } finally {
      await local.query('ROLLBACK');
      local.release();
    }
    await validateContentInstallation(bridge, native, receipt, config);
    record('restored installation remains accepted');
    const result = await http(path, teacher, { type: 'CREATE_CONTENT', title: 'M5 CAS 并发验证' });
    assert.equal(result.status, 200);
    const row = (await http(path, teacher)).data.resources.find(
      (r: any) => r.id === result.data.id,
    );
    const draft = {
      type: 'SAVE_CONTENT',
      id: row.id,
      revision: row.revision,
      title: row.title,
      slides: [
        {
          ...row.draft.slides[0],
          elements: [{ id: v7(), text: 'CAS A', x: 20, y: 20, width: 600, height: 100 }],
        },
      ],
    };
    const blocker = await admin.connect();
    await blocker.query('BEGIN');
    await blocker.query(
      'SELECT id FROM zhiban_content.resources WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [fixture.tenant, row.id],
    );
    let requests: Promise<any[]>;
    try {
      requests = Promise.all([
        http(path, teacher, draft),
        http(path, teacher2, { ...draft, title: 'CAS B' }),
      ]);
      const rootPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const until = Date.now() + 800;
      let blocked = 0;
      while (Date.now() < until) {
        blocked = Number(
          (
            await admin.query(
              "SELECT count(*) FROM pg_stat_activity a WHERE a.usename IN ('zhiban_bridge_runtime','zhiban_auth_runtime') AND a.wait_event_type='Lock' AND ($1=ANY(pg_blocking_pids(a.pid)) OR EXISTS(SELECT 1 FROM pg_stat_activity b WHERE $1=ANY(pg_blocking_pids(b.pid)) AND b.pid=ANY(pg_blocking_pids(a.pid))))",
              [rootPid],
            )
          ).rows[0].count,
        );
        if (blocked >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(
        blocked >= 2,
        'both requests must wait in the controlled resource/Identity lock chain',
      );
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
    }
    const outcomes = await requests!;
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
    record(
      'two real Sessions wait in the resource/Identity lock chain; exactly one CAS save commits',
    );
    const academicPath = `/api/zhiban/academic/${fixture.tenant}`,
      state = (await http(academicPath, adminSession)).data;
    const assignment = state.assignments.find(
      (a: any) =>
        a.offering_id === fixture.offering &&
        a.membership_id === teacher.account.membershipId &&
        a.status === 'ACTIVE',
    );
    assert.ok(assignment);
    let fresh = (await http(path, teacher)).data.resources.find((r: any) => r.id === row.id);
    const stale = { ...draft, revision: fresh.revision };
    const nativeBefore = Number(
      (await native.query('SELECT count(*) FROM public.document_stages')).rows[0].count,
    );
    assert.equal(
      (
        await http(academicPath, adminSession, {
          type: 'END_TEACHER',
          id: assignment.id,
          revision: assignment.revision,
        })
      ).status,
      200,
    );
    const diagnosticPath = join(directory, 'content-operations.jsonl');
    const diagnosticMode = (await stat(diagnosticPath)).mode & 0o777;
    try {
      await chmod(diagnosticPath, 0o400);
      assert.equal((await http(path, teacher, stale)).status, 403);
      assert.equal(
        (
          await http(path, teacher, {
            type: 'PUBLISH_CONTENT',
            id: row.id,
            revision: fresh.revision,
          })
        ).status,
        403,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal((await http('/api/zhiban/identity/csrf', teacher)).status, 200);
      record('diagnostic log I/O failure does not crash the host or bypass business refusal');
    } finally {
      await chmod(diagnosticPath, diagnosticMode);
    }
    assert.equal(
      Number((await native.query('SELECT count(*) FROM public.document_stages')).rows[0].count),
      nativeBefore,
    );
    record('current TeachingAssignment revocation denies save/publish without Native writes');
    const ended = (await http(academicPath, adminSession)).data.assignments.find(
      (a: any) => a.id === assignment.id,
    );
    assert.equal(
      (
        await http(academicPath, adminSession, {
          type: 'ASSIGN_TEACHER',
          offeringId: fixture.offering,
          membershipId: teacher.account.membershipId,
          revision: ended.revision,
        })
      ).status,
      200,
    );
    const csrf = (await http('/api/zhiban/identity/csrf', teacher)).data.csrfToken;
    const logout = await http('/api/zhiban/identity/logout', teacher, {}, undefined, {
      'x-zhiban-csrf': csrf,
    });
    assert.equal(logout.status, 204);
    assert.equal((await http(path, teacher, stale)).status, 401);
    record('logged-out Session cannot save');
    const live = await login('任教教师');
    const create = await http(path, live, {
      type: 'CREATE_CONTENT',
      title: 'LOCAL Native commit/local failure fixture',
    });
    assert.equal(create.status, 200);
    let pending = (await http(path, live)).data.resources.find((r: any) => r.id === create.data.id);
    const dto = { ...draft, id: pending.id, revision: pending.revision, title: pending.title };
    assert.equal((await http(path, live, dto)).status, 200);
    pending = (await http(path, live)).data.resources.find((r: any) => r.id === pending.id);
    const nativeCount = Number(
      (await native.query('SELECT count(*) FROM public.document_stages')).rows[0].count,
    );
    const exists = (
      await admin.query("SELECT to_regprocedure('zhiban_content.m5_local_failure_probe()') AS p")
    ).rows[0].p;
    assert.equal(exists, null);
    let installed = false;
    try {
      await admin.query(
        `CREATE FUNCTION zhiban_content.m5_local_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_id='${pending.id}'::uuid THEN RAISE EXCEPTION 'LOCAL settlement failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
      );
      installed = true;
      await admin.query(
        'REVOKE ALL ON FUNCTION zhiban_content.m5_local_failure_probe() FROM PUBLIC',
      );
      await admin.query(
        'CREATE TRIGGER m5_local_failure_probe BEFORE INSERT ON zhiban_content.publications FOR EACH ROW EXECUTE FUNCTION zhiban_content.m5_local_failure_probe()',
      );
      assert.equal(
        (
          await http(path, live, {
            type: 'PUBLISH_CONTENT',
            id: pending.id,
            revision: pending.revision,
          })
        ).status,
        409,
      );
    } finally {
      if (installed) {
        await admin.query(
          'DROP TRIGGER IF EXISTS m5_local_failure_probe ON zhiban_content.publications',
        );
        await admin.query('DROP FUNCTION zhiban_content.m5_local_failure_probe()');
      }
    }
    assert.equal(
      Number((await native.query('SELECT count(*) FROM public.document_stages')).rows[0].count),
      nativeCount + 1,
    );
    const unchanged = (await http(path, live)).data.resources.find((r: any) => r.id === pending.id);
    assert.equal(unchanged.state, 'DRAFT');
    assert.equal(unchanged.revision, pending.revision);
    assert.equal(
      (await http(path, live, { ...dto, revision: pending.revision, title: 'must remain fenced' }))
        .status,
      409,
    );
    const operation = (
      await admin.query(
        "SELECT state FROM zhiban_content.operations WHERE resource_id=$1 AND action='PUBLISH_CONTENT'",
        [pending.id],
      )
    ).rows[0];
    assert.equal(operation.state, 'OUTCOME_UNKNOWN');
    record(
      'actual Native commit plus local settlement failure leaves no publication and preserves UNKNOWN save fence',
    );
    await validateContentInstallation(bridge, native, receipt, config);
    record('fixture-only failure trigger removed; exact production candidate profile restored');
    await writeFile(
      'docs/v2/evidence/m5-enablement-gates-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          scope: 'OWNED_PG16_CONTENT_STARTUP_AND_FAILURE_BOUNDARIES',
          at: new Date().toISOString(),
          status: 'PASS',
          checks: passed,
          candidateMigrationSha256: receipt.candidateMigrationSha256,
          implementationBindingHash: receipt.bindingHash,
          unknownFixtureResource: pending.id,
          unknownFixturePolicy:
            'Keep pending Native document and durable UNKNOWN fence; no automatic retry/delete or fabricated failed outcome',
          remaining: ['exact authorized unknown-outcome reconciliation operator'],
          revocationEvidence: 'm5-revocation-barriers-local.json',
          commitPushCiDispatch: false,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`LOCAL M5 gates ${passed.length}/${passed.length} PASS`);
  } finally {
    await Promise.all(peers.map((p) => p.end()));
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'M5 gate verification failed');
  process.exitCode = 1;
});
