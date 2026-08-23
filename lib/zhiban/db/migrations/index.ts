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
import { emaAnalysisJobsMigration } from './016-ema-analysis-jobs';
import { learningEventsPartitioningMigration } from './017-learning-events-partitioning';
import { multiAgentCollaborationMigration } from './018-multi-agent-collaboration';
import { postgresClassroomDocumentsMigration } from './019-postgres-classroom-documents';
import { agentOperationsMigration } from './020-agent-operations';
import { assessmentGradesMigration } from './021-assessment-grades';
import { gradeGovernanceMigration } from './022-grade-governance';
import { riskInterventionMigration } from './023-risk-intervention';
import { riskGovernanceMigration } from './024-risk-governance';
import { oucOrganizationIdentityMigration } from './025-ouc-organization-identity';
import { oucCourseRegistrationMigration } from './026-ouc-course-registration';
import { oucImportAccessFixesMigration } from './027-ouc-import-access-fixes';
import { globalAccountUniquenessMigration } from './028-global-account-uniqueness';
import { separateIdentityImportsMigration } from './029-separate-identity-imports';
import { importOrganizationFromSourceMigration } from './030-import-organization-from-source';
import { administrativeClassImportMigration } from './031-administrative-class-import';
import { courseClassGroupingMigration } from './032-course-class-grouping';
import { studentCourseAccessMigration } from './033-student-course-access';
import { unifiedCourseStructureMigration } from './034-unified-course-structure';
import { courseActivityGovernanceMigration } from './035-course-activity-governance';
import { courseContentDiscussionsMigration } from './036-course-content-discussions';
import { courseworkCompletionMigration } from './037-coursework-completion';
import { courseTutorMigration } from './038-course-tutor';
import { courseTutorGovernanceMigration } from './039-course-tutor-governance';
import { aiSupportSourceBindingsMigration } from './040-ai-support-source-bindings';
import { openMaicSingleActivityMigration } from './041-openmaic-single-activity';
import { independentOpenMaicActivitiesMigration } from './042-independent-openmaic-activities';
import { openMaicActivityTypesMigration } from './043-openmaic-activity-types';
import { coursePeerMigration } from './044-course-peer';
import { monitorClosedLoopMigration } from './045-monitor-closed-loop';
import { monitorTeacherNotificationsMigration } from './046-monitor-teacher-notifications';
import { teachingAnalyticsOptimizationMigration } from './047-teaching-analytics-optimization';
import { teachingAnalysisJobsMigration } from './048-teaching-analysis-jobs';
import { virtualLabPersistenceMigration } from './049-virtual-lab-persistence';

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
  emaAnalysisJobsMigration,
  learningEventsPartitioningMigration,
  multiAgentCollaborationMigration,
  postgresClassroomDocumentsMigration,
  agentOperationsMigration,
  assessmentGradesMigration,
  gradeGovernanceMigration,
  riskInterventionMigration,
  riskGovernanceMigration,
  oucOrganizationIdentityMigration,
  oucCourseRegistrationMigration,
  oucImportAccessFixesMigration,
  globalAccountUniquenessMigration,
  separateIdentityImportsMigration,
  importOrganizationFromSourceMigration,
  administrativeClassImportMigration,
  courseClassGroupingMigration,
  studentCourseAccessMigration,
  unifiedCourseStructureMigration,
  courseActivityGovernanceMigration,
  courseContentDiscussionsMigration,
  courseworkCompletionMigration,
  courseTutorMigration,
  courseTutorGovernanceMigration,
  aiSupportSourceBindingsMigration,
  openMaicSingleActivityMigration,
  independentOpenMaicActivitiesMigration,
  openMaicActivityTypesMigration,
  coursePeerMigration,
  monitorClosedLoopMigration,
  monitorTeacherNotificationsMigration,
  teachingAnalyticsOptimizationMigration,
  teachingAnalysisJobsMigration,
  virtualLabPersistenceMigration,
];

export type { ZhibanMigration } from './001-initial-identity';
