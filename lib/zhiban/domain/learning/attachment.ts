import { fileMime } from './file-policy';
import { requireAcademic } from '../academic/model';
export interface SubmissionAttachment {
  name: string;
  mime: string;
  base64: string;
}
export function submissionAttachment(value: unknown): SubmissionAttachment {
  requireAcademic(!!value && typeof value === 'object' && !Array.isArray(value));
  const a = value as Record<string, unknown>;
  requireAcademic(Object.keys(a).sort().join(',') === 'base64,mime,name');
  requireAcademic(
    typeof a.name === 'string' &&
      a.name.length > 0 &&
      a.name.length <= 120 &&
      a.name.isWellFormed() &&
      !/[\u0000-\u001f\u007f/\\]/.test(a.name) &&
      a.name.trim() === a.name,
  );
  requireAcademic(typeof a.mime === 'string' && fileMime(a.name as string, a.mime) === a.mime);
  requireAcademic(
    typeof a.base64 === 'string' &&
      a.base64.length <= 1398104 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(a.base64),
  );
  const bytes = Buffer.from(a.base64 as string, 'base64');
  requireAcademic(
    bytes.length > 0 && bytes.length <= 1048576 && bytes.toString('base64') === a.base64,
  );
  if (['text/plain', 'text/markdown', 'text/csv'].includes(a.mime as string)) {
    let text = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      requireAcademic(false);
    }
    requireAcademic(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text));
  } else if (a.mime === 'application/pdf')
    requireAcademic(
      /^%PDF-(?:1\.[0-9]|2\.0)/.test(bytes.subarray(0, 8).toString('ascii')) &&
        /%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1')),
    );
  else {
    const head = bytes.subarray(0, 32);
    const hex = head.toString('hex');
    const ascii = head.toString('latin1');
    const valid = (a.mime as string).startsWith('application/vnd.openxmlformats-')
      ? hex.startsWith('504b0304')
      : a.mime === 'image/png'
        ? hex.startsWith('89504e470d0a1a0a')
        : a.mime === 'image/jpeg'
          ? hex.startsWith('ffd8ff')
          : a.mime === 'image/webp'
            ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
            : a.mime === 'audio/wav'
              ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE'
              : a.mime === 'audio/mpeg'
                ? ascii.startsWith('ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224)
                : a.mime === 'audio/aac'
                  ? bytes[0] === 255 && (bytes[1] & 246) === 240
                  : a.mime === 'video/webm'
                    ? hex.startsWith('1a45dfa3')
                    : ['audio/mp4', 'video/mp4', 'video/quicktime'].includes(a.mime as string)
                      ? ascii.slice(4, 8) === 'ftyp'
                      : false;
    requireAcademic(valid);
  }
  // PDF checks identify the container only; files are untrusted, download-only, never rendered.
  return {
    name: a.name as string,
    mime: a.mime as SubmissionAttachment['mime'],
    base64: a.base64 as string,
  };
}
