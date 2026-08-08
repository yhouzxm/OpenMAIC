import { describe, expect, it } from 'vitest';
import { multiAgentCollaborationMigration } from '@/lib/zhiban/db/migrations/018-multi-agent-collaboration';

describe('Zhiban multi-agent collaboration schema', () => {
  const sql = multiAgentCollaborationMigration.up.join('\n');
  it('persists versioned role templates and structured intervention briefs', () => {
    expect(sql).toContain('agent_role_templates');
    expect(sql).toContain('intervention_briefs');
    expect(sql).toContain('policy_version');
    expect(sql).toContain('prompt_version');
    expect(sql).toContain('command_id');
  });
  it('records transitions, enforces tenant RLS, and enables monitor jobs', () => {
    expect(sql).toContain('intervention_transitions');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("'monitor_evaluate'");
  });
});
