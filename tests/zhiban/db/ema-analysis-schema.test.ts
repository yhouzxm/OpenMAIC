import { describe, expect, it } from 'vitest';
import { emaAnalysisJobsMigration } from '@/lib/zhiban/db/migrations/016-ema-analysis-jobs';

const schema = emaAnalysisJobsMigration.up.join('\n');
describe('EMA and analysis jobs schema', () => {
  it('stores versioned templates, trigger instances, answers and explicit skips', () => {
    expect(schema).toContain('CREATE TABLE zhiban.ema_templates');
    expect(schema).toContain('CREATE TABLE zhiban.ema_instances');
    expect(schema).toContain('CREATE TABLE zhiban.ema_responses');
    expect(schema).toContain('skipped BOOLEAN NOT NULL DEFAULT false');
  });
  it('supports durable claim, retry and idempotency state', () => {
    expect(schema).toContain('CREATE TABLE zhiban.analysis_jobs');
    expect(schema).toContain('idempotency_key');
    expect(schema).toContain('max_attempts');
    expect(schema).toContain('locked_by');
  });
});
