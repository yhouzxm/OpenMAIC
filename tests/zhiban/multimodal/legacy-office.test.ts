import {
  isWorkbenchMaterialMime,
  WORKBENCH_MATERIAL_EXTENSIONS,
} from '@/lib/workbench/material-upload-policy';
import { describe, expect, it } from 'vitest';
import { legacyOfficeType, convertLegacyOffice } from '@/lib/document/legacy-office';
import { providerEnvironment } from '@/lib/zhiban/infrastructure/authoring/media/environment';

describe('legacy Office conversion admission', () => {
  it('admits all three library upload formats while extraction stays capability-gated', () => {
    for (const mime of [
      'application/msword',
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-excel',
    ])
      expect(isWorkbenchMaterialMime(mime)).toBe(true);
    for (const ext of ['.doc', '.ppt', '.xls'])
      expect(WORKBENCH_MATERIAL_EXTENSIONS).toContain(ext);
  });
  it('maps exactly three legacy formats to the existing modern parser contract', () => {
    expect(
      ['application/msword', 'application/vnd.ms-powerpoint', 'application/vnd.ms-excel'].map(
        (m) => legacyOfficeType(m)?.to,
      ),
    ).toEqual(['docx', 'pptx', 'xlsx']);
    expect(legacyOfficeType('application/pdf')).toBeUndefined();
  });
  it('refuses renamed ZIP, empty and oversized input before converter or parser work', async () => {
    for (const buffer of [
      Buffer.from('PK\\x03\\x04renamed'),
      Buffer.alloc(0),
      Buffer.alloc(1048577),
    ])
      await expect(convertLegacyOffice({ buffer, mimeType: 'application/msword' })).rejects.toThrow(
        'INVALID_LEGACY_OFFICE',
      );
  });
  it('admits only the explicit converter setting without forwarding process/DB overrides', () => {
    expect(
      providerEnvironment({
        ZHIBAN_OFFICE_CONVERTER_PATH: '/approved/soffice',
        NODE_OPTIONS: 'unsafe',
        DATABASE_URL: 'foreign',
        PATH: 'foreign',
      }),
    ).toEqual({ ZHIBAN_OFFICE_CONVERTER_PATH: '/approved/soffice' });
  });
});
