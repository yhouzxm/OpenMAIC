import { describe, expect, it } from 'vitest';
import { postgresClassroomDocumentsMigration } from '@/lib/zhiban/db/migrations/019-postgres-classroom-documents';

describe('PostgreSQL classroom document schema', () => {
  const sql = postgresClassroomDocumentsMigration.up.join('\n');
  it('stores stage, scenes, runtime document state, and revisions', () => {
    expect(sql).toContain('openmaic_classroom_documents');
    expect(sql).toContain('stage JSONB');
    expect(sql).toContain('scenes JSONB');
    expect(sql).toContain('document_state JSONB');
    expect(sql).toContain('revision BIGINT');
  });
});
