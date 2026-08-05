import { describe, expect, it } from 'vitest';
import { bulkImportMigration } from '@/lib/zhiban/db/migrations/006-bulk-import';
describe('bulk import schema', () => {
  const sql = bulkImportMigration.up.join('\n');
  it('stores jobs and row reports under forced tenant RLS', () => {
    expect(sql).toContain('CREATE TABLE zhiban.import_jobs');
    expect(sql).toContain('CREATE TABLE zhiban.import_rows');
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(2);
  });
  it('restricts executable job states and modes', () => {
    expect(sql).toContain("'validated', 'invalid', 'running', 'completed', 'failed'");
    expect(sql).toContain("mode IN ('skip', 'update')");
  });
});
