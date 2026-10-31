/** Actual stopped-host, dump/restore, signed activation and HTTPS proxy acceptance. Synthetic data only. */
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  chmod,
  symlink,
  unlink,
  rm,
  readdir,
} from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:https';
import { createHash, createPublicKey, randomBytes, createPrivateKey, sign } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import type { ownedCluster } from './production-source';
import { prepareOwned } from './production-source';
import { renderUbuntu } from './production-ubuntu';
import {
  backup,
  verifyBackup,
  restorePlan,
  restore,
  activateRestored,
  resume,
  type OperationsInput,
  type RestoreInput,
} from '@/lib/zhiban/infrastructure/production/operations';
import { saveJson, privateJson, digest } from '@/lib/zhiban/infrastructure/production/files';
import { ownTree, fileFact } from '@/lib/zhiban/infrastructure/production/backup-files';
import {
  verifiedInstallation,
  type RuntimeInput,
  type InstallInput,
} from '@/lib/zhiban/infrastructure/production/deployment';
import { hostRequest } from '@/lib/zhiban/infrastructure/production/maintenance';
import { instanceKey, sealSecret, openSecret, type SealedSecret } from '@/lib/server/secret-box';
import { v7 } from 'uuid';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function exited(p: ChildProcess) {
  if (p.exitCode !== null) return;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(Error('Child exit timeout')), 60000);
    p.once('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
}
export async function verifyProductionOperations(input: {
  base: string;
  x: Parameters<Parameters<typeof ownedCluster>[0]>[0];
  runtime: RuntimeInput;
  runtimeFile: string;
  installInput: InstallInput;
  startSource: () => ChildProcess;
  student: { userId: string; password: string; progress: string };
  administrator: { userId: string; password: string };
}) {
  const { base, x, runtime: c, runtimeFile, installInput } = input,
    p = (s: string) => join(base, s),
    ops: OperationsInput = {
      kind: 'ZHIBAN_OPERATIONS_INPUT_V1',
      runtimeFile,
      serviceUid: process.getuid!(),
      serviceGid: process.getgid!(),
      pgBin: x.bin,
      connections: structuredClone(installInput.migrations),
      receiptPrivateKeyFile: installInput.receiptPrivateKeyFile,
    };
  for (const k of ['business', 'content', 'authoring'] as const)
    ops.connections[k] = {
      ...installInput.migrations[k],
      role: 'postgres',
      credentialFile: await rewriteCredential(
        p('setup-admin.env'),
        c.databases[k],
        p('backup-admin-' + k + '.env'),
      ),
    };
  const opsFile = p('operations.json');
  await saveJson(opsFile, ops, true);
  const restricted = p('restricted-operations.json');
  await saveJson(restricted, { ...ops, connections: installInput.migrations }, true);
  await assert.rejects(
    backup(restricted, p('must-not-be-created')),
    /FULL_DATA_AUTHORITY_REQUIRED/,
  );
  const report: Record<string, unknown> = {
    evidenceOrigin: 'LOCAL',
    createdAt: new Date().toISOString(),
    baselineSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceScope: 'UNCOMMITTED_CANDIDATE',
    githubActions: false,
    scope: 'NON_ROOT_HOST_AND_CONSISTENT_THREE_DATABASE_BACKUP_RESTORE',
    productionConnected: false,
  };
  let backupPending: Promise<unknown> | undefined;
  let source: ChildProcess | undefined,
    target: ChildProcess | undefined,
    browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
    release: string | undefined;
  const allChildren: ChildProcess[] = [];
  try {
    const keyDir = join(c.stateDirectory, 'data/native-secret'),
      secretValue = 'synthetic-provider-secret-for-recovery',
      sealed = sealSecret(secretValue, 'LOCAL_OPS_ACCEPTANCE', instanceKey({}, keyDir));
    await x
      .pool('postgres', c.databases.authoring)
      .query(
        "INSERT INTO public.workspace_model_config(owner_id,config,secrets,revision) VALUES('local-ops-acceptance','{}'::jsonb,$1,1)",
        [JSON.stringify({ test: sealed })],
      );
    await writeFile(
      join(c.stateDirectory, 'data/native-materials/acceptance-original.bin'),
      Buffer.from('synthetic original bytes; must survive restore'),
      { mode: 0o600 },
    );
    source = input.startSource();
    allChildren.push(source);
    for (let n = 0; ; n++) {
      try {
        await hostRequest(c.stateDirectory, 'ready');
        break;
      } catch {
        assert.ok(n < 120);
        await pause(100);
      }
    }
    const foreignRuntime = p('foreign-runtime.json'),
      foreignOps = p('foreign-operations.json');
    await saveJson(foreignRuntime, { ...c, instanceId: v7() }, true);
    await saveJson(foreignOps, { ...ops, runtimeFile: foreignRuntime }, true);
    await assert.rejects(backup(foreignOps, p('foreign-backup')), /foreign installation/);
    await assert.rejects(readFile(join(c.stateDirectory, 'MAINTENANCE.json')), { code: 'ENOENT' });
    await assert.rejects(
      hostRequest(c.stateDirectory, 'stop', process.getuid!(), v7()),
      /HOST_INSTANCE_REJECTED/,
    );
    await hostRequest(c.stateDirectory, 'ready');
    report.preStopBinding = 'PASS_FOREIGN_INSTANCE_REJECTED_WITHOUT_STOP_OR_FENCE';
    const bundle = p('consistent-backup'),
      pending = backup(opsFile, bundle);
    backupPending = pending;
    let finished = false;
    void pending
      .finally(() => {
        finished = true;
      })
      .catch(() => {});
    for (let n = 0; ; n++) {
      const fence = await privateJson<{ status: string }>(
        join(c.stateDirectory, 'MAINTENANCE.json'),
      ).catch(() => null);
      if (fence?.status === 'FENCED') break;
      assert.ok(!finished && n < 3000, 'Could not observe the real backup barrier');
      await pause(20);
    }
    const writer = x.pool('zhiban_academic_runtime', c.databases.business);
    await writer.query("SET statement_timeout='250ms'");
    await assert.rejects(
      writer.query(
        'INSERT INTO zhiban_academic.people SELECT * FROM zhiban_academic.people LIMIT 1',
      ),
      (e: unknown) => (e as { code: string }).code === '57014',
    );
    const saved = await pending;
    await exited(source);
    assert.equal(source.exitCode, 0);
    report.stopAndBarrier = 'PASS_PROCESS_EXIT_AND_ACTUAL_WRITER_BLOCKED';
    const authority = c.receiptAuthority;
    await verifyBackup(bundle, saved.backupPin, authority);
    await assert.rejects(verifyBackup(bundle, '0'.repeat(64), authority), /PIN_REJECTED/);
    const damaged = join(bundle, 'data/native-materials/acceptance-original.bin'),
      original = await readFile(damaged);
    await writeFile(damaged, 'changed');
    await assert.rejects(verifyBackup(bundle, saved.backupPin, authority), /CLOSURE_REJECTED/);
    await writeFile(damaged, original);
    const manifestFile = join(bundle, 'MANIFEST.json'),
      sourceReceiptFile = join(bundle, 'source-receipt.json'),
      manifestBytes = await readFile(manifestFile),
      sourceReceiptBytes = await readFile(sourceReceiptFile),
      issuerKey = createPrivateKey(await readFile(installInput.receiptPrivateKeyFile));
    const wrongReceipt = JSON.parse(sourceReceiptBytes.toString());
    wrongReceipt.body.kind = 'OTHER_SIGNED_PURPOSE';
    wrongReceipt.signature = sign(
      null,
      Buffer.from(JSON.stringify(wrongReceipt.body)),
      issuerKey,
    ).toString('base64');
    await saveJson(sourceReceiptFile, wrongReceipt);
    const wrongManifest = JSON.parse(manifestBytes.toString());
    wrongManifest.body.files['source-receipt.json'] = await fileFact(sourceReceiptFile);
    wrongManifest.signature = sign(
      null,
      Buffer.from(JSON.stringify(wrongManifest.body)),
      issuerKey,
    ).toString('base64');
    await saveJson(manifestFile, wrongManifest);
    await assert.rejects(
      verifyBackup(bundle, digest(await readFile(manifestFile)), authority),
      /SOURCE_RECEIPT_REJECTED/,
    );
    await writeFile(sourceReceiptFile, sourceReceiptBytes);
    await writeFile(manifestFile, manifestBytes);
    report.receiptPurpose = 'PASS_VALID_SIGNATURE_WITH_WRONG_PURPOSE_REJECTED';

    const blocked = input.startSource();
    allChildren.push(blocked);
    await exited(blocked);
    assert.notEqual(blocked.exitCode, 0);
    report.maintenance = 'PASS_RESTART_REFUSED_UNTIL_EXPLICIT_RELEASE';
    // New dedicated target, with the same frozen roles and an independently bound runtime.
    const targetDbs = {
      business: 'zhiban_recovered_business',
      content: 'zhiban_recovered_content',
      authoring: 'zhiban_recovered_authoring',
    };
    await prepareOwned(x, targetDbs);
    const targetConfig = structuredClone(c);
    targetConfig.instanceId = v7();
    targetConfig.origin = 'https://127.0.0.1:3492';
    targetConfig.identity = { ...targetConfig.identity, origin: targetConfig.origin };
    targetConfig.port = 3493;
    targetConfig.stateDirectory = p('recovered-instance');
    targetConfig.databases = targetDbs;
    targetConfig.tls.serverName = 'localhost';
    const token = await writePrivate(p('proxy-token'), randomBytes(32).toString('hex'));
    targetConfig.trustedProxy = { address: '127.0.0.1', tokenFile: token };
    if (targetConfig.membershipAuthority)
      targetConfig.membershipAuthority.directory = p('recovered-approvals');
    for (const [key, item] of Object.entries(targetConfig.connections)) {
      const db =
        targetDbs[key === 'native' ? 'content' : key === 'authoring' ? 'authoring' : 'business'];
      item.database = db;
      item.credentialFile = await rewriteCredential(
        item.credentialFile,
        db,
        p('recovered-' + key + '.env'),
      );
    }
    const targetRuntime = p('recovered-runtime.json');
    await saveJson(targetRuntime, targetConfig, true);
    const targetOps = structuredClone(ops);
    targetOps.migrations = structuredClone(installInput.migrations);
    for (const [key, item] of Object.entries(targetOps.migrations)) {
      item.database = targetDbs[key as keyof typeof targetDbs];
      item.credentialFile = await rewriteCredential(
        item.credentialFile,
        item.database,
        p('recovered-installer-' + key + '.env'),
      );
    }
    targetOps.runtimeFile = targetRuntime;
    for (const [key, item] of Object.entries(targetOps.connections)) {
      item.database = targetDbs[key as keyof typeof targetDbs];
      item.credentialFile = await rewriteCredential(
        item.credentialFile,
        item.database,
        p('recovered-maintenance-' + key + '.env'),
      );
    }
    const targetOpsFile = p('recovered-operations.json');
    await saveJson(targetOpsFile, targetOps, true);
    const restoreInput: RestoreInput = {
        kind: 'ZHIBAN_RESTORE_INPUT_V1',
        operationsFile: targetOpsFile,
        backupDirectory: bundle,
        backupPin: saved.backupPin,
        backupAuthority: authority,
      },
      restoreFile = p('restore.json');
    await saveJson(restoreFile, restoreInput, true);
    const plan = await restorePlan(restoreFile);
    await assert.rejects(restore(restoreFile, '0'.repeat(64)), /REVIEWED_PLAN/);
    await restore(restoreFile, plan.plan.planSha256);
    await assert.rejects(verifiedInstallation(targetRuntime), /quarantined/);
    await assert.rejects(restore(restoreFile, plan.plan.planSha256));
    // Activation must catch changed originals, not merely a still-valid schema.
    const restoredOriginal = join(
      targetConfig.stateDirectory,
      'data/native-materials/acceptance-original.bin',
    );
    await writeFile(restoredOriginal, 'changed after restore');
    await assert.rejects(
      activateRestored(targetOpsFile, saved.backupPin),
      /ACTIVATION_DATA_CHANGED/,
    );
    await writeFile(restoredOriginal, original);
    await assert.rejects(activateRestored(targetOpsFile, '0'.repeat(64)), /STATE_REJECTED/);
    await activateRestored(targetOpsFile, saved.backupPin);
    const receipt = await verifiedInstallation(targetRuntime);
    assert.notEqual(
      receipt.receipt.deploymentId,
      (await verifyBackup(bundle, saved.backupPin, authority)).body.deploymentId,
    );
    await Promise.all(Object.values(receipt.pools).map((v) => v.end()));
    const row = (
      await x
        .pool('postgres', targetDbs.authoring)
        .query(
          "SELECT secrets FROM public.workspace_model_config WHERE owner_id='local-ops-acceptance'",
        )
    ).rows[0];
    assert.equal(
      openSecret(
        row.secrets.test as SealedSecret,
        'LOCAL_OPS_ACCEPTANCE',
        instanceKey({}, join(targetConfig.stateDirectory, 'data/native-secret')),
      ),
      secretValue,
    );
    assert.deepEqual(await readFile(restoredOriginal), original);
    report.restore = 'PASS_ALL_TABLE_INVENTORIES_ORIGINALS_INSTANCE_KEY_AND_SEALED_CONFIG';
    report.activation = 'PASS_NEW_SIGNED_RECEIPT_OLD_BINDINGS_RETAINED_AND_DATA_RECHECK';
    // Copy only the approved source closure; immutable code and writable private state are separate.
    release = p('readonly-release');
    await mkdir(release, { mode: 0o700 });
    const profile = JSON.parse(await readFile(c.profileFile, 'utf8')) as {
      sourceHashes: Record<string, string>;
    };
    for (const name of Object.keys(profile.sourceHashes)) {
      const dest = join(release, name);
      await mkdir(dirname(dest), { recursive: true, mode: 0o755 });
      await copyFile(resolve(name), dest);
      await chmod(dest, 0o444);
    }
    await symlink(resolve('node_modules'), join(release, 'node_modules'));
    await readonlyDirs(release);
    const readinessProbe = spawn(
      process.execPath,
      [join(release, '.zhiban-host/host.mjs'), '--ready', targetRuntime],
      {
        cwd: release,
        stdio: 'ignore',
      },
    );
    allChildren.push(readinessProbe);
    await pause(150);
    target = spawn(process.execPath, [join(release, '.zhiban-host/host.mjs'), targetRuntime], {
      cwd: release,
      env: { ...process.env, OPENMAIC_CONFIG: undefined },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    allChildren.push(target);
    let diagnostic = '';
    target.stdout!.on('data', (v) => (diagnostic += v));
    target.stderr!.on('data', (v) => (diagnostic += v));
    target.once('exit', () => {
      void writeFile(p('recovered-host-private.log'), diagnostic, { mode: 0o600 });
    });
    for (let n = 0; ; n++) {
      assert.equal(target.exitCode, null, 'Read-only host exited; inspect private diagnostics');
      try {
        await hostRequest(targetConfig.stateDirectory, 'ready');
        break;
      } catch {
        assert.ok(n < 150);
        await pause(100);
      }
    }
    report.host = {
      status: 'PASS',
      effectiveUid: process.getuid!(),
      prebuiltEntry: true,
      readOnlyRelease: true,
      sourceWritesRequired: false,
    };
    await exited(readinessProbe);
    assert.equal(readinessProbe.exitCode, 0, 'ExecStartPost must wait for the host socket');
    report.startupReadiness = 'PASS_PREBUILT_PROBE_STARTED_BEFORE_HOST';
    const ubuntuSpecFile = p('ubuntu-spec.json'),
      templates = p('ubuntu-templates');
    await saveJson(
      ubuntuSpecFile,
      {
        kind: 'ZHIBAN_UBUNTU_HOST_V1',
        runtimeFile: targetRuntime,
        operationsFile: targetOpsFile,
        releaseDirectory: release,
        nodeBinary: '/usr/bin/node',
        serviceUser: process.env.USER || 'zxm',
        serviceGroup: 'zxm',
        serviceUid: process.getuid!(),
        serviceGid: process.getgid!(),
        temporaryDirectory: p('service-tmp'),
        publicCertificateFile: c.tls.certificateFile,
        publicPrivateKeyFile: c.tls.privateKeyFile,
        upstreamCaFile: join(base, 'ca.pem'),
      },
      true,
    );
    await renderUbuntu(ubuntuSpecFile, templates);
    execFileSync(
      '/usr/bin/systemd-analyze',
      ['verify', '--man=no', join(templates, 'zhiban.service')],
      { stdio: 'pipe' },
    );
    report.systemd = 'PASS_UNIT_SYNTAX_ONLY_NOT_MACHINE_BOOT';
    const nginx =
        process.env.ZHIBAN_NGINX_BIN ||
        '/home/zxm/.local/share/zhiban-nginx-runtime/root/usr/sbin/nginx',
      nginxConfig = p('nginx.conf');
    const inc = join(templates, 'zhiban-proxy.inc');
    const server = (await readFile(join(templates, 'zhiban.nginx.conf'), 'utf8')).replaceAll(
      '/etc/nginx/zhiban-proxy.inc',
      inc,
    );
    const nginxMain = `pid ${p('nginx.pid')};\nerror_log ${p('nginx-private.log')} error;\nevents { worker_connections 64; }\nhttp { client_body_temp_path ${p('body-tmp')}; proxy_temp_path ${p('proxy-tmp')}; fastcgi_temp_path ${p('fastcgi-tmp')}; uwsgi_temp_path ${p('uwsgi-tmp')}; scgi_temp_path ${p('scgi-tmp')}; access_log off; ${server} }\n`;
    await writeFile(nginxConfig, nginxMain, { mode: 0o600 });
    execFileSync(nginx, ['-t', '-c', nginxConfig, '-p', base], { stdio: 'pipe' });
    const startProxy = () => {
      const q = spawn(nginx, ['-c', nginxConfig, '-p', base, '-g', 'daemon off;'], {
        stdio: 'ignore',
      });
      allChildren.push(q);
      return q;
    };
    const proxyProcess = startProxy();
    const ca = await readFile(p('ca.pem'));
    const call = (
      path: string,
      value?: unknown,
      cookie?: string,
      headers: Record<string, string> = {},
      origin = targetConfig.origin,
    ) =>
      new Promise<{ status: number; body: string; cookie: string }>((done, reject) => {
        const q = request(
          origin + path,
          {
            ca,
            agent: false,
            method: value ? 'POST' : 'GET',
            headers: {
              host: new URL(targetConfig.origin).host,
              'x-zhiban-request': 'identity-v1',
              ...(value ? { origin: targetConfig.origin, 'content-type': 'application/json' } : {}),
              ...(cookie ? { cookie } : {}),
              ...headers,
            },
          },
          (r) => {
            const parts: Buffer[] = [];
            r.on('data', (v) => parts.push(v));
            r.on('end', () =>
              done({
                status: r.statusCode!,
                body: Buffer.concat(parts).toString(),
                cookie: r.headers['set-cookie']?.[0]?.split(';')[0] ?? '',
              }),
            );
          },
        );
        q.on('error', reject);
        q.setTimeout(10000, () => q.destroy(Error('Proxy HTTPS timeout')));
        q.end(value ? JSON.stringify(value) : undefined);
      });
    for (let n = 0; ; n++) {
      try {
        if ((await call('/zhiban/health')).status === 200) break;
      } catch {}
      assert.ok(n < 100, 'Proxy readiness failed; inspect private nginx log');
      await pause(100);
    }
    assert.equal(
      (await call('/zhiban/health', undefined, undefined, {}, 'https://127.0.0.1:3493')).status,
      403,
    );
    const student = await call(
      '/api/zhiban/identity/login',
      { userId: input.student.userId, password: input.student.password },
      undefined,
      {
        'x-zhiban-client-ip': 'not-an-ip',
        'x-zhiban-proxy-token': 'f'.repeat(64),
        'x-forwarded-for': 'not-an-ip',
      },
    );
    assert.equal(student.status, 200);
    assert.equal((await call('/api/zhiban/platform', undefined, student.cookie)).status, 403);
    const admin = await call('/api/zhiban/identity/login', input.administrator);
    assert.equal(admin.status, 200);
    assert.equal((await call('/api/zhiban/platform', undefined, admin.cookie)).status, 200);
    const publicKey = execFileSync(
        'openssl',
        ['x509', '-in', c.tls.certificateFile, '-pubkey', '-noout'],
        { encoding: 'utf8' },
      ),
      certPin = createHash('sha256')
        .update(createPublicKey(publicKey).export({ type: 'spki', format: 'der' }))
        .digest('base64');
    browser = await chromium.launch({
      headless: true,
      args: [`--ignore-certificate-errors-spki-list=${certPin}`],
    });
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.goto(
      targetConfig.origin +
        '/zhiban?space=' +
        new URL(input.student.progress).searchParams.get('tenant'),
    );
    await page.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(input.student.userId);
    await page.getByLabel('密码', { exact: true }).fill(input.student.password);
    await page.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(page.getByRole('link', { name: '进入课程工作区', exact: true })).toBeVisible();
    await page.goto(input.student.progress.replace(c.origin, targetConfig.origin));
    await expect(
      page
        .locator('.personal-activities')
        .getByText('教师反馈：步骤完整，建议补充复核依据。此反馈已正式发布。', { exact: true }),
    ).toBeVisible();
    const u = new URL(input.student.progress),
      tenant = u.searchParams.get('tenant')!,
      offering = u.searchParams.get('offering')!;
    await page.goto(targetConfig.origin + `/zhiban/content?tenant=${tenant}&offering=${offering}`);
    await page.getByRole('button', { name: '查看已发布', exact: true }).click();
    await expect(
      page.getByText('独立安装后通过受限 Bridge 发布的真实文本。', { exact: false }),
    ).toBeVisible();
    const evidence = resolve('docs/v2/evidence/persistence-130/production-operations-runs');
    await mkdir(evidence, { recursive: true });
    const unique = await (await import('node:fs/promises')).mkdtemp(join(evidence, 'recovered-'));
    await page.screenshot({ path: join(unique, 'student-history.png'), fullPage: true });
    report.browser = {
      status: 'PASS',
      screenshot: join(unique, 'student-history.png'),
      scope: 'ORIGINAL_STUDENT_GRADE_AND_OLD_DEPLOYMENT_CONTENT_VIA_TLS_PROXY',
    };
    await browser.close();
    browser = undefined;
    const originalInclude = await readFile(inc, 'utf8');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        p('foreign-ca.key'),
        '-out',
        p('foreign-ca.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=Wrong upstream CA',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
      ],
      { stdio: 'pipe' },
    );
    await writeFile(inc, originalInclude.replace(p('ca.pem'), p('foreign-ca.pem')), {
      mode: 0o600,
    });
    proxyProcess.kill('SIGHUP');
    for (let n = 0; ; n++) {
      if ((await call('/zhiban/health')).status === 502) break;
      assert.ok(n < 40, 'Untrusted upstream CA was not refused');
      await pause(100);
    }
    await writeFile(inc, originalInclude, { mode: 0o600 });
    proxyProcess.kill('SIGHUP');
    for (let n = 0; ; n++) {
      if ((await call('/zhiban/health')).status === 200) break;
      assert.ok(n < 40);
      await pause(100);
    }
    report.proxy = 'PASS_REAL_NGINX_TLS_NAME_CA_WRONG_CA_DENIED_AND_SPOOFED_HEADERS_REPLACED';

    await hostRequest(targetConfig.stateDirectory, 'stop');
    await exited(target);
    assert.equal(target.exitCode, 0);
    target = undefined;
    const lockProbe = spawn(
      process.execPath,
      [join(release, '.zhiban-host/host.mjs'), targetRuntime],
      { cwd: release, env: { ...process.env, OPENMAIC_CONFIG: undefined }, stdio: 'ignore' },
    );
    allChildren.push(lockProbe);
    for (let n = 0; ; n++) {
      try {
        await hostRequest(targetConfig.stateDirectory, 'ready');
        break;
      } catch {
        assert.ok(n < 150);
        await pause(100);
      }
    }
    const terminated = await x.master.query(
      "SELECT pg_terminate_backend(pid) AS killed FROM pg_locks WHERE locktype='advisory' AND objid=76813001 AND granted AND database=(SELECT oid FROM pg_database WHERE datname=$1)",
      [targetDbs.business],
    );
    assert.equal(terminated.rows.length, 1);
    await exited(lockProbe);
    assert.equal(lockProbe.exitCode, 1);
    const lost = await privateJson<{ status: string }>(
      join(targetConfig.stateDirectory, 'MAINTENANCE.json'),
    );
    assert.equal(lost.status, 'RUNTIME_LOCK_LOST');
    report.lockLoss = 'PASS_ACTUAL_BACKEND_TERMINATION_STOPS_PROCESS_AND_PERSISTS_FENCE';
    await assert.rejects(resume(runtimeFile, 'wrong-operation-id'));
    await resume(runtimeFile, saved.operationId);
    report.resume = 'PASS_EXPLICIT_SOURCE_RELEASE_ONLY';
    report.backupPin = saved.backupPin;
    report.profilePin = c.profilePin;
    report.status = 'PASS';
    await saveJson(
      join(
        evidence,
        process.env.ZHIBAN_VERIFY_PLAIN_PG === '1'
          ? 'latest-plain-local.json'
          : 'latest-local.json',
      ),
      report,
    );
    return report;
  } catch (e) {
    if (browser) {
      const pages = browser.contexts().flatMap((c) => c.pages());
      for (let i = 0; i < pages.length; i++) {
        await pages[i]
          .screenshot({ path: p('failure-page-' + i + '.png'), fullPage: true })
          .catch(() => {});
        await writeFile(
          p('failure-page-' + i + '.txt'),
          pages[i].url() +
            '\n' +
            (await pages[i]
              .locator('body')
              .innerText()
              .catch(() => '')),
          { mode: 0o600 },
        );
      }
    }
    await writeFile(p('operations-error.txt'), String((e as Error).stack ?? e), { mode: 0o600 });
    throw e;
  } finally {
    await backupPending?.catch(() => {});
    await browser?.close();
    for (const job of allChildren) {
      if (job.exitCode === null) {
        job.kill('SIGTERM');
        await exited(job).catch(() => {
          job.kill('SIGKILL');
        });
      }
    }
    if (release) {
      await chmod(release, 0o700);
      await unlink(join(release, 'node_modules')).catch(() => {});
      await ownTree(release, process.getuid!(), process.getgid!());
      await rm(release, { recursive: true, force: true });
    }
  }
}
async function writePrivate(path: string, value: string) {
  await writeFile(path, value, { mode: 0o600, flag: 'wx' });
  return path;
}
async function rewriteCredential(source: string, database: string, target: string) {
  const raw = (await readFile(source, 'utf8')).trim().slice('DATABASE_URL='.length),
    u = new URL(raw);
  u.pathname = '/' + database;
  return writePrivate(target, 'DATABASE_URL=' + u.toString() + '\n');
}
async function readonlyDirs(root: string) {
  for (const e of await readdir(root, { withFileTypes: true }))
    if (e.isDirectory()) await readonlyDirs(join(root, e.name));
  await chmod(root, 0o555);
}
