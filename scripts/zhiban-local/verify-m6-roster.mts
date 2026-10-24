import { RosterService, enrollmentCommand } from '../../lib/zhiban/application/roster/service';
import { createRosterHttp } from '../../lib/zhiban/infrastructure/roster/http';
import { AcademicError } from '../../lib/zhiban/domain/academic/model';
import type { AcademicStore } from '../../lib/zhiban/application/academic/service';
import { ProgressService } from '../../lib/zhiban/application/progress/service';
import { createProgressHttp } from '../../lib/zhiban/infrastructure/progress/http';
/** LOCAL disposable PG16 product journey. Never reads development credentials or touches 55432/55433. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpsRequest } from 'node:https';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import { createIdentityComposition } from '../../lib/zhiban/infrastructure/identity/composition/root';
import { createIdentityHttp } from '../../lib/zhiban/infrastructure/identity/http/adapter';
import { IdentitySafeQueries } from '../../lib/zhiban/application/identity/use-cases/safe-queries';
import { catalogConfig } from '../../tests/zhiban/identity/authorization/fixtures';
import {
  purposes,
  admissionPolicyDigest,
  type AdmissionPurpose,
} from '../../lib/zhiban/infrastructure/identity/composition/admission';
import { IdentityIds } from '../../lib/zhiban/infrastructure/identity/composition/ids';
import { PostgresIdentityRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresTenantRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/tenant';
import { PostgresMembershipRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { PostgresCredentialRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { Argon2PasswordHasher } from '../../lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '../../lib/zhiban/infrastructure/identity/credentials/password-screening';
import {
  User,
  Tenant,
  Membership,
  RoleGrant,
  instant,
  tenantScope,
  selfScope,
} from '../../lib/zhiban/domain/identity/index';
import { tenantScopeContext } from '../../lib/zhiban/application/identity/ports/tenant-context';
import { privateFile, trustedDevelopmentCa, digest } from './config';
import { AcademicService } from '../../lib/zhiban/application/academic/service';
import { PostgresAcademicStore } from '../../lib/zhiban/infrastructure/academic/postgres/store';
import { createAcademicHttp } from '../../lib/zhiban/infrastructure/academic/http';
import { AnalyticsService } from '../../lib/zhiban/application/analytics/service';
import { createAnalyticsHttp } from '../../lib/zhiban/infrastructure/analytics/http';
import { LearningService } from '../../lib/zhiban/application/learning/service';
import { AssessmentService } from '../../lib/zhiban/application/assessment/service';
import { createLearningHttp } from '../../lib/zhiban/infrastructure/learning/http';
import { createAssessmentHttp } from '../../lib/zhiban/infrastructure/assessment/http';
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const serve = process.argv.includes('--serve');
const root = process.cwd(),
  bin = '/usr/lib/postgresql/16/bin',
  port = 56503,
  database = 'zhiban_m6_roster_disposable';
const owned = await mkdtemp(join(tmpdir(), 'zhiban-m6-roster-')),
  data = join(owned, 'data'),
  socket = join(owned, 'socket');
const all: Pool[] = [],
  checks: string[] = [],
  sourceHashes: Record<string, string> = {};
const pool = (user = 'postgres', db = database) => {
  const p = new Pool({
    host: socket,
    port,
    database: db,
    user,
    max: 4,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  all.push(p);
  return p;
};
const record = (s: string) => {
  checks.push(s);
  console.log('PASS', s);
};
let started = false,
  server: ReturnType<typeof createServer> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
  failure: unknown,
  pg = 0;
type Actor = {
  uid: string;
  password: string;
  member: string;
  grant: string;
  tenant: string;
  cookie?: string;
  csrf?: string;
};
async function main() {
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
  const master = pool('postgres', 'postgres');
  await master.query(`CREATE DATABASE ${database}`);
  for (const f of ['bootstrap-roles.pg16.sql', 'bootstrap-bridge-roles.pg16.sql']) {
    const file = resolve('lib/zhiban/infrastructure/identity/postgres', f);
    sourceHashes[file] = hash(await readFile(file));
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
        file,
      ],
      { stdio: 'pipe' },
    );
  }
  const admin = pool();
  pg = Number((await admin.query("SELECT current_setting('server_version_num') AS v")).rows[0].v);
  assert.ok(pg >= 160000 && pg < 170000);
  await admin.query(
    'CREATE ROLE zhiban_academic_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',
  );
  for (const ctx of ['identity', 'academic', 'learning', 'assessment']) {
    const dir = resolve(`lib/zhiban/infrastructure/${ctx}/postgres/migrations`);
    for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      const file = join(dir, f),
        sql = await readFile(file, 'utf8');
      sourceHashes[file] = hash(sql);
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE zhiban_identity_owner');
      await admin.query(sql);
      await admin.query(`INSERT INTO zhiban_${ctx}.schema_migrations VALUES($1,$2)`, [
        f.slice(0, 4),
        hash(sql),
      ]);
      await admin.query('COMMIT');
    }
  }
  const now = Date.now();
  const bridge = pool('zhiban_bridge_runtime');
  const auth = pool('zhiban_auth_runtime'),
    tenantPool = pool('zhiban_runtime'),
    control = pool('zhiban_control_runtime');
  const policyDigests = {} as Record<AdmissionPurpose, string>;
  const admission = {
    environment: 'LOCAL_M6_ROSTER_DISPOSABLE',
    approvalRef: 'LOCAL_M6_ROSTER_USER_REQUEST',
    hmacKey: randomBytes(32),
    policyDigests,
  };
  for (const purpose of purposes) {
    const initial = purpose === 'INITIAL_PROVISION';
    const policy = {
      purpose,
      approval_ref: admission.approvalRef,
      environment_ref: admission.environment,
      created_at: String(now),
      window_ms: '60000',
      global_limit: '100',
      ip_limit: initial ? null : '30',
      locator_limit: initial ? null : '15',
      pair_limit: initial ? null : '15',
      user_limit: purpose === 'LOGIN' ? null : '15',
      max_buckets: '1000',
    };
    const digest = admissionPolicyDigest(policy);
    admission.policyDigests[purpose] = digest;
    await admin.query(
      'INSERT INTO zhiban_identity.admission_policies VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [purpose, digest, ...Object.values(policy).slice(1)],
    );
    await admin.query('INSERT INTO zhiban_identity.admission_gate(purpose) VALUES($1)', [purpose]);
  }
  const ids = new IdentityIds(),
    users = new PostgresIdentityRepository(control),
    tenants = new PostgresTenantRepository(control),
    members = new PostgresMembershipRepository(tenantPool),
    credentials = new PostgresCredentialRepository(auth);
  const corpus = ['local-compromised-vector'],
    hasher = new Argon2PasswordHasher(new LocalCompromisedPasswordScreening(corpus));
  const t = ids.nextTenantId(),
    otherTenant = ids.nextTenantId();
  for (const [id, code] of [
    [t, 'analytics'],
    [otherTenant, 'other'],
  ])
    await tenants.create(
      Tenant.create(id as ReturnType<IdentityIds['nextTenantId']>, code, code, instant(Date.now())),
    );
  const actors: Actor[] = [];
  for (const [role, tid] of [
    ['TEACHER', t],
    ['STUDENT', t],
    ['TENANT_ADMIN', t],
    ['TEACHER', otherTenant],
    ['TENANT_ADMIN', t],
    ['STUDENT', t],
    ['STUDENT', t],
    ['STUDENT', t],
    ['STUDENT', t],
    ['STUDENT', t],
    ['STUDENT', t],
    ['STUDENT', t],
    ['STUDENT', t],
  ] as const) {
    const uid = ids.nextUserId(),
      password = randomBytes(24).toString('base64url');
    await users.create(User.create(uid, instant(Date.now())));
    await credentials.createPassword(
      uid,
      ids.nextCredentialId(),
      await hasher.hash(password),
      instant(Date.now()),
      {
        actor: { kind: 'SERVICE', serviceCode: 'local_m6_seed' },
        requestId: 'LOCAL_M6_ROSTER_SEED',
        reason: 'SYSTEM_MAINTENANCE',
      },
    );
    const grant = RoleGrant.create({
      id: ids.nextRoleGrantId(),
      roleCode: role,
      scope: role === 'STUDENT' ? selfScope() : tenantScope(),
      createdAt: instant(now),
      validFrom: instant(now),
      validUntil: null,
    });
    const member = Membership.create({
      id: ids.nextMembershipId(),
      userId: uid,
      tenantId: tid,
      now: instant(now),
    }).activatePending({
      expectedAuthorizationVersion: 0,
      now: instant(now),
      approvedGrants: [grant],
    });
    await members.create(tenantScopeContext(tid), member);
    actors.push({ uid, password, member: member.id, grant: grant.id, tenant: tid });
  }
  const [teacher, student, outsider, foreign, manager] = actors;
  const course = v7(),
    term = v7(),
    offering = v7(),
    otherOffering = v7(),
    emptyOffering = v7();
  await admin.query(
    "INSERT INTO zhiban_academic.courses VALUES($1,$2,'M6','机电基础','',NULL,'PUBLISHED',1,1,$3,$3)",
    [t, course, now],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.course_versions VALUES($1,$2,1,'机电基础','',NULL,$3)",
    [t, course, now],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.terms VALUES($1,$2,'TERM','本地学期','2026-10-01','2027-01-01',1)",
    [t, term],
  );
  for (const o of [offering, otherOffering, emptyOffering])
    await admin.query(
      "INSERT INTO zhiban_academic.offerings VALUES($1,$2,$3,1,$4,NULL,$5,$6,20,'OPEN',1)",
      [
        t,
        o,
        course,
        term,
        o,
        o === offering ? '机电一班' : o === emptyOffering ? '空班示例' : '其他任教班',
      ],
    );
  await admin.query(
    "INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
    [t, v7(), offering, teacher.member, now],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
    [t, v7(), emptyOffering, teacher.member, now],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
    [t, v7(), offering, student.member, now],
  );
  const extraStudents = actors.slice(5);
  for (const [i, a] of extraStudents.entries()) {
    await admin.query(
      "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
      [t, v7(), offering, a.member, now],
    );
    await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
      t,
      a.member,
      ['李明', '王悦', '历史学生', '待入班学生', '周宁', '孙悦', '批量学生甲', '批量学生乙'][i],
    ]);
  }
  await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
    t,
    student.member,
    '陈晓',
  ]);
  const origin = 'https://127.0.0.1:3447';
  const tls = await privateFile('localhost.crt'),
    key = await privateFile('localhost.key'),
    ca = await trustedDevelopmentCa();
  const bound = JSON.parse((await privateFile('receipt.json')).toString());
  assert.equal(digest(tls.toString()), bound.certificateHash);
  const composition = await createIdentityComposition(
    { auth, tenant: tenantPool, control },
    {
      origin,
      sessionPolicy: { absoluteMs: 28800000, idleMs: 1800000 },
      catalog: catalogConfig(),
      admission,
      corpus: {
        approvalRef: 'LOCAL_TEST_ONLY',
        expectedDigest: hash(JSON.stringify(corpus)),
        values: corpus,
      },
      operator: null,
      membership: null,
      transportApprovalRef: 'LOCAL_DIRECT_TLS',
      deployment: 'SINGLE_PROCESS_HTTPS',
    },
  );
  const facade = createIdentityHttp(
    async () => ({
      ...composition,
      queries: new IdentitySafeQueries({
        passwordState: (h) => composition.security.passwordState(h),
        member: async () => {
          throw Error('Closed');
        },
        consentContext: async () => {
          throw Error('Closed');
        },
      }),
    }),
    { origin, concurrentRequests: 8, bodyTimeoutMs: 3000, retryAfterSeconds: 1 },
  );
  const businessPool = pool('zhiban_academic_runtime');
  const store = new PostgresAcademicStore(
    businessPool,
    bridge,
    tenantPool,
    composition.security.bridgeSecurity(),
  );
  const httpAcademic = createAcademicHttp(new AcademicService(store), composition.security, origin);
  const httpLearning = createLearningHttp(new LearningService(store), composition.security, origin);
  const httpAssessment = createAssessmentHttp(
    new AssessmentService(store),
    composition.security,
    origin,
  );
  const httpAnalytics = createAnalyticsHttp(
    new AnalyticsService(store),
    composition.security,
    origin,
  );
  const rosterService = new RosterService(store);
  const httpRoster = createRosterHttp(rosterService, composition.security, origin);
  const httpProgress = createProgressHttp(new ProgressService(store), composition.security, origin);
  server = createServer({ key, cert: tls, maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    const abort = new AbortController();
    outgoing.once('close', () => abort.abort());
    const deadline = setTimeout(() => {
      abort.abort();
      outgoing.destroy();
    }, 10000);
    outgoing.once('finish', () => clearTimeout(deadline));
    outgoing.once('close', () => clearTimeout(deadline));
    try {
      if (
        incoming.headers.host !== '127.0.0.1:3447' ||
        incoming.socket.remoteAddress !== '127.0.0.1'
      ) {
        outgoing.writeHead(403);
        outgoing.end();
        return;
      }
      const url = new URL(incoming.url!, origin);
      const assets: Record<string, [string, string]> = {
        '/zhiban': ['index.html', 'text/html'],
        '/zhiban/client.js': ['client.js', 'text/javascript'],
        '/zhiban/academic.js': ['academic.js', 'text/javascript'],
        '/zhiban/learning.js': ['learning.js', 'text/javascript'],
        '/zhiban/assessment.js': ['assessment.js', 'text/javascript'],
        '/zhiban/style.css': ['style.css', 'text/css'],
        '/zhiban/roster': ['roster.html', 'text/html'],
        '/zhiban/roster.js': ['roster.js', 'text/javascript'],
        '/zhiban/roster.css': ['roster.css', 'text/css'],
        '/zhiban/roster-template.csv': ['roster-template.csv', 'text/csv'],
        '/zhiban/progress': ['progress.html', 'text/html'],
        '/zhiban/progress.js': ['progress.js', 'text/javascript'],
        '/zhiban/progress.css': ['progress.css', 'text/css'],
        '/zhiban/analytics': ['analytics.html', 'text/html'],
        '/zhiban/analytics.js': ['analytics.js', 'text/javascript'],
        '/zhiban/analytics.css': ['analytics.css', 'text/css'],
      };
      if (assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        if (incoming.method !== 'GET') {
          outgoing.writeHead(405);
          outgoing.end();
          return;
        }
        outgoing.writeHead(200, {
          'Content-Type': type + '; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          'Referrer-Policy': 'no-referrer',
        });
        outgoing.end(await readFile(join(root, 'app/zhiban/local', file)));
        return;
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(incoming.headers))
        if (v && !['host', 'connection', 'content-length', 'transfer-encoding'].includes(k))
          headers.set(k, Array.isArray(v) ? v.join(',') : v);
      headers.set('x-zhiban-client-ip', '127.0.0.1');
      const parts: Buffer[] = [];
      let size = 0;
      for await (const part of incoming) {
        size += part.length;
        if (size > 32768) {
          outgoing.writeHead(413);
          outgoing.end();
          return;
        }
        parts.push(Buffer.from(part));
      }
      if (['GET', 'HEAD'].includes(incoming.method ?? '') && size) {
        outgoing.writeHead(400);
        outgoing.end();
        return;
      }
      const request = new Request(url, {
        method: incoming.method,
        headers,
        signal: abort.signal,
        ...(!['GET', 'HEAD'].includes(incoming.method ?? '') ? { body: Buffer.concat(parts) } : {}),
      });
      const r = url.pathname.startsWith('/api/zhiban/roster/')
        ? await httpRoster(request)
        : url.pathname.startsWith('/api/zhiban/progress/')
          ? await httpProgress(request)
          : url.pathname.startsWith('/api/zhiban/analytics/')
            ? await httpAnalytics(request)
            : url.pathname.startsWith('/api/zhiban/academic/')
              ? await httpAcademic(request)
              : url.pathname.startsWith('/api/zhiban/learning/')
                ? await httpLearning(request)
                : url.pathname.startsWith('/api/zhiban/assessment/')
                  ? await httpAssessment(request)
                  : url.pathname.startsWith('/api/zhiban/identity/')
                    ? await facade.handle(request)
                    : new Response(null, { status: 404 });
      outgoing.writeHead(r.status, Object.fromEntries(r.headers));
      outgoing.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      if (outgoing.headersSent) outgoing.destroy();
      else {
        outgoing.writeHead(503);
        outgoing.end();
      }
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 32;
  await new Promise<void>((done, reject) => {
    server!.once('error', reject);
    server!.listen(3447, '127.0.0.1', done);
  });
  // Synthetic verification DTO; asserted by each real HTTP operation, never supplies authorization facts.
  type Json = {
    id: string;
    revision: string;
    submissionId: string;
    submission_id: string;
    csrfToken: string;
    title: string;
    activities: Json[];
    attempts: Json[];
    grades: Json[];
  };
  const http = (
    path: string,
    a?: Actor,
    payload?: unknown,
    method?: string,
    extra: Record<string, string> = {},
  ) =>
    new Promise<{
      status: number;
      json: Json;
      cookie?: string;
      headers: import('node:http').IncomingHttpHeaders;
    }>((done, reject) => {
      const post = payload !== undefined;
      const r = httpsRequest(
        origin + path,
        {
          ca,
          method: method ?? (post ? 'POST' : 'GET'),
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(a?.cookie ? { cookie: a.cookie } : {}),
            ...(post
              ? {
                  Origin: origin,
                  'Content-Type': 'application/json',
                  'x-zhiban-command': v7().replaceAll('-', ''),
                  ...(a?.csrf ? { 'x-zhiban-csrf': a.csrf } : {}),
                }
              : {}),
            ...extra,
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on('data', (b) => parts.push(b));
          res.on('error', reject);
          res.on('end', () => {
            try {
              const bytes = Buffer.concat(parts);
              done({
                status: res.statusCode!,
                json: res.headers['content-type']?.includes('json')
                  ? JSON.parse(bytes.toString())
                  : {},
                cookie: res.headers['set-cookie']?.[0]?.split(';')[0],
                headers: res.headers,
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      r.setTimeout(10000, () => r.destroy(Error('HTTPS timeout')));
      r.on('error', reject);
      r.end(post ? JSON.stringify(payload) : undefined);
    });
  for (const a of actors) {
    const login = await http('/api/zhiban/identity/login', undefined, {
      userId: a.uid,
      password: a.password,
    });
    assert.equal(login.status, 200);
    a.cookie = login.cookie;
    const csrf = await http('/api/zhiban/identity/csrf', a);
    assert.equal(csrf.status, 200);
    a.csrf = csrf.json.csrfToken;
  }
  record('PG16 restricted roles + real Identity sessions + validated trusted HTTPS');
  type Preview = Awaited<ReturnType<RosterService['preview']>>;
  type Result = Awaited<ReturnType<RosterService['commit']>>;
  const target = otherOffering,
    base = `/api/zhiban/roster/${t}/offerings/${target}`,
    academicBase = `/api/zhiban/academic/${t}`;
  const csv = (...ids: string[]) => 'membershipId\r\n' + ids.join('\r\n') + '\r\n';
  const post = async <T,>(value: unknown, path = base, a = manager): Promise<T> => {
    const r = await http(path, a, value);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as unknown as T;
  };
  const preview = (text: string, path = base) =>
    post<Preview>({ type: 'PREVIEW', csv: text }, path);
  const commit = (token: string, path = base) => post<Result>({ type: 'COMMIT', token }, path);
  const command = async (value: unknown) => {
    const r = await http(academicBase, manager, value);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  await command({
    type: 'ENROLL',
    offeringId: target,
    membershipId: student.member,
    revision: null,
  });
  await admin.query(
    "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'WITHDRAWN',$5,$6,1)",
    [t, v7(), target, extraStudents[3].member, now, Date.now()],
  );
  const before = Number(
    (await admin.query('SELECT count(*) AS n FROM zhiban_academic.commands')).rows[0].n,
  );
  const invalid = await preview(
    csv(
      extraStudents[0].member,
      extraStudents[0].member,
      'bad-id',
      extraStudents[3].member,
      teacher.member,
      foreign.member,
      v7(),
    ),
  );
  assert.equal(invalid.canCommit, false);
  assert.deepEqual(
    invalid.rows.slice(1, 4).map((r) => r.code),
    ['DUPLICATE', 'INVALID_ID', 'REJOIN_MANUALLY'],
  );
  assert.equal((await http(base, manager, { type: 'COMMIT', token: invalid.token })).status, 409);
  assert.equal(
    Number((await admin.query('SELECT count(*) AS n FROM zhiban_academic.commands')).rows[0].n),
    before,
  );
  record(
    'preview reports duplicates/invalid IDs/withdrawn/ineligible/foreign rows, with no business or audit writes',
  );
  const plan = await preview(csv(extraStudents[0].member, student.member, extraStudents[1].member));
  assert.equal(plan.canCommit, true);
  assert.deepEqual(
    plan.rows.map((r) => r.status),
    ['READY', 'SKIP', 'READY'],
  );
  assert.equal(plan.rows[0].name, '李明');
  const done = await commit(plan.token);
  assert.equal(done.complete, true);
  assert.deepEqual(
    done.results.map((r) => r.status),
    ['IMPORTED', 'SKIPPED', 'IMPORTED'],
  );
  const ledger = async (batchId: string) =>
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.commands WHERE command_key LIKE $1',
          [`roster_${batchId}_%`],
        )
      ).rows[0].n,
    );
  assert.equal(await ledger(plan.batchId), 2);
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE command_key LIKE $1',
          [`roster_${plan.batchId}_%`],
        )
      ).rows[0].n,
    ),
    2,
  );
  await commit(plan.token);
  assert.equal(await ledger(plan.batchId), 2);
  record(
    'confirmed import uses normal ENROLL command/audit per new row; active rows skip and same batch replay creates no duplicates',
  );
  for (const a of [teacher, student, foreign]) assert.equal((await http(base, a)).status, 403);
  assert.equal((await http(base)).status, 401);
  assert.equal((await http(base, outsider, { type: 'COMMIT', token: plan.token })).status, 403);
  assert.equal(
    (await http(`/api/zhiban/roster/${otherTenant}/offerings/${target}`, manager)).status,
    403,
  );
  assert.equal(
    (
      await http(`/api/zhiban/roster/${t}/offerings/${emptyOffering}`, manager, {
        type: 'COMMIT',
        token: plan.token,
      })
    ).status,
    403,
  );
  record(
    'teacher/student/anonymous/cross-tenant blocked; preview token bound to exact administrator and offering',
  );
  assert.equal(
    (
      await http(base, manager, { type: 'PREVIEW', csv: csv(extraStudents[2].member) }, undefined, {
        'x-zhiban-csrf': 'x'.repeat(43),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await http(base, manager, { type: 'PREVIEW', csv: csv(extraStudents[2].member) }, undefined, {
        Origin: 'https://other.invalid',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await http(base, manager, {
        type: 'PREVIEW',
        csv: 'membershipId,role\n' + extraStudents[2].member + ',TENANT_ADMIN',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await http(base, manager, {
        type: 'COMMIT',
        token: plan.token,
        rows: [{ role: 'TENANT_ADMIN' }],
      })
    ).status,
    400,
  );
  assert.equal((await http(base + '?token=bad', manager)).status, 400);
  assert.equal((await http(base, manager, undefined, 'DELETE')).status, 405);
  record(
    'CSRF/Origin, authority columns, forged commit rows, query parameters and unsupported methods rejected',
  );
  const handle = await composition.security.authenticate(
    manager.cookie!.split('=').slice(1).join('='),
  );
  assert.ok(handle);
  const ctx = { handle, tenantId: t, actorMembershipId: manager.member };
  let clock = Date.now();
  const timed = new RosterService(store, () => clock);
  const expired = await timed.preview(ctx, target, csv(extraStudents[2].member));
  clock += 300001;
  await assert.rejects(
    timed.commit(ctx, target, expired.token),
    (e) => e instanceof AcademicError && e.code === 'CONFLICT',
  );
  const restarted = new RosterService(store);
  await assert.rejects(
    restarted.commit(ctx, target, plan.token),
    (e) => e instanceof AcademicError && e.code === 'CONFLICT',
  );
  record(
    'expired preview and process-local receipt loss fail closed; no invented durable batch completion',
  );
  let armed = false,
    changed = false;
  const partialStore: AcademicStore = {
    async run(context, cmd, work) {
      const result = await store.run(context, cmd, work);
      if (
        armed &&
        !changed &&
        cmd?.type === 'ENROLL' &&
        cmd.membershipId === extraStudents[2].member
      ) {
        changed = true;
        const row = (
          await admin.query(
            'SELECT revision::text,name,capacity FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
            [t, target],
          )
        ).rows[0];
        await command({
          type: 'UPDATE_OFFERING',
          id: target,
          revision: row.revision,
          name: row.name + ' · 已调整',
          capacity: row.capacity,
          status: 'OPEN',
        });
      }
      return result;
    },
  };
  const partialService = new RosterService(partialStore),
    partialPlan = await partialService.preview(
      ctx,
      target,
      csv(extraStudents[2].member, extraStudents[4].member, extraStudents[5].member),
    );
  assert.equal(partialPlan.canCommit, true);
  armed = true;
  const partial = await partialService.commit(ctx, target, partialPlan.token);
  assert.equal(partial.complete, false);
  assert.deepEqual(
    partial.results.map((r) => r.status),
    ['IMPORTED', 'FAILED', 'NOT_ATTEMPTED'],
  );
  assert.equal(await ledger(partialPlan.batchId), 1);
  record(
    'mid-batch offering revision change retains committed row, rejects next row and leaves later row unattempted',
  );
  let lose = false,
    blockProbe = false;
  const ackStore: AcademicStore = {
    async run(context, cmd, work) {
      if (blockProbe && cmd?.type === 'ENROLL' && cmd.membershipId === extraStudents[4].member)
        throw new AcademicError('FORBIDDEN');
      const result = await store.run(context, cmd, work);
      if (lose && cmd?.type === 'ENROLL' && cmd.membershipId === extraStudents[4].member) {
        lose = false;
        throw new AcademicError('UNAVAILABLE');
      }
      return result;
    },
  };
  const ackService = new RosterService(ackStore),
    ackPlan = await ackService.preview(ctx, target, csv(extraStudents[4].member));
  lose = true;
  const unknown = await ackService.commit(ctx, target, ackPlan.token);
  assert.equal(unknown.results[0].status, 'UNKNOWN');
  assert.equal(await ledger(ackPlan.batchId), 1);
  blockProbe = true;
  const unverifiable = await ackService.commit(ctx, target, ackPlan.token);
  assert.equal(unverifiable.results[0].status, 'UNKNOWN');
  blockProbe = false;
  const confirmed = await ackService.commit(ctx, target, ackPlan.token);
  assert.equal(confirmed.results[0].status, 'IMPORTED');
  assert.equal(await ledger(ackPlan.batchId), 1);
  record(
    'lost COMMIT response and failed recheck remain UNKNOWN; original row command key later proves completion without a second audit',
  );
  const emptyRow = (
    await admin.query(
      'SELECT revision::text FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
      [t, emptyOffering],
    )
  ).rows[0];
  await command({
    type: 'UPDATE_OFFERING',
    id: emptyOffering,
    revision: emptyRow.revision,
    name: '容量竞争示例',
    capacity: 1,
    status: 'OPEN',
  });
  const emptyBase = `/api/zhiban/roster/${t}/offerings/${emptyOffering}`,
    capacityPlan = await preview(csv(extraStudents[5].member), emptyBase);
  assert.equal(capacityPlan.canCommit, true);
  await command({
    type: 'ENROLL',
    offeringId: emptyOffering,
    membershipId: student.member,
    revision: null,
  });
  const full = await commit(capacityPlan.token, emptyBase);
  assert.equal(full.results[0].status, 'FAILED');
  assert.equal(full.results[0].code, 'CAPACITY_FULL');
  assert.equal(await ledger(capacityPlan.batchId), 0);
  const insufficient = await preview(csv(extraStudents[6].member), emptyBase);
  assert.equal(insufficient.capacityEnough, false);
  assert.equal(insufficient.canCommit, false);
  record(
    'concurrent normal enrollment consumes last seat; batch fails without overbooking, and full-class preview cannot commit',
  );
  // Target grant lock is held across the business commit, independently of the frozen actor/related bridge contract.
  let entered!: () => void, release!: () => void;
  const entry = new Promise<void>((done) => {
      entered = done;
    }),
    hold = new Promise<void>((done) => {
      release = done;
    });
  const reader = store.run(
    ctx,
    enrollmentCommand(target, extraStudents[5].member),
    async (actor, tx) => {
      await tx.roster!.inspect(actor, target, extraStudents[5].member);
      entered();
      await hold;
    },
  );
  await entry;
  const revoker = pool();
  let revoked = false;
  const revocation = revoker.query(
    'UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1',
    [extraStudents[5].grant, Date.now()],
  );
  void revocation.then(() => {
    revoked = true;
  });
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(revoked, false);
  release();
  await reader;
  await revocation;
  const revokedPlan = await preview(csv(extraStudents[5].member));
  assert.equal(revokedPlan.rows[0].code, 'INACTIVE_MEMBER');
  assert.equal(revokedPlan.canCommit, false);
  record(
    'target STUDENT grant revocation waits for row validation lock; subsequent preview refuses revoked student',
  );
  // One valid target expires during a held business transaction: rollback includes both command and Enrollment.
  const deadlineMember = extraStudents[6],
    deadlineId = ids.nextRoleGrantId(),
    deadline = Date.now() + 1000;
  await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1', [
    deadlineMember.grant,
    Date.now(),
  ]);
  await admin.query(
    "INSERT INTO zhiban_identity.role_grants VALUES($1,$2,$3,1,'STUDENT','SELF',NULL,$4,$4,$5,NULL)",
    [deadlineId, t, deadlineMember.member, Date.now(), deadline],
  );
  const deadlineKey = 'roster_deadline_' + randomBytes(16).toString('hex');
  await assert.rejects(
    store.run(ctx, enrollmentCommand(target, deadlineMember.member), async (actor, tx) => {
      await tx.roster!.enroll(
        actor,
        target,
        deadlineMember.member,
        String((await tx.roster!.info(actor, target)).revision),
        deadlineKey,
      );
      await new Promise((done) => setTimeout(done, Math.max(0, deadline - Date.now() + 30)));
    }),
    (e) => e instanceof AcademicError && e.code === 'INACTIVE_MEMBER',
  );
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.commands WHERE command_key=$1',
          [deadlineKey],
        )
      ).rows[0].n,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
          [t, target, deadlineMember.member],
        )
      ).rows[0].n,
    ),
    0,
  );
  record('target grant expiry before COMMIT rolls back Enrollment, command and audit');
  // An aborted request may not start any additional row, including the first one.
  const abortPlan = await rosterService.preview(ctx, target, csv(extraStudents[7].member));
  const signal = new AbortController();
  signal.abort();
  const aborted = await rosterService.commit(ctx, target, abortPlan.token, signal.signal);
  assert.equal(aborted.results[0].status, 'NOT_ATTEMPTED');
  assert.equal(await ledger(abortPlan.batchId), 0);
  record('disconnected request does not start additional row transactions');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai' }),
    page = await context.newPage();
  await context.addCookies([
    {
      name: manager.cookie!.split('=')[0],
      value: manager.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(origin + '/zhiban');
  await page.locator('.space-card').first().click();
  await expect(page.getByRole('link', { name: '批量导入学生名册' }).first()).toBeVisible();
  await page.goto(origin + `/zhiban/roster?tenant=${t}&offering=${target}`);
  await expect(page.getByRole('button', { name: '预览并校验', exact: true })).toBeVisible();
  await page.getByLabel('CSV 名册', { exact: true }).fill(csv(extraStudents[7].member));
  await page.getByRole('button', { name: '预览并校验', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认导入 1 名学生', exact: true })).toBeEnabled();
  await page
    .getByLabel('CSV 名册', { exact: true })
    .fill(csv(extraStudents[7].member, extraStudents[7].member));
  await expect(page.getByRole('button', { name: '确认导入 1 名学生', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '预览并校验', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认导入 1 名学生', exact: true })).toBeDisabled();
  await page
    .getByLabel('CSV 名册', { exact: true })
    .fill(csv(extraStudents[7].member, student.member));
  await page.getByRole('button', { name: '预览并校验', exact: true }).click();
  await page.getByRole('button', { name: '确认导入 1 名学生', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
  await expect(page.getByText('已导入', { exact: true })).toBeVisible();
  await expect(page.getByText('已跳过', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/v2/evidence/m6-roster-import-local.png', fullPage: true });
  assert.deepEqual(pageErrors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  record(
    'trusted browser admin entry -> preview -> edit invalidation -> duplicate rejection -> explicit import + skip -> row results; 390px layout',
  );
  await browser.close();
  browser = undefined;
  const late = await preview(csv(extraStudents[5].member)); // blocked target does not authorize later writes; actor logout remains independently checked.
  const logout = await http('/api/zhiban/identity/logout', manager, {});
  assert.ok([200, 204].includes(logout.status));
  assert.equal((await http(base, manager, { type: 'COMMIT', token: late.token })).status, 401);
  record('logout invalidates even previously issued preview access');
  if (serve) {
    const login = await http('/api/zhiban/identity/login', undefined, {
      userId: manager.uid,
      password: manager.password,
    });
    assert.equal(login.status, 200);
    manager.cookie = login.cookie;
    manager.csrf = (await http('/api/zhiban/identity/csrf', manager)).json.csrfToken;
    // A fresh target class provides a usable demonstration without rewriting prior batch outcomes.
    const demoId = v7();
    await admin.query(
      "INSERT INTO zhiban_academic.offerings VALUES($1,$2,$3,1,$4,NULL,'ROSTER-DEMO','批量导入演示班',20,'OPEN',1)",
      [t, demoId, course, term],
    );
    const accountsPath = join(owned, 'accounts.json'),
      sampleCsvPath = join(owned, 'sample-roster.csv'),
      url = origin + `/zhiban/roster?tenant=${t}&offering=${demoId}`;
    await writeFile(sampleCsvPath, csv(extraStudents[0].member, extraStudents[1].member), {
      mode: 0o600,
      flag: 'wx',
    });
    await writeFile(
      accountsPath,
      JSON.stringify(
        {
          scope: 'LOCAL_DISPOSABLE_M6_ROSTER',
          rosterUrl: url,
          sampleCsvPath,
          accounts: [{ label: '教务管理员', userId: manager.uid, password: manager.password }],
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      'docs/v2/evidence/m6-roster-import-demo-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'RUNNING_DISPOSABLE',
          pid: process.pid,
          origin,
          rosterUrl: url,
          accountsPath,
          sampleCsvPath,
          root: owned,
          port,
          database,
          sourceHashes,
          validation: { status: 'PASS', checks, pg16: pg, node: process.version },
          tlsCertificateSha256: hash(tls),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`LOCAL M6 roster ready: ${origin}/zhiban; accounts file: ${accountsPath}`);
    await new Promise<void>((done) => {
      process.once('SIGINT', () => done());
      process.once('SIGTERM', () => done());
    });
  }
}
try {
  const paths = execFileSync(
    'rg',
    [
      '--files',
      'lib/zhiban',
      'app/zhiban/local',
      'scripts/zhiban-local',
      'tests/zhiban/identity/authorization/fixtures.ts',
      'tests/zhiban/roster',
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  for (const path of [...paths, process.argv[1], 'package.json', 'pnpm-lock.yaml'])
    sourceHashes[resolve(path)] = hash(await readFile(path));
  await main();
} catch (e) {
  failure = e;
  console.error(e);
} finally {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done) => server!.close(() => done()));
  }
  await Promise.all(all.map((p) => p.end()));
  if (started) {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
    started = false;
  }
  if (!failure) await rm(owned, { recursive: true });
  const evidence = {
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    status: failure ? 'FAIL' : 'PASS',
    at: new Date().toISOString(),
    node: process.version,
    pg16: pg,
    scope: 'M6_ROSTER_IMPORT_DISPOSABLE_PG16_REAL_IDENTITY_ACADEMIC_HTTPS_UI',
    checks,
    sourceHashes,
    lifecycle: { root: owned, port, database, stopped: !started, removed: !failure },
    excluded: [
      '55432/55433 clusters',
      'Native/maintenance quarantine',
      'production/CI signoff',
      'Identity onboarding/role grants from CSV',
      'batch-wide atomicity or durable batch ledger',
    ],
  };
  await writeFile(
    serve
      ? 'docs/v2/evidence/m6-roster-import-demo-close-local.json'
      : 'docs/v2/evidence/m6-roster-import-local.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  if (failure) process.exitCode = 1;
}
