import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { directory, digest, loadRuntime, privateFile } from './config';

async function main() {
  await loadRuntime();
  const toolDirectory = join(directory, 'tools/extracted/usr/bin');
  const env = {
    ...process.env,
    PATH: `${toolDirectory}:${process.env.PATH}`,
    CAROOT: join(directory, 'ca'),
    TRUST_STORES: 'nss',
  };
  await mkdir(env.CAROOT, { mode: 0o700, recursive: true });
  const stat = await lstat(env.CAROOT);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error('Private CA directory rejected.');
  // Explicit developer command: trust the LOCAL CA in this user's NSS store only.
  // Never install into the system trust store, ask for sudo, or disable TLS validation.
  execFileSync('mkcert', ['-install'], { env, stdio: 'pipe' });
  const backup = join(directory, `certificate-backup-${Date.now()}`);
  await mkdir(backup, { mode: 0o700 });
  for (const name of ['localhost.crt', 'localhost.key', 'receipt.json'])
    await writeFile(join(backup, name), await privateFile(name), { mode: 0o600, flag: 'wx' });
  execFileSync(
    'mkcert',
    ['-cert-file', join(backup, 'new.crt'), '-key-file', join(backup, 'new.key'), '127.0.0.1'],
    { env, stdio: 'pipe' },
  );
  const certificate = await readFile(join(backup, 'new.crt'));
  const key = await readFile(join(backup, 'new.key'));
  const authority = await readFile(join(env.CAROOT, 'rootCA.pem'));
  const leaf = new X509Certificate(certificate);
  if (!leaf.checkIP('127.0.0.1') || !leaf.verify(new X509Certificate(authority).publicKey))
    throw new Error('Development certificate verification failed.');
  const receipt = JSON.parse((await privateFile('receipt.json')).toString());
  receipt.certificateHash = digest(certificate.toString());
  receipt.caCertificateHash = digest(authority.toString());
  receipt.certificateTrust = 'LOCAL_USER_NSS_MKCERT';
  receipt.certificateExpiresAt = leaf.validTo;
  for (const [name, data] of [
    ['development-ca.crt', authority],
    ['localhost.key', key],
    ['localhost.crt', certificate],
    ['receipt.json', Buffer.from(JSON.stringify(receipt, null, 2) + '\n')],
  ] as const) {
    const temporary = join(directory, `${name}.new`);
    await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(directory, name));
  }
  await chmod(join(backup, 'new.crt'), 0o600);
  await chmod(join(backup, 'new.key'), 0o600);
  console.log(
    `LOCAL development certificate prepared; user NSS trust installed. Backup: ${backup}`,
  );
  console.log(
    'Restart dev:zhiban. If needed, fully restart Codex to reload its certificate trust store.',
  );
}
void main().catch(() => {
  console.error(
    'Local certificate preparation failed; inspect installed mkcert/certutil and private directory.',
  );
  process.exitCode = 1;
});
