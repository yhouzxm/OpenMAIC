import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PBL project console submit lifecycle', () => {
  it('captures the form before awaiting the create request', () => {
    const source = readFileSync(
      new URL('../../../components/zhiban/pbl-project-console.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('const form = event.currentTarget;');
    expect(source).toContain('form.reset()');
    expect(source).not.toContain('event.currentTarget.reset()');
  });
});
