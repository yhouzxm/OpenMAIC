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
import { pblLearningMigration } from '@/lib/zhiban/db/migrations/009-pbl-learning';
import { pblCollaborationAssessmentMigration } from '@/lib/zhiban/db/migrations/010-pbl-collaboration-assessment';
import { openmaicClassroomAdaptationMigration } from '@/lib/zhiban/db/migrations/011-openmaic-classroom-adaptation';
import { classroomInteractionEventsMigration } from '@/lib/zhiban/db/migrations/012-classroom-interaction-events';
import { classroomEventRollbackCompatibilityMigration } from '@/lib/zhiban/db/migrations/013-classroom-event-rollback-compatibility';
import { learningEventsProfilesMigration } from '@/lib/zhiban/db/migrations/014-learning-events-profiles';
import { learnerProfileGovernanceMigration } from '@/lib/zhiban/db/migrations/015-learner-profile-governance';
import { emaAnalysisJobsMigration } from '@/lib/zhiban/db/migrations/016-ema-analysis-jobs';
import { learningEventsPartitioningMigration } from '@/lib/zhiban/db/migrations/017-learning-events-partitioning';
import { multiAgentCollaborationMigration } from '@/lib/zhiban/db/migrations/018-multi-agent-collaboration';
import { postgresClassroomDocumentsMigration } from '@/lib/zhiban/db/migrations/019-postgres-classroom-documents';
import { agentOperationsMigration } from '@/lib/zhiban/db/migrations/020-agent-operations';
import { assessmentGradesMigration } from '@/lib/zhiban/db/migrations/021-assessment-grades';
import { gradeGovernanceMigration } from '@/lib/zhiban/db/migrations/022-grade-governance';
import { riskInterventionMigration } from '@/lib/zhiban/db/migrations/023-risk-intervention';
import { riskGovernanceMigration } from '@/lib/zhiban/db/migrations/024-risk-governance';
import { oucOrganizationIdentityMigration } from '@/lib/zhiban/db/migrations/025-ouc-organization-identity';
import { oucCourseRegistrationMigration } from '@/lib/zhiban/db/migrations/026-ouc-course-registration';
import { oucImportAccessFixesMigration } from '@/lib/zhiban/db/migrations/027-ouc-import-access-fixes';
import { globalAccountUniquenessMigration } from '@/lib/zhiban/db/migrations/028-global-account-uniqueness';
import { separateIdentityImportsMigration } from '@/lib/zhiban/db/migrations/029-separate-identity-imports';
import { importOrganizationFromSourceMigration } from '@/lib/zhiban/db/migrations/030-import-organization-from-source';
import { administrativeClassImportMigration } from '@/lib/zhiban/db/migrations/031-administrative-class-import';
import { courseClassGroupingMigration } from '@/lib/zhiban/db/migrations/032-course-class-grouping';
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
      pendingVersions: [
        '001',
        '002',
        '003',
        '004',
        '005',
        '006',
        '007',
        '008',
        '009',
        '010',
        '011',
        '012',
        '013',
        '014',
        '015',
        '016',
        '017',
        '018',
        '019',
        '020',
        '021',
        '022',
        '023',
        '024',
        '025',
        '026',
        '027',
        '028',
        '029',
        '030',
        '031',
        '032',
      ],
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
          { version: '009', checksum: pblLearningMigration.checksum },
          { version: '010', checksum: pblCollaborationAssessmentMigration.checksum },
          { version: '011', checksum: openmaicClassroomAdaptationMigration.checksum },
          { version: '012', checksum: classroomInteractionEventsMigration.checksum },
          { version: '013', checksum: classroomEventRollbackCompatibilityMigration.checksum },
          { version: '014', checksum: learningEventsProfilesMigration.checksum },
          { version: '015', checksum: learnerProfileGovernanceMigration.checksum },
          { version: '016', checksum: emaAnalysisJobsMigration.checksum },
          { version: '017', checksum: learningEventsPartitioningMigration.checksum },
          { version: '018', checksum: multiAgentCollaborationMigration.checksum },
          { version: '019', checksum: postgresClassroomDocumentsMigration.checksum },
          { version: '020', checksum: agentOperationsMigration.checksum },
          { version: '021', checksum: assessmentGradesMigration.checksum },
          { version: '022', checksum: gradeGovernanceMigration.checksum },
          { version: '023', checksum: riskInterventionMigration.checksum },
          { version: '024', checksum: riskGovernanceMigration.checksum },
          { version: '025', checksum: oucOrganizationIdentityMigration.checksum },
          { version: '026', checksum: oucCourseRegistrationMigration.checksum },
          { version: '027', checksum: oucImportAccessFixesMigration.checksum },
          { version: '028', checksum: globalAccountUniquenessMigration.checksum },
          { version: '029', checksum: separateIdentityImportsMigration.checksum },
          { version: '030', checksum: importOrganizationFromSourceMigration.checksum },
          { version: '031', checksum: administrativeClassImportMigration.checksum },
          { version: '032', checksum: courseClassGroupingMigration.checksum },
        ]),
      ),
    ).resolves.toMatchObject({
      status: 'healthy',
      database: 'reachable',
      schema: 'ready',
      appliedVersions: [
        '001',
        '002',
        '003',
        '004',
        '005',
        '006',
        '007',
        '008',
        '009',
        '010',
        '011',
        '012',
        '013',
        '014',
        '015',
        '016',
        '017',
        '018',
        '019',
        '020',
        '021',
        '022',
        '023',
        '024',
        '025',
        '026',
        '027',
        '028',
        '029',
        '030',
        '031',
        '032',
      ],
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
