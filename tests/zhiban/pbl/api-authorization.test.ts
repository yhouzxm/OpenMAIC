import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const route = (path: string) => readFileSync(new URL(`../../../app/api/zhiban/pbl/${path}`, import.meta.url), 'utf8');

describe('Zhiban PBL API authorization boundary', () => {
  it('does not require tenant-wide permission for course-scoped teachers', () => {
    const source = route('projects/route.ts');
    expect(source).toContain('requireRequestPrincipal');
    expect(source).not.toContain("requireRequestPermission('course:manage')");
  });

  it('lets enrollment ownership enforce student data scope', () => {
    for (const path of ['learning/route.ts', 'learning/[instanceId]/route.ts']) {
      const source = route(path);
      expect(source).toContain('requireRequestPrincipal');
      expect(source).not.toContain("requireRequestPermission('course:read')");
    }
  });
});
