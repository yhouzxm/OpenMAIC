/** Explicit production root. Verifies installed state, then composes only runtime pools/services. */
import { noMaintenance } from './maintenance';
import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parseEnv } from 'node:util';
import { verifiedInstallation, deploymentLock, verifyDatabaseSet } from './deployment';
import { connection, boundedFactory } from './connection';
import { check, privateBytes, saveJson } from './files';
import { configureInstalledSchema } from '@/lib/persistence/installed-schema';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import {
  configureEventNotifyClientFactory,
  AGENT_EVENT_NOTIFY_APPLICATION_NAME,
} from '@/lib/server/agent-runtime/event-notify-bus';
import { instanceKey } from '@/lib/server/secret-box';
import { loadClamAv } from '../learning-files/scanner/clamav';
import { signedControlApprovals } from './control-approvals';
import { assembleApplication } from './application';
import { serveApplication } from './http';
import { catalogFingerprint, official } from '../openmaic/catalog';
import { verifyNativeSchemaState } from '../openmaic/schema-state';
export async function startInstalled(runtimeFile: string) {
  check(process.getuid?.() !== 0, 'Formal host requires a non-root service user');
  check(!process.env.DATABASE_URL, 'Formal root refuses inherited DATABASE_URL');
  const x = await verifiedInstallation(runtimeFile),
    { config: c, pools } = x;
  let lock: import('pg').PoolClient | undefined,
    application: Awaited<ReturnType<typeof assembleApplication>> | undefined,
    http: Awaited<ReturnType<typeof serveApplication>> | undefined,
    providerPool: import('pg').Pool | undefined;
  let signalFailure!: () => void;
  const failure = new Promise<void>((r) => (signalFailure = r));
  let lockLost = false;
  try {
    lock = await pools.control.connect();
    lock.on('error', () => {
      lockLost = true;
      console.warn('HOST_LIFECYCLE_LOCK_LOST');
      http?.server.closeAllConnections();
      void saveJson(
        join(c.stateDirectory, 'MAINTENANCE.json'),
        {
          kind: 'ZHIBAN_MAINTENANCE_V1',
          operationId: globalThis.crypto.randomUUID(),
          instanceId: c.instanceId,
          binding: x.binding,
          status: 'RUNTIME_LOCK_LOST',
        },
        true,
      )
        .catch(() => {})
        .finally(signalFailure);
    });
    check(
      (await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [deploymentLock])).rows[0].ok,
      'Another runtime/installer holds this deployment',
    );
    await noMaintenance(c.stateDirectory);
    // Recheck while holding the same lifetime lock used by the installer.
    await verifyDatabaseSet(c, x.profile, pools, 'installed');
    const initial = (
      await lock.query(
        "SELECT target_user_id,system_admin_grant_id,credential_provision_id,completed_at FROM zhiban_identity.identity_platform_bootstrap WHERE singleton_key='PLATFORM'",
      )
    ).rows[0];
    check(
      initial?.target_user_id === x.receipt.firstAdministrator.userId &&
        initial?.system_admin_grant_id === x.receipt.firstAdministrator.grantId &&
        initial.completed_at !== null,
      'First administrator initialization incomplete',
    );
    const consumed = (
      await lock.query(
        'SELECT consumed_at FROM zhiban_identity.identity_credential_provisions WHERE approval_id=$1',
        [initial.credential_provision_id],
      )
    ).rows[0];
    check(
      consumed?.consumed_at !== null && consumed?.consumed_at !== undefined,
      'First password not provisioned',
    );
    const native = await pools.native.connect();
    let fp: string;
    try {
      await native.query('BEGIN READ ONLY');
      await native.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
      await verifyNativeSchemaState(native);
      fp = await catalogFingerprint(native, 'public');
      await native.query('COMMIT');
    } finally {
      native.release(true);
    }
    const deployment = (
      await pools.bridge.query(
        'SELECT official_sha,storage_version,dsl_version,renderer_version,provisioning_digest,state FROM zhiban_bridge.deployment_registry WHERE deployment_id=$1',
        [x.receipt.deploymentId],
      )
    ).rows[0];
    check(
      deployment?.state === 'VERIFIED' &&
        deployment.provisioning_digest === fp! &&
        deployment.official_sha === official.sha &&
        deployment.storage_version === official.storage &&
        deployment.dsl_version === official.dsl &&
        deployment.renderer_version === official.renderer,
      'Content deployment binding rejected',
    );
    configureInstalledSchema({ ...x.profile.authoring, database: c.databases.authoring });
    const authoringOptions = await connection(c.connections.authoring);
    const rawUrl = parseEnv(
      (await privateBytes(c.connections.authoring.credentialFile)).toString(),
    ).DATABASE_URL;
    check(rawUrl, 'Authoring URL missing');
    const base = new URL(rawUrl);
    // This URL is private process state only. Explicit factory and LISTEN transport
    // retain identical CA+hostname verification rather than accepting URL TLS overrides.
    const authoringUrl = base.toString();
    const provider = await getServerPersistenceProvider(
      authoringUrl,
      boundedFactory(authoringOptions, authoringUrl),
    );
    providerPool = provider.pool;
    configureEventNotifyClientFactory((url) => {
      check(url === authoringUrl, 'LISTEN endpoint substitution rejected');
      return new Client({
        ...authoringOptions,
        application_name: AGENT_EVENT_NOTIFY_APPLICATION_NAME,
        connectionTimeoutMillis: 10000,
      });
    });
    const materialRoot = join(c.stateDirectory, 'data', 'native-materials');
    await mkdir(materialRoot, { recursive: true, mode: 0o700 });
    const scanner = c.scanner ? await loadClamAv(c.scanner.profileFile, c.scanner.pin) : null;
    const membership = c.identity.membership;
    application = await assembleApplication({
      origin: c.origin,
      identity: {
        ...c.identity,
        operator: null,
        admission: {
          ...c.identity.admission,
          hmacKey: Buffer.from(c.identity.admission.hmacKey, 'hex'),
        },
        membership: {
          ...membership,
          operator: c.membershipAuthority ? signedControlApprovals(c.membershipAuthority) : null,
        },
      },
      pools,
      authoringUrl,
      materialRoot,
      deploymentId: x.receipt.deploymentId,
      teacherFingerprint: x.profile.teacherFingerprint,
      contentBundle: join(process.cwd(), 'app/zhiban/local/content-client.js'),
      contentCsp: JSON.parse(await readFile('docs/v2/evidence/m5-png-csp-profile.json', 'utf8'))
        .policy,
      scanner,
      observe: (code) => {
        if (/^[A-Z0-9_]{1,80}$/.test(code)) console.warn(code);
      },
    });
    instanceKey();
    await noMaintenance(c.stateDirectory);
    let checkedAt = 0,
      healthy = false,
      pending: Promise<boolean> | undefined;
    const health = async () => {
      if (lockLost) return false;
      if (Date.now() - checkedAt < 2000) return healthy;
      return (pending ??= (async () => {
        try {
          await noMaintenance(c.stateDirectory);
          await Promise.all(
            [pools.control, pools.native, pools.authoring].map((p) => p.query('SELECT 1')),
          );
          healthy = true;
        } catch {
          healthy = false;
        }
        checkedAt = Date.now();
        pending = undefined;
        return healthy;
      })());
    };
    check(!lockLost, 'HOST_LIFECYCLE_LOCK_LOST');
    http = await serveApplication({
      origin: c.origin,
      address: c.address,
      port: c.port,
      key: await privateBytes(c.tls.privateKeyFile),
      certificate: await privateBytes(c.tls.certificateFile),
      handlers: application.handlers,
      health,
      admit: async () => {
        try {
          if (lockLost) return false;
          await noMaintenance(c.stateDirectory);
          return true;
        } catch {
          return false;
        }
      },
      proxy: c.trustedProxy
        ? {
            address: c.trustedProxy.address,
            token: (await privateBytes(c.trustedProxy.tokenFile)).toString().trim(),
          }
        : undefined,
    });
    let closed = false;
    return {
      origin: c.origin,
      health,
      failure,
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await http!.close();
          await application!.close();
        } finally {
          lock?.release(true);
          await Promise.all(Object.values(pools).map((p) => p.end()));
        }
      },
    };
  } catch (e) {
    await http?.close().catch(() => {});
    await application?.close().catch(() => {});
    if (!application) await providerPool?.end().catch(() => {});
    lock?.release(true);
    await Promise.all(Object.values(pools).map((p) => p.end()));
    throw e;
  }
}
