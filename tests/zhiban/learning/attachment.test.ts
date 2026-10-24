import { describe, it, expect } from 'vitest';
import { submissionAttachment } from '../../../lib/zhiban/domain/learning/attachment';
import { learningCommand } from '../../../lib/zhiban/domain/learning/model';
const txt = {
  name: '巡检.txt',
  mime: 'text/plain',
  base64: Buffer.from('先断电，再验电。').toString('base64'),
};
describe('atomic submission file contract', () => {
  it('accepts UTF-8 TXT and download-only PDF containers', () => {
    expect(submissionAttachment(txt)).toEqual(txt);
    expect(
      submissionAttachment({
        name: 'report.pdf',
        mime: 'application/pdf',
        base64: Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64'),
      }).name,
    ).toBe('report.pdf');
  });
  it('rejects traversal, wrong type/extension, invalid UTF-8/base64, controls, empty/oversized files', () => {
    for (const a of [
      { ...txt, name: '../x.txt' },
      { ...txt, name: 'x.html' },
      { ...txt, mime: 'text/html' },
      { ...txt, base64: 'YQ' },
      { ...txt, base64: '' },
      { ...txt, base64: Buffer.from([255]).toString('base64') },
      { ...txt, base64: Buffer.from('a\0b').toString('base64') },
      { ...txt, base64: Buffer.alloc(1048577, 65).toString('base64') },
      { ...txt, name: 'a.pdf', mime: 'application/pdf' },
    ])
      expect(() => submissionAttachment(a)).toThrow();
  });
  it('allows a file only on formal SUBMIT and keeps the required text response', () => {
    const c = {
      type: 'SUBMIT',
      id: '00000000-0000-7000-8000-000000000001',
      revision: '1',
      answer: '巡检报告',
      attachment: txt,
    };
    expect(learningCommand(c)).toEqual(c);
    expect(() => learningCommand({ ...c, type: 'SAVE_DRAFT' })).toThrow();
    expect(() => learningCommand({ ...c, answer: '' })).toThrow();
  });
});
