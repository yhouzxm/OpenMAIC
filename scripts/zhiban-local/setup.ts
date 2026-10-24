import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  purposes,
  admissionPolicyDigest,
  type AdmissionPolicyRecord,
} from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { Role, User, Tenant, Membership, instant, permission } from '@/lib/zhiban/domain/identity';
import { identityPermissions } from '@/lib/zhiban/domain/identity/policies/authorization';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresTenantRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/tenant';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '@/lib/zhiban/infrastructure/identity/credentials/password-screening';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import {
  applyMigrations,
  loadMigrationFiles,
} from '@/lib/zhiban/infrastructure/identity/postgres/migrate';
import { directory, database, pgPort, pgBin, origin, digest, type StoredRuntime } from './config';

const run = (exe: string, args: string[]) => execFileSync(exe, args, { stdio: 'pipe' });
const privateWrite = (name: string, data: string) =>
  writeFile(join(directory, name), data, { mode: 0o600, flag: 'wx' });
async function main() {
  // Exclusive creation prevents destructive reseeding or adopting another cluster.
  await mkdir(join(directory, '..'), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, 'socket'), { mode: 0o700 });
  const data = join(directory, 'pgdata');
  run(join(pgBin, 'initdb'), [
    '-D',
    data,
    '-U',
    'postgres',
    '--auth-local=trust',
    '--auth-host=scram-sha-256',
    '--encoding=UTF8',
    '--locale=C.UTF-8',
  ]);
  await writeFile(
    join(data, 'postgresql.auto.conf'),
    `port=${pgPort}\nlisten_addresses='127.0.0.1'\nunix_socket_directories='${join(directory, 'socket')}'\n`,
    { mode: 0o600 },
  );
  run(join(pgBin, 'pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-w', 'start']);
  const maintenance = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database: 'postgres',
    user: 'postgres',
    max: 1,
  });
  await maintenance.query(`CREATE DATABASE ${database}`);
  await maintenance.end();
  const admin = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 1,
  });
  const roles = [
    'zhiban_migrator',
    'zhiban_runtime',
    'zhiban_auth_runtime',
    'zhiban_control_runtime',
  ];
  const passwords = Object.fromEntries(
    roles.map((role) => [role, randomBytes(32).toString('base64url')]),
  );
  const url = (role: string) =>
    `postgresql://${role}:${passwords[role]}@127.0.0.1:${pgPort}/${database}`;
  const pools: Pool[] = [];
  try {
    for (const file of ['bootstrap-roles.pg16.sql', 'bootstrap-bridge-roles.pg16.sql']) {
      run(join(pgBin, 'psql'), [
        '-X',
        '-h',
        join(directory, 'socket'),
        '-p',
        String(pgPort),
        '-U',
        'postgres',
        '-d',
        database,
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        resolve('lib/zhiban/infrastructure/identity/postgres', file),
      ]);
    }
    // Generated alphabet cannot contain SQL delimiters. No secret enters argv or logs.
    for (const role of roles) await admin.query(`ALTER ROLE ${role} PASSWORD '${passwords[role]}'`);
    const migrator = new Pool({ connectionString: url('zhiban_migrator'), max: 1 });
    const connection = await migrator.connect();
    const migrations = await loadMigrationFiles();
    try {
      await applyMigrations(
        {
          query: async (sql, parameters) => ({
            rows: (await connection.query(sql, parameters ? [...parameters] : undefined)).rows,
          }),
        },
        migrations,
      );
    } finally {
      connection.release();
      await migrator.end();
    }

    const ids = new IdentityIds();
    const now = instant(Date.now());
    const environment = 'LOCAL_SYNTHETIC_M1';
    const approvalRef = 'LOCAL_M1_USER_REQUEST';
    const policyDigests = {} as Record<(typeof purposes)[number], string>;
    for (const purpose of purposes) {
      const initial = purpose === 'INITIAL_PROVISION';
      const policy: AdmissionPolicyRecord = {
        purpose,
        approval_ref: approvalRef,
        environment_ref: environment,
        created_at: String(now),
        window_ms: '60000',
        global_limit: '100',
        ip_limit: initial ? null : '30',
        locator_limit: initial ? null : '15',
        pair_limit: initial ? null : '15',
        user_limit: purpose === 'LOGIN' ? null : '15',
        max_buckets: '1000',
      };
      policyDigests[purpose] = admissionPolicyDigest(policy);
      await admin.query(
        `INSERT INTO zhiban_identity.admission_policies(purpose,policy_digest,approval_ref,environment_ref,created_at,window_ms,global_limit,ip_limit,locator_limit,pair_limit,user_limit,max_buckets) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [purpose, policyDigests[purpose], ...Object.values(policy).slice(1)],
      );
      await admin.query('INSERT INTO zhiban_identity.admission_gate(purpose) VALUES($1)', [
        purpose,
      ]);
    }
    const codes = ['STUDENT', 'TEACHER', 'TENANT_ADMIN'] as const;
    const roleIds = {
      STUDENT: ids.nextRoleId(),
      TEACHER: ids.nextRoleId(),
      TENANT_ADMIN: ids.nextRoleId(),
    };
    const catalogRoles = codes.map((code) =>
      Role.create(roleIds[code], code, identityPermissions[code].map(permission)),
    );
    const catalog = {
      roleIds,
      approvalRecord: approvalRef,
      expectedDigest: digest(
        JSON.stringify({
          version: 'identity-v1',
          actionVersion: 'identity-v1',
          delegationVersion: 'identity-v1',
          approvalRecord: approvalRef,
          roles: catalogRoles.map((role) => ({
            id: role.id,
            code: role.code,
            permissions: role.permissions,
          })),
        }),
      ),
    };
    // A deliberately small LOCAL corpus, never claimed as production screening acceptance.
    const corpus = ['passwordpassword', '123456789012345', 'qwertyqwertyqwerty'];
    const control = new Pool({ connectionString: url('zhiban_control_runtime'), max: 1 });
    const tenant = new Pool({ connectionString: url('zhiban_runtime'), max: 1 });
    const auth = new Pool({ connectionString: url('zhiban_auth_runtime'), max: 1 });
    pools.push(control, tenant, auth);
    const users = new PostgresIdentityRepository(control);
    const tenants = new PostgresTenantRepository(control);
    const memberships = new PostgresMembershipRepository(tenant);
    const credentials = new PostgresCredentialRepository(auth);
    const hasher = new Argon2PasswordHasher(new LocalCompromisedPasswordScreening(corpus));
    const accounts: { label: string; userId: string; password: string }[] = [];
    for (const label of ['本地体验账号', '无空间账号']) {
      const id = ids.nextUserId();
      await users.create(User.create(id, instant(Date.now())));
      const password = randomBytes(24).toString('base64url');
      await credentials.createPassword(
        id,
        ids.nextCredentialId(),
        await hasher.hash(password),
        instant(Date.now()),
        {
          actor: { kind: 'SERVICE', serviceCode: 'local_m1_seed' },
          requestId: 'LOCAL_M1_SEED',
          reason: 'SYSTEM_MAINTENANCE',
        },
      );
      accounts.push({ label, userId: id, password });
    }
    const spaces = [];
    for (const [code, name] of [
      ['local-learning', '本地学习空间'],
      ['local-workshop', '本地共创空间'],
    ]) {
      const id = ids.nextTenantId();
      await tenants.create(Tenant.create(id, code, name, instant(Date.now())));
      const member = Membership.create({
        id: ids.nextMembershipId(),
        userId: accounts[0].userId as ReturnType<IdentityIds['nextUserId']>,
        tenantId: id,
        now: instant(Date.now()),
      }).activatePending({
        expectedAuthorizationVersion: 0,
        now: instant(Date.now()),
        approvedGrants: [],
      });
      await memberships.create(tenantScopeContext(id), member);
      spaces.push({ tenantId: id, name });
    }
    const runtimeSecrets = {
      auth: 'LOCAL_M1_AUTH',
      tenant: 'LOCAL_M1_TENANT',
      control: 'LOCAL_M1_CONTROL',
    };
    const runtime: StoredRuntime = {
      mode: 'LOCAL_SYNTHETIC_M1',
      manifest: {
        approvalRef,
        networkApprovalRef: 'LOCAL_M1_LOOPBACK_TLS',
        migrationPreflightRef: 'LOCAL_M1_PG16_HASHES',
        operationalAcceptanceRef: 'LOCAL_M1_DEVELOPMENT_ONLY',
        backendPrivate: true,
        fixedOverwritingProxy: true,
        endpoint: { hostname: '127.0.0.1', port: pgPort, database },
        runtimeSecrets,
        poolMax: 3,
        connectionTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        policy: { origin, concurrentRequests: 8, bodyTimeoutMs: 3000, retryAfterSeconds: 1 },
      },
      composition: {
        origin,
        sessionPolicy: { absoluteMs: 8 * 3600000, idleMs: 30 * 60000 },
        catalog,
        admission: {
          environment,
          approvalRef,
          hmacKey: randomBytes(32).toString('hex'),
          policyDigests,
        },
        corpus: {
          approvalRef: 'LOCAL_M1_MINIMAL_CORPUS',
          expectedDigest: digest(JSON.stringify(corpus)),
          values: corpus,
        },
        operator: null,
        membership: null,
        transportApprovalRef: 'LOCAL_M1_DIRECT_TLS',
        deployment: 'SINGLE_PROCESS_HTTPS',
      },
      secrets: {
        LOCAL_M1_AUTH: url('zhiban_auth_runtime'),
        LOCAL_M1_TENANT: url('zhiban_runtime'),
        LOCAL_M1_CONTROL: url('zhiban_control_runtime'),
      },
    };
    const raw = JSON.stringify(runtime, null, 2) + '\n';
    await privateWrite('runtime.json', raw);
    await privateWrite(
      'accounts.json',
      JSON.stringify({ mode: environment, accounts, spaces }, null, 2) + '\n',
    );
    run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'localhost.key'),
      '-out',
      join(directory, 'localhost.crt'),
      '-days',
      '30',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ]);
    await chmod(join(directory, 'localhost.key'), 0o600);
    await chmod(join(directory, 'localhost.crt'), 0o600);
    const sha = run('git', ['rev-parse', 'HEAD']).toString().trim();
    await privateWrite(
      'receipt.json',
      JSON.stringify(
        {
          mode: environment,
          sourceSha: sha,
          runtimeHash: digest(raw),
          certificateHash: digest((await readFile(join(directory, 'localhost.crt'))).toString()),
          migrations: migrations.map(({ version, checksum }) => ({ version, checksum })),
          boundary:
            'LOCAL development only; no FIRST/admin/recovery/Bridge/AI enablement; no CI signoff',
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`LOCAL M1 initialized. Accounts: ${join(directory, 'accounts.json')}`);
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
    await admin.end();
  }
}
void main().catch((error) => {
  console.error(
    `Local M1 setup stopped: ${error instanceof Error ? error.message : 'unknown failure'}`,
  );
  process.exitCode = 1;
});
