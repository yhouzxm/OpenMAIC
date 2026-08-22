import { describe, expect, it } from 'vitest';
import { openMaicActivityTypesMigration } from '@/lib/zhiban/db/migrations/043-openmaic-activity-types';

describe('OpenMAIC first-class activity types migration', () => {
  const up = openMaicActivityTypesMigration.up.join('\n');
  it.each([
    'openmaic_slide',
    'openmaic_quiz',
    'openmaic_interactive',
    'openmaic_pbl',
    'openmaic_3d',
  ])('adds %s as a course activity option', (type) => expect(up).toContain(`'${type}'`));
  it('backfills the legacy umbrella type from the persisted document kind', () => {
    expect(up).toContain("document_state->>'activityKind'");
    expect(up).toContain("a.activity_type='openmaic_interaction'");
    expect(up).toContain("SET activity_type='openmaic_slide'");
  });
  it('removes the legacy umbrella type from the final constraint', () => {
    const finalConstraint = openMaicActivityTypesMigration.up.at(-1) ?? '';
    expect(finalConstraint).not.toContain("'openmaic_interaction'");
  });
});
