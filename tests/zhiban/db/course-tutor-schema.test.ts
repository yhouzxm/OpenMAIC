import { describe, expect, it } from 'vitest';

import { courseTutorMigration } from '@/lib/zhiban/db/migrations/038-course-tutor';

describe('course Tutor schema migration', () => {
  const sql = courseTutorMigration.up.join('\n');

  it('stores course Tutor configuration, knowledge, conversations, and feedback', () => {
    expect(sql).toContain('CREATE TABLE zhiban.course_tutor_configs');
    expect(sql).toContain('CREATE TABLE zhiban.course_tutor_documents');
    expect(sql).toContain('CREATE TABLE zhiban.course_tutor_chunks');
    expect(sql).toContain('CREATE TABLE zhiban.course_tutor_sessions');
    expect(sql).toContain('CREATE TABLE zhiban.course_tutor_messages');
    expect(sql).toContain('CREATE TABLE zhiban.course_tutor_feedback');
  });

  it('provides full-text retrieval, ownership constraints, cascading cleanup, and tenant RLS', () => {
    expect(sql).toContain("TSVECTOR GENERATED ALWAYS AS(to_tsvector('simple',content)) STORED");
    expect(sql).toContain('USING GIN(search_vector)');
    expect(sql).toContain('REFERENCES zhiban.courses(id,tenant_id) ON DELETE CASCADE');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("current_setting('zhiban.tenant_id',true)");
  });
});
