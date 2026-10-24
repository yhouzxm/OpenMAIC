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
  port = 56504,
  database = 'zhiban_m6_directory_disposable';
const owned = await mkdtemp(join(tmpdir(), 'zhiban-m6-directory-')),
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
    environment: 'LOCAL_M6_DIRECTORY_DISPOSABLE',
    approvalRef: 'LOCAL_M6_DIRECTORY_USER_REQUEST',
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
        requestId: 'LOCAL_M6_DIRECTORY_SEED',
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
  const origin = 'https://127.0.0.1:3448';
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
        incoming.headers.host !== '127.0.0.1:3448' ||
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
      const r = url.pathname.startsWith('/api/zhiban/directory/')
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
    server!.listen(3448, '127.0.0.1', done);
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
  type Page = Awaited<ReturnType<DirectoryService['read']>>;
  const base = `/api/zhiban/directory/${t}`;
  const read = async (
    params: Record<string, string> = {},
    a = manager,
    tenant = t,
  ): Promise<Page> => {
    const r = await http(`/api/zhiban/directory/${tenant}?` + new URLSearchParams(params), a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as unknown as Page;
  };
  const makeMember = async (
    name: string | null,
    tenant = t,
    role: 'STUDENT' | 'TEACHER' = 'STUDENT',
    timing: 'NORMAL' | 'EXPIRED' | 'FUTURE' = 'NORMAL',
  ) => {
    const uid = ids.nextUserId();
    await users.create(User.create(uid, instant(now)));
    const grant = RoleGrant.create({
      id: ids.nextRoleGrantId(),
      roleCode: role,
      scope: role === 'STUDENT' ? selfScope() : tenantScope(),
      createdAt: instant(now),
      validFrom: instant(timing === 'FUTURE' ? now + 3600000 : now),
      validUntil: timing === 'EXPIRED' ? instant(now + 10) : null,
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
    if (name !== null)
      await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
        tenant,
        member.id,
        name,
      ]);
    return { member: member.id, grant: grant.id, loaded };
  };
  const ordinary = [];
  for (let i = 0; i < 620; i++)
    ordinary.push(await makeMember('目录学生' + String(i).padStart(4, '0')));
  for (let i = 0; i < 201; i++) await makeMember('稀疏匹配教师' + i, t, 'TEACHER');
  const sparse = await makeMember('稀疏匹配学生'),
    unnamed = await makeMember(null),
    literal = await makeMember('百分%_同学'),
    history = await makeMember('多授权历史学生');
  const current = instant(Date.now()),
    replacement = RoleGrant.create({
      id: ids.nextRoleGrantId(),
      roleCode: 'STUDENT',
      scope: selfScope(),
      createdAt: current,
      validFrom: current,
      validUntil: null,
    });
  await members.save(
    tenantScopeContext(t),
    history.loaded.value.replaceGrants({
      expectedAuthorizationVersion: history.loaded.value.authorizationVersion,
      now: current,
      approvedGrants: [replacement],
    }),
    history.loaded.revision,
  );
  const disabled = await makeMember('停用目录学生');
  await members.save(
    tenantScopeContext(t),
    disabled.loaded.value.disable({
      expectedAuthorizationVersion: disabled.loaded.value.authorizationVersion,
      now: instant(Date.now()),
      reason: 'LOCAL_DIRECTORY_TEST',
    }),
    disabled.loaded.revision,
  );
  const revoked = await makeMember('撤权目录学生');
  await members.save(
    tenantScopeContext(t),
    revoked.loaded.value.revokeGrant({
      expectedAuthorizationVersion: revoked.loaded.value.authorizationVersion,
      now: instant(Date.now()),
      grantId: revoked.grant,
    }),
    revoked.loaded.revision,
  );
  const expired = await makeMember('过期目录学生', t, 'STUDENT', 'EXPIRED'),
    future = await makeMember('未来目录学生', t, 'STUDENT', 'FUTURE'),
    foreignStudent = await makeMember('外租户学生', otherTenant);
  const expected = new Set([
    student.member,
    ...extraStudents.map((a) => a.member),
    ...ordinary.map((a) => a.member),
    sparse.member,
    unnamed.member,
    literal.member,
    history.member,
  ]);
  const all: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await read({ limit: '50', ...(cursor ? { cursor } : {}) });
    assert.ok(page.students.length <= 50);
    all.push(...page.students.map((s) => s.membershipId));
    cursor = page.nextCursor;
    pages++;
    assert.ok(pages < 30);
  } while (cursor);
  assert.deepEqual(all, [...expected].sort());
  assert.equal(new Set(all).size, expected.size);
  assert.ok(all.length > 500);
  record(
    'real PG16 directory traverses more than 500 students via bounded keyset pages, sorted and without omissions or duplicates',
  );
  const named: string[] = [];
  cursor = null;
  do {
    const page = await read({ q: '目录学生', limit: '50', ...(cursor ? { cursor } : {}) });
    named.push(...page.students.map((s) => s.membershipId));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(
    named,
    ordinary.map((s) => s.member),
  );
  record(
    'literal name search traverses 620 matching profiles without loading the legacy full snapshot',
  );
  const sparseFirst = await read({ q: '稀疏匹配', limit: '20' });
  assert.equal(sparseFirst.students.length, 0);
  assert.ok(sparseFirst.nextCursor);
  const sparseNext = await read({ q: '稀疏匹配', limit: '20', cursor: sparseFirst.nextCursor! });
  assert.deepEqual(
    sparseNext.students.map((s) => s.membershipId),
    [sparse.member],
  );
  assert.equal(sparseNext.nextCursor, null);
  record(
    'bounded name candidate scan exposes continuation even when a sparse first page contains no eligible student',
  );
  assert.deepEqual(
    (await read({ q: '%_' })).students.map((s) => s.membershipId),
    [literal.member],
  );
  assert.equal((await read({ q: "' OR 1=1 --" })).students.length, 0);
  const noName = await read({ q: unnamed.member.toUpperCase() });
  assert.equal(noName.students[0].name, null);
  assert.equal(noName.students[0].membershipId, unnamed.member);
  assert.equal((await read({ q: teacher.member, state: 'ALL' })).students.length, 0);
  record(
    'percent/underscore and SQL-like text stay literal; full ID lookup includes unnamed students but excludes teachers',
  );
  const historyPage = await read({ q: '多授权历史学生', state: 'ALL' });
  assert.equal(historyPage.students.length, 1);
  assert.equal(historyPage.students[0].studentGrantActive, true);
  for (const m of [disabled, revoked, expired, future]) {
    assert.equal((await read({ q: m.member })).students.length, 0);
    const page = await read({ q: m.member, state: 'ALL' });
    assert.equal(page.students.length, 1);
    assert.equal(page.students[0].studentGrantActive, m === disabled);
  }
  assert.equal(
    (await read({ q: disabled.member, state: 'ALL' })).students[0].membershipStatus,
    'DISABLED',
  );
  record(
    'current vs historical filters respect membership state and revoked/expired/future student grants; multi-grant history yields one row',
  );
  assert.equal((await read({ q: foreignStudent.member, state: 'ALL' })).students.length, 0);
  const other = await read({}, foreign, otherTenant);
  assert.deepEqual(
    other.students.map((s) => s.membershipId),
    [foreignStudent.member],
  );
  for (const a of [teacher, student]) assert.equal((await http(base, a)).status, 403);
  assert.equal((await http(base)).status, 401);
  assert.equal((await http(base, foreign)).status, 403);
  assert.equal((await http(`/api/zhiban/directory/${otherTenant}`, manager)).status, 403);
  record(
    'administrator directory is tenant-local; teacher/student/anonymous and cross-tenant access denied',
  );
  const first = await read({ limit: '10' });
  assert.ok(first.nextCursor);
  for (const query of [
    'limit=100',
    'limit=2e1',
    'q=a&q=b',
    'state=ACTIVE',
    'offset=10',
    'cursor=bad',
    new URLSearchParams({ limit: '20', cursor: first.nextCursor! }).toString(),
    new URLSearchParams({ limit: '10', q: 'changed', cursor: first.nextCursor! }).toString(),
  ])
    assert.equal((await http(base + '?' + query, manager)).status, 400);
  assert.equal(
    (
      await http(
        base + '?' + new URLSearchParams({ limit: '10', cursor: first.nextCursor! }),
        outsider,
      )
    ).status,
    400,
  );
  assert.equal((await http(base, manager, {}, 'POST')).status, 405);
  record(
    'unknown/duplicate fields, invalid page limits and mismatched/malformed continuation positions rejected; API remains read-only',
  );
  const legacy = await http(`/api/zhiban/academic/${t}`, manager);
  assert.equal(legacy.status, 503);
  const rosterBase = `/api/zhiban/roster/${t}/offerings/${otherOffering}`,
    csv = 'membershipId\n' + ordinary[0].member + '\n';
  const preview = await http(rosterBase, manager, { type: 'PREVIEW', csv });
  assert.equal(preview.status, 200);
  const previewDto = preview.json as unknown as Awaited<ReturnType<RosterService['preview']>>;
  assert.equal(previewDto.canCommit, true);
  const imported = await http(rosterBase, manager, { type: 'COMMIT', token: previewDto.token });
  assert.equal(imported.status, 200);
  assert.equal((imported.json as unknown as { complete: boolean }).complete, true);
  const roleSafety = (
    await businessPool.query(
      "SELECT has_table_privilege(current_user,'zhiban_identity.users','SELECT') AS users",
    )
  ).rows[0];
  assert.equal(roleSafety.users, false);
  assert.equal(
    (
      await tenantPool.query(
        "SELECT has_table_privilege(current_user,'zhiban_identity.users','SELECT') AS users",
      )
    ).rows[0].users,
    false,
  );
  record(
    'directory and roster import succeed with legacy snapshot over limit; neither restricted role gains raw User SELECT',
  );
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
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/zhiban');
  await page.locator('.space-card').first().click();
  await page
    .getByRole('link', { name: '学生目录', exact: true })
    .waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('link', { name: '学生目录', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  const firstId = await page.locator('tbody tr').first().locator('td').nth(1).innerText();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第 2 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.getByText('第 1 页', { exact: true })).toBeVisible();
  assert.equal(await page.locator('tbody tr').first().locator('td').nth(1).innerText(), firstId);
  await page
    .getByRole('searchbox', { name: '姓名或完整成员 ID', exact: true })
    .fill('目录学生0619');
  await page.getByRole('button', { name: '搜索学生', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('目录学生0619');
  await page
    .getByRole('searchbox', { name: '姓名或完整成员 ID', exact: true })
    .fill('没有这个学生');
  await page.getByRole('button', { name: '搜索学生', exact: true }).click();
  await expect(page.getByText('未找到符合条件的学生。', { exact: true })).toBeVisible();
  record(
    'trusted browser exposes independent admin entry after legacy overflow; prev/next, search reset and empty state work',
  );
  await page.goto(origin + `/zhiban/roster?tenant=${t}&offering=${otherOffering}`);
  await page.getByText('从已有学生生成 CSV', { exact: true }).click();
  await expect(page.locator('.directory-table tbody tr')).toHaveCount(20);
  const boxes = page.locator('.directory-table input[type="checkbox"]');
  await boxes.first().check();
  const selectedFirst = await boxes.first().getAttribute('value');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第 2 页', { exact: true })).toBeVisible();
  await page.locator('.directory-table input[type="checkbox"]').first().check();
  await expect(page.getByText('已选 2 / 50 名学生（跨页保留）', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.locator('.directory-table input[type="checkbox"]').first()).toBeChecked();
  await page.getByRole('button', { name: '填入所选学生', exact: true }).click();
  assert.ok(
    (await page.getByLabel('CSV 名册', { exact: true }).inputValue()).includes(selectedFirst!),
  );
  await page.getByRole('button', { name: '预览并校验', exact: true }).click();
  await page.getByRole('button', { name: '确认导入 2 名学生', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'docs/v2/evidence/m6-student-directory-roster-local.png',
    fullPage: true,
  });
  record(
    'paged roster picker preserves cross-page selection, generates CSV and completes real Enrollment beyond 500 profiles',
  );
  await page.goto(origin + `/zhiban/roster?tenant=${t}&offering=${otherOffering}`);
  await page.getByText('从已有学生生成 CSV', { exact: true }).click();
  await expect(page.locator('.directory-table tbody tr')).toHaveCount(20);
  for (let n = 0; n < 2; n++) {
    for (const box of await page.locator('.directory-table input[type="checkbox"]').all())
      await box.check();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.getByText('第 ' + (n + 2) + ' 页', { exact: true })).toBeVisible();
  }
  const third = await page.locator('.directory-table input[type="checkbox"]').all();
  for (let i = 0; i < 10; i++) await third[i].check();
  await third[10].click();
  await expect(page.getByText('已选 50 / 50 名学生（跨页保留）', { exact: true })).toBeVisible();
  await expect(third[10]).not.toBeChecked();
  await expect(page.getByRole('alert')).toContainText('最多选择 50');
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(page.getByText('已选 0 / 50 名学生（跨页保留）', { exact: true })).toBeVisible();
  record('cross-page selection stops at 50 and clear selection removes all remembered IDs');
  await page.goto(origin + `/zhiban/directory?tenant=${t}`);
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await page.screenshot({
    path: 'docs/v2/evidence/m6-student-directory-local.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
  record('directory is readable at 390px and browser has no script errors');
  const guardHandle = await composition.security.authenticate(
    outsider.cookie!.split('=').slice(1).join('='),
  );
  assert.ok(guardHandle);
  let entered!: () => void, release!: () => void;
  const entry = new Promise<void>((done) => {
      entered = done;
    }),
    hold = new Promise<void>((done) => {
      release = done;
    });
  const reader = store.run(
    { handle: guardHandle, tenantId: t, actorMembershipId: outsider.member },
    null,
    async (actor, tx) => {
      await tx.directory!.read(actor, { q: '', state: 'CURRENT', limit: 10, after: null });
      entered();
      await hold;
    },
  );
  await entry;
  let revokedActor = false;
  const revokeActor = admin.query(
    'UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1',
    [outsider.grant, Date.now()],
  );
  void revokeActor.then(() => {
    revokedActor = true;
  });
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(revokedActor, false);
  release();
  await reader;
  await revokeActor;
  assert.equal((await http(base, outsider)).status, 403);
  record(
    'administrator revocation waits for current directory reader and denies the next page request',
  );
  const logout = await http('/api/zhiban/identity/logout', manager, {});
  assert.ok([200, 204].includes(logout.status));
  await page.getByRole('button', { name: '搜索学生', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('登录已失效');
  assert.equal(await page.locator('tbody tr').count(), 0);
  assert.equal((await http(base, manager)).status, 401);
  record('logout denies directory and browser clears displayed student data');
  await browser.close();
  browser = undefined;
  if (serve) {
    const login = await http('/api/zhiban/identity/login', undefined, {
      userId: manager.uid,
      password: manager.password,
    });
    assert.equal(login.status, 200);
    manager.cookie = login.cookie;
    manager.csrf = (await http('/api/zhiban/identity/csrf', manager)).json.csrfToken;
    const accountsPath = join(owned, 'accounts.json'),
      url = origin + `/zhiban/directory?tenant=${t}`,
      rosterUrl = origin + `/zhiban/roster?tenant=${t}&offering=${otherOffering}`;
    await writeFile(
      accountsPath,
      JSON.stringify(
        {
          scope: 'LOCAL_DISPOSABLE_M6_DIRECTORY',
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
      'docs/v2/evidence/m6-student-directory-demo-local.json',
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
      ? 'docs/v2/evidence/m6-student-directory-demo-close-local.json'
      : 'docs/v2/evidence/m6-student-directory-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: failure ? 'FAIL' : 'PASS',
        at: new Date().toISOString(),
        node: process.version,
        pg16: pg,
        scope: 'M6_STUDENT_DIRECTORY_PAGED_ROSTER_DISPOSABLE_PG16_HTTPS_UI',
        checks,
        sourceHashes,
        lifecycle: { root: owned, port, database, stopped: !started, removed: !failure },
        excluded: [
          '55432/55433 clusters',
          'Native/maintenance quarantine',
          'production/CI signoff',
          'raw User status/credentials',
          'complete legacy academic pagination',
          'frozen multi-page snapshot',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  if (failure) process.exitCode = 1;
}
