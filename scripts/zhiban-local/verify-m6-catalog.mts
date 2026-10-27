import { verifyPg18Boundaries } from '../zhiban-deploy/verify-pg18-boundaries';
import {
  localPgMajor,
  localPgBin,
  pg18Origin,
  pg18Reference,
  executionEvidence,
} from './pg-version';
import { verifyCourseResults } from './verify-course-results';
import { CourseResultsService } from '../../lib/zhiban/infrastructure/course-results/service';
import { courseResultsHttp } from '../../lib/zhiban/infrastructure/course-results/http';
import { verifyServiceCenter } from './verify-service-center';
import { initializeServiceCenter } from '../../lib/zhiban/infrastructure/service-center/config';
import { ServiceCenter } from '../../lib/zhiban/infrastructure/service-center/service';
import { serviceCenterHttp } from '../../lib/zhiban/infrastructure/service-center/http';
import { authoringHttp } from '../../lib/zhiban/infrastructure/authoring/http';
import { classroomAiHttp } from '../../lib/zhiban/infrastructure/classroom-ai/http';
import { createStartupDiagnostics } from '../zhiban-ci/startup-diagnostics.cjs';
const startup = createStartupDiagnostics('HOST');
process.on('uncaughtExceptionMonitor', (error) => startup.fail(error));
import { AttainmentService } from '../../lib/zhiban/application/attainment/service';
import { createAttainmentHttp } from '../../lib/zhiban/infrastructure/attainment/http';
import { AutoGradeService } from '../../lib/zhiban/application/autograde/service';
import { createAutoGradeHttp } from '../../lib/zhiban/infrastructure/autograde/http';
import { AutoGradeWorker } from '../../lib/zhiban/infrastructure/autograde/worker';
import { nativeAutoEngine } from '../../lib/zhiban/infrastructure/autograde/native';
import { loadAttainment } from './attainment';
import { loadAutograde } from './autograde';
import { verifyAttainment } from './verify-attainment';
const attainmentFocus = process.argv.includes('--attainment-focus');
import { EmaService } from '../../lib/zhiban/application/ema/service';
import { createEmaHttp } from '../../lib/zhiban/infrastructure/ema/http';
import { nativeEmaEngine } from '../../lib/zhiban/infrastructure/ema/native';
import { loadEma } from './ema';
import { verifyEma } from './verify-ema';
const emaFocus = process.argv.includes('--ema-focus');
import { verifyPbl } from './verify-pbl';
import { PblService } from '../../lib/zhiban/application/pbl/service';
import { createPblHttp } from '../../lib/zhiban/infrastructure/pbl/http';
import { loadPbl } from './pbl';
const pblFocus = process.argv.includes('--pbl-focus');
import { verifyFlow } from './verify-flow';
import { verifySimulation } from './verify-simulation';
const simulationFocus = process.argv.includes('--simulation-focus');
const flowFocus = process.argv.includes('--flow-focus') || simulationFocus;
import { FlowService } from '../../lib/zhiban/application/flow/service';
import { createFlowHttp } from '../../lib/zhiban/infrastructure/flow/http';
import { loadFlow } from './flow';
import { saveSnapshot, restoreLatest, privateEntry } from './persistent-snapshot';
import type { MemberControlConfig } from './member-authority';
const resourcesFocus = process.argv.includes('--resources-focus');
import { loadMaterialParserProfile } from '../../lib/zhiban/infrastructure/material/config';
import { QuizAdviceService } from '../../lib/zhiban/application/quiz/advice';
import { nativeQuizAdvisor } from '../../lib/zhiban/infrastructure/quiz/advisor';
import { QuizService } from '../../lib/zhiban/application/quiz/service';
import { FinalGradeService } from '../../lib/zhiban/application/finalgrade/service';
import { loadFinalgrade } from './finalgrade';
import { verifyAvatar } from './verify-avatar';
const avatarFocus = process.argv.includes('--avatar-focus');
import { verifyGradebookExport } from './verify-gradebook-export';
const gradebookExportFocus = process.argv.includes('--gradebook-export-focus');
import { ImportsService } from '../../lib/zhiban/application/imports/service';
import { createImportsHttp } from '../../lib/zhiban/infrastructure/imports/http';
import { loadImports } from './imports';
import { verifyImports } from './verify-imports';
const importsFocus = process.argv.includes('--imports-focus');
import {
  LoginIdentifiers,
  memberLoginIdentifierReader,
} from '../../lib/zhiban/infrastructure/login-identifiers/service';
import { createLoginIdentifiersHttp } from '../../lib/zhiban/infrastructure/login-identifiers/http';
import { loadLoginIdentifiers } from './login-identifiers';
import { verifyLoginIdentifiers } from './verify-login-identifiers';
const loginIdentifiersFocus = process.argv.includes('--login-identifiers-focus');
import { memberGlobalStatusReader } from '../../lib/zhiban/infrastructure/profile/global-status';
import { verifyAccountStatus } from './verify-account-status';
const accountStatusFocus = process.argv.includes('--account-status-focus');
import { AccountRequestService } from '../../lib/zhiban/application/onboarding/service';
import { createAccountRequestHttp } from '../../lib/zhiban/infrastructure/onboarding/request-http';
import { createAccountSetupHttp } from '../../lib/zhiban/infrastructure/onboarding/setup-http';
import { OrdinaryCredentials } from '../../lib/zhiban/infrastructure/onboarding/credentials';
import { loadOnboarding } from './onboarding';
import { verifyOnboarding } from './verify-onboarding';
const onboardingFocus = process.argv.includes('--onboarding-focus');
import { TutorService } from '../../lib/zhiban/application/tutor/service';
import { createTutorHttp } from '../../lib/zhiban/infrastructure/tutor/http';
import { nativeTutorEngine } from '../../lib/zhiban/infrastructure/tutor/native';
import { tutorContent } from '../../lib/zhiban/infrastructure/tutor/content';
import { loadTutor } from './tutor';
import { verifyTutor } from './verify-tutor';
const tutorFocus = process.argv.includes('--tutor-focus');
import { LearnerService } from '../../lib/zhiban/application/learner/service';
import { createLearnerHttp } from '../../lib/zhiban/infrastructure/learner/http';
import { loadLearner } from './learner';
import { verifyLearner } from './verify-learner';
const learnerFocus = process.argv.includes('--learner-focus');
import { ConceptService } from '../../lib/zhiban/application/concept/service';
import { createConceptHttp } from '../../lib/zhiban/infrastructure/concept/http';
import { loadConcept } from './concept';
import { verifyConcept } from './verify-concept';
const conceptFocus = process.argv.includes('--concept-focus');
import { RiskService } from '../../lib/zhiban/application/risk/service';
import { createRiskHttp } from '../../lib/zhiban/infrastructure/risk/http';
import { loadRisk } from './risk';
import { verifyRisk } from './verify-risk';
const riskFocus = process.argv.includes('--risk-focus');
import { RemediationService } from '../../lib/zhiban/application/remediation/service';
import { createRemediationHttp } from '../../lib/zhiban/infrastructure/remediation/http';
import { loadRemediation } from './remediation';
import { verifyRemediation } from './verify-remediation';
const remediationFocus = process.argv.includes('--remediation-focus');
import { ReminderService } from '../../lib/zhiban/application/reminder/service';
import { createReminderHttp } from '../../lib/zhiban/infrastructure/reminder/http';
import { loadReminder } from './reminder';
import { verifyReminders } from './verify-reminders';
const remindersFocus = process.argv.includes('--reminders-focus');
import { verifyFollowupCases } from './verify-followup-cases';
const casesFocus = process.argv.includes('--followup-cases-focus');
import { loadFollowup } from './followup';
import { verifyFollowups } from './verify-followups';
const followupsFocus = process.argv.includes('--followups-focus');
import { verifyClassroomResults } from './verify-classroom-results';
const resultsFocus = process.argv.includes('--classroom-results-focus');
import { verifyJointClassroom } from './verify-joint-classroom';
const jointFocus = process.argv.includes('--joint-classroom-focus');
import { verifyAttemptRuntime } from './verify-attempt-runtime';
const attemptRuntimeFocus = process.argv.includes('--attempt-runtime-focus');
import { verifyInteractive } from './verify-interactive';
const interactiveFocus = process.argv.includes('--interactive-focus');
import { verifyNativePlayer } from './verify-native-player';
import { verifyNativeClassroom } from './verify-native-classroom';
import { verifyNativeAuthoring } from './verify-native-authoring';
import { verifyClassroomAi } from './verify-classroom-ai';
import { verifyCourseLive } from './verify-course-live';
const pg18Acceptance = process.argv.includes('--pg18-acceptance');
const courseLiveFocus = process.argv.includes('--course-live-focus');
import { verifyNativePbl } from './verify-native-pbl';
import { verifyMultimodal } from './verify-multimodal';
const courseResultsFocus = process.argv.includes('--course-results-focus');
const serviceCenterFocus = process.argv.includes('--service-center-focus');
const multimodalFocus = process.argv.includes('--multimodal-focus');
import { verifyNativeArchive } from './verify-native-archive';
const nativeArchiveFocus = process.argv.includes('--native-archive-focus');
const nativePblFocus = process.argv.includes('--native-pbl-focus');
const authoringFocus = process.argv.includes('--authoring-focus');
const classroomAiFocus = process.argv.includes('--classroom-ai-focus');
const nativeClassroomFocus = process.argv.includes('--native-classroom-focus');
const playerFocus = process.argv.includes('--native-player-focus') || nativeClassroomFocus;
import { verifyLesson } from './verify-lesson';
const productFocus = process.argv.includes('--lesson-product-focus');
const lessonFocus = productFocus || process.argv.includes('--lesson-focus');
const directedFocus =
  pg18Acceptance ||
  classroomAiFocus ||
  authoringFocus ||
  attainmentFocus ||
  emaFocus ||
  pblFocus ||
  flowFocus ||
  resourcesFocus ||
  avatarFocus ||
  lessonFocus ||
  playerFocus ||
  interactiveFocus ||
  attemptRuntimeFocus ||
  jointFocus ||
  resultsFocus ||
  followupsFocus ||
  casesFocus ||
  remindersFocus ||
  remediationFocus ||
  riskFocus ||
  conceptFocus ||
  learnerFocus ||
  tutorFocus ||
  onboardingFocus ||
  accountStatusFocus ||
  loginIdentifiersFocus ||
  importsFocus;
import { verifyPresentation } from './verify-presentation';
import { installLesson } from './lesson';
import { contentHttp } from '../../lib/zhiban/infrastructure/content/http';
import { loadTeacherRelationships } from './teaching';
import { verifyTeacherScope } from './verify-teacher-scope';
const teacherScope = process.argv.includes('--teacher-scope');
const memberFocus = process.argv.includes('--member-focus');
import { verifyMembers } from './verify-members';
import { createLocalAuthority, localAuthorityStore, writeControlConfig } from './member-authority';
import { verifyExports } from './verify-exports';
import { MaterialService } from '../../lib/zhiban/application/material/service';
import { createMaterialHttp } from '../../lib/zhiban/infrastructure/material/http';
import { loadMaterial } from './material';
import { verifyMaterials } from './verify-materials';
import { ProfileService } from '../../lib/zhiban/application/profile/service';
import { createProfileHttp } from '../../lib/zhiban/infrastructure/profile/http';
import { loadProfile } from './profile';
import { verifyProfile } from './verify-profile';
import { verifyCourseQuiz } from './verify-course-quiz';
import { verifyUnifiedTrial } from './verify-unified-trial';
import { loadDiscussion } from './discussion';
import { verifyDiscussion } from './verify-discussion';
import { loadClamAv } from '../../lib/zhiban/infrastructure/learning-files/scanner/clamav';
import { syntheticSubmissionFileClearance } from './submission-file-fixtures';
import { verifySubmissionFiles } from './verify-submission-files';
import { loadSubmissionFiles } from './submission-files';
import { verifyGradebookCsv } from './verify-gradebook-csv';
import { verifyGradebook } from './verify-gradebook';
import { verifyClassroomEdit } from './verify-classroom-edit';
import { verifyAuthorFlow } from './verify-author-flow';
import { verifySharedClassroom } from './verify-shared-classroom';
import { loadClassroom } from './classroom';
import { verifyCurriculum } from './verify-curriculum';
import { installTrialContent, loadTrialContent, upgradeRestoredContent } from './trial-content';
import { verifyTrialContent } from './verify-trial-content';
import { verifyClassroomFixes } from './verify-classroom-fixes';
import { verifyRosterTrial } from './verify-roster-trial';
import { verifyUatFixes } from './verify-uat-fixes';
import { prepareTrial } from './prepare-trial';
import { verifyManagementHistory } from './verify-management-history';
import { verifyCourseOwner } from './verify-course-owner';
import { WorkspaceService } from '../../lib/zhiban/application/workspace/service';
import { createWorkspaceHttp } from '../../lib/zhiban/infrastructure/workspace/http';
import { ManagementService } from '../../lib/zhiban/application/management/service';
import { createManagementHttp } from '../../lib/zhiban/infrastructure/management/http';
import {
  localAdminPageAsset,
  localCoursePageAsset,
  localPersonalPageAsset,
  localGradePageAsset,
  localLegacyEntryAsset,
  localSupportPageAsset,
  localAuthoringPageAsset,
  localStudentToolsPageAsset,
  localCourseAdministrationPageAsset,
  localOrdinaryEntryAsset,
  localRequestTarget,
} from './request-target';
import { DirectoryService } from '../../lib/zhiban/application/directory/service';
import { createDirectoryHttp } from '../../lib/zhiban/infrastructure/directory/http';
import { RosterService } from '../../lib/zhiban/application/roster/service';
import { createRosterHttp } from '../../lib/zhiban/infrastructure/roster/http';
import { ProgressService } from '../../lib/zhiban/application/progress/service';
import { createProgressHttp } from '../../lib/zhiban/infrastructure/progress/http';
/** LOCAL disposable PG16 product journey. Never reads development credentials or touches 55432/55433. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpsRequest } from 'node:https';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import { createIdentityComposition } from '../../lib/zhiban/infrastructure/identity/composition/root';
import { createIdentityHttp } from '../../lib/zhiban/infrastructure/identity/http/adapter';
import { IdentitySafeQueries } from '../../lib/zhiban/application/identity/use-cases/safe-queries';
import { catalogConfig } from '../../tests/zhiban/identity/authorization/fixtures';
import {
  purposes,
  admissionPolicyDigest,
  type AdmissionPurpose,
} from '../../lib/zhiban/infrastructure/identity/composition/admission';
import { IdentityIds } from '../../lib/zhiban/infrastructure/identity/composition/ids';
import { PostgresIdentityRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresTenantRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/tenant';
import { PostgresMembershipRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { PostgresCredentialRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { Argon2PasswordHasher } from '../../lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '../../lib/zhiban/infrastructure/identity/credentials/password-screening';
import {
  User,
  SystemAdminGrant,
  Tenant,
  Membership,
  RoleGrant,
  instant,
  tenantScope,
  selfScope,
} from '../../lib/zhiban/domain/identity/index';
import { tenantScopeContext } from '../../lib/zhiban/application/identity/ports/tenant-context';
import { privateFile, trustedDevelopmentCa, digest } from './config';
import { AcademicService } from '../../lib/zhiban/application/academic/service';
import { PostgresAcademicStore } from '../../lib/zhiban/infrastructure/academic/postgres/store';
import { createAcademicHttp } from '../../lib/zhiban/infrastructure/academic/http';
import { AnalyticsService } from '../../lib/zhiban/application/analytics/service';
import { createAnalyticsHttp } from '../../lib/zhiban/infrastructure/analytics/http';
import { LearningService } from '../../lib/zhiban/application/learning/service';
import { AssessmentService } from '../../lib/zhiban/application/assessment/service';
import { createLearningHttp } from '../../lib/zhiban/infrastructure/learning/http';
import { createAssessmentHttp } from '../../lib/zhiban/infrastructure/assessment/http';
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const unifiedTrial = process.argv.includes('--unified-trial');
if (directedFocus && (!unifiedTrial || process.argv.includes('--serve')))
  throw Error('Lesson fixture verification is non-serving LOCAL only');
if (teacherScope && !unifiedTrial)
  throw Error('Teacher scope requires explicit LOCAL unified composition');
if (memberFocus && (!unifiedTrial || process.argv.includes('--serve')))
  throw Error('Member focus is non-serving LOCAL verification only');
const trustedFiles = unifiedTrial || process.argv.includes('--trusted-files');
const attachments = trustedFiles || process.argv.includes('--submission-files');
if (gradebookExportFocus && (process.argv.includes('--serve') || unifiedTrial))
  throw Error('Gradebook export focus is standalone non-serving LOCAL verification only');
const gradebookCsv = gradebookExportFocus || process.argv.includes('--gradebook-csv');
const gradebook = attachments || gradebookCsv || process.argv.includes('--gradebook');
const classroomEdit = unifiedTrial || process.argv.includes('--classroom-edit');
const sharedClassroom = classroomEdit || process.argv.includes('--shared-classroom');
const serve = process.argv.includes('--serve'),
  adminWorkspace = process.argv.includes('--admin-workspace'),
  courseOwner = process.argv.includes('--course-owner'),
  history = process.argv.includes('--history'),
  trialContent = sharedClassroom || process.argv.includes('--trial-content'),
  classroomFixes = process.argv.includes('--classroom-fixes'),
  rosterTrial = process.argv.includes('--roster-trial'),
  uatRound2 = process.argv.includes('--uat-round2'),
  uatFixes = uatRound2 || process.argv.includes('--uat-fixes'),
  trial =
    gradebook ||
    trialContent ||
    classroomFixes ||
    rosterTrial ||
    uatFixes ||
    process.argv.includes('--trial'),
  evidenceName =
    localPgMajor === 18
      ? 'zhiban-pg18'
      : courseLiveFocus
        ? 'zhiban-course-live'
        : courseResultsFocus
          ? 'zhiban-course-results-harness'
          : serviceCenterFocus
            ? 'zhiban-service-center-harness'
            : multimodalFocus
              ? 'zhiban-multimodal'
              : nativeArchiveFocus
                ? 'zhiban-native-archive'
                : nativePblFocus
                  ? 'zhiban-native-pbl'
                  : classroomAiFocus
                    ? 'zhiban-classroom-ai'
                    : authoringFocus
                      ? 'zhiban-native-authoring'
                      : attainmentFocus
                        ? 'zhiban-attainment'
                        : emaFocus
                          ? 'zhiban-ema'
                          : pblFocus
                            ? 'zhiban-pbl'
                            : flowFocus
                              ? simulationFocus
                                ? 'zhiban-simulation'
                                : 'zhiban-flow'
                              : resourcesFocus
                                ? process.argv.includes('--resources-browser-continuation')
                                  ? 'zhiban-resources-bundle-continuation'
                                  : 'zhiban-resources-bundle'
                                : avatarFocus
                                  ? 'zhiban-avatar'
                                  : gradebookExportFocus
                                    ? 'zhiban-gradebook-export'
                                    : importsFocus
                                      ? 'zhiban-imports'
                                      : loginIdentifiersFocus
                                        ? 'zhiban-login-identifiers'
                                        : accountStatusFocus
                                          ? 'zhiban-account-status'
                                          : onboardingFocus
                                            ? 'zhiban-onboarding'
                                            : tutorFocus
                                              ? 'zhiban-tutor'
                                              : learnerFocus
                                                ? 'zhiban-learner'
                                                : conceptFocus
                                                  ? 'zhiban-concept'
                                                  : riskFocus
                                                    ? 'zhiban-risk'
                                                    : remediationFocus
                                                      ? 'zhiban-remediation'
                                                      : remindersFocus
                                                        ? 'zhiban-reminders'
                                                        : casesFocus
                                                          ? 'zhiban-followup-cases'
                                                          : followupsFocus
                                                            ? 'zhiban-teacher-followups'
                                                            : resultsFocus
                                                              ? 'zhiban-classroom-results'
                                                              : jointFocus
                                                                ? 'zhiban-joint-classroom'
                                                                : attemptRuntimeFocus
                                                                  ? 'zhiban-attempt-runtime'
                                                                  : interactiveFocus
                                                                    ? 'zhiban-interactive'
                                                                    : playerFocus
                                                                      ? nativeClassroomFocus
                                                                        ? 'zhiban-native-classroom'
                                                                        : 'zhiban-native-player'
                                                                      : productFocus
                                                                        ? 'zhiban-lesson-product'
                                                                        : lessonFocus
                                                                          ? 'zhiban-ai-lesson'
                                                                          : unifiedTrial
                                                                            ? 'zhiban-trial-content'
                                                                            : trustedFiles
                                                                              ? 'zhiban-trusted-files'
                                                                              : attachments
                                                                                ? 'zhiban-submission-files'
                                                                                : gradebookCsv
                                                                                  ? 'zhiban-gradebook-csv'
                                                                                  : gradebook
                                                                                    ? 'zhiban-gradebook'
                                                                                    : classroomEdit
                                                                                      ? 'zhiban-classroom-edit'
                                                                                      : sharedClassroom
                                                                                        ? 'zhiban-shared-classroom'
                                                                                        : trialContent
                                                                                          ? 'zhiban-trial-content'
                                                                                          : classroomFixes
                                                                                            ? 'zhiban-classroom-fixes'
                                                                                            : rosterTrial
                                                                                              ? 'zhiban-trial-roster-fixes'
                                                                                              : uatRound2
                                                                                                ? 'zhiban-trial-uat2-fixes'
                                                                                                : uatFixes
                                                                                                  ? 'zhiban-uat-fixes'
                                                                                                  : trial
                                                                                                    ? 'zhiban-trial'
                                                                                                    : history
                                                                                                      ? 'm6-management-history'
                                                                                                      : courseOwner
                                                                                                        ? 'm6-course-owner'
                                                                                                        : adminWorkspace
                                                                                                          ? 'm6-admin-workspace'
                                                                                                          : 'm6-catalog',
  httpsPort =
    localPgMajor === 18
      ? 3478
      : classroomAiFocus ||
          authoringFocus ||
          attainmentFocus ||
          emaFocus ||
          pblFocus ||
          resourcesFocus ||
          nativeClassroomFocus ||
          simulationFocus
        ? 3468
        : unifiedTrial
          ? 3461
          : trustedFiles
            ? 3467
            : attachments
              ? 3466
              : gradebookCsv
                ? 3465
                : gradebook
                  ? 3464
                  : classroomEdit
                    ? 3463
                    : sharedClassroom
                      ? 3462
                      : trialContent
                        ? 3461
                        : uatFixes || rosterTrial || classroomFixes
                          ? 3460
                          : trial
                            ? 3459
                            : history
                              ? 3458
                              : courseOwner
                                ? 3457
                                : adminWorkspace
                                  ? 3453
                                  : 3450;
const root = process.cwd(),
  bin = localPgBin,
  port = unifiedTrial
    ? 56517
    : trustedFiles
      ? 56523
      : attachments
        ? 56522
        : gradebookCsv
          ? 56521
          : gradebook
            ? 56520
            : classroomEdit
              ? 56519
              : sharedClassroom
                ? 56518
                : trialContent
                  ? 56517
                  : uatFixes || rosterTrial || classroomFixes
                    ? 56516
                    : trial
                      ? 56515
                      : history
                        ? 56514
                        : courseOwner
                          ? 56513
                          : adminWorkspace
                            ? 56509
                            : 56506,
  database = unifiedTrial
    ? 'zhiban_trial_content_disposable'
    : trustedFiles
      ? 'zhiban_trusted_files_disposable'
      : attachments
        ? 'zhiban_submission_files_disposable'
        : gradebookCsv
          ? 'zhiban_gradebook_csv_disposable'
          : gradebook
            ? 'zhiban_gradebook_disposable'
            : classroomEdit
              ? 'zhiban_classroom_edit_disposable'
              : sharedClassroom
                ? 'zhiban_shared_classroom_disposable'
                : trialContent
                  ? 'zhiban_trial_content_disposable'
                  : uatFixes || rosterTrial || classroomFixes
                    ? 'zhiban_uat_fixes_disposable'
                    : trial
                      ? 'zhiban_trial_disposable'
                      : history
                        ? 'zhiban_m6_history_disposable'
                        : courseOwner
                          ? 'zhiban_m6_course_owner_disposable'
                          : adminWorkspace
                            ? 'zhiban_m6_admin_workspace_disposable'
                            : 'zhiban_m6_catalog_disposable';
const persistent = process.argv.includes('--persistent');
if (persistent && (!unifiedTrial || !serve))
  throw Error('Persistent mode is LOCAL unified serving only');
startup.enter('RESTORE_SNAPSHOT');
const restored = process.argv.includes('--resume') ? await restoreLatest() : null;
if (restored && !persistent) throw Error('Resume requires persistent mode');
let persistentMetadata: unknown = restored?.metadata;
const owned =
    restored?.root ??
    (await mkdtemp(join(tmpdir(), (unifiedTrial ? 'zhiban-trial-content' : evidenceName) + '-'))),
  data = join(owned, 'data'),
  socket = join(owned, 'socket');
if (serviceCenterFocus) {
  if (restored || persistent)
    throw Error('Service-center verification requires a fresh disposable environment');
  const fixture = join(owned, 'service-center-fixture.json');
  await writeFile(
    fixture,
    JSON.stringify({
      providers: {},
      slots: { llm: null, image: null, video: null, tts: null, asr: null, document: null },
      allowUserKeys: true,
    }),
    { mode: 0o600 },
  );
  process.env.OPENMAIC_CONFIG = fixture;
}
if (localPgMajor === 18 && process.env.ZHIBAN_LOCAL_STATE) {
  await privateEntry(process.env.ZHIBAN_LOCAL_STATE, true);
  await writeFile(
    join(process.env.ZHIBAN_LOCAL_STATE, 'RUNTIME.json'),
    JSON.stringify({
      kind: 'PG18_OWNED_RUNTIME_V1',
      root: owned,
      socket,
      port,
      major: 18,
      pid: process.pid,
      processStart: (await readFile(`/proc/${process.pid}/stat`, 'utf8'))
        .split(') ')[1]
        .trim()
        .split(/\s+/)[19],
      build: process.argv[1],
      buildSha256: hash(await readFile(process.argv[1])),
    }),
    { mode: 0o600 },
  );
}
const all: Pool[] = [],
  checks: string[] = [],
  sourceHashes: Record<string, string> = {};
const pool = (user = 'postgres', db = database) => {
  const p = new Pool({
    host: socket,
    port,
    database: db,
    user,
    max: 4,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  all.push(p);
  return p;
};
const record = (s: string) => {
  const label = localPgMajor === 18 ? s.replaceAll('PG16', 'PG18') : s;
  checks.push(label);
  console.log('PASS', label);
};
const lessonCleanups: (() => Promise<void>)[] = [];
let lessonHost: Awaited<ReturnType<typeof installLesson>> | null = null;
let started = false,
  server: ReturnType<typeof createServer> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
  failure: unknown,
  pg = 0;
type Actor = {
  uid: ReturnType<IdentityIds['nextUserId']>;
  password: string;
  member: string;
  grant: string;
  tenant: string;
  cookie?: string;
  csrf?: string;
};
async function main() {
  startup.enter('RESTORED_CONTROL');
  const restoredControl: MemberControlConfig | null = restored
    ? await (async () => {
        await privateEntry(join(owned, 'member-control.json'));
        const c = JSON.parse(await readFile(join(owned, 'member-control.json'), 'utf8'));
        if (
          c.kind !== 'LOCAL_SYNTHETIC_MEMBER_CONTROL' ||
          c.authority.root !== owned ||
          c.composition.origin !== (localPgMajor === 18 ? pg18Origin : 'https://127.0.0.1:3461')
        )
          throw Error('Restored control binding rejected');
        return c;
      })()
    : null;
  if (!restored) {
    await mkdir(socket, { mode: 0o700 });
    execFileSync(
      join(bin, 'initdb'),
      [
        '-D',
        data,
        '-U',
        'postgres',
        '--auth-local=trust',
        '--auth-host=reject',
        '--encoding=UTF8',
        '--no-locale',
      ],
      { stdio: 'pipe' },
    );
  }
  startup.enter('PG_START');
  execFileSync(
    join(bin, 'pg_ctl'),
    [
      '-D',
      data,
      '-l',
      join(owned, 'postgres.log'),
      '-o',
      `-p ${port} -k ${socket} -c listen_addresses=''`,
      '-w',
      'start',
    ],
    { stdio: 'pipe' },
  );
  started = true;
  const master = pool('postgres', 'postgres');
  if (!restored) {
    await master.query(`CREATE DATABASE ${database}`);
    for (const f of ['bootstrap-roles.pg16.sql', 'bootstrap-bridge-roles.pg16.sql']) {
      const file = resolve(
        localPgMajor === 18
          ? 'docs/v2/candidates/pg18-provider-v1/' + f.replace('pg16', 'pg18')
          : 'lib/zhiban/infrastructure/identity/postgres/' + f,
      );
      sourceHashes[file] = hash(await readFile(file));
      execFileSync(
        join(bin, 'psql'),
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          socket,
          '-p',
          String(port),
          '-U',
          'postgres',
          '-d',
          database,
          '-f',
          file,
        ],
        { stdio: 'pipe' },
      );
    }
  }
  startup.enter('DB_VERSION');
  const admin = pool();
  pg = Number((await admin.query("SELECT current_setting('server_version_num') AS v")).rows[0].v);
  assert.ok(pg >= localPgMajor * 10000 && pg < (localPgMajor + 1) * 10000);
  if (localPgMajor === 18) await pg18Reference();
  if (unifiedTrial && (!restored || process.argv.includes('--upgrade-local'))) {
    startup.enter('LOCAL_DB_BOOTSTRAP');
    const bootstrap = resolve('scripts/zhiban-local/autograde-bootstrap.sql');
    sourceHashes[bootstrap] = hash(await readFile(bootstrap));
    execFileSync(
      join(bin, 'psql'),
      [
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        socket,
        '-p',
        String(port),
        '-U',
        'postgres',
        '-d',
        database,
        '-f',
        bootstrap,
      ],
      { stdio: 'pipe' },
    );
  }
  if (!restored) {
    await admin.query(
      'CREATE ROLE zhiban_academic_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',
    );
    for (const ctx of [
      'identity',
      'academic',
      'learning',
      'assessment',
      'curriculum',
      'classroom',
      ...(attachments ? ['learning-files'] : []),
      ...(unifiedTrial
        ? [
            'discussion',
            'profile',
            'material',
            'teaching',
            'followup',
            'reminder',
            'remediation',
            'risk',
            'concept',
            'learner',
            'tutor',
            'onboarding',
            'login-identifiers',
            'imports',
            'finalgrade',
            'flow',
            'pbl',
            'ema',
            'attainment',
            'autograde',
          ]
        : []),
    ]) {
      const dir = resolve(`lib/zhiban/infrastructure/${ctx}/postgres/migrations`);
      for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
        const file = join(dir, f),
          sql = await readFile(file, 'utf8');
        sourceHashes[file] = hash(sql);
        await admin.query('BEGIN');
        await admin.query('SET LOCAL ROLE zhiban_identity_owner');
        await admin.query(sql);
        await admin.query(
          `INSERT INTO zhiban_${ctx.replaceAll('-', '_')}.schema_migrations VALUES($1,$2)`,
          [f.slice(0, 4), hash(sql)],
        );
        await admin.query('COMMIT');
      }
    }
  }
  if (
    restored &&
    (process.argv.includes('--upgrade-resources') || process.argv.includes('--upgrade-local'))
  ) {
    startup.enter('MIGRATION_CHECK');
    for (const [ctx, file] of [
      ['material', '0002_resource_formats.sql'],
      ['learning-files', '0004_attachment_formats.sql'],
      ...(process.argv.includes('--upgrade-local')
        ? [
            ['tutor', '0002_peer.sql'],
            ['flow', '0001_flow.sql'],
            ['flow', '0002_simulation.sql'],
            ['pbl', '0001_pbl.sql'],
            ['ema', '0001_ema.sql'],
            ['attainment', '0001_attainment.sql'],
            ['autograde', '0001_autograde.sql'],
            ['autograde', '0002_worker.sql'],
          ]
        : []),
    ]) {
      const schema = `zhiban_${ctx.replaceAll('-', '_')}`;
      const sql = await readFile(
        resolve(`lib/zhiban/infrastructure/${ctx}/postgres/migrations/${file}`),
        'utf8',
      );
      const existing = (
        await admin.query('SELECT to_regclass($1) AS r', [schema + '.schema_migrations'])
      ).rows[0].r;
      const old = existing
        ? await admin.query(`SELECT * FROM ${schema}.schema_migrations WHERE version=$1`, [
            file.slice(0, 4),
          ])
        : { rowCount: 0, rows: [] };
      if (old.rowCount) {
        if (old.rows[0].checksum !== hash(sql)) throw Error('Applied migration source mismatch');
        continue;
      }
      await admin.query('BEGIN');
      try {
        await admin.query('SET LOCAL ROLE zhiban_identity_owner');
        await admin.query(sql);
        await admin.query(`INSERT INTO ${schema}.schema_migrations VALUES($1,$2)`, [
          file.slice(0, 4),
          hash(sql),
        ]);
        await admin.query('COMMIT');
      } catch (e) {
        await admin.query('ROLLBACK');
        throw e;
      }
    }
    startup.enter('CONTENT_REBIND');
    await upgradeRestoredContent({
      owned,
      socket,
      pool,
      certificateHash: hash(await privateFile('localhost.crt')),
    });
  }
  startup.enter('CONTENT_LOAD');
  const contentInstallation = restored
    ? (JSON.parse(await readFile(join(owned, 'content-installation.json'), 'utf8')) as Awaited<
        ReturnType<typeof installTrialContent>
      >)
    : trialContent
      ? await installTrialContent({
          admin,
          master,
          pool,
          owned,
          socket,
          sourceHashes,
          record,
          certificateHash: hash(await privateFile('localhost.crt')),
        })
      : null;
  startup.enter('IDENTITY_COMPOSITION');
  const now = Date.now();
  const bridge = pool('zhiban_bridge_runtime');
  const auth = pool('zhiban_auth_runtime'),
    tenantPool = pool('zhiban_runtime'),
    control = pool('zhiban_control_runtime');
  const policyDigests = {} as Record<AdmissionPurpose, string>;
  const admission = restoredControl
    ? {
        ...restoredControl.composition.admission,
        policyDigests: { ...restoredControl.composition.admission.policyDigests },
        hmacKey: Buffer.from(restoredControl.composition.admission.hmacKey, 'hex'),
      }
    : {
        environment: 'LOCAL_M6_CATALOG_DISPOSABLE',
        approvalRef: 'LOCAL_M6_CATALOG_USER_REQUEST',
        hmacKey: randomBytes(32),
        policyDigests,
      };
  if (!restored)
    for (const purpose of purposes) {
      const initial = purpose === 'INITIAL_PROVISION';
      const policy = {
        purpose,
        approval_ref: admission.approvalRef,
        environment_ref: admission.environment,
        created_at: String(now),
        window_ms: '60000',
        global_limit: accountStatusFocus || loginIdentifiersFocus ? '1000' : '100',
        ip_limit: initial ? null : accountStatusFocus || loginIdentifiersFocus ? '300' : '30',
        locator_limit: initial ? null : accountStatusFocus || loginIdentifiersFocus ? '200' : '15',
        pair_limit: initial ? null : accountStatusFocus || loginIdentifiersFocus ? '200' : '15',
        user_limit:
          purpose === 'LOGIN' ? null : accountStatusFocus || loginIdentifiersFocus ? '200' : '15',
        max_buckets: '1000',
      };
      const digest = admissionPolicyDigest(policy);
      admission.policyDigests[purpose] = digest;
      await admin.query(
        'INSERT INTO zhiban_identity.admission_policies VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [purpose, digest, ...Object.values(policy).slice(1)],
      );
      await admin.query('INSERT INTO zhiban_identity.admission_gate(purpose) VALUES($1)', [
        purpose,
      ]);
    }
  const ids = new IdentityIds(),
    users = new PostgresIdentityRepository(control),
    tenants = new PostgresTenantRepository(control),
    members = new PostgresMembershipRepository(tenantPool),
    credentials = new PostgresCredentialRepository(auth);
  const corpus = ['local-compromised-vector'],
    hasher = new Argon2PasswordHasher(new LocalCompromisedPasswordScreening(corpus));
  const t = (restored?.metadata?.trial?.tenantId ?? ids.nextTenantId()) as ReturnType<
      IdentityIds['nextTenantId']
    >,
    otherTenant = ids.nextTenantId();
  if (!restored)
    for (const [id, code] of [
      [t, trial ? 'trial' : 'analytics'],
      [otherTenant, 'other'],
    ])
      await tenants.create(
        Tenant.create(
          id as ReturnType<IdentityIds['nextTenantId']>,
          code,
          trial && id === t ? '智伴本地试用' : code,
          instant(Date.now()),
        ),
      );
  const actors: Actor[] = [];
  if (!restored)
    for (const [role, tid] of [
      ['TEACHER', t],
      ['STUDENT', t],
      ['TENANT_ADMIN', t],
      ['TENANT_ADMIN', otherTenant],
      ['TENANT_ADMIN', t],
      ['STUDENT', t],
      ['STUDENT', t],
      ['STUDENT', t],
      ['STUDENT', t],
      ['STUDENT', t],
      ['STUDENT', t],
      ['STUDENT', t],
      ['STUDENT', t],
    ] as const) {
      const uid = ids.nextUserId(),
        password = randomBytes(24).toString('base64url');
      await users.create(User.create(uid, instant(Date.now())));
      await credentials.createPassword(
        uid,
        ids.nextCredentialId(),
        await hasher.hash(password),
        instant(Date.now()),
        {
          actor: { kind: 'SERVICE', serviceCode: 'local_m6_seed' },
          requestId: 'LOCAL_M6_CATALOG_SEED',
          reason: 'SYSTEM_MAINTENANCE',
        },
      );
      const grant = RoleGrant.create({
        id: ids.nextRoleGrantId(),
        roleCode: role,
        scope: role === 'STUDENT' ? selfScope() : tenantScope(),
        createdAt: instant(now),
        validFrom: instant(now),
        validUntil: null,
      });
      const member = Membership.create({
        id: ids.nextMembershipId(),
        userId: uid,
        tenantId: tid,
        now: instant(now),
      }).activatePending({
        expectedAuthorizationVersion: 0,
        now: instant(now),
        approvedGrants: [grant],
      });
      await members.create(tenantScopeContext(tid), member);
      actors.push({ uid, password, member: member.id, grant: grant.id, tenant: tid });
    }
  const [teacher, student, outsider, foreign, manager] = actors;
  if (adminWorkspace) {
    const grant = RoleGrant.create({
      id: ids.nextRoleGrantId(),
      roleCode: 'TENANT_ADMIN',
      scope: tenantScope(),
      createdAt: instant(now),
      validFrom: instant(now),
      validUntil: null,
    });
    await members.create(
      tenantScopeContext(otherTenant),
      Membership.create({
        id: ids.nextMembershipId(),
        userId: manager.uid,
        tenantId: otherTenant,
        now: instant(now),
      }).activatePending({
        expectedAuthorizationVersion: 0,
        now: instant(now),
        approvedGrants: [grant],
      }),
    );
  }
  const authOnly: Actor[] = [];
  let localOperator: { uid: string; password: string; grant: string } | null = null;
  if (unifiedTrial && !restored) {
    for (let i = 0; i < 3; i++) {
      const uid = ids.nextUserId(),
        password = randomBytes(24).toString('base64url');
      await users.create(User.create(uid, instant(Date.now())));
      await credentials.createPassword(
        uid,
        ids.nextCredentialId(),
        await hasher.hash(password),
        instant(Date.now()),
        {
          actor: { kind: 'SERVICE', serviceCode: 'local_m6_seed' },
          requestId: 'LOCAL_MEMBER_SYNTHETIC_SEED',
          reason: 'SYSTEM_MAINTENANCE',
        },
      );
      if (i === 0) {
        const g = SystemAdminGrant.create({
          id: ids.nextSystemAdminGrantId(),
          userId: uid,
          createdAt: instant(now),
          validFrom: instant(now),
          validUntil: null,
        });
        await users.createSystemAdminGrant(g);
        localOperator = { uid, password, grant: g.id };
      } else {
        const a = { uid, password, member: '', grant: '', tenant: t };
        authOnly.push(a);
        if (i === 1) {
          const g = RoleGrant.create({
            id: ids.nextRoleGrantId(),
            roleCode: 'STUDENT',
            scope: selfScope(),
            createdAt: instant(now),
            validFrom: instant(now),
            validUntil: null,
          });
          await members.create(
            tenantScopeContext(otherTenant),
            Membership.create({
              id: ids.nextMembershipId(),
              userId: uid,
              tenantId: otherTenant,
              now: instant(now),
            }).activatePending({
              expectedAuthorizationVersion: 0,
              now: instant(now),
              approvedGrants: [g],
            }),
          );
        }
      }
    }
  }
  const course = v7(),
    term = v7(),
    offering = v7(),
    otherOffering = v7(),
    emptyOffering = v7();
  if (!trial && !restored) {
    await admin.query(
      "INSERT INTO zhiban_academic.courses VALUES($1,$2,'M6','机电基础','',NULL,'PUBLISHED',1,1,$3,$3)",
      [t, course, now],
    );
    await admin.query(
      "INSERT INTO zhiban_academic.course_versions VALUES($1,$2,1,'机电基础','',NULL,$3)",
      [t, course, now],
    );
    await admin.query(
      "INSERT INTO zhiban_academic.terms VALUES($1,$2,'TERM','本地学期','2026-10-01','2027-01-01',1)",
      [t, term],
    );
    for (const o of [offering, otherOffering, emptyOffering])
      await admin.query(
        "INSERT INTO zhiban_academic.offerings VALUES($1,$2,$3,1,$4,NULL,$5,$6,20,'OPEN',1)",
        [
          t,
          o,
          course,
          term,
          o,
          o === offering ? '机电一班' : o === emptyOffering ? '空班示例' : '其他任教班',
        ],
      );
    await admin.query(
      "INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
      [t, v7(), offering, teacher.member, now],
    );
    await admin.query(
      "INSERT INTO zhiban_academic.assignments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
      [t, v7(), emptyOffering, teacher.member, now],
    );
    await admin.query(
      "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
      [t, v7(), offering, student.member, now],
    );
  }
  const extraStudents = actors.slice(5);
  for (const [i, a] of extraStudents.entries()) {
    if (!trial)
      await admin.query(
        "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
        [t, v7(), offering, a.member, now],
      );
    await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
      t,
      a.member,
      ['李明', '王悦', '历史学生', '待入班学生', '周宁', '孙悦', '批量学生甲', '批量学生乙'][i],
    ]);
  }
  if (!restored)
    await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
      t,
      student.member,
      '陈晓',
    ]);
  const origin = `https://127.0.0.1:${httpsPort}`;
  startup.enter('TLS_LOAD');
  const tls = await privateFile('localhost.crt'),
    key = await privateFile('localhost.key'),
    ca = await trustedDevelopmentCa();
  const bound = JSON.parse((await privateFile('receipt.json')).toString());
  assert.equal(digest(tls.toString()), bound.certificateHash);
  const authority =
    restoredControl?.authority ??
    (unifiedTrial ? await createLocalAuthority(owned, admission.environment) : null);
  const memberPolicy = {
    environmentRef: admission.environment,
    approvalRef: 'LOCAL_SYNTHETIC_MEMBER_PRODUCT',
    tenantRecordCapacity: 10000,
    controlRecordCapacity: 10000,
    sourceTtlMs: 1800000,
  };
  const identityConfig = {
    origin,
    sessionPolicy: { absoluteMs: 28800000, idleMs: 1800000 },
    catalog: catalogConfig(),
    admission,
    corpus: {
      approvalRef: 'LOCAL_TEST_ONLY',
      expectedDigest: hash(JSON.stringify(corpus)),
      values: corpus,
    },
    operator: null,
    membership: authority
      ? { policy: memberPolicy, operator: localAuthorityStore(authority) }
      : null,
    transportApprovalRef: 'LOCAL_DIRECT_TLS',
    deployment: 'SINGLE_PROCESS_HTTPS' as const,
  };
  const teaching = unifiedTrial ? await loadTeacherRelationships(tenantPool) : null;
  const composition = await createIdentityComposition(
    { auth, tenant: tenantPool, control },
    identityConfig,
    { teacherRelationships: teaching?.loader },
  );
  if (authority && localOperator) {
    const path = join(owned, 'member-control.json');
    sourceHashes[path] = await writeControlConfig(path, {
      kind: 'LOCAL_SYNTHETIC_MEMBER_CONTROL',
      authority,
      teacherRelationshipFingerprint: teaching?.fingerprint,
      operator: localOperator,
      composition: {
        ...identityConfig,
        admission: { ...admission, hmacKey: admission.hmacKey.toString('hex') },
        membership: { policy: memberPolicy },
      },
    });
  }
  const facade = createIdentityHttp(
    async () => ({
      ...composition,
      queries:
        composition.queries ??
        new IdentitySafeQueries({
          passwordState: (h) => composition.security.passwordState(h),
          member: async () => {
            throw Error('Closed');
          },
          consentContext: async () => {
            throw Error('Closed');
          },
        }),
    }),
    { origin, concurrentRequests: 8, bodyTimeoutMs: 3000, retryAfterSeconds: 1 },
  );
  const businessPool = pool('zhiban_academic_runtime');
  const store = new PostgresAcademicStore(
    businessPool,
    bridge,
    tenantPool,
    composition.security.bridgeSecurity(),
    pblFocus || conceptFocus || learnerFocus || tutorFocus || onboardingFocus || importsFocus
      ? (phase, code, ms) => console.log('LOCAL directed store refusal', phase, code, ms)
      : undefined,
  );
  const httpManagement = createManagementHttp(
    new AcademicService(store),
    new ManagementService(store),
    composition.security,
    origin,
  );
  const httpWorkspace = createWorkspaceHttp(
    new WorkspaceService(store),
    composition.security,
    origin,
  );
  const httpAcademic = createAcademicHttp(new AcademicService(store), composition.security, origin);
  if (sharedClassroom)
    assert.equal(
      await loadClassroom(businessPool, unifiedTrial && !!contentInstallation?.jointHash),
      true,
    );
  const profileEnabled = unifiedTrial && (await loadProfile(businessPool));
  if (unifiedTrial) assert.equal(profileEnabled, true);
  const identifiersEnabled = unifiedTrial && (await loadLoginIdentifiers(auth));
  const identifiers = new LoginIdentifiers(auth, composition, identifiersEnabled);
  const httpLoginIdentifiers = createLoginIdentifiersHttp(identifiers, composition, origin);
  const httpProfile = createProfileHttp(
    new ProfileService(
      store,
      memberGlobalStatusReader(auth),
      identifiersEnabled ? memberLoginIdentifierReader(auth) : undefined,
    ),
    composition.security,
    origin,
    undefined,
    profileEnabled,
  );
  const discussionEnabled = unifiedTrial && (await loadDiscussion(businessPool));
  if (unifiedTrial) assert.equal(discussionEnabled, true);
  const materialEnabled = unifiedTrial && (await loadMaterial(businessPool));
  if (unifiedTrial) assert.equal(materialEnabled, true);
  const scanner =
    trustedFiles && (localPgMajor === 16 || Boolean(process.env.ZHIBAN_SCANNER_PROFILE))
      ? await loadClamAv(
          process.env.ZHIBAN_SCANNER_PROFILE ?? '',
          process.env.ZHIBAN_SCANNER_PROFILE_SHA256 ?? '',
        ).catch((error) => {
          if ((!serve && !loginIdentifiersFocus && !importsFocus && !avatarFocus) || !unifiedTrial)
            throw error;
          console.log(
            'LOCAL scanner unavailable: new attachment/material uploads remain closed; account and ordinary teaching pages continue. Existing scanner pins were not changed.',
          );
          return null;
        })
      : localPgMajor === 18 && trustedFiles
        ? null
        : attachments
          ? syntheticSubmissionFileClearance
          : null;
  const httpMaterial = createMaterialHttp(
    new MaterialService(store, scanner, await loadMaterialParserProfile()),
    composition.security,
    origin,
    undefined,
    materialEnabled,
  );
  const httpLearning = createLearningHttp(
    new LearningService(store, scanner, unifiedTrial && !!contentInstallation?.jointHash),
    composition.security,
    origin,
    undefined,
    (r) =>
      contentHost ? contentHost.http(r) : Promise.resolve(new Response(null, { status: 503 })),
    true,
    sharedClassroom,
    attachments,
    discussionEnabled,
    materialEnabled,
    (context, offering, resource, publication, work) => {
      if (!contentHost) throw new Error('Content host unavailable');
      return contentHost.service.withJointPublication(
        {
          handle: context.handle,
          tenant: context.tenantId,
          member: context.actorMembershipId,
          offering,
        },
        resource,
        publication,
        work,
      );
    },
  );
  if (attachments) assert.equal(await loadSubmissionFiles(businessPool), true);
  const finalgradeEnabled = unifiedTrial && (await loadFinalgrade(businessPool));
  const httpAssessment = createAssessmentHttp(
    new AssessmentService(store),
    composition.security,
    origin,
    undefined,
    attachments,
    new FinalGradeService(store, finalgradeEnabled),
    new QuizAdviceService(store, nativeQuizAdvisor),
  );
  const onboardingEnabled = unifiedTrial && (await loadOnboarding(businessPool));
  const httpAccountRequests = createAccountRequestHttp(
    new AccountRequestService(store, onboardingEnabled),
    composition.security,
    origin,
  );
  const ordinaryCredentials = new OrdinaryCredentials(auth, hasher, onboardingEnabled);
  const httpAccountSetup = createAccountSetupHttp(ordinaryCredentials, origin);
  let tutorHost: TutorService | null = null;
  let httpTutor: ((request: Request) => Promise<Response>) | null = null;
  const pblEnabled = unifiedTrial && (await loadPbl(businessPool));
  const httpPbl = createPblHttp(new PblService(store, pblEnabled), composition.security, origin);
  const flowEnabled = unifiedTrial && (await loadFlow(businessPool));
  const httpFlow = createFlowHttp(
    new FlowService(
      store,
      flowEnabled,
      flowEnabled
        ? createHash('sha256')
            .update(await readFile('lib/zhiban/domain/flow/simulation.ts'))
            .digest('hex')
        : undefined,
    ),
    composition.security,
    origin,
    undefined,
    async (request) => {
      if (!contentHost) return [];
      const u = new URL(request.url);
      const m = /^\/api\/zhiban\/flow\/([^/]+)\/offerings\/([^/]+)$/.exec(u.pathname);
      if (!m) return [];
      const r = await contentHost.http(
        new Request(`${origin}/api/zhiban/content/${m[1]}/offerings/${m[2]}`, {
          headers: request.headers,
          method: 'GET',
        }),
      );
      if (!r.ok) throw Error('Course content unavailable');
      return (await r.json()).resources;
    },
    (context, offering, resource, publication, work) => {
      if (!contentHost) throw Error('Content host unavailable');
      return contentHost.service.withJointPublication(
        {
          handle: context.handle,
          tenant: context.tenantId,
          member: context.actorMembershipId,
          offering,
        },
        resource,
        publication,
        work,
      );
    },
  );
  const attainmentEnabled = unifiedTrial && (await loadAttainment(businessPool));
  const autogradeEnabled = unifiedTrial && (await loadAutograde(businessPool));
  const workerPool = unifiedTrial ? pool('zhiban_autograde_worker') : null;
  const autoWorker = workerPool
    ? new AutoGradeWorker(workerPool, nativeAutoEngine, (code) =>
        record('AUTOGRADE_SERVICE_' + code),
      )
    : null;
  if (autoWorker) lessonCleanups.push(() => autoWorker.stop());
  const httpAttainment = createAttainmentHttp(
    new AttainmentService(store, attainmentEnabled),
    composition.security,
    origin,
  );
  const httpAutograde = autoWorker
    ? createAutoGradeHttp(
        new AutoGradeService(store, autoWorker, autogradeEnabled),
        composition.security,
        origin,
      )
    : null;
  const emaEnabled = unifiedTrial && (await loadEma(businessPool));
  const emaHost = new EmaService(store, nativeEmaEngine, emaEnabled);
  lessonCleanups.push(() => emaHost.stop());
  const httpEma = createEmaHttp(emaHost, composition.security, origin);
  const httpLearner = createLearnerHttp(
    new LearnerService(store, unifiedTrial && (await loadLearner(businessPool))),
    composition.security,
    origin,
  );
  const httpConcept = createConceptHttp(
    new ConceptService(store, unifiedTrial && (await loadConcept(businessPool))),
    composition.security,
    origin,
  );
  const httpRisk = createRiskHttp(
    new RiskService(store, unifiedTrial && (await loadRisk(businessPool))),
    composition.security,
    origin,
  );
  const httpRemediation = createRemediationHttp(
    new RemediationService(store, unifiedTrial && (await loadRemediation(businessPool))),
    composition.security,
    origin,
  );
  const httpReminders = createReminderHttp(
    new ReminderService(store, unifiedTrial && (await loadReminder(businessPool))),
    composition.security,
    origin,
  );
  const httpAnalytics = createAnalyticsHttp(
    new AnalyticsService(store, unifiedTrial && (await loadFollowup(businessPool))),
    composition.security,
    origin,
  );
  const httpImports = createImportsHttp(
    new ImportsService(store, unifiedTrial && (await loadImports(businessPool))),
    composition.security,
    origin,
  );
  const rosterService = new RosterService(store);
  const httpDirectory = createDirectoryHttp(
    new DirectoryService(store),
    composition.security,
    origin,
  );
  const httpRoster = createRosterHttp(rosterService, composition.security, origin);
  const httpProgress = createProgressHttp(new ProgressService(store), composition.security, origin);
  if (contentInstallation && !serve && !teacherScope && !directedFocus) {
    const args = {
      pool,
      security: composition.security,
      certificateHash: hash(tls),
      owned,
      socket,
    };
    await assert.rejects(
      loadTrialContent({ ...contentInstallation, origin: 'https://127.0.0.1:3459' }, args),
    );
    const bytes = await readFile(contentInstallation.bundlePath);
    try {
      await writeFile(
        contentInstallation.bundlePath,
        Buffer.concat([bytes, Buffer.from('\n// fault')]),
      );
      await assert.rejects(loadTrialContent(contentInstallation, args), /receipt\/source mismatch/);
    } finally {
      await writeFile(contentInstallation.bundlePath, bytes);
    }
    await admin.query(`GRANT TEMP ON DATABASE ${database} TO zhiban_bridge_runtime`);
    try {
      await assert.rejects(loadTrialContent(contentInstallation, args), /Bridge endpoint rejected/);
    } finally {
      await admin.query(`REVOKE TEMP ON DATABASE ${database} FROM zhiban_bridge_runtime`);
    }
    record(
      'disposable content loader rejects wrong target, artifact hash and elevated Bridge ACL; restored state required before serving',
    );
  }
  const contentHost = contentInstallation
    ? await loadTrialContent(contentInstallation, {
        pool,
        security: composition.security,
        certificateHash: hash(tls),
        owned,
        socket,
      })
    : null;
  if (localPgMajor === 18 && pg18Acceptance && contentInstallation) {
    const bounded = (user: string, db = database) => {
      const p = new Pool({
        host: socket,
        port,
        user,
        database: db,
        max: 2,
        connectionTimeoutMillis: 1000,
      });
      all.push(p);
      return p;
    };
    await verifyPg18Boundaries({
      admin,
      bridge: bounded('zhiban_bridge_runtime'),
      native: bounded('zhiban_openmaic_runtime', contentInstallation.nativeDatabase),
      composition,
      receipt: contentInstallation,
      record,
    });
  }
  if (unifiedTrial && contentHost) {
    lessonHost = await installLesson({
      master,
      owned,
      socket,
      port,
      pool,
      content: contentHost.service,
      quizzes: new QuizService(store),
      resume: !!restored,
    });
    lessonCleanups.push(() => lessonHost!.close());
    tutorHost = new TutorService(
      store,
      tutorContent(contentHost.service),
      nativeTutorEngine,
      await loadTutor(businessPool),
    );
    httpTutor = createTutorHttp(tutorHost, composition.security, origin);
    lessonCleanups.push(() => tutorHost!.close());
    contentHost.http = contentHttp(contentHost.service, composition.security, origin, lessonHost);
  }
  const httpNativeAuthoring =
    lessonHost && contentHost
      ? authoringHttp(
          contentHost.service,
          lessonHost.authoringPool,
          composition.security,
          origin,
          scanner,
        )
      : null;
  if (lessonHost) await initializeServiceCenter(lessonHost.authoringPool);
  const httpServices = lessonHost
    ? serviceCenterHttp(
        new ServiceCenter(store, lessonHost.authoringPool),
        composition.security,
        origin,
      )
    : null;
  const httpCourseResults =
    lessonHost && contentHost
      ? courseResultsHttp(
          new CourseResultsService(store, lessonHost.authoringPool, contentHost.service),
          composition.security,
          origin,
        )
      : null;
  const httpClassroomAi =
    lessonHost && contentHost
      ? classroomAiHttp(contentHost.service, lessonHost.authoringPool, composition.security, origin)
      : null;
  startup.enter('SERVICE_COMPOSITION');
  let archiveUploads = 0;
  server = createServer({ key, cert: tls, maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    if (
      incoming.method === 'POST' &&
      (incoming.url?.includes('/archive/') || incoming.url?.includes('/media/upload'))
    ) {
      if (archiveUploads >= 2) {
        outgoing.writeHead(503, { 'Cache-Control': 'no-store' });
        outgoing.end();
        incoming.resume();
        return;
      }
      archiveUploads++;
      let released = false;
      outgoing.once('close', () => {
        if (!released) {
          released = true;
          archiveUploads--;
        }
      });
    }
    const abort = new AbortController();
    outgoing.once('close', () => abort.abort());
    const deadline = setTimeout(
      () => {
        abort.abort();
        outgoing.destroy();
      },
      incoming.url?.includes('/api/zhiban/service-center/') ||
        incoming.url?.includes('/api/zhiban/classroom-ai/') ||
        /\/native\/api\/(generate|transcription)/.test(incoming.url ?? '')
        ? 360000
        : incoming.url?.includes('/archive/')
          ? 180000
          : trustedFiles
            ? 75000
            : 10000,
    );
    outgoing.once('finish', () => clearTimeout(deadline));
    outgoing.once('close', () => clearTimeout(deadline));
    try {
      if (
        incoming.headers.host !== `127.0.0.1:${httpsPort}` ||
        incoming.socket.remoteAddress !== '127.0.0.1'
      ) {
        outgoing.writeHead(403);
        outgoing.end();
        return;
      }
      if (!localRequestTarget(incoming.url ?? '')) {
        outgoing.writeHead(403);
        outgoing.end();
        return;
      }
      const url = new URL(incoming.url!, origin);
      if (/^\/zhiban\/native-assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {
        const file = join(root, 'app/zhiban/local/native-assets', url.pathname.split('/').pop()!);
        try {
          const bytes = await readFile(file);
          outgoing.writeHead(200, {
            'Content-Type': file.endsWith('.woff2')
              ? 'font/woff2'
              : file.endsWith('.woff')
                ? 'font/woff'
                : file.endsWith('.svg')
                  ? 'image/svg+xml'
                  : 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
          });
          outgoing.end(bytes);
        } catch {
          outgoing.writeHead(404);
          outgoing.end();
        }
        return;
      }
      if (
        ['/logo-horizontal.png', '/logo.png', '/logo-vertical.png', '/openmaic-mark.png'].includes(
          url.pathname,
        ) ||
        /^\/(logos|avatars|agents|fonts)\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp|gif|svg|woff2?|ttf)$/.test(
          url.pathname,
        )
      ) {
        if (incoming.method !== 'GET' || url.pathname.includes('..')) {
          outgoing.writeHead(404);
          outgoing.end();
          return;
        }
        try {
          const { realpath } = await import('node:fs/promises');
          const file = join(root, 'public', url.pathname);
          if ((await realpath(file)) !== file) throw Error('Not a regular public asset');
          const bytes = await readFile(file);
          const ext = file.split('.').pop()!;
          outgoing.writeHead(200, {
            'Content-Type': (
              {
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                webp: 'image/webp',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                woff: 'font/woff',
                woff2: 'font/woff2',
                ttf: 'font/ttf',
              } as Record<string, string>
            )[ext],
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
          });
          outgoing.end(bytes);
        } catch {
          outgoing.writeHead(404);
          outgoing.end();
        }
        return;
      }
      const assets: Record<string, [string, string]> = {
        '/zhiban/course-results': ['course-results.html', 'text/html'],
        '/zhiban/course-results.js': ['course-results.bundle.js', 'text/javascript'],
        '/zhiban/course-results.css': ['course-results.css', 'text/css'],
        '/zhiban/admin/services': ['admin-services.html', 'text/html'],
        '/zhiban/admin-services.js': ['admin-services.bundle.js', 'text/javascript'],
        '/zhiban/admin-services.css': ['admin-services.css', 'text/css'],
        '/zhiban/native-services': ['native-services.html', 'text/html'],
        '/zhiban/native-services.js': ['native-services.bundle.js', 'text/javascript'],
        '/zhiban/native-services.css': ['native-services.css', 'text/css'],
        '/zhiban/native-archive': ['native-archive.html', 'text/html'],
        '/zhiban/native-archive.js': ['native-archive.bundle.js', 'text/javascript'],
        '/zhiban/native-archive.css': ['native-archive.css', 'text/css'],
        '/zhiban/native-classroom': ['native-classroom.html', 'text/html'],
        '/zhiban/native-classroom.css': ['native-classroom.css', 'text/css'],
        '/zhiban/native-classroom.bundle.js': ['native-classroom.bundle.js', 'text/javascript'],
        '/zhiban/native-classroom.bundle.css': ['native-classroom.bundle.css', 'text/css'],
        '/zhiban/native-workbench': ['native-workbench.html', 'text/html'],
        '/zhiban/native-workbench.bundle.js': ['native-workbench.bundle.js', 'text/javascript'],
        '/zhiban/native-workbench.bundle.css': ['native-workbench.bundle.css', 'text/css'],
        '/zhiban/native-workbench.css': ['native-workbench.css', 'text/css'],
        '/zhiban/native-theme.css': ['native-theme.css', 'text/css'],
        '/zhiban/native-review': ['native-review.html', 'text/html'],
        '/zhiban/native-review.css': ['native-review.css', 'text/css'],
        '/zhiban/native-review.js': ['native-review.js', 'text/javascript'],
        '/zhiban/native-published': ['native-published.html', 'text/html'],
        '/zhiban/native-published.js': ['native-published.js', 'text/javascript'],

        '/zhiban': ['index.html', 'text/html'],
        ...(trial
          ? ({
              '/zhiban/grading': ['grading.html', 'text/html'],
              '/zhiban/final-grades.js': ['final-grades.js', 'text/javascript'],
              '/zhiban/gradebook.js': ['gradebook.js', 'text/javascript'],
              '/zhiban/grading.js': ['grading.js', 'text/javascript'],
              '/zhiban/content': [
                contentHost ? 'content.html' : 'trial-content-closed.html',
                'text/html',
              ],
              ...(contentHost
                ? {
                    '/zhiban/content-client.js': ['@content-bundle', 'text/javascript'],
                    '/zhiban/content.css': ['content.css', 'text/css'],
                  }
                : {}),
            } as Record<string, [string, string]>)
          : {}),
        '/zhiban/course-administration': ['course-administration.html', 'text/html'],
        '/zhiban/course-administration.js': ['course-administration.js', 'text/javascript'],
        '/zhiban/global-tools': ['global-tools.html', 'text/html'],
        '/zhiban/global-tools.js': ['global-tools.js', 'text/javascript'],
        '/zhiban/global-authoring': ['global-authoring.html', 'text/html'],
        '/zhiban/global-authoring.js': ['global-authoring.js', 'text/javascript'],
        '/zhiban/global-support': ['global-support.html', 'text/html'],
        '/zhiban/global-support.js': ['global-support.js', 'text/javascript'],
        '/zhiban/support-hub': ['support-hub.html', 'text/html'],
        '/zhiban/support-hub.js': ['support-hub.js', 'text/javascript'],
        '/zhiban/admin-entry': ['admin-entry.html', 'text/html'],
        '/zhiban/admin-entry.js': ['admin-entry.js', 'text/javascript'],
        '/zhiban/global-grades': ['global-grades.html', 'text/html'],
        '/zhiban/global-grades.js': ['global-grades.js', 'text/javascript'],
        '/zhiban/profile': ['profile.html', 'text/html'],
        ...(unifiedTrial
          ? {
              '/zhiban/export-player/player.min.js': ['@export/player.min.js', 'text/javascript'],
              '/zhiban/export-player/player-charts.min.js': [
                '@export/player-charts.min.js',
                'text/javascript',
              ],
              '/zhiban/export-player/katex-fonts.min.css': [
                '@export/katex-fonts.min.css',
                'text/css',
              ],
              '/zhiban/export-player/player.min.css': ['@export/player.min.css', 'text/css'],
            }
          : {}),
        ...(unifiedTrial
          ? {
              '/zhiban/admin/members': ['membership.html', 'text/html'],
              '/zhiban/join': ['membership.html', 'text/html'],
              '/zhiban/membership.js': ['membership.js', 'text/javascript'],
            }
          : {}),
        '/zhiban/attempt-runtime-page.js': ['attempt-runtime-page.js', 'text/javascript'],
        '/zhiban/published-player.js': ['published-player.js', 'text/javascript'],
        '/zhiban/published-player.css': ['published-player.css', 'text/css'],
        '/zhiban/profile.js': ['profile.js', 'text/javascript'],
        '/zhiban/client.js': ['client.js', 'text/javascript'],
        '/zhiban/academic.js': ['academic.js', 'text/javascript'],
        '/zhiban/learning.js': ['learning.js', 'text/javascript'],
        '/zhiban/discussion.js': ['discussion.js', 'text/javascript'],
        '/zhiban/quiz-client.js': ['quiz-client.js', 'text/javascript'],
        '/zhiban/quiz.css': ['quiz.css', 'text/css'],
        '/zhiban/classrooms.js': ['classrooms.js', 'text/javascript'],
        '/zhiban/curriculum.js': ['curriculum.js', 'text/javascript'],
        '/zhiban/assessment.js': ['assessment.js', 'text/javascript'],
        '/zhiban/style.css': ['style.css', 'text/css'],
        '/zhiban/management': ['management.html', 'text/html'],
        '/zhiban/management-catalog.js': ['management-catalog.js', 'text/javascript'],
        '/zhiban/management.js': ['management.js', 'text/javascript'],
        '/zhiban/management-page.js': ['management-page.js', 'text/javascript'],
        '/zhiban/admin-shell.js': ['admin-shell.js', 'text/javascript'],
        '/zhiban/lesson.js': ['lesson.js', 'text/javascript'],
        '/zhiban/lesson.css': ['lesson.css', 'text/css'],
        '/zhiban/course-page.js': ['course-page.js', 'text/javascript'],
        '/zhiban/workspace.js': ['workspace.js', 'text/javascript'],
        '/zhiban/workspace.css': ['workspace.css', 'text/css'],
        '/zhiban/relationships': ['relationships.html', 'text/html'],
        '/zhiban/relationships.js': ['relationships.js', 'text/javascript'],
        '/zhiban/relationships.css': ['relationships.css', 'text/css'],
        '/zhiban/management.css': ['management.css', 'text/css'],
        '/zhiban/directory': ['directory.html', 'text/html'],
        '/zhiban/directory.js': ['directory.js', 'text/javascript'],
        '/zhiban/directory-page.js': ['directory-page.js', 'text/javascript'],
        '/zhiban/directory.css': ['directory.css', 'text/css'],
        '/zhiban/admin/import': ['imports.html', 'text/html'],
        '/zhiban/admin/import/classes': ['imports.html', 'text/html'],
        '/zhiban/admin/import/students': ['imports.html', 'text/html'],
        '/zhiban/admin/import/registrations': ['imports.html', 'text/html'],
        '/zhiban/imports.js': ['imports.js', 'text/javascript'],
        '/zhiban/roster': ['roster.html', 'text/html'],
        '/zhiban/roster.js': ['roster.js', 'text/javascript'],
        '/zhiban/roster.css': ['roster.css', 'text/css'],
        '/zhiban/roster-template.csv': ['roster-template.csv', 'text/csv'],
        '/zhiban/login-identifiers': ['login-identifiers.html', 'text/html'],
        '/zhiban/login-identifiers.js': ['login-identifiers.js', 'text/javascript'],
        '/zhiban/admin/onboarding': ['onboarding.html', 'text/html'],
        '/zhiban/onboarding.js': ['onboarding.js', 'text/javascript'],
        '/zhiban/onboarding.css': ['onboarding.css', 'text/css'],
        '/zhiban/activate-account': ['account-setup.html', 'text/html'],
        '/zhiban/account-setup.js': ['account-setup.js', 'text/javascript'],
        '/zhiban/attainment': ['attainment.html', 'text/html'],
        '/zhiban/attainment.js': ['attainment.js', 'text/javascript'],
        '/zhiban/attainment.css': ['attainment.css', 'text/css'],
        '/zhiban/auto-grading': ['auto-grading.html', 'text/html'],
        '/zhiban/auto-grading.js': ['auto-grading.js', 'text/javascript'],
        '/zhiban/ema': ['ema.html', 'text/html'],
        '/zhiban/ema.js': ['ema.js', 'text/javascript'],
        '/zhiban/ema.css': ['ema.css', 'text/css'],
        '/zhiban/pbl-entry': ['pbl-entry.html', 'text/html'],
        '/zhiban/pbl': ['pbl.html', 'text/html'],
        '/zhiban/pbl.js': ['pbl.js', 'text/javascript'],
        '/zhiban/pbl.css': ['pbl.css', 'text/css'],
        '/zhiban/flow': ['flow.html', 'text/html'],
        '/zhiban/flow.js': ['flow.js', 'text/javascript'],
        '/zhiban/flow.css': ['flow.css', 'text/css'],
        '/zhiban/tutor': ['tutor.html', 'text/html'],
        '/zhiban/tutor.js': ['tutor.js', 'text/javascript'],
        '/zhiban/tutor.css': ['tutor.css', 'text/css'],
        '/zhiban/learning-profile': ['learning-profile.html', 'text/html'],
        '/zhiban/learning-profile.js': ['learning-profile.js', 'text/javascript'],
        '/zhiban/learning-profile.css': ['learning-profile.css', 'text/css'],
        '/zhiban/concepts': ['concepts.html', 'text/html'],
        '/zhiban/concepts.js': ['concepts.js', 'text/javascript'],
        '/zhiban/concepts.css': ['concepts.css', 'text/css'],
        '/zhiban/risk': ['risk.html', 'text/html'],
        '/zhiban/risk.js': ['risk.js', 'text/javascript'],
        '/zhiban/risk.css': ['risk.css', 'text/css'],
        '/zhiban/remediation': ['remediation.html', 'text/html'],
        '/zhiban/remediation.js': ['remediation.js', 'text/javascript'],
        '/zhiban/remediation.css': ['remediation.css', 'text/css'],
        '/zhiban/reminders': ['reminders.html', 'text/html'],
        '/zhiban/reminders.js': ['reminders.js', 'text/javascript'],
        '/zhiban/reminders.css': ['reminders.css', 'text/css'],
        '/zhiban/progress': ['progress.html', 'text/html'],
        '/zhiban/progress.js': ['progress.js', 'text/javascript'],
        '/zhiban/progress.css': ['progress.css', 'text/css'],
        '/zhiban/analytics': ['analytics.html', 'text/html'],
        '/zhiban/analytics.js': ['analytics.js', 'text/javascript'],
        '/zhiban/analytics.css': ['analytics.css', 'text/css'],
      };
      const assetKey =
        localOrdinaryEntryAsset(url.pathname) ??
        localCourseAdministrationPageAsset(url.pathname) ??
        localStudentToolsPageAsset(url.pathname) ??
        localAuthoringPageAsset(url.pathname) ??
        localSupportPageAsset(url.pathname) ??
        localLegacyEntryAsset(url.pathname) ??
        localGradePageAsset(url.pathname) ??
        localPersonalPageAsset(url.pathname) ??
        localCoursePageAsset(url.pathname) ??
        localAdminPageAsset(url.pathname) ??
        url.pathname;
      const videoVendor =
        /^\/vendor\/(?:gsap\.min\.js|video-export\/fonts\/[a-zA-Z0-9_.-]+\.woff2)$/.test(assetKey);
      const pageAsset =
        assets[assetKey] ??
        (videoVendor
          ? [
              '@video-vendor/' + assetKey.slice(8),
              assetKey.endsWith('.js') ? 'text/javascript' : 'font/woff2',
            ]
          : undefined);
      if (pageAsset) {
        const [file, type] = pageAsset;
        if (incoming.method !== 'GET') {
          outgoing.writeHead(405);
          outgoing.end();
          return;
        }
        outgoing.writeHead(200, {
          'Content-Type': type + '; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            assetKey === '/zhiban/native-archive'
              ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
              : [
                    '/zhiban/course-results',
                    '/zhiban/admin/services',
                    '/zhiban/native-services',
                    '/zhiban/native-workbench',
                    '/zhiban/native-archive',
                    '/zhiban/native-classroom',
                    '/zhiban/native-published',
                  ].includes(assetKey)
                ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
                : assetKey === '/zhiban/content' && contentHost
                  ? contentHost.csp
                  : file === 'profile.html'
                    ? "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
                    : "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          'Referrer-Policy': [
            '/zhiban/course-results',
            '/zhiban/admin/services',
            '/zhiban/native-services',
            '/zhiban/native-workbench',
            '/zhiban/native-archive',
            '/zhiban/native-published',
            '/zhiban/native-classroom',
          ].includes(assetKey)
            ? 'same-origin'
            : 'no-referrer',
        });
        let bytes = await readFile(
          file === '@content-bundle'
            ? contentHost!.bundlePath
            : file.startsWith('@video-vendor/')
              ? join(root, 'public/vendor', file.slice(14))
              : file.startsWith('@export/')
                ? join(root, 'public/vendor/standalone-player', file.slice(8))
                : join(root, 'app/zhiban/local', file),
        );
        if (sharedClassroom && type === 'text/html')
          bytes = Buffer.from(
            bytes
              .toString()
              .replace('</head>', '<script src="/zhiban/classrooms.js"></script></head>'),
          );
        outgoing.end(bytes);
        return;
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(incoming.headers))
        if (v && !['host', 'connection', 'content-length', 'transfer-encoding'].includes(k))
          headers.set(k, Array.isArray(v) ? v.join(',') : v);
      headers.set('x-zhiban-client-ip', '127.0.0.1');
      const parts: Buffer[] = [];
      let size = 0;
      for await (const part of incoming) {
        size += part.length;
        if (
          size >
          (url.pathname.startsWith('/api/zhiban/classroom-ai/')
            ? 5242880
            : url.pathname.startsWith('/api/zhiban/authoring/')
              ? url.pathname.includes('/archive/')
                ? 67108864
                : 33554432
              : contentHost && /\/assets$/.test(url.pathname) && incoming.method === 'POST'
                ? 4194304
                : contentHost && url.pathname.startsWith('/api/zhiban/content/')
                  ? 262144
                  : url.pathname.startsWith('/api/zhiban/flow/') ||
                      url.pathname.startsWith('/api/zhiban/pbl/')
                    ? 65536
                    : url.pathname.startsWith('/api/zhiban/imports/')
                      ? 131072
                      : attachments &&
                          /^\/api\/zhiban\/learning\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}$/.test(
                            url.pathname,
                          )
                        ? 1750000
                        : 32768)
        ) {
          outgoing.writeHead(413);
          outgoing.end();
          return;
        }
        parts.push(Buffer.from(part));
      }
      if (['GET', 'HEAD'].includes(incoming.method ?? '') && size) {
        outgoing.writeHead(400);
        outgoing.end();
        return;
      }
      const request = new Request(url, {
        method: incoming.method,
        headers,
        signal: abort.signal,
        ...(!['GET', 'HEAD'].includes(incoming.method ?? '') ? { body: Buffer.concat(parts) } : {}),
      });
      const r =
        httpClassroomAi && url.pathname.startsWith('/api/zhiban/classroom-ai/')
          ? await httpClassroomAi(request)
          : httpNativeAuthoring && url.pathname.startsWith('/api/zhiban/authoring/')
            ? await httpNativeAuthoring(request)
            : url.pathname.startsWith('/api/zhiban/attainment/')
              ? await httpAttainment(request)
              : httpAutograde && url.pathname.startsWith('/api/zhiban/autograde/')
                ? await httpAutograde(request)
                : url.pathname.startsWith('/api/zhiban/ema/')
                  ? await httpEma(request)
                  : url.pathname.startsWith('/api/zhiban/pbl/')
                    ? await httpPbl(request)
                    : url.pathname.startsWith('/api/zhiban/flow/')
                      ? await httpFlow(request)
                      : contentHost && url.pathname.startsWith('/api/zhiban/content/')
                        ? await contentHost.http(request)
                        : url.pathname.startsWith('/api/zhiban/imports/')
                          ? await httpImports(request)
                          : url.pathname.startsWith('/api/zhiban/login-identifiers/')
                            ? await httpLoginIdentifiers(
                                request,
                                incoming.socket.remoteAddress ?? 'UNKNOWN',
                              )
                            : url.pathname.startsWith('/api/zhiban/materials/')
                              ? await httpMaterial(request)
                              : url.pathname.startsWith('/api/zhiban/profile/')
                                ? await httpProfile(request)
                                : url.pathname.startsWith('/api/zhiban/workspace/')
                                  ? await httpWorkspace(request)
                                  : url.pathname.startsWith('/api/zhiban/course-results/') &&
                                      httpCourseResults
                                    ? await httpCourseResults(request)
                                    : url.pathname.startsWith('/api/zhiban/service-center/') &&
                                        httpServices
                                      ? await httpServices(request)
                                      : url.pathname.startsWith('/api/zhiban/management/')
                                        ? await httpManagement(request)
                                        : url.pathname.startsWith('/api/zhiban/directory/')
                                          ? await httpDirectory(request)
                                          : url.pathname.startsWith('/api/zhiban/roster/')
                                            ? await httpRoster(request)
                                            : url.pathname === '/api/zhiban/onboarding/claim'
                                              ? await httpAccountSetup(
                                                  request,
                                                  incoming.socket.remoteAddress ?? 'UNKNOWN',
                                                )
                                              : url.pathname.startsWith('/api/zhiban/onboarding/')
                                                ? await httpAccountRequests(request)
                                                : url.pathname.startsWith('/api/zhiban/tutor/') &&
                                                    httpTutor
                                                  ? await httpTutor(request)
                                                  : url.pathname.startsWith('/api/zhiban/learner/')
                                                    ? await httpLearner(request)
                                                    : url.pathname.startsWith(
                                                          '/api/zhiban/concept/',
                                                        )
                                                      ? await httpConcept(request)
                                                      : url.pathname.startsWith('/api/zhiban/risk/')
                                                        ? await httpRisk(request)
                                                        : url.pathname.startsWith(
                                                              '/api/zhiban/remediation/',
                                                            )
                                                          ? await httpRemediation(request)
                                                          : url.pathname.startsWith(
                                                                '/api/zhiban/reminders/',
                                                              )
                                                            ? await httpReminders(request)
                                                            : url.pathname.startsWith(
                                                                  '/api/zhiban/progress/',
                                                                )
                                                              ? await httpProgress(request)
                                                              : url.pathname.startsWith(
                                                                    '/api/zhiban/analytics/',
                                                                  )
                                                                ? await httpAnalytics(request)
                                                                : url.pathname.startsWith(
                                                                      '/api/zhiban/academic/',
                                                                    )
                                                                  ? await httpAcademic(request)
                                                                  : url.pathname.startsWith(
                                                                        '/api/zhiban/learning/',
                                                                      )
                                                                    ? await httpLearning(request)
                                                                    : url.pathname.startsWith(
                                                                          '/api/zhiban/assessment/',
                                                                        )
                                                                      ? await httpAssessment(
                                                                          request,
                                                                        )
                                                                      : url.pathname.startsWith(
                                                                            '/api/zhiban/identity/',
                                                                          )
                                                                        ? await facade.handle(
                                                                            request,
                                                                          )
                                                                        : new Response(null, {
                                                                            status: 404,
                                                                          });
      outgoing.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body) {
        const reader = r.body.getReader();
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        outgoing.once('close', cancel);
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            await new Promise<void>((yes, no) =>
              outgoing.write(Buffer.from(part.value), (e) => (e ? no(e) : yes())),
            );
          }
        } finally {
          outgoing.removeListener('close', cancel);
          await reader.cancel().catch(() => {});
        }
      }
      outgoing.end();
    } catch {
      if (outgoing.headersSent) outgoing.destroy();
      else {
        outgoing.writeHead(503);
        outgoing.end();
      }
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 32;
  await new Promise<void>((done, reject) => {
    server!.once('error', reject);
    startup.enter('HTTPS_LISTEN');
    server!.listen(httpsPort, '127.0.0.1', done);
  });
  if (autogradeEnabled && !attainmentFocus) autoWorker!.start([t]);
  if (restored) {
    persistentMetadata = {
      ...restored.metadata,
      ...executionEvidence(),
      status: 'RUNNING_LOCAL_PERSISTENT',
      pid: process.pid,
      processStart: (await readFile(`/proc/${process.pid}/stat`, 'utf8'))
        .split(') ')[1]
        .trim()
        .split(/\s+/)[19],
      sourceHashes,
      ...(localPgMajor === 18 ? { stateRoot: process.env.ZHIBAN_LOCAL_STATE } : {}),
      contentInstallation,
      scanner: {
        mode: scanner ? 'TRUSTED_SCANNER' : 'UNAVAILABLE',
        profile: process.env.ZHIBAN_SCANNER_PROFILE,
        sha256: process.env.ZHIBAN_SCANNER_PROFILE_SHA256,
      },
      attainment: { enabled: attainmentEnabled, evidenceOrigin: 'LOCAL', schoolOnly: true },
      autograde: {
        enabled: autogradeEnabled,
        ...executionEvidence(),
        serviceActor: 'zhiban_autograde_worker',
        explicitPolicyRequired: true,
      },
      ema: {
        enabled: emaEnabled,
        ...executionEvidence(),
        numericAbilityScores: false,
        unattendedDispatch: false,
      },
      pbl: { enabled: pblEnabled, evidenceOrigin: 'LOCAL', nativeAutonomousRuntimeEnabled: false },
      flow: { enabled: flowEnabled, evidenceOrigin: 'LOCAL', nativeRuntimeEnabled: false },
      nativeAiClassroom: {
        enabled: Boolean(lessonHost),
        fixedPublication: true,
        teacherOptIn: true,
        personalRuntime: true,
        formalResults: false,
      },
      restoredFrom: restored.snapshot,
    };
    await writeFile(
      localPgMajor === 18
        ? 'docs/v2/evidence/zhiban-pg18-demo-local.json'
        : 'docs/v2/evidence/zhiban-trial-content-demo-local.json',
      JSON.stringify(persistentMetadata, null, 2) + '\n',
    );
    startup.ready();
    console.log(
      `LOCAL persistent host ready: ${origin}/zhiban; existing data and accounts retained`,
    );
    await new Promise<void>((done) => {
      process.once('SIGINT', () => done());
      process.once('SIGTERM', () => done());
    });
    return;
  }
  // Synthetic verification DTO; asserted by each real HTTP operation, never supplies authorization facts.
  type Json = {
    id: string;
    revision: string;
    submissionId: string;
    submission_id: string;
    csrfToken: string;
    title: string;
    activities: Json[];
    attempts: Json[];
    grades: Json[];
  };
  const http = (
    path: string,
    a?: Actor,
    payload?: unknown,
    method?: string,
    extra: Record<string, string> = {},
  ) =>
    new Promise<{
      status: number;
      json: Json;
      cookie?: string;
      headers: import('node:http').IncomingHttpHeaders;
      bytes: Buffer;
    }>((done, reject) => {
      const post = payload !== undefined;
      const r = httpsRequest(
        origin + path,
        {
          ca,
          method: method ?? (post ? 'POST' : 'GET'),
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(a?.cookie ? { cookie: a.cookie } : {}),
            ...(post
              ? {
                  Origin: origin,
                  'Content-Type': 'application/json',
                  'x-zhiban-command': v7().replaceAll('-', ''),
                  ...(a?.csrf ? { 'x-zhiban-csrf': a.csrf } : {}),
                }
              : {}),
            ...extra,
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on('data', (b) => parts.push(b));
          res.on('error', reject);
          res.on('end', () => {
            try {
              const bytes = Buffer.concat(parts);
              done({
                status: res.statusCode!,
                json: res.headers['content-type']?.includes('json')
                  ? JSON.parse(bytes.toString())
                  : {},
                cookie: res.headers['set-cookie']?.[0]?.split(';')[0],
                headers: res.headers,
                bytes,
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      r.setTimeout(trustedFiles ? 75000 : 10000, () => r.destroy(Error('HTTPS timeout')));
      r.on('error', reject);
      r.end(post ? JSON.stringify(payload) : undefined);
    });
  for (const a of [...actors, ...authOnly]) {
    const login = await http('/api/zhiban/identity/login', undefined, {
      userId: a.uid,
      password: a.password,
    });
    assert.equal(login.status, 200);
    a.cookie = login.cookie;
    const csrf = await http('/api/zhiban/identity/csrf', a);
    assert.equal(csrf.status, 200);
    a.csrf = csrf.json.csrfToken;
  }
  record('PG16 restricted roles + real Identity sessions + validated trusted HTTPS');

  let trialData: Awaited<ReturnType<typeof prepareTrial>> | null = null;
  if (trial) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        ...(localPgMajor === 18
          ? [
              '--ignore-certificate-errors-spki-list=' +
                createHash('sha256')
                  .update(
                    new X509Certificate(tls).publicKey.export({ type: 'spki', format: 'der' }),
                  )
                  .digest('base64'),
            ]
          : []),
      ],
    });
    trialData = await prepareTrial({
      admin,
      browser,
      actors,
      http,
      tenant: t,
      origin,
      record,
      verifyExistingTeaching: !serve && !teacherScope && !directedFocus && !gradebookExportFocus,
      contentEnabled: trialContent,
    });
    if (!unifiedTrial && gradebook && !attachments && !gradebookExportFocus)
      await verifyGradebook({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (!unifiedTrial && gradebookCsv && !gradebookExportFocus)
      await verifyGradebookCsv({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (gradebookExportFocus)
      await verifyGradebookExport({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if ((!unifiedTrial || resourcesFocus) && attachments)
      await verifySubmissionFiles({
        trusted: trustedFiles,
        browserOnly: resourcesFocus && process.argv.includes('--resources-browser-continuation'),
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (!unifiedTrial && classroomEdit)
      await verifyClassroomEdit({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (sharedClassroom && !classroomEdit)
      await verifySharedClassroom({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (trialContent && !sharedClassroom)
      await verifyTrialContent({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (trialContent && !sharedClassroom)
      await verifyCurriculum({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (trialContent && !sharedClassroom)
      await verifyAuthorFlow({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && !memberFocus && !teacherScope && !directedFocus && !serve)
      await verifyUnifiedTrial({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && !memberFocus && !teacherScope && !directedFocus && !serve)
      await verifyCourseQuiz({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && !memberFocus && !teacherScope && !directedFocus && !serve)
      await verifyDiscussion({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        runtime: businessPool,
      });
    if (unifiedTrial && !memberFocus && !teacherScope && !directedFocus && !serve)
      await verifyProfile({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        runtime: businessPool,
      });
    if (
      unifiedTrial &&
      ((!memberFocus && !teacherScope && !directedFocus && !serve) || resourcesFocus)
    )
      await verifyMaterials({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        runtime: businessPool,
      });
    if (unifiedTrial && !memberFocus && !teacherScope && !directedFocus && !serve)
      await verifyExports({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && !teacherScope && !directedFocus && !serve && authority && localOperator)
      await verifyMembers({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        authority,
        composition,
        control,
        operator: localOperator,
        subjects: authOnly,
      });
    if (unifiedTrial && avatarFocus)
      await verifyAvatar({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && importsFocus)
      await verifyImports({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        store,
        businessPool,
        security: composition.security,
      });
    if (unifiedTrial && loginIdentifiersFocus && authority && localOperator)
      await verifyLoginIdentifiers({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        authority,
        authPool: auth,
        tenantPool,
        control,
        composition,
      });
    if (unifiedTrial && accountStatusFocus && authority && localOperator)
      await verifyAccountStatus({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        authority,
        authPool: auth,
        tenantPool,
        control,
      });
    if (unifiedTrial && onboardingFocus && authority && localOperator)
      await verifyOnboarding({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        ordinaryCredentials,
        authority,
        control,
        authPool: auth,
        tenantPool,
      });
    if (unifiedTrial && attainmentFocus)
      await verifyAttainment({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        store,
        security: composition.security,
        worker: autoWorker!,
        workerPool: workerPool!,
      });
    if (unifiedTrial && emaFocus)
      await verifyEma({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        store,
        security: composition.security,
      });
    if (unifiedTrial && pblFocus)
      await verifyPbl({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && flowFocus)
      await (simulationFocus ? verifySimulation : verifyFlow)({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && tutorFocus)
      await verifyTutor({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        store,
        security: composition.security,
        content: tutorContent(contentHost!.service),
      });
    if (unifiedTrial && learnerFocus)
      await verifyLearner({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && conceptFocus)
      await verifyConcept({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && riskFocus)
      await verifyRisk({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && remediationFocus)
      await verifyRemediation({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && remindersFocus)
      await verifyReminders({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && casesFocus)
      await verifyFollowupCases({
        admin,
        businessPool,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && followupsFocus)
      await verifyFollowups({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && resultsFocus)
      await verifyClassroomResults({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && jointFocus)
      await verifyJointClassroom({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        nativeAdmin: pool('postgres', 'zhiban_trial_content_native'),
      });
    if (unifiedTrial && attemptRuntimeFocus)
      await verifyAttemptRuntime({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && interactiveFocus)
      await verifyInteractive({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        nativeAdmin: pool('postgres', 'zhiban_trial_content_native'),
      });
    if (unifiedTrial && (classroomAiFocus || pg18Acceptance))
      await (
        pg18Acceptance
          ? verifyClassroomAi
          : courseLiveFocus
            ? verifyCourseLive
            : courseResultsFocus
              ? verifyCourseResults
              : serviceCenterFocus
                ? verifyServiceCenter
                : multimodalFocus
                  ? verifyMultimodal
                  : nativeArchiveFocus
                    ? verifyNativeArchive
                    : nativePblFocus
                      ? verifyNativePbl
                      : verifyClassroomAi
      )({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        native: pool('postgres', 'zhiban_trial_lesson_native'),
      });
    if (unifiedTrial && authoringFocus)
      await verifyNativeAuthoring({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        native: pool('postgres', 'zhiban_trial_lesson_native'),
      });
    if (unifiedTrial && playerFocus)
      await (nativeClassroomFocus ? verifyNativeClassroom : verifyNativePlayer)({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (unifiedTrial && lessonFocus) {
      const lessonResult = await verifyLesson({
        product: productFocus,
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        native: pool('postgres', 'zhiban_trial_lesson_native'),
      });
      if (productFocus)
        await verifyPresentation({
          admin,
          browser,
          actors,
          http,
          tenant: t,
          origin,
          record,
          trial: trialData,
          resourceId: lessonResult.resourceId,
        });
    }
    if (unifiedTrial && teacherScope)
      await verifyTeacherScope({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
        composition,
        tenantPool,
        businessPool,
        bridgePool: bridge,
      });
    if (classroomFixes)
      await verifyClassroomFixes({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (rosterTrial)
      await verifyRosterTrial({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        origin,
        record,
        trial: trialData,
      });
    if (uatFixes)
      await verifyUatFixes({
        admin,
        browser,
        actors,
        http,
        tenant: t,
        otherTenant,
        origin,
        record,
        trial: trialData,
      });
  } else if (history) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        ...(localPgMajor === 18
          ? [
              '--ignore-certificate-errors-spki-list=' +
                createHash('sha256')
                  .update(
                    new X509Certificate(tls).publicKey.export({ type: 'spki', format: 'der' }),
                  )
                  .digest('base64'),
            ]
          : []),
      ],
    });
    await verifyManagementHistory({
      members,
      browser,
      admin,
      actors,
      http,
      tenant: t,
      otherTenant,
      origin,
      record,
    });
  } else if (courseOwner) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        ...(localPgMajor === 18
          ? [
              '--ignore-certificate-errors-spki-list=' +
                createHash('sha256')
                  .update(
                    new X509Certificate(tls).publicKey.export({ type: 'spki', format: 'der' }),
                  )
                  .digest('base64'),
            ]
          : []),
      ],
    });
    await verifyCourseOwner({
      browser,
      admin,
      ids,
      users,
      members,
      tenant: t,
      otherTenant,
      now,
      actors,
      http,
      origin,
      record,
    });
  } else {
    type Page = Awaited<ReturnType<ManagementService['read']>>;
    const base = `/api/zhiban/management/${t}`;
    const read = async (
      kind: 'offerings' | 'enrollments' | 'courses' | 'terms' | 'classes',
      params: Record<string, string> = {},
      a = manager,
    ): Promise<Page> => {
      const r = await http(`${base}/${kind}?` + new URLSearchParams(params), a);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json as unknown as Page;
    };
    const command = (payload: unknown, a = manager, key = v7().replaceAll('-', '')) =>
      http(`${base}/commands`, a, payload, 'POST', { 'x-zhiban-command': key });
    const makeMember = async (name: string) => {
      const uid = ids.nextUserId();
      await users.create(User.create(uid, instant(now)));
      const grant = RoleGrant.create({
        id: ids.nextRoleGrantId(),
        roleCode: 'STUDENT',
        scope: selfScope(),
        createdAt: instant(now),
        validFrom: instant(now),
        validUntil: null,
      });
      const member = Membership.create({
        id: ids.nextMembershipId(),
        userId: uid,
        tenantId: t,
        now: instant(now),
      }).activatePending({
        expectedAuthorizationVersion: 0,
        now: instant(now),
        approvedGrants: [grant],
      });
      const loaded = await members.create(tenantScopeContext(t), member);
      await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
        t,
        member.id,
        name,
      ]);
      return { member: member.id, loaded };
    };
    const bulk = [];
    await admin.query(
      'UPDATE zhiban_academic.offerings SET capacity=1000 WHERE tenant_id=$1 AND id=$2',
      [t, offering],
    );
    for (let i = 0; i < 620; i++) {
      const person = await makeMember('大名单学生' + String(i).padStart(4, '0'));
      bulk.push(person);
      await admin.query(
        "INSERT INTO zhiban_academic.enrollments VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)",
        [t, v7(), offering, person.member, now],
      );
      const id = v7();
      await admin.query(
        "INSERT INTO zhiban_academic.offerings VALUES($1,$2,$3,1,$4,NULL,$5,$6,20,'OPEN',1)",
        [t, id, course, term, 'PAGE' + i, '分页教学班' + String(i).padStart(4, '0')],
      );
    }
    const candidate = await makeMember('待入班学生甲'),
      second = await makeMember('待入班学生乙'),
      disabled = await makeMember('已禁用学生'),
      literal = await makeMember('百分%_学生');
    await members.save(
      tenantScopeContext(t),
      disabled.loaded.value.disable({
        reason: 'LOCAL_MANAGEMENT_TEST',
        expectedAuthorizationVersion: disabled.loaded.value.authorizationVersion,
        now: instant(Date.now()),
      }),
      disabled.loaded.revision,
    );
    const masterCourses = Array.from({ length: 620 }, (_, i) => ({
      id: v7(),
      code: 'CCAT' + i,
      name: '分页课程' + String(i).padStart(4, '0'),
      status: i % 3 === 0 ? 'PUBLISHED' : i % 3 === 1 ? 'DRAFT' : 'ARCHIVED',
    }));
    await admin.query(
      `INSERT INTO zhiban_academic.courses(tenant_id,id,code,name,description,owner_membership_id,status,published_version,revision,created_at,updated_at)
    SELECT $1,r.id,r.code,r.name,'',NULL,r.status,CASE WHEN r.status='DRAFT' THEN 0 ELSE 1 END,1,$3,$3 FROM jsonb_to_recordset($2::jsonb) AS r(id uuid,code text,name text,status text)`,
      [t, JSON.stringify(masterCourses), now],
    );
    await admin.query(
      `INSERT INTO zhiban_academic.course_versions(tenant_id,id,version,name,description,owner_membership_id,published_at) SELECT tenant_id,id,1,name,'',NULL,$2 FROM zhiban_academic.courses WHERE tenant_id=$1 AND code LIKE 'CCAT%' AND status<>'DRAFT'`,
      [t, now],
    );
    const masterTerms = Array.from({ length: 620 }, (_, i) => ({
        id: v7(),
        code: 'TCAT' + i,
        name: '分页学期' + String(i).padStart(4, '0'),
      })),
      masterClasses = Array.from({ length: 620 }, (_, i) => ({
        id: v7(),
        code: 'ACAT' + i,
        name: '分页行政班' + String(i).padStart(4, '0'),
      }));
    await admin.query(
      `INSERT INTO zhiban_academic.terms(tenant_id,id,code,name,starts_on,ends_on,revision) SELECT $1,r.id,r.code,r.name,'2026-10-01','2027-01-01',1 FROM jsonb_to_recordset($2::jsonb) AS r(id uuid,code text,name text)`,
      [t, JSON.stringify(masterTerms)],
    );
    await admin.query(
      `INSERT INTO zhiban_academic.classes(tenant_id,id,code,name,head_teacher_id,revision) SELECT $1,r.id,r.code,r.name,NULL,1 FROM jsonb_to_recordset($2::jsonb) AS r(id uuid,code text,name text)`,
      [t, JSON.stringify(masterClasses)],
    );

    assert.equal((await http(`/api/zhiban/academic/${t}`, manager)).status, 503);
    record('623 offerings, 629 ACTIVE enrollments and >500 profiles; legacy snapshot fails closed');
    const collect = async (
      kind: 'offerings' | 'enrollments' | 'courses' | 'terms' | 'classes',
      params: Record<string, string>,
    ) => {
      const seen = new Set<string>();
      let cursor: string | null = null,
        pages = 0;
      do {
        const result = await read(kind, { ...params, ...(cursor ? { cursor } : {}) });
        assert.ok(result.rows.length <= Number(params.limit));
        for (const row of result.rows) {
          assert.ok(!seen.has(String(row.id)));
          seen.add(String(row.id));
        }
        cursor = result.nextCursor;
        assert.ok(++pages < 100);
      } while (cursor);
      return seen;
    };
    assert.equal((await collect('offerings', { limit: '50' })).size, 623);
    assert.equal((await collect('enrollments', { offering, limit: '50' })).size, 629);
    assert.equal((await read('offerings', { q: '分页教学班0619' })).rows.length, 1);
    assert.equal((await read('enrollments', { offering, q: '大名单学生0619' })).rows.length, 1);
    assert.equal((await read('enrollments', { offering, q: '不存在' })).rows.length, 0);
    assert.equal((await read('enrollments', { offering: emptyOffering })).rows.length, 0);
    record(
      'bounded keyset scans cover all offerings and per-offering enrollments without duplicate IDs; Chinese search and empty roster work',
    );
    for (const a of [teacher, student, foreign])
      assert.equal((await http(`${base}/offerings`, a)).status, 403);
    assert.equal((await http(`${base}/offerings`)).status, 401);
    for (const tail of [
      'offerings?limit=500',
      'offerings?limit=020',
      'offerings?q=x&q=y',
      'offerings?extra=x',
      'enrollments',
      'enrollments?offering=' + v7(),
    ]) {
      const status = (await http(`${base}/${tail}`, manager)).status;
      assert.ok([400, 404].includes(status), tail + ':' + status);
    }
    const first = await read('enrollments', { offering, limit: '10' });
    for (const p of [
      { offering: otherOffering },
      { offering, limit: '50' },
      { offering, state: 'WITHDRAWN' },
      { offering, q: 'x' },
    ] as Record<string, string>[])
      assert.equal(
        (
          await http(
            `${base}/enrollments?` + new URLSearchParams({ ...p, cursor: first.nextCursor! }),
            manager,
          )
        ).status,
        400,
      );
    assert.equal(
      (
        await http(
          `${base}/enrollments?` +
            new URLSearchParams({ offering, limit: '10', cursor: first.nextCursor! }),
          outsider,
        )
      ).status,
      400,
    );
    const privateTenant = await http(
      `/api/zhiban/management/${otherTenant}/enrollments?offering=${offering}`,
      foreign,
    );
    assert.equal(privateTenant.status, 404);
    assert.equal(
      (
        await http(
          `${base}/commands`,
          manager,
          { type: 'WITHDRAW', id: v7(), revision: '1' },
          'POST',
          { 'x-zhiban-csrf': 'x'.repeat(43) },
        )
      ).status,
      403,
    );
    assert.equal((await http(`${base}/commands`, manager)).status, 405);
    assert.equal((await http(`${base}/offerings`, manager, {})).status, 405);
    record(
      'anonymous/non-admin/cross-tenant access, stale filter/admin cursors, duplicate query, invalid bounds and invalid CSRF are refused',
    );
    const cmd = {
        type: 'ENROLL',
        offeringId: offering,
        membershipId: candidate.member,
        revision: null,
      },
      keyReplay = v7().replaceAll('-', '');
    const ack = await command(cmd, manager, keyReplay);
    assert.equal(ack.status, 200);
    assert.deepEqual(ack.json, { commandKey: keyReplay, type: 'ENROLL', status: 'COMPLETED' });
    assert.equal((await command(cmd, manager, keyReplay)).status, 200);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
            [t, keyReplay],
          )
        ).rows[0].n,
      ),
      1,
    );
    assert.equal(
      (await command({ ...cmd, membershipId: second.member }, manager, keyReplay)).status,
      409,
    );
    assert.equal((await command({ ...cmd, membershipId: disabled.member })).status, 403);
    let enrolled = (await read('enrollments', { offering, member: candidate.member, state: 'ALL' }))
      .rows[0];
    assert.equal(enrolled.status, 'ACTIVE');
    assert.equal(
      (await command({ type: 'WITHDRAW', id: enrolled.id, revision: '999' })).status,
      409,
    );
    assert.equal(
      (await command({ type: 'WITHDRAW', id: enrolled.id, revision: enrolled.revision })).status,
      200,
    );
    enrolled = (await read('enrollments', { offering, member: candidate.member, state: 'ALL' }))
      .rows[0];
    assert.equal(enrolled.status, 'WITHDRAWN');
    assert.equal((await command({ ...cmd, revision: null })).status, 409);
    assert.equal((await command({ ...cmd, revision: enrolled.revision })).status, 200);
    record(
      'ACK mutations commit beyond snapshot cap, retry uses one durable audit, key collision/stale revision/inactive member denied, withdrawal and manual restoration work',
    );
    const before = (await read('enrollments', { offering })).offering!;
    assert.equal(
      (
        await command({
          type: 'UPDATE_OFFERING',
          id: offering,
          revision: before.revision,
          name: before.name,
          capacity: 600,
          status: 'OPEN',
        })
      ).status,
      409,
    );
    const target = (await read('enrollments', { offering: otherOffering })).offering!;
    assert.equal(
      (
        await command({
          type: 'UPDATE_OFFERING',
          id: otherOffering,
          revision: target.revision,
          name: target.name,
          capacity: 1,
          status: 'OPEN',
        })
      ).status,
      200,
    );
    const contested = await Promise.all([
      command({
        type: 'ENROLL',
        offeringId: otherOffering,
        membershipId: second.member,
        revision: null,
      }),
      command(
        { type: 'ENROLL', offeringId: otherOffering, membershipId: literal.member, revision: null },
        outsider,
      ),
    ]);
    assert.deepEqual(contested.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await read('enrollments', { offering: otherOffering })).offering!.enrolled_count,
      1,
    );
    enrolled = (await read('enrollments', { offering, member: candidate.member })).rows[0];
    assert.equal(
      (
        await command({
          type: 'TRANSFER',
          id: enrolled.id,
          revision: enrolled.revision,
          targetOfferingId: otherOffering,
          targetRevision: null,
        })
      ).status,
      409,
    );
    assert.equal(
      (await read('enrollments', { offering, member: candidate.member })).rows[0].status,
      'ACTIVE',
    );
    assert.equal(
      (
        await command({
          type: 'TRANSFER',
          id: enrolled.id,
          revision: enrolled.revision,
          targetOfferingId: emptyOffering,
          targetRevision: null,
        })
      ).status,
      200,
    );
    assert.equal(
      (await read('enrollments', { offering, member: candidate.member, state: 'ALL' })).rows[0]
        .status,
      'WITHDRAWN',
    );
    assert.equal(
      (await read('enrollments', { offering: emptyOffering, member: candidate.member })).rows[0]
        .status,
      'ACTIVE',
    );
    const targets = await read('offerings', { source: offering, limit: '10' });
    assert.equal(targets.rows.length, 10);
    assert.ok(
      targets.rows.every(
        (r) =>
          r.id !== offering && r.course_id === course && r.term_id === term && r.status === 'OPEN',
      ),
    );
    record(
      'capacity reduction and concurrent final-seat contention reject overflow; failed transfer preserves source and successful transfer is atomic; transfer targets are paged',
    );
    assert.equal((await collect('courses', { limit: '50' })).size, 621);
    assert.equal((await collect('terms', { limit: '50' })).size, 621);
    assert.equal((await collect('classes', { limit: '50' })).size, 620);
    for (const kind of ['courses', 'terms', 'classes'] as const) {
      const label = { courses: '分页课程', terms: '分页学期', classes: '分页行政班' }[kind];
      assert.equal((await read(kind, { q: label + '0619' })).rows.length, 1);
      assert.equal((await read(kind, { q: '不存在' })).rows.length, 0);
      for (const a of [teacher, student, foreign])
        assert.equal((await http(`${base}/${kind}`, a)).status, 403);
      assert.equal((await http(`${base}/${kind}`)).status, 401);
      assert.equal((await http(`${base}/${kind}?offering=${offering}`, manager)).status, 400);
      assert.equal((await http(`${base}/${kind}?q=x&q=y`, manager)).status, 400);
      const first = await read(kind, { limit: '10' });
      assert.equal(
        (await http(`${base}/${kind}?limit=50&cursor=${first.nextCursor}`, manager)).status,
        400,
      );
      const other = kind === 'courses' ? 'terms' : 'courses';
      assert.equal(
        (await http(`${base}/${other}?limit=10&cursor=${first.nextCursor}`, manager)).status,
        400,
      );
      assert.equal(
        (await http(`${base}/${kind}?limit=10&cursor=${first.nextCursor}`, outsider)).status,
        400,
      );
      const foreignResult = await http(`/api/zhiban/management/${otherTenant}/${kind}`, foreign);
      assert.equal(foreignResult.status, 200);
      assert.deepEqual((foreignResult.json as unknown as Page).rows, []);
    }
    const published = await read('courses', { state: 'PUBLISHED', limit: '50' });
    assert.ok(published.rows.every((r) => r.status === 'PUBLISHED'));
    assert.equal((await collect('courses', { state: 'PUBLISHED', limit: '50' })).size, 208);
    assert.equal((await http(`${base}/terms?state=PUBLISHED`, manager)).status, 400);
    assert.equal((await http(`${base}/classes?state=ACTIVE`, manager)).status, 400);
    record(
      '621 courses, 621 terms and 620 classes paginate completely; course states, literal Chinese search, empty results, admin/RLS and kind-bound cursor limits work',
    );
    const draft = masterCourses[1],
      archived = masterCourses[2],
      code = 'NEGATIVE_CREATE';
    const create = {
      type: 'CREATE_OFFERING',
      courseId: draft.id,
      termId: term,
      classId: null,
      code,
      name: '失败不能建班',
      capacity: 20,
    };
    assert.equal((await command(create)).status, 409);
    assert.equal((await command({ ...create, courseId: archived.id })).status, 409);
    assert.equal((await command({ ...create, courseId: course, termId: v7() })).status, 404);
    assert.equal((await command({ ...create, courseId: course, classId: v7() })).status, 404);
    assert.equal((await command({ ...create, courseId: course, capacity: 1001 })).status, 400);
    assert.equal((await command({ ...create, courseId: course }, teacher)).status, 403);
    const foreignTerm = v7(),
      foreignClass = v7(),
      foreignCourse = v7();
    await admin.query(
      "INSERT INTO zhiban_academic.terms VALUES($1,$2,'FTERM','外空间学期','2026-10-01','2027-01-01',1)",
      [otherTenant, foreignTerm],
    );
    await admin.query(
      "INSERT INTO zhiban_academic.classes VALUES($1,$2,'FCLASS','外空间行政班',NULL,1)",
      [otherTenant, foreignClass],
    );
    await admin.query(
      "INSERT INTO zhiban_academic.courses VALUES($1,$2,'FCOURSE','外空间课程','',NULL,'PUBLISHED',1,1,$3,$3)",
      [otherTenant, foreignCourse, now],
    );
    for (const change of [
      { courseId: foreignCourse },
      { termId: foreignTerm },
      { classId: foreignClass },
    ])
      assert.equal((await command({ ...create, courseId: course, ...change })).status, 404);
    assert.equal((await read('offerings', { q: code })).rows.length, 0);
    const createReplayKey = v7().replaceAll('-', ''),
      payload = {
        ...create,
        courseId: course,
        code: 'ACK_CREATE',
        name: '快照超限建班',
        classId: masterClasses[619].id,
      };
    assert.equal((await command(payload, manager, createReplayKey)).status, 200);
    assert.equal((await command(payload, manager, createReplayKey)).status, 200);
    assert.equal((await read('offerings', { q: 'ACK_CREATE' })).rows.length, 1);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
            [t, createReplayKey],
          )
        ).rows[0].n,
      ),
      1,
    );
    record(
      'new teaching class uses original ACK transaction beyond all snapshot caps; replay inserts once; draft/archive, cross-tenant references, missing targets, invalid capacity and non-admin writes reject without partial creation',
    );
    assert.equal(
      (
        await command({
          type: 'CREATE_TERM',
          code: 'BAD_TERM',
          name: '反向日期',
          startsOn: '2027-01-01',
          endsOn: '2026-01-01',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await command({
          type: 'CREATE_COURSE',
          code: 'OWNER_KEEP',
          name: '保留负责人课程',
          description: '测试',
          ownerMembershipId: teacher.member,
        })
      ).status,
      200,
    );
    const ownerCourse = (await read('courses', { q: 'OWNER_KEEP' })).rows[0];
    assert.equal(ownerCourse.owner_membership_id, teacher.member);
    record(
      'master creation remains within original command validation, including reversed-date refusal and existing course owner assignment',
    );

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        ...(localPgMajor === 18
          ? [
              '--ignore-certificate-errors-spki-list=' +
                createHash('sha256')
                  .update(
                    new X509Certificate(tls).publicKey.export({ type: 'spki', format: 'der' }),
                  )
                  .digest('base64'),
            ]
          : []),
      ],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const requested: string[] = [];
    page.on('request', (r) => requested.push(new URL(r.url()).pathname));
    await context.addCookies([
      {
        name: manager.cookie!.split('=')[0],
        value: manager.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    await page.goto(origin + `/zhiban?space=${t}`);
    await expect(page.locator('.space-card').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '教务管理', exact: true })).toBeVisible();
    await expect(page.locator('.management-list article')).toHaveCount(20);
    assert.equal(requested.filter((p) => p.startsWith('/api/zhiban/academic/')).length, 0);
    assert.equal(requested.filter((p) => p.startsWith('/api/zhiban/directory/')).length, 0);
    const firstName = await page.locator('.management-list article h2').first().innerText();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.getByText('第 2 页 · 本页 20 条', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await expect(page.locator('.management-list article h2').first()).toHaveText(firstName);
    await page.getByLabel('搜索教学班', { exact: true }).fill('机电一班');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.locator('.management-list article')).toHaveCount(1);
    await page.getByRole('button', { name: '管理学生名单', exact: true }).click();
    await expect(page.locator('.management-list article')).toHaveCount(20);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.getByText('第 2 页 · 本页 20 条', { exact: true })).toBeVisible();
    await page.getByLabel('搜索学生', { exact: true }).fill('大名单学生0619');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.locator('.management-list article')).toHaveCount(1);
    await expect(page.getByText('第 1 页 · 本页 1 条', { exact: true })).toBeVisible();
    record(
      'trusted HTTPS browser enters paged admin workspace directly without legacy snapshot; offering and Enrollment previous/next and search reset work',
    );
    if (adminWorkspace) {
      await page.route(
        `**/api/zhiban/workspace/${t}/courses?**`,
        (route) =>
          route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
          }),
        { times: 1 },
      );
      await page.reload();
      await expect(page.getByRole('button', { name: '重试课程', exact: true })).toBeVisible();
      await expect(page.locator('.management-root')).toHaveCount(0);
      assert.equal(requested.filter((p) => p.startsWith('/api/zhiban/academic/')).length, 0);
      await page.getByRole('button', { name: '重试课程', exact: true }).click();
      await expect(page.locator('.management-list article')).toHaveCount(20);
      await page.route(
        `**/api/zhiban/management/${t}/offerings?**`,
        (route) =>
          route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
          }),
        { times: 1 },
      );
      await page.reload();
      await expect(page.getByRole('button', { name: '重试加载', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '重试加载', exact: true }).click();
      await expect(page.locator('.management-list article')).toHaveCount(20);
      await expect(page.locator('.management-message')).toBeEmpty();
      assert.equal(requested.filter((p) => p.startsWith('/api/zhiban/academic/')).length, 0);
      assert.equal(requested.filter((p) => p.startsWith('/api/zhiban/directory/')).length, 0);
      record(
        'bootstrap and management read failures stay bounded, retry to ADMIN correctly, and never invoke legacy snapshot or directory permission probes',
      );
      // Restore the original Enrollment journey after testing a fresh main-workspace mount.
      await page.getByLabel('搜索教学班', { exact: true }).fill('机电一班');
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await expect(page.locator('.management-list article')).toHaveCount(1);
      await page.getByRole('button', { name: '管理学生名单', exact: true }).click();
      await page.getByLabel('搜索学生', { exact: true }).fill('大名单学生0619');
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await expect(page.locator('.management-list article')).toHaveCount(1);
    }
    let droppedKey = '';
    await page.route(
      `**/api/zhiban/management/${t}/commands`,
      async (route) => {
        droppedKey = route.request().headers()['x-zhiban-command'];
        const r = await http(`${base}/commands`, manager, route.request().postDataJSON(), 'POST', {
          'x-zhiban-command': droppedKey,
        });
        assert.equal(r.status, 200);
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: '移出学生', exact: true }).click();
    await expect(page.getByRole('button', { name: '按原命令号重试', exact: true })).toBeVisible();
    assert.equal(
      (await read('enrollments', { offering, member: bulk[619].member, state: 'ALL' })).rows[0]
        .status,
      'WITHDRAWN',
    );
    await page.getByRole('button', { name: '按原命令号重试', exact: true }).click();
    await expect(page.getByText('暂无匹配记录。', { exact: true })).toBeVisible();
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
            [t, droppedKey],
          )
        ).rows[0].n,
      ),
      1,
    );
    await page.getByLabel('状态', { exact: true }).selectOption('WITHDRAWN');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.getByRole('button', { name: '恢复入班', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '恢复入班', exact: true }).click();
    await expect(page.getByText('暂无匹配记录。', { exact: true })).toBeVisible();
    record(
      'response loss after COMMIT locks other controls and replays original key without duplicate audit; UI restores withdrawn Enrollment',
    );
    await page.getByLabel('状态', { exact: true }).selectOption('ACTIVE');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.getByRole('button', { name: '转班', exact: true }).click();
    await expect(page.getByRole('button', { name: '下一页目标', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '下一页目标', exact: true }).click();
    await expect(
      page.locator('.management-transfer button').filter({ hasText: '转入 分页教学班' }).first(),
    ).toBeVisible();
    await page
      .locator('.management-transfer button')
      .filter({ hasText: '转入 分页教学班' })
      .first()
      .click();
    await expect(page.getByText('暂无匹配记录。', { exact: true })).toBeVisible();
    assert.equal(
      (await read('enrollments', { offering, member: bulk[619].member, state: 'ALL' })).rows[0]
        .status,
      'WITHDRAWN',
    );
    record(
      'UI browses multiple pages of transfer targets and atomically transfers the selected student',
    );
    await page.getByRole('button', { name: '返回教学班列表', exact: true }).click();
    await page.getByLabel('搜索教学班', { exact: true }).fill('分页教学班');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.locator('.management-list article')).toHaveCount(20);
    await page.screenshot({
      path: `docs/v2/evidence/${evidenceName}-offerings-local.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: '管理学生名单', exact: true }).first().click();
    await page.getByText('修改教学班', { exact: true }).click();
    await page.getByLabel('教学班名称', { exact: true }).fill('浏览器已修改教学班');
    await page.getByRole('button', { name: '保存教学班', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '浏览器已修改教学班', exact: true }),
    ).toBeVisible();
    await page.getByText('从学生目录添加一名学生', { exact: true }).click();
    await expect(page.locator('.directory-table tbody tr')).toHaveCount(20);
    await page
      .getByRole('searchbox', { name: '姓名或完整成员 ID', exact: true })
      .fill(candidate.member);
    await page.getByRole('button', { name: '搜索学生', exact: true }).click();
    await expect(page.locator('.directory-table tbody tr')).toHaveCount(1);
    await page.locator('.directory-table input[type="checkbox"]').check();
    await page.getByRole('button', { name: '添加已选学生', exact: true }).click();
    await expect(page.locator('.management-list article')).toHaveCount(1);
    record(
      'UI edits a teaching class and adds a single student from the paged directory with fresh Enrollment revision lookup',
    );
    await page.getByRole('button', { name: '返回教学班列表', exact: true }).click();
    for (const [kind, label, prefix] of [
      ['courses', '课程', '分页课程'],
      ['terms', '学期', '分页学期'],
      ['classes', '行政班', '分页行政班'],
    ] as const) {
      await page
        .getByRole('navigation', { name: '教务分类' })
        .getByRole('button', { name: label, exact: true })
        .click();
      await expect(page.locator('.management-list article')).toHaveCount(
        kind === 'courses' ? 20 : 10,
      );
      await page.getByLabel('搜索' + label, { exact: true }).fill(prefix);
      await page.getByLabel('每页条数', { exact: true }).selectOption('10');
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await expect(page.locator('.management-list article')).toHaveCount(10);
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await expect(page.getByText('第 2 页 · 本页 10 条', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '上一页', exact: true }).click();
      await expect(page.getByText('第 1 页 · 本页 10 条', { exact: true })).toBeVisible();
      await page.getByLabel('搜索' + label, { exact: true }).fill(prefix + '0619');
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await expect(page.locator('.management-list article')).toHaveCount(1);
    }
    record(
      'browser master-data tabs each support Chinese search, page-size selection, previous/next and reset after search',
    );
    await page
      .getByRole('navigation', { name: '教务分类' })
      .getByRole('button', { name: '学期', exact: true })
      .click();
    await page.getByText('新建学期', { exact: true }).click();
    await page.getByLabel('学期编号', { exact: true }).fill('UI_TERM');
    await page.getByLabel('学期名称', { exact: true }).fill('浏览器新建学期');
    await page.getByLabel('开始日期', { exact: true }).fill('2027-02-01');
    await page.getByLabel('结束日期', { exact: true }).fill('2027-07-01');
    await page.getByRole('button', { name: '创建学期', exact: true }).click();
    await expect(page.getByRole('heading', { name: '浏览器新建学期', exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: '教务分类' })
      .getByRole('button', { name: '行政班', exact: true })
      .click();
    await page.getByText('新建行政班', { exact: true }).click();
    await page.getByLabel('行政班编号', { exact: true }).fill('UI_CLASS');
    await page.getByLabel('行政班名称', { exact: true }).fill('浏览器新建行政班');
    await page.getByRole('button', { name: '创建行政班', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '浏览器新建行政班', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: '教务分类' })
      .getByRole('button', { name: '课程', exact: true })
      .click();
    await page.getByText('新建课程', { exact: true }).click();
    await page.getByLabel('课程编号', { exact: true }).fill('UI_COURSE');
    await page
      .locator('details[aria-label="新建课程"]')
      .getByLabel('课程名称', { exact: true })
      .fill('浏览器新建课程');
    await page
      .locator('details[aria-label="新建课程"]')
      .getByLabel('课程简介', { exact: true })
      .fill('浏览器课程简介');
    await page.getByRole('button', { name: '创建课程', exact: true }).click();
    await expect(page.getByRole('heading', { name: '浏览器新建课程', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '发布课程', exact: true }).click();
    await expect(page.locator('.management-list article')).toContainText('已发布 · 发布版本 1');
    await page.getByLabel('搜索课程', { exact: true }).fill('OWNER_KEEP');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.getByRole('heading', { name: '保留负责人课程', exact: true })).toBeVisible();
    await page.getByText('编辑课程', { exact: true }).click();
    await page
      .locator('.management-list article')
      .getByLabel('课程名称', { exact: true })
      .fill('浏览器修改保留负责人');
    await page
      .locator('.management-list article')
      .getByRole('button', { name: '保存课程', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: '浏览器修改保留负责人', exact: true }),
    ).toBeVisible();
    assert.equal(
      (await read('courses', { q: 'OWNER_KEEP' })).rows[0].owner_membership_id,
      teacher.member,
    );
    record(
      'browser creates term/class/course beyond 500 rows, publishes immutable course version, edits course without clearing existing owner, and shows created rows through bounded code search',
    );
    await page.screenshot({
      path: `docs/v2/evidence/${evidenceName}-course-local.png`,
      fullPage: true,
    });
    await page
      .getByRole('navigation', { name: '教务分类' })
      .getByRole('button', { name: '教学班', exact: true })
      .click();
    await page.getByText('新建教学班', { exact: true }).click();
    await page.getByLabel('教学班编号', { exact: true }).fill('UI_OFFERING');
    await page.getByLabel('教学班名称', { exact: true }).fill('分页选择器建班');
    await page.getByLabel('教学班容量', { exact: true }).fill('42');
    await page.getByRole('button', { name: '创建教学班', exact: true }).click();
    await expect(page.getByText('请先选择已发布课程和学期。', { exact: true })).toBeVisible();
    for (const [label, prefix] of [
      ['课程', '分页课程'],
      ['学期', '分页学期'],
      ['行政班', '分页行政班'],
    ]) {
      const selector = page.getByRole('region', { name: label + '选择器', exact: true });
      await selector.getByLabel(label + '搜索', { exact: true }).fill(prefix);
      await selector.getByRole('button', { name: '搜索' + label, exact: true }).click();
      await expect(selector.locator('.management-option')).toHaveCount(10);
      await selector.getByRole('button', { name: '下一页' + label, exact: true }).click();
      await expect(selector.getByText('第 2 页 · 本页 10 条', { exact: true })).toBeVisible();
      await selector
        .getByRole('button', {
          name: '选择' + label + ' ' + prefix + (label === '课程' ? '0030' : '0010'),
          exact: true,
        })
        .click();
    }
    const selectedCourse = masterCourses[30];
    assert.equal(
      (
        await command({
          type: 'EDIT_COURSE',
          id: selectedCourse.id,
          revision: '1',
          name: selectedCourse.name + ' 更新',
          description: '二次发布',
          ownerMembershipId: null,
        })
      ).status,
      200,
    );
    assert.equal(
      (await command({ type: 'PUBLISH_COURSE', id: selectedCourse.id, revision: '2' })).status,
      200,
    );
    await page.screenshot({
      path: `docs/v2/evidence/${evidenceName}-selectors-local.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: '创建教学班', exact: true }).click();
    await expect(page.getByRole('heading', { name: '分页选择器建班', exact: true })).toBeVisible();
    const created = (
      await admin.query('SELECT * FROM zhiban_academic.offerings WHERE tenant_id=$1 AND code=$2', [
        t,
        'UI_OFFERING',
      ])
    ).rows[0];
    assert.equal(created.course_id, selectedCourse.id);
    assert.equal(created.course_version, 2);
    assert.equal(created.term_id, masterTerms[10].id);
    assert.equal(created.class_id, masterClasses[10].id);
    assert.equal(created.capacity, 42);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_academic.course_versions WHERE tenant_id=$1 AND id=$2',
            [t, selectedCourse.id],
          )
        ).rows[0].n,
      ),
      2,
    );
    record(
      'three independent selectors search and page beyond the first page, retain required/optional choices, and CREATE_OFFERING binds current published version at commit without mutating old versions',
    );
    await page.getByText('新建教学班', { exact: true }).click();
    await page.getByLabel('教学班编号', { exact: true }).fill('UI_RACE');
    await page.getByLabel('教学班名称', { exact: true }).fill('归档竞态恢复建班');
    for (const [label, prefix] of [
      ['课程', '分页课程0033'],
      ['学期', '分页学期0010'],
      ['行政班', '分页行政班0010'],
    ]) {
      const selector = page.getByRole('region', { name: label + '选择器', exact: true });
      await selector.getByLabel(label + '搜索', { exact: true }).fill(prefix);
      await selector.getByRole('button', { name: '搜索' + label, exact: true }).click();
      await expect(selector.locator('.management-option')).toHaveCount(1);
      await selector
        .getByRole('button', { name: '选择' + label + ' ' + prefix, exact: true })
        .click();
    }
    assert.equal(
      (await command({ type: 'ARCHIVE_COURSE', id: masterCourses[33].id, revision: '1' })).status,
      200,
    );
    await page.getByRole('button', { name: '创建教学班', exact: true }).click();
    await expect(page.locator('.management-message')).toContainText('当前状态不允许此操作');
    assert.equal((await read('offerings', { q: 'UI_RACE' })).rows.length, 0);
    const chooser = page.getByRole('region', { name: '课程选择器', exact: true });
    await chooser.getByLabel('课程搜索', { exact: true }).fill('分页课程0036');
    await chooser.getByRole('button', { name: '搜索课程', exact: true }).click();
    await expect(chooser.locator('.management-option')).toHaveCount(1);
    await chooser.getByRole('button', { name: '选择课程 分页课程0036', exact: true }).click();
    await page.getByRole('button', { name: '不关联行政班', exact: true }).click();
    await page.getByRole('button', { name: '创建教学班', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '归档竞态恢复建班', exact: true }),
    ).toBeVisible();
    assert.equal(
      (
        await admin.query(
          "SELECT class_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND code='UI_RACE'",
          [t],
        )
      ).rows[0].class_id,
      null,
    );
    await page.screenshot({
      path: `docs/v2/evidence/${evidenceName}-created-local.png`,
      fullPage: true,
    });
    record(
      'course archived after selection is refused without creation; selections survive failure, replacement course can be chosen, and optional class can be cleared before successful creation',
    );

    if (adminWorkspace) {
      await page.goto(origin + `/zhiban/management?tenant=${t}`);
      await expect(page.locator('.management-list article')).toHaveCount(20);
      await page
        .getByRole('navigation', { name: '教务分类' })
        .getByRole('button', { name: '行政班', exact: true })
        .click();
      await expect(page.getByLabel('搜索行政班', { exact: true })).toBeVisible();
      await expect(
        page.locator('.management-list article a').filter({ hasText: '管理成员' }).first(),
      ).toBeVisible();
      await page.goto(origin + `/zhiban/management?tenant=${t}&mode=ADMIN`);
      await expect(page.getByText('空间地址无效，请从工作台进入。', { exact: true })).toBeVisible();
      await expect(page.locator('.management-list')).toHaveCount(0);
      record(
        'standalone management reuses the same paged view and relationship links, while invalid entry parameters fail closed',
      );

      for (const actor of [teacher, student]) {
        const memberContext = await browser.newContext();
        await memberContext.addCookies([
          {
            name: actor.cookie!.split('=')[0],
            value: actor.cookie!.split('=').slice(1).join('='),
            url: origin,
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
          },
        ]);
        const memberPage = await memberContext.newPage();
        const memberReads: string[] = [];
        memberPage.on('request', (r) => memberReads.push(new URL(r.url()).pathname));
        await memberPage.goto(origin + `/zhiban?space=${t}&mode=ADMIN`);
        await expect(memberPage.locator('.workspace-courses>article').first()).toBeVisible();
        await expect(memberPage.locator('.management-root')).toHaveCount(0);
        assert.equal(
          memberReads.filter(
            (p) => p.startsWith('/api/zhiban/academic/') || p.startsWith('/api/zhiban/management/'),
          ).length,
          0,
        );
        await memberPage.goto(origin + `/zhiban/management?tenant=${t}`);
        await expect(memberPage.locator('.management-message')).toContainText(
          '没有管理员权限或授权已失效',
        );
        await expect(memberPage.locator('.management-list')).toHaveCount(0);
        await memberContext.close();
      }
      record(
        'teacher/student still receive member course pages; URL mode cannot select ADMIN and direct management reads remain forbidden',
      );

      let arrived!: () => void, release!: () => void, completed!: () => void;
      const seen = new Promise<void>((done) => {
          arrived = done;
        }),
        held = new Promise<void>((done) => {
          release = done;
        }),
        finished = new Promise<void>((done) => {
          completed = done;
        });
      await page.route(
        `**/api/zhiban/management/${t}/offerings?**`,
        async (route) => {
          const response = await http(`${base}/offerings?limit=20`, manager);
          arrived();
          await held;
          try {
            await route.fulfill({
              status: response.status,
              contentType: 'application/json',
              body: JSON.stringify(response.json),
            });
          } catch {
            /* The removed view aborts this request. */
          } finally {
            completed();
          }
        },
        { times: 1 },
      );
      await page.goto(origin + `/zhiban?space=${t}`);
      await seen;
      await page.locator('.space-card').filter({ hasText: 'other' }).click();
      await expect(page.getByText('暂无匹配记录。', { exact: true })).toBeVisible();
      release();
      await finished;
      await expect(page.locator('.management-list article')).toHaveCount(0);
      await expect(page.locator('.space-card[aria-pressed="true"]')).toContainText('other');
      await page.locator('.space-card').filter({ hasText: 'analytics' }).click();
      await expect(page.locator('.management-list article')).toHaveCount(20);
      await expect(page.getByText('第 1 页 · 本页 20 条', { exact: true })).toBeVisible();
      assert.equal(requested.filter((p) => p.startsWith('/api/zhiban/academic/')).length, 0);
      record(
        'switching space destroys the old management view, aborts a held response, and resets filters/cursors without cross-space backfill',
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `docs/v2/evidence/${evidenceName}-enrollments-local.png`,
      fullPage: true,
    });
    record('390px responsive layout has no horizontal overflow or browser script errors');
    const peer = adminWorkspace ? await context.newPage() : null;
    if (peer) {
      await peer.goto(origin + `/zhiban?space=${t}`);
      await expect(peer.locator('.management-list article')).toHaveCount(20);
      await peer.getByText('新建教学班', { exact: true }).click();
      await peer.getByLabel('教学班名称', { exact: true }).fill('退出前尚未提交的草稿');
    }
    await page.goto(origin + '/zhiban');
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '智伴·创学', exact: true })).toBeVisible();
    assert.equal((await http(`${base}/offerings`, manager)).status, 401);
    if (peer) {
      await expect(peer.locator('.management-list')).toHaveCount(0);
      await expect(peer.getByLabel('教学班名称', { exact: true })).toHaveCount(0);
      await peer.close();
    }
    record('logout revokes access to paged management and clears mounted forms in another tab');
  }
  if (serve) {
    const login = await http('/api/zhiban/identity/login', undefined, {
      userId: manager.uid,
      password: manager.password,
    });
    assert.equal(login.status, 200);
    manager.cookie = login.cookie;
    manager.csrf = (await http('/api/zhiban/identity/csrf', manager)).json.csrfToken;
    if (unifiedTrial && !checks.some((c) => c.startsWith('MEMBER journey:')) && authOnly[1])
      await writeFile(
        join(owned, 'member-inputs.json'),
        JSON.stringify(
          {
            ...executionEvidence(),
            syntheticAuthority: true,
            tenant: t,
            stage: 'REGISTERED_USER_ADMISSION_NOT_ISSUED',
            subject: { userId: authOnly[1].uid, password: authOnly[1].password },
            adminUrl: `${origin}/zhiban/admin/members?tenant=${t}`,
            preparer:
              'pnpm exec tsx scripts/zhiban-local/prepare-member-admission.ts TENANT USER INVITE',
          },
          null,
          2,
        ),
        { mode: 0o600, flag: 'wx' },
      );
    const accountsPath = join(owned, 'accounts.json'),
      url =
        origin +
        (adminWorkspace || courseOwner || history || trial
          ? `/zhiban?space=${t}`
          : `/zhiban/management?tenant=${t}`),
      rosterUrl =
        trialData?.urls.roster ?? origin + `/zhiban/roster?tenant=${t}&offering=${otherOffering}`;
    await writeFile(
      accountsPath,
      JSON.stringify(
        {
          scope: trial ? 'LOCAL_SYNTHETIC_TRIAL' : 'LOCAL_DISPOSABLE_M6_CATALOG',
          directoryUrl: url,
          rosterUrl,
          accounts: trialData?.accounts ?? [
            { label: '教务管理员', userId: manager.uid, password: manager.password },
          ],
          ...(trialData ? { urls: trialData.urls, activityTitles: trialData.activityTitles } : {}),
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      `docs/v2/evidence/${evidenceName}-demo-local.json`,
      JSON.stringify(
        {
          ...executionEvidence(),
          status:
            localPgMajor === 18 && persistent ? 'RUNNING_LOCAL_PERSISTENT' : 'RUNNING_DISPOSABLE',
          ...(unifiedTrial
            ? {
                deliveryScope: 'LOCAL_UNIFIED_TEACHING',
                capabilities: [
                  'ACADEMIC',
                  'COURSE_DISCUSSION',
                  'COURSE_MATERIALS_TXT_MD_PDF',
                  'PUBLISHED_UNIT_PPTX_OFFLINE_HTML',
                  'LOCAL_REGISTERED_MEMBER_LIFECYCLE',
                  'TEACHER_COURSE_CLASS_DELEGATION',
                  'TEACHER_AI_TEXT_AUTHORING_HOST',
                  'SELF_PROFILE',
                  'ADMIN_MEMBER_DIRECTORY',
                  'OWN_ACCOUNT_SECURITY',
                  'CURRICULUM',
                  'TEXT_PNG_CONTENT',
                  'BASIC_CLASSROOM',
                  'TEXT_AND_SCANNED_ATTACHMENT',
                  'MANUAL_GRADING',
                  ...(finalgradeEnabled ? ['EXPLICIT_WEIGHTED_TOTALS_AND_APPEALS'] : []),
                  'GRADEBOOK_CSV',
                  'BASIC_ANALYTICS',
                ],
              }
            : {}),
          ...(trustedFiles
            ? {
                scanner: {
                  mode: scanner ? 'TRUSTED_SCANNER' : 'UNAVAILABLE',
                  profile: process.env.ZHIBAN_SCANNER_PROFILE,
                  sha256: process.env.ZHIBAN_SCANNER_PROFILE_SHA256,
                },
              }
            : {}),
          pid: process.pid,
          ...(trial
            ? {
                processStart: (await readFile(`/proc/${process.pid}/stat`, 'utf8'))
                  .split(') ')[1]
                  .trim()
                  .split(/\s+/)[19],
                trial: {
                  tenantId: trialData!.tenantId,
                  offeringId: trialData!.offeringId,
                  urls: trialData!.urls,
                  activityTitles: trialData!.activityTitles,
                },
                baselineHead: execFileSync('git', ['rev-parse', 'HEAD'], {
                  encoding: 'utf8',
                }).trim(),
              }
            : {}),
          origin,
          directoryUrl: url,
          rosterUrl,
          accountsPath,
          root: owned,
          ...(localPgMajor === 18 ? { stateRoot: process.env.ZHIBAN_LOCAL_STATE } : {}),
          port,
          database,
          ...(contentInstallation ? { contentInstallation } : {}),
          ...(lessonHost
            ? {
                nativeAiClassroom: {
                  enabled: true,
                  fixedPublication: true,
                  teacherOptIn: true,
                  personalRuntime: true,
                  formalResults: false,
                },
                aiLesson: {
                  database: 'zhiban_trial_lesson_native',
                  modelReadiness: 'CHECKED_PER_AUTHORIZED_REQUEST',
                  realGenerationVerified: false,
                  rawNativeApiExposed: false,
                },
              }
            : {}),
          attainment: { enabled: attainmentEnabled, evidenceOrigin: 'LOCAL', schoolOnly: true },
          autograde: {
            enabled: autogradeEnabled,
            ...executionEvidence(),
            serviceActor: 'zhiban_autograde_worker',
            explicitPolicyRequired: true,
          },
          ema: {
            enabled: emaEnabled,
            ...executionEvidence(),
            numericAbilityScores: false,
            unattendedDispatch: false,
          },
          sourceHashes,
          validation: {
            status: 'PASS',
            scope: pg18Acceptance
              ? 'PG18_FULL_HOST_NATIVE_PUBLICATION_RUNTIME_AND_NEGATIVE_GATES'
              : courseLiveFocus
                ? 'LOCAL_NATIVE_MP4_AND_TEACHER_SHARED_PRESENTATION'
                : courseResultsFocus
                  ? 'LOCAL_TRUSTED_COURSE_RESULTS_TO_FORMAL_SUBMISSION'
                  : serviceCenterFocus
                    ? 'LOCAL_ADMIN_SERVICE_CENTER_NO_EXTERNAL_PROVIDER_CALLS'
                    : multimodalFocus
                      ? 'LOCAL_MATERIALS_AND_MEDIA_AVAILABLE_SCOPE_NO_EXTERNAL_PROVIDER'
                      : nativeArchiveFocus
                        ? 'LOCAL_NATIVE_ARCHIVE_EXPORT_AND_OWNER_BOUND_RESTORE'
                        : nativePblFocus
                          ? 'LOCAL_NATIVE_AUTONOMOUS_PBL_FIXED_PUBLICATION_AND_PERSONAL_STATE'
                          : classroomAiFocus
                            ? 'LOCAL_NATIVE_AI_CLASSROOM_FIXED_PUBLICATION_AND_PERSONAL_RUNTIME'
                            : authoringFocus
                              ? 'LOCAL_NATIVE_WORKSPACE_FULL_DOCUMENT_ASSET_ADOPTION_PUBLICATION'
                              : simulationFocus
                                ? 'LOCAL_SERVER_CALCULATED_SIMULATION_AND_ORIGINAL_REPORT_GRADING'
                                : attainmentFocus
                                  ? 'LOCAL_SCHOOL_CERTIFICATE_CROSS_CLASS_CREDIT_RESTRICTED_SERVICE_GRADING'
                                  : emaFocus
                                    ? 'LOCAL_EMA_SIX_DIMENSION_JOURNEY'
                                    : pblFocus
                                      ? 'LOCAL_P6_NATIVE_DESIGN_GROUP_COLLABORATION_JOINT_SUBMISSION_TEACHER_EVALUATION'
                                      : avatarFocus
                                        ? 'LOCAL_SELF_AVATAR_AND_RESTRICTED_DIRECTORY'
                                        : gradebookExportFocus
                                          ? 'LOCAL_BOUNDED_FILTERED_GRADEBOOK_CSV_ONLY'
                                          : importsFocus
                                            ? 'ACADEMIC_MULTI_IMPORT_AND_DURABLE_BATCH_RESULTS_ONLY'
                                            : loginIdentifiersFocus
                                              ? 'CONTROLLED_LOGIN_IDENTIFIER_NOMINATION_RECIPIENT_BINDING_LOGIN_AND_DIRECTORY_ONLY'
                                              : accountStatusFocus
                                                ? 'CONTROLLED_GLOBAL_ACCOUNT_DISABLE_RESTORE_AND_TENANT_DIRECTORY_ONLY'
                                                : onboardingFocus
                                                  ? 'ORDINARY_ACCOUNT_CONTROL_CREATE_RECIPIENT_FIRST_PASSWORD_AND_LOGIN_ONLY'
                                                  : tutorFocus
                                                    ? 'COURSE_TUTOR_NATIVE_AGENT_AUTHORIZATION_AND_GOVERNANCE_ONLY'
                                                    : learnerFocus
                                                      ? 'LOCAL_P5_EVIDENCE_BACKED_LEARNER_OBSERVATIONS_AND_SELF_DISPUTES_DIMENSIONS_REVIEW'
                                                      : conceptFocus
                                                        ? 'LOCAL_P5_CONCEPT_EVIDENCE_TEACHER_CORRECTION_AND_STUDENT_RESPONSE'
                                                        : riskFocus
                                                          ? 'LOCAL_P5_EXPLAINABLE_RULES_PRIVATE_TEACHER_REVIEW_AND_EXPLICIT_SUPPORT'
                                                          : remediationFocus
                                                            ? 'LOCAL_P5_REMEDIATION_PLANS_STUDENT_TASKS_AND_EFFECT_REVIEW'
                                                            : remindersFocus
                                                              ? 'LOCAL_P5_IN_APP_REMINDERS_AND_EXPLICIT_CONFIRMATIONS'
                                                              : casesFocus
                                                                ? 'LOCAL_P5_MANUAL_FOLLOWUP_CASES_AND_RESOLUTION'
                                                                : followupsFocus
                                                                  ? 'LOCAL_P5_TEACHER_FACT_BASED_FOLLOWUPS'
                                                                  : resultsFocus
                                                                    ? 'LOCAL_CLASSROOM_RESULTS_AND_OWN_HISTORY'
                                                                    : jointFocus
                                                                      ? 'LOCAL_TEACHER_JOINT_CLASSROOM_ATOMIC_ATTEMPT_BINDING'
                                                                      : attemptRuntimeFocus
                                                                        ? 'LOCAL_ATTEMPT_RUNTIME_SERVER_PROVENANCE_NOT_NATIVE_RUNTIME'
                                                                        : interactiveFocus
                                                                          ? 'LOCAL_OFFLINE_INTERACTIVE_NATIVE_HOST_BRIDGE_PUBLICATION'
                                                                          : playerFocus
                                                                            ? nativeClassroomFocus
                                                                              ? 'NATIVE_PLAYER_EXISTING_CLASSROOM_PRESENTATION_ONLY'
                                                                              : 'FIXED_PUBLICATION_NATIVE_READONLY_PPT_PLAYER'
                                                                            : lessonFocus
                                                                              ? productFocus
                                                                                ? 'LESSON_FORMULA_ADOPT_AND_CLASSROOM_PRESENTATION'
                                                                                : 'AI_LESSON_DIRECTED_FIXTURE_NOT_MODEL'
                                                                              : teacherScope
                                                                                ? 'TEACHER_SCOPE_DIRECTED'
                                                                                : serve &&
                                                                                    unifiedTrial
                                                                                  ? 'STARTUP_AND_SYNTHETIC_SEED_ONLY'
                                                                                  : 'EXPLICIT_VERIFICATION',
            checks,
            ...(localPgMajor === 16 ? { pg16: pg } : { pg18: pg }),
            node: process.version,
          },
          tlsCertificateSha256: hash(tls),
        },
        null,
        2,
      ) + '\n',
    );
    if (trialData)
      await writeFile(
        join(owned, 'roster-example.csv'),
        'membershipId\n' + trialData.importMembershipId + '\n',
        { mode: 0o600, flag: 'wx' },
      );
    persistentMetadata = JSON.parse(
      await readFile(`docs/v2/evidence/${evidenceName}-demo-local.json`, 'utf8'),
    );
    console.log(`LOCAL M6 catalog ready: ${origin}/zhiban; accounts file: ${accountsPath}`);
    await new Promise<void>((done) => {
      process.once('SIGINT', () => done());
      process.once('SIGTERM', () => done());
    });
  }
}
try {
  const paths = execFileSync(
    'rg',
    [
      '--files',
      'lib/zhiban',
      'app/zhiban/local',
      'scripts/zhiban-local',
      'tests/zhiban/identity/authorization/fixtures.ts',
      'tests/zhiban/directory',
      'tests/zhiban/management',
      'tests/zhiban/workspace',
      'tests/zhiban/academic',
      'tests/zhiban/pbl',
      'tests/zhiban/ema',
      'tests/zhiban/attainment',
      'tests/zhiban/autograde',
      'lib/pbl/v2/types.ts',
      'lib/pbl/v2/runtime/learner-state.ts',
      'lib/pbl/v2/runtime/clone.ts',
      'lib/pbl/v2/operations/kernel/progress.ts',
      'lib/persistence/plain-json.ts',
      'tests/zhiban/profile',
      'tests/zhiban/material',
      'tests/zhiban/roster',
      'tests/zhiban/learning',
      'tests/zhiban/progress',
      'tests/zhiban/analytics',
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  for (const path of [...paths, process.argv[1], 'package.json', 'pnpm-lock.yaml'])
    sourceHashes[resolve(path)] = hash(await readFile(path));
  await main();
} catch (e) {
  startup.fail(e);
  failure = e;
  console.error(e);
} finally {
  for (const close of lessonCleanups) await close();
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done) => server!.close(() => done()));
  }
  await Promise.all(all.map((p) => p.end()));
  if (started) {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
    started = false;
  }
  let savedSnapshot: string | null = null;
  if (persistent && !failure) {
    try {
      savedSnapshot = await saveSnapshot(owned, false, persistentMetadata);
      console.log('LOCAL persistent data saved:', savedSnapshot);
    } catch (e) {
      failure = e;
      console.error('Snapshot failed; owned root retained.');
    }
  }
  if (!failure) await rm(owned, { recursive: true });
  await writeFile(
    serve
      ? `docs/v2/evidence/${evidenceName}-demo-close-local.json`
      : `docs/v2/evidence/${evidenceName}-local.json`,
    JSON.stringify(
      {
        ...executionEvidence(),
        status: failure ? 'FAIL' : 'PASS',
        at: new Date().toISOString(),
        node: process.version,
        ...(localPgMajor === 16 ? { pg16: pg } : { pg18: pg }),
        scope: pg18Acceptance
          ? 'PG18_FULL_HOST_NATIVE_PUBLICATION_RUNTIME_AND_NEGATIVE_GATES'
          : courseLiveFocus
            ? 'LOCAL_NATIVE_MP4_AND_TEACHER_SHARED_PRESENTATION'
            : courseResultsFocus
              ? 'LOCAL_TRUSTED_COURSE_RESULTS_TO_FORMAL_SUBMISSION'
              : serviceCenterFocus
                ? 'LOCAL_ADMIN_SERVICE_CENTER_NO_EXTERNAL_PROVIDER_CALLS'
                : multimodalFocus
                  ? 'LOCAL_MATERIALS_AND_MEDIA_AVAILABLE_SCOPE_NO_EXTERNAL_PROVIDER'
                  : nativeArchiveFocus
                    ? 'LOCAL_NATIVE_ARCHIVE_EXPORT_AND_OWNER_BOUND_RESTORE'
                    : nativePblFocus
                      ? 'LOCAL_NATIVE_AUTONOMOUS_PBL_FIXED_PUBLICATION_AND_PERSONAL_STATE'
                      : classroomAiFocus
                        ? 'LOCAL_NATIVE_AI_CLASSROOM_FIXED_PUBLICATION_AND_PERSONAL_RUNTIME'
                        : authoringFocus
                          ? 'LOCAL_NATIVE_WORKSPACE_FULL_DOCUMENT_ASSET_ADOPTION_PUBLICATION'
                          : simulationFocus
                            ? 'LOCAL_SERVER_CALCULATED_SIMULATION_AND_ORIGINAL_REPORT_GRADING'
                            : attainmentFocus
                              ? 'LOCAL_SCHOOL_CERTIFICATE_CROSS_CLASS_CREDIT_RESTRICTED_SERVICE_GRADING'
                              : emaFocus
                                ? 'LOCAL_EMA_SIX_DIMENSION_JOURNEY'
                                : pblFocus
                                  ? 'LOCAL_P6_NATIVE_DESIGN_GROUP_COLLABORATION_JOINT_SUBMISSION_TEACHER_EVALUATION'
                                  : avatarFocus
                                    ? 'LOCAL_SELF_AVATAR_AND_RESTRICTED_DIRECTORY'
                                    : gradebookExportFocus
                                      ? 'LOCAL_BOUNDED_FILTERED_GRADEBOOK_CSV_ONLY'
                                      : importsFocus
                                        ? 'ACADEMIC_MULTI_IMPORT_AND_DURABLE_BATCH_RESULTS_ONLY'
                                        : loginIdentifiersFocus
                                          ? 'CONTROLLED_LOGIN_IDENTIFIER_NOMINATION_RECIPIENT_BINDING_LOGIN_AND_DIRECTORY_ONLY'
                                          : accountStatusFocus
                                            ? 'CONTROLLED_GLOBAL_ACCOUNT_DISABLE_RESTORE_AND_TENANT_DIRECTORY_ONLY'
                                            : onboardingFocus
                                              ? 'ORDINARY_ACCOUNT_CONTROL_CREATE_RECIPIENT_FIRST_PASSWORD_AND_LOGIN_ONLY'
                                              : tutorFocus
                                                ? 'COURSE_TUTOR_NATIVE_AGENT_AUTHORIZATION_AND_GOVERNANCE_ONLY'
                                                : learnerFocus
                                                  ? 'LOCAL_P5_EVIDENCE_BACKED_LEARNER_OBSERVATIONS_AND_SELF_DISPUTES_DIMENSIONS_REVIEW'
                                                  : conceptFocus
                                                    ? 'LOCAL_P5_CONCEPT_EVIDENCE_TEACHER_CORRECTION_AND_STUDENT_RESPONSE'
                                                    : riskFocus
                                                      ? 'LOCAL_P5_EXPLAINABLE_RULES_PRIVATE_TEACHER_REVIEW_AND_EXPLICIT_SUPPORT'
                                                      : remediationFocus
                                                        ? 'LOCAL_P5_REMEDIATION_PLANS_STUDENT_TASKS_AND_EFFECT_REVIEW'
                                                        : remindersFocus
                                                          ? 'LOCAL_P5_IN_APP_REMINDERS_AND_EXPLICIT_CONFIRMATIONS'
                                                          : casesFocus
                                                            ? 'LOCAL_P5_MANUAL_FOLLOWUP_CASES_AND_RESOLUTION'
                                                            : followupsFocus
                                                              ? 'LOCAL_P5_TEACHER_FACT_BASED_FOLLOWUPS'
                                                              : resultsFocus
                                                                ? 'LOCAL_CLASSROOM_RESULTS_AND_OWN_HISTORY'
                                                                : jointFocus
                                                                  ? 'LOCAL_TEACHER_JOINT_CLASSROOM_ATOMIC_ATTEMPT_BINDING'
                                                                  : attemptRuntimeFocus
                                                                    ? 'LOCAL_ATTEMPT_RUNTIME_SERVER_PROVENANCE_NOT_NATIVE_RUNTIME'
                                                                    : interactiveFocus
                                                                      ? 'LOCAL_OFFLINE_INTERACTIVE_NATIVE_HOST_BRIDGE_PUBLICATION'
                                                                      : playerFocus
                                                                        ? nativeClassroomFocus
                                                                          ? 'LOCAL_NATIVE_CLASSROOM_PRESENTATION_NO_MAINTENANCE'
                                                                          : 'LOCAL_FIXED_PUBLICATION_NATIVE_READONLY_PPT_PLAYER'
                                                                        : productFocus
                                                                          ? 'LOCAL_LESSON_FORMULA_ADOPT_CLASSROOM_PRESENTATION_NOT_MODEL'
                                                                          : lessonFocus
                                                                            ? 'LOCAL_AI_LESSON_DIRECTED_FIXTURE_NOT_MODEL'
                                                                            : trialContent
                                                                              ? 'LOCAL_UNIFIED_TEXT_PNG_DISPOSABLE'
                                                                              : classroomFixes
                                                                                ? 'LOCAL_CL_01_CL_02_DIRECTED_FIXES'
                                                                                : rosterTrial
                                                                                  ? 'LOCAL_UAT_04_ADMIN_CONTROL_STATE_REGRESSION'
                                                                                  : uatRound2
                                                                                    ? 'LOCAL_UAT_03_AND_01_02_REGRESSION'
                                                                                    : uatFixes
                                                                                      ? 'LOCAL_UAT_01_02_DIRECTED_FIXES'
                                                                                      : trial
                                                                                        ? 'LOCAL_SYNTHETIC_THREE_ROLE_TEACHING_TRIAL'
                                                                                        : history
                                                                                          ? 'M6_ADMIN_MANAGEMENT_HISTORY_DISPOSABLE_PG16_HTTPS_UI'
                                                                                          : courseOwner
                                                                                            ? 'M6_COURSE_OWNER_SELECTOR_DISPOSABLE_PG16_HTTPS_UI'
                                                                                            : adminWorkspace
                                                                                              ? 'M6_ADMIN_WORKSPACE_DIRECT_PAGING_DISPOSABLE_PG16_HTTPS_UI'
                                                                                              : 'M6_MASTER_DATA_PAGING_OFFERING_SELECTORS_DISPOSABLE_PG16_HTTPS_UI',
        checks,
        sourceHashes,
        lifecycle: {
          root: owned,
          ...(localPgMajor === 18 ? { stateRoot: process.env.ZHIBAN_LOCAL_STATE } : {}),
          port,
          database,
          stopped: !started,
          removed: !failure,
          savedSnapshot,
        },
        excluded: [
          '55432/55433 clusters',
          'Native/maintenance quarantine',
          'production/CI signoff',
          'raw User status/credentials',
          'activity/attempt pagination',
          'persistent/asynchronous or unbounded export; course totals and appeals',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  if (failure) process.exitCode = 1;
}
