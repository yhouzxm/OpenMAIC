import { verifyLearningRecords } from './verify-learning-records';
import { WorkspaceService } from '../../lib/zhiban/application/workspace/service';
import { createWorkspaceHttp } from '../../lib/zhiban/infrastructure/workspace/http';
import { ManagementService } from '../../lib/zhiban/application/management/service';
import { createManagementHttp } from '../../lib/zhiban/infrastructure/management/http';
import { localRequestTarget } from './request-target';
import { DirectoryService } from '../../lib/zhiban/application/directory/service';
import { createDirectoryHttp } from '../../lib/zhiban/infrastructure/directory/http';
import { RosterService } from '../../lib/zhiban/application/roster/service';
import { createRosterHttp } from '../../lib/zhiban/infrastructure/roster/http';
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
  courseScope,
  classScope,
  courseId,
  classId,
  type Scope,
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
const serve = process.argv.includes('--serve'),
  gradingQueue = process.argv.includes('--grading-queue'),
  learningRecords = gradingQueue || process.argv.includes('--learning-records'),
  evidenceName = gradingQueue
    ? 'm6-grading-queue'
    : learningRecords
      ? 'm6-learning-records'
      : 'm6-workspace',
  httpsPort = gradingQueue ? 3455 : learningRecords ? 3454 : 3452;
const root = process.cwd(),
  bin = '/usr/lib/postgresql/16/bin',
  port = gradingQueue ? 56511 : learningRecords ? 56510 : 56508,
  database = gradingQueue
    ? 'zhiban_m6_grading_disposable'
    : learningRecords
      ? 'zhiban_m6_records_disposable'
      : 'zhiban_m6_workspace_disposable';
const owned = await mkdtemp(join(tmpdir(), evidenceName + '-')),
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
    environment: 'LOCAL_M6_WORKSPACE_DISPOSABLE',
    approvalRef: 'LOCAL_M6_WORKSPACE_USER_REQUEST',
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
    ['TENANT_ADMIN', otherTenant],
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
        requestId: 'LOCAL_M6_WORKSPACE_SEED',
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
  const [teacher, student, _outsider, _foreign, manager] = actors;
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
  const origin = `https://127.0.0.1:${httpsPort}`;
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
  const httpManagement = createManagementHttp(
    new AcademicService(store),
    new ManagementService(store),
    composition.security,
    origin,
  );
  const httpWorkspace = createWorkspaceHttp(
    new WorkspaceService(store),
    composition.security,
    origin,
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
  const httpDirectory = createDirectoryHttp(
    new DirectoryService(store),
    composition.security,
    origin,
  );
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
        incoming.headers.host !== `127.0.0.1:${httpsPort}` ||
        incoming.socket.remoteAddress !== '127.0.0.1'
      ) {
        outgoing.writeHead(403);
        outgoing.end();
        return;
      }
      if (!localRequestTarget(incoming.url ?? '')) {
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
        '/zhiban/grading': ['grading.html', 'text/html'],
        '/zhiban/grading.js': ['grading.js', 'text/javascript'],
        '/zhiban/style.css': ['style.css', 'text/css'],
        '/zhiban/workspace.js': ['workspace.js', 'text/javascript'],
        '/zhiban/workspace.css': ['workspace.css', 'text/css'],
        '/zhiban/management': ['management.html', 'text/html'],
        '/zhiban/management-catalog.js': ['management-catalog.js', 'text/javascript'],
        '/zhiban/management.js': ['management.js', 'text/javascript'],
        '/zhiban/management-page.js': ['management-page.js', 'text/javascript'],
        '/zhiban/management.css': ['management.css', 'text/css'],
        '/zhiban/directory': ['directory.html', 'text/html'],
        '/zhiban/directory.js': ['directory.js', 'text/javascript'],
        '/zhiban/directory-page.js': ['directory-page.js', 'text/javascript'],
        '/zhiban/directory.css': ['directory.css', 'text/css'],
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
      const r = url.pathname.startsWith('/api/zhiban/workspace/')
        ? await httpWorkspace(request)
        : url.pathname.startsWith('/api/zhiban/management/')
          ? await httpManagement(request)
          : url.pathname.startsWith('/api/zhiban/directory/')
            ? await httpDirectory(request)
            : url.pathname.startsWith('/api/zhiban/roster/')
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
    server!.listen(httpsPort, '127.0.0.1', done);
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

  if (learningRecords) {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    await verifyLearningRecords({
      gradingQueue,
      admin,
      http,
      teacher,
      student,
      outsider: _outsider,
      foreign: _foreign,
      manager,
      extra: actors[5],
      tenant: t,
      offering,
      otherOffering,
      course,
      now,
      origin,
      browser,
      record,
    });
  } else {
    type Page = Awaited<ReturnType<WorkspaceService['read']>>;
    const base = `/api/zhiban/workspace/${t}`;
    const read = async (
      params: Record<string, string> = {},
      a = teacher,
      kind: 'courses' | 'roster' = 'courses',
    ): Promise<Page> => {
      const r = await http(`${base}/${kind}?` + new URLSearchParams(params), a);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json as unknown as Page;
    };
    const command = (payload: unknown) =>
      http(`/api/zhiban/management/${t}/commands`, manager, payload);
    const ordinary: string[] = [];
    for (let i = 0; i < 620; i++) {
      const id = v7();
      ordinary.push(id);
      await admin.query(
        'INSERT INTO zhiban_academic.offerings VALUES($1,$2,$3,1,$4,NULL,$5,$6,30,$7,1)',
        [
          t,
          id,
          course,
          term,
          'PAGE' + i,
          '分页课程班' + String(i).padStart(4, '0'),
          i % 2 ? 'CLOSED' : 'OPEN',
        ],
      );
      await admin.query(
        "INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
        [t, v7(), id, teacher.member, now],
      );
      await admin.query(
        "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
        [t, v7(), id, student.member, now],
      );
    }
    const makeMember = async (name: string) => {
      const uid = ids.nextUserId();
      await users.create(User.create(uid, instant(now)));
      const grant = RoleGrant.create({
        id: ids.nextRoleGrantId(),
        roleCode: 'STUDENT',
        scope: selfScope(),
        createdAt: instant(now),
        validFrom: instant(now),
        validUntil: null,
      });
      const member = Membership.create({
        id: ids.nextMembershipId(),
        userId: uid,
        tenantId: t,
        now: instant(now),
      }).activatePending({
        expectedAuthorizationVersion: 0,
        now: instant(now),
        approvedGrants: [grant],
      });
      await members.create(tenantScopeContext(t), member);
      await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
        t,
        member.id,
        name,
      ]);
      return member.id;
    };
    await admin.query(
      'UPDATE zhiban_academic.offerings SET capacity=1000 WHERE tenant_id=$1 AND id=$2',
      [t, offering],
    );
    for (let i = 0; i < 520; i++) {
      const member = await makeMember('分页学生' + String(i).padStart(4, '0'));
      await admin.query(
        "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
        [t, v7(), offering, member, now],
      );
    }
    const collect = async (
      a: Actor,
      kind: 'courses' | 'roster',
      params: Record<string, string> = {},
    ) => {
      const ids = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await read({ ...params, limit: '50', ...(cursor ? { cursor } : {}) }, a, kind);
        assert.ok(page.rows.length <= 50);
        for (const row of page.rows) {
          assert.ok(!ids.has(String(row.id)));
          ids.add(String(row.id));
        }
        cursor = page.nextCursor;
        assert.ok(ids.size < 2000);
      } while (cursor);
      return ids;
    };
    assert.equal((await http(`/api/zhiban/academic/${t}`, teacher)).status, 503);
    assert.equal((await http(`/api/zhiban/academic/${t}`, student)).status, 503);
    assert.equal((await collect(teacher, 'courses')).size, 622);
    assert.equal((await collect(student, 'courses')).size, 621);
    assert.equal((await collect(teacher, 'roster', { offering })).size, 529);
    assert.equal((await read({ q: '分页课程班0619' }, student)).rows[0].id, ordinary[619]);
    assert.equal((await read({ state: 'OPEN' }, teacher)).rows.length, 20);
    assert.equal((await collect(student, 'courses', { state: 'CLOSED' })).size, 310);
    record(
      '622 teacher and 621 student courses paginate beyond tenant snapshot caps; 529-member teacher roster is independently bounded with exact keyset coverage',
    );
    assert.equal((await http(`${base}/courses`)).status, 401);
    assert.equal((await http(`${base}/roster?offering=${offering}`, student)).status, 403);
    assert.equal((await http(`${base}/roster?offering=${otherOffering}`, teacher)).status, 403);
    assert.equal((await http(`/api/zhiban/workspace/${otherTenant}/courses`, teacher)).status, 403);
    for (const tail of [
      'courses?limit=500',
      'courses?q=x&q=y',
      'courses?mode=TEACHER',
      'courses?membershipId=' + teacher.member,
      'roster',
      'roster?offering=' + offering + '&state=OPEN',
    ])
      assert.equal((await http(`${base}/${tail}`, teacher)).status, 400);
    assert.equal((await http(`${base}/courses`, teacher, {})).status, 405);
    const first = await read({ limit: '10' }, student);
    for (const p of [{ limit: '20' }, { q: '其他' }, { state: 'CLOSED' }] as Record<
      string,
      string
    >[])
      assert.equal(
        (
          await http(
            `${base}/courses?` +
              new URLSearchParams({ limit: '10', cursor: first.nextCursor!, ...p }),
            student,
          )
        ).status,
        400,
      );
    assert.equal(
      (await http(`${base}/courses?limit=10&cursor=${first.nextCursor}`, teacher)).status,
      400,
    );
    const rosterFirst = await read({ offering, limit: '10' }, teacher, 'roster');
    assert.equal(
      (
        await http(
          `${base}/roster?` +
            new URLSearchParams({
              offering: emptyOffering,
              limit: '10',
              cursor: rosterFirst.nextCursor!,
            }),
          teacher,
        )
      ).status,
      400,
    );
    const safe = await read({}, student);
    assert.ok(
      safe.rows.every(
        (row) =>
          row.mode === 'STUDENT' &&
          !('membership_id' in row) &&
          !('people' in row) &&
          !('enrollments' in row),
      ),
    );
    assert.equal((await read({}, manager)).mode, 'ADMIN');
    record(
      'anonymous/cross-tenant/roster escalation, unsupported parameters, malformed bounds, wrong actor/filter/roster cursors and unsafe method are refused; student course rows contain no other-member roster',
    );
    for (const [suffix, from, until, status] of [
      ['FUTURE', now + 3600000, null, 'ACTIVE'],
      ['FINITE', now, now + 3600000, 'ENDED'],
      ['ENDED', now, now, 'ENDED'],
    ] as const) {
      const id = v7();
      await admin.query(
        "INSERT INTO zhiban_academic.offerings VALUES($1,$2,$3,1,$4,NULL,$5,$5,20,'OPEN',1)",
        [t, id, course, term, suffix],
      );
      await admin.query('INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,$5,$6,$7,1)', [
        t,
        v7(),
        id,
        teacher.member,
        status,
        from,
        until,
      ]);
      await admin.query('INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,$5,$6,$7,1)', [
        t,
        v7(),
        id,
        student.member,
        status === 'ENDED' ? 'WITHDRAWN' : status,
        from,
        until,
      ]);
      assert.equal((await read({ q: id }, teacher)).rows.length, 0);
      assert.equal((await read({ q: id }, student)).rows.length, 0);
    }
    const createActor = async (grants: { role: 'TEACHER' | 'STUDENT'; scope: Scope }[]) => {
      const uid = ids.nextUserId(),
        password = randomBytes(24).toString('base64url');
      await users.create(User.create(uid, instant(now)));
      await credentials.createPassword(
        uid,
        ids.nextCredentialId(),
        await hasher.hash(password),
        instant(now),
        {
          actor: { kind: 'SERVICE', serviceCode: 'local_m6_seed' },
          requestId: 'LOCAL_WORKSPACE_SEED',
          reason: 'SYSTEM_MAINTENANCE',
        },
      );
      const roleGrants = grants.map((g) =>
        RoleGrant.create({
          id: ids.nextRoleGrantId(),
          roleCode: g.role,
          scope: g.scope,
          createdAt: instant(now),
          validFrom: instant(now),
          validUntil: null,
        }),
      );
      const member = Membership.create({
        id: ids.nextMembershipId(),
        userId: uid,
        tenantId: t,
        now: instant(now),
      }).activatePending({
        expectedAuthorizationVersion: 0,
        now: instant(now),
        approvedGrants: roleGrants,
      });
      const loaded = await members.create(tenantScopeContext(t), member);
      const actor: Actor = { uid, password, member: member.id, grant: roleGrants[0].id, tenant: t };
      const login = await http('/api/zhiban/identity/login', undefined, { userId: uid, password });
      assert.equal(login.status, 200);
      actor.cookie = login.cookie;
      actor.csrf = (await http('/api/zhiban/identity/csrf', actor)).json.csrfToken;
      return { actor, loaded, grants: roleGrants };
    };
    const scoped = await createActor([
        { role: 'TEACHER', scope: classScope(classId(ordinary[0])) },
      ]),
      courseScoped = await createActor([{ role: 'TEACHER', scope: courseScope(courseId(course)) }]),
      dual = await createActor([
        { role: 'TEACHER', scope: classScope(classId(ordinary[0])) },
        { role: 'STUDENT', scope: selfScope() },
      ]);
    for (const a of [scoped.actor, courseScoped.actor, dual.actor])
      for (const o of [ordinary[0], ordinary[1]])
        await admin.query(
          "INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
          [t, v7(), o, a.member, now],
        );
    for (const o of [ordinary[0], ordinary[1]])
      await admin.query(
        "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
        [t, v7(), o, dual.actor.member, now],
      );
    assert.deepEqual([...(await collect(scoped.actor, 'courses'))], [ordinary[0]]);
    assert.equal((await collect(courseScoped.actor, 'courses')).size, 2);
    const mixed = await read({}, dual.actor);
    assert.equal(mixed.rows.find((r) => r.id === ordinary[0])!.mode, 'TEACHER');
    assert.equal(mixed.rows.find((r) => r.id === ordinary[1])!.mode, 'STUDENT');
    assert.equal((await http(`${base}/roster?offering=${ordinary[1]}`, scoped.actor)).status, 403);
    record(
      'canonical relationship time windows exclude future/ended/finite-until rows; exact CLASS/COURSE scopes and per-course teacher/student mode prevent role-wide escalation',
    );
    assert.equal(
      (
        await command({
          type: 'EDIT_COURSE',
          id: course,
          revision: '1',
          name: '未发布机密课程',
          description: '未发布机密简介',
          ownerMembershipId: null,
        })
      ).status,
      200,
    );
    const versionOne = await read({ q: ordinary[0] }, student);
    assert.equal(versionOne.rows[0].course_name, '机电基础');
    assert.equal(versionOne.rows[0].course_description, '');
    assert.equal((await read({ q: '未发布机密' }, student)).rows.length, 0);
    assert.equal(
      (await command({ type: 'PUBLISH_COURSE', id: course, revision: '2' })).status,
      200,
    );
    assert.equal((await read({ q: ordinary[0] }, teacher)).rows[0].course_version, 1);
    const assignment = (
      await admin.query(
        'SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
        [t, ordinary[618], teacher.member],
      )
    ).rows[0];
    assert.equal(
      (await command({ type: 'END_TEACHER', id: assignment.id, revision: assignment.revision }))
        .status,
      200,
    );
    assert.equal((await read({ q: ordinary[618] }, teacher)).rows.length, 0);
    assert.equal((await http(`${base}/roster?offering=${ordinary[618]}`, teacher)).status, 403);
    const ended = (
      await admin.query(
        'SELECT revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND id=$2',
        [t, assignment.id],
      )
    ).rows[0];
    assert.equal(
      (
        await command({
          type: 'ASSIGN_TEACHER',
          offeringId: ordinary[618],
          membershipId: teacher.member,
          revision: ended.revision,
        })
      ).status,
      200,
    );
    const enrollment = (
      await admin.query(
        'SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
        [t, ordinary[618], student.member],
      )
    ).rows[0];
    assert.equal(
      (await command({ type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision }))
        .status,
      200,
    );
    assert.equal((await read({ q: ordinary[618] }, student)).rows.length, 0);
    assert.equal(
      (await http(`/api/zhiban/learning/${t}/offerings/${ordinary[618]}`, student)).status,
      403,
    );
    const withdrawn = (
      await admin.query(
        'SELECT revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2',
        [t, enrollment.id],
      )
    ).rows[0];
    assert.equal(
      (
        await command({
          type: 'ENROLL',
          offeringId: ordinary[618],
          membershipId: student.member,
          revision: withdrawn.revision,
        })
      ).status,
      200,
    );
    record(
      'course metadata stays on bound immutable version through draft/republication; ending teaching or withdrawing Enrollment removes list visibility and blocks resource access immediately',
    );
    assert.equal(
      (
        await command({
          type: 'CREATE_COURSE',
          code: 'ARCHIVE_TEST',
          name: '归档测试课程',
          description: '',
          ownerMembershipId: null,
        })
      ).status,
      200,
    );
    const archiveCourse = (
      await admin.query(
        "SELECT id,revision::text FROM zhiban_academic.courses WHERE tenant_id=$1 AND code='ARCHIVE_TEST'",
        [t],
      )
    ).rows[0];
    assert.equal(
      (
        await command({
          type: 'PUBLISH_COURSE',
          id: archiveCourse.id,
          revision: archiveCourse.revision,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await command({
          type: 'CREATE_OFFERING',
          courseId: archiveCourse.id,
          termId: term,
          classId: null,
          code: 'ARCHIVE_CLASS',
          name: '归档后不可见',
          capacity: 20,
        })
      ).status,
      200,
    );
    const archiveOffering = (
      await admin.query(
        "SELECT id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND code='ARCHIVE_CLASS'",
        [t],
      )
    ).rows[0].id;
    assert.equal(
      (
        await command({
          type: 'ASSIGN_TEACHER',
          offeringId: archiveOffering,
          membershipId: teacher.member,
          revision: null,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await command({
          type: 'ENROLL',
          offeringId: archiveOffering,
          membershipId: student.member,
          revision: null,
        })
      ).status,
      200,
    );
    assert.equal((await read({ q: archiveOffering }, teacher)).rows.length, 1);
    assert.equal(
      (await command({ type: 'ARCHIVE_COURSE', id: archiveCourse.id, revision: '2' })).status,
      200,
    );
    for (const a of [teacher, student])
      assert.equal((await read({ q: archiveOffering }, a)).rows.length, 0);
    assert.equal((await http(`${base}/roster?offering=${archiveOffering}`, teacher)).status, 403);
    await members.save(
      tenantScopeContext(t),
      courseScoped.loaded.value.revokeGrant({
        expectedAuthorizationVersion: courseScoped.loaded.value.authorizationVersion,
        grantId: courseScoped.grants[0].id,
        now: instant(Date.now()),
      }),
      courseScoped.loaded.revision,
    );
    const revoked = await http(`${base}/courses`, courseScoped.actor);
    if (revoked.status === 200) assert.deepEqual((revoked.json as unknown as Page).rows, []);
    else assert.ok([401, 403].includes(revoked.status));
    record(
      'archiving a course removes teacher/student listing and blocks roster; revoked teacher scope cannot keep using a prior session as course authority',
    );
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    let legacyReads = 0;
    const open = async (a: Actor) => {
      const context = await browser!.newContext();
      await context.addCookies([
        {
          name: a.cookie!.split('=')[0],
          value: a.cookie!.split('=').slice(1).join('='),
          url: origin,
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
        },
      ]);
      const page = await context.newPage();
      page.on('request', (r) => {
        if (r.url().includes('/api/zhiban/academic/')) legacyReads++;
      });
      await page.goto(origin + '/zhiban');
      await page.locator('.space-card').first().click();
      await expect(page.getByRole('heading', { name: '我的课程', exact: true })).toBeVisible();
      return page;
    };
    const teacherPage = await open(teacher),
      errors: string[] = [];
    teacherPage.on('pageerror', (e) => errors.push(e.message));
    await expect(teacherPage.locator('.workspace-courses>article')).toHaveCount(20);
    await teacherPage.getByRole('button', { name: '下一页课程', exact: true }).click();
    await expect(teacherPage.getByRole('navigation', { name: '课程分页' })).toContainText(
      '第 2 页',
    );
    await teacherPage.getByRole('button', { name: '上一页课程', exact: true }).click();
    await expect(teacherPage.getByRole('navigation', { name: '课程分页' })).toContainText(
      '第 1 页',
    );
    await teacherPage.getByLabel('搜索我的课程', { exact: true }).fill('机电一班');
    await teacherPage.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(teacherPage.locator('.workspace-courses>article')).toHaveCount(1);
    await teacherPage.getByText('学生名单（分页）', { exact: true }).click();
    await expect(teacherPage.locator('.course-roster p')).toHaveCount(20);
    await teacherPage.getByRole('button', { name: '下一页学生', exact: true }).click();
    await expect(teacherPage.getByRole('navigation', { name: '学生名单分页' })).toContainText(
      '第 2 页',
    );
    const rosterPanel = teacherPage
      .locator('.workspace-courses>article details')
      .filter({ has: teacherPage.getByText('学生名单（分页）', { exact: true }) });
    await rosterPanel.getByLabel('搜索学生名单', { exact: true }).fill('分页学生0519');
    await rosterPanel.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(teacherPage.locator('.course-roster p')).toHaveCount(1);
    await expect(teacherPage.locator('.course-roster')).toContainText('分页学生0519');
    assert.equal(legacyReads, 0);
    await teacherPage.screenshot({
      path: 'docs/v2/evidence/m6-workspace-teacher-local.png',
      fullPage: true,
    });
    record(
      'teacher workspace loads without legacy snapshot, pages own courses, and searches/pages a >500-member roster',
    );
    const studentPage = await open(student);
    studentPage.on('pageerror', (e) => errors.push(e.message));
    await expect(studentPage.locator('.workspace-courses>article')).toHaveCount(20);
    await studentPage.getByLabel('课程每页条数', { exact: true }).selectOption('10');
    await studentPage.getByLabel('搜索我的课程', { exact: true }).fill('分页课程班');
    await studentPage.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(studentPage.locator('.workspace-courses>article')).toHaveCount(10);
    await studentPage.getByRole('button', { name: '下一页课程', exact: true }).click();
    await expect(studentPage.getByRole('navigation', { name: '课程分页' })).toContainText(
      '第 2 页',
    );
    await studentPage.getByLabel('搜索我的课程', { exact: true }).fill('分页课程班0619');
    await studentPage.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(studentPage.locator('.workspace-courses>article')).toHaveCount(1);
    await expect(
      studentPage.getByRole('link', { name: '我的学习概览', exact: true }),
    ).toHaveAttribute('href', `/zhiban/progress?tenant=${t}&offering=${ordinary[619]}`);
    assert.equal(await studentPage.getByText('学生名单（分页）', { exact: true }).count(), 0);
    await studentPage.getByText('学习活动与提交', { exact: true }).click();
    await expect(studentPage.locator('.learning-panel')).toContainText('还没有已发布活动');
    assert.equal(
      (await http(`/api/zhiban/progress/${t}/offerings/${ordinary[619]}`, student)).status,
      200,
    );
    await studentPage.setViewportSize({ width: 390, height: 844 });
    assert.ok(await studentPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await studentPage.screenshot({
      path: 'docs/v2/evidence/m6-workspace-student-local.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    const dualPage = await open(dual.actor);
    await expect(dualPage.locator('.workspace-courses>article')).toHaveCount(2);
    assert.equal(await dualPage.getByRole('link', { name: '教师统计', exact: true }).count(), 1);
    assert.equal(
      await dualPage.getByRole('link', { name: '我的学习概览', exact: true }).count(),
      1,
    );
    record(
      'student course search/page size/reset, own progress/learning entry and mobile layout work; mixed-role cards expose the correct per-course actions',
    );
    await studentPage.goto(origin + '/zhiban');
    await studentPage.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(studentPage.getByRole('heading', { name: '登录智伴', exact: true })).toBeVisible();
    assert.equal((await http(`${base}/courses`, student)).status, 401);
    record('logout revokes paged workspace access and clears the session view');
  }
  if (serve) {
    const login = await http('/api/zhiban/identity/login', undefined, {
      userId: student.uid,
      password: student.password,
    });
    assert.equal(login.status, 200);
    student.cookie = login.cookie;
    student.csrf = (await http('/api/zhiban/identity/csrf', student)).json.csrfToken;
    const accountsPath = join(owned, 'accounts.json'),
      url = origin + '/zhiban';
    await writeFile(
      accountsPath,
      JSON.stringify(
        {
          scope: gradingQueue
            ? 'LOCAL_DISPOSABLE_M6_GRADING_QUEUE'
            : learningRecords
              ? 'LOCAL_DISPOSABLE_M6_LEARNING_RECORDS'
              : 'LOCAL_DISPOSABLE_M6_WORKSPACE',
          workspaceUrl: url,
          tenantId: t,
          accounts: [
            { label: '教师', userId: teacher.uid, password: teacher.password },
            { label: '学生', userId: student.uid, password: student.password },
          ],
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      `docs/v2/evidence/${evidenceName}-demo-local.json`,
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'RUNNING_DISPOSABLE',
          pid: process.pid,
          origin,
          workspaceUrl: url,
          tenantId: t,
          accountsPath,
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
    console.log(`LOCAL M6 workspace ready: ${origin}/zhiban; accounts file: ${accountsPath}`);
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
      'tests/zhiban/directory',
      'tests/zhiban/management',
      'tests/zhiban/learning',
      'tests/zhiban/assessment',
      'tests/zhiban/workspace',
      'tests/zhiban/academic',
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
  await writeFile(
    serve
      ? `docs/v2/evidence/${evidenceName}-demo-close-local.json`
      : `docs/v2/evidence/${evidenceName}-local.json`,
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: failure ? 'FAIL' : 'PASS',
        at: new Date().toISOString(),
        node: process.version,
        pg16: pg,
        scope: gradingQueue
          ? 'M6_TEACHER_GRADING_QUEUE_DISPOSABLE_PG16_HTTPS_UI'
          : learningRecords
            ? 'M6_LEARNING_RECORD_PAGING_DISPOSABLE_PG16_HTTPS_UI'
            : 'M6_MEMBER_COURSE_PAGING_DISPOSABLE_PG16_HTTPS_UI',
        checks,
        sourceHashes,
        lifecycle: { root: owned, port, database, stopped: !started, removed: !failure },
        excluded: [
          '55432/55433 clusters',
          'Native/maintenance quarantine',
          'production/CI signoff',
          'raw User status/credentials',
          'legacy aggregate snapshot refactor and frozen multi-page snapshot',
          'frozen multi-page snapshot',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  if (failure) process.exitCode = 1;
}
