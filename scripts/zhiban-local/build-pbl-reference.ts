/** Independent fresh owned PG16 reference builder. No configured development/production connection. */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { pblMigration, pblMigrations, pblReference, pblProfile } from './pbl';
const bin = '/usr/lib/postgresql/16/bin',
  port = 56546;
const hash = (v: Buffer) => createHash('sha256').update(v).digest('hex');
async function main() {
  const owned = await mkdtemp(join(tmpdir(), 'zhiban-pbl-reference-')),
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
    for (const ctx of [
      'identity',
      'academic',
      'learning',
      'assessment',
      'curriculum',
      'classroom',
      'pbl',
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
    const client = await pool.connect();
    let profile: string;
    try {
      await client.query('BEGIN READ ONLY');
      profile = await pblProfile(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    // A lock-helper caller must retain the exact nonprivileged Bridge role attributes.
    await pool.query('ALTER ROLE zhiban_bridge_runtime INHERIT');
    const changedClient = await pool.connect();
    try {
      await changedClient.query('BEGIN READ ONLY');
      if ((await pblProfile(changedClient)) === profile)
        throw Error('Bridge attribute drift was not bound');
    } finally {
      await changedClient.query('ROLLBACK');
      changedClient.release();
      await pool.query('ALTER ROLE zhiban_bridge_runtime NOINHERIT');
    }
    const restoredClient = await pool.connect();
    try {
      await restoredClient.query('BEGIN READ ONLY');
      if ((await pblProfile(restoredClient)) !== profile)
        throw Error('Bridge attribute restore mismatch');
    } finally {
      await restoredClient.query('ROLLBACK');
      restoredClient.release();
    }
    await writeFile(
      pblReference,
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          scope: 'FRESH_OWNED_PG16_PBL_REFERENCE',
          pgVersion: version,
          migrationSha256: sources[resolve(pblMigration)],
          migrationHashes: pblMigrations.map((p) => sources[resolve(p)]),
          profileSha256: profile,
          sourceHashes: sources,
          constructionOnly: true,
          negativeChecks: [
            'Bridge caller role INHERIT drift changes expected profile; restore matches',
          ],
          note: 'Source-built in an independent owned cluster; no product/authorization signoff. Owned cluster removed before successful builder exit.',
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS independent pbl catalog/ACL reference constructed');
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
