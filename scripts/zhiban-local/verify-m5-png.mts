import { jointClassroomProfile } from './joint-classroom-receipt';
import { teacherRelationshipPublicProfile } from '../../lib/zhiban/infrastructure/teaching/postgres/relationships';
import { verifyUpstreamPackage } from './upstream-source';
/** LOCAL disposable PG16 product journey. Never reads development credentials or touches 55432/55433. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpsRequest } from 'node:https';
import { deflateSync } from 'node:zlib';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const localRequire = createRequire(import.meta.url);
const { build } = createRequire(localRequire.resolve('tsx'))('esbuild');
import { ContentService } from '../../lib/zhiban/infrastructure/content/service';
import { contentHttp } from '../../lib/zhiban/infrastructure/content/http';
import { contentProfile } from './content-profile';
import { provisionNative } from '../../lib/zhiban/infrastructure/openmaic/provision';
import { official } from '../../lib/zhiban/infrastructure/openmaic/catalog';
import { createIdentityComposition } from '../../lib/zhiban/infrastructure/identity/composition/root';
import { createIdentityHttp } from '../../lib/zhiban/infrastructure/identity/http/adapter';
import { IdentitySafeQueries } from '../../lib/zhiban/application/identity/use-cases/safe-queries';
import { catalogConfig } from '../../tests/zhiban/identity/authorization/fixtures';
import {
  purposes,
  admissionPolicyDigest,
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
import { pngCrc } from '../../lib/zhiban/infrastructure/content/png';
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const serve = process.argv.includes('--serve');
let jointFingerprint: string | undefined;
const jointReferenceOnly = process.argv.includes('--joint-classroom-reference-only');
const attemptRuntimeReferenceOnly =
  jointReferenceOnly || process.argv.includes('--attempt-runtime-reference-only');
const interactiveReferenceOnly =
  attemptRuntimeReferenceOnly || process.argv.includes('--interactive-reference-only');
const teacherReferenceOnly =
  interactiveReferenceOnly || process.argv.includes('--teacher-reference-only');
const profileReferenceOnly =
  teacherReferenceOnly || process.argv.includes('--profile-reference-only');
const quizReferenceOnly = profileReferenceOnly || process.argv.includes('--quiz-reference-only');
const root = process.cwd(),
  bin = '/usr/lib/postgresql/16/bin',
  port = 56498,
  database = 'zhiban_m5_png_disposable',
  nativeDatabase = 'zhiban_m5_png_native';
const owned = await mkdtemp(join(tmpdir(), 'zhiban-m5-png-')),
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
const chunk = (type: string, b: Buffer) => {
  const a = Buffer.alloc(b.length + 12);
  a.writeUInt32BE(b.length);
  a.write(type, 4);
  b.copy(a, 8);
  a.writeUInt32BE(pngCrc(a.subarray(4, -4)), a.length - 4);
  return a;
};
const png = (w = 2, h = 2, raw?: Buffer) => {
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(w);
  hdr.writeUInt32BE(h, 4);
  hdr[8] = 8;
  hdr[9] = 6;
  const pixels = raw ?? Buffer.alloc((w * 4 + 1) * h);
  if (!raw && w * h <= 4194304)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const at = y * (w * 4 + 1) + 1 + x * 4;
        pixels[at] = x % 2 ? 255 : 32;
        pixels[at + 1] = y % 2 ? 180 : 110;
        pixels[at + 2] = 210;
        pixels[at + 3] = 255;
      }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', hdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
let started = false,
  server: ReturnType<typeof createServer> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
  failure: unknown,
  pg = 0;
let baselineProfile: any, enabledProfile: any, nativeFingerprint: string | undefined;
let teacherFingerprint: string | null = null;
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
  await master.query(`CREATE DATABASE ${nativeDatabase}`);
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
  for (const ctx of [
    'identity',
    'academic',
    'learning',
    'assessment',
    ...(profileReferenceOnly ? ['profile'] : []),
    ...(teacherReferenceOnly ? ['teaching'] : []),
    ...(jointReferenceOnly ? ['curriculum', 'classroom'] : []),
  ]) {
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
  await admin.query('BEGIN');
  await admin.query('SET LOCAL ROLE zhiban_identity_owner');
  let baseSource = '';
  for (const f of ['01-schema.sql', '02-helpers-and-guards.sql', '03-acl.sql']) {
    const file = resolve('docs/v2/candidates/m5-content', f),
      sql = await readFile(file, 'utf8');
    sourceHashes[file] = hash(sql);
    baseSource += sql;
    await admin.query(sql);
  }
  await admin.query('INSERT INTO zhiban_content.schema_migrations VALUES($1,$2)', [
    '0001',
    hash(baseSource),
  ]);
  await admin.query('COMMIT');
  if (teacherReferenceOnly) teacherFingerprint = await teacherRelationshipPublicProfile(admin);
  baselineProfile = await contentProfile(admin);
  const pngFile = resolve('docs/v2/candidates/m5-png/0002-png.sql'),
    sql = await readFile(pngFile, 'utf8');
  sourceHashes[pngFile] = hash(sql);
  await admin.query('BEGIN');
  await admin.query('SET LOCAL ROLE zhiban_identity_owner');
  await admin.query(sql);
  await admin.query('INSERT INTO zhiban_content.png_schema_migrations VALUES($1,$2)', [
    '0002',
    hash(sql),
  ]);
  await admin.query('COMMIT');
  if (interactiveReferenceOnly) {
    const file = resolve('docs/v2/candidates/p4-interactive/0003-interactive.sql'),
      sql = await readFile(file, 'utf8');
    sourceHashes[file] = hash(sql);
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE zhiban_identity_owner');
    await admin.query(sql);
    await admin.query('INSERT INTO zhiban_content.interactive_schema_migrations VALUES($1,$2)', [
      '0003',
      hash(sql),
    ]);
    await admin.query('COMMIT');
  }
  if (attemptRuntimeReferenceOnly) {
    const file = resolve('docs/v2/candidates/p4-attempt-runtime/0004-attempt-runtime.sql'),
      sql = await readFile(file, 'utf8');
    sourceHashes[file] = hash(sql);
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE zhiban_identity_owner');
    await admin.query(sql);
    await admin.query(
      'INSERT INTO zhiban_content.attempt_runtime_schema_migrations VALUES($1,$2)',
      ['0004', hash(sql)],
    );
    await admin.query('COMMIT');
  }
  if (jointReferenceOnly) {
    const file = resolve('docs/v2/candidates/p4-joint-classroom/0005-joint-classroom.sql'),
      sql = await readFile(file, 'utf8');
    sourceHashes[file] = hash(sql);
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE zhiban_identity_owner');
    await admin.query(sql);
    await admin.query('INSERT INTO zhiban_content.joint_schema_migrations VALUES($1,$2)', [
      '0005',
      hash(sql),
    ]);
    await admin.query('COMMIT');
  }
  if (jointReferenceOnly) jointFingerprint = await jointClassroomProfile(admin);
  enabledProfile = await contentProfile(admin);
  record('PG16 additive migration; unchanged prerequisites/text ledger; exact reference catalog');
  const nativeBootstrap = resolve(
    'lib/zhiban/infrastructure/openmaic/bootstrap-native-roles.pg16.sql',
  );
  sourceHashes[nativeBootstrap] = hash(await readFile(nativeBootstrap));
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
      nativeDatabase,
      '-f',
      nativeBootstrap,
    ],
    { stdio: 'pipe' },
  );
  const nativeReceipt = await provisionNative(
    pool('zhiban_openmaic_migrator', nativeDatabase),
    nativeDatabase,
    'LOCAL_M5_C_DISPOSABLE',
  );
  nativeFingerprint = nativeReceipt.fingerprint;
  if (quizReferenceOnly) {
    record(
      'REFERENCE ONLY: fresh business/PNG catalog plus Native schema provisioned; no product journey claimed',
    );
    return;
  }
  const native = pool('zhiban_openmaic_runtime', nativeDatabase),
    bridge = pool('zhiban_bridge_runtime');
  const deployment = v7(),
    now = Date.now();
  await admin.query(
    'INSERT INTO zhiban_bridge.deployment_registry VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9)',
    [
      deployment,
      'LOCAL_M5_PNG',
      official.sha,
      official.storage,
      official.dsl,
      official.renderer,
      nativeFingerprint,
      'VERIFIED',
      now,
    ],
  );
  const auth = pool('zhiban_auth_runtime'),
    tenantPool = pool('zhiban_runtime'),
    control = pool('zhiban_control_runtime');
  const admission: any = {
    environment: 'LOCAL_M5_C_DISPOSABLE',
    approvalRef: 'LOCAL_M5_C_USER_REQUEST',
    hmacKey: randomBytes(32),
    policyDigests: {},
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
    [t, 'png'],
    [otherTenant, 'other'],
  ])
    await tenants.create(
      Tenant.create(id as ReturnType<IdentityIds['nextTenantId']>, code, code, instant(Date.now())),
    );
  const actors: any[] = [];
  for (const [role, tid] of [
    ['TEACHER', t],
    ['STUDENT', t],
    ['STUDENT', t],
    ['TEACHER', otherTenant],
    ['TENANT_ADMIN', t],
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
        actor: { kind: 'SERVICE', serviceCode: 'local_png_seed' },
        requestId: 'LOCAL_PNG_SEED',
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
    otherOffering = v7();
  await admin.query(
    "INSERT INTO zhiban_academic.courses VALUES($1,$2,'PNG','PNG 教学内容','',NULL,'PUBLISHED',1,1,$3,$3)",
    [t, course, now],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.course_versions VALUES($1,$2,1,'PNG 教学内容','',NULL,$3)",
    [t, course, now],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.terms VALUES($1,$2,'TERM','本地学期','2026-10-01','2027-01-01',1)",
    [t, term],
  );
  for (const o of [offering, otherOffering])
    await admin.query(
      "INSERT INTO zhiban_academic.offerings VALUES($1,$2,$3,1,$4,NULL,$5,'PNG 教学班',20,'OPEN',1)",
      [t, o, course, term, o],
    );
  await admin.query(
    "INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
    [t, v7(), offering, teacher.member, now],
  );
  await admin.query(
    "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
    [t, v7(), offering, student.member, now],
  );
  const tlsKey = join(owned, 'tls.key'),
    tlsCert = join(owned, 'tls.crt');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      tlsKey,
      '-out',
      tlsCert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'pipe' },
  );
  let tls = await readFile(tlsCert),
    key = await readFile(tlsKey),
    ca = tls;
  const origin = 'https://127.0.0.1:3444';
  if (serve) {
    const bound = JSON.parse((await privateFile('receipt.json')).toString());
    tls = await privateFile('localhost.crt');
    key = await privateFile('localhost.key');
    ca = await trustedDevelopmentCa();
    assert.equal(digest(tls.toString()), bound.certificateHash);
  }
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
  const service = new ContentService(
    bridge,
    native,
    composition.security,
    deployment,
    (r: any) => console.log('DIAGNOSTIC', JSON.stringify(r)),
    true,
  );
  const facade = createIdentityHttp(
    async () => ({
      ...composition,
      queries: new IdentitySafeQueries({
        passwordState: (h: any) => composition.security.passwordState(h),
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
  const httpContent = contentHttp(service, composition.security, origin);
  const httpAcademic = createAcademicHttp(
    new AcademicService(
      new PostgresAcademicStore(
        pool('zhiban_academic_runtime'),
        bridge,
        tenantPool,
        composition.security.bridgeSecurity(),
      ),
    ),
    composition.security,
    origin,
  );
  await build({
    entryPoints: ['app/zhiban/local/content-client.tsx'],
    outfile: 'app/zhiban/local/content-client.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const csp = JSON.parse(await readFile('docs/v2/evidence/m5-png-csp-profile.json', 'utf8')).policy;
  server = createServer({ key, cert: tls, maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    const abort = new AbortController();
    outgoing.once('close', () => abort.abort());
    const outgoingDeadline = setTimeout(() => {
      abort.abort();
      outgoing.destroy();
    }, 10000);
    outgoing.once('finish', () => clearTimeout(outgoingDeadline));
    outgoing.once('close', () => clearTimeout(outgoingDeadline));
    try {
      if (
        incoming.headers.host !== '127.0.0.1:3444' ||
        incoming.socket.remoteAddress !== '127.0.0.1'
      ) {
        outgoing.writeHead(403);
        return outgoing.end();
      }
      const url = new URL(incoming.url!, origin);
      const assets: any = {
        '/zhiban': ['index.html', 'text/html'],
        '/zhiban/client.js': ['client.js', 'text/javascript'],
        '/zhiban/academic.js': ['academic.js', 'text/javascript'],
        '/zhiban/style.css': ['style.css', 'text/css'],
        '/zhiban/content': ['content.html', 'text/html'],
        '/zhiban/content-client.js': ['content-client.js', 'text/javascript'],
        '/zhiban/content.css': ['content.css', 'text/css'],
      };
      if (assets[url.pathname]) {
        outgoing.writeHead(200, {
          'Content-Type': assets[url.pathname][1],
          'Content-Security-Policy': csp,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        });
        const asset = await readFile(join(root, 'app/zhiban/local', assets[url.pathname][0]));
        return outgoing.end(
          url.pathname === '/zhiban'
            ? asset
                .toString()
                .replace(/<script src="\/zhiban\/(learning|assessment)\.js" defer><\/script>/g, '')
            : asset,
        );
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(incoming.headers))
        if (v && !['host', 'connection', 'content-length', 'transfer-encoding'].includes(k))
          headers.set(k, Array.isArray(v) ? v.join(',') : v);
      headers.set('x-zhiban-client-ip', '127.0.0.1');
      const parts: Buffer[] = [];
      let size = 0;
      const bodyDeadline = setTimeout(() => incoming.destroy(), 3000);
      try {
        for await (const part of incoming) {
          size += part.length;
          if (size > 4194304) {
            outgoing.writeHead(413);
            incoming.destroy();
            return;
          }
          parts.push(Buffer.from(part));
        }
      } finally {
        clearTimeout(bodyDeadline);
      }
      const forwarded = new Request(url, {
        method: incoming.method,
        headers,
        signal: abort.signal,
        ...(incoming.method === 'POST' ? { body: Buffer.concat(parts) } : {}),
      });
      const r = url.pathname.startsWith('/api/zhiban/content/')
        ? await httpContent(forwarded)
        : url.pathname.startsWith('/api/zhiban/academic/')
          ? await httpAcademic(forwarded)
          : url.pathname.startsWith('/api/zhiban/identity/')
            ? await facade.handle(forwarded)
            : new Response(null, { status: 404 });
      outgoing.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body) {
        const reader = r.body.getReader();
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        outgoing.once('close', cancel);
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            await new Promise<void>((yes, no) =>
              outgoing.write(Buffer.from(part.value), (e) => (e ? no(e) : yes())),
            );
          }
        } finally {
          outgoing.removeListener('close', cancel);
          await reader.cancel().catch(() => {});
        }
      }
      outgoing.end();
    } catch (e) {
      console.log('HOST_ERROR', String(e));
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
  await new Promise<void>((yes, no) => {
    server!.once('error', no);
    server!.listen(3444, '127.0.0.1', yes);
  });
  const http = (path: string, actor?: any, payload?: any, extra: any = {}, method?: string) =>
    new Promise<any>((yes, no) => {
      const post = payload !== undefined;
      const r = httpsRequest(
        origin + path,
        {
          ca,
          method: method ?? (post ? 'POST' : 'GET'),
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(actor ? { cookie: actor.cookie } : {}),
            ...(post
              ? {
                  Origin: origin,
                  'Content-Type': Buffer.isBuffer(payload) ? 'image/png' : 'application/json',
                  'x-zhiban-command': v7().replaceAll('-', ''),
                  ...(actor ? { 'x-zhiban-csrf': actor.csrf } : {}),
                }
              : {}),
            ...extra,
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on('data', (b) => parts.push(b));
          res.on('error', no);
          res.on('end', () => {
            const bytes = Buffer.concat(parts);
            yes({
              status: res.statusCode,
              headers: res.headers,
              bytes,
              json: res.headers['content-type']?.includes('json')
                ? JSON.parse(bytes.toString())
                : null,
              cookie: res.headers['set-cookie']?.[0]?.split(';')[0],
            });
          });
        },
      );
      r.on('error', no);
      r.end(post ? (Buffer.isBuffer(payload) ? payload : JSON.stringify(payload)) : undefined);
    });
  for (const a of actors) {
    const login = await http('/api/zhiban/identity/login', undefined, {
      userId: a.uid,
      password: a.password,
    });
    assert.equal(login.status, 200);
    a.cookie = login.cookie;
    const csrf = await http('/api/zhiban/identity/csrf', a);
    a.csrf = csrf.json.csrfToken;
  }
  record('real Identity login/CSRF and restricted PG roles; HTTPS certificate validation');
  const base = `/api/zhiban/content/${t}/offerings/${offering}`;
  const cmd = async (v: any, a = teacher) => {
    const r = await http(base, a, v);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const created = await cmd({ type: 'CREATE_CONTENT', title: 'PNG 完整闭环' }),
    rid = created.id;
  const list = () => http(base, teacher);
  let row = (await list()).json.resources.find((r: any) => r.id === rid);
  const uploadPath = `${base}/resources/${rid}/assets?revision=${row.revision}`;
  const picture = png();
  const uploaded = await http(uploadPath, teacher, picture);
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.json));
  const aid = uploaded.json.id;
  record('teacher PNG upload and registered resource selector');
  for (const a of [student, outsider, foreign, manager])
    assert.equal((await http(uploadPath, a, picture)).status, 403);
  record('student/admin/unenrolled/foreign upload denied');
  assert.equal(
    (await http(uploadPath, teacher, picture, { 'x-zhiban-csrf': 'x'.repeat(43) })).status,
    403,
  );
  assert.equal(
    (await http(uploadPath, teacher, picture, { 'Content-Type': 'image/svg+xml' })).status,
    415,
  );
  assert.equal((await http(uploadPath, teacher, picture.subarray(0, 24))).status, 400);
  assert.equal((await http(uploadPath, teacher, png(4096, 4096))).status, 400);
  record('CSRF, MIME spoof, truncated PNG and decoded pixel budget denied');
  const sid = row.draft.slides[0].id,
    element = v7();
  const slides = [
    { id: sid, elements: [{ id: element, assetId: aid, x: 30, y: 30, width: 400, height: 250 }] },
  ];
  const draftUrl = (id = aid, rev = '1') =>
    `${base}/resources/${rid}/assets/${id}?source=draft&version=${rev}&slide=${sid}`;
  assert.equal((await http(draftUrl(), teacher)).status, 403);
  record('unreferenced draft upload is not readable');
  await cmd({ type: 'SAVE_CONTENT', id: rid, revision: row.revision, title: row.title, slides });
  row = (await list()).json.resources.find((r: any) => r.id === rid);
  const durl = draftUrl(aid, row.revision);
  assert.equal((await http(durl, teacher)).status, 200);
  assert.equal((await http(durl, student)).status, 403);
  await cmd({ type: 'PUBLISH_CONTENT', id: rid, revision: row.revision });
  row = (await list()).json.resources.find((r: any) => r.id === rid);
  const preview = await http(`${base}/resources/${rid}/preview?source=published`, student);
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  const binding = preview.json.slides[0].elements[0].assetId,
    pid = preview.json.publicationId;
  const url = `${base}/resources/${rid}/assets/${binding}?source=published&version=${pid}&slide=${sid}`;
  const bytes = await http(url, student);
  assert.equal(bytes.status, 200);
  assert.deepEqual(bytes.bytes, picture);
  assert.equal(bytes.headers['cache-control'], 'private, no-store');
  assert.equal(bytes.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(bytes.headers['x-content-type-options'], 'nosniff');
  assert.ok(!JSON.stringify(preview.json).includes('owner_handle'));
  record(
    'image-only immutable publish; real DocumentStore/AssetStore read; closed DTO/private gateway',
  );
  const head = await http(url, student, undefined, {}, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.bytes.length, 0);
  assert.equal(Number(head.headers['content-length']), picture.length);
  const range = await http(url, student, undefined, { Range: 'bytes=0-7' });
  assert.equal(range.status, 206);
  assert.deepEqual(range.bytes, picture.subarray(0, 8));
  assert.equal((await http(url, student, undefined, { Range: 'bytes=0-1,4-5' })).status, 416);
  record('HEAD, single Range, invalid Range and no-store headers');
  for (const a of [outsider, foreign, manager]) assert.equal((await http(url, a)).status, 403);
  assert.equal((await http(url)).status, 401);
  assert.equal((await http(url.replace(offering, otherOffering), student)).status, 403);
  assert.equal((await http(url.replace(binding, v7()), student)).status, 403);
  assert.equal((await http(url.replace(sid, v7()), student)).status, 403);
  record('cross tenant/offering/scene/unregistered asset and unauthenticated access denied');
  const nativeRefs = (
    await admin.query('SELECT asset_ref,principal_handle FROM zhiban_bridge.asset_bindings')
  ).rows;
  for (const a of nativeRefs) {
    assert.ok(!JSON.stringify(preview.json).includes(a.asset_ref));
    assert.equal((await http(`/api/assets/${a.asset_ref}`, student)).status, 404);
  }
  record('native asset refs and byte store are not public routes');
  // Browser test uses only this ephemeral cert SPKI, without globally disabling certificate checks.
  const spki = execFileSync('openssl', ['x509', '-pubkey', '-noout'], { input: tls });
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'DER'], { input: spki });
  const pin = createHash('sha256').update(der).digest('base64');
  browser = await chromium.launch({
    headless: true,
    args: [`--ignore-certificate-errors-spki-list=${pin}`],
  });
  const tc = await browser.newContext(),
    sc = await browser.newContext();
  for (const [ctx, a] of [
    [tc, teacher],
    [sc, student],
  ] as const)
    await ctx.addCookies([
      {
        name: '__Host-zhiban_session',
        value: a.cookie.split('=')[1],
        domain: '127.0.0.1',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
  const tp = await tc.newPage(),
    sp = await sc.newPage();
  const cspErrors: string[] = [];
  tp.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) cspErrors.push(msg.text());
  });
  sp.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) cspErrors.push(msg.text());
  });
  await tp.goto(`${origin}/zhiban/content?tenant=${t}&offering=${offering}`);
  await tp.getByRole('button', { name: '编辑草稿' }).click();
  await expect(tp.getByRole('button', { name: '上传 PNG' })).toBeVisible();
  await expect(tp.getByRole('combobox', { name: '已登记 PNG' })).toContainText('2×2');
  await sp.goto(`${origin}/zhiban/content?tenant=${t}&offering=${offering}`);
  await sp.getByRole('button', { name: '查看已发布' }).click();
  await expect(sp.locator('img[alt="课件 PNG"]')).toBeVisible();
  await sp.waitForFunction(() => {
    const e = document.querySelector('img[alt="课件 PNG"]') as HTMLImageElement;
    return e?.complete && e.naturalWidth === 2;
  });
  assert.equal(await sp.getByRole('button', { name: '上传 PNG' }).count(), 0);
  assert.deepEqual(cspErrors, []);
  await sp.screenshot({
    path: resolve('docs/v2/evidence/m5-c-png-student-openmaic-120-local.png'),
    fullPage: true,
  });
  record(
    'actual HTTPS browser student PNG display, teacher selector, CSP and student read-only UI',
  );
  // Complete a second UI journey: upload, select, add, save, publish, student view.
  await tp
    .getByLabel('PNG 文件')
    .setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png(3, 2) });
  await tp.getByRole('button', { name: '上传 PNG', exact: true }).click();
  await expect(tp.getByRole('alert')).toContainText('PNG 已登记');
  await tp.getByRole('button', { name: '添加 PNG 到本页' }).click();
  await tp.getByRole('button', { name: '添加文本框', exact: true }).click();
  await tp.getByRole('textbox', { name: /正文/ }).fill('PNG 与文本\n保持原来的换行');
  await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(tp.getByText('已保存 ·', { exact: false })).toBeVisible();
  const publishedUI = tp.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && r.request().postDataJSON()?.type === 'PUBLISH_CONTENT',
  );
  await tp.getByRole('button', { name: '发布保存版本' }).click();
  assert.equal((await publishedUI).status(), 200);
  await expect(tp.getByText('已保存 ·', { exact: false })).toBeVisible();
  await sp.getByRole('button', { name: '刷新列表' }).click();
  await sp.getByRole('button', { name: '查看已发布' }).click();
  await expect(sp.locator('img[alt="课件 PNG"]')).toHaveCount(2);
  await sp.waitForFunction(() =>
    Array.from(document.querySelectorAll('img')).some((e) => e.complete && e.naturalWidth === 3),
  );
  await sp.screenshot({
    path: resolve('docs/v2/evidence/m5-c-png-student-openmaic-120-local.png'),
    fullPage: true,
  });
  await expect(sp.getByText('PNG 与文本\n保持原来的换行', { exact: true })).toBeVisible();
  record(
    'browser upload -> selector -> add -> save -> immutable publish -> student display; text whitespace preserved',
  );
  assert.equal((await http(url, student)).status, 403);
  assert.equal((await http(durl, teacher)).status, 403);
  record('replacement rejects old publication and stale draft URLs');
  const current = await http(`${base}/resources/${rid}/preview?source=published`, student),
    currentUrl = `${base}/resources/${rid}/assets/${current.json.slides[0].elements[0].assetId}?source=published&version=${current.json.publicationId}&slide=${sid}`;

  // Larger real PNG: demonstrate authorization is checked between 64 KiB chunks.
  const raw = randomBytes((256 * 4 + 1) * 256);
  for (let y = 0; y < 256; y++) raw[y * (256 * 4 + 1)] = 0;
  const large = png(256, 256, raw),
    largeId = (await cmd({ type: 'CREATE_CONTENT', title: '流式撤权' })).id;
  let lr = (await list()).json.resources.find((r: any) => r.id === largeId);
  const lu = await http(
    `${base}/resources/${largeId}/assets?revision=${lr.revision}`,
    teacher,
    large,
  );
  assert.equal(lu.status, 200);
  const largeSlide = lr.draft.slides[0].id;
  await cmd({
    type: 'SAVE_CONTENT',
    id: largeId,
    revision: lr.revision,
    title: lr.title,
    slides: [
      {
        id: largeSlide,
        elements: [{ id: v7(), assetId: lu.json.id, x: 0, y: 0, width: 256, height: 256 }],
      },
    ],
  });
  lr = (await list()).json.resources.find((r: any) => r.id === largeId);
  await cmd({ type: 'PUBLISH_CONTENT', id: largeId, revision: lr.revision });
  const lp = (await http(`${base}/resources/${largeId}/preview?source=published`, teacher)).json,
    lb = lp.slides[0].elements[0].assetId;
  const largeAsset = (
    actor: any,
    signal: AbortSignal,
    done: () => void,
    publication = lp.publicationId,
  ) =>
    service.assetResponse(
      { handle: actor.handle, tenant: t, member: actor.member, offering },
      largeId,
      lb,
      'published',
      publication,
      largeSlide,
      'GET',
      null,
      signal,
      done,
    );
  teacher.handle = await composition.security.authenticate(teacher.cookie.split('=')[1]);
  student.handle = await composition.security.authenticate(student.cookie.split('=')[1]);
  const canceled = new AbortController();
  let cancelDone = 0;
  const cancelResponse = await largeAsset(teacher, canceled.signal, () => cancelDone++),
    cancelReader = cancelResponse.body!.getReader();
  assert.equal((await cancelReader.read()).value!.length, 65536);
  canceled.abort();
  await assert.rejects(cancelReader.read());
  assert.equal(cancelDone, 1);
  record('client disconnect cancels stream and releases capacity once');
  const sessionLogin = await http('/api/zhiban/identity/login', undefined, {
    userId: teacher.uid,
    password: teacher.password,
  });
  assert.equal(sessionLogin.status, 200);
  const sessionActor = { ...teacher, cookie: sessionLogin.cookie };
  sessionActor.csrf = (await http('/api/zhiban/identity/csrf', sessionActor)).json.csrfToken;
  sessionActor.handle = await composition.security.authenticate(sessionActor.cookie.split('=')[1]);
  let sessionDone = 0;
  const sessionResponse = await largeAsset(
      sessionActor,
      new AbortController().signal,
      () => sessionDone++,
    ),
    sessionReader = sessionResponse.body!.getReader();
  await sessionReader.read();
  assert.equal((await http('/api/zhiban/identity/logout', sessionActor, {})).status, 204);
  await assert.rejects(sessionReader.read());
  assert.equal(sessionDone, 1);
  record('Session logout stops the next byte chunk without revoking another Session');
  let versionDone = 0;
  const staleStream = await largeAsset(teacher, new AbortController().signal, () => versionDone++),
    staleReader = staleStream.body!.getReader();
  await staleReader.read();
  lr = (await list()).json.resources.find((r: any) => r.id === largeId);
  await cmd({ type: 'PUBLISH_CONTENT', id: largeId, revision: lr.revision });
  await assert.rejects(staleReader.read());
  assert.equal(versionDone, 1);
  record('publication replacement stops an already opened old-version stream');
  const lp2 = (await http(`${base}/resources/${largeId}/preview?source=published`, teacher)).json,
    lb2 = lp2.slides[0].elements[0].assetId;
  let revokeDone = 0;
  const stream = await service.assetResponse(
      { handle: student.handle, tenant: t, member: student.member, offering },
      largeId,
      lb2,
      'published',
      lp2.publicationId,
      largeSlide,
      'GET',
      null,
      new AbortController().signal,
      () => revokeDone++,
    ),
    reader = stream.body!.getReader();
  assert.equal((await reader.read()).value!.length, 65536);
  await admin.query(
    "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=$1,revision=revision+1 WHERE tenant_id=$2 AND membership_id=$3",
    [Date.now(), t, student.member],
  );
  await assert.rejects(reader.read());
  assert.equal(revokeDone, 1);
  assert.equal((await http(currentUrl, student)).status, 403);
  record('Enrollment revocation blocks subsequent bytes and the next stream chunk');
  row = (await list()).json.resources.find((r: any) => r.id === rid);
  await cmd({ type: 'WITHDRAW_CONTENT', id: rid, revision: row.revision });
  assert.equal((await http(currentUrl, teacher)).status, 403);
  record('withdrawal denies published bytes; historical Native bytes retained');
  assert.equal(
    Number(
      (await admin.query('SELECT count(*) AS n FROM zhiban_content.png_publication_refs')).rows[0]
        .n,
    ),
    5,
  );
  assert.equal(
    Number((await native.query('SELECT count(*) AS n FROM public.asset_entries')).rows[0].n),
    5,
  );
  record('immutable generation asset provenance and retention');
  for (const deniedSql of [
    'DELETE FROM zhiban_content.png_uploads',
    'TRUNCATE zhiban_content.png_publication_refs',
    'UPDATE zhiban_content.png_uploads SET width=1',
  ])
    await assert.rejects(bridge.query(deniedSql));
  record('PNG runtime ACL denies UPDATE/DELETE/TRUNCATE');

  // Exact foreign upload references and partial Native commit remain fail closed.
  const brokenId = (await cmd({ type: 'CREATE_CONTENT', title: '部分失败候选' })).id;
  let br = (await list()).json.resources.find((r: any) => r.id === brokenId);
  const bs = br.draft.slides[0].id;
  const forged = await http(base, teacher, {
    type: 'SAVE_CONTENT',
    id: brokenId,
    revision: br.revision,
    title: br.title,
    slides: [{ id: bs, elements: [{ id: v7(), assetId: aid, x: 0, y: 0, width: 50, height: 50 }] }],
  });
  assert.equal(forged.status, 403);
  record('same offering foreign-resource upload cannot be attached');
  const bu = await http(
    `${base}/resources/${brokenId}/assets?revision=${br.revision}`,
    teacher,
    picture,
  );
  assert.equal(bu.status, 200);
  await cmd({
    type: 'SAVE_CONTENT',
    id: brokenId,
    revision: br.revision,
    title: br.title,
    slides: [
      { id: bs, elements: [{ id: v7(), assetId: bu.json.id, x: 0, y: 0, width: 50, height: 50 }] },
    ],
  });
  br = (await list()).json.resources.find((r: any) => r.id === brokenId);
  const privateNative = (service as any).pngNative,
    originalPut = privateNative.put.bind(privateNative);
  let dispatches = 0;
  privateNative.put = async (...args: any[]) => {
    dispatches++;
    await originalPut(...args);
    throw Error('LOCAL synthetic lost Native ACK after actual commit');
  };
  const publishKey = v7().replaceAll('-', ''),
    failed = await http(
      base,
      teacher,
      { type: 'PUBLISH_CONTENT', id: brokenId, revision: br.revision },
      { 'x-zhiban-command': publishKey },
    );
  privateNative.put = originalPut;
  assert.equal(failed.status, 409);
  assert.equal(failed.json.error.code, 'OUTCOME_UNKNOWN');
  const replay = await http(
    base,
    teacher,
    { type: 'PUBLISH_CONTENT', id: brokenId, revision: br.revision },
    { 'x-zhiban-command': publishKey },
  );
  assert.equal(replay.status, 409);
  assert.equal(dispatches, 1);
  assert.equal(
    (
      await http(base, teacher, {
        type: 'SAVE_CONTENT',
        id: brokenId,
        revision: br.revision,
        title: 'No unsafe edit',
        slides: br.draft.slides,
      })
    ).status,
    409,
  );
  assert.equal(
    (await http(`${base}/resources/${brokenId}/preview?source=published`, teacher)).status,
    409,
  );
  const uncertain = (
    await admin.query(
      "SELECT state FROM zhiban_content.operations WHERE resource_id=$1 AND action='PUBLISH_CONTENT'",
      [brokenId],
    )
  ).rows[0];
  assert.equal(uncertain.state, 'OUTCOME_UNKNOWN');
  record('lost AssetStore commit ACK quarantines parent and child, no replay/edit/activation');
  const baseGuard = (
    await admin.query(
      "SELECT pg_get_functiondef('zhiban_content.valid_text_draft(jsonb)'::regprocedure) AS body",
    )
  ).rows[0].body;
  assert.ok(
    baseGuard.includes("ARRAY['height', 'id', 'text', 'width', 'x', 'y']") ||
      baseGuard.includes("ARRAY['height','id','text','width','x','y']"),
  );
  // Text regression in the new composition and old closed composition.
  const plain = new ContentService(bridge, native, composition.security, deployment);
  const oldHTTP = contentHttp(plain, composition.security, origin);
  const r = await oldHTTP(
    new Request(origin + base, {
      method: 'POST',
      headers: {
        'x-zhiban-request': 'identity-v1',
        cookie: teacher.cookie,
        Origin: origin,
        'Content-Type': 'application/json',
        'x-zhiban-csrf': teacher.csrf,
        'x-zhiban-command': v7().replaceAll('-', ''),
      },
      body: JSON.stringify({ type: 'CREATE_CONTENT', title: 'Text remains text' }),
    }),
  );
  assert.equal(r.status, 200);
  const textId = ((await r.json()) as any).id;
  let textRow = (await list()).json.resources.find((r: any) => r.id === textId);
  await cmd({
    type: 'SAVE_CONTENT',
    id: textId,
    revision: textRow.revision,
    title: textRow.title,
    slides: [
      {
        id: textRow.draft.slides[0].id,
        elements: [{ id: v7(), text: '原文本闭环仍可用', x: 0, y: 0, width: 400, height: 100 }],
      },
    ],
  });
  textRow = (await list()).json.resources.find((r: any) => r.id === textId);
  await cmd({ type: 'PUBLISH_CONTENT', id: textId, revision: textRow.revision });
  assert.equal(
    (await http(`${base}/resources/${textId}/preview?source=published`, teacher)).json.slides[0]
      .elements[0].text,
    '原文本闭环仍可用',
  );
  record('original text policy retained; PNG not enabled without the PNG composition');
  await browser.close();
  browser = undefined;
  for (const pkg of ['dsl', 'storage', 'renderer', 'editor']) {
    await verifyUpstreamPackage(pkg);
    const walk = async (path: string): Promise<void> => {
      for (const e of await readdir(path, { withFileTypes: true })) {
        const file = join(path, e.name);
        if (e.isDirectory()) await walk(file);
        else sourceHashes[file] = hash(await readFile(file));
      }
    };
    await walk(`packages/@openmaic/${pkg}/src`);
    await walk(`packages/@openmaic/${pkg}/dist`);
    sourceHashes[`packages/@openmaic/${pkg}/package.json`] = hash(
      await readFile(`packages/@openmaic/${pkg}/package.json`),
    );
  }
  sourceHashes['executedVerifierArtifact'] = hash(await readFile(process.argv[1]));
  for (const file of [
    'lib/zhiban/infrastructure/content/model.ts',
    'lib/zhiban/infrastructure/content/native.ts',
    'lib/zhiban/infrastructure/content/png.ts',
    'lib/zhiban/infrastructure/content/service.ts',
    'lib/zhiban/infrastructure/content/http.ts',
    'scripts/zhiban-local/server.ts',
    'app/zhiban/local/content-client.tsx',
    'app/zhiban/local/content-client.js',
    'app/zhiban/local/content.css',
    'scripts/zhiban-local/verify-m5-png.mts',
    'scripts/zhiban-local/run-m5-png.ts',
    'scripts/zhiban-local/png-receipt.ts',
    'scripts/zhiban-local/content-receipt.ts',
    'scripts/zhiban-local/content.ts',
    'scripts/zhiban-local/setup-m5.ts',
    'scripts/zhiban-local/install-m5.ts',
    'docs/v2/evidence/m5-png-csp-profile.json',
    'pnpm-lock.yaml',
  ])
    sourceHashes[file] = hash(await readFile(file));
  if (serve) {
    // This is a new Enrollment, not resurrection of the revoked test Enrollment.
    await admin.query(
      "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
      [t, v7(), offering, outsider.member, Date.now()],
    );
    const readyId = (await cmd({ type: 'CREATE_CONTENT', title: 'PNG 本地体验' })).id;
    let rr = (await list()).json.resources.find((r: any) => r.id === readyId);
    const uploaded = await http(
      `${base}/resources/${readyId}/assets?revision=${rr.revision}`,
      teacher,
      png(3, 2),
    );
    await cmd({
      type: 'SAVE_CONTENT',
      id: readyId,
      revision: rr.revision,
      title: rr.title,
      slides: [
        {
          id: rr.draft.slides[0].id,
          elements: [
            { id: v7(), assetId: uploaded.json.id, x: 30, y: 30, width: 400, height: 250 },
          ],
        },
      ],
    });
    rr = (await list()).json.resources.find((r: any) => r.id === readyId);
    await cmd({ type: 'PUBLISH_CONTENT', id: readyId, revision: rr.revision });
    const accountsPath = join(owned, 'accounts.json');
    await writeFile(
      accountsPath,
      JSON.stringify(
        {
          scope: 'LOCAL_DISPOSABLE_M5_C',
          accounts: [
            { label: '教师', userId: teacher.uid, password: teacher.password },
            { label: '学生', userId: outsider.uid, password: outsider.password },
          ],
          contentUrl: `${origin}/zhiban/content?tenant=${t}&offering=${offering}`,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      'docs/v2/evidence/m5-c-png-demo-openmaic-120-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          status: 'RUNNING_DISPOSABLE',
          pid: process.pid,
          origin,
          contentUrl: `${origin}/zhiban/content?tenant=${t}&offering=${offering}`,
          accountsPath,
          root: owned,
          port,
          database,
          nativeDatabase,
          sourceHashes,
          tlsCertificateSha256: hash(tls),
          doesNotTouch: [
            '55432 test cluster',
            '55433 development cluster',
            'existing maintenance quarantine',
          ],
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`LOCAL M5-C ready: ${origin}/zhiban; accounts file: ${accountsPath}`);
    await new Promise<void>((done) => {
      process.once('SIGINT', () => done());
      process.once('SIGTERM', () => done());
    });
  }
}
try {
  await main();
} catch (e) {
  failure = e;
  console.error(e);
} finally {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((yes) => server!.close(() => yes()));
  }
  await Promise.all(all.map((p) => p.end()));
  if (started) {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
    started = false;
  }
  // Remove only the mkdtemp root after confirmed stop. Failure leaves it for investigation.
  if (!failure) await rm(owned, { recursive: true });
  if (serve) {
    try {
      const file = 'docs/v2/evidence/m5-c-png-demo-openmaic-120-local.json',
        metadata = JSON.parse(await readFile(file, 'utf8'));
      if (metadata.root === owned && metadata.pid === process.pid)
        await writeFile(
          file,
          JSON.stringify(
            {
              ...metadata,
              status: failure ? 'STOPPED_WITH_FAILURE' : 'STOPPED',
              stoppedAt: new Date().toISOString(),
              removed: !failure,
            },
            null,
            2,
          ) + '\n',
        );
    } catch {
      /* No demo metadata was issued before ready. */
    }
  }
  const evidence = {
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    status: failure ? 'FAIL' : 'PASS',
    at: new Date().toISOString(),
    pg16: pg,
    node: process.version,
    scope: quizReferenceOnly
      ? 'LOCAL_PG16_COMBINED_PROFILE_CONSTRUCTION_ONLY'
      : 'M5_C_DISPOSABLE_PG16_REAL_PUBLIC_PROVIDER_HTTPS_UI',
    checks,
    sourceHashes,
    provider: official,
    nativeFingerprint,
    baselineProfile,
    enabledProfile,
    lifecycle: {
      root: owned,
      port,
      database,
      nativeDatabase,
      stopped: !started,
      removed: !failure,
    },
    referenceBuildOnly: quizReferenceOnly,
    excluded: [
      ...(quizReferenceOnly
        ? ['ALL PNG product/browser/failure-cut tests (reference-only build)']
        : []),
      'existing 55433 development installation',
      'terminal reconciliation/maintenance input delivery',
      'Runtime/AI',
      'production/CI signoff',
    ],
  };
  await writeFile(
    jointReferenceOnly
      ? 'docs/v2/evidence/p4-joint-classroom-profile-build-local.json'
      : attemptRuntimeReferenceOnly
        ? 'docs/v2/evidence/p4-attempt-runtime-profile-build-local.json'
        : interactiveReferenceOnly
          ? 'docs/v2/evidence/p4-interactive-profile-build-local.json'
          : teacherReferenceOnly
            ? 'docs/v2/evidence/zhiban-teacher-profile-build-local.json'
            : profileReferenceOnly
              ? 'docs/v2/evidence/zhiban-account-profile-build-local.json'
              : quizReferenceOnly
                ? 'docs/v2/evidence/zhiban-quiz-profile-build-local.json'
                : 'docs/v2/evidence/m5-c-png-openmaic-120-local.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  if (!failure)
    await writeFile(
      jointReferenceOnly
        ? 'docs/v2/evidence/p4-joint-classroom-profile-reference-local.json'
        : attemptRuntimeReferenceOnly
          ? 'docs/v2/evidence/p4-attempt-runtime-profile-reference-local.json'
          : interactiveReferenceOnly
            ? 'docs/v2/evidence/p4-interactive-profile-reference-local.json'
            : teacherReferenceOnly
              ? 'docs/v2/evidence/m5-png-profile-reference-teacher-local.json'
              : profileReferenceOnly
                ? 'docs/v2/evidence/m5-png-profile-reference-account-local.json'
                : quizReferenceOnly
                  ? 'docs/v2/evidence/m5-png-profile-reference-quiz-local.json'
                  : 'docs/v2/evidence/m5-png-profile-reference-openmaic-120.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          teacherRelationshipFingerprint: teacherFingerprint,
          interactiveMigrationSha256:
            sourceHashes[resolve('docs/v2/candidates/p4-interactive/0003-interactive.sql')],
          ...(attemptRuntimeReferenceOnly ? { githubActions: false } : {}),
          attemptRuntimeMigrationSha256:
            sourceHashes[resolve('docs/v2/candidates/p4-attempt-runtime/0004-attempt-runtime.sql')],
          jointMigrationSha256:
            sourceHashes[resolve('docs/v2/candidates/p4-joint-classroom/0005-joint-classroom.sql')],
          jointClassroomFingerprint: jointFingerprint,
          scope: jointReferenceOnly
            ? 'ISOLATED_PG16_JOINT_CLASSROOM_REFERENCE'
            : attemptRuntimeReferenceOnly
              ? 'ISOLATED_PG16_ATTEMPT_RUNTIME_REFERENCE'
              : interactiveReferenceOnly
                ? 'ISOLATED_PG16_INTERACTIVE_REFERENCE'
                : teacherReferenceOnly
                  ? 'ISOLATED_PG16_PNG_TEACHER_REFERENCE'
                  : profileReferenceOnly
                    ? 'ISOLATED_PG16_PNG_ACCOUNT_REFERENCE'
                    : quizReferenceOnly
                      ? 'ISOLATED_PG16_PNG_QUIZ_REFERENCE'
                      : 'ISOLATED_PG16_PNG_REFERENCE',
          provider: official,
          migrationSha256: sourceHashes[resolve('docs/v2/candidates/m5-png/0002-png.sql')],
          candidateMigrationSha256: sourceHashes[
            resolve('docs/v2/candidates/m5-content/01-schema.sql')
          ]
            ? hash(
                (await readFile('docs/v2/candidates/m5-content/01-schema.sql', 'utf8')) +
                  (await readFile(
                    'docs/v2/candidates/m5-content/02-helpers-and-guards.sql',
                    'utf8',
                  )) +
                  (await readFile('docs/v2/candidates/m5-content/03-acl.sql', 'utf8')),
              )
            : null,
          baselineProfile,
          enabledProfile,
          nativeFingerprint,
          sourceHashes,
        },
        null,
        2,
      ) + '\n',
    );
}
if (failure) process.exitCode = 1;
