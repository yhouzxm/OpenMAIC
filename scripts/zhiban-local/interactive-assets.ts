import { INTERACTIVE_LIBRARIES } from '../../packages/@openmaic/generation/src/interactive-libraries';
/** Only versioned public library files copied by the upstream allowlist are served. */
export function interactiveVendorAsset(pathname: string) {
  const prefix = '/vendor/interactive/';
  if (!pathname.startsWith(prefix)) return null;
  const path = pathname.slice(prefix.length);
  if (
    !/^[a-zA-Z0-9@_.\/-]+$/.test(path) ||
    path.split('/').some((x) => !x || x === '.' || x === '..')
  )
    return null;
  const library = INTERACTIVE_LIBRARIES.find((l) => path.startsWith(`${l.package}@${l.version}/`));
  if (!library) return null;
  const relative = path.slice(`${library.package}@${library.version}/`.length);
  if (
    ![...library.files, library.license].some(
      (file) => relative === file || relative.startsWith(file + '/'),
    )
  )
    return null;
  const ext = path.split('.').pop();
  const type =
    (
      {
        js: 'text/javascript',
        css: 'text/css',
        woff2: 'font/woff2',
        woff: 'font/woff',
        ttf: 'font/ttf',
        json: 'application/json',
      } as Record<string, string>
    )[ext ?? ''] ?? 'text/plain';
  return { path, type };
}
