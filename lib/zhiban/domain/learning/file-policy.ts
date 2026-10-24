/** Browser-safe shared upload contract. Bytes stay untrusted and download-only. */
import {
  DOCUMENT_MIME_TYPES as M,
  getExtensionsForMimes,
  normalizeDocumentMimeType,
} from '@/lib/document/mime';
export const fileMimes = [
  'txt',
  'markdown',
  'csv',
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'png',
  'jpeg',
  'webp',
  'mp3',
  'wav',
  'm4a',
  'aac',
  'mp4',
  'mov',
  'webm',
].map((k) => M[k]);
export const fileAccept = getExtensionsForMimes(fileMimes)
  .map((e) => '.' + e)
  .join(',');
export function fileMime(name: string, mime: string) {
  const normalized = normalizeDocumentMimeType({ fileName: name, mimeType: mime });
  const extensionMime = normalizeDocumentMimeType({ fileName: name });
  return fileMimes.includes(normalized) && normalized === extensionMime ? normalized : null;
}
