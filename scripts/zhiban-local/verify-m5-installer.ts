import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  directory,
  database,
  pgPort,
  privateFile,
  requirePrivateClusterDirectories,
  digest,
} from './config';
import { readContentConfiguration, validateContentInstallation } from './content-receipt';
const start = () => {
  const child = spawn(process.execPath, [join(directory, 'm5-installer.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
  const done = new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
  return { child, done };
};
async function main() {
  await requirePrivateClusterDirectories();
  const { config, receipt } = await readContentConfiguration();
  const admin = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 2,
  });
  const bridge = new Pool({ connectionString: config.bridge, max: 1 }),
    native = new Pool({ connectionString: config.native, max: 1 });
  const checks: string[] = [];
  const pass = (s: string) => {
    checks.push(s);
    console.log('PASS ' + s);
  };
  const children: ReturnType<typeof start>[] = [];
  try {
    const before = (
      await admin.query('SELECT version,checksum FROM zhiban_content.schema_migrations')
    ).rows;
    const nativeCount = Number(
      (await native.query('SELECT count(*) FROM public.document_stages')).rows[0].count,
    );
    const holder = await admin.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtextextended('LOCAL_M5_INSTALL',0))");
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      children.push(start(), start());
      let blocked = 0;
      const until = Date.now() + 6000;
      while (Date.now() < until) {
        blocked = Number(
          (
            await admin.query(
              "SELECT count(*) FROM pg_stat_activity WHERE usename='postgres' AND wait_event='advisory' AND $1=ANY(pg_blocking_pids(pid))",
              [pid],
            )
          ).rows[0].count,
        );
        if (blocked === 2) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(blocked, 2);
      pass('two installer processes wait on the same whole-install session lock');
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtextextended('LOCAL_M5_INSTALL',0))");
      holder.release();
    }
    for (const child of children) {
      const result = await child.done;
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /without reapplying/);
    }
    pass('serialized concurrent issuers succeed without reapplying SQL');
    const sourcePath = 'scripts/zhiban-local/config.ts',
      source = await readFile(sourcePath);
    try {
      await writeFile(
        sourcePath,
        Buffer.concat([source, Buffer.from('\n// LOCAL stale build probe\n')]),
      );
      const child = start();
      children.push(child);
      const result = await child.done;
      assert.notEqual(result.code, 0);
      assert.match(result.output, /Fresh source\/artifact build bindings required/);
      pass('stale entry source rejects installer before any migration');
    } finally {
      await writeFile(sourcePath, source);
    }
    const receiptPath = join(directory, 'content-installation-receipt.json');
    try {
      await chmod(receiptPath, 0o644);
      const child = start();
      children.push(child);
      const result = await child.done;
      assert.equal(result.code, 0, result.output);
      assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
      JSON.parse((await privateFile('content-installation-receipt.json')).toString());
      pass('atomic receipt replacement produces complete JSON with exact 0600 permissions');
    } finally {
      await chmod(receiptPath, 0o600);
    }
    assert.deepEqual(
      (await admin.query('SELECT version,checksum FROM zhiban_content.schema_migrations')).rows,
      before,
    );
    assert.equal(
      Number((await native.query('SELECT count(*) FROM public.document_stages')).rows[0].count),
      nativeCount,
    );
    const fresh = await readContentConfiguration();
    await validateContentInstallation(bridge, native, fresh.receipt, fresh.config);
    pass('ledger, Native rows and accepted source/catalog bindings unchanged');
    await writeFile(
      'docs/v2/evidence/m5-installer-review-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          status: 'PASS',
          at: new Date().toISOString(),
          checks,
          implementationBindingHash: receipt.bindingHash,
          candidateMigrationSha256: receipt.candidateMigrationSha256,
          runnerSha256: digest(
            await readFile('scripts/zhiban-local/verify-m5-installer.ts', 'utf8'),
          ),
          scope: 'EXISTING_OWNED_LOCAL_INSTALL_REISSUE_CONCURRENCY_AND_NEGATIVES',
          firstInstallReplayed: false,
          commitPushCiDispatch: false,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`LOCAL M5 installer ${checks.length}/${checks.length} PASS`);
  } finally {
    for (const c of children) if (c.child.exitCode === null) c.child.kill('SIGTERM');
    await Promise.allSettled(children.map((c) => c.done));
    await Promise.allSettled([admin.end(), bridge.end(), native.end()]);
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Installer verification failed');
  process.exitCode = 1;
});
