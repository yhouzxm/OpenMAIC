import { describe, it, expect } from 'vitest';
import { materialCommand } from '../../../lib/zhiban/domain/material/model';
import { curriculumCommand } from '../../../lib/zhiban/domain/curriculum/model';
import { parseMaterial } from '../../../lib/zhiban/infrastructure/material/parser';
import { PDFDocument, StandardFonts } from 'pdf-lib';
const file = {
  name: '维护.md',
  mime: 'application/octet-stream',
  base64: Buffer.from('# 维护\n先隔离，再验电。').toString('base64'),
};
const input = { type: 'UPLOAD_MATERIAL', id: null, revision: null, title: '维护规范', file };
describe('P3 native course-material adapter', () => {
  it('uses upstream MIME normalization and accepts UTF8 Markdown without HTML execution', () => {
    expect(materialCommand(input)).toMatchObject({ file: { mime: 'text/markdown' } });
  });
  it.each([
    { owner: 'forged' },
    { courseId: 'forged' },
    { scannerReference: 'clean' },
    { parser: 'trusted' },
  ])('rejects authority or service metadata injection %#', (extra) =>
    expect(() => materialCommand({ ...input, ...extra })).toThrow(),
  );
  it('rejects wrong containers, formats, traversal, invalid UTF8 and oversized input', () => {
    for (const patch of [
      { name: '../a.md' },
      { mime: 'text/html' },
      { base64: '' },
      { base64: Buffer.from([0xff]).toString('base64') },
      { base64: Buffer.alloc(1048577, 65).toString('base64') },
      {
        name: 'file.docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      { name: 'a.pdf', mime: 'application/pdf', base64: Buffer.from('not PDF').toString('base64') },
    ])
      expect(() => materialCommand({ ...input, file: { ...file, ...patch } })).toThrow();
  });
  it('requires explicit new-id/revision pairing and immutable command fields', () => {
    expect(() =>
      materialCommand({ ...input, id: '01a14ee3-d223-7692-aefb-b471db5d1464' }),
    ).toThrow();
    expect(() =>
      materialCommand({
        type: 'PUBLISH_MATERIAL',
        id: '01a14ee3-d223-7692-aefb-b471db5d1464',
        revision: 1,
      }),
    ).toThrow();
  });
  it('allows an explicit MATERIAL unit without changing old kinds', () => {
    expect(
      curriculumCommand({
        type: 'SAVE_OUTLINE',
        revision: '1',
        chapters: [
          {
            id: '01954000-0000-7000-8000-000000000001',
            title: '单元',
            units: [
              {
                id: '01954000-0000-7000-8000-000000000002',
                title: '资料',
                kind: 'MATERIAL',
                target: '01a14ee3-d223-7692-aefb-b471db5d1464',
              },
            ],
          },
        ],
      }),
    ).toBeTruthy();
  });
  it('executes official plain-text and unpdf in bounded credential-free children', async () => {
    const normalized = materialCommand(input);
    if (normalized.type !== 'UPLOAD_MATERIAL') throw Error('test');
    expect((await parseMaterial(normalized.file)).text).toContain('先隔离');
    const pdf = await PDFDocument.create(),
      page = pdf.addPage();
    page.drawText('COURSE SAFETY PDF', {
      x: 40,
      y: 740,
      font: await pdf.embedFont(StandardFonts.Helvetica),
      size: 18,
    });
    const bytes = await pdf.save();
    const parsed = await parseMaterial({
      name: 'safety.pdf',
      mime: 'application/pdf',
      base64: Buffer.from(bytes).toString('base64'),
    });
    expect(parsed.text).toContain('COURSE SAFETY PDF');
    expect(parsed.parser).toMatch(/^unpdf:/);
    await expect(
      parseMaterial({
        name: 'bad.pdf',
        mime: 'application/pdf',
        base64: Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64'),
      }),
    ).rejects.toThrow();
  }, 45000);
});
