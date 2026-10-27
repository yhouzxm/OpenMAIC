/** Independent source-only PG18 reference builder. Never accepts a target DSN or existing data directory. */
/* eslint-disable @typescript-eslint/no-explicit-any -- versioned JSON catalog and module profile adapters */
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import {
  localPgMajor,
  localPgBin,
  hashPgInput,
  pg18ReferencePath,
  pg18PinPath,
  versionedContentPath,
} from '../zhiban-local/pg-version';
import { businessPg18Catalog } from './pg18-catalog';
import { contentProfile } from '../zhiban-local/content-profile';
import { jointClassroomProfile } from '../zhiban-local/joint-classroom-receipt';
import { teacherRelationshipPublicProfile } from '../../lib/zhiban/infrastructure/teaching/postgres/relationships';
import { provisionNative } from '../../lib/zhiban/infrastructure/openmaic/provision';
import { official, catalogFingerprint } from '../../lib/zhiban/infrastructure/openmaic/catalog';
import * as m0 from '../zhiban-local/autograde';
import * as m1 from '../zhiban-local/attainment';
import * as m2 from '../zhiban-local/ema';
import * as m3 from '../zhiban-local/pbl';
import * as m4 from '../zhiban-local/flow';
import * as m5 from '../zhiban-local/finalgrade';
import * as m6 from '../zhiban-local/imports';
import * as m7 from '../zhiban-local/onboarding';
import * as m8 from '../zhiban-local/tutor';
import * as m9 from '../zhiban-local/learner';
import * as m10 from '../zhiban-local/concept';
import * as m11 from '../zhiban-local/risk';
import * as m12 from '../zhiban-local/remediation';
import * as m13 from '../zhiban-local/reminder';
import * as m14 from '../zhiban-local/followup';
import * as m15 from '../zhiban-local/material';
import * as m16 from '../zhiban-local/profile';
import * as m17 from '../zhiban-local/discussion';
import * as m18 from '../zhiban-local/login-identifiers';
const moduleProfiles = [
  [m0.autogradeReference, m0.autogradeProfile],
  [m1.attainmentReference, m1.attainmentProfile],
  [m2.emaReference, m2.emaProfile],
  [m3.pblReference, m3.pblProfile],
  [m4.flowReference, m4.flowProfile],
  [m5.finalgradeReference, m5.finalgradeProfile],
  [m6.importsReference, m6.importsProfile],
  [m7.onboardingReference, m7.onboardingProfile],
  [m8.tutorReference, m8.tutorProfile],
  [m9.learnerReference, m9.learnerProfile],
  [m10.conceptReference, m10.conceptProfile],
  [m11.riskReference, m11.riskProfile],
  [m12.remediationReference, m12.remediationProfile],
  [m13.reminderReference, m13.reminderProfile],
  [m14.followupReference, m14.followupProfile],
  [m15.materialReference, m15.materialCatalog],
  [m16.profileReference, m16.profileCatalog],
  [m17.discussionReference, m17.discussionProfile],
  [m18.loginIdentifiersReference, m18.loginIdentifiersProfile],
] as const;
async function constructPg18Reference(legacy: boolean) {
  if (localPgMajor !== 18) throw Error('Explicit PG18_V1 builder context required');
  const sourceBin = legacy ? '/usr/lib/postgresql/16/bin' : localPgBin;
  const inputPath = (p: string) => (legacy ? p : versionedContentPath(p));
  const root = await mkdtemp(join(tmpdir(), 'zhiban-pg18-reference-')),
    socket = join(root, 'socket'),
    data = join(root, 'data'),
    port = 56558;
  const pools: Pool[] = [];
  let started = false,
    converted = false;
  let currentSocket = socket,
    currentPort = port;
  const sourceHashes: Record<string, string> = {};
  const source = async (p: string) => {
    const b = await readFile(p);
    sourceHashes[p] = hashPgInput(b);
    return b.toString();
  };
  const pool = (db: string, user = 'postgres') => {
    const p = new Pool({
      host: currentSocket,
      port: currentPort,
      user,
      database: db,
      max: 2,
      connectionTimeoutMillis: 1000,
      statement_timeout: 15000,
    });
    pools.push(p);
    return p;
  };
  const psql = async (file: string, db: string) => {
    await source(file);
    execFileSync(
      join(localPgBin, 'psql'),
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
        db,
        '-f',
        resolve(file),
      ],
      { stdio: 'pipe' },
    );
  };
  try {
    await mkdir(socket, { mode: 0o700 });
    execFileSync(
      join(sourceBin, 'initdb'),
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
      join(sourceBin, 'pg_ctl'),
      [
        '-D',
        data,
        '-l',
        join(root, 'postgres.log'),
        '-o',
        `-p ${port} -k ${socket} -c listen_addresses=''`,
        '-w',
        'start',
      ],
      { stdio: 'pipe' },
    );
    started = true;
    const master = pool('postgres'),
      db = 'pg18_reference_identity',
      nativeDb = 'pg18_reference_native';
    await master.query(`CREATE DATABASE ${db}`);
    for (const f of ['bootstrap-roles.pg18.sql', 'bootstrap-bridge-roles.pg18.sql'])
      await psql(
        legacy
          ? 'lib/zhiban/infrastructure/identity/postgres/' + f.replace('pg18', 'pg16')
          : 'docs/v2/candidates/pg18-provider-v1/' + f,
        db,
      );
    let admin = pool(db);
    let version = Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);
    if (Math.floor(version / 10000) !== (legacy ? 16 : 18))
      throw Error('Builder source binary/endpoint mismatch');
    await psql('scripts/zhiban-local/autograde-bootstrap.sql', db);
    await admin.query(
      'CREATE ROLE zhiban_academic_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',
    );
    for (const ctx of [
      'identity',
      'academic',
      'learning',
      'assessment',
      'curriculum',
      'classroom',
      'learning-files',
      'discussion',
      'profile',
      'material',
      'teaching',
      'followup',
      'reminder',
      'remediation',
      'risk',
      'concept',
      'learner',
      'tutor',
      'onboarding',
      'login-identifiers',
      'imports',
      'finalgrade',
      'flow',
      'pbl',
      'ema',
      'attainment',
      'autograde',
    ]) {
      const dir = `lib/zhiban/infrastructure/${ctx}/postgres/migrations`;
      for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
        const sql = await source(dir + '/' + f);
        await admin.query('BEGIN');
        await admin.query('SET LOCAL ROLE zhiban_identity_owner');
        await admin.query(sql);
        await admin.query(
          `INSERT INTO zhiban_${ctx.replaceAll('-', '_')}.schema_migrations VALUES($1,$2)`,
          [f.slice(0, 4), hashPgInput(sql)],
        );
        await admin.query('COMMIT');
      }
    }
    let content = '';
    for (const file of [
      'docs/v2/candidates/m5-content/01-schema.sql',
      'docs/v2/candidates/m5-content/02-helpers-and-guards.sql',
      'docs/v2/candidates/m5-content/03-acl.sql',
      'docs/v2/candidates/m5-png/0002-png.sql',
      'docs/v2/candidates/p4-interactive/0003-interactive.sql',
      'docs/v2/candidates/p4-attempt-runtime/0004-attempt-runtime.sql',
      'docs/v2/candidates/p4-joint-classroom/0005-joint-classroom.sql',
    ]) {
      const sql = await source(inputPath(file));
      await source(file);
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE zhiban_identity_owner');
      await admin.query(sql);
      if (file.includes('/m5-content/')) {
        content += sql;
        if (file.endsWith('03-acl.sql'))
          await admin.query('INSERT INTO zhiban_content.schema_migrations VALUES($1,$2)', [
            '0001',
            hashPgInput(content),
          ]);
      } else {
        const name = file.includes('/m5-png/')
          ? 'png'
          : file.includes('/p4-interactive/')
            ? 'interactive'
            : file.includes('/p4-attempt-runtime/')
              ? 'attempt_runtime'
              : 'joint';
        await admin.query(`INSERT INTO zhiban_content.${name}_schema_migrations VALUES($1,$2)`, [
          file.split('/').at(-1)!.slice(0, 4),
          hashPgInput(sql),
        ]);
      }
      await admin.query('COMMIT');
    }
    await master.query(`CREATE DATABASE ${nativeDb}`);
    await psql(
      legacy
        ? 'lib/zhiban/infrastructure/openmaic/bootstrap-native-roles.pg16.sql'
        : 'docs/v2/candidates/pg18-provider-v1/bootstrap-native-roles.pg18.sql',
      nativeDb,
    );
    let native = await provisionNative(
      pool(nativeDb, 'zhiban_openmaic_migrator'),
      nativeDb,
      'PG18_REFERENCE_CONSTRUCTION_ONLY',
    );
    if (legacy) {
      const outSocket = join(root, 'converted-socket');
      await mkdir(outSocket, { mode: 0o700 });
      const roles = execFileSync(
        join(localPgBin, 'pg_dumpall'),
        ['-h', socket, '-p', String(port), '-U', 'postgres', '--roles-only'],
        { encoding: 'utf8' },
      ).replace(/^CREATE ROLE postgres;\r?\n/m, '');
      const archives: Record<string, string> = {};
      for (const name of [db, nativeDb]) {
        const archive = join(root, name + '.dump');
        execFileSync(join(localPgBin, 'pg_dump'), [
          '-h',
          socket,
          '-p',
          String(port),
          '-U',
          'postgres',
          '-d',
          name,
          '--create',
          '--format=custom',
          '--file=' + archive,
        ]);
        archives[name] = archive;
      }
      execFileSync(
        join(localPgBin, 'initdb'),
        [
          '-D',
          join(root, 'converted-data'),
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
        join(localPgBin, 'pg_ctl'),
        [
          '-D',
          join(root, 'converted-data'),
          '-l',
          join(root, 'converted.log'),
          '-o',
          `-p 56557 -k ${outSocket} -c listen_addresses=''`,
          '-w',
          'start',
        ],
        { stdio: 'pipe' },
      );
      converted = true;
      execFileSync(
        join(localPgBin, 'psql'),
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '--single-transaction',
          '-h',
          outSocket,
          '-p',
          '56557',
          '-U',
          'postgres',
          '-d',
          'postgres',
        ],
        { input: roles, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      for (const name of [db, nativeDb])
        execFileSync(
          join(localPgBin, 'pg_restore'),
          [
            '-h',
            outSocket,
            '-p',
            '56557',
            '-U',
            'postgres',
            '-d',
            'postgres',
            '--create',
            '--exit-on-error',
            archives[name],
          ],
          { stdio: 'pipe' },
        );
      currentSocket = outSocket;
      currentPort = 56557;
      admin = pool(db);
      version = Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);
      const np = await pool(nativeDb).connect();
      try {
        await np.query('SET search_path=pg_catalog,public,pg_temp');
        native = { ...native, fingerprint: await catalogFingerprint(np, 'public') };
      } finally {
        np.release();
      }
    }
    const client = await admin.connect();
    let global: any, combined: any, joint: string, teacher: string;
    const results: Record<string, string> = {};
    try {
      global = await businessPg18Catalog(client);
      combined = await contentProfile(client);
      joint = await jointClassroomProfile(client);
      teacher = await teacherRelationshipPublicProfile(client);
      for (const [name, fn] of moduleProfiles) results[name] = await fn(client);
    } finally {
      client.release();
    }
    const sourceFiles = execFileSync(
      'rg',
      ['--files', 'packages/@openmaic/storage/src', 'packages/@openmaic/dsl/src'],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter((p) => /\.(ts|sql)$/.test(p));
    for (const p of [
      ...sourceFiles,
      ...[
        'autograde',
        'attainment',
        'ema',
        'pbl',
        'flow',
        'finalgrade',
        'imports',
        'onboarding',
        'tutor',
        'learner',
        'concept',
        'risk',
        'remediation',
        'reminder',
        'followup',
        'material',
        'profile',
        'discussion',
        'login-identifiers',
        'content-profile',
        'pg-version',
      ].map((n) => 'scripts/zhiban-local/' + n + '.ts'),
      'scripts/zhiban-deploy/build-pg18-reference.ts',
      'scripts/zhiban-deploy/pg18-catalog.ts',
      'lib/zhiban/infrastructure/openmaic/catalog.ts',
      'lib/zhiban/infrastructure/openmaic/provision.ts',
      'lib/zhiban/infrastructure/openmaic/document-ownership.ts',
      'lib/zhiban/infrastructure/openmaic/schema-state.ts',
      'lib/zhiban/infrastructure/teaching/postgres/relationships.ts',
      'pnpm-lock.yaml',
      'packages/@openmaic/storage/package.json',
      'packages/@openmaic/dsl/package.json',
    ])
      await source(p);
    const sorted = Object.fromEntries(
      Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b)),
    );
    const profiles: Record<string, any> = {};
    const template = async (name: string) => {
      const old = JSON.parse(await source(name));
      const r: any = {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        scope: old.scope.replaceAll('PG16', 'PG18'),
        pgVersion: version,
        sourceHashes: sorted,
        constructionOnly: true,
      };
      for (const [k, v] of Object.entries(old))
        if (
          /MigrationSha256$/.test(k) ||
          k === 'migrationSha256' ||
          k === 'migrationHashes' ||
          k === 'provider'
        )
          r[k] = v;
      return r;
    };
    for (const [name] of moduleProfiles) {
      const r = await template(name);
      r.profileSha256 = results[name];
      profiles[name] = r;
    }
    for (const name of [
      'docs/v2/evidence/m5-png-profile-reference-teacher-local.json',
      'docs/v2/evidence/m5-png-profile-reference-quiz-local.json',
      'docs/v2/evidence/p4-interactive-profile-reference-local.json',
      'docs/v2/evidence/p4-attempt-runtime-profile-reference-local.json',
      'docs/v2/evidence/p4-joint-classroom-profile-reference-local.json',
    ]) {
      const r = await template(name);
      r.enabledProfile = combined;
      r.nativeFingerprint = native.fingerprint;
      r.teacherRelationshipFingerprint = teacher;
      r.jointClassroomFingerprint = joint;
      r.provider = official;
      for (const [key, old] of Object.entries({
        migrationSha256: 'docs/v2/candidates/m5-png/0002-png.sql',
        interactiveMigrationSha256: 'docs/v2/candidates/p4-interactive/0003-interactive.sql',
        attemptRuntimeMigrationSha256:
          'docs/v2/candidates/p4-attempt-runtime/0004-attempt-runtime.sql',
        jointMigrationSha256: 'docs/v2/candidates/p4-joint-classroom/0005-joint-classroom.sql',
      })) {
        if (key in r) r[key] = hashPgInput(await readFile(inputPath(old)));
      }
      profiles[name] = r;
    }
    profiles['docs/v2/evidence/zhiban-autograde-content-reference-local.json'] = {
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      scope: 'SOURCE_BUILT_PG18_UNIFIED_CONTENT_REFERENCE',
      constructionOnly: true,
      fingerprint: combined.fingerprint,
    };
    // Template bytes are provenance dependencies, with no inherited PG16 catalog facts.
    const allSources = Object.fromEntries(
      Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b)),
    );
    const reference = {
      kind: 'PG18_SOURCE_BUILT_REFERENCE_V1',
      major: 18,
      pgVersion: version,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      constructionOnly: true,
      provider: official,
      sourceHashes: allSources,
      businessFingerprint: global.fingerprint,
      contentFingerprint: combined.fingerprint,
      nativeFingerprint: native.fingerprint,
      businessCatalog: global.facts,
      profiles,
    };
    return reference;
  } finally {
    for (const p of pools) await p.end();
    if (converted)
      execFileSync(
        join(localPgBin, 'pg_ctl'),
        ['-D', join(root, 'converted-data'), '-m', 'fast', '-w', 'stop'],
        { stdio: 'pipe' },
      );
    if (started)
      execFileSync(join(sourceBin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], {
        stdio: 'pipe',
      });
    await rm(root, { recursive: true, force: true });
  }
}

export async function buildPg18Reference(verify: boolean) {
  if (!verify && process.env.GITHUB_ACTIONS === 'true')
    throw Error('CI may verify but cannot issue expected PG18 references');
  const fresh = await constructPg18Reference(false),
    imported = await constructPg18Reference(true);
  const reference = {
    ...fresh,
    sourceHashes: Object.fromEntries(
      Object.entries({ ...fresh.sourceHashes, ...imported.sourceHashes }).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
    importedPg16: imported,
  };
  const bytes = JSON.stringify(reference, null, 2) + '\n';
  if (verify) {
    if ((await readFile(pg18ReferencePath, 'utf8')) !== bytes)
      throw Error('Independent PG18 reference rebuild differs from committed expected');
    const pin = JSON.parse(await readFile(pg18PinPath, 'utf8'));
    if (pin.sha256 !== hashPgInput(bytes)) throw Error('PG18 pin mismatch');
  } else {
    await writeFile(pg18ReferencePath, bytes);
    await writeFile(
      pg18PinPath,
      JSON.stringify({ kind: 'PG18_REFERENCE_PIN_V1', sha256: hashPgInput(bytes) }, null, 2) + '\n',
    );
  }
  console.log(
    JSON.stringify({
      status: 'PASS',
      scope: 'INDEPENDENT_PG18_FRESH_AND_SOURCE16_IMPORT_REFERENCES',
      version: fresh.pgVersion,
      verified: verify,
      manifestSha256: hashPgInput(bytes),
      targetRead: false,
    }),
  );
}
