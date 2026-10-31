import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
/** Explicit stopped-host three-database backup and restore; no remote discovery. */
import { join, isAbsolute, dirname } from 'node:path';
import { mkdir, readFile, copyFile, chmod, rm, lstat, readdir } from 'node:fs/promises';
import { createPrivateKey, createPublicKey, verify, sign, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { v7 } from 'uuid';
import { privateJson, privateBytes, privateDirectory, saveJson, check, digest } from './files';
import {
  loadRuntime,
  verifiedInstallation,
  runtimePools,
  verifyDatabaseSet,
  installRoles,
  deploymentLock,
  type RuntimeInput,
  type ReadyReceipt,
} from './deployment';
import { connection, type ConnectionInput } from './connection';
import { fenceFile, hostRequest, noMaintenance } from './maintenance';
import {
  fileTree,
  copyTree,
  verifyTree,
  relativeFile,
  ownTree,
  durableFile,
  type FileFacts,
} from './backup-files';
import {
  maintenancePool,
  keys,
  lockWrites,
  dataInventory,
  pgTool,
  type DatabaseKey,
} from './backup-database';
import { catalogFingerprint, official } from '../openmaic/catalog';
export interface OperationsInput {
  kind: 'ZHIBAN_OPERATIONS_INPUT_V1';
  runtimeFile: string;
  serviceUid: number;
  serviceGid: number;
  pgBin: string;
  connections: Record<DatabaseKey, ConnectionInput>;
  receiptPrivateKeyFile: string;
  systemd?: {
    unit: 'zhiban.service';
    unitFile: '/etc/systemd/system/zhiban.service';
    unitSha256: string;
  };
  migrations?: Record<DatabaseKey, ConnectionInput>;
  additionalPrivateFiles?: Readonly<Record<string, string>>;
}
export interface RestoreInput {
  kind: 'ZHIBAN_RESTORE_INPUT_V1';
  operationsFile: string;
  backupDirectory: string;
  backupPin: string;
  backupAuthority: { publicKey: string; spkiSha256: string };
}
type BackupBody = {
  kind: 'ZHIBAN_CONSISTENT_BACKUP_V1';
  status: 'COMPLETE';
  consistency: 'STOPPED_HOST_AND_THREE_DATABASE_SHARE_LOCKS';
  instanceId: string;
  deploymentId: string;
  profilePin: string;
  runtimeBinding: string;
  createdAt: string;
  sourceRuntime: string;
  sourceReceipt: string;
  files: FileFacts;
  privateFiles: Record<string, string>;
  inventories: Record<DatabaseKey, Awaited<ReturnType<typeof dataInventory>>>;
  firstAdministrator: ReadyReceipt['firstAdministrator'];
};
async function opsInput(path: string) {
  const o = await privateJson<OperationsInput>(path);
  check(
    o.kind === 'ZHIBAN_OPERATIONS_INPUT_V1' &&
      Number.isInteger(o.serviceUid) &&
      o.serviceUid > 0 &&
      Number.isInteger(o.serviceGid) &&
      o.serviceGid > 0 &&
      isAbsolute(o.pgBin),
    'OPERATIONS_INPUT_REJECTED',
  );
  check(
    process.getuid?.() === 0 || process.getuid?.() === o.serviceUid,
    'OPERATIONS_OWNER_REJECTED',
  );
  const x = await loadRuntime(o.runtimeFile);
  check(
    Object.keys(o.connections).sort().join(',') === 'authoring,business,content',
    'OPERATIONS_CONNECTION_SET_REJECTED',
  );
  for (const k of keys) {
    const c = o.connections[k];
    check(
      c.database === x.config.databases[k] &&
        (c.role === installRoles[k] || c.role === x.profile.grantor) &&
        c.host === x.config.connections.auth.host &&
        c.port === x.config.connections.auth.port,
      'OPERATIONS_ENDPOINT_REJECTED',
    );
    await connection(c);
    const probe = await maintenancePool(c);
    try {
      const r = (
        await probe.query(
          "SELECT r.rolsuper OR r.rolbypassrls AS bypass,NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p') AND NOT has_table_privilege(current_user,c.oid,'SELECT')) AS read_all FROM pg_roles r WHERE rolname=current_user",
        )
      ).rows[0];
      check(r?.bypass === true && r.read_all === true, 'MAINTENANCE_FULL_DATA_AUTHORITY_REQUIRED');
    } finally {
      await probe.end();
    }
  }
  if (o.migrations) {
    check(
      Object.keys(o.migrations).sort().join(',') === 'authoring,business,content',
      'RESTORE_MIGRATION_CONNECTION_SET_REQUIRED',
    );
    for (const k of keys) {
      const v = o.migrations[k];
      check(
        v.role === installRoles[k] &&
          v.database === x.config.databases[k] &&
          v.host === x.config.connections.auth.host &&
          v.port === x.config.connections.auth.port,
        'RESTORE_MIGRATION_ENDPOINT_REJECTED',
      );
      await connection(v);
    }
  }
  for (const [path, pin] of Object.entries(o.additionalPrivateFiles ?? {}))
    check(digest(await privateBytes(path)) === pin, 'OPERATIONS_EXTRA_PRIVATE_FILE_PIN_REJECTED');
  if (o.systemd) {
    check(
      o.systemd.unit === 'zhiban.service' &&
        o.systemd.unitFile === '/etc/systemd/system/zhiban.service' &&
        (await (await import('./backup-files')).fileFact(o.systemd.unitFile)).sha256 ===
          o.systemd.unitSha256,
      'OPERATIONS_SYSTEMD_UNIT_REJECTED',
    );
    const show = promisify(execFile);
    check(
      (
        await show(
          '/usr/bin/systemctl',
          ['show', '--property=FragmentPath', '--value', o.systemd.unit],
          { encoding: 'utf8', timeout: 10000 },
        )
      ).stdout.trim() === o.systemd.unitFile,
      'OPERATIONS_SYSTEMD_FRAGMENT_REJECTED',
    );
    check(
      (
        await show(
          '/usr/bin/systemctl',
          ['show', '--property=WorkingDirectory', '--value', o.systemd.unit],
          { encoding: 'utf8', timeout: 10000 },
        )
      ).stdout.trim() === process.cwd(),
      'OPERATIONS_SYSTEMD_RELEASE_REJECTED',
    );
    check(
      (await readFile(o.systemd.unitFile, 'utf8'))
        .split('\n')
        .some((line) => line.startsWith('ExecStart=') && line.endsWith(' ' + o.runtimeFile)),
      'OPERATIONS_SYSTEMD_RUNTIME_REJECTED',
    );
  }
  const key = createPrivateKey(await privateBytes(o.receiptPrivateKeyFile));
  check(
    key.asymmetricKeyType === 'ed25519' &&
      digest(createPublicKey(key).export({ type: 'spki', format: 'der' })) ===
        x.config.receiptAuthority.spkiSha256,
    'OPERATIONS_RECEIPT_KEY_REJECTED',
  );
  return { o, x, key };
}
async function operationLock(state: string) {
  const p = join(state, '.operation-lock');
  await mkdir(p, { mode: 0o700 });
  return () => rm(p, { recursive: true });
}
async function guardDeployment(c: RuntimeInput, onLost: () => void = () => {}) {
  const pool = await runtimePools(c);
  let client: PoolClient | undefined;
  let lost = false;
  try {
    client = await pool.control.connect();
    client.on('error', () => {
      lost = true;
      onLost();
    });
    check(
      (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [deploymentLock])).rows[0].ok,
      'INSTANCE_NOT_STOPPED_OR_OPERATION_ACTIVE',
    );
    return {
      pool,
      client,
      assertAlive: () => check(!lost, 'DEPLOYMENT_GUARD_LOST'),
      close: async () => {
        client?.release(true);
        await Promise.all(Object.values(pool).map((p) => p.end()));
      },
    };
  } catch (e) {
    client?.release(true);
    await Promise.all(Object.values(pool).map((p) => p.end()));
    throw e;
  }
}
export async function backup(operationsFile: string, output: string) {
  const { o, x, key } = await opsInput(operationsFile),
    c = x.config;
  check(
    isAbsolute(output) && !output.startsWith(c.stateDirectory + '/') && output !== c.stateDirectory,
    'BACKUP_OUTPUT_REJECTED',
  );
  await privateDirectory(c.stateDirectory, false, o.serviceUid);
  const release = await operationLock(c.stateDirectory),
    operationId = randomUUID();
  let guard: Awaited<ReturnType<typeof guardDeployment>> | undefined;
  const pools: Pool[] = [],
    clients: PoolClient[] = [];
  const abort = new AbortController();
  try {
    await noMaintenance(c.stateDirectory);
    // Reject a foreign runtime/state pairing before fencing or stopping a live host.
    const preflight = await verifiedInstallation(o.runtimeFile, o.serviceUid);
    await Promise.all(Object.values(preflight.pools).map((p) => p.end()));
    await saveJson(
      join(c.stateDirectory, fenceFile),
      {
        kind: 'ZHIBAN_MAINTENANCE_V1',
        operationId,
        instanceId: c.instanceId,
        binding: x.binding,
        status: 'STOPPING',
      },
      true,
    );
    if (o.systemd) {
      try {
        await promisify(execFile)('/usr/bin/systemctl', ['stop', o.systemd.unit], {
          encoding: 'utf8',
          timeout: 150000,
        });
      } catch {
        throw Error('SYSTEMD_GROUP_STOP_FAILED_INSTANCE_REMAINS_FENCED');
      }
    }
    try {
      await lstat(join(c.stateDirectory, 'HOST.json'));
      await hostRequest(c.stateDirectory, 'stop', o.serviceUid, c.instanceId);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    guard = await guardDeployment(c, () => abort.abort());
    await verifyDatabaseSet(c, x.profile, guard.pool, 'installed');
    // Validate original signed installation even when the service is already stopped.
    const installed = await verifiedInstallation(o.runtimeFile, o.serviceUid);
    await Promise.all(Object.values(installed.pools).map((p) => p.end()));
    if (c.serviceEnvironment) {
      const vars = (await import('node:util')).parseEnv(
        (await privateBytes(c.serviceEnvironment.file)).toString(),
      );
      check(
        !vars.ASSET_S3_BUCKET && !vars.OPENMAIC_SECRET_KEY,
        'EXTERNAL_ASSET_OR_ENV_KEY_BACKUP_REQUIRES_SEPARATE_PROTOCOL',
      );
    }
    await privateDirectory(output, true);
    await saveJson(join(output, 'INCOMPLETE.json'), { operationId, status: 'BACKING_UP' }, true);
    for (const k of keys) {
      const p = await maintenancePool(o.connections[k]);
      pools.push(p);
      const q = await p.connect();
      q.on('error', () => abort.abort());
      clients.push(q);
      await lockWrites(q, k);
    }
    check(!abort.signal.aborted, 'BACKUP_GUARD_LOST');
    await saveJson(join(c.stateDirectory, fenceFile), {
      kind: 'ZHIBAN_MAINTENANCE_V1',
      operationId,
      instanceId: c.instanceId,
      binding: x.binding,
      status: 'FENCED',
    });
    const inventories = {} as BackupBody['inventories'];
    for (let i = 0; i < keys.length; i++) inventories[keys[i]] = await dataInventory(clients[i]);
    for (const k of keys) {
      await pgTool(
        o.pgBin,
        'pg_dump',
        o.connections[k],
        k,
        join(output, k + '.dump'),
        abort.signal,
      );
      await chmod(join(output, k + '.dump'), 0o600);
      await durableFile(join(output, k + '.dump'));
    }
    const sourceData = join(c.stateDirectory, 'data');
    await privateBytes(join(sourceData, 'native-secret', 'instance-secret.key'), o.serviceUid);
    await copyTree(sourceData, join(output, 'data'));
    const paths = new Set<string>([
      o.runtimeFile,
      c.profileFile,
      ...Object.values(c.connections).flatMap((v) => [
        v.credentialFile,
        ...(v.caFile ? [v.caFile] : []),
      ]),
      c.tls.certificateFile,
      c.tls.privateKeyFile,
    ]);
    if (c.trustedProxy) paths.add(c.trustedProxy.tokenFile);
    if (c.serviceEnvironment) {
      paths.add(c.serviceEnvironment.file);
      for (const f of Object.keys(c.serviceEnvironment.files)) paths.add(f);
    }
    if (c.scanner) paths.add(c.scanner.profileFile);
    if (c.membershipAuthority) {
      await privateDirectory(c.membershipAuthority.directory, false, o.serviceUid);
      for (const n of await readdir(c.membershipAuthority.directory)) {
        check(/^[A-Za-z0-9_-]{1,96}\.json$/.test(n), 'CONTROL_APPROVAL_BACKUP_NAME_REJECTED');
        paths.add(join(c.membershipAuthority.directory, n));
      }
    }
    for (const path of Object.keys(o.additionalPrivateFiles ?? {})) paths.add(path);
    const privateFiles: Record<string, string> = {};
    await mkdir(join(output, 'private'), { mode: 0o700 });
    let index = 0;
    for (const path of [...paths].sort()) {
      const rel = 'private/' + String(index++).padStart(4, '0');
      const bytes = await privateBytes(path, o.serviceUid);
      await (
        await import('node:fs/promises')
      ).writeFile(join(output, rel), bytes, { mode: 0o600, flag: 'wx' });
      privateFiles[path] = rel;
    }
    await copyFile(join(c.stateDirectory, 'RECEIPT.json'), join(output, 'source-receipt.json'));
    await chmod(join(output, 'source-receipt.json'), 0o600);
    for (let i = 0; i < keys.length; i++)
      check(
        JSON.stringify(await dataInventory(clients[i])) === JSON.stringify(inventories[keys[i]]),
        'BACKUP_DATABASE_CHANGED',
      );
    check(
      JSON.stringify(await fileTree(sourceData)) ===
        JSON.stringify(await fileTree(join(output, 'data'))),
      'BACKUP_ORIGINALS_CHANGED',
    );
    check(
      (await loadRuntime(o.runtimeFile)).binding === x.binding && !abort.signal.aborted,
      'BACKUP_INPUT_OR_GUARD_CHANGED',
    );
    await rm(join(output, 'INCOMPLETE.json'));
    const files = await fileTree(output);
    const body: BackupBody = {
      kind: 'ZHIBAN_CONSISTENT_BACKUP_V1',
      status: 'COMPLETE',
      consistency: 'STOPPED_HOST_AND_THREE_DATABASE_SHARE_LOCKS',
      instanceId: c.instanceId,
      deploymentId: installed.receipt.deploymentId,
      profilePin: c.profilePin,
      runtimeBinding: x.binding,
      createdAt: new Date().toISOString(),
      sourceRuntime: privateFiles[o.runtimeFile],
      sourceReceipt: 'source-receipt.json',
      files,
      privateFiles,
      inventories,
      firstAdministrator: installed.receipt.firstAdministrator,
    };
    check(!abort.signal.aborted, 'BACKUP_GUARD_LOST');
    await saveJson(
      join(output, 'MANIFEST.json'),
      { body, signature: sign(null, Buffer.from(JSON.stringify(body)), key).toString('base64') },
      true,
    );
    guard.assertAlive();
    const pin = digest(await privateBytes(join(output, 'MANIFEST.json')));
    await saveJson(join(c.stateDirectory, fenceFile), {
      kind: 'ZHIBAN_MAINTENANCE_V1',
      operationId,
      instanceId: c.instanceId,
      binding: x.binding,
      status: 'BACKUP_COMPLETE',
      backupPin: pin,
    });
    return {
      status: 'BACKUP_COMPLETE',
      backupPin: pin,
      operationId,
      source: 'STOPPED_AWAITING_EXPLICIT_RESUME',
    };
  } finally {
    for (const q of clients) {
      await q.query('ROLLBACK').catch(() => {});
      q.release(true);
    }
    await Promise.all(pools.map((p) => p.end()));
    await guard?.close();
    await release();
  }
}
export async function verifyBackup(
  directory: string,
  pin: string,
  authority: RestoreInput['backupAuthority'],
) {
  await privateDirectory(directory);
  const bytes = await privateBytes(join(directory, 'MANIFEST.json'));
  check(digest(bytes) === pin, 'BACKUP_PIN_REJECTED');
  const publicKey = createPublicKey(authority.publicKey);
  check(
    publicKey.asymmetricKeyType === 'ed25519' &&
      digest(publicKey.export({ type: 'spki', format: 'der' })) === authority.spkiSha256,
    'BACKUP_AUTHORITY_REJECTED',
  );
  const envelope = JSON.parse(bytes.toString()) as { body: BackupBody; signature: string };
  check(
    verify(
      null,
      Buffer.from(JSON.stringify(envelope.body)),
      publicKey,
      Buffer.from(envelope.signature, 'base64'),
    ),
    'BACKUP_SIGNATURE_REJECTED',
  );
  const b = envelope.body;
  check(
    b.kind === 'ZHIBAN_CONSISTENT_BACKUP_V1' &&
      b.status === 'COMPLETE' &&
      b.consistency === 'STOPPED_HOST_AND_THREE_DATABASE_SHARE_LOCKS',
    'BACKUP_STATUS_REJECTED',
  );
  await verifyTree(directory, b.files, new Set(['MANIFEST.json']));
  const source = JSON.parse(
    await readFile(join(directory, relativeFile(b.sourceRuntime)), 'utf8'),
  ) as RuntimeInput;
  const receipt = await privateJson<{ body: ReadyReceipt; signature: string }>(
    join(directory, relativeFile(b.sourceReceipt)),
  );
  check(
    digest(
      createPublicKey(source.receiptAuthority.publicKey).export({ type: 'spki', format: 'der' }),
    ) === authority.spkiSha256 &&
      verify(
        null,
        Buffer.from(JSON.stringify(receipt.body)),
        publicKey,
        Buffer.from(receipt.signature, 'base64'),
      ) &&
      receipt.body.kind === 'ZHIBAN_INSTALLATION_RECEIPT_V1' &&
      receipt.body.status === 'READY' &&
      receipt.body.profilePin === b.profilePin &&
      source.profilePin === b.profilePin &&
      source.instanceId === b.instanceId &&
      receipt.body.deploymentId === b.deploymentId &&
      JSON.stringify(receipt.body.firstAdministrator) === JSON.stringify(b.firstAdministrator) &&
      b.files[b.privateFiles[source.profileFile]]?.sha256 === b.profilePin &&
      receipt.body.runtimeBinding === b.runtimeBinding &&
      receipt.body.instanceId === b.instanceId,
    'BACKUP_SOURCE_RECEIPT_REJECTED',
  );
  return { body: b, source, receipt: receipt.body };
}
export async function resume(
  runtimeFile: string,
  operationId: string,
  stateOwnerUid = process.getuid?.(),
) {
  const x = await loadRuntime(runtimeFile),
    c = x.config;
  await privateDirectory(c.stateDirectory, false, stateOwnerUid);
  const release = await operationLock(c.stateDirectory);
  let guard: Awaited<ReturnType<typeof guardDeployment>> | undefined;
  try {
    const f = await privateJson<{
      kind: string;
      operationId: string;
      instanceId: string;
      binding: string;
      status: string;
    }>(join(c.stateDirectory, fenceFile));
    check(
      f.kind === 'ZHIBAN_MAINTENANCE_V1' &&
        f.status !== 'SUPERSEDED' &&
        f.operationId === operationId &&
        f.instanceId === c.instanceId &&
        f.binding === x.binding,
      'MAINTENANCE_RELEASE_REJECTED',
    );
    guard = await guardDeployment(c);
    const v = await verifiedInstallation(runtimeFile, stateOwnerUid);
    await Promise.all(Object.values(v.pools).map((p) => p.end()));
    guard.assertAlive();
    await rm(join(c.stateDirectory, fenceFile));
    return { status: 'RESUMED_START_SEPARATELY', instanceId: c.instanceId };
  } finally {
    await guard?.close();
    await release();
  }
}
export async function restorePlan(path: string) {
  const input = await privateJson<RestoreInput>(path);
  check(input.kind === 'ZHIBAN_RESTORE_INPUT_V1', 'RESTORE_INPUT_REJECTED');
  const a = await opsInput(input.operationsFile),
    b = await verifyBackup(input.backupDirectory, input.backupPin, input.backupAuthority);
  check(a.x.config.instanceId !== b.body.instanceId, 'RESTORE_REQUIRES_NEW_INSTANCE_ID');
  check(
    JSON.stringify({ ...b.source.identity, origin: a.x.config.origin }) ===
      JSON.stringify(a.x.config.identity),
    'RESTORE_IDENTITY_POLICY_CHANGED',
  );
  const oldProfile = JSON.parse(
    await readFile(
      join(input.backupDirectory, relativeFile(b.body.privateFiles[b.source.profileFile])),
      'utf8',
    ),
  ) as import('./profile').SourceProfile;
  const compatible = (p: import('./profile').SourceProfile) =>
    JSON.stringify({
      major: p.major,
      provider: p.provider,
      installed: p.installed,
      authoring: { ...p.authoring, database: 'APPROVED_TARGET_DATABASE' },
      teacherFingerprint: p.teacherFingerprint,
      businessLedger: p.businessLedger,
    });
  check(
    compatible(a.x.profile) === compatible(oldProfile),
    'RESTORE_SCHEMA_OR_PROVIDER_UPGRADE_REQUIRES_MIGRATION',
  );

  check(a.o.migrations, 'RESTORE_SOURCE_SCHEMA_CONNECTIONS_REQUIRED');
  const hashes: Record<string, string> = {};
  for (const v of [...Object.values(a.o.connections), ...Object.values(a.o.migrations!)]) {
    hashes[v.credentialFile] = digest(await privateBytes(v.credentialFile));
    if (v.caFile) hashes[v.caFile] = digest(await privateBytes(v.caFile));
  }
  hashes[a.o.receiptPrivateKeyFile] = digest(await privateBytes(a.o.receiptPrivateKeyFile));
  const facts = {
    kind: 'ZHIBAN_RESTORE_PLAN_V1',
    inputHash: digest(await privateBytes(path)),
    operationsHash: digest(await privateBytes(input.operationsFile)),
    runtimeBinding: a.x.binding,
    backupPin: input.backupPin,
    instanceId: a.x.config.instanceId,
    databases: a.x.config.databases,
    privateInputHashes: hashes,
    sourceInstanceId: b.body.instanceId,
  };
  return { ...a, input, backup: b, plan: { ...facts, planSha256: digest(JSON.stringify(facts)) } };
}
export async function restore(path: string, reviewedPin: string) {
  const p = await restorePlan(path),
    c = p.x.config;
  check(p.plan.planSha256 === reviewedPin, 'RESTORE_REVIEWED_PLAN_REQUIRED');
  await privateDirectory(c.stateDirectory, true);
  const release = await operationLock(c.stateDirectory);
  let guard: Awaited<ReturnType<typeof guardDeployment>> | undefined;
  let phase = 'PRECHECK';
  const state = (status: string) => ({
    kind: 'ZHIBAN_INSTALLATION_JOURNAL_V1',
    instanceId: c.instanceId,
    binding: p.x.binding,
    status,
    phase,
    backupPin: p.input.backupPin,
    planSha256: reviewedPin,
  });
  try {
    await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), state('RESTORING'), true);
    guard = await guardDeployment(c);
    await verifyDatabaseSet(c, p.x.profile, guard.pool, 'empty');
    phase = 'INSTALL_APPROVED_SCHEMA';
    await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), state('RESTORING'));
    await installRestoreSchema(p.o, c);
    await verifyDatabaseSet(c, p.x.profile, guard.pool, 'installed');
    for (const k of keys) {
      await clearNewSchemaSeeds(p.o.connections[k]);
      phase = 'RESTORE_' + k.toUpperCase();
      await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), state('RESTORING'));
      await pgTool(
        p.o.pgBin,
        'pg_restore',
        p.o.connections[k],
        k,
        join(p.input.backupDirectory, k + '.dump'),
        new AbortController().signal,
      );
    }
    await verifyDatabaseSet(c, p.x.profile, guard.pool, 'installed');
    for (const k of keys) {
      const pool = await maintenancePool(p.o.connections[k]),
        q = await pool.connect();
      try {
        await q.query('BEGIN');
        await q.query('SET LOCAL row_security=off');
        check(
          JSON.stringify(await dataInventory(q)) === JSON.stringify(p.backup.body.inventories[k]),
          'RESTORE_DATA_INVENTORY_REJECTED',
        );
        await q.query('COMMIT');
      } finally {
        q.release(true);
        await pool.end();
      }
    }
    await copyTree(join(p.input.backupDirectory, 'data'), join(c.stateDirectory, 'data'));
    await privateBytes(join(c.stateDirectory, 'data/native-secret/instance-secret.key'));
    if (c.membershipAuthority && p.backup.source.membershipAuthority) {
      const dir = c.membershipAuthority.directory;
      await privateDirectory(dir, true);
      for (const [source, rel] of Object.entries(p.backup.body.privateFiles)) {
        if (dirname(source) === p.backup.source.membershipAuthority.directory) {
          const name = source.slice(source.lastIndexOf('/') + 1);
          await copyFile(join(p.input.backupDirectory, relativeFile(rel)), join(dir, name));
          await chmod(join(dir, name), 0o600);
        }
      }
      await ownTree(dir, p.o.serviceUid, p.o.serviceGid);
    }
    phase = 'NEW_DEPLOYMENT_BINDING';
    const deploymentId = v7(),
      pool = await maintenancePool(p.o.connections.business),
      q = await pool.connect();
    try {
      const native = await guard.pool.native.connect();
      let fp: string;
      try {
        await native.query('SET search_path=pg_catalog,public,pg_temp');
        fp = await catalogFingerprint(native, 'public');
      } finally {
        native.release(true);
      }
      await q.query('BEGIN');
      await q.query('SET LOCAL ROLE zhiban_identity_owner');
      await q.query(
        'INSERT INTO zhiban_bridge.deployment_registry VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9)',
        [
          deploymentId,
          'EXPLICIT_RESTORE_ACTIVATION',
          official.sha,
          official.storage,
          official.dsl,
          official.renderer,
          fp!,
          'VERIFIED',
          Date.now(),
        ],
      );
      await q.query('COMMIT');
    } finally {
      q.release(true);
      await pool.end();
    }
    check((await restorePlan(path)).plan.planSha256 === reviewedPin, 'RESTORE_INPUTS_CHANGED');
    await verifyDatabaseSet(c, p.x.profile, guard.pool, 'installed');
    guard.assertAlive();
    const proof = await activationProof(p.o);
    const body: ReadyReceipt = {
      kind: 'ZHIBAN_INSTALLATION_RECEIPT_V1',
      instanceId: c.instanceId,
      status: 'READY',
      profilePin: c.profilePin,
      runtimeBinding: p.x.binding,
      deploymentId,
      firstAdministrator: p.backup.body.firstAdministrator,
      issuedAt: new Date().toISOString(),
      activationProof: proof,
      restoredFrom: {
        backupPin: p.input.backupPin,
        instanceId: p.backup.body.instanceId,
        deploymentId: p.backup.body.deploymentId,
      },
    };
    await saveJson(
      join(c.stateDirectory, 'RECEIPT.json'),
      { body, signature: sign(null, Buffer.from(JSON.stringify(body)), p.key).toString('base64') },
      true,
    );
    phase = 'AWAITING_ACTIVATION';
    await saveJson(
      join(c.stateDirectory, 'INSTALLATION.json'),
      state('RESTORED_AWAITING_ACTIVATION'),
    );
    await ownTree(c.stateDirectory, p.o.serviceUid, p.o.serviceGid);
    return {
      status: 'RESTORED_AWAITING_ACTIVATION',
      instanceId: c.instanceId,
      backupPin: p.input.backupPin,
    };
  } catch (e) {
    await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), state('FAILED')).catch(() => {});
    throw e;
  } finally {
    await guard?.close();
    await release();
  }
}
export async function activateRestored(operationsFile: string, backupPin: string) {
  const { o, x } = await opsInput(operationsFile),
    c = x.config;
  await privateDirectory(c.stateDirectory, false, o.serviceUid);
  const release = await operationLock(c.stateDirectory);
  let guard: Awaited<ReturnType<typeof guardDeployment>> | undefined;
  try {
    const journal = await privateJson<Record<string, unknown>>(
      join(c.stateDirectory, 'INSTALLATION.json'),
      o.serviceUid,
    );
    check(
      journal.status === 'RESTORED_AWAITING_ACTIVATION' &&
        journal.binding === x.binding &&
        journal.backupPin === backupPin,
      'RESTORE_ACTIVATION_STATE_REJECTED',
    );
    const envelope = await privateJson<{ body: ReadyReceipt; signature: string }>(
      join(c.stateDirectory, 'RECEIPT.json'),
      o.serviceUid,
    );
    check(
      verify(
        null,
        Buffer.from(JSON.stringify(envelope.body)),
        x.publicKey,
        Buffer.from(envelope.signature, 'base64'),
      ) &&
        envelope.body.kind === 'ZHIBAN_INSTALLATION_RECEIPT_V1' &&
        envelope.body.status === 'READY' &&
        envelope.body.profilePin === c.profilePin &&
        envelope.body.runtimeBinding === x.binding &&
        envelope.body.instanceId === c.instanceId &&
        envelope.body.restoredFrom?.backupPin === backupPin,
      'RESTORE_RECEIPT_REJECTED',
    );
    await privateBytes(
      join(c.stateDirectory, 'data/native-secret/instance-secret.key'),
      o.serviceUid,
    );
    guard = await guardDeployment(c);
    await verifyDatabaseSet(c, x.profile, guard.pool, 'installed');
    guard.assertAlive();
    check(
      envelope.body.activationProof === (await activationProof(o)),
      'RESTORE_ACTIVATION_DATA_CHANGED',
    );
    await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), {
      ...journal,
      status: 'READY',
      phase: 'READY',
    });
    await ownTree(c.stateDirectory, o.serviceUid, o.serviceGid);
    return { status: 'READY', instanceId: c.instanceId, start: 'EXPLICIT_SEPARATE_ACTION' };
  } finally {
    await guard?.close();
    await release();
  }
}

async function activationProof(o: OperationsInput) {
  const c = await privateJson<RuntimeInput>(o.runtimeFile),
    facts: Record<string, unknown> = {};
  for (const k of keys) {
    const p = await maintenancePool(o.connections[k]),
      q = await p.connect();
    try {
      await q.query('BEGIN');
      await q.query('SET LOCAL row_security=off');
      facts[k] = await dataInventory(q);
    } finally {
      q.release(true);
      await p.end();
    }
  }
  return digest(JSON.stringify({ facts, files: await fileTree(join(c.stateDirectory, 'data')) }));
}

/** Root-only ownership handoff, after signature/catalog verification and with the host stopped. */
export async function handoff(operationsFile: string) {
  check(process.getuid?.() === 0, 'HANDOFF_REQUIRES_ROOT');
  const o = await privateJson<OperationsInput>(operationsFile);
  check(
    o.kind === 'ZHIBAN_OPERATIONS_INPUT_V1' &&
      Number.isInteger(o.serviceUid) &&
      o.serviceUid > 0 &&
      Number.isInteger(o.serviceGid) &&
      o.serviceGid > 0,
    'HANDOFF_SERVICE_OWNER_REQUIRED',
  );
  const x = await loadRuntime(o.runtimeFile),
    c = x.config;
  const st = await lstat(c.stateDirectory);
  check(st.uid === 0 || st.uid === o.serviceUid, 'HANDOFF_STATE_OWNER_REJECTED');
  const guard = await guardDeployment(c);
  try {
    const v = await verifiedInstallation(o.runtimeFile, st.uid);
    await Promise.all(Object.values(v.pools).map((p) => p.end()));
    await ownTree(c.stateDirectory, o.serviceUid, o.serviceGid);
    const paths = new Set([
      o.runtimeFile,
      c.profileFile,
      c.tls.certificateFile,
      c.tls.privateKeyFile,
      ...Object.values(c.connections).flatMap((v) => [
        v.credentialFile,
        ...(v.caFile ? [v.caFile] : []),
      ]),
    ]);
    if (c.serviceEnvironment) {
      paths.add(c.serviceEnvironment.file);
      for (const f of Object.keys(c.serviceEnvironment.files)) paths.add(f);
    }
    if (c.trustedProxy) paths.add(c.trustedProxy.tokenFile);
    if (c.scanner) paths.add(c.scanner.profileFile);
    const configRoot = dirname(o.runtimeFile);
    for (const p of paths)
      check(p.startsWith(configRoot + '/'), 'HANDOFF_CONFIG_OUTSIDE_PRIVATE_ROOT');
    for (const p of paths) {
      await privateBytes(p, o.serviceUid);
      await (await import('node:fs/promises')).chown(p, 0, o.serviceGid);
      await chmod(p, 0o640);
    }
    const dirs = new Set<string>([configRoot]);
    for (const p of paths) {
      let dir = dirname(p);
      while (dir.startsWith(configRoot + '/')) {
        dirs.add(dir);
        dir = dirname(dir);
      }
    }
    for (const dir of dirs) {
      const st = await lstat(dir);
      check(st.isDirectory() && !st.isSymbolicLink(), 'HANDOFF_CONFIG_DIRECTORY_REJECTED');
      await (await import('node:fs/promises')).chown(dir, 0, o.serviceGid);
      await chmod(dir, 0o750);
    }
    if (c.membershipAuthority)
      await ownTree(c.membershipAuthority.directory, o.serviceUid, o.serviceGid);
    return { status: 'HANDED_OFF', serviceUid: o.serviceUid, instanceId: c.instanceId };
  } finally {
    await guard.close();
  }
}

async function installRestoreSchema(o: OperationsInput, c: RuntimeInput) {
  const { connectedPool } = await import('./connection');
  const pools = {} as Record<DatabaseKey, Pool>;
  try {
    for (const k of keys) pools[k] = await connectedPool(o.migrations![k]);
    await (await import('./business-schema')).installFreshBusinessSchema(pools.business);
    await (
      await import('../openmaic/provision')
    ).provisionNative(pools.content, c.databases.content, 'RESTORE_SOURCE_SCHEMA');
    const q = await pools.authoring.connect();
    try {
      await q.query('SET ROLE zhiban_authoring_owner');
      await q.query('SET search_path=public,pg_catalog');
      await (await import('./authoring-schema')).installAuthoringSchema(q);
    } finally {
      q.release(true);
    }
  } finally {
    await Promise.all(Object.values(pools).map((p) => p.end()));
  }
}
/** Only called after all targets proved empty and exact source DDL was installed.
 * Clears schema initializer rows so the original ledger/singletons can be copied intact.
 * No caller supplied table name or existing application database is admitted here. */
async function clearNewSchemaSeeds(input: ConnectionInput) {
  const pool = await maintenancePool(input),
    q = await pool.connect();
  try {
    await q.query('BEGIN');
    const list = await (await import('./backup-database')).tables(q);
    const quote = (n: string) => '"' + n.replaceAll('"', '""') + '"';
    const names = list.map((t) => quote(t.schema) + '.' + quote(t.name));
    for (const n of names) await q.query('ALTER TABLE ' + n + ' DISABLE TRIGGER ALL');
    await q.query('TRUNCATE ' + names.join(',') + ' CASCADE');
    for (const n of names) await q.query('ALTER TABLE ' + n + ' ENABLE TRIGGER ALL');
    await q.query('COMMIT');
  } catch (e) {
    await q.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    q.release(true);
    await pool.end();
  }
}

/** Bind the reviewed installed unit without requiring backup/admin credentials. */
export async function bindSystemd(operationsFile: string, bindingFile: string) {
  check(process.getuid?.() === 0, 'SYSTEMD_BINDING_REQUIRES_ROOT');
  const o = await privateJson<OperationsInput>(operationsFile),
    b = await privateJson<NonNullable<OperationsInput['systemd']>>(bindingFile);
  check(
    o.kind === 'ZHIBAN_OPERATIONS_INPUT_V1' &&
      b.unit === 'zhiban.service' &&
      b.unitFile === '/etc/systemd/system/zhiban.service' &&
      (await (await import('./backup-files')).fileFact(b.unitFile)).sha256 === b.unitSha256,
    'SYSTEMD_BINDING_REJECTED',
  );
  check(
    (await readFile(b.unitFile, 'utf8'))
      .split('\n')
      .some((line) => line.startsWith('ExecStart=') && line.endsWith(' ' + o.runtimeFile)),
    'SYSTEMD_RUNTIME_BINDING_REJECTED',
  );
  await saveJson(operationsFile, { ...o, systemd: b });
  return { status: 'SYSTEMD_BINDING_RECORDED', unit: b.unit };
}
