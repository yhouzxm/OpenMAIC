import { contentProfile } from './content-profile';
import { catalogFingerprint } from '../../lib/zhiban/infrastructure/openmaic/catalog';
import { autoContentReference, autoContentBase } from './autograde-content-reference';
/** Independent fresh owned PG16 reference builder. No configured development/production connection. */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { autogradeMigrations, autogradeReference, autogradeProfile } from './autograde';
const bin = '/usr/lib/postgresql/16/bin',
  port = 56549;
const hash = (v: Buffer) => createHash('sha256').update(v).digest('hex');
async function main() {
  const owned = await mkdtemp(join(tmpdir(), 'zhiban-autograde-reference-')),
    data = join(owned, 'data'),
    socket = join(owned, 'socket');
  let started = false;
  const pool = new Pool({ host: socket, port, user: 'postgres', database: 'postgres', max: 1 });
  const sources: Record<string, string> = {};
  try {
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
    const version = Number(
      (await pool.query("SELECT current_setting('server_version_num') AS v")).rows[0].v,
    );
    if (version < 160000 || version >= 170000) throw Error('PG16 required');
    for (const f of ['bootstrap-roles.pg16.sql', 'bootstrap-bridge-roles.pg16.sql']) {
      const path = resolve('lib/zhiban/infrastructure/identity/postgres', f);
      sources[path] = hash(await readFile(path));
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
          'postgres',
          '-f',
          path,
        ],
        { stdio: 'pipe' },
      );
    }
    await pool.query(
      'CREATE ROLE zhiban_academic_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',
    );
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
        'postgres',
        '-f',
        resolve('scripts/zhiban-local/autograde-bootstrap.sql'),
      ],
      { stdio: 'pipe' },
    );
    for (const ctx of [
      'identity',
      'academic',
      'learning',
      'assessment',
      'profile',
      'teaching',
      'curriculum',
      'classroom',
      'autograde',
    ]) {
      const dir = resolve(`lib/zhiban/infrastructure/${ctx}/postgres/migrations`);
      for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
        const path = join(dir, f),
          bytes = await readFile(path);
        sources[path] = hash(bytes);
        await pool.query('BEGIN');
        await pool.query('SET LOCAL ROLE zhiban_identity_owner');
        await pool.query(bytes.toString());
        await pool.query(`INSERT INTO zhiban_${ctx}.schema_migrations VALUES($1,$2)`, [
          f.slice(0, 4),
          hash(bytes),
        ]);
        await pool.query('COMMIT');
      }
    }
    let contentSource = '';
    for (const path of [
      'docs/v2/candidates/m5-content/01-schema.sql',
      'docs/v2/candidates/m5-content/02-helpers-and-guards.sql',
      'docs/v2/candidates/m5-content/03-acl.sql',
      'docs/v2/candidates/m5-png/0002-png.sql',
      'docs/v2/candidates/p4-interactive/0003-interactive.sql',
      'docs/v2/candidates/p4-attempt-runtime/0004-attempt-runtime.sql',
      'docs/v2/candidates/p4-joint-classroom/0005-joint-classroom.sql',
    ]) {
      const bytes = await readFile(path);
      sources[resolve(path)] = hash(bytes);
      await pool.query('BEGIN');
      await pool.query('SET LOCAL ROLE zhiban_identity_owner');
      await pool.query(bytes.toString());
      if (path.includes('/m5-content/')) {
        contentSource += bytes.toString();
        if (path.endsWith('/03-acl.sql'))
          await pool.query('INSERT INTO zhiban_content.schema_migrations VALUES($1,$2)', [
            '0001',
            hash(Buffer.from(contentSource)),
          ]);
      } else {
        const name = path.includes('/m5-png/')
          ? 'png'
          : path.includes('/p4-interactive/')
            ? 'interactive'
            : path.includes('/p4-attempt-runtime/')
              ? 'attempt_runtime'
              : 'joint';
        await pool.query(`INSERT INTO zhiban_content.${name}_schema_migrations VALUES($1,$2)`, [
          path.split('/').at(-1)!.slice(0, 4),
          hash(bytes),
        ]);
      }
      await pool.query('COMMIT');
    }
    const combinedClient = await pool.connect();
    let actual;
    try {
      actual = await contentProfile(combinedClient);
    } finally {
      combinedClient.release();
    }
    const client = await pool.connect();
    let profile: string;
    try {
      await client.query('BEGIN READ ONLY');
      profile = await autogradeProfile(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await writeFile(
      autogradeReference,
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          scope: 'FRESH_OWNED_PG16_AUTOGRADE_REFERENCE',
          pgVersion: version,
          migrationHashes: Object.fromEntries(
            autogradeMigrations.map((p) => [p, sources[resolve(p)]]),
          ),
          profileSha256: profile,
          sourceHashes: sources,
          constructionOnly: true,
          note: 'Source-built in an independent owned cluster; no product/authorization signoff. Owned cluster removed before successful builder exit.',
        },
        null,
        2,
      ) + '\n',
    );
    const baseBytes = await readFile(autoContentBase),
      base = JSON.parse(baseBytes.toString());
    const replacementFingerprints: Record<string, string> = {};
    await pool.query('SET search_path TO pg_catalog');
    const c = await pool.connect();
    try {
      for (const schema of ['zhiban_academic', 'zhiban_learning', 'zhiban_assessment'])
        replacementFingerprints[schema] = await catalogFingerprint(c, schema as 'public');
    } finally {
      c.release();
    }
    for (const schema of ['zhiban_identity', 'zhiban_bridge', 'zhiban_content'])
      if (actual.fingerprints[schema] !== base.enabledProfile.fingerprints[schema])
        throw Error('Unchanged combined base schema drift ' + schema);
    if (JSON.stringify(actual.extra) !== JSON.stringify(base.enabledProfile.extra))
      throw Error('Unchanged combined base roles/owners/ACL drift');
    const fingerprints = { ...base.enabledProfile.fingerprints, ...replacementFingerprints };
    await writeFile(
      autoContentReference,
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          scope: 'SOURCE_BUILT_AUTOGRADE_OVER_FIXED_CONTENT_REFERENCE',
          baseReferenceSha256: hash(baseBytes),
          migrationHashes: Object.fromEntries(
            autogradeMigrations.map((p) => [p, sources[resolve(p)]]),
          ),
          replacementFingerprints,
          fingerprint: hash(
            Buffer.from(JSON.stringify({ fingerprints, extra: base.enabledProfile.extra })),
          ),
          constructionOnly: true,
          note: 'Only the three modified business schemas are reconstructed in this separate owned PG16 cluster. Content, Identity, Bridge and global facts retain the exact prior trusted expected profile. Live host never generates this expected.',
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS independent autograde catalog/ACL reference constructed');
  } finally {
    await pool.end();
    if (started)
      execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], {
        stdio: 'pipe',
      });
    await rm(owned, { recursive: true, force: true });
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
