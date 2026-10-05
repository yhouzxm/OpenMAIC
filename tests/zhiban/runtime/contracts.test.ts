import { describe, it, expect } from 'vitest';
import { createRuntimeFoundation } from '@/lib/zhiban/infrastructure/openmaic/runtime/root';
import { readFileSync } from 'node:fs';
describe('C9 closed production composition', () => {
  it.each([
    'CREATE_RUNTIME',
    'APPEND_USER_RECORD',
    'APPEND_ASSISTANT_RECORD',
    'COMPLETE_RUNTIME',
    'ARCHIVE_RUNTIME',
    'READ_SESSION',
    'READ_RECORDS',
    'READ_OUTCOME',
  ] as const)('%s has unavailable business authority', async (action) => {
    const root = createRuntimeFoundation();
    const poison = new Proxy(
      {},
      {
        get() {
          throw new Error('Forbidden provider access');
        },
      },
    );
    expect(await root.runtime.execute(action, poison as never, poison)).toEqual({
      status: 'DENIED',
    });
    expect(await root.ai.draft(poison as never)).toEqual({ status: 'DENIED' });
  });
  it('ordinary factory exports neither capability nor injection', () => {
    const r = createRuntimeFoundation();
    expect(Object.keys(r)).toEqual(['runtime', 'ai']);
    expect(Object.isFrozen(r.runtime)).toBe(true);
    const source = readFileSync('lib/zhiban/infrastructure/openmaic/runtime/root.ts', 'utf8');
    expect(source).not.toMatch(/from .*?(?:provision|native|protocol|tests|fake)/);
    expect(Object.keys(r.runtime)).toEqual(['execute']);
  });
});
