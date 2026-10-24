import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { submissionAttachment } from '../learning/attachment';
import { normalizeDocumentMimeType } from '@/lib/document/mime';
import { resolveWorkbenchMaterialMime } from '@/lib/workbench/material-upload-policy';
export type MaterialFile = { name: string; mime: string; base64: string };
export type MaterialCommand =
  | {
      type: 'UPLOAD_MATERIAL';
      id: string | null;
      revision: string | null;
      title: string;
      file: MaterialFile;
    }
  | { type: 'PUBLISH_MATERIAL' | 'ARCHIVE_MATERIAL'; id: string; revision: string };
export function materialCommand(input: unknown): MaterialCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  requireAcademic(
    ['UPLOAD_MATERIAL', 'PUBLISH_MATERIAL', 'ARCHIVE_MATERIAL'].includes(String(v.type)),
  );
  requireAcademic(
    Object.keys(v).sort().join(',') ===
      (v.type === 'UPLOAD_MATERIAL' ? 'file,id,revision,title,type' : 'id,revision,type'),
  );
  if (v.type !== 'UPLOAD_MATERIAL')
    return {
      type: v.type as 'PUBLISH_MATERIAL' | 'ARCHIVE_MATERIAL',
      id: academicId(v.id),
      revision: academicRevision(v.revision),
    };
  const id = v.id === null ? null : academicId(v.id),
    revision = v.revision === null ? null : academicRevision(v.revision);
  requireAcademic((id === null) === (revision === null));
  requireAcademic(
    typeof v.title === 'string' &&
      v.title.trim().length > 0 &&
      v.title.length <= 120 &&
      v.title.isWellFormed() &&
      !/[\u0000-\u001f\u007f]/.test(v.title),
  );
  requireAcademic(!!v.file && typeof v.file === 'object' && !Array.isArray(v.file));
  const f = v.file as Record<string, unknown>;
  requireAcademic(
    Object.keys(f).sort().join(',') === 'base64,mime,name' &&
      typeof f.name === 'string' &&
      typeof f.mime === 'string',
  );
  requireAcademic((f.name as string).length <= 120);
  const mime = resolveWorkbenchMaterialMime({
    mimeType: f.mime as string,
    fileName: f.name as string,
  });
  const file = submissionAttachment({ name: f.name, mime, base64: f.base64 });
  requireAcademic(normalizeDocumentMimeType({ mimeType: mime }) === mime);
  return {
    type: 'UPLOAD_MATERIAL',
    id,
    revision,
    title: v.title.trim(),
    file: { name: f.name as string, mime, base64: file.base64 },
  };
}
