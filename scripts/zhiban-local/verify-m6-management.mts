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
  port = 56505,
  database = 'zhiban_m6_management_disposable';
const owned = await mkdtemp(join(tmpdir(), 'zhiban-m6-management-')),
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
    environment: 'LOCAL_M6_MANAGEMENT_DISPOSABLE',
    approvalRef: 'LOCAL_M6_MANAGEMENT_USER_REQUEST',
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
        requestId: 'LOCAL_M6_MANAGEMENT_SEED',
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
  const origin = 'https://127.0.0.1:3449';
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
        incoming.headers.host !== '127.0.0.1:3449' ||
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
        '/zhiban/style.css': ['style.css', 'text/css'],
        '/zhiban/management': ['management.html', 'text/html'],
        '/zhiban/management.js': ['management.js', 'text/javascript'],
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
      const r = url.pathname.startsWith('/api/zhiban/management/')
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
    server!.listen(3449, '127.0.0.1', done);
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

  type Page = Awaited<ReturnType<ManagementService['read']>>;
  const base = `/api/zhiban/management/${t}`;
  const read = async (
    kind: 'offerings' | 'enrollments',
    params: Record<string, string> = {},
    a = manager,
  ): Promise<Page> => {
    const r = await http(`${base}/${kind}?` + new URLSearchParams(params), a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as unknown as Page;
  };
  const command = (payload: unknown, a = manager, key = v7().replaceAll('-', '')) =>
    http(`${base}/commands`, a, payload, 'POST', { 'x-zhiban-command': key });
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
    const loaded = await members.create(tenantScopeContext(t), member);
    await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [t, member.id, name]);
    return { member: member.id, loaded };
  };
  const bulk = [];
  await admin.query(
    'UPDATE zhiban_academic.offerings SET capacity=1000 WHERE tenant_id=$1 AND id=$2',
    [t, offering],
  );
  for (let i = 0; i < 620; i++) {
    const person = await makeMember('大名单学生' + String(i).padStart(4, '0'));
    bulk.push(person);
    await admin.query(
      "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
      [t, v7(), offering, person.member, now],
    );
    const id = v7();
    await admin.query(
      "INSERT INTO zhiban_academic.offerings VALUES($1,$2,$3,1,$4,NULL,$5,$6,20,'OPEN',1)",
      [t, id, course, term, 'PAGE' + i, '分页教学班' + String(i).padStart(4, '0')],
    );
  }
  const candidate = await makeMember('待入班学生甲'),
    second = await makeMember('待入班学生乙'),
    disabled = await makeMember('已禁用学生'),
    literal = await makeMember('百分%_学生');
  await members.save(
    tenantScopeContext(t),
    disabled.loaded.value.disable({
      reason: 'LOCAL_MANAGEMENT_TEST',
      expectedAuthorizationVersion: disabled.loaded.value.authorizationVersion,
      now: instant(Date.now()),
    }),
    disabled.loaded.revision,
  );
  assert.equal((await http(`/api/zhiban/academic/${t}`, manager)).status, 503);
  record('623 offerings, 629 ACTIVE enrollments and >500 profiles; legacy snapshot fails closed');
  const collect = async (kind: 'offerings' | 'enrollments', params: Record<string, string>) => {
    const seen = new Set<string>();
    let cursor: string | null = null,
      pages = 0;
    do {
      const result = await read(kind, { ...params, ...(cursor ? { cursor } : {}) });
      assert.ok(result.rows.length <= Number(params.limit));
      for (const row of result.rows) {
        assert.ok(!seen.has(String(row.id)));
        seen.add(String(row.id));
      }
      cursor = result.nextCursor;
      assert.ok(++pages < 100);
    } while (cursor);
    return seen;
  };
  assert.equal((await collect('offerings', { limit: '50' })).size, 623);
  assert.equal((await collect('enrollments', { offering, limit: '50' })).size, 629);
  assert.equal((await read('offerings', { q: '分页教学班0619' })).rows.length, 1);
  assert.equal((await read('enrollments', { offering, q: '大名单学生0619' })).rows.length, 1);
  assert.equal((await read('enrollments', { offering, q: '不存在' })).rows.length, 0);
  assert.equal((await read('enrollments', { offering: emptyOffering })).rows.length, 0);
  record(
    'bounded keyset scans cover all offerings and per-offering enrollments without duplicate IDs; Chinese search and empty roster work',
  );
  for (const a of [teacher, student, foreign])
    assert.equal((await http(`${base}/offerings`, a)).status, 403);
  assert.equal((await http(`${base}/offerings`)).status, 401);
  for (const tail of [
    'offerings?limit=500',
    'offerings?limit=020',
    'offerings?q=x&q=y',
    'offerings?extra=x',
    'enrollments',
    'enrollments?offering=' + v7(),
  ]) {
    const status = (await http(`${base}/${tail}`, manager)).status;
    assert.ok([400, 404].includes(status), tail + ':' + status);
  }
  const first = await read('enrollments', { offering, limit: '10' });
  for (const p of [
    { offering: otherOffering },
    { offering, limit: '50' },
    { offering, state: 'WITHDRAWN' },
    { offering, q: 'x' },
  ] as Record<string, string>[])
    assert.equal(
      (
        await http(
          `${base}/enrollments?` + new URLSearchParams({ ...p, cursor: first.nextCursor! }),
          manager,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await http(
        `${base}/enrollments?` +
          new URLSearchParams({ offering, limit: '10', cursor: first.nextCursor! }),
        outsider,
      )
    ).status,
    400,
  );
  const privateTenant = await http(
    `/api/zhiban/management/${otherTenant}/enrollments?offering=${offering}`,
    foreign,
  );
  assert.equal(privateTenant.status, 404);
  assert.equal(
    (
      await http(
        `${base}/commands`,
        manager,
        { type: 'WITHDRAW', id: v7(), revision: '1' },
        'POST',
        { 'x-zhiban-csrf': 'x'.repeat(43) },
      )
    ).status,
    403,
  );
  assert.equal((await http(`${base}/commands`, manager)).status, 405);
  assert.equal((await http(`${base}/offerings`, manager, {})).status, 405);
  record(
    'anonymous/non-admin/cross-tenant access, stale filter/admin cursors, duplicate query, invalid bounds and invalid CSRF are refused',
  );
  const cmd = {
      type: 'ENROLL',
      offeringId: offering,
      membershipId: candidate.member,
      revision: null,
    },
    keyReplay = v7().replaceAll('-', '');
  const ack = await command(cmd, manager, keyReplay);
  assert.equal(ack.status, 200);
  assert.deepEqual(ack.json, { commandKey: keyReplay, type: 'ENROLL', status: 'COMPLETED' });
  assert.equal((await command(cmd, manager, keyReplay)).status, 200);
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
          [t, keyReplay],
        )
      ).rows[0].n,
    ),
    1,
  );
  assert.equal(
    (await command({ ...cmd, membershipId: second.member }, manager, keyReplay)).status,
    409,
  );
  assert.equal((await command({ ...cmd, membershipId: disabled.member })).status, 403);
  let enrolled = (await read('enrollments', { offering, member: candidate.member, state: 'ALL' }))
    .rows[0];
  assert.equal(enrolled.status, 'ACTIVE');
  assert.equal((await command({ type: 'WITHDRAW', id: enrolled.id, revision: '999' })).status, 409);
  assert.equal(
    (await command({ type: 'WITHDRAW', id: enrolled.id, revision: enrolled.revision })).status,
    200,
  );
  enrolled = (await read('enrollments', { offering, member: candidate.member, state: 'ALL' }))
    .rows[0];
  assert.equal(enrolled.status, 'WITHDRAWN');
  assert.equal((await command({ ...cmd, revision: null })).status, 409);
  assert.equal((await command({ ...cmd, revision: enrolled.revision })).status, 200);
  record(
    'ACK mutations commit beyond snapshot cap, retry uses one durable audit, key collision/stale revision/inactive member denied, withdrawal and manual restoration work',
  );
  const before = (await read('enrollments', { offering })).offering!;
  assert.equal(
    (
      await command({
        type: 'UPDATE_OFFERING',
        id: offering,
        revision: before.revision,
        name: before.name,
        capacity: 600,
        status: 'OPEN',
      })
    ).status,
    409,
  );
  const target = (await read('enrollments', { offering: otherOffering })).offering!;
  assert.equal(
    (
      await command({
        type: 'UPDATE_OFFERING',
        id: otherOffering,
        revision: target.revision,
        name: target.name,
        capacity: 1,
        status: 'OPEN',
      })
    ).status,
    200,
  );
  const contested = await Promise.all([
    command({
      type: 'ENROLL',
      offeringId: otherOffering,
      membershipId: second.member,
      revision: null,
    }),
    command(
      { type: 'ENROLL', offeringId: otherOffering, membershipId: literal.member, revision: null },
      outsider,
    ),
  ]);
  assert.deepEqual(contested.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await read('enrollments', { offering: otherOffering })).offering!.enrolled_count,
    1,
  );
  enrolled = (await read('enrollments', { offering, member: candidate.member })).rows[0];
  assert.equal(
    (
      await command({
        type: 'TRANSFER',
        id: enrolled.id,
        revision: enrolled.revision,
        targetOfferingId: otherOffering,
        targetRevision: null,
      })
    ).status,
    409,
  );
  assert.equal(
    (await read('enrollments', { offering, member: candidate.member })).rows[0].status,
    'ACTIVE',
  );
  assert.equal(
    (
      await command({
        type: 'TRANSFER',
        id: enrolled.id,
        revision: enrolled.revision,
        targetOfferingId: emptyOffering,
        targetRevision: null,
      })
    ).status,
    200,
  );
  assert.equal(
    (await read('enrollments', { offering, member: candidate.member, state: 'ALL' })).rows[0]
      .status,
    'WITHDRAWN',
  );
  assert.equal(
    (await read('enrollments', { offering: emptyOffering, member: candidate.member })).rows[0]
      .status,
    'ACTIVE',
  );
  const targets = await read('offerings', { source: offering, limit: '10' });
  assert.equal(targets.rows.length, 10);
  assert.ok(
    targets.rows.every(
      (r) =>
        r.id !== offering && r.course_id === course && r.term_id === term && r.status === 'OPEN',
    ),
  );
  record(
    'capacity reduction and concurrent final-seat contention reject overflow; failed transfer preserves source and successful transfer is atomic; transfer targets are paged',
  );
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  await page.goto(origin + '/zhiban');
  await page.locator('.space-card').first().click();
  await page.getByRole('link', { name: '教学班与学生名单（分页）', exact: true }).click();
  await expect(page.locator('.management-list article')).toHaveCount(20);
  const firstName = await page.locator('.management-list article h2').first().innerText();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第 2 页 · 本页 20 条', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.locator('.management-list article h2').first()).toHaveText(firstName);
  await page.getByLabel('搜索教学班', { exact: true }).fill('机电一班');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.management-list article')).toHaveCount(1);
  await page.getByRole('button', { name: '管理学生名单', exact: true }).click();
  await expect(page.locator('.management-list article')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第 2 页 · 本页 20 条', { exact: true })).toBeVisible();
  await page.getByLabel('搜索学生', { exact: true }).fill('大名单学生0619');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.management-list article')).toHaveCount(1);
  await expect(page.getByText('第 1 页 · 本页 1 条', { exact: true })).toBeVisible();
  record(
    'trusted HTTPS browser enters paged admin workspace after legacy overflow; offering and Enrollment previous/next and search reset work',
  );
  let droppedKey = '';
  await page.route(
    `**/api/zhiban/management/${t}/commands`,
    async (route) => {
      droppedKey = route.request().headers()['x-zhiban-command'];
      const r = await http(`${base}/commands`, manager, route.request().postDataJSON(), 'POST', {
        'x-zhiban-command': droppedKey,
      });
      assert.equal(r.status, 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '移出学生', exact: true }).click();
  await expect(page.getByRole('button', { name: '按原命令号重试', exact: true })).toBeVisible();
  assert.equal(
    (await read('enrollments', { offering, member: bulk[619].member, state: 'ALL' })).rows[0]
      .status,
    'WITHDRAWN',
  );
  await page.getByRole('button', { name: '按原命令号重试', exact: true }).click();
  await expect(page.getByText('暂无匹配记录。', { exact: true })).toBeVisible();
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
          [t, droppedKey],
        )
      ).rows[0].n,
    ),
    1,
  );
  await page.getByLabel('状态', { exact: true }).selectOption('WITHDRAWN');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复入班', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复入班', exact: true }).click();
  await expect(page.getByText('暂无匹配记录。', { exact: true })).toBeVisible();
  record(
    'response loss after COMMIT locks other controls and replays original key without duplicate audit; UI restores withdrawn Enrollment',
  );
  await page.getByLabel('状态', { exact: true }).selectOption('ACTIVE');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: '转班', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一页目标', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '下一页目标', exact: true }).click();
  await expect(
    page.locator('.management-transfer button').filter({ hasText: '转入 分页教学班' }).first(),
  ).toBeVisible();
  await page
    .locator('.management-transfer button')
    .filter({ hasText: '转入 分页教学班' })
    .first()
    .click();
  await expect(page.getByText('暂无匹配记录。', { exact: true })).toBeVisible();
  assert.equal(
    (await read('enrollments', { offering, member: bulk[619].member, state: 'ALL' })).rows[0]
      .status,
    'WITHDRAWN',
  );
  record(
    'UI browses multiple pages of transfer targets and atomically transfers the selected student',
  );
  await page.getByRole('button', { name: '返回教学班列表', exact: true }).click();
  await page.getByLabel('搜索教学班', { exact: true }).fill('分页教学班');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.management-list article')).toHaveCount(20);
  await page.screenshot({
    path: 'docs/v2/evidence/m6-management-offerings-local.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '管理学生名单', exact: true }).first().click();
  await page.getByText('修改教学班', { exact: true }).click();
  await page.getByLabel('教学班名称', { exact: true }).fill('浏览器已修改教学班');
  await page.getByRole('button', { name: '保存教学班', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '浏览器已修改教学班', exact: true }),
  ).toBeVisible();
  await page.getByText('从学生目录添加一名学生', { exact: true }).click();
  await expect(page.locator('.directory-table tbody tr')).toHaveCount(20);
  await page
    .getByRole('searchbox', { name: '姓名或完整成员 ID', exact: true })
    .fill(candidate.member);
  await page.getByRole('button', { name: '搜索学生', exact: true }).click();
  await expect(page.locator('.directory-table tbody tr')).toHaveCount(1);
  await page.locator('.directory-table input[type="checkbox"]').check();
  await page.getByRole('button', { name: '添加已选学生', exact: true }).click();
  await expect(page.locator('.management-list article')).toHaveCount(1);
  record(
    'UI edits a teaching class and adds a single student from the paged directory with fresh Enrollment revision lookup',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: 'docs/v2/evidence/m6-management-enrollments-local.png',
    fullPage: true,
  });
  record('390px responsive layout has no horizontal overflow or browser script errors');
  await page.goto(origin + '/zhiban');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录智伴', exact: true })).toBeVisible();
  assert.equal((await http(`${base}/offerings`, manager)).status, 401);
  record('logout revokes access to paged management');

  if (serve) {
    const login = await http('/api/zhiban/identity/login', undefined, {
      userId: manager.uid,
      password: manager.password,
    });
    assert.equal(login.status, 200);
    manager.cookie = login.cookie;
    manager.csrf = (await http('/api/zhiban/identity/csrf', manager)).json.csrfToken;
    const accountsPath = join(owned, 'accounts.json'),
      url = origin + `/zhiban/management?tenant=${t}`,
      rosterUrl = origin + `/zhiban/roster?tenant=${t}&offering=${otherOffering}`;
    await writeFile(
      accountsPath,
      JSON.stringify(
        {
          scope: 'LOCAL_DISPOSABLE_M6_MANAGEMENT',
          directoryUrl: url,
          rosterUrl,
          accounts: [{ label: '教务管理员', userId: manager.uid, password: manager.password }],
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      'docs/v2/evidence/m6-management-demo-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'RUNNING_DISPOSABLE',
          pid: process.pid,
          origin,
          directoryUrl: url,
          rosterUrl,
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
    console.log(`LOCAL M6 directory ready: ${origin}/zhiban; accounts file: ${accountsPath}`);
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
      ? 'docs/v2/evidence/m6-management-demo-close-local.json'
      : 'docs/v2/evidence/m6-management-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: failure ? 'FAIL' : 'PASS',
        at: new Date().toISOString(),
        node: process.version,
        pg16: pg,
        scope: 'M6_TEACHING_CLASS_ENROLLMENT_PAGING_DISPOSABLE_PG16_HTTPS_UI',
        checks,
        sourceHashes,
        lifecycle: { root: owned, port, database, stopped: !started, removed: !failure },
        excluded: [
          '55432/55433 clusters',
          'Native/maintenance quarantine',
          'production/CI signoff',
          'raw User status/credentials',
          'course/term/class/assignment and teacher/student snapshot pagination',
          'frozen multi-page snapshot',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  if (failure) process.exitCode = 1;
}
