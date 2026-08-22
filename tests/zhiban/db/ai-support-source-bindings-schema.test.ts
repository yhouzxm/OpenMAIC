import { describe, expect, it } from 'vitest';

import { aiSupportSourceBindingsMigration } from '@/lib/zhiban/db/migrations/040-ai-support-source-bindings';

describe('AI support source bindings migration', () => {
  it('allows governed Tutor knowledge sources used by activity bindings', () => {
    const sql = aiSupportSourceBindingsMigration.up.join('\n');
    expect(sql).toContain("'pbl'");
    expect(sql).toContain("'classroom'");
    expect(sql).toContain("'discussion'");
  });
});
