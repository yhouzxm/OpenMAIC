import { describe, expect, it } from 'vitest';
import { learningEventsPartitioningMigration } from '@/lib/zhiban/db/migrations/017-learning-events-partitioning';

const schema = learningEventsPartitioningMigration.up.join('\n');
describe('learning event time partitions', () => {
  it('partitions the high-volume analytics ledger by event time with monthly children', () => {
    expect(schema).toContain('PARTITION BY RANGE(occurred_at)');
    expect(schema).toContain("to_char(part_start,'YYYY_MM')");
    expect(schema).toContain('PARTITION OF zhiban.learning_events DEFAULT');
  });
  it('preserves idempotency across partitions and supports rollback', () => {
    expect(schema).toContain('learning_event_idempotency_keys');
    expect(schema).toContain('guard_learning_event_idempotency');
    expect(learningEventsPartitioningMigration.down.join('\n')).toContain(
      'learning_events_partitioned',
    );
  });
});
