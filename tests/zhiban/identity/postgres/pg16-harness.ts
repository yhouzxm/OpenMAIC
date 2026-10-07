import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client, Pool, type QueryResultRow } from 'pg';
import {
  applyMigrations,
  loadMigrationFiles,
} from '@/lib/zhiban/infrastructure/identity/postgres/migrate';

const adminUrl = process.env.ZB_PG16_ADMIN_URL;
export const configured = Boolean(adminUrl);
if (process.env.ZB_PG16_REQUIRED === '1' && !configured) {
  throw new Error('ZB_PG16_ADMIN_URL is required for the PostgreSQL 16 security job.');
}

const databaseName = 'zhiban_pg16_test';
const roleNames = [
  'zhiban_bridge_runtime',
  'zhiban_runtime',
  'zhiban_auth_runtime',
  'zhiban_control_runtime',
  'zhiban_migrator',
  'zhiban_identity_owner',
  'zhiban_pg16_intermediate',
] as const;
const runtimeNames = [
  'zhiban_runtime',
  'zhiban_auth_runtime',
  'zhiban_control_runtime',
  'zhiban_bridge_runtime',
] as const;
type RuntimeName = (typeof runtimeNames)[number];
export type IdentityTestRole = RuntimeName | 'zhiban_migrator';

function testUrl(): URL {
  const adminUrl = process.env.ZB_PG16_ADMIN_URL;
  if (!adminUrl) throw new Error('ZB_PG16_ADMIN_URL is not configured.');
  const url = new URL(adminUrl);
  const local = process.env.ZB_PG16_EXECUTION_MODE === 'LOCAL';
  const ci =
    process.env.ZB_PG16_EXECUTION_MODE === undefined ||
    process.env.ZB_PG16_EXECUTION_MODE === 'GITHUB_ACTIONS';
  if (
    !(local
      ? process.env.GITHUB_ACTIONS === undefined &&
        process.env.GITHUB_SHA === undefined &&
        url.port === '55432' &&
        process.version.startsWith('v22.') &&
        process.platform === 'linux' &&
        process.arch === 'x64'
      : ci && process.env.GITHUB_ACTIONS === 'true') ||
    process.env.ZB_PG16_DISPOSABLE !== '1' ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== `/${databaseName}` ||
    url.username !== 'postgres' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Refusing PostgreSQL tests outside the declared disposable environment.');
  }
  return url;
}

export function adminClient(): Client {
  return new Client({ connectionString: testUrl().toString() });
}

export function runtimeClient(role: IdentityTestRole): Client {
  const url = testUrl();
  url.username = role;
  url.password = rolePassword();
  return new Client({ connectionString: url.toString() });
}

export function runtimePool(role: RuntimeName): Pool {
  const url = testUrl();
  url.username = role;
  url.password = rolePassword();
  return new Pool({ connectionString: url.toString(), max: 1 });
}

function rolePassword(): string {
  const password = process.env.ZB_PG16_ROLE_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('Dedicated test-role password is required.');
  return password;
}

export async function verifyPg16(): Promise<string> {
  const client = adminClient();
  await client.connect();
  try {
    const result = await client.query<{
      version: string;
      server_version: string;
      database_name: string;
      session_user: string;
    }>(
      "SELECT version(), current_setting('server_version') AS server_version, " +
        'current_database() AS database_name, session_user',
    );
    const row = result.rows[0];
    if (
      !row ||
      !/^16(?:\.|$)/.test(row.server_version) ||
      !row.version.includes('PostgreSQL 16') ||
      row.database_name !== databaseName ||
      row.session_user !== 'postgres'
    ) {
      throw new Error('WRONG_POSTGRES_VERSION or non-disposable administrator connection.');
    }
    if (process.env.ZB_PG16_EXECUTION_MODE === 'LOCAL') {
      const identity = await client.query<{ port: string; directory: string }>(
        "SELECT current_setting('port') AS port, current_setting('data_directory') AS directory",
      );
      const databases = await client.query<{ datname: string }>('SELECT datname FROM pg_database');
      const roles = await client.query<{ rolname: string }>(
        "SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_'",
      );
      const schemas = await client.query<{ nspname: string }>(
        "SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_'",
      );
      if (
        identity.rows[0]?.port !== '55432' ||
        identity.rows[0]?.directory !== '/var/lib/postgresql/16/zhiban_test' ||
        databases.rows.some(
          (r) => !['postgres', 'template0', 'template1', databaseName].includes(r.datname),
        ) ||
        roles.rows.some(
          (r) => !['postgres', ...roleNames].includes(r.rolname as (typeof roleNames)[number]),
        ) ||
        schemas.rows.some(
          (r) =>
            ![
              'public',
              'information_schema',
              'zhiban_identity',
              'zhiban_bridge',
              'zhiban_runtime_contract_test',
            ].includes(r.nspname),
        )
      ) {
        throw new Error('LOCAL cluster isolation rejected; no reset is allowed.');
      }
      const publicObjects = await client.query<{ count: string }>(
        "SELECT count(*) FROM (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace UNION ALL SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace) objects",
      );
      if (publicObjects.rows[0]?.count !== '0') throw new Error('LOCAL public objects rejected.');
    }
    return row.server_version;
  } finally {
    await client.end();
  }
}

/** verifyPg16 guards every reset; all names and the dedicated cluster are test fixtures. */
export async function resetDisposableIdentity(): Promise<void> {
  await verifyPg16();
  const client = adminClient();
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS zhiban_identity CASCADE');
    const found = await client.query<{ rolname: string }>(
      'SELECT rolname FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])',
      [roleNames],
    );
    const existing = new Set(found.rows.map((row) => row.rolname));
    for (const role of roleNames) {
      if (!existing.has(role)) continue;
      await client.query(`DROP OWNED BY ${role} CASCADE`);
    }
    for (const role of roleNames) {
      if (!existing.has(role)) continue;
      await client.query(`DROP ROLE ${role}`);
    }
  } finally {
    await client.end();
  }
}

export function runBootstrap(): { success: boolean; output: string } {
  const url = testUrl();
  const sqlPath = fileURLToPath(
    new URL(
      '../../../../lib/zhiban/infrastructure/identity/postgres/bootstrap-roles.pg16.sql',
      import.meta.url,
    ),
  );
  const bridgePath = fileURLToPath(
    new URL(
      '../../../../lib/zhiban/infrastructure/identity/postgres/bootstrap-bridge-roles.pg16.sql',
      import.meta.url,
    ),
  );
  // libpq service settings override environment defaults; hostaddr also bypasses host.
  // Preserve pgpass authentication, but bind bootstrap to the validated URL only.
  const environment = { ...process.env };
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR']) delete environment[key];
  const result = spawnSync(
    'psql',
    [
      '-X',
      '--host',
      url.hostname,
      '--port',
      url.port || '5432',
      '--dbname',
      databaseName,
      '--username',
      url.username,
      '-f',
      sqlPath,
      '-f',
      bridgePath,
    ],
    {
      env: {
        ...environment,
        PGHOST: url.hostname,
        PGPORT: url.port || '5432',
        PGDATABASE: databaseName,
        PGUSER: url.username,
        PGPASSWORD: decodeURIComponent(url.password),
        PGOPTIONS: '-c client_min_messages=warning',
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  if (result.error) throw new Error(`psql bootstrap could not run: ${result.error.message}`);
  return { success: result.status === 0, output: (result.stderr || '').slice(0, 2000) };
}

export async function provisionRolePasswords(): Promise<void> {
  const client = adminClient();
  await client.connect();
  try {
    const literal = `'${rolePassword().replaceAll("'", "''")}'`;
    for (const role of ['zhiban_migrator', ...runtimeNames]) {
      await client.query(`ALTER ROLE ${role} PASSWORD ${literal}`);
    }
  } finally {
    await client.end();
  }
}

export async function applyRealMigrations(): Promise<readonly string[]> {
  const client = runtimeClient('zhiban_migrator');
  await client.connect();
  try {
    return await applyMigrations(
      {
        query: async (sql, parameters) => {
          const result = await client.query<QueryResultRow>(sql, parameters ? [...parameters] : []);
          return { rows: result.rows };
        },
      },
      await loadMigrationFiles(),
    );
  } finally {
    await client.end();
  }
}

export async function prepareSchema(): Promise<void> {
  await resetDisposableIdentity();
  const bootstrap = runBootstrap();
  if (!bootstrap.success) throw new Error(`Identity bootstrap failed: ${bootstrap.output}`);
  await provisionRolePasswords();
  const completed = await applyRealMigrations();
  if (completed.join(',') !== '0001,0002,0003,0004,0005,0006,0007,0008,0009,0010,0011,0012,0013') {
    throw new Error('Identity migrations did not apply from an empty database.');
  }
}

export async function expectDenied(
  client: Client,
  sql: string,
  parameters?: unknown[],
): Promise<void> {
  await client.query('BEGIN');
  try {
    let denied = false;
    try {
      await client.query(sql, parameters);
    } catch (error) {
      denied = true;
      if (!error || typeof error !== 'object' || !('code' in error)) throw error;
      const code = String(error.code);
      if (!['42501', '23514', '23503'].includes(code)) {
        throw new Error(`Unexpected PostgreSQL rejection code: ${code}`);
      }
    }
    if (!denied) throw new Error('Restricted operation unexpectedly succeeded.');
  } finally {
    await client.query('ROLLBACK');
  }
}

export const ids = {
  tenantA: '00000000-0000-7000-8000-000000000001',
  tenantB: '00000000-0000-7000-8000-000000000002',
  tenantUnknown: '00000000-0000-7000-8000-000000000003',
  userA: '00000000-0000-7000-8000-000000000011',
  userB: '00000000-0000-7000-8000-000000000012',
  membershipA: '00000000-0000-7000-8000-000000000021',
  membershipB: '00000000-0000-7000-8000-000000000022',
  grantA: '00000000-0000-7000-8000-000000000031',
  grantB: '00000000-0000-7000-8000-000000000032',
  weak: '00000000-0000-7000-8000-000000000099',
} as const;

export async function insertBaseFixtures(): Promise<void> {
  const client = adminClient();
  await client.connect();
  try {
    for (const [id, code] of [
      [ids.tenantA, 'tenant-a'],
      [ids.tenantB, 'tenant-b'],
    ]) {
      await client.query(
        "INSERT INTO zhiban_identity.tenants (tenant_id, code, display_name, status, created_at, updated_at) VALUES ($1, $2, $2, 'ACTIVE', 1000, 1000)",
        [id, code],
      );
    }
    for (const id of [ids.userA, ids.userB]) {
      await client.query(
        "INSERT INTO zhiban_identity.users (user_id, status, created_at, updated_at) VALUES ($1, 'ACTIVE', 1000, 1000)",
        [id],
      );
    }
    for (const [membership, tenant, user] of [
      [ids.membershipA, ids.tenantA, ids.userA],
      [ids.membershipB, ids.tenantB, ids.userB],
    ]) {
      await client.query(
        "INSERT INTO zhiban_identity.memberships (membership_id, tenant_id, user_id, status, created_at, updated_at) VALUES ($1, $2, $3, 'ACTIVE', 1000, 1000)",
        [membership, tenant, user],
      );
    }
    for (const [grant, tenant, membership] of [
      [ids.grantA, ids.tenantA, ids.membershipA],
      [ids.grantB, ids.tenantB, ids.membershipB],
    ]) {
      await client.query(
        "INSERT INTO zhiban_identity.role_grants (grant_id, tenant_id, membership_id, grant_ordinal, role_code, scope_kind, created_at, valid_from) VALUES ($1, $2, $3, 0, 'STUDENT', 'SELF', 1000, 1000)",
        [grant, tenant, membership],
      );
    }
  } finally {
    await client.end();
  }
}
