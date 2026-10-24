import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { directory, loadRuntime, requirePrivateClusterDirectories } from './config';
import { readContentConfiguration, validateContentInstallation } from './content-receipt';
import {
  ContentInspector,
  type InspectionScope,
} from '@/lib/zhiban/infrastructure/content/inspection';
import { InspectionBudget } from './inspection-budget';
import { canonical, hash, id } from '@/lib/zhiban/infrastructure/content/model';
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!['list', 'inspect'].includes(action) || args.length % 2)
    throw new Error(
      'Use list --tenant UUID --offering UUID [--after UUID] [--limit 1..20], or inspect --tenant UUID --offering UUID --resource UUID --operation UUID',
    );
  const flags: Record<string, string> = {};
  const allowed =
    action === 'list'
      ? ['tenant', 'offering', 'after', 'limit']
      : ['tenant', 'offering', 'resource', 'operation'];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !allowed.includes(key) || Object.hasOwn(flags, key))
      throw new Error('Closed inspection arguments required');
    flags[key] = args[i + 1];
  }
  for (const key of action === 'list' ? ['tenant', 'offering'] : allowed) id(flags[key]);
  if (flags.after) id(flags.after);
  if (flags.limit && !/^(?:[1-9]|1[0-9]|20)$/.test(flags.limit))
    throw new Error('Limit must be 1..20');
  const budget = new InspectionBudget();
  await budget.wait(() => loadRuntime());
  await budget.wait(() => requirePrivateClusterDirectories());
  const { config, receipt } = await budget.wait(() => readContentConfiguration());
  const bridgePool = new Pool({
      connectionString: config.bridge,
      max: 1,
      allowExitOnIdle: true,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 10000,
      query_timeout: 5500,
    }),
    nativePool = new Pool({
      connectionString: config.native,
      max: 1,
      allowExitOnIdle: true,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 10000,
      query_timeout: 5500,
    });
  for (const pool of [bridgePool, nativePool]) pool.on('error', () => budget.abort());
  const bridge = budget.pool(bridgePool),
    native = budget.pool(nativePool);
  try {
    await budget.wait(() => validateContentInstallation(bridge, native, receipt, config));
    const uid = process.getuid?.();
    if (!Number.isSafeInteger(uid)) throw new Error('Owned local Unix profile required');
    const authority = {
      kind: 'LOCAL_SERVICE_INSPECTION' as const,
      purpose: 'CONTENT_PENDING_READ_ONLY' as const,
      serviceRef: 'local_m5_readonly_inspector',
      uid: uid!,
      implementationBindingHash: receipt.bindingHash,
      installationReceiptSha256: hash(canonical(receipt)),
      deploymentId: config.deploymentId,
    };
    const inspector = new ContentInspector(bridge, native, authority);
    const result =
      action === 'list'
        ? {
            formatVersion: 1,
            evidenceOrigin: 'LOCAL',
            kind: 'M5_PENDING_READ_ONLY_LIST',
            authority,
            scope: { tenant: flags.tenant, offering: flags.offering },
            at: new Date().toISOString(),
            ...(await budget.wait(() =>
              inspector.list(
                flags.tenant,
                flags.offering,
                flags.after ?? null,
                Number(flags.limit ?? 10),
              ),
            )),
            fenceAction: 'KEEP',
            settlementAllowed: false,
          }
        : await budget.wait(() => inspector.inspect(flags as InspectionScope));
    // Recheck installation/source binding before issuing any local report.
    await budget.wait(() => validateContentInstallation(bridge, native, receipt, config));
    const output = join(directory, `m5-inspection-${v7()}.json`),
      reportSha256 = hash(canonical(result));
    const writing = writeFile(
      output,
      JSON.stringify({ report: result, reportSha256 }, null, 2) + '\n',
      {
        mode: 0o600,
        flag: 'wx',
      },
    );
    try {
      await budget.wait(() => writing);
      budget.assert();
    } catch (error) {
      // Also remove a late successful write: an expired run never issues a report.
      void writing.then(
        () => unlink(output).catch(() => {}),
        () => unlink(output).catch(() => {}),
      );
      throw error;
    }
    console.log(
      JSON.stringify({
        evidenceOrigin: 'LOCAL',
        action,
        output,
        reportSha256,
        fenceAction: 'KEEP',
        settlementAllowed: false,
      }),
    );
  } finally {
    budget.abort();
    // Active clients are destroyed. Idle sockets are unref'ed; cleanup gets its own cap.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([bridgePool.end(), nativePool.end()]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
void main().catch(() => {
  console.error(
    'LOCAL read-only inspection rejected; verify exact scope, receipt and private environment. No settlement was performed.',
  );
  process.exitCode = 1;
});
