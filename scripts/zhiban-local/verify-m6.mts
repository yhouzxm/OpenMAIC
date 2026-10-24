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
import {
  AnalyticsService,
  type AnalyticsSnapshot,
} from '../../lib/zhiban/application/analytics/service';
import { createAnalyticsHttp } from '../../lib/zhiban/infrastructure/analytics/http';
import { LearningService } from '../../lib/zhiban/application/learning/service';
import { AssessmentService } from '../../lib/zhiban/application/assessment/service';
import { createLearningHttp } from '../../lib/zhiban/infrastructure/learning/http';
import { createAssessmentHttp } from '../../lib/zhiban/infrastructure/assessment/http';
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const serve = process.argv.includes('--serve');
const root = process.cwd(),
  bin = '/usr/lib/postgresql/16/bin',
  port = 56501,
  database = 'zhiban_m6_disposable';
const owned = await mkdtemp(join(tmpdir(), 'zhiban-m6-')),
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
    environment: 'LOCAL_M6_DISPOSABLE',
    approvalRef: 'LOCAL_M6_USER_REQUEST',
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
        requestId: 'LOCAL_M6_SEED',
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
  const origin = 'https://127.0.0.1:3445';
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
        incoming.headers.host !== '127.0.0.1:3445' ||
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
      const r = url.pathname.startsWith('/api/zhiban/analytics/')
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
    server!.listen(3445, '127.0.0.1', done);
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
  const base = `/api/zhiban/analytics/${t}/offerings/${offering}`,
    emptyBase = `/api/zhiban/analytics/${t}/offerings/${emptyOffering}`;
  const report = async (path = base): Promise<AnalyticsSnapshot> => {
    const r = await http(path, teacher);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as unknown as AnalyticsSnapshot;
  };
  let stats = await report();
  assert.equal(stats.summary.enrolled, 5);
  assert.equal(stats.selected, null);
  assert.equal(stats.summary.submitted, null);
  assert.equal((await report(emptyBase)).summary.enrolled, 0);
  record(
    'no published activity and empty class display absence rather than misleading activity counts',
  );
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
  const draft = await cmd(learningBase, teacher, {
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
  const a1 = await start(student),
    s1 = await submit(student, a1),
    g1 = await saveGrade(s1.submissionId, '80', '100');
  stats = await report();
  assert.equal(stats.summary.submitted, 1);
  assert.equal(stats.summary.graded, 0);
  assert.equal(stats.summary.averagePercent, null);
  record('started/submitted counts; draft score excluded');
  await publishGrade(g1);
  const a2 = await start(extraStudents[0]),
    s2 = await submit(extraStudents[0], a2),
    g2 = await saveGrade(s2.submissionId, '10', '20');
  await publishGrade(g2);
  stats = await report();
  assert.equal(stats.summary.graded, 2);
  assert.equal(stats.summary.averagePercent, 65);
  assert.equal(stats.summary.publishedActivities, 1);
  assert.ok(!JSON.stringify(stats).includes('PRIVATE_'));
  record(
    'published grades use unweighted 65% average; draft activities, answers and feedback absent',
  );
  const graded1 = (await http(gradeBase, teacher)).json.grades.find(
    (g: Json) => g.submission_id === s1.submissionId,
  );
  assert.ok(graded1);
  await cmd(gradeBase, teacher, {
    type: 'CORRECT_GRADE',
    submissionId: s1.submissionId,
    revision: graded1.revision,
    score: '90',
    maxScore: '100',
    feedback: 'PRIVATE_FEEDBACK',
    reason: '人工复核',
  });
  stats = await report();
  assert.equal(stats.summary.averagePercent, 70);
  assert.equal(stats.students.find((s) => s.membershipId === student.member)!.gradeVersion, 2);
  record('latest immutable correction contributes once (70% average)');
  const latestAttempt = (await http(learningBase, student)).json.attempts.find(
    (a: Json) => a.id === a1.id,
  );
  assert.ok(latestAttempt);
  const resubmitted = await submit(student, latestAttempt);
  stats = await report();
  assert.equal(stats.summary.graded, 1);
  assert.equal(stats.summary.averagePercent, 50);
  assert.equal(stats.summary.awaitingGrade, 1);
  assert.equal(stats.students.find((s) => s.membershipId === student.member)!.submissionVersion, 2);
  record('resubmission does not borrow previous submission grade');
  await publishGrade(await saveGrade(resubmitted.submissionId, '90', '100'));
  const newAttempt = await start(extraStudents[0]);
  stats = await report();
  assert.equal(stats.summary.submitted, 1);
  assert.equal(stats.summary.graded, 1);
  assert.equal(stats.summary.averagePercent, 90);
  assert.equal(
    stats.students.find((s) => s.membershipId === extraStudents[0].member)!.attemptNo,
    2,
  );
  record('new unsubmitted attempt does not borrow previous attempt submission or grade');
  const newSubmission = await submit(extraStudents[0], newAttempt);
  await publishGrade(await saveGrade(newSubmission.submissionId, '10', '20'));
  await start(extraStudents[1]);
  for (const a of extraStudents.slice(2)) {
    const at = await start(a);
    const s = await submit(a, at);
    await publishGrade(await saveGrade(s.submissionId, '100', '100'));
  }
  await admin.query(
    "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=$3,revision=revision+1 WHERE tenant_id=$1 AND membership_id=$2",
    [t, extraStudents[2].member, Date.now()],
  );
  await admin.query(
    'UPDATE zhiban_academic.enrollments SET valid_from=$3,revision=revision+1 WHERE tenant_id=$1 AND membership_id=$2',
    [t, extraStudents[3].member, Date.now() + 86400000],
  );
  stats = await report();
  assert.deepEqual(stats.summary, {
    enrolled: 3,
    publishedActivities: 1,
    started: 3,
    submitted: 2,
    notSubmitted: 1,
    graded: 2,
    awaitingGrade: 0,
    averagePercent: 70,
  });
  assert.equal(stats.students.length, 3);
  record(
    'withdrawn and future Enrollment exclude even historical submissions/scores from all metrics',
  );
  const second = await create('安全检查记录');
  stats = await report();
  assert.equal(stats.selected?.id, second);
  assert.equal(stats.summary.submitted, 0);
  assert.equal(stats.summary.averagePercent, null);
  const explicit = `${base}?activityId=${activity}&version=1`;
  assert.equal((await report(explicit)).summary.averagePercent, 70);
  record(
    'activity selector has current published versions; default latest activity and explicit selection agree',
  );
  for (const a of [student, outsider, foreign, manager])
    assert.equal((await http(base, a)).status, 403);
  assert.equal((await http(base)).status, 401);
  assert.equal(
    (await http(`/api/zhiban/analytics/${otherTenant}/offerings/${offering}`, teacher)).status,
    403,
  );
  assert.equal(
    (await http(`/api/zhiban/analytics/${t}/offerings/${otherOffering}`, teacher)).status,
    403,
  );
  record('student/admin/unassigned teacher/foreign tenant/other offering/anonymous access denied');
  for (const query of [
    `activityId=${activity}`,
    `version=1`,
    `activityId=${activity}&version=0`,
    `activityId=${activity}&version=1e0`,
    `activityId=${activity}&version=2147483648`,
    `activityId=${activity}&version=1&version=1`,
    'teacher=true',
  ])
    assert.equal((await http(base + '?' + query, teacher)).status, 400);
  assert.equal((await http(`${base}?activityId=${draft.id}&version=1`, teacher)).status, 409);
  assert.equal((await http(`${base}?activityId=${v7()}&version=1`, teacher)).status, 409);
  assert.equal((await http(base, teacher, {}, 'POST')).status, 405);
  record('malformed, duplicate, unpublished/foreign selectors and write methods rejected');
  const forbiddenIdentity = (
    await businessPool.query(
      "SELECT has_table_privilege(current_user,'zhiban_identity.users','SELECT') AS allowed",
    )
  ).rows[0].allowed;
  assert.equal(forbiddenIdentity, false);
  record('report role gains no raw Identity privilege');
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cookieValue = teacher.cookie!.split('=').slice(1).join('=');
  await context.addCookies([
    {
      name: teacher.cookie!.split('=')[0],
      value: cookieValue,
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await page.goto(origin + '/zhiban');
  await page.locator('.space-card').first().click();
  await expect(page.getByRole('link', { name: '教师统计' }).first()).toBeVisible();
  await page
    .getByRole('link', { name: '教师统计' })
    .filter({ hasText: '教师统计' })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: '机电一班' })).toBeVisible();
  await page.locator('#activity').selectOption(activity + ':1');
  await expect(page.getByText('70%', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByLabel('学习状态').selectOption('GRADED');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('查找学生').fill('陈晓');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('90 / 100');
  await page.getByLabel('查找学生').fill('');
  await page.getByLabel('学习状态').selectOption('ALL');
  await page.screenshot({
    path: 'docs/v2/evidence/m6-teacher-analytics-local.png',
    fullPage: true,
  });
  assert.deepEqual(failures, []);
  record(
    'trusted browser workspace entry -> activity switch -> metrics -> status/name filters -> readable scores',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  record('390px responsive page contains horizontal overflow within table');
  await browser.close();
  browser = undefined;
  const activityRow = (await http(learningBase, teacher)).json.activities.find(
    (a: Json) => a.id === activity,
  );
  assert.ok(activityRow);
  await cmd(learningBase, teacher, {
    type: 'EDIT_ACTIVITY',
    id: activity,
    revision: activityRow.revision,
    title: activityRow.title,
    prompt: '第二版题目',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 4,
  });
  const updated = (await http(learningBase, teacher)).json.activities.find(
    (a: Json) => a.id === activity,
  );
  assert.ok(updated);
  await cmd(learningBase, teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: activity,
    revision: updated.revision,
  });
  stats = await report();
  assert.equal(stats.selected?.version, 2);
  assert.equal(stats.summary.submitted, 0);
  assert.equal(stats.summary.graded, 0);
  assert.equal((await http(explicit, teacher)).status, 409);
  record('republish v2 excludes v1 attempts/grades; stale selection conflicts');
  const secondRow = (await http(learningBase, teacher)).json.activities.find(
    (a: Json) => a.id === second,
  );
  assert.ok(secondRow);
  await cmd(learningBase, teacher, {
    type: 'WITHDRAW_ACTIVITY',
    id: second,
    revision: secondRow.revision,
  });
  assert.equal((await report()).summary.publishedActivities, 1);
  assert.equal((await http(`${base}?activityId=${second}&version=1`, teacher)).status, 409);
  record('withdrawn activity disappears and cannot be selected');
  // Check existing assignment lock prevents a concurrent revocation crossing an authorized report.
  const actorHandle = await composition.security.authenticate(
    teacher.cookie!.split('=').slice(1).join('='),
  );
  assert.ok(actorHandle);
  // The real service supplies locked grant/session facts; use its store to hold the report transaction.
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  const entry = new Promise<void>((done) => {
    entered = done;
  });
  const barrier = store.run(
    { handle: actorHandle!, tenantId: t, actorMembershipId: teacher.member },
    null,
    async (actor, tx) => {
      await tx.analytics!.read(actor, offering, null);
      entered();
      await hold;
    },
  );
  await entry;
  const revoker = pool();
  const revocation = revoker.query(
    "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$4,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
    [t, offering, teacher.member, Date.now()],
  );
  let completed = false;
  void revocation.then(() => {
    completed = true;
  });
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(completed, false);
  release();
  await barrier;
  await revocation;
  assert.equal((await http(base, teacher)).status, 403);
  record('assignment revocation waits for in-flight read lock; subsequent report denied');
  const logout = await http('/api/zhiban/identity/logout', teacher, {});
  assert.ok([200, 204].includes(logout.status));
  assert.equal((await http(emptyBase, teacher)).status, 401);
  record('logout invalidates subsequent report even on still assigned class');
  // Optional fresh usable demo: new synthetic activity uses real M3/M4 commands, not rewound history.
  if (serve) {
    const relogin = await http('/api/zhiban/identity/login', undefined, {
      userId: teacher.uid,
      password: teacher.password,
    });
    assert.equal(relogin.status, 200);
    teacher.cookie = relogin.cookie;
    teacher.csrf = (await http('/api/zhiban/identity/csrf', teacher)).json.csrfToken;
    await admin.query(
      "UPDATE zhiban_academic.assignments SET status='ACTIVE',valid_from=$4,valid_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
      [t, offering, teacher.member, Date.now()],
    );
    const demo = await create('电机回路分析 · 课堂练习');
    const ds1 = await submit(student, await start(student, demo));
    await publishGrade(await saveGrade(ds1.submissionId, '90', '100'));
    const ds2 = await submit(extraStudents[0], await start(extraStudents[0], demo));
    await publishGrade(await saveGrade(ds2.submissionId, '10', '20'));
    await start(extraStudents[1], demo);
    const accountsPath = join(owned, 'accounts.json');
    const url = origin + `/zhiban/analytics?tenant=${t}&offering=${offering}`;
    await writeFile(
      accountsPath,
      JSON.stringify(
        {
          scope: 'LOCAL_DISPOSABLE_M6',
          analyticsUrl: url,
          accounts: [{ label: '教师', userId: teacher.uid, password: teacher.password }],
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      'docs/v2/evidence/m6-teacher-analytics-demo-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          status: 'RUNNING_DISPOSABLE',
          pid: process.pid,
          origin,
          analyticsUrl: url,
          accountsPath,
          root: owned,
          port,
          database,
          sourceHashes,
          validation: {
            status: 'PASS',
            checks,
            pg16: pg,
            node: process.version,
            scope: 'DISPOSABLE_PG16_HTTPS_UI',
          },
          tlsCertificateSha256: hash(tls),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`LOCAL M6 ready: ${origin}/zhiban; accounts file: ${accountsPath}`);
    await new Promise<void>((done) => {
      process.once('SIGINT', () => done());
      process.once('SIGTERM', () => done());
    });
  }
}
try {
  // Bind the executed artifact and its in-repository source/dependency closure, including local entry wiring.
  const paths = execFileSync(
    'rg',
    [
      '--files',
      'lib/zhiban',
      'app/zhiban/local',
      'scripts/zhiban-local',
      'tests/zhiban/identity/authorization/fixtures.ts',
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
    scope: 'M6_TEACHER_ANALYTICS_DISPOSABLE_PG16_REAL_IDENTITY_M3_M4_HTTPS_UI',
    checks,
    sourceHashes,
    lifecycle: { root: owned, port, database, stopped: !started, removed: !failure },
    excluded: [
      '55432/55433 clusters',
      'Native/maintenance quarantine',
      'production/CI signoff',
      'Runtime/AI',
      'student identity eligibility/course total grades',
    ],
  };
  // A demo run must not overwrite completed disposable verification evidence.
  await writeFile(
    serve
      ? 'docs/v2/evidence/m6-teacher-analytics-demo-close-local.json'
      : 'docs/v2/evidence/m6-teacher-analytics-local.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  if (failure) process.exitCode = 1;
}
