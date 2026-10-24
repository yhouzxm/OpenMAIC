/** Host-only parser configuration. Never obtained from an HTTP command or exposed to the UI. */
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { getDocumentExtractorProvider } from '@/lib/document/extractors/registry';
import { getMediaExtractorProvider } from '@/lib/document/extractors/media-registry';
import type { DocumentExtractorConfig } from '@/lib/document/types';
export type MaterialParserProfile = {
  document?: DocumentExtractorConfig;
  media?: DocumentExtractorConfig;
};
export async function loadMaterialParserProfile(): Promise<MaterialParserProfile> {
  const path = process.env.ZHIBAN_MATERIAL_PARSER_CONFIG;
  const pin = process.env.ZHIBAN_MATERIAL_PARSER_SHA256;
  if (!path && !pin) return {};
  if (!path || !pin || !isAbsolute(path) || !/^[a-f0-9]{64}$/.test(pin))
    throw Error('Parser configuration and pin required');
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    stat.size > 16384
  )
    throw Error('Private parser configuration required');
  const raw = await readFile(path);
  if (createHash('sha256').update(raw).digest('hex') !== pin)
    throw Error('Parser configuration pin rejected');
  const profile = JSON.parse(raw.toString());
  if (
    !profile ||
    Array.isArray(profile) ||
    Object.keys(profile).some((k) => !['document', 'media'].includes(k))
  )
    throw Error('Parser profile rejected');
  for (const kind of ['document', 'media'] as const) {
    const c = profile[kind];
    if (!c) continue;
    if (
      Array.isArray(c) ||
      typeof c !== 'object' ||
      Object.keys(c).some(
        (k) =>
          !['providerId', 'baseUrl', 'apiKey', 'accessKeyId', 'accessKeySecret', 'asr'].includes(k),
      )
    )
      throw Error('Parser fields rejected');
    if (
      !(kind === 'document'
        ? getDocumentExtractorProvider(c.providerId)
        : getMediaExtractorProvider(c.providerId))
    )
      throw Error('Parser provider rejected');
    for (const k of ['providerId', 'baseUrl', 'apiKey', 'accessKeyId', 'accessKeySecret'])
      if (c[k] !== undefined && (typeof c[k] !== 'string' || c[k].length > 4096))
        throw Error('Parser value rejected');
    if (c.baseUrl) {
      const u = new URL(c.baseUrl);
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.hash)
        throw Error('Parser URL rejected');
    }
  }
  return profile;
}
export function parserFor(
  mime: string,
  profile: MaterialParserProfile,
): DocumentExtractorConfig | null {
  if (['text/plain', 'text/markdown', 'text/csv'].includes(mime))
    return { providerId: 'plain-text' };
  const media = /^(audio|video)\//.test(mime);
  const configured = media ? profile.media : profile.document;
  if (configured) {
    const provider = media
      ? getMediaExtractorProvider(configured.providerId)
      : getDocumentExtractorProvider(configured.providerId);
    if (provider?.supportedMimeTypes.includes(mime)) return configured;
  }
  return mime === 'application/pdf' ? { providerId: 'unpdf' } : null;
}
