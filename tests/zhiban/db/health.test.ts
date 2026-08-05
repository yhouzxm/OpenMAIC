import { describe, expect, it } from 'vitest';

import { checkZhibanDatabaseHealth } from '@/lib/zhiban/db/health';
import { initialIdentityMigration } from '@/lib/zhiban/db/migrations/001-initial-identity';
import { localAuthMigration } from '@/lib/zhiban/db/migrations/002-local-auth';
import { defaultRbacMigration } from '@/lib/zhiban/db/migrations/003-default-rbac';
import { rbacDataScopesMigration } from '@/lib/zhiban/db/migrations/004-rbac-data-scopes';
import { academicOrganizationMigration } from '@/lib/zhiban/db/migrations/005-academic-organization';
import { bulkImportMigration } from '@/lib/zhiban/db/migrations/006-bulk-import';
import { teacherCourseSettingsMigration } from '@/lib/zhiban/db/migrations/007-teacher-course-settings';
import { completeTeacherCourseSettingsMigration } from '@/lib/zhiban/db/migrations/008-complete-teacher-course-settings';
import type { QueryResult, ZhibanQueryable } from '@/lib/zhiban/db/types';

class HealthDatabase implements ZhibanQueryable {
  constructor(
    private readonly migrationTable: string | null,
    private readonly applied: Array<{ version: string; checksum: string }> = [],
    private readonly failure?: Error,
  ) {}

  async query<TRow extends Record<string, unknown>>(text: string): Promise<QueryResult<TRow>> {
    if (this.failure) throw this.failure;
    if (text.includes('to_regclass')) {
      return { rows: [{ migration_table: this.migrationTable }] as unknown as TRow[] };
    }
    if (text.includes('FROM zhiban.schema_migrations')) {
      return { rows: this.applied as unknown as TRow[] };
    }
    return { rows: [{ ok: 1 }] as unknown as TRow[] };
  }
}

describe('checkZhibanDatabaseHealth', () => {
  it('reports a reachable database that still needs migration', async () => {
    await expect(checkZhibanDatabaseHealth(new HealthDatabase(null))).resolves.toMatchObject({
      status: 'migration_required',
      database: 'reachable',
      schema: 'missing',
      pendingVersions: ['001', '002', '003', '004', '005', '006', '007', '008'],
    });
  });

  it('reports healthy only when every checksum matches', async () => {
    await expect(
      checkZhibanDatabaseHealth(
        new HealthDatabase('zhiban.schema_migrations', [
          { version: '001', checksum: initialIdentityMigration.checksum },
          { version: '002', checksum: localAuthMigration.checksum },
          { version: '003', checksum: defaultRbacMigration.checksum },
          { version: '004', checksum: rbacDataScopesMigration.checksum },
          { version: '005', checksum: academicOrganizationMigration.checksum },
          { version: '006', checksum: bulkImportMigration.checksum },
          { version: '007', checksum: teacherCourseSettingsMigration.checksum },
          { version: '008', checksum: completeTeacherCourseSettingsMigration.checksum },
        ]),
      ),
    ).resolves.toMatchObject({
      status: 'healthy',
      database: 'reachable',
      schema: 'ready',
      appliedVersions: ['001', '002', '003', '004', '005', '006', '007', '008'],
      pendingVersions: [],
      driftedVersions: [],
    });
  });

  it('reports schema drift without exposing database errors', async () => {
    await expect(
      checkZhibanDatabaseHealth(
        new HealthDatabase('zhiban.schema_migrations', [{ version: '001', checksum: 'modified' }]),
      ),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      database: 'reachable',
      schema: 'drifted',
      driftedVersions: ['001'],
    });

    await expect(
      checkZhibanDatabaseHealth(new HealthDatabase(null, [], new Error('password=secret'))),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      database: 'unreachable',
      schema: 'unknown',
    });
  });
});
