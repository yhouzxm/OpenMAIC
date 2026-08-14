import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('course registration import navigation', () => {
  it('returns directly to the teaching course tab', () => {
    const importer = fs.readFileSync(
      path.join(process.cwd(), 'components/zhiban/ouc-import-console.tsx'),
      'utf8',
    );
    const academic = fs.readFileSync(
      path.join(process.cwd(), 'components/zhiban/academic-console.tsx'),
      'utf8',
    );
    expect(importer).toContain('/zhiban/admin/academic?tab=courses');
    expect(academic).toContain('useSearchParams');
    expect(academic).toContain('<Tabs defaultValue={initialTab}>');
  });
});
