/** Fresh three-database install/verify protocol. Runtime never imports migration executors. */
import { join } from 'node:path';
import { createPrivateKey, createPublicKey, verify, X509Certificate } from 'node:crypto';
import { Pool } from 'pg';
import { isIP } from 'node:net';
import { verifyInstalledSchema } from '@/lib/persistence/installed-schema';
import { verifyNativeSchemaState } from '../openmaic/schema-state';
import { connectedPool, type ConnectionInput } from './connection';
import { approvedProfile, databaseProfile, businessLedger, type SourceProfile } from './profile';
import { check, digest, privateBytes, privateJson, privateDirectory } from './files';
import type { IdentityCompositionConfig } from '../identity/composition/root';
import type { ControlApprovalPolicy } from './control-approvals';
export const runtimeRoles = {
  auth: 'zhiban_auth_runtime',
  tenant: 'zhiban_runtime',
  control: 'zhiban_control_runtime',
  business: 'zhiban_academic_runtime',
  bridge: 'zhiban_bridge_runtime',
  native: 'zhiban_openmaic_runtime',
  worker: 'zhiban_autograde_worker',
  authoring: 'zhiban_authoring_runtime',
} as const;
export const installRoles = {
  business: 'zhiban_migrator',
  content: 'zhiban_openmaic_migrator',
  authoring: 'zhiban_authoring_migrator',
} as const;
export const deploymentLock = 76813001;
export interface RuntimeInput {
  kind: 'ZHIBAN_RUNTIME_INPUT_V1';
  instanceId: string;
  origin: string;
  address: string;
  port: number;
  stateDirectory: string;
  profileFile: string;
  profilePin: string;
  receiptAuthority: { publicKey: string; spkiSha256: string };
  tls: { certificateFile: string; privateKeyFile: string; serverName?: string };
  trustedProxy?: { address: '127.0.0.1'; tokenFile: string };
  databases: { business: string; content: string; authoring: string };
  connections: Record<keyof typeof runtimeRoles, ConnectionInput>;
  identity: Omit<IdentityCompositionConfig, 'admission' | 'operator' | 'membership'> & {
    operator: null;
    admission: Omit<IdentityCompositionConfig['admission'], 'hmacKey'> & { hmacKey: string };
    membership: NonNullable<IdentityCompositionConfig['membership']> extends infer T
      ? Omit<T & object, 'operator'> & { operator: null }
      : never;
  };
  membershipAuthority?: ControlApprovalPolicy;
  scanner?: { profileFile: string; pin: string };
  serviceEnvironment?: { file: string; pin: string; files: Readonly<Record<string, string>> };
}
export interface InstallInput {
  kind: 'ZHIBAN_FRESH_INSTALL_INPUT_V1';
  runtimeFile: string;
  migrations: Record<keyof typeof installRoles, ConnectionInput>;
  receiptPrivateKeyFile: string;
  admissionPolicies: import('../identity/composition/admission').AdmissionPolicyRecord[];
  firstAdministrator: {
    policy: import('./platform-approvals').PlatformApprovalPolicy;
    reference: string;
    passwordFile: string;
  };
}
export interface ReadyReceipt {
  kind: 'ZHIBAN_INSTALLATION_RECEIPT_V1';
  instanceId: string;
  status: 'READY';
  profilePin: string;
  runtimeBinding: string;
  deploymentId: string;
  firstAdministrator: { userId: string; grantId: string };
  issuedAt: string;
  activationProof?: string;
  restoredFrom?: { backupPin: string; instanceId: string; deploymentId: string };
}
export async function loadRuntime(path: string) {
  const raw = await privateBytes(path),
    c = JSON.parse(raw.toString()) as RuntimeInput;
  check(
    c.kind === 'ZHIBAN_RUNTIME_INPUT_V1' && /^[0-9a-f-]{36}$/.test(c.instanceId),
    'Runtime input rejected',
  );
  const url = new URL(c.origin);
  check(
    ['https:', 'http:'].includes(url.protocol) &&
      url.origin === c.origin &&
      !url.username &&
      !url.password,
    'Canonical HTTP or HTTPS origin required',
  );
  check(
    ['127.0.0.1', '0.0.0.0', '::1', '::'].includes(c.address) &&
      Number.isInteger(c.port) &&
      c.port > 1023 &&
      c.port < 65536,
    'Explicit unprivileged listen endpoint required',
  );
  check(
    Object.keys(c.connections).sort().join(',') === Object.keys(runtimeRoles).sort().join(','),
    'Exact runtime connection set required',
  );
  check(
    new Set(Object.values(c.databases)).size === 3 &&
      Object.values(c.databases).every((n) => /^zhiban_[a-z0-9_]{1,50}$/.test(n)),
    'Three distinct dedicated databases required',
  );
  check(
    c.identity.origin === c.origin &&
      c.identity.deployment ===
        (url.protocol === 'https:' ? 'SINGLE_PROCESS_HTTPS' : 'SINGLE_PROCESS_HTTP') &&
      (url.protocol === 'https:' || (!!c.trustedProxy && !!c.tls.serverName)) &&
      c.identity.operator === null &&
      c.identity.membership?.operator === null &&
      /^[a-f0-9]{64}$/.test(c.identity.admission.hmacKey),
    'Explicit production identity input required',
  );
  const hashes: Record<string, string> = {};
  const include = async (p: string) => {
    hashes[p] = digest(await privateBytes(p));
  };
  await include(c.tls.certificateFile);
  await include(c.tls.privateKeyFile);
  const leaf = new X509Certificate(await privateBytes(c.tls.certificateFile));
  check(
    leaf.checkPrivateKey(createPrivateKey(await privateBytes(c.tls.privateKeyFile))),
    'HTTPS certificate/key mismatch',
  );
  check(
    isIP(c.tls.serverName ?? url.hostname)
      ? leaf.checkIP(c.tls.serverName ?? url.hostname) !== undefined
      : leaf.checkHost(c.tls.serverName ?? url.hostname) !== undefined,
    'HTTPS certificate hostname mismatch',
  );
  check(
    Date.parse(leaf.validTo) > Date.now() && Date.parse(leaf.validFrom) <= Date.now(),
    'HTTPS certificate expired/not yet valid',
  );
  if (c.tls.serverName)
    check(
      c.trustedProxy && c.address === '127.0.0.1' && c.trustedProxy.address === '127.0.0.1',
      'Internal TLS requires explicit loopback proxy',
    );
  if (c.trustedProxy) {
    check(
      c.address === '127.0.0.1' && c.trustedProxy.address === '127.0.0.1',
      'Proxy must be explicit loopback',
    );
    await include(c.trustedProxy.tokenFile);
    check(
      /^[a-f0-9]{64}$/.test((await privateBytes(c.trustedProxy.tokenFile)).toString().trim()),
      'Proxy token rejected',
    );
  }
  for (const [key, role] of Object.entries(runtimeRoles)) {
    const x = c.connections[key as keyof typeof runtimeRoles];
    const db =
      c.databases[key === 'native' ? 'content' : key === 'authoring' ? 'authoring' : 'business'];
    check(x.role === role && x.database === db, 'Runtime role/database mismatch');
    check(
      x.host === c.connections.auth.host && x.port === c.connections.auth.port,
      'One explicit PG18 instance required',
    );
    await include(x.credentialFile);
    if (x.caFile) await include(x.caFile);
  }
  if (c.serviceEnvironment) {
    await include(c.serviceEnvironment.file);
    check(
      hashes[c.serviceEnvironment.file] === c.serviceEnvironment.pin,
      'Service environment pin rejected',
    );
    for (const [file, pin] of Object.entries(c.serviceEnvironment.files)) {
      await include(file);
      check(hashes[file] === pin, 'Service dependency pin rejected');
    }
  }
  const profile = await approvedProfile(c.profileFile, c.profilePin);
  const publicKey = createPublicKey(c.receiptAuthority.publicKey);
  check(
    publicKey.asymmetricKeyType === 'ed25519' &&
      digest(publicKey.export({ type: 'spki', format: 'der' })) === c.receiptAuthority.spkiSha256,
    'Receipt authority pin rejected',
  );
  check(
    !c.membershipAuthority ||
      c.membershipAuthority.environment === c.identity.admission.environment,
    'Membership authority environment mismatch',
  );
  return {
    config: c,
    profile,
    binding: digest(JSON.stringify({ raw: digest(raw), hashes })),
    publicKey,
  };
}
export async function runtimePools(c: RuntimeInput) {
  const out = {} as Record<keyof typeof runtimeRoles, Pool>;
  try {
    for (const key of Object.keys(runtimeRoles) as Array<keyof typeof runtimeRoles>)
      out[key] = await connectedPool(c.connections[key]);
    return out;
  } catch (e) {
    await Promise.all(Object.values(out).map((p) => p.end()));
    throw e;
  }
}
export async function verifyDatabaseSet(
  c: RuntimeInput,
  p: SourceProfile,
  pools: Record<keyof typeof runtimeRoles, Pool>,
  phase: 'empty' | 'installed',
) {
  for (const [key, pool] of [
    ['business', pools.control],
    ['content', pools.native],
    ['authoring', pools.authoring],
  ] as const)
    check(
      (await databaseProfile(pool)) === p[phase][key],
      'Database ' + key + ' ' + phase + ' profile rejected',
    );
  if (phase === 'installed') {
    check(
      (await businessLedger(pools.control)) === p.businessLedger,
      'Business migration ledger rejected',
    );
    const native = await pools.native.connect();
    try {
      await native.query('SET search_path=pg_catalog,public,pg_temp');
      await verifyNativeSchemaState(native);
    } finally {
      native.release(true);
    }
    await verifyInstalledSchema(pools.authoring, {
      ...p.authoring,
      database: c.databases.authoring,
    });
  }
}
export async function verifiedInstallation(runtimeFile: string, stateOwnerUid?: number) {
  const x = await loadRuntime(runtimeFile),
    c = x.config;
  await privateDirectory(c.stateDirectory, false, stateOwnerUid);
  const journal = await privateJson<{
    kind: string;
    instanceId: string;
    status: string;
    binding: string;
  }>(join(c.stateDirectory, 'INSTALLATION.json'), stateOwnerUid);
  check(
    journal.kind === 'ZHIBAN_INSTALLATION_JOURNAL_V1' &&
      journal.instanceId === c.instanceId &&
      journal.status === 'READY' &&
      journal.binding === x.binding,
    'Incomplete/foreign installation is quarantined',
  );
  const envelope = await privateJson<{ body: ReadyReceipt; signature: string }>(
    join(c.stateDirectory, 'RECEIPT.json'),
    stateOwnerUid,
  );
  check(
    Object.keys(envelope).sort().join(',') === 'body,signature' &&
      verify(
        null,
        Buffer.from(JSON.stringify(envelope.body)),
        x.publicKey,
        Buffer.from(envelope.signature, 'base64'),
      ),
    'Installation receipt signature rejected',
  );
  const r = envelope.body;
  check(
    r.kind === 'ZHIBAN_INSTALLATION_RECEIPT_V1' &&
      r.status === 'READY' &&
      r.instanceId === c.instanceId &&
      r.profilePin === c.profilePin &&
      r.runtimeBinding === x.binding,
    'Installation receipt binding rejected',
  );
  const pools = await runtimePools(c);
  try {
    await verifyDatabaseSet(c, x.profile, pools, 'installed');
    return { ...x, receipt: r, pools };
  } catch (e) {
    await Promise.all(Object.values(pools).map((p) => p.end()));
    throw e;
  }
}
