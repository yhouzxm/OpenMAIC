/** One installation entry: explicit target preparation -> original installer -> signed verification.
 * No startup/HTTP caller imports this privileged module. Existing objects are never reset. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';
import { lstat } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { connection, type ConnectionInput } from './connection';
import { privateJson, privateBytes, check, digest } from './files';
import { installationPlan, installFresh } from './install';
import { verifiedInstallation, installRoles, runtimeRoles, type InstallInput } from './deployment';
import { preparationFiles } from './preparation-sources';
const exec = promisify(execFile),
  maintenanceLock = 76813002;
export interface SetupInput {
  kind: 'ZHIBAN_SETUP_INPUT_V1';
  installationFile: string;
  /** Absent when the target has already been prepared through an approved management path. */
  preparation?: { admin: ConnectionInput; psqlBinary: string; createDatabases: boolean };
}
async function setupInput(path: string) {
  const input = await privateJson<SetupInput>(path);
  check(
    input.kind === 'ZHIBAN_SETUP_INPUT_V1' && isAbsolute(input.installationFile),
    'SETUP_INPUT_REJECTED',
  );
  return input;
}
export async function setupPlan(path: string) {
  const input = await setupInput(path),
    installation = await installationPlan(input.installationFile),
    c = installation.runtime.config,
    p = input.preparation;
  const preparationHashes: Record<string, string> = {};
  if (p) {
    check(
      typeof p.createDatabases === 'boolean' && isAbsolute(p.psqlBinary),
      'SETUP_PREPARATION_REJECTED',
    );
    check(
      p.admin.database === 'postgres' &&
        p.admin.host === c.connections.auth.host &&
        p.admin.port === c.connections.auth.port &&
        p.admin.role === installation.runtime.profile.grantor,
      'SETUP_ADMIN_ENDPOINT_REJECTED',
    );
    check(
      !Object.values(runtimeRoles).includes(p.admin.role as never) &&
        !Object.values(installRoles).includes(p.admin.role as never),
      'SETUP_ADMIN_ROLE_REJECTED',
    );
    await connection(p.admin);
    const version = await exec(p.psqlBinary, ['--version'], { encoding: 'utf8', timeout: 10000 });
    check(/^psql \(PostgreSQL\) 18\./.test(version.stdout), 'SETUP_PSQL18_REQUIRED');
    for (const f of [p.admin.credentialFile, ...(p.admin.caFile ? [p.admin.caFile] : [])])
      preparationHashes[f] = digest(await privateBytes(f));
  }
  const facts = {
    kind: 'ZHIBAN_SETUP_PLAN_V1',
    inputHash: digest(await privateBytes(path)),
    installationPlanSha256: installation.plan.planSha256,
    instanceId: c.instanceId,
    origin: c.origin,
    databases: c.databases,
    profilePin: c.profilePin,
    preparation: p
      ? {
          maintenanceDatabase: p.admin.database,
          grantor: p.admin.role,
          databaseOwner: installation.runtime.profile.databaseOwner,
          createDatabases: p.createDatabases,
          psqlBinary: p.psqlBinary,
          privateInputHashes: preparationHashes,
        }
      : null,
    steps: p
      ? [
          'CHECK_DEDICATED_TARGET',
          'PREPARE_DATABASES_AND_ROLES',
          'APPLY_ALL_SCHEMAS',
          'INITIALIZE_FIRST_ADMINISTRATOR',
          'VERIFY_SIGNED_INSTALLATION',
        ]
      : [
          'CHECK_PREPROVISIONED_TARGET',
          'APPLY_ALL_SCHEMAS',
          'INITIALIZE_FIRST_ADMINISTRATOR',
          'VERIFY_SIGNED_INSTALLATION',
        ],
    dropsOrResetsExistingData: false,
  };
  return { input, installation, plan: { ...facts, planSha256: digest(JSON.stringify(facts)) } };
}
async function prepare(planned: Awaited<ReturnType<typeof setupPlan>>) {
  const p = planned.input.preparation!,
    c = planned.installation.runtime.config,
    source = planned.installation.runtime.profile;
  const options = await connection(p.admin),
    admin = new Pool({ ...options, max: 1 });
  let lock: PoolClient | undefined;
  try {
    lock = await admin.connect();
    check(
      (await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [maintenanceLock])).rows[0].ok,
      'SETUP_PREPARATION_BUSY',
    );
    const who = (
      await lock.query(
        "SELECT session_user,current_user,current_setting('server_version_num')::int AS version,r.rolsuper FROM pg_roles r WHERE rolname=session_user",
      )
    ).rows[0];
    check(
      who.session_user === source.grantor &&
        who.current_user === source.grantor &&
        who.version >= 180000 &&
        who.version < 190000,
      'SETUP_ADMIN_IDENTITY_REJECTED',
    );
    // A managed non-superuser must use an independently approved pre-provisioning
    // path: CREATE ROLE otherwise adds forbidden ADMIN edges in PG18.
    check(who.rolsuper === true, 'SETUP_ADMIN_CANNOT_PREPARE_FROZEN_ROLE_GRAPH');
    check(
      !(await lock.query("SELECT 1 FROM pg_roles WHERE rolname LIKE 'zhiban_%' LIMIT 1")).rowCount,
      'SETUP_EXISTING_APPLICATION_ROLES_USE_PREPROVISIONED_MODE',
    );
    check(
      /^[a-z][a-z0-9_]{0,50}$/.test(source.databaseOwner) &&
        !source.databaseOwner.startsWith('zhiban_'),
      'SETUP_DATABASE_OWNER_REJECTED',
    );
    check(
      (await lock.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [source.databaseOwner]))
        .rowCount === 1,
      'SETUP_DATABASE_OWNER_MISSING',
    );
    const databases = Object.entries(c.databases) as Array<[keyof typeof c.databases, string]>;
    const missing: string[] = [];
    // Check ALL targets before the first write; never edit an existing table or role.
    for (const [, database] of databases) {
      const found = (
        await lock.query(
          'SELECT pg_get_userbyid(datdba) AS owner,datistemplate,datallowconn FROM pg_database WHERE datname=$1',
          [database],
        )
      ).rows[0];
      if (!found) {
        check(p.createDatabases, 'SETUP_DATABASE_MISSING');
        missing.push(database);
        continue;
      }
      check(
        found.owner === source.databaseOwner && !found.datistemplate && found.datallowconn,
        'SETUP_EXISTING_DATABASE_REJECTED',
      );
      const q = new Pool({ ...options, database, max: 1 });
      try {
        const row = (
          await q.query(
            "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname NOT IN('public','information_schema')) OR EXISTS(SELECT 1 FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public') OR EXISTS(SELECT 1 FROM pg_proc r JOIN pg_namespace n ON n.oid=r.pronamespace WHERE n.nspname='public') OR EXISTS(SELECT 1 FROM pg_type r JOIN pg_namespace n ON n.oid=r.typnamespace WHERE n.nspname='public') AS nonempty",
          )
        ).rows[0];
        check(row.nonempty === false, 'SETUP_NONEMPTY_DATABASE_REJECTED');
      } finally {
        await q.end();
      }
    }
    for (const database of missing)
      await lock.query(`CREATE DATABASE "${database}" OWNER "${source.databaseOwner}"`);
    for (const [key, database] of databases)
      for (const file of preparationFiles[key]) {
        // Frozen psql-only sources are executed as files, never rewritten into node-pg SQL.
        try {
          await exec(
            p.psqlBinary,
            [
              '-X',
              '--no-password',
              '--host',
              p.admin.host,
              '--port',
              String(p.admin.port),
              '--username',
              p.admin.role,
              '--dbname',
              database,
              '--set',
              'ON_ERROR_STOP=1',
              '--file',
              file,
            ],
            {
              encoding: 'utf8',
              timeout: 30000,
              maxBuffer: 1024 * 1024,
              env: {
                NODE_ENV: process.env.NODE_ENV,
                PATH: process.env.PATH,
                LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
                PGSSLMODE: p.admin.transport === 'plain' ? 'disable' : 'verify-full',
                ...(p.admin.caFile ? { PGSSLROOTCERT: p.admin.caFile } : {}),
                PGPASSWORD: String(options.password),
                PGCONNECT_TIMEOUT: '5',
                PGOPTIONS: '-c statement_timeout=15000 -c search_path=pg_catalog',
              },
            },
          );
        } catch {
          throw Error('SETUP_ROLE_PREPARATION_FAILED');
        }
      }
    // Only new application roles were admitted above. Do not rotate credentials of
    // another installation; passwords travel solely in private config and SQL transport.
    for (const item of [
      ...Object.values(c.connections),
      ...Object.values(planned.installation.input.migrations),
    ]) {
      const target = await connection(item);
      check(
        typeof target.password === 'string' && target.password.length > 0,
        'SETUP_ROLE_PASSWORD_REQUIRED',
      );
      await lock.query(`ALTER ROLE "${item.role}" PASSWORD ${lock.escapeLiteral(target.password)}`);
    }
  } finally {
    lock?.release(true);
    await admin.end();
  }
}
export async function setup(path: string, reviewedPin: string) {
  const input = await setupInput(path),
    installationInput = await privateJson<InstallInput>(input.installationFile),
    runtime = await privateJson<{ stateDirectory: string }>(installationInput.runtimeFile);
  let existing = false;
  try {
    await lstat(runtime.stateDirectory);
    existing = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (existing) {
    const x = await verifiedInstallation(installationInput.runtimeFile);
    try {
      return {
        status: 'ALREADY_INSTALLED',
        instanceId: x.config.instanceId,
        origin: x.config.origin,
        databaseAction: 'VERIFIED_NO_DDL',
        firstAdministrator: x.receipt.firstAdministrator,
      };
    } finally {
      await Promise.all(Object.values(x.pools).map((p) => p.end()));
    }
  }
  const x = await setupPlan(path);
  check(x.plan.planSha256 === reviewedPin, 'SETUP_REVIEWED_PLAN_PIN_REQUIRED');
  const callback = x.input.preparation
    ? {
        planSha256: reviewedPin,
        run: async () => {
          await prepare(x);
          check((await setupPlan(path)).plan.planSha256 === reviewedPin, 'SETUP_INPUTS_CHANGED');
        },
      }
    : undefined;
  const result = await installFresh(
    x.input.installationFile,
    x.installation.plan.planSha256,
    callback,
  );
  const verified = await verifiedInstallation(x.installation.input.runtimeFile);
  await Promise.all(Object.values(verified.pools).map((p) => p.end()));
  return {
    ...result,
    databaseAction: 'INITIALIZED',
    origin: x.installation.runtime.config.origin,
    next: 'START_WITH_RUNTIME_INPUT',
  };
}
