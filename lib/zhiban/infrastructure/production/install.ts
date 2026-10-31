import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { privateJson, privateBytes, privateDirectory, saveJson, check, digest } from './files';
import {
  loadRuntime,
  runtimePools,
  verifyDatabaseSet,
  installRoles,
  deploymentLock,
  type InstallInput,
  type ReadyReceipt,
} from './deployment';
import { connectedPool } from './connection';
import { installFreshBusinessSchema } from './business-schema';
import { installAuthoringSchema } from './authoring-schema';
import { provisionNative } from '../openmaic/provision';
import { official } from '../openmaic/catalog';
import { signedPlatformApprovals } from './platform-approvals';
import { installFirstPlatformAdmin } from './first-admin';
import { createIdentityComposition } from '../identity/composition/root';
import { admissionPolicyDigest } from '../identity/composition/admission';
export async function installationPlan(path: string) {
  const input = await privateJson<InstallInput>(path);
  check(input.kind === 'ZHIBAN_FRESH_INSTALL_INPUT_V1', 'Fresh install input required');
  const x = await loadRuntime(input.runtimeFile),
    c = x.config;
  check(
    Object.keys(input.migrations).sort().join(',') === Object.keys(installRoles).sort().join(','),
    'Exact migration connection set required',
  );
  const hashes: Record<string, string> = {};
  for (const [key, role] of Object.entries(installRoles)) {
    const q = input.migrations[key as keyof typeof installRoles];
    check(
      q.role === role &&
        q.database === c.databases[key as keyof typeof c.databases] &&
        q.host === c.connections.auth.host &&
        q.port === c.connections.auth.port,
      'Migration endpoint mismatch',
    );
    hashes[q.credentialFile] = digest(await privateBytes(q.credentialFile));
    if (q.caFile) hashes[q.caFile] = digest(await privateBytes(q.caFile));
  }
  const privateKey = createPrivateKey(await privateBytes(input.receiptPrivateKeyFile));
  check(
    privateKey.asymmetricKeyType === 'ed25519' &&
      digest(createPublicKey(privateKey).export({ type: 'spki', format: 'der' })) ===
        c.receiptAuthority.spkiSha256,
    'Receipt signing key mismatch',
  );
  hashes[input.receiptPrivateKeyFile] = digest(await privateBytes(input.receiptPrivateKeyFile));
  check(
    ![
      input.firstAdministrator.policy.operator.spkiSha256,
      input.firstAdministrator.policy.approver.spkiSha256,
    ].includes(c.receiptAuthority.spkiSha256),
    'Receipt issuer must be distinct from both approving authorities',
  );
  const authority = signedPlatformApprovals(input.firstAdministrator.policy);
  check(
    input.firstAdministrator.policy.environment === c.identity.admission.environment,
    'Platform approval environment mismatch',
  );
  const approval = await authority.load(input.firstAdministrator.reference);
  check(
    approval && approval.existingUserRevision === null,
    'Fresh first administrator approval required',
  );
  hashes[input.firstAdministrator.passwordFile] = digest(
    await privateBytes(input.firstAdministrator.passwordFile),
  );
  check(
    input.admissionPolicies.length === 4 &&
      new Set(input.admissionPolicies.map((p) => p.purpose)).size === 4,
    'Four explicit admission policies required',
  );
  for (const p of input.admissionPolicies)
    check(
      p.environment_ref === c.identity.admission.environment &&
        p.approval_ref === c.identity.admission.approvalRef &&
        admissionPolicyDigest(p) === c.identity.admission.policyDigests[p.purpose],
      'Admission policy approval rejected',
    );
  const facts = {
    kind: 'ZHIBAN_FRESH_INSTALL_PLAN_V1',
    instanceId: c.instanceId,
    origin: c.origin,
    databases: c.databases,
    profilePin: c.profilePin,
    runtimeBinding: x.binding,
    inputHash: digest(await privateBytes(path)),
    privateInputHashes: hashes,
    firstApprovalDigest: approval.manifestDigest,
    preparation: 'REQUIRES_PREPROVISIONED_EXACT_EMPTY_DATABASES_AND_ROLES',
  };
  return {
    input,
    runtime: x,
    approval,
    privateKey,
    plan: { ...facts, planSha256: digest(JSON.stringify(facts)) },
  };
}
export async function installFresh(
  path: string,
  approvedPlan: string,
  preparation?: { planSha256: string; run: () => Promise<void> },
) {
  const planned = await installationPlan(path),
    { input, runtime: x } = planned,
    c = x.config;
  check(planned.plan.planSha256 === approvedPlan, 'Reviewed installation plan pin required');
  await privateDirectory(c.stateDirectory, true);
  const operation = join(c.stateDirectory, '.operation-lock');
  await mkdir(operation, { mode: 0o700 });
  let pools = {} as Awaited<ReturnType<typeof runtimePools>>;
  const migrations = {} as Record<keyof typeof installRoles, Pool>;
  let phase = 'PRECHECK',
    complete = false;
  const completed: string[] = [];
  const state = () => ({
    kind: 'ZHIBAN_INSTALLATION_JOURNAL_V1',
    instanceId: c.instanceId,
    status: complete ? 'READY' : 'INSTALLING',
    phase,
    completed: [...completed],
    binding: x.binding,
    planSha256: approvedPlan,
    ...(preparation ? { preparationPlanSha256: preparation.planSha256 } : {}),
  });
  let lock: import('pg').PoolClient | undefined;
  try {
    await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), state(), true);
    if (preparation) {
      phase = 'PREPARE_DATABASES';
      await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), state());
      await preparation.run();
      completed.push(phase);
      phase = 'PRECHECK';
      await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), state());
    }
    pools = await runtimePools(c);
    lock = await pools.control.connect();
    check(
      (await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [deploymentLock])).rows[0].ok,
      'Another installer/runtime holds the deployment lock',
    );
    await verifyDatabaseSet(c, x.profile, pools, 'empty');
    for (const key of Object.keys(installRoles) as Array<keyof typeof installRoles>)
      migrations[key] = await connectedPool(input.migrations[key]);
    const enter = async (p: string) => {
      phase = p;
      await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), state());
    };
    await enter('BUSINESS_SCHEMA');
    await installFreshBusinessSchema(migrations.business);
    completed.push(phase);
    await enter('CONTENT_SCHEMA');
    await provisionNative(migrations.content, c.databases.content, 'EXPLICIT_FRESH_INSTALLATION');
    completed.push(phase);
    await enter('AUTHORING_SCHEMA');
    const a = await migrations.authoring.connect();
    try {
      await a.query('SET ROLE zhiban_authoring_owner');
      await a.query('SET search_path=public,pg_catalog');
      const observed = await installAuthoringSchema(a);
      check(
        JSON.stringify({ ...observed, database: x.profile.authoring.database }) ===
          JSON.stringify(x.profile.authoring),
        'Authoring source profile mismatch',
      );
    } finally {
      a.release(true);
    }
    completed.push(phase);
    await verifyDatabaseSet(c, x.profile, pools, 'installed');
    await enter('ADMISSION_POLICIES');
    const b = await migrations.business.connect();
    try {
      await b.query('BEGIN');
      await b.query('SET LOCAL ROLE zhiban_identity_owner');
      for (const p of input.admissionPolicies) {
        const d = admissionPolicyDigest(p);
        await b.query(
          'INSERT INTO zhiban_identity.admission_policies(purpose,policy_digest,approval_ref,environment_ref,created_at,window_ms,global_limit,ip_limit,locator_limit,pair_limit,user_limit,max_buckets) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            p.purpose,
            d,
            p.approval_ref,
            p.environment_ref,
            p.created_at,
            p.window_ms,
            p.global_limit,
            p.ip_limit,
            p.locator_limit,
            p.pair_limit,
            p.user_limit,
            p.max_buckets,
          ],
        );
        await b.query('INSERT INTO zhiban_identity.admission_gate(purpose) VALUES($1)', [
          p.purpose,
        ]);
      }
      await b.query('COMMIT');
    } catch (e) {
      await b.query('ROLLBACK');
      throw e;
    } finally {
      b.release(true);
    }
    completed.push(phase);
    await enter('FIRST_ADMINISTRATOR');
    const identity = await createIdentityComposition(
      { auth: pools.auth, tenant: pools.tenant, control: pools.control },
      {
        ...c.identity,
        operator: signedPlatformApprovals(input.firstAdministrator.policy),
        admission: {
          ...c.identity.admission,
          hmacKey: Buffer.from(c.identity.admission.hmacKey, 'hex'),
        },
      },
    );
    const password = (await privateBytes(input.firstAdministrator.passwordFile))
      .toString()
      .replace(/\r?\n$/, '');
    const administrator = await installFirstPlatformAdmin(
      identity,
      input.firstAdministrator.reference,
      password,
    );
    completed.push(phase);
    await enter('DEPLOYMENT_BINDING');
    const deploymentId = v7(),
      client = await migrations.business.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE zhiban_identity_owner');
      const nativeFingerprint = (await import('../openmaic/catalog')).catalogFingerprint;
      const nc = await pools.native.connect();
      let fp: string;
      try {
        await nc.query('SET search_path=pg_catalog,public,pg_temp');
        fp = await nativeFingerprint(nc, 'public');
      } finally {
        nc.release(true);
      }
      await client.query(
        'INSERT INTO zhiban_bridge.deployment_registry VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9)',
        [
          deploymentId,
          'EXPLICIT_FRESH_INSTALLATION',
          official.sha,
          official.storage,
          official.dsl,
          official.renderer,
          fp!,
          'VERIFIED',
          Date.now(),
        ],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release(true);
    }
    completed.push(phase);
    check(
      (await installationPlan(path)).plan.planSha256 === approvedPlan,
      'Installation inputs changed',
    );
    await verifyDatabaseSet(c, x.profile, pools, 'installed');
    const receipt: ReadyReceipt = {
      kind: 'ZHIBAN_INSTALLATION_RECEIPT_V1',
      instanceId: c.instanceId,
      status: 'READY',
      profilePin: c.profilePin,
      runtimeBinding: x.binding,
      deploymentId,
      firstAdministrator: administrator,
      issuedAt: new Date().toISOString(),
    };
    await saveJson(
      join(c.stateDirectory, 'RECEIPT.json'),
      {
        body: receipt,
        signature: sign(null, Buffer.from(JSON.stringify(receipt)), planned.privateKey).toString(
          'base64',
        ),
      },
      true,
    );
    phase = 'READY';
    complete = true;
    await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), state());
    return { status: 'READY', instanceId: c.instanceId, firstAdministrator: administrator };
  } catch (e) {
    await saveJson(join(c.stateDirectory, 'INSTALLATION.json'), {
      ...state(),
      status: 'FAILED',
    }).catch(() => {});
    throw e;
  } finally {
    lock?.release(true);
    await Promise.all([...Object.values(pools), ...Object.values(migrations)].map((p) => p.end()));
    await rm(operation, { recursive: true });
  }
}
