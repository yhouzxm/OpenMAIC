import {
  ProgressService,
  type PersonalSnapshot,
} from '../../lib/zhiban/application/progress/service';
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
  port = 56502,
  database = 'zhiban_m6_student_disposable';
const owned = await mkdtemp(join(tmpdir(), 'zhiban-m6-student-')),
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
    environment: 'LOCAL_M6_STUDENT_DISPOSABLE',
    approvalRef: 'LOCAL_M6_STUDENT_USER_REQUEST',
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
    ['TEACHER', t],
    ['TEACHER', otherTenant],
    ['TENANT_ADMIN', t],
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
        requestId: 'LOCAL_M6_STUDENT_SEED',
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
      ['李明', '王悦', '历史学生', '待入班学生'][i],
    ]);
  }
  await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
    t,
    student.member,
    '陈晓',
  ]);
  const origin = 'https://127.0.0.1:3446';
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
        incoming.headers.host !== '127.0.0.1:3446' ||
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
      const r = url.pathname.startsWith('/api/zhiban/progress/')
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
    server!.listen(3446, '127.0.0.1', done);
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
  const http = (path: string, a?: Actor, payload?: unknown, method?: string) =>
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
  const learningBase = `/api/zhiban/learning/${t}/offerings/${offering}`,
    gradeBase = `/api/zhiban/assessment/${t}/offerings/${offering}`;
  const cmd = async (path: string, a: Actor, v: unknown) => {
    const r = await http(path, a, v);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const create = async (title: string) => {
    const r = await cmd(learningBase, teacher, {
      type: 'CREATE_ACTIVITY',
      title,
      prompt: '说明测量与判断过程',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 4,
    });
    await cmd(learningBase, teacher, { type: 'PUBLISH_ACTIVITY', id: r.id, revision: r.revision });
    return String(r.id);
  };
  const activity = await create('电机回路分析');
  await cmd(learningBase, teacher, {
    type: 'CREATE_ACTIVITY',
    title: '未发布活动',
    prompt: 'PRIVATE_PROMPT',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 4,
  });
  const start = async (a: Actor, id = activity) =>
    cmd(learningBase, a, { type: 'START_ATTEMPT', id });
  const submit = async (a: Actor, attempt: Json) =>
    cmd(learningBase, a, {
      type: 'SUBMIT',
      id: attempt.id,
      revision: attempt.revision,
      answer: 'PRIVATE_ANSWER_' + a.member,
    });
  const saveGrade = async (submissionId: string, score: string, maxScore: string) => {
    await cmd(gradeBase, teacher, {
      type: 'SAVE_GRADE',
      submissionId,
      revision: null,
      score,
      maxScore,
      feedback: 'PRIVATE_FEEDBACK',
    });
    const r = await http(gradeBase, teacher);
    const grade = r.json.grades.find((g: Json) => g.submission_id === submissionId);
    assert.ok(grade);
    return grade;
  };
  const publishGrade = async (g: Json) =>
    cmd(gradeBase, teacher, {
      type: 'PUBLISH_GRADE',
      submissionId: g.submission_id,
      revision: g.revision,
    });
  const base = `/api/zhiban/progress/${t}/offerings/${offering}`;
  const report = async (a = student, path = base): Promise<PersonalSnapshot> => {
    const r = await http(path, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as unknown as PersonalSnapshot;
  };
  await admin.query(
    "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
    [t, v7(), emptyOffering, student.member, now],
  );
  let stats = await report();
  assert.equal(stats.summary.activities, 1);
  assert.equal(stats.history.length, 0);
  assert.equal(stats.activities[0].latest, null);
  assert.equal(stats.summary.averagePercent, null);
  const empty = await report(student, `/api/zhiban/progress/${t}/offerings/${emptyOffering}`);
  assert.equal(empty.summary.activities, 0);
  assert.deepEqual(empty.history, []);
  record('unstarted current activity and genuine empty-class state; draft activity excluded');
  const a1 = await start(student),
    s1 = await submit(student, a1),
    g1 = await saveGrade(s1.submissionId, '80', '100');
  stats = await report();
  assert.equal(stats.summary.submitted, 1);
  assert.equal(stats.summary.graded, 0);
  assert.equal(stats.activities[0].latest?.scorePoints, null);
  assert.equal(stats.activities[0].latest?.feedback, null);
  assert.ok(!JSON.stringify(stats).includes('PRIVATE_'));
  record('own latest submission counted; no answer or unpublished grade/feedback returned');
  await publishGrade(g1);
  const grade = (await http(gradeBase, teacher)).json.grades.find(
    (g) => g.submission_id === s1.submissionId,
  );
  assert.ok(grade);
  await cmd(gradeBase, teacher, {
    type: 'CORRECT_GRADE',
    submissionId: s1.submissionId,
    revision: grade.revision,
    score: '90',
    maxScore: '100',
    feedback: '核对完成\n接线判断清楚。',
    reason: '复核测量结果',
  });
  stats = await report();
  assert.equal(stats.summary.averagePercent, 90);
  assert.equal(stats.activities[0].latest?.gradeVersion, 2);
  assert.equal(stats.activities[0].latest?.correctionReason, '复核测量结果');
  assert.equal(stats.activities[0].latest?.feedback, '核对完成\n接线判断清楚。');
  record('latest immutable correction and its public feedback/reason visible only to owner');
  const peerAttempt = await start(extraStudents[0]),
    peerSubmission = await submit(extraStudents[0], peerAttempt);
  const peerGrade = await saveGrade(peerSubmission.submissionId, '10', '20');
  await publishGrade(peerGrade);
  const raw = JSON.stringify(await report());
  assert.ok(!raw.includes(peerAttempt.id));
  assert.ok(!raw.includes(peerSubmission.submissionId));
  assert.ok(!raw.includes(extraStudents[0].member));
  assert.ok(!raw.includes('PRIVATE_FEEDBACK'));
  const peerReport = await report(extraStudents[0]);
  assert.equal(peerReport.summary.averagePercent, 50);
  assert.equal(peerReport.history.length, 1);
  assert.notEqual(peerReport.history[0].id, a1.id);
  record('same-class sessions each receive only their own attempts/submissions/grades');
  const latest = (await http(learningBase, student)).json.attempts.find((a) => a.id === a1.id);
  assert.ok(latest);
  const resubmit = await submit(student, latest);
  stats = await report();
  assert.equal(stats.summary.graded, 0);
  assert.equal(stats.summary.awaitingGrade, 1);
  assert.equal(stats.activities[0].latest?.feedback, null);
  assert.equal(stats.activities[0].latest?.submissionVersion, 2);
  record('resubmission removes previous submission grade and public feedback from current result');
  await publishGrade(await saveGrade(resubmit.submissionId, '90', '100'));
  const next = await start(student);
  stats = await report();
  assert.equal(stats.summary.submitted, 0);
  assert.equal(stats.summary.graded, 0);
  assert.equal(stats.activities[0].latest?.attemptNo, 2);
  assert.equal(stats.history.length, 2);
  assert.ok(stats.history.some((h) => h.attemptNo === 1 && h.scorePoints === 9000));
  record('new attempt supersedes current progress while retaining own previous attempt in history');
  const nextSubmission = await submit(student, next);
  await publishGrade(await saveGrade(nextSubmission.submissionId, '80', '100'));
  const second = await create('安全检查记录'),
    secondAttempt = await start(student, second),
    secondSubmission = await submit(student, secondAttempt);
  await publishGrade(await saveGrade(secondSubmission.submissionId, '10', '20'));
  stats = await report();
  assert.equal(stats.summary.averagePercent, 65);
  assert.equal(stats.summary.graded, 2);
  assert.equal(stats.summary.activities, 2);
  record('current-activity mean uses unweighted individual score ratios (80% and 50% -> 65%)');
  // Reuse teacher endpoint as a regression comparison after shared store composition changed.
  const teacherStats = await http(
    `/api/zhiban/analytics/${t}/offerings/${offering}?activityId=${activity}&version=1`,
    teacher,
  );
  assert.equal(teacherStats.status, 200);
  const teacherData = teacherStats.json as unknown as {
    students: { membershipId: string; scorePoints: number; attemptNo: number }[];
  };
  assert.equal(
    teacherData.students.find((s) => s.membershipId === student.member)?.scorePoints,
    8000,
  );
  record('teacher analytics still reads same latest score through shared store');
  for (const actor of [teacher, outsider, foreign, manager])
    assert.equal((await http(base, actor)).status, 403);
  assert.equal((await http(base)).status, 401);
  assert.equal(
    (await http(`/api/zhiban/progress/${otherTenant}/offerings/${offering}`, student)).status,
    403,
  );
  assert.equal(
    (await http(`/api/zhiban/progress/${t}/offerings/${otherOffering}`, student)).status,
    403,
  );
  for (const q of [
    `membershipId=${extraStudents[0].member}`,
    `studentId=${extraStudents[0].member}`,
    `activityId=${activity}`,
    'version=1',
    'version=1&version=1',
  ])
    assert.equal((await http(base + '?' + q, student)).status, 400);
  assert.equal((await http(base, student, {}, 'POST')).status, 405);
  record(
    'anonymous/teacher/admin/foreign/unenrolled denied; learner selectors and writes rejected',
  );
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai' }),
    page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await context.addCookies([
    {
      name: student.cookie!.split('=')[0],
      value: student.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  await page.goto(origin + '/zhiban');
  await page.locator('.space-card').first().click();
  await page.getByRole('link', { name: '我的学习概览', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '机电一班' })).toBeVisible();
  await expect(page.getByText('65%', { exact: true })).toBeVisible();
  await expect(page.locator('.personal-activity')).toHaveCount(2);
  await page.getByLabel('筛选活动状态').selectOption('NEW');
  await expect(page.getByText('没有符合筛选条件的活动。')).toBeVisible();
  await page.getByLabel('筛选活动状态').selectOption('GRADED');
  await expect(page.locator('.personal-activity')).toHaveCount(2);
  await page.locator('.personal-history summary').last().click();
  await expect(page.locator('.personal-history').last()).toContainText('90 / 100');
  await page.screenshot({ path: 'docs/v2/evidence/m6-student-overview-local.png', fullPage: true });
  assert.deepEqual(pageErrors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  record(
    'trusted browser student workbench entry -> summary -> status filter -> own history and published score; 390px layout',
  );
  const firstRow = (await http(learningBase, teacher)).json.activities.find(
    (a) => a.id === activity,
  );
  assert.ok(firstRow);
  await cmd(learningBase, teacher, {
    type: 'WITHDRAW_ACTIVITY',
    id: activity,
    revision: firstRow.revision,
  });
  stats = await report();
  assert.equal(stats.summary.activities, 1);
  assert.equal(stats.summary.averagePercent, 50);
  assert.ok(stats.history.some((h) => h.activityId === activity));
  record(
    'withdrawn activity excluded from current summary; own historical attempts remain readable',
  );
  const secondRow = (await http(learningBase, teacher)).json.activities.find(
    (a) => a.id === second,
  );
  assert.ok(secondRow);
  await cmd(learningBase, teacher, {
    type: 'EDIT_ACTIVITY',
    id: second,
    revision: secondRow.revision,
    title: secondRow.title,
    prompt: '第二版检查表',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 4,
  });
  const edited = (await http(learningBase, teacher)).json.activities.find((a) => a.id === second);
  assert.ok(edited);
  await cmd(learningBase, teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: second,
    revision: edited.revision,
  });
  stats = await report();
  assert.equal(stats.activities[0].version, 2);
  assert.equal(stats.activities[0].latest, null);
  assert.equal(stats.summary.graded, 0);
  assert.ok(
    stats.history.some(
      (h) => h.activityId === second && h.activityVersion === 1 && h.scorePoints === 1000,
    ),
  );
  record(
    'republished version starts without inherited progress; published historical version kept separate',
  );
  // With an active student in another class, in-flight enrollment revocation must wait for the read lock.
  const handle = await composition.security.authenticate(
    student.cookie!.split('=').slice(1).join('='),
  );
  assert.ok(handle);
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((done) => {
      release = done;
    }),
    entry = new Promise<void>((done) => {
      entered = done;
    });
  const read = store.run(
    { handle, tenantId: t, actorMembershipId: student.member },
    null,
    async (actor, tx) => {
      await tx.progress!.read(actor, offering);
      entered();
      await hold;
    },
  );
  await entry;
  const revoker = pool();
  let revoked = false;
  const revoke = revoker.query(
    "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=$4,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
    [t, offering, student.member, Date.now()],
  );
  void revoke.then(() => {
    revoked = true;
  });
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(revoked, false);
  release();
  await read;
  await revoke;
  assert.equal((await http(base, student)).status, 403);
  await page.getByRole('button', { name: '刷新数据' }).click();
  await expect(page.getByRole('alert')).toContainText('当前身份无法查看');
  assert.equal(await page.locator('.personal-activity').count(), 0);
  record(
    'Enrollment revocation waits for active reader; next API request denied and browser clears prior results',
  );
  const emptyBase = `/api/zhiban/progress/${t}/offerings/${emptyOffering}`;
  await admin.query(
    'UPDATE zhiban_academic.enrollments SET valid_from=$4 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
    [t, emptyOffering, student.member, Date.now() + 86400000],
  );
  assert.equal((await http(emptyBase, student)).status, 403);
  record('future Enrollment cannot authorize personal overview');
  await admin.query(
    'UPDATE zhiban_academic.enrollments SET valid_from=$4 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
    [t, emptyOffering, student.member, Date.now()],
  );
  const logout = await http('/api/zhiban/identity/logout', student, {});
  assert.ok([200, 204].includes(logout.status));
  assert.equal((await http(emptyBase, student)).status, 401);
  record('logged-out session loses own overview even in still enrolled class');
  await browser.close();
  browser = undefined;
  if (serve) {
    // New demo Enrollment + new activities for a separate student; never restore the withdrawn test enrollment.
    const demoStudent = extraStudents[1];
    const demoActivity = await create('电机回路分析 · 自主练习');
    const a = await start(demoStudent, demoActivity),
      s = await submit(demoStudent, a);
    await publishGrade(await saveGrade(s.submissionId, '85.25', '100'));
    const g = (await http(gradeBase, teacher)).json.grades.find(
      (r) => r.submission_id === s.submissionId,
    );
    assert.ok(g);
    await cmd(gradeBase, teacher, {
      type: 'CORRECT_GRADE',
      submissionId: s.submissionId,
      revision: g.revision,
      score: '90',
      maxScore: '100',
      feedback: '电路判断清楚。\n建议再核对接触器互锁条件。',
      reason: '人工复核接线步骤',
    });
    const pendingActivity = await create('工具与安全检查'),
      pendingAttempt = await start(demoStudent, pendingActivity);
    await submit(demoStudent, pendingAttempt);
    await create('测量记录 · 课前准备');
    const accountsPath = join(owned, 'accounts.json'),
      url = origin + `/zhiban/progress?tenant=${t}&offering=${offering}`;
    await writeFile(
      accountsPath,
      JSON.stringify(
        {
          scope: 'LOCAL_DISPOSABLE_M6_STUDENT',
          progressUrl: url,
          accounts: [
            { label: '学生', userId: demoStudent.uid, password: demoStudent.password },
            { label: '教师', userId: teacher.uid, password: teacher.password },
          ],
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      'docs/v2/evidence/m6-student-overview-demo-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'RUNNING_DISPOSABLE',
          pid: process.pid,
          origin,
          progressUrl: url,
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
    console.log(`LOCAL M6 student ready: ${origin}/zhiban; accounts file: ${accountsPath}`);
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
      'tests/zhiban/progress',
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
    scope: 'M6_STUDENT_OVERVIEW_DISPOSABLE_PG16_REAL_IDENTITY_M3_M4_HTTPS_UI',
    checks,
    sourceHashes,
    lifecycle: { root: owned, port, database, stopped: !started, removed: !failure },
    excluded: [
      '55432/55433 clusters',
      'Native/maintenance quarantine',
      'production/CI signoff',
      'Runtime/AI',
      'course total grades/eligibility/risk',
    ],
  };
  await writeFile(
    serve
      ? 'docs/v2/evidence/m6-student-overview-demo-close-local.json'
      : 'docs/v2/evidence/m6-student-overview-local.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  if (failure) process.exitCode = 1;
}
