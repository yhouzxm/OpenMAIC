import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdentityCompositionConfig } from '@/lib/zhiban/infrastructure/identity/composition/root';
import type { IdentityHttpManifest } from '@/lib/zhiban/infrastructure/identity/http/root';

// Intentionally fixed: no production DSN or test-cluster override.
export const directory = join(homedir(), '.local/share/zhiban-m1');
export const database = 'zhiban_m1_dev';
export const pgPort = 55433;
export const origin = 'https://127.0.0.1:3443';
export const pgBin = '/usr/lib/postgresql/16/bin';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type StoredRuntime = {
  mode: 'LOCAL_SYNTHETIC_M1';
  manifest: IdentityHttpManifest;
  composition: Omit<IdentityCompositionConfig, 'admission'> & {
    admission: Omit<IdentityCompositionConfig['admission'], 'hmacKey'> & { hmacKey: string };
  };
  secrets: Record<string, string>;
};
export async function privateFile(name: string) {
  // Only TLS delivery is portable. The old M1 cluster/runtime cannot be redirected.
  const tlsDirectory = process.env.ZHIBAN_LOCAL_TLS_DIRECTORY;
  const base =
    tlsDirectory &&
    ['localhost.crt', 'localhost.key', 'development-ca.crt', 'receipt.json'].includes(name)
      ? tlsDirectory
      : directory;
  if (resolve(base) !== base) throw Error('Absolute LOCAL TLS directory required');
  for (const path of [base, join(base, name)]) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
      throw new Error('Local M1 files require owner-only permissions and no symlinks.');
  }
  return readFile(join(base, name));
}
export async function requirePrivateClusterDirectories() {
  for (const name of ['pgdata', 'socket']) {
    const stat = await lstat(join(directory, name));
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error('Local cluster directory rejected.');
  }
}
export async function trustedDevelopmentCa() {
  const receipt = JSON.parse((await privateFile('receipt.json')).toString());
  if (!receipt.caCertificateHash) return privateFile('localhost.crt');
  const authority = await privateFile('development-ca.crt');
  if (digest(authority.toString()) !== receipt.caCertificateHash)
    throw new Error('Local CA checksum rejected.');
  return authority;
}
export async function loadRuntime() {
  const raw = await privateFile('runtime.json');
  const receipt = JSON.parse((await privateFile('receipt.json')).toString());
  const stored = JSON.parse(raw.toString()) as StoredRuntime;
  if (
    receipt.mode !== 'LOCAL_SYNTHETIC_M1' ||
    receipt.runtimeHash !== digest(raw.toString()) ||
    stored.mode !== 'LOCAL_SYNTHETIC_M1' ||
    stored.manifest.policy.origin !== origin ||
    stored.composition.origin !== origin ||
    stored.manifest.endpoint.hostname !== '127.0.0.1' ||
    stored.manifest.endpoint.port !== pgPort ||
    stored.manifest.endpoint.database !== database ||
    stored.composition.operator !== null ||
    stored.composition.membership !== null ||
    !/^[0-9a-f]{64}$/.test(stored.composition.admission.hmacKey)
  )
    throw new Error('Local M1 manifest rejected.');
  for (const [ref, value] of Object.entries(stored.secrets)) {
    if (!ref.startsWith('LOCAL_M1_') || !value.startsWith('postgresql://'))
      throw new Error('Local M1 secret reference rejected.');
  }
  return {
    ...stored,
    composition: {
      ...stored.composition,
      admission: {
        ...stored.composition.admission,
        hmacKey: Buffer.from(stored.composition.admission.hmacKey, 'hex'),
      },
    } satisfies IdentityCompositionConfig,
  };
}
