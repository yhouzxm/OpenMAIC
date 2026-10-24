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
  courseId,
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
  port = 56507,
  database = 'zhiban_m6_relationships_disposable';
const owned = await mkdtemp(join(tmpdir(), 'zhiban-m6-relationships-')),
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
    environment: 'LOCAL_M6_RELATIONSHIPS_DISPOSABLE',
    approvalRef: 'LOCAL_M6_RELATIONSHIPS_USER_REQUEST',
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
        requestId: 'LOCAL_M6_RELATIONSHIPS_SEED',
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
  const origin = 'https://127.0.0.1:3451';
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
        incoming.headers.host !== '127.0.0.1:3451' ||
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
        '/zhiban/relationships': ['relationships.html', 'text/html'],
        '/zhiban/relationships.js': ['relationships.js', 'text/javascript'],
        '/zhiban/management': ['management.html', 'text/html'],
        '/zhiban/management-catalog.js': ['management-catalog.js', 'text/javascript'],
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
    server!.listen(3451, '127.0.0.1', done);
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
    kind:
      | 'offerings'
      | 'enrollments'
      | 'courses'
      | 'terms'
      | 'classes'
      | 'assignments'
      | 'class-members'
      | 'teachers',
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
    disabled = await makeMember('已禁用学生');
  await members.save(
    tenantScopeContext(t),
    disabled.loaded.value.disable({
      reason: 'LOCAL_MANAGEMENT_TEST',
      expectedAuthorizationVersion: disabled.loaded.value.authorizationVersion,
      now: instant(Date.now()),
    }),
    disabled.loaded.revision,
  );
  const masterCourses = Array.from({ length: 620 }, (_, i) => ({
    id: v7(),
    code: 'CCAT' + i,
    name: '分页课程' + String(i).padStart(4, '0'),
    status: i % 3 === 0 ? 'PUBLISHED' : i % 3 === 1 ? 'DRAFT' : 'ARCHIVED',
  }));
  await admin.query(
    `INSERT INTO zhiban_academic.courses(tenant_id,id,code,name,description,owner_membership_id,status,published_version,revision,created_at,updated_at)
    SELECT $1,r.id,r.code,r.name,'',NULL,r.status,CASE WHEN r.status='DRAFT' THEN 0 ELSE 1 END,1,$3,$3 FROM jsonb_to_recordset($2::jsonb) AS r(id uuid,code text,name text,status text)`,
    [t, JSON.stringify(masterCourses), now],
  );
  await admin.query(
    `INSERT INTO zhiban_academic.course_versions(tenant_id,id,version,name,description,owner_membership_id,published_at) SELECT tenant_id,id,1,name,'',NULL,$2 FROM zhiban_academic.courses WHERE tenant_id=$1 AND code LIKE 'CCAT%' AND status<>'DRAFT'`,
    [t, now],
  );
  const masterTerms = Array.from({ length: 620 }, (_, i) => ({
      id: v7(),
      code: 'TCAT' + i,
      name: '分页学期' + String(i).padStart(4, '0'),
    })),
    masterClasses = Array.from({ length: 620 }, (_, i) => ({
      id: v7(),
      code: 'ACAT' + i,
      name: '分页行政班' + String(i).padStart(4, '0'),
    }));
  await admin.query(
    `INSERT INTO zhiban_academic.terms(tenant_id,id,code,name,starts_on,ends_on,revision) SELECT $1,r.id,r.code,r.name,'2026-10-01','2027-01-01',1 FROM jsonb_to_recordset($2::jsonb) AS r(id uuid,code text,name text)`,
    [t, JSON.stringify(masterTerms)],
  );
  await admin.query(
    `INSERT INTO zhiban_academic.classes(tenant_id,id,code,name,head_teacher_id,revision) SELECT $1,r.id,r.code,r.name,NULL,1 FROM jsonb_to_recordset($2::jsonb) AS r(id uuid,code text,name text)`,
    [t, JSON.stringify(masterClasses)],
  );

  assert.equal((await http(`/api/zhiban/academic/${t}`, manager)).status, 503);
  record('623 offerings, 629 ACTIVE enrollments and >500 profiles; legacy snapshot fails closed');
  const collect = async (
    kind:
      | 'offerings'
      | 'enrollments'
      | 'courses'
      | 'terms'
      | 'classes'
      | 'assignments'
      | 'class-members'
      | 'teachers',
    params: Record<string, string>,
  ) => {
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

  const classTarget = masterClasses[0].id;
  const makeTeacher = async (
    name: string,
    options: { tenant?: typeof t; timing?: 'FUTURE' | 'EXPIRED'; scoped?: boolean } = {},
  ) => {
    const tenant = options.tenant ?? t,
      uid = ids.nextUserId();
    await users.create(User.create(uid, instant(now)));
    const grant = RoleGrant.create({
      id: ids.nextRoleGrantId(),
      roleCode: 'TEACHER',
      scope: options.scoped ? courseScope(courseId(v7())) : tenantScope(),
      createdAt: instant(now),
      validFrom: instant(options.timing === 'FUTURE' ? now + 3600000 : now),
      validUntil: options.timing === 'EXPIRED' ? instant(now + 1) : null,
    });
    const member = Membership.create({
      id: ids.nextMembershipId(),
      userId: uid,
      tenantId: tenant,
      now: instant(now),
    }).activatePending({
      expectedAuthorizationVersion: 0,
      now: instant(now),
      approvedGrants: [grant],
    });
    const loaded = await members.create(tenantScopeContext(tenant), member);
    await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
      tenant,
      member.id,
      name,
    ]);
    return { member: member.id, uid, grant: grant.id, loaded };
  };
  const teachers = [];
  for (let i = 0; i < 620; i++) {
    const a = await makeTeacher('分页教师' + String(i).padStart(4, '0'));
    teachers.push(a);
    await admin.query(
      "INSERT INTO zhiban_academic.assignments(tenant_id,id,offering_id,membership_id,status,valid_from,revision) VALUES($1,$2,$3,$4,'ACTIVE',$5,1)",
      [t, v7(), offering, a.member, now],
    );
    await admin.query(
      'INSERT INTO zhiban_academic.class_members(tenant_id,id,class_id,membership_id,active,revision) VALUES($1,$2,$3,$4,true,1)',
      [t, v7(), classTarget, bulk[i].member],
    );
  }
  const candidateTeacher = await makeTeacher('候选任教教师'),
    revokedTeacher = await makeTeacher('撤权教师'),
    disabledTeacher = await makeTeacher('停用教师'),
    futureTeacher = await makeTeacher('未来教师', { timing: 'FUTURE' }),
    expiredTeacher = await makeTeacher('到期教师', { timing: 'EXPIRED' }),
    scopedTeacher = await makeTeacher('其他范围教师', { scoped: true }),
    foreignTeacher = await makeTeacher('外空间教师', { tenant: otherTenant });
  await members.save(
    tenantScopeContext(t),
    revokedTeacher.loaded.value.revokeGrant({
      expectedAuthorizationVersion: revokedTeacher.loaded.value.authorizationVersion,
      grantId: revokedTeacher.grant,
      now: instant(Date.now()),
    }),
    revokedTeacher.loaded.revision,
  );
  await members.save(
    tenantScopeContext(t),
    disabledTeacher.loaded.value.disable({
      expectedAuthorizationVersion: disabledTeacher.loaded.value.authorizationVersion,
      now: instant(Date.now()),
      reason: 'LOCAL_RELATIONSHIPS_TEST',
    }),
    disabledTeacher.loaded.revision,
  );
  assert.equal((await collect('assignments', { offering, limit: '50' })).size, 621);
  assert.equal((await collect('class-members', { classId: classTarget, limit: '50' })).size, 620);
  const candidates = await collect('teachers', { offering, limit: '50' });
  assert.ok(candidates.has(candidateTeacher.member) && candidates.has(scopedTeacher.member));
  for (const a of [revokedTeacher, disabledTeacher, futureTeacher, expiredTeacher, foreignTeacher])
    assert.ok(!candidates.has(a.member));
  assert.equal(
    (await read('teachers', { classId: classTarget, q: candidateTeacher.member.toUpperCase() }))
      .rows[0].membership_id,
    candidateTeacher.member,
  );
  assert.equal((await read('assignments', { offering, q: '分页教师0619' })).rows.length, 1);
  assert.equal(
    (await read('class-members', { classId: classTarget, q: bulk[619].member })).rows.length,
    1,
  );
  record(
    '621 assignments and 620 administrative-class members traverse completely; bounded teacher search includes current teacher roles but excludes revoked/disabled/future/expired/foreign candidates',
  );
  for (const kind of ['assignments', 'class-members', 'teachers'] as const) {
    const filters: Record<string, string> =
      kind === 'class-members' ? { classId: classTarget } : { offering };
    for (const a of [teacher, student, foreign])
      assert.equal((await http(`${base}/${kind}?` + new URLSearchParams(filters), a)).status, 403);
    assert.equal((await http(`${base}/${kind}?` + new URLSearchParams(filters))).status, 401);
    assert.equal(
      (await http(`${base}/${kind}?` + new URLSearchParams({ ...filters, limit: '500' }), manager))
        .status,
      400,
    );
    assert.equal(
      (
        await http(
          `${base}/${kind}?` + new URLSearchParams({ ...filters, q: 'x' }) + '&q=y',
          manager,
        )
      ).status,
      400,
    );
    const first = await read(kind, { ...filters, limit: '10' });
    assert.equal(
      (
        await http(
          `${base}/${kind}?` +
            new URLSearchParams({ ...filters, limit: '50', cursor: first.nextCursor! }),
          manager,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await http(
          `${base}/${kind}?` +
            new URLSearchParams({ ...filters, limit: '10', cursor: first.nextCursor! }),
          outsider,
        )
      ).status,
      400,
    );
  }
  for (const tail of [
    'teachers',
    'teachers?offering=' + offering + '&classId=' + classTarget,
    'assignments',
    'class-members',
    'teachers?offering=' + v7(),
    'class-members?classId=' + v7(),
  ])
    assert.ok([400, 404].includes((await http(`${base}/${tail}`, manager)).status));
  const foreignRead = await http(
    `/api/zhiban/management/${otherTenant}/class-members?classId=${classTarget}`,
    foreign,
  );
  assert.equal(foreignRead.status, 404);
  assert.equal(
    (
      await tenantPool.query(
        "SELECT has_table_privilege(current_user,'zhiban_identity.users','SELECT') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await businessPool.query(
        "SELECT has_table_privilege(current_user,'zhiban_identity.memberships','SELECT') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  record(
    'new routes reject anonymous/non-admin/cross-tenant, missing/conflicting contexts and stale cursors; restricted roles gain no raw User or cross-schema privileges',
  );
  for (let i = 0; i < 201; i++)
    await admin.query(
      'UPDATE zhiban_academic.people SET display_name=$3 WHERE tenant_id=$1 AND membership_id=$2',
      [t, bulk[i].member, '稀疏候选学生' + i],
    );
  const sparse = await makeTeacher('稀疏候选教师'),
    literalTeacher = await makeTeacher('百分%_教师');
  const sparseFirst = await read('teachers', { offering, q: '稀疏候选', limit: '10' });
  assert.equal(sparseFirst.rows.length, 0);
  assert.ok(sparseFirst.nextCursor);
  assert.equal(
    (
      await read('teachers', {
        offering,
        q: '稀疏候选',
        limit: '10',
        cursor: sparseFirst.nextCursor!,
      })
    ).rows[0].membership_id,
    sparse.member,
  );
  assert.equal(
    (await read('teachers', { offering, q: '百分%_' })).rows[0].membership_id,
    literalTeacher.member,
  );
  const beforeRevoke = await read('teachers', { offering, q: candidateTeacher.member });
  assert.equal(beforeRevoke.rows.length, 1);
  const staleTeacher = await makeTeacher('选择后撤权教师');
  assert.equal((await read('teachers', { offering, q: staleTeacher.member })).rows.length, 1);
  await members.save(
    tenantScopeContext(t),
    staleTeacher.loaded.value.revokeGrant({
      expectedAuthorizationVersion: staleTeacher.loaded.value.authorizationVersion,
      grantId: staleTeacher.grant,
      now: instant(Date.now()),
    }),
    staleTeacher.loaded.revision,
  );
  assert.equal(
    (
      await command({
        type: 'ASSIGN_TEACHER',
        offeringId: offering,
        membershipId: staleTeacher.member,
        revision: null,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await command({
        type: 'ASSIGN_TEACHER',
        offeringId: offering,
        membershipId: disabledTeacher.member,
        revision: null,
      })
    ).status,
    403,
  );
  record(
    'teacher name windows preserve sparse continuation, percent/underscore are literal, and revoke/disable after selection is rechecked by original write transaction',
  );
  const assignmentKey = v7().replaceAll('-', ''),
    assign = {
      type: 'ASSIGN_TEACHER',
      offeringId: offering,
      membershipId: candidateTeacher.member,
      revision: null,
    };
  assert.equal((await command(assign, manager, assignmentKey)).status, 200);
  assert.equal((await command(assign, manager, assignmentKey)).status, 200);
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
          [t, assignmentKey],
        )
      ).rows[0].n,
    ),
    1,
  );
  let assigned = (
    await read('assignments', { offering, member: candidateTeacher.member, state: 'ALL' })
  ).rows[0];
  assert.equal(
    (await command({ type: 'END_TEACHER', id: assigned.id, revision: '999' })).status,
    409,
  );
  assert.equal(
    (await command({ type: 'END_TEACHER', id: assigned.id, revision: assigned.revision })).status,
    200,
  );
  assigned = (
    await read('assignments', { offering, member: candidateTeacher.member, state: 'ALL' })
  ).rows[0];
  assert.equal(assigned.status, 'ENDED');
  assert.equal((await command({ ...assign, revision: assigned.revision })).status, 200);
  const member = (await read('class-members', { classId: classTarget, member: bulk[619].member }))
    .rows[0];
  assert.equal(
    (
      await command({
        type: 'CLASS_MEMBER',
        classId: classTarget,
        membershipId: bulk[619].member,
        active: false,
        revision: '999',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await command({
        type: 'CLASS_MEMBER',
        classId: classTarget,
        membershipId: bulk[619].member,
        active: false,
        revision: member.revision,
      })
    ).status,
    200,
  );
  const inactive = (
    await read('class-members', {
      classId: classTarget,
      member: bulk[619].member,
      state: 'INACTIVE',
    })
  ).rows[0];
  assert.equal(inactive.active, false);
  assert.equal(
    (
      await command({
        type: 'CLASS_MEMBER',
        classId: classTarget,
        membershipId: bulk[619].member,
        active: true,
        revision: inactive.revision,
      })
    ).status,
    200,
  );
  const head = (await read('class-members', { classId: classTarget })).classInfo!;
  assert.equal(
    (
      await command({
        type: 'CLASS_HEAD_TEACHER',
        id: classTarget,
        revision: head.revision,
        membershipId: candidateTeacher.member,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await command({
        type: 'CLASS_HEAD_TEACHER',
        id: classTarget,
        revision: head.revision,
        membershipId: teacher.member,
      })
    ).status,
    409,
  );
  const newHead = (await read('class-members', { classId: classTarget })).classInfo!;
  assert.equal(newHead.head_teacher_id, candidateTeacher.member);
  assert.equal(
    (
      await command({
        type: 'CLASS_HEAD_TEACHER',
        id: classTarget,
        revision: newHead.revision,
        membershipId: null,
      })
    ).status,
    200,
  );
  record(
    'assignment add/end/restore and class member remove/restore use CAS and durable audit beyond snapshot caps; head-teacher set/clear rejects stale class revision',
  );
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext(),
    page = await context.newPage(),
    browserErrors: string[] = [];
  page.on('pageerror', (e) => browserErrors.push(e.message));
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
  await page.goto(origin + `/zhiban/management?tenant=${t}`);
  await expect(page.locator('.management-list article')).toHaveCount(20);
  await page.getByLabel('搜索教学班', { exact: true }).fill('机电一班');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.management-list article')).toHaveCount(1);
  await page.getByRole('link', { name: '管理任教', exact: true }).click();
  await expect(page.getByRole('heading', { name: '任教关系管理', exact: true })).toBeVisible();
  await expect(page.locator('.relationship-list article')).toHaveCount(20);
  await page
    .getByRole('navigation', { name: '关系分页' })
    .getByRole('button', { name: '下一页', exact: true })
    .click();
  await expect(page.getByRole('navigation', { name: '关系分页' })).toContainText('第 2 页');
  await page.getByLabel('搜索任教关系', { exact: true }).fill('分页教师0619');
  await page.getByRole('button', { name: '搜索关系', exact: true }).click();
  await expect(page.locator('.relationship-list article')).toHaveCount(1);
  let lostKey = '';
  await page.route(
    `**/api/zhiban/management/${t}/commands`,
    async (route) => {
      lostKey = route.request().headers()['x-zhiban-command'];
      const r = await http(`${base}/commands`, manager, route.request().postDataJSON(), 'POST', {
        'x-zhiban-command': lostKey,
      });
      assert.equal(r.status, 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '结束任教', exact: true }).click();
  await expect(page.getByRole('button', { name: '按原命令号重试', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '按原命令号重试', exact: true }).click();
  await expect(page.getByText('暂无关系记录。', { exact: true })).toBeVisible();
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
          [t, lostKey],
        )
      ).rows[0].n,
    ),
    1,
  );
  await page.getByLabel('关系状态', { exact: true }).selectOption('ENDED');
  await page.getByRole('button', { name: '搜索关系', exact: true }).click();
  await page.getByRole('button', { name: '重新指定任教', exact: true }).click();
  await expect(page.getByText('暂无关系记录。', { exact: true })).toBeVisible();
  record(
    'browser follows teaching-class entry, pages/searches assignments, ends and restores teaching, and confirms a lost COMMIT response by the same key without duplicate audit',
  );
  await page.getByText('搜索并指定任教教师', { exact: true }).click();
  await page.getByLabel('教师搜索', { exact: true }).fill('分页教师');
  await page.getByRole('button', { name: '搜索教师', exact: true }).click();
  await expect(page.locator('.teacher-results article')).toHaveCount(10);
  await page.getByRole('button', { name: '下一页教师', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '教师搜索分页' })).toContainText('第 2 页');
  await page.getByLabel('教师搜索', { exact: true }).fill('百分%_');
  await page.getByRole('button', { name: '搜索教师', exact: true }).click();
  await expect(page.locator('.teacher-results article')).toHaveCount(1);
  await page.getByRole('button', { name: '指定任教', exact: true }).click();
  await expect(page.locator('.teacher-results article')).toHaveCount(0);
  await expect(page.locator('#relationship-message')).toHaveText('操作已完成。');
  assert.equal(
    (await read('assignments', { offering, member: literalTeacher.member })).rows.length,
    1,
  );
  record(
    'teacher chooser searches literal names, pages within context and assigns using a fresh relationship revision lookup',
  );
  await page.goto(origin + `/zhiban/management?tenant=${t}`);
  await page
    .getByRole('navigation', { name: '教务分类' })
    .getByRole('button', { name: '行政班', exact: true })
    .click();
  await expect(page.locator('.management-list article')).toHaveCount(20);
  await page.getByLabel('搜索行政班', { exact: true }).fill(masterClasses[0].code);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.management-list article')).toHaveCount(1);
  await page.getByRole('link', { name: '管理成员与班主任', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '行政班成员与班主任', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.relationship-list article')).toHaveCount(20);
  await page
    .getByRole('navigation', { name: '关系分页' })
    .getByRole('button', { name: '下一页', exact: true })
    .click();
  await expect(page.getByRole('navigation', { name: '关系分页' })).toContainText('第 2 页');
  await page.getByLabel('搜索班级成员', { exact: true }).fill(bulk[619].member);
  await page.getByRole('button', { name: '搜索关系', exact: true }).click();
  await expect(page.locator('.relationship-list article')).toHaveCount(1);
  await page.getByRole('button', { name: '移出行政班', exact: true }).click();
  await expect(page.getByText('暂无关系记录。', { exact: true })).toBeVisible();
  await page.getByLabel('关系状态', { exact: true }).selectOption('INACTIVE');
  await page.getByRole('button', { name: '搜索关系', exact: true }).click();
  await page.getByRole('button', { name: '恢复班级成员', exact: true }).click();
  await expect(page.getByText('暂无关系记录。', { exact: true })).toBeVisible();
  await page.getByText('从学生目录添加行政班成员', { exact: true }).click();
  await page
    .getByRole('searchbox', { name: '姓名或完整成员 ID', exact: true })
    .fill(candidate.member);
  await page.getByRole('button', { name: '搜索学生', exact: true }).click();
  await expect(page.locator('.directory-table tbody tr')).toHaveCount(1);
  await page.locator('.directory-table input[type=checkbox]').check();
  await page.getByRole('button', { name: '添加已选成员', exact: true }).click();
  await expect(page.locator('.directory-table tbody tr')).toHaveCount(0);
  await expect(page.locator('#relationship-message')).toHaveText('操作已完成。');
  assert.equal(
    (await read('class-members', { classId: classTarget, member: candidate.member })).rows.length,
    1,
  );
  record(
    'browser follows administrative-class entry, pages/searches members, removes/restores membership, and adds from the paged student directory without changing Enrollment',
  );
  await page.getByText('搜索并设置班主任', { exact: true }).click();
  await page.getByLabel('教师搜索', { exact: true }).fill('候选任教教师');
  await page.getByRole('button', { name: '搜索教师', exact: true }).click();
  await expect(page.locator('.teacher-results article')).toHaveCount(1);
  await page.getByRole('button', { name: '设为班主任', exact: true }).click();
  await expect(page.getByText('班主任：候选任教教师', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'docs/v2/evidence/m6-relationships-class-local.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '清除班主任', exact: true }).click();
  await expect(page.getByText('班主任：未指定', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(browserErrors, []);
  await page.screenshot({
    path: 'docs/v2/evidence/m6-relationships-mobile-local.png',
    fullPage: true,
  });
  await page.goto(origin + '/zhiban');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录智伴', exact: true })).toBeVisible();
  assert.equal((await http(`${base}/teachers?offering=${offering}`, manager)).status, 401);
  record(
    'browser sets and clears head teacher, 390px layout has no overflow/script errors, and logout revokes teacher search',
  );

  if (serve) {
    const login = await http('/api/zhiban/identity/login', undefined, {
      userId: manager.uid,
      password: manager.password,
    });
    assert.equal(login.status, 200);
    manager.cookie = login.cookie;
    manager.csrf = (await http('/api/zhiban/identity/csrf', manager)).json.csrfToken;
    const accountsPath = join(owned, 'accounts.json'),
      url = origin + `/zhiban/relationships?tenant=${t}&offering=${offering}`,
      classMembersUrl = origin + `/zhiban/relationships?tenant=${t}&classId=${masterClasses[0].id}`;
    await writeFile(
      accountsPath,
      JSON.stringify(
        {
          scope: 'LOCAL_DISPOSABLE_M6_RELATIONSHIPS',
          relationshipsUrl: url,
          classMembersUrl,
          accounts: [{ label: '教务管理员', userId: manager.uid, password: manager.password }],
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      'docs/v2/evidence/m6-relationships-demo-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'RUNNING_DISPOSABLE',
          pid: process.pid,
          origin,
          relationshipsUrl: url,
          classMembersUrl,
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
    console.log(`LOCAL M6 relationships ready: ${origin}/zhiban; accounts file: ${accountsPath}`);
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
      ? 'docs/v2/evidence/m6-relationships-demo-close-local.json'
      : 'docs/v2/evidence/m6-relationships-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: failure ? 'FAIL' : 'PASS',
        at: new Date().toISOString(),
        node: process.version,
        pg16: pg,
        scope: 'M6_RELATIONSHIPS_TEACHER_SEARCH_DISPOSABLE_PG16_HTTPS_UI',
        checks,
        sourceHashes,
        lifecycle: { root: owned, port, database, stopped: !started, removed: !failure },
        excluded: [
          '55432/55433 clusters',
          'Native/maintenance quarantine',
          'production/CI signoff',
          'raw User status/credentials',
          'legacy snapshot contract and teacher/student workbench pagination',
          'frozen multi-page snapshot',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  if (failure) process.exitCode = 1;
}
