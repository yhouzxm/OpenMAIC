import { describe, expect, it } from 'vitest';
import { classroomInteractionEventsMigration } from '@/lib/zhiban/db/migrations/012-classroom-interaction-events';
describe('classroom interaction event taxonomy', () => {
  it('supports detailed classroom interactions and rollback', () => {
    const ddl = classroomInteractionEventsMigration.up.join('\n');
    expect(ddl).toContain('quiz_answered');
    expect(ddl).toContain('simulation_interacted');
    expect(ddl).toContain('chat_message');
    expect(classroomInteractionEventsMigration.down).toHaveLength(4);
  });
});
