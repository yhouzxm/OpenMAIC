import { describe, it, expect } from 'vitest';
import { submissionAttachment } from '@/lib/zhiban/domain/learning/attachment';
import { fileMime } from '@/lib/zhiban/domain/learning/file-policy';
import { parserFor } from '@/lib/zhiban/infrastructure/material/config';
import { parseMaterial } from '@/lib/zhiban/infrastructure/material/parser';
describe('resource and attachment formats', () => {
  it('normalizes generic browser MIME but rejects conflicting extension', () => {
    expect(fileMime('a.docx', 'application/octet-stream')).toContain('wordprocessingml');
    expect(fileMime('a.docx', 'application/pdf')).toBeNull();
    expect(fileMime('a.html', 'text/html')).toBeNull();
  });
  it('requires parser service for Office/OCR/media, independently of attachment upload', () => {
    for (const mime of [
      'image/png',
      'audio/wav',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ])
      expect(parserFor(mime, {})).toBeNull();
    expect(parserFor('application/pdf', {})?.providerId).toBe('unpdf');
    expect(parserFor('image/png', { document: { providerId: 'mineru' } })?.providerId).toBe(
      'mineru',
    );
  });
  it('accepts Markdown/CSV and rejects spoofed binary containers', () => {
    for (const [name, mime] of [
      ['a.md', 'text/markdown'],
      ['a.csv', 'text/csv'],
    ])
      expect(
        submissionAttachment({
          name,
          mime,
          base64: Buffer.from('name,value\na,1').toString('base64'),
        }).mime,
      ).toBe(mime);
    for (const [name, mime] of [
      ['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['a.png', 'image/png'],
      ['a.wav', 'audio/wav'],
    ])
      expect(() =>
        submissionAttachment({ name, mime, base64: Buffer.from('spoof').toString('base64') }),
      ).toThrow();
  });
  it('uses native text extraction for CSV and refuses missing external provider', async () => {
    const parsed = await parseMaterial({
      name: 'table.csv',
      mime: 'text/csv',
      base64: Buffer.from('name,value\na,1').toString('base64'),
    });
    expect(parsed.text).toContain('a,1');
    await expect(
      parseMaterial({ name: 'voice.wav', mime: 'audio/wav', base64: 'YQ==' }),
    ).rejects.toThrow();
  });
});

import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadMaterialParserProfile } from '@/lib/zhiban/infrastructure/material/config';
it('accepts only a private digest-pinned host configuration and rejects caller fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zhiban-parser-config-'));
  const oldPath = process.env.ZHIBAN_MATERIAL_PARSER_CONFIG,
    oldPin = process.env.ZHIBAN_MATERIAL_PARSER_SHA256;
  const path = join(dir, 'parser.json');
  try {
    const raw = JSON.stringify({
      document: { providerId: 'mineru', baseUrl: 'http://127.0.0.1:8000' },
    });
    await writeFile(path, raw, { mode: 0o600 });
    process.env.ZHIBAN_MATERIAL_PARSER_CONFIG = path;
    process.env.ZHIBAN_MATERIAL_PARSER_SHA256 = createHash('sha256').update(raw).digest('hex');
    expect((await loadMaterialParserProfile()).document?.providerId).toBe('mineru');
    await chmod(path, 0o644);
    await expect(loadMaterialParserProfile()).rejects.toThrow('Private');
    await chmod(path, 0o600);
    process.env.ZHIBAN_MATERIAL_PARSER_SHA256 = '0'.repeat(64);
    await expect(loadMaterialParserProfile()).rejects.toThrow('pin');
    const invalid = JSON.stringify({ document: { providerId: 'mineru', command: 'arbitrary' } });
    await writeFile(path, invalid);
    process.env.ZHIBAN_MATERIAL_PARSER_SHA256 = createHash('sha256').update(invalid).digest('hex');
    await expect(loadMaterialParserProfile()).rejects.toThrow('fields');
  } finally {
    if (oldPath === undefined) delete process.env.ZHIBAN_MATERIAL_PARSER_CONFIG;
    else process.env.ZHIBAN_MATERIAL_PARSER_CONFIG = oldPath;
    if (oldPin === undefined) delete process.env.ZHIBAN_MATERIAL_PARSER_SHA256;
    else process.env.ZHIBAN_MATERIAL_PARSER_SHA256 = oldPin;
    await rm(dir, { recursive: true, force: true });
  }
});
