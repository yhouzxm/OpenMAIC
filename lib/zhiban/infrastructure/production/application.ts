import { platformHttp } from './platform-http';
/** Formal service assembly over existing domain services; no fixtures, seeds or startup DDL. */
/* eslint-disable @typescript-eslint/no-explicit-any -- composition boundary over existing HTTP adapters */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { ContentService } from '../content/service';
import { LessonService } from '../lesson/service';
import type { IdentityCompositionConfig } from '../identity/composition/root';
import { PostgresTeacherRelationships } from '../teaching/postgres/relationships';
import { CourseResultsService } from '@/lib/zhiban/infrastructure/course-results/service';
import { courseResultsHttp } from '@/lib/zhiban/infrastructure/course-results/http';
import { initializeServiceCenter } from '@/lib/zhiban/infrastructure/service-center/config';
import { ServiceCenter } from '@/lib/zhiban/infrastructure/service-center/service';
import { serviceCenterHttp } from '@/lib/zhiban/infrastructure/service-center/http';
import { authoringHttp } from '@/lib/zhiban/infrastructure/authoring/http';
import { classroomAiHttp } from '@/lib/zhiban/infrastructure/classroom-ai/http';
import { AttainmentService } from '@/lib/zhiban/application/attainment/service';
import { createAttainmentHttp } from '@/lib/zhiban/infrastructure/attainment/http';
import { AutoGradeService } from '@/lib/zhiban/application/autograde/service';
import { createAutoGradeHttp } from '@/lib/zhiban/infrastructure/autograde/http';
import { AutoGradeWorker } from '@/lib/zhiban/infrastructure/autograde/worker';
import { nativeAutoEngine } from '@/lib/zhiban/infrastructure/autograde/native';
import { EmaService } from '@/lib/zhiban/application/ema/service';
import { createEmaHttp } from '@/lib/zhiban/infrastructure/ema/http';
import { nativeEmaEngine } from '@/lib/zhiban/infrastructure/ema/native';
import { PblService } from '@/lib/zhiban/application/pbl/service';
import { createPblHttp } from '@/lib/zhiban/infrastructure/pbl/http';
import { FlowService } from '@/lib/zhiban/application/flow/service';
import { createFlowHttp } from '@/lib/zhiban/infrastructure/flow/http';
import { loadMaterialParserProfile } from '@/lib/zhiban/infrastructure/material/config';
import { QuizAdviceService } from '@/lib/zhiban/application/quiz/advice';
import { nativeQuizAdvisor } from '@/lib/zhiban/infrastructure/quiz/advisor';
import { QuizService } from '@/lib/zhiban/application/quiz/service';
import { FinalGradeService } from '@/lib/zhiban/application/finalgrade/service';
import { ImportsService } from '@/lib/zhiban/application/imports/service';
import { createImportsHttp } from '@/lib/zhiban/infrastructure/imports/http';
import {
  LoginIdentifiers,
  memberLoginIdentifierReader,
} from '@/lib/zhiban/infrastructure/login-identifiers/service';
import { createLoginIdentifiersHttp } from '@/lib/zhiban/infrastructure/login-identifiers/http';
import { memberGlobalStatusReader } from '@/lib/zhiban/infrastructure/profile/global-status';
import { AccountRequestService } from '@/lib/zhiban/application/onboarding/service';
import { createAccountRequestHttp } from '@/lib/zhiban/infrastructure/onboarding/request-http';
import { createAccountSetupHttp } from '@/lib/zhiban/infrastructure/onboarding/setup-http';
import { OrdinaryCredentials } from '@/lib/zhiban/infrastructure/onboarding/credentials';
import { TutorService } from '@/lib/zhiban/application/tutor/service';
import { createTutorHttp } from '@/lib/zhiban/infrastructure/tutor/http';
import { nativeTutorEngine } from '@/lib/zhiban/infrastructure/tutor/native';
import { tutorContent } from '@/lib/zhiban/infrastructure/tutor/content';
import { LearnerService } from '@/lib/zhiban/application/learner/service';
import { createLearnerHttp } from '@/lib/zhiban/infrastructure/learner/http';
import { ConceptService } from '@/lib/zhiban/application/concept/service';
import { createConceptHttp } from '@/lib/zhiban/infrastructure/concept/http';
import { RiskService } from '@/lib/zhiban/application/risk/service';
import { createRiskHttp } from '@/lib/zhiban/infrastructure/risk/http';
import { RemediationService } from '@/lib/zhiban/application/remediation/service';
import { createRemediationHttp } from '@/lib/zhiban/infrastructure/remediation/http';
import { ReminderService } from '@/lib/zhiban/application/reminder/service';
import { createReminderHttp } from '@/lib/zhiban/infrastructure/reminder/http';
import { contentHttp } from '@/lib/zhiban/infrastructure/content/http';
import { MaterialService } from '@/lib/zhiban/application/material/service';
import { createMaterialHttp } from '@/lib/zhiban/infrastructure/material/http';
import { ProfileService } from '@/lib/zhiban/application/profile/service';
import { createProfileHttp } from '@/lib/zhiban/infrastructure/profile/http';
import { loadClamAv } from '@/lib/zhiban/infrastructure/learning-files/scanner/clamav';
import { WorkspaceService } from '@/lib/zhiban/application/workspace/service';
import { createWorkspaceHttp } from '@/lib/zhiban/infrastructure/workspace/http';
import { ManagementService } from '@/lib/zhiban/application/management/service';
import { createManagementHttp } from '@/lib/zhiban/infrastructure/management/http';
import { DirectoryService } from '@/lib/zhiban/application/directory/service';
import { createDirectoryHttp } from '@/lib/zhiban/infrastructure/directory/http';
import { RosterService } from '@/lib/zhiban/application/roster/service';
import { createRosterHttp } from '@/lib/zhiban/infrastructure/roster/http';
import { ProgressService } from '@/lib/zhiban/application/progress/service';
import { createProgressHttp } from '@/lib/zhiban/infrastructure/progress/http';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { createIdentityHttp } from '@/lib/zhiban/infrastructure/identity/http/adapter';
import { Argon2PasswordHasher } from '../identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '../identity/credentials/password-screening';
import { AcademicService } from '@/lib/zhiban/application/academic/service';
import { PostgresAcademicStore } from '@/lib/zhiban/infrastructure/academic/postgres/store';
import { createAcademicHttp } from '@/lib/zhiban/infrastructure/academic/http';
import { AnalyticsService } from '@/lib/zhiban/application/analytics/service';
import { createAnalyticsHttp } from '@/lib/zhiban/infrastructure/analytics/http';
import { LearningService } from '@/lib/zhiban/application/learning/service';
import { AssessmentService } from '@/lib/zhiban/application/assessment/service';
import { createLearningHttp } from '@/lib/zhiban/infrastructure/learning/http';
import { createAssessmentHttp } from '@/lib/zhiban/infrastructure/assessment/http';
export interface ApplicationInput {
  origin: string;
  identity: IdentityCompositionConfig;
  pools: {
    auth: Pool;
    tenant: Pool;
    control: Pool;
    business: Pool;
    bridge: Pool;
    native: Pool;
    worker: Pool;
  };
  teacherFingerprint: string;
  authoringUrl: string;
  materialRoot: string;
  deploymentId: string;
  contentBundle: string;
  contentCsp: string;
  scanner: Awaited<ReturnType<typeof loadClamAv>> | null;
  observe: (code: string) => void;
}
export async function assembleApplication(input: ApplicationInput) {
  const { origin } = input;
  const sharedClassroom = true,
    attachments = true;
  const lessonCleanups: Array<() => Promise<unknown> | void> = [];
  try {
    const auth = input.pools.auth,
      tenantPool = input.pools.tenant,
      control = input.pools.control,
      bridge = input.pools.bridge;
    const pool = (role: string) => {
      const p = (
        {
          zhiban_academic_runtime: input.pools.business,
          zhiban_autograde_worker: input.pools.worker,
        } as Record<string, Pool>
      )[role];
      if (!p) throw Error('Undeclared runtime pool');
      return p;
    };
    const composition = await createIdentityComposition(
      { auth, tenant: tenantPool, control },
      { ...input.identity, operator: null },
      {
        teacherRelationships: await PostgresTeacherRelationships.create(
          input.pools.tenant,
          input.teacherFingerprint,
        ),
      },
    );
    const httpPlatform = platformHttp(composition, control, origin);
    const facade = createIdentityHttp(
      async () => ({ ...composition, queries: composition.queries! }),
      { origin, concurrentRequests: 8, bodyTimeoutMs: 3000, retryAfterSeconds: 1 },
    );
    const hasher = new Argon2PasswordHasher(
      new LocalCompromisedPasswordScreening(input.identity.corpus.values),
    );
    const businessPool = pool('zhiban_academic_runtime');
    const store = new PostgresAcademicStore(
      businessPool,
      bridge,
      tenantPool,
      composition.security.bridgeSecurity(),
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
    const httpAcademic = createAcademicHttp(
      new AcademicService(store),
      composition.security,
      origin,
    );
    const profileEnabled = true;
    const identifiersEnabled = true;
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
    const discussionEnabled = true,
      materialEnabled = true;
    const scanner = input.scanner;
    const httpMaterial = createMaterialHttp(
      new MaterialService(store, scanner, await loadMaterialParserProfile()),
      composition.security,
      origin,
      undefined,
      materialEnabled,
    );
    const httpLearning = createLearningHttp(
      new LearningService(store, scanner, true),
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

    const finalgradeEnabled = true;
    const httpAssessment = createAssessmentHttp(
      new AssessmentService(store),
      composition.security,
      origin,
      undefined,
      attachments,
      new FinalGradeService(store, finalgradeEnabled),
      new QuizAdviceService(store, nativeQuizAdvisor),
    );
    const onboardingEnabled = true;
    const httpAccountRequests = createAccountRequestHttp(
      new AccountRequestService(store, onboardingEnabled),
      composition.security,
      origin,
    );
    const ordinaryCredentials = new OrdinaryCredentials(auth, hasher, onboardingEnabled);
    const httpAccountSetup = createAccountSetupHttp(ordinaryCredentials, origin);
    let tutorHost: TutorService | null = null;
    let httpTutor: ((request: Request) => Promise<Response>) | null = null;
    const pblEnabled = true;
    const httpPbl = createPblHttp(new PblService(store, pblEnabled), composition.security, origin);
    const flowEnabled = true;
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
    const attainmentEnabled = true;
    const autogradeEnabled = true;
    const workerPool = pool('zhiban_autograde_worker');
    const autoWorker = workerPool
      ? new AutoGradeWorker(workerPool, nativeAutoEngine, (code) =>
          input.observe('AUTOGRADE_SERVICE_' + code),
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
    const emaEnabled = true;
    const emaHost = new EmaService(store, nativeEmaEngine, emaEnabled);
    lessonCleanups.push(() => emaHost.stop());
    const httpEma = createEmaHttp(emaHost, composition.security, origin);
    const httpLearner = createLearnerHttp(
      new LearnerService(store, true),
      composition.security,
      origin,
    );
    const httpConcept = createConceptHttp(
      new ConceptService(store, true),
      composition.security,
      origin,
    );
    const httpRisk = createRiskHttp(new RiskService(store, true), composition.security, origin);
    const httpRemediation = createRemediationHttp(
      new RemediationService(store, true),
      composition.security,
      origin,
    );
    const httpReminders = createReminderHttp(
      new ReminderService(store, true),
      composition.security,
      origin,
    );
    const httpAnalytics = createAnalyticsHttp(
      new AnalyticsService(store, true),
      composition.security,
      origin,
    );
    const httpImports = createImportsHttp(
      new ImportsService(store, true),
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
    const httpProgress = createProgressHttp(
      new ProgressService(store),
      composition.security,
      origin,
    );
    const contentHost = {
      service: new ContentService(
        input.pools.bridge,
        input.pools.native,
        composition.security,
        input.deploymentId,
        () => {},
        true,
        true,
        true,
        true,
      ),
      http: null as any,
      bundlePath: input.contentBundle,
      csp: input.contentCsp,
    };
    const lessonHost = new LessonService(contentHost.service, new QuizService(store));
    lessonCleanups.push(() => lessonHost.close());
    await lessonHost.initialize(input.authoringUrl, true, input.materialRoot);
    tutorHost = new TutorService(store, tutorContent(contentHost.service), nativeTutorEngine, true);
    httpTutor = createTutorHttp(tutorHost, composition.security, origin);
    lessonCleanups.push(() => tutorHost!.close());
    contentHost.http = contentHttp(contentHost.service, composition.security, origin, lessonHost);
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
        ? classroomAiHttp(
            contentHost.service,
            lessonHost.authoringPool,
            composition.security,
            origin,
          )
        : null;

    if (autoWorker) {
      const tenants = (
        await control.query(
          "SELECT tenant_id FROM zhiban_identity.tenants WHERE status='ACTIVE' ORDER BY tenant_id LIMIT 10001",
        )
      ).rows;
      if (tenants.length > 10000)
        throw Error('Active tenant polling capacity requires explicit scaling');
      autoWorker.start(tenants.map((r) => r.tenant_id));
    }
    return {
      handlers: {
        httpPlatform,
        httpManagement,
        httpWorkspace,
        httpAcademic,
        httpLoginIdentifiers,
        httpProfile,
        httpMaterial,
        httpLearning,
        httpAssessment,
        httpAccountRequests,
        httpAccountSetup,
        httpTutor,
        httpPbl,
        httpFlow,
        httpAttainment,
        httpAutograde,
        httpEma,
        httpLearner,
        httpConcept,
        httpRisk,
        httpRemediation,
        httpReminders,
        httpAnalytics,
        httpImports,
        httpDirectory,
        httpRoster,
        httpProgress,
        httpNativeAuthoring,
        httpServices,
        httpCourseResults,
        httpClassroomAi,
        facade,
        contentHost,
      },
      close: async () => {
        for (const close of lessonCleanups.reverse()) await close();
      },
    };
  } catch (e) {
    for (const close of lessonCleanups.reverse())
      await Promise.resolve()
        .then(close)
        .catch(() => {});
    throw e;
  }
}
