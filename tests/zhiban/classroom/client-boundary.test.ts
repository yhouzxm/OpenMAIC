import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Zhiban classroom client boundary', () => {
  it('keeps Node-only server modules out of the classroom service barrel', () => {
    const source = readFileSync('lib/zhiban/classroom/service.ts', 'utf8');
    expect(source).not.toMatch(/from ['"]@\/lib\/server\//);
    expect(source).not.toMatch(/from ['"](?:node:)?fs['"]/);
    const tracker = readFileSync('components/zhiban/classroom-progress-tracker.tsx', 'utf8');
    expect(tracker).not.toContain("from '@/lib/zhiban/classroom'");
  });
});
