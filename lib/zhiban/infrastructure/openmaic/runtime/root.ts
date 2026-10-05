import type { ActivityRuntimePort } from '@/lib/zhiban/application/openmaic/runtime';
import type { AIServicePort } from '@/lib/zhiban/application/openmaic/ai';

/** Real Attempt facts are unavailable. This factory accepts no injected capability. */
export function createRuntimeFoundation(): Readonly<{
  runtime: ActivityRuntimePort;
  ai: AIServicePort;
}> {
  const denied = Object.freeze({ status: 'DENIED' as const });
  return Object.freeze({
    runtime: Object.freeze({ execute: async () => denied }),
    ai: Object.freeze({ draft: async () => denied }),
  });
}
