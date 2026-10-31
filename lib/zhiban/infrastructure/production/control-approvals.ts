/** Named two-person approvals for existing frozen control commands. No signer in runtime. */
import { createPublicKey, verify } from 'node:crypto';
import { join } from 'node:path';
import type { PlatformApprovalPolicy } from './platform-approvals';
import type {
  MembershipOperatorApprovalStore,
  ControlApprovalManifest,
} from '../identity/composition/control-approval';
import { controlManifestDigest } from '../identity/composition/control-approval';
import { privateBytes, privateDirectory, digest, check } from './files';
export type ControlApprovalPolicy = Omit<PlatformApprovalPolicy, 'manifests'>;
export function signedControlApprovals(
  value: ControlApprovalPolicy,
): MembershipOperatorApprovalStore {
  const p = structuredClone(value);
  check(
    p.operator.reference !== p.approver.reference &&
      p.operator.spkiSha256 !== p.approver.spkiSha256,
    'Independent control authorities required',
  );
  const keys = [p.operator, p.approver].map((s) => {
    const k = createPublicKey(s.publicKey);
    check(
      k.asymmetricKeyType === 'ed25519' &&
        digest(k.export({ type: 'spki', format: 'der' })) === s.spkiSha256,
      'Control authority pin rejected',
    );
    return k;
  });
  return {
    async load(reference: string) {
      check(/^[a-zA-Z0-9_-]{1,96}$/.test(reference), 'Control approval reference rejected');
      await privateDirectory(p.directory);
      const e = JSON.parse((await privateBytes(join(p.directory, reference + '.json'))).toString());
      check(
        e.kind === 'ZHIBAN_CONTROL_APPROVAL_V1' &&
          Object.keys(e).sort().join(',') === 'approverSignature,kind,manifest,operatorSignature',
        'Control approval envelope rejected',
      );
      const m = e.manifest as ControlApprovalManifest,
        bytes = Buffer.from(JSON.stringify(m));
      check(
        m.environment_ref === p.environment &&
          m.approval_ref === reference &&
          m.operator_ref === p.operator.reference &&
          m.approver_ref === p.approver.reference &&
          controlManifestDigest(m) === m.manifest_digest,
        'Control approval binding rejected',
      );
      check(
        verify(null, bytes, keys[0], Buffer.from(e.operatorSignature, 'base64')) &&
          verify(null, bytes, keys[1], Buffer.from(e.approverSignature, 'base64')),
        'Control approval signatures rejected',
      );
      // Full TTL/catalog/action/scope/revision validation remains in frozen ControlCommands.
      check(
        Number(m.issued_at) <= Date.now() && Number(m.expires_at) > Date.now(),
        'Control approval expired',
      );
      return Object.freeze({ ...m });
    },
  };
}
