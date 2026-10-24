import type { QuizTransaction } from '../quiz/service';
import {
  academicAdmin,
  academicCommand,
  AcademicError,
  type AcademicActor,
  type AcademicCommand,
} from '@/lib/zhiban/domain/academic/model';
import type { AuthenticatedRequestHandle } from '@/lib/zhiban/application/identity/use-cases/authentication';

export interface AcademicContext {
  handle: AuthenticatedRequestHandle;
  tenantId: string;
  actorMembershipId: string;
}
export interface AcademicSnapshot {
  mode: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'NONE';
  courses: Record<string, unknown>[];
  terms: Record<string, unknown>[];
  classes: Record<string, unknown>[];
  offerings: Record<string, unknown>[];
  assignments: Record<string, unknown>[];
  enrollments: Record<string, unknown>[];
  classMembers: Record<string, unknown>[];
  people: Record<string, unknown>[];
}
export interface AcademicTransaction {
  readonly attainment?: import('../../infrastructure/attainment/postgres/transaction').AttainmentPgTransaction;
  readonly autograde?: import('../../infrastructure/autograde/postgres/transaction').AutoGradePgTransaction;
  readonly ema?: import('../../infrastructure/ema/postgres/transaction').EmaPgTransaction;
  readonly pbl?: import('../../infrastructure/pbl/postgres/transaction').PblPgTransaction;
  readonly flow?: import('../../infrastructure/flow/postgres/transaction').FlowPgTransaction;
  readonly finalgrade?: import('../finalgrade/service').FinalGradeTransaction;
  readonly imports?: import('../../infrastructure/imports/postgres/transaction').ImportsPgTransaction;
  readonly onboarding?: import('../../infrastructure/onboarding/postgres/transaction').OnboardingPgTransaction;
  readonly tutor?: import('../../infrastructure/tutor/postgres/transaction').TutorPgTransaction;
  readonly learner?: import('../learner/service').LearnerTransaction;
  readonly concept?: import('../concept/service').ConceptTransaction;
  readonly risk?: import('../risk/service').RiskTransaction;
  readonly remediation?: import('../remediation/service').RemediationTransaction;
  readonly reminder?: import('../reminder/service').ReminderTransaction;
  readonly material?: import('../material/service').MaterialTransaction;
  readonly profile?: import('../profile/service').ProfileTransaction;
  readonly discussion?: import('../discussion/service').DiscussionTransaction;
  readonly quiz?: QuizTransaction;
  readonly classroom?: import('@/lib/zhiban/infrastructure/classroom/postgres/transaction').ClassroomPgTransaction;
  readonly curriculum?: import('@/lib/zhiban/infrastructure/curriculum/postgres/transaction').CurriculumPgTransaction;
  readonly workspace?: import('../workspace/service').WorkspaceTransaction;
  readonly management?: import('../management/service').ManagementTransaction;
  readonly directory?: import('../directory/service').DirectoryTransaction;
  readonly roster?: import('../roster/service').RosterTransaction;
  readonly progress?: import('../progress/service').ProgressTransaction;
  readonly analytics?: import('../analytics/service').AnalyticsTransaction;
  readonly assessment: import('../assessment/service').AssessmentTransaction;
  readonly learning: import('../learning/service').LearningTransaction;
  snapshot(actor: AcademicActor): Promise<AcademicSnapshot>;
  execute(actor: AcademicActor, command: AcademicCommand, key: string): Promise<void>;
}
export interface AcademicStore {
  runForPbl?<T>(
    context: AcademicContext,
    offering: string,
    groupId: string | null,
    proposedMembers: string[],
    work: (actor: AcademicActor, transaction: AcademicTransaction) => Promise<T>,
  ): Promise<T>;
  runForRelated?<T>(
    context: AcademicContext,
    membershipId: string,
    work: (actor: AcademicActor, transaction: AcademicTransaction) => Promise<T>,
  ): Promise<T>;
  runForLearnerRecipient?<T>(
    context: AcademicContext,
    offering: string,
    id: string,
    dispute: boolean,
    work: (actor: AcademicActor, transaction: AcademicTransaction) => Promise<T>,
  ): Promise<T>;
  runForConceptRecipient?<T>(
    context: AcademicContext,
    offering: string,
    id: string,
    work: (actor: AcademicActor, transaction: AcademicTransaction) => Promise<T>,
  ): Promise<T>;
  runForFollowupRecipient?<T>(
    context: AcademicContext,
    offering: string,
    caseId: string,
    work: (actor: AcademicActor, transaction: AcademicTransaction) => Promise<T>,
  ): Promise<T>;
  run<T>(
    context: AcademicContext,
    command: AcademicCommand | null,
    work: (actor: AcademicActor, transaction: AcademicTransaction) => Promise<T>,
  ): Promise<T>;
}
/** Role/relationship facts come from the locked server store, never request DTOs. */
export class AcademicService {
  constructor(private readonly store: AcademicStore) {}
  read(context: AcademicContext) {
    return this.store.run(context, null, (actor, transaction) => transaction.snapshot(actor));
  }
  /** Bounded command receipt. Durable command key remains safe to replay after an uncertain response. */
  acknowledge(context: AcademicContext, input: unknown, key: string) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw new AcademicError('INVALID_INPUT');
    const command = academicCommand(input);
    return this.store.run(context, command, async (actor, transaction) => {
      if (!academicAdmin(actor)) throw new AcademicError('FORBIDDEN');
      await transaction.execute(actor, command, key);
      return { commandKey: key, type: command.type, status: 'COMPLETED' as const };
    });
  }
  command(context: AcademicContext, input: unknown, key: string) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw new AcademicError('INVALID_INPUT');
    const command = academicCommand(input);
    return this.store.run(context, command, async (actor, transaction) => {
      if (!academicAdmin(actor)) throw new AcademicError('FORBIDDEN');
      await transaction.execute(actor, command, key);
      return transaction.snapshot(actor);
    });
  }
}
