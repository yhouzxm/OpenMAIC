/** Two independent named signers; verification only. No issuer or private key in the host. */
import { constants, openSync, readFileSync, fstatSync, closeSync, lstatSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  platformManifestDigest,
  type PlatformApproval,
  type OperatorApprovalStore,
} from '../identity/composition/operator';
interface Signer {
  publicKey: string;
  spkiSha256: string;
  reference: string;
}
export interface PlatformApprovalPolicy {
  directory: string;
  environment: string;
  operator: Signer;
  approver: Signer;
  /** Explicitly approved manifest digests, not discovered from directory contents. */
  manifests: Readonly<Record<string, string>>;
}
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export function signedPlatformApprovals(input: PlatformApprovalPolicy): OperatorApprovalStore {
  const p = structuredClone(input);
  if (
    !isAbsolute(p.directory) ||
    resolve(p.directory) !== p.directory ||
    p.operator.reference === p.approver.reference
  )
    throw Error('Platform authority policy rejected');
  const keys = [p.operator, p.approver].map((s) => {
    const k = createPublicKey(s.publicKey);
    if (
      k.asymmetricKeyType !== 'ed25519' ||
      hash(k.export({ type: 'spki', format: 'der' })) !== s.spkiSha256
    )
      throw Error('Platform authority pin rejected');
    return k;
  });
  if (p.operator.spkiSha256 === p.approver.spkiSha256)
    throw Error('Independent platform authorities required');
  return Object.freeze({
    async load(reference: string) {
      if (
        !/^[a-zA-Z0-9_-]{1,96}$/.test(reference) ||
        !/^[a-f0-9]{64}$/.test(p.manifests[reference] ?? '')
      )
        throw Error('Unapproved platform manifest');
      let parent = '/';
      for (const part of p.directory.split('/').filter(Boolean)) {
        parent = join(parent, part);
        if (lstatSync(parent).isSymbolicLink()) throw Error('Platform authority path rejected');
      }
      const dir = lstatSync(p.directory);
      if (!dir.isDirectory() || dir.uid !== process.getuid?.() || dir.mode & 0o077)
        throw Error('Private platform approval directory required');
      const fd = openSync(
        join(p.directory, reference + '.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let bytes: Buffer;
      try {
        const before = fstatSync(fd);
        if (
          !before.isFile() ||
          before.uid !== process.getuid?.() ||
          before.mode & 0o077 ||
          before.nlink !== 1 ||
          before.size > 32768
        )
          throw Error('Private platform approval file required');
        bytes = readFileSync(fd);
        const after = fstatSync(fd);
        if (
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs
        )
          throw Error('Platform approval changed');
      } finally {
        closeSync(fd);
      }
      const e = JSON.parse(bytes.toString());
      if (
        Object.keys(e).sort().join(',') !== 'approverSignature,kind,manifest,operatorSignature' ||
        e.kind !== 'ZHIBAN_PLATFORM_APPROVAL_V1'
      )
        throw Error('Platform envelope rejected');
      const m = e.manifest as PlatformApproval,
        body = Buffer.from(JSON.stringify(m));
      if (
        m.purpose !== 'FIRST_PLATFORM_ADMIN' ||
        m.environment !== p.environment ||
        m.approvalRef !== reference ||
        m.operatorRef !== p.operator.reference ||
        m.approverRef !== p.approver.reference ||
        m.existingUserRevision !== null ||
        platformManifestDigest(m) !== m.manifestDigest ||
        m.manifestDigest !== p.manifests[reference]
      )
        throw Error('Platform manifest binding rejected');
      if (
        !verify(null, body, keys[0], Buffer.from(e.operatorSignature, 'base64')) ||
        !verify(null, body, keys[1], Buffer.from(e.approverSignature, 'base64'))
      )
        throw Error('Platform manifest signature rejected');
      if (Date.now() < m.issuedAt || Date.now() >= m.expiresAt)
        throw Error('Platform manifest expired');
      return Object.freeze({ ...m });
    },
  });
}
