import { describe, expect, it } from 'vitest';
import { openMaicSingleActivityMigration } from '@/lib/zhiban/db/migrations/041-openmaic-single-activity';

describe('OpenMAIC single activity migration', () => {
  it('adds a dedicated reversible course activity type', () => {
    expect(openMaicSingleActivityMigration.up.join('\n')).toContain("'openmaic_interaction'");
    expect(openMaicSingleActivityMigration.down.join('\n')).toContain("SET activity_type='classroom'");
  });
});
