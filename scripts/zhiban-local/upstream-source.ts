import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function verifyUpstreamPackage(pkg: string) {
  const sourcePaths = [`packages/@openmaic/${pkg}/src`, `packages/@openmaic/${pkg}/package.json`];
  if (pkg === 'generation')
    sourcePaths.push(
      ...['templates', 'snippets', 'prompts-pbl'].map((p) => `packages/@openmaic/generation/${p}`),
    );
  const entries = execFileSync(
    'git',
    ['ls-tree', '-rz', 'e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0', '--', ...sourcePaths],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  // The unchanged quiz extension retains its independently recorded v1.2.0
  // base and hashes. Official source files are checked against v1.2.1 above.
  const extension = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-quiz-extension-source-local.json', 'utf8'),
  ) as { officialSha: string; extensionVersion: string; files: Record<string, string> };
  if (
    extension.officialSha !== 'a9da60b3b4adb429369c0da13d5637a904ead2b0' ||
    extension.extensionVersion !== '0.1.0'
  )
    throw Error('Quiz extension pin rejected');
  for (const [path, digest] of Object.entries(extension.files))
    if (path.startsWith(`packages/@openmaic/${pkg}/`)) {
      const bytes = await readFile(path);
      if (createHash('sha256').update(bytes).digest('hex') !== digest)
        throw Error(`Quiz extension source mismatch: ${path}`);
    }
  const expected = new Set<string>();
  for (const entry of entries) {
    const [metadata, path] = entry.split('\t');
    const object = metadata.split(' ')[2];
    const bytes = await readFile(path);
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (actual !== object && !extension.files[path])
      throw Error(`Upstream source pin mismatch: ${path}`);
    expected.add(path);
  }
  const actualPaths = execFileSync('rg', ['--files', '--hidden', ...sourcePaths], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  if (!entries.length || actualPaths.some((path) => !expected.has(path) && !extension.files[path]))
    throw Error(`Unexpected upstream source files: ${pkg}`);
}
