/** Deliberate operator entry: no automatic environment discovery, fixture data or remote dispatch. */
import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import {
  verifiedInstallation,
  type RuntimeInput,
} from '@/lib/zhiban/infrastructure/production/deployment';
import {
  privateJson,
  privateBytes,
  saveJson,
  check,
  digest,
} from '@/lib/zhiban/infrastructure/production/files';
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'assets') {
    const { buildProductionAssets } = await import('./production-assets');
    await buildProductionAssets();
    console.log('Production assets built');
  } else if (action === 'build-host') {
    const { buildHost } = await import('./production-host-build');
    console.log(JSON.stringify(await buildHost()));
  } else if (action === 'source-profile') {
    check(
      args.length >= 1 && args.length <= 3,
      'Use source-profile NEW_OUTPUT [DATABASE_OWNER GRANTOR]',
    );
    const { buildProductionSourceProfile } = await import('./production-source');
    console.log(
      JSON.stringify(
        await buildProductionSourceProfile(
          resolve(args[0]),
          args[1] || 'postgres',
          args[2] || 'postgres',
        ),
      ),
    );
  } else if (action === 'plan') {
    check(args.length === 1, 'Use plan INSTALL_INPUT');
    const { installationPlan } = await import('@/lib/zhiban/infrastructure/production/install');
    const x = await installationPlan(resolve(args[0]));
    console.log(
      JSON.stringify(
        {
          kind: x.plan.kind,
          instanceId: x.plan.instanceId,
          origin: x.plan.origin,
          databases: x.plan.databases,
          profilePin: x.plan.profilePin,
          planSha256: x.plan.planSha256,
          preparation: x.plan.preparation,
          executesDdl: false,
        },
        null,
        2,
      ),
    );
  } else if (action === 'setup-plan') {
    check(args.length === 1, 'Use setup-plan SETUP_INPUT');
    const { setupPlan } = await import('@/lib/zhiban/infrastructure/production/setup');
    const x = await setupPlan(resolve(args[0]));
    console.log(
      JSON.stringify(
        {
          kind: x.plan.kind,
          instanceId: x.plan.instanceId,
          origin: x.plan.origin,
          databases: x.plan.databases,
          profilePin: x.plan.profilePin,
          steps: x.plan.steps,
          createsDatabases: x.input.preparation?.createDatabases ?? false,
          dropsOrResetsExistingData: false,
          planSha256: x.plan.planSha256,
          executesDdl: false,
        },
        null,
        2,
      ),
    );
  } else if (action === 'setup') {
    check(args.length === 2, 'Use setup SETUP_INPUT REVIEWED_SETUP_PLAN_SHA256');
    const { setup } = await import('@/lib/zhiban/infrastructure/production/setup');
    console.log(JSON.stringify(await setup(resolve(args[0]), args[1])));
  } else if (action === 'install') {
    check(args.length === 2, 'Use install INSTALL_INPUT REVIEWED_PLAN_SHA256');
    const { installFresh } = await import('@/lib/zhiban/infrastructure/production/install');
    console.log(JSON.stringify(await installFresh(resolve(args[0]), args[1])));
  } else if (
    [
      'backup',
      'restore-plan',
      'restore',
      'activate-restored',
      'resume',
      'handoff',
      'bind-systemd',
      'backup-verify',
    ].includes(action)
  ) {
    const p = await import('@/lib/zhiban/infrastructure/production/operations');
    const absolute = args.map((s, i) => (i === 0 ? resolve(s) : s));
    if (action === 'backup') {
      check(args.length === 2, 'Use backup OPERATIONS_INPUT NEW_PRIVATE_DIRECTORY');
      console.log(JSON.stringify(await p.backup(absolute[0], resolve(args[1]))));
    } else if (action === 'restore-plan') {
      check(args.length === 1, 'Use restore-plan RESTORE_INPUT');
      const x = await p.restorePlan(absolute[0]);
      console.log(
        JSON.stringify({
          kind: x.plan.kind,
          instanceId: x.plan.instanceId,
          databases: x.plan.databases,
          backupPin: x.plan.backupPin,
          planSha256: x.plan.planSha256,
          executesDdl: false,
        }),
      );
    } else if (action === 'restore') {
      check(args.length === 2, 'Use restore RESTORE_INPUT REVIEWED_PIN');
      console.log(JSON.stringify(await p.restore(absolute[0], args[1])));
    } else if (action === 'activate-restored') {
      check(args.length === 2, 'Use activate-restored OPERATIONS_INPUT BACKUP_PIN');
      console.log(JSON.stringify(await p.activateRestored(absolute[0], args[1])));
    } else if (action === 'resume') {
      check(args.length === 2, 'Use resume OPERATIONS_INPUT OPERATION_ID');
      const o = await privateJson<
        import('@/lib/zhiban/infrastructure/production/operations').OperationsInput
      >(absolute[0]);
      console.log(JSON.stringify(await p.resume(o.runtimeFile, args[1], o.serviceUid)));
    } else if (action === 'bind-systemd') {
      check(args.length === 2, 'Use bind-systemd OPERATIONS_INPUT PRIVATE_UNIT_BINDING');
      console.log(JSON.stringify(await p.bindSystemd(absolute[0], resolve(args[1]))));
    } else if (action === 'handoff') {
      check(args.length === 1, 'Use handoff OPERATIONS_INPUT');
      console.log(JSON.stringify(await p.handoff(absolute[0])));
    } else {
      check(args.length === 3, 'Use backup-verify DIRECTORY PIN PRIVATE_AUTHORITY_JSON');
      const a = await privateJson<
        import('@/lib/zhiban/infrastructure/production/operations').RestoreInput['backupAuthority']
      >(resolve(args[2]));
      await p.verifyBackup(absolute[0], args[1], a);
      console.log('BACKUP_VERIFIED');
    }
  } else if (action === 'host-ready' || action === 'host-stop') {
    check(args.length === 1, 'Use ' + action + ' RUNTIME_INPUT');
    const c = await privateJson<RuntimeInput>(resolve(args[0]));
    const { hostRequest } = await import('@/lib/zhiban/infrastructure/production/maintenance');
    console.log(
      JSON.stringify(
        await hostRequest(c.stateDirectory, action === 'host-ready' ? 'ready' : 'stop'),
      ),
    );
  } else if (action === 'render-ubuntu') {
    check(args.length === 2, 'Use render-ubuntu HOST_SPEC NEW_PRIVATE_OUTPUT');
    const { renderUbuntu } = await import('./production-ubuntu');
    console.log(JSON.stringify(await renderUbuntu(resolve(args[0]), resolve(args[1]))));
  } else if (action === 'inspect') {
    check(args.length === 1, 'Use inspect RUNTIME_INPUT');
    const c = await privateJson<RuntimeInput>(resolve(args[0]));
    console.log(
      JSON.stringify(await privateJson(join(c.stateDirectory, 'INSTALLATION.json')), null, 2),
    );
  } else if (action === 'verify') {
    check(args.length === 1, 'Use verify RUNTIME_INPUT');
    const x = await verifiedInstallation(resolve(args[0]));
    try {
      console.log(
        JSON.stringify({
          status: 'VERIFIED',
          instanceId: x.config.instanceId,
          origin: x.config.origin,
          profilePin: x.config.profilePin,
        }),
      );
    } finally {
      await Promise.all(Object.values(x.pools).map((p) => p.end()));
    }
  } else if (action === 'start') {
    check(args.length === 1, 'Use start RUNTIME_INPUT');
    const { runHost } = await import('./production-host');
    await runHost(resolve(args[0]));
  } else if (['identity-proposal', 'first-admin-proposal', 'control-proposal'].includes(action)) {
    check(args.length === 2, 'Use ' + action + ' REVIEWED_SPEC NEW_PRIVATE_OUTPUT');
    const p = await import('./production-proposals');
    await (
      action === 'identity-proposal'
        ? p.identityProposal
        : action === 'first-admin-proposal'
          ? p.firstAdministratorProposal
          : p.digestControlProposal
    )(resolve(args[0]), resolve(args[1]));
    console.log('Unsigned proposal written; independent review and signatures are still required');
  } else if (action === 'sign-manifest') {
    check(args.length === 3, 'Use sign-manifest MANIFEST PRIVATE_KEY NEW_SIGNATURE_OUTPUT');
    const manifest = await privateJson(resolve(args[0])),
      key = createPrivateKey(await privateBytes(resolve(args[1])));
    check(key.asymmetricKeyType === 'ed25519', 'Ed25519 signer required');
    const signature = sign(null, Buffer.from(JSON.stringify(manifest)), key).toString('base64');
    await saveJson(
      resolve(args[2]),
      {
        signature,
        spkiSha256: digest(createPublicKey(key).export({ type: 'spki', format: 'der' })),
      },
      true,
    );
    console.log('Signature written to the private output file');
  } else if (action === 'envelope') {
    check(
      args.length === 4,
      'Use envelope MANIFEST OPERATOR_SIGNATURE APPROVER_SIGNATURE NEW_OUTPUT',
    );
    const manifest = await privateJson<Record<string, unknown>>(resolve(args[0])),
      a = await privateJson<{ signature: string; spkiSha256: string }>(resolve(args[1])),
      b = await privateJson<{ signature: string; spkiSha256: string }>(resolve(args[2]));
    check(a.spkiSha256 !== b.spkiSha256, 'Independent signer keys required');
    await saveJson(
      resolve(args[3]),
      {
        kind:
          manifest.purpose === 'FIRST_PLATFORM_ADMIN'
            ? 'ZHIBAN_PLATFORM_APPROVAL_V1'
            : 'ZHIBAN_CONTROL_APPROVAL_V1',
        manifest,
        operatorSignature: a.signature,
        approverSignature: b.signature,
      },
      true,
    );
    console.log('Private approval envelope written');
  } else
    throw Error(
      'Use assets | identity-proposal | first-admin-proposal | control-proposal | source-profile | setup-plan | setup | plan | install | inspect | verify | start | sign-manifest | envelope',
    );
}
void main().catch(async (error) => {
  if (process.env.ZHIBAN_PRODUCTION_PRIVATE_DIAGNOSTIC)
    await writeFile(
      resolve(process.env.ZHIBAN_PRODUCTION_PRIVATE_DIAGNOSTIC),
      String(error.stack ?? error),
      { mode: 0o600 },
    ).catch(() => {});
  const reason =
    typeof error.message === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/.test(error.message)
      ? error.message
      : typeof error.code === 'string' && /^[A-Z0-9_]{2,64}$/.test(error.code)
        ? error.code
        : 'OPERATION_REJECTED';
  console.error(JSON.stringify({ status: 'REJECTED', code: reason }));
  console.error(
    'Retain private inputs and inspect the journal; private diagnostics can be enabled explicitly.',
  );
  process.exitCode = 1;
});
