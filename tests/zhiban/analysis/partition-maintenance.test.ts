import { describe, expect, it, vi } from 'vitest';
import { ensureLearningEventPartitions } from '@/lib/zhiban/analysis/partition-maintenance';

describe('learning event partition maintenance', () => {
  it('creates missing monthly partitions ahead of ingestion', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      ensureLearningEventPartitions({ query, connect: vi.fn() } as never, 6),
    ).resolves.toEqual({ monthsAhead: 6 });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('PARTITION OF zhiban.learning_events');
    expect(sql).toContain('0..6');
    expect(sql).toContain('to_regclass');
  });
  it('rejects an unbounded partition horizon', async () => {
    await expect(ensureLearningEventPartitions({} as never, 100)).rejects.toThrow(
      'between 1 and 36',
    );
  });
});
