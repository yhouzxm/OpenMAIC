/** Owned source constructor only. Never accepts an external DSN or existing data directory. */
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { installFreshBusinessSchema } from '@/lib/zhiban/infrastructure/production/business-schema';
import { installAuthoringSchema } from '@/lib/zhiban/infrastructure/production/authoring-schema';
import { provisionNative } from '@/lib/zhiban/infrastructure/openmaic/provision';
import { official } from '@/lib/zhiban/infrastructure/openmaic/catalog';
import { teacherRelationshipPublicProfile } from '@/lib/zhiban/infrastructure/teaching/postgres/relationships';
import {
  databaseProfile,
  businessLedger,
  type SourceProfile,
} from '@/lib/zhiban/infrastructure/production/profile';
import { digest, check, saveJson } from '@/lib/zhiban/infrastructure/production/files';
export const sourceDatabases = {
  business: 'zhiban_source_business',
  content: 'zhiban_source_content',
  authoring: 'zhiban_source_authoring',
};
import { preparationFiles } from '@/lib/zhiban/infrastructure/production/preparation-sources';
export async function ownedCluster(
  work: (x: {
    root: string;
    socket: string;
    bin: string;
    pool: (role: string, db: string) => Pool;
    psql: (db: string, file: string) => void;
    master: Pool;
  }) => Promise<void>,
  policy = { owner: 'postgres', grantor: 'postgres' },
  tls?: { certificate: string; key: string },
) {
  for (const name of Object.values(policy))
    check(
      /^[a-z][a-z0-9_]{0,50}$/.test(name) && !name.startsWith('zhiban_'),
      'Explicit non-application owner/grantor names required',
    );
  const bin = process.env.ZHIBAN_PG18_BIN || '/usr/lib/postgresql/18/bin';
  check(
    /^postgres \(PostgreSQL\) 18\./.test(
      execFileSync(join(bin, 'postgres'), ['--version'], { encoding: 'utf8' }),
    ),
    'PG18 binary required',
  );
  const root = await mkdtemp(join(tmpdir(), 'zhiban-production-source-')),
    socket = join(root, 'socket'),
    data = join(root, 'data');
  const pools: Pool[] = [];
  let started = false;
  const run = (n: string, a: string[]) => execFileSync(join(bin, n), a, { stdio: 'pipe' });
  const pool = (user: string, database: string) => {
    const p = new Pool({
      host: socket,
      port: 56553,
      user,
      database,
      max: 2,
      connectionTimeoutMillis: 3000,
      statement_timeout: 30000,
      options: '-c search_path=public,pg_catalog',
    });
    pools.push(p);
    return p;
  };
  try {
    await mkdir(socket, { mode: 0o700 });
    run('initdb', [
      '-D',
      data,
      '-U',
      policy.grantor,
      '--auth-local=trust',
      '--auth-host=reject',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      join(root, 'pg.log'),
      '-o',
      `-p 56553 -k ${socket} -c listen_addresses=${tls ? '127.0.0.1' : "''"}${tls ? ` -c ssl=on -c ssl_cert_file=${tls.certificate} -c ssl_key_file=${tls.key}` : ''}`,
      '-w',
      'start',
    ]);
    started = true;
    const master = pool(policy.grantor, 'postgres');
    if (policy.owner !== policy.grantor) await master.query(`CREATE ROLE ${policy.owner} LOGIN`);
    await work({
      root,
      socket,
      bin,
      pool,
      master,
      psql: (db, file) =>
        run('psql', [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          socket,
          '-p',
          '56553',
          '-U',
          policy.grantor,
          '-d',
          db,
          '-f',
          file,
        ]),
    });
  } finally {
    for (const p of pools) await p.end();
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    await rm(root, { recursive: true, force: true });
  }
}
export async function prepareOwned(
  x: Parameters<Parameters<typeof ownedCluster>[0]>[0],
  dbs = sourceDatabases,
  owner = 'postgres',
) {
  for (const [key, db] of Object.entries(dbs)) {
    check(/^zhiban_[a-z0-9_]{1,50}$/.test(db), 'Dedicated database name required');
    await x.master.query(`CREATE DATABASE ${db} OWNER ${owner}`);
    for (const f of preparationFiles[key as keyof typeof preparationFiles]) x.psql(db, f);
  }
  if (
    !(await x.master.query("SELECT 1 FROM pg_roles WHERE rolname='zhiban_academic_runtime'"))
      .rowCount
  )
    await x.master.query(
      'CREATE ROLE zhiban_academic_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    );
}
export async function installSourceSchemas(
  pool: (role: string, db: string) => Pool,
  dbs = sourceDatabases,
) {
  await installFreshBusinessSchema(pool('zhiban_migrator', dbs.business));
  const native = await provisionNative(
    pool('zhiban_openmaic_migrator', dbs.content),
    dbs.content,
    'APPROVED_FRESH_SOURCE_CONSTRUCTION',
  );
  const c = await pool('zhiban_authoring_migrator', dbs.authoring).connect();
  try {
    await c.query('SET ROLE zhiban_authoring_owner');
    await c.query('SET search_path=public,pg_catalog');
    return { native, authoring: await installAuthoringSchema(c) };
  } finally {
    c.release(true);
  }
}
export async function collectSourceHashes() {
  const hashes: Record<string, string> = {};
  async function walk(path: string) {
    for (const e of await readdir(path, { withFileTypes: true })) {
      const p = join(path, e.name);
      check(!e.isSymbolicLink(), 'Source link rejected: ' + p);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== '.next') await walk(p);
      } else if (e.isFile()) hashes[p] = digest(await readFile(p));
    }
  }
  for (const p of ['lib', 'app/zhiban/local', 'public', 'scripts/zhiban-deploy', 'skills'])
    await walk(p);
  for (const pkg of [
    'dsl',
    'geometry',
    'storage',
    'renderer',
    'editor',
    'generation',
    'importer',
  ]) {
    await walk(`packages/@openmaic/${pkg}/src`);
    await walk(`packages/@openmaic/${pkg}/dist`);
    hashes[`packages/@openmaic/${pkg}/package.json`] = digest(
      await readFile(`packages/@openmaic/${pkg}/package.json`),
    );
  }
  for (const p of [
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'docs/v2/evidence/m5-png-csp-profile.json',
    ...Object.values(preparationFiles).flat(),
  ])
    hashes[p] = digest(await readFile(p));
  for (const folder of ['docs/v2/candidates/m5-content', 'docs/v2/candidates/pg18-provider-v1']) {
    for (const f of await readdir(folder))
      if (f.endsWith('.sql')) hashes[join(folder, f)] = digest(await readFile(join(folder, f)));
  }
  let artifactBytes: Buffer | undefined;
  try {
    artifactBytes = await readFile('.zhiban-host/artifact.json');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (artifactBytes) {
    const artifact = JSON.parse(artifactBytes.toString());
    for (const [p, h] of Object.entries(artifact.inputs))
      check(digest(await readFile(p)) === h, 'Prebuilt host source drift: ' + p);
    check(digest(await readFile('.zhiban-host/host.mjs')) === artifact.output, 'Host build drift');
    check(
      digest(await readFile('.zhiban-host/ops.mjs')) === artifact.operations,
      'Operations build drift',
    );
    for (const p of ['.zhiban-host/artifact.json', '.zhiban-host/host.mjs', '.zhiban-host/ops.mjs'])
      hashes[p] = digest(await readFile(p));
  }
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
}
export async function buildProductionSourceProfile(
  output: string,
  owner = 'postgres',
  grantor = 'postgres',
) {
  let profile: SourceProfile | undefined;
  await ownedCluster(
    async (x) => {
      await prepareOwned(x, sourceDatabases, owner);
      const p = {
        business: x.pool('zhiban_migrator', sourceDatabases.business),
        content: x.pool('zhiban_openmaic_migrator', sourceDatabases.content),
        authoring: x.pool('zhiban_authoring_migrator', sourceDatabases.authoring),
      };
      const empty = {} as SourceProfile['empty'];
      for (const key of ['business', 'content', 'authoring'] as const)
        empty[key] = await databaseProfile(p[key]);
      const { authoring } = await installSourceSchemas(x.pool);
      const installed = {} as SourceProfile['installed'];
      for (const key of ['business', 'content', 'authoring'] as const)
        installed[key] = await databaseProfile(p[key]);
      const c = await x.pool('zhiban_runtime', sourceDatabases.business).connect();
      let teacherFingerprint: string;
      try {
        teacherFingerprint = await teacherRelationshipPublicProfile(c);
      } finally {
        c.release(true);
      }
      profile = {
        kind: 'ZHIBAN_FRESH_SOURCE_PROFILE_V1',
        major: 18,
        provider: official,
        databaseOwner: owner,
        grantor,
        empty,
        installed,
        authoring,
        teacherFingerprint,
        businessLedger: await businessLedger(
          x.pool('zhiban_control_runtime', sourceDatabases.business),
        ),
        sourceHashes: await collectSourceHashes(),
      };
    },
    { owner, grantor },
  );
  await saveJson(output, profile, true);
  const bytes = await readFile(output);
  return { kind: 'ZHIBAN_SOURCE_PROFILE_PIN_V1', sha256: digest(bytes), targetRead: false };
}
