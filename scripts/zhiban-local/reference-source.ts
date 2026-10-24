/** Relocation of a LOCAL reference's source name; hash and live profile stay independently checked. */
import { posix } from 'node:path';
export function referenceSourceHash(hashes: Record<string, string>, relative: string): string {
  if (
    !relative ||
    relative === '.' ||
    posix.isAbsolute(relative) ||
    posix.normalize(relative) !== relative ||
    relative.startsWith('../')
  )
    throw Error('Reference source name rejected');
  const matches = Object.entries(hashes).filter(
    ([name]) =>
      name === relative ||
      (posix.isAbsolute(name) && posix.normalize(name) === name && name.endsWith('/' + relative)),
  );
  // Never select the first of conflicting old/current keys, even if hashes happen to agree.
  if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0][1]))
    throw Error('Reference source identity ambiguous or missing');
  return matches[0][1];
}

/** Every dependency must share the uniquely identified reference checkout; read current files only. */
export function referenceSourceEntries(
  hashes: Record<string, string>,
  anchor: string,
): [string, string][] {
  referenceSourceHash(hashes, anchor);
  const name = Object.keys(hashes).find(
    (name) =>
      name === anchor ||
      (posix.isAbsolute(name) && posix.normalize(name) === name && name.endsWith('/' + anchor)),
  )!;
  const prefix = name.slice(0, -anchor.length);
  return Object.entries(hashes).map(([name, hash]) => {
    if (!name.startsWith(prefix)) throw Error('Reference dependency checkout mismatch');
    const relative = name.slice(prefix.length);
    if (
      !relative ||
      relative === '.' ||
      posix.isAbsolute(relative) ||
      posix.normalize(relative) !== relative ||
      relative.startsWith('../') ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw Error('Reference dependency name/hash rejected');
    return [relative, hash];
  });
}
