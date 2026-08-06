import { initialIdentityMigration, type ZhibanMigration } from './001-initial-identity';
import { localAuthMigration } from './002-local-auth';
import { defaultRbacMigration } from './003-default-rbac';
import { rbacDataScopesMigration } from './004-rbac-data-scopes';
import { academicOrganizationMigration } from './005-academic-organization';
import { bulkImportMigration } from './006-bulk-import';
import { teacherCourseSettingsMigration } from './007-teacher-course-settings';
import { completeTeacherCourseSettingsMigration } from './008-complete-teacher-course-settings';
import { pblLearningMigration } from './009-pbl-learning';
import { pblCollaborationAssessmentMigration } from './010-pbl-collaboration-assessment';
import { openmaicClassroomAdaptationMigration } from './011-openmaic-classroom-adaptation';
import { classroomInteractionEventsMigration } from './012-classroom-interaction-events';
import { classroomEventRollbackCompatibilityMigration } from './013-classroom-event-rollback-compatibility';
import { learningEventsProfilesMigration } from './014-learning-events-profiles';
import { learnerProfileGovernanceMigration } from './015-learner-profile-governance';

export const ZHIBAN_MIGRATIONS: readonly ZhibanMigration[] = [
  initialIdentityMigration,
  localAuthMigration,
  defaultRbacMigration,
  rbacDataScopesMigration,
  academicOrganizationMigration,
  bulkImportMigration,
  teacherCourseSettingsMigration,
  completeTeacherCourseSettingsMigration,
  pblLearningMigration,
  pblCollaborationAssessmentMigration,
  openmaicClassroomAdaptationMigration,
  classroomInteractionEventsMigration,
  classroomEventRollbackCompatibilityMigration,
  learningEventsProfilesMigration,
  learnerProfileGovernanceMigration,
];

export type { ZhibanMigration } from './001-initial-identity';
