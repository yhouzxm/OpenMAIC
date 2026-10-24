import { adviceHash, type AdviceInput, type AdviceResult } from '../../../application/quiz/advice';

import type { GeneratedQuizSource } from '../../../application/quiz/service';
import { progressBarrier } from '../../curriculum/postgres/progress';
import type { PoolClient, QueryResultRow } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
import { AssessmentPgTransaction } from '../../assessment/postgres/transaction';
import { academicId, requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import {
  content,
  answers,
  canonical,
  points,
  exact,
  type QuizCommand,
  type QuizGradeCommand,
  type Content,
  type Answers,
} from '../../../domain/quiz/model';
import { scorePoints, type AssessmentCommand } from '../../../domain/assessment/model';
import type { LearningCommand } from '../../../domain/learning/model';
import { gradeQuiz, publicQuiz, algorithm } from '../../../domain/quiz/fill';
// PostgreSQL row values remain internal; HTTP projections below explicitly select permitted fields.
type Row = QueryResultRow;
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const summary = '测验提交（结构化答案）';
export class QuizPgTransaction {
  private readonly learning: LearningPgTransaction;
  constructor(private readonly client: PoolClient) {
    this.learning = new LearningPgTransaction(client);
  }
  async rows(sql: string, args: unknown[] = []): Promise<Row[]> {
    return (await this.client.query(sql, args)).rows;
  }
  async read(
    actor: AcademicActor,
    offering: string,
    selector: { activity?: string; attempt?: string; submission?: string },
  ) {
    const access = await this.learning.access(actor, offering);
    const teacher = access.mode === 'TEACHER',
      t = actor.tenantId;
    requireAcademic(Object.keys(selector).length === 1);
    Object.values(selector).forEach(academicId);
    let attempt: Row | undefined,
      submission: Row | undefined,
      activityId = selector.activity;
    if (selector.submission) {
      [submission] = await this.rows(
        'SELECT s.*,a.activity_id FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts a ON a.tenant_id=s.tenant_id AND a.id=s.attempt_id WHERE s.tenant_id=$1 AND s.id=$2 AND a.offering_id=$3 AND ($4::uuid IS NULL OR a.membership_id=$4)',
        [t, selector.submission, offering, teacher ? null : actor.membershipId],
      );
      requireAcademic(!!submission, 'NOT_FOUND');
    }
    if (selector.attempt || submission) {
      [attempt] = await this.rows(
        'SELECT * FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2 AND offering_id=$3 AND ($4::uuid IS NULL OR membership_id=$4)',
        [
          t,
          selector.attempt ?? submission!.attempt_id,
          offering,
          teacher ? null : actor.membershipId,
        ],
      );
      requireAcademic(!!attempt, 'NOT_FOUND');
      activityId = attempt!.activity_id;
    }
    const [a] = await this.rows(
      'SELECT a.*,d.mode,d.draft AS content,d.review_closed_at FROM zhiban_learning.activities a JOIN zhiban_learning.quiz_definitions d ON d.tenant_id=a.tenant_id AND d.activity_id=a.id WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=$3',
      [t, offering, activityId],
    );
    requireAcademic(!!a, 'NOT_FOUND');
    requireAcademic(
      teacher || a.status === 'PUBLISHED' || (!!attempt && a.published_version > 0),
      'NOT_FOUND',
    );
    let version: Row | undefined;
    if (attempt || !teacher) {
      [version] = await this.rows(
        'SELECT q.*,v.title,v.deadline_at,v.allow_resubmit,v.max_attempts FROM zhiban_learning.quiz_versions q JOIN zhiban_learning.activity_versions v ON v.tenant_id=q.tenant_id AND v.activity_id=q.activity_id AND v.version=q.version WHERE q.tenant_id=$1 AND q.activity_id=$2 AND q.version=$3',
        [t, a.id, attempt?.activity_version ?? a.published_version],
      );
      requireAcademic(!!version, 'UNAVAILABLE');
      requireAcademic(algorithm(version.content.questions) === version.algorithm, 'UNAVAILABLE');
    }
    const used = await this.rows(
      'SELECT id,status,revision::text,attempt_no,activity_version FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2 AND membership_id=$3 ORDER BY attempt_no DESC LIMIT 1',
      [t, a.id, actor.membershipId],
    );
    const base: Row = {
      mode: access.mode,
      activityId: a.id,
      title: version?.title ?? a.title,
      status: a.status,
      quizMode: a.mode,
      revision: a.revision,
      version: version?.version ?? a.published_version,
      reviewClosed: a.review_closed_at !== null,
      deadlineAt: version ? version.deadline_at : a.deadline_at,
      allowResubmit: version?.allow_resubmit ?? a.allow_resubmit,
      maxAttempts: version ? version.max_attempts : a.max_attempts,
      latestAttempt: teacher ? null : (used[0] ?? null),
    };
    if (teacher && !attempt && !submission) base.content = a.content;
    else base.questions = version!.public_questions;
    if (attempt) {
      base.attempt = {
        id: attempt.id,
        revision: attempt.revision,
        status: attempt.status,
        number: attempt.attempt_no,
      };
      const [draft] = await this.rows(
        'SELECT answers FROM zhiban_learning.quiz_attempt_answers WHERE tenant_id=$1 AND attempt_id=$2',
        [t, attempt.id],
      );
      base.answers = teacher ? {} : (draft?.answers ?? {});
      base.latestSubmission =
        (
          await this.rows(
            'SELECT id,version FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2 ORDER BY version DESC LIMIT 1',
            [t, attempt.id],
          )
        )[0] ?? null;
    }
    if (submission) {
      const [saved] = await this.rows(
        'SELECT * FROM zhiban_learning.quiz_submission_answers WHERE tenant_id=$1 AND submission_id=$2',
        [t, submission.id],
      );
      const [evaluation] = await this.rows(
        'SELECT * FROM zhiban_learning.quiz_evaluations WHERE tenant_id=$1 AND submission_id=$2',
        [t, submission.id],
      );
      requireAcademic(
        !!saved &&
          !!evaluation &&
          saved.quiz_hash === version!.content_hash &&
          evaluation.quiz_hash === saved.quiz_hash &&
          evaluation.answers_hash === saved.answers_hash,
        'UNAVAILABLE',
      );
      base.answers = saved.answers;
      base.submission = {
        id: submission.id,
        version: submission.version,
        submittedAt: submission.submitted_at,
      };
      const pubs = await this.rows(
        'SELECT id,version,score_points,max_points,feedback,reason,published_by FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=$2 ORDER BY version DESC',
        [t, submission.id],
      );
      base.publications = pubs;
      if (teacher) {
        base.content = version!.content;
        base.aiAdvice = await this.rows(
          "SELECT a.facts->>'id' AS id,a.facts->'result' AS result,a.facts->>'sourceHash' AS source_hash, COALESCE(d.facts->>'status','PENDING') AS status FROM zhiban_academic.audit_events a LEFT JOIN zhiban_academic.audit_events d ON d.tenant_id=a.tenant_id AND d.event_type='QUIZ_AI_DECISION' AND d.facts->>'id'=a.facts->>'id' WHERE a.tenant_id=$1 AND a.event_type='QUIZ_AI_SUGGESTION' AND a.facts->>'offering'=$2 AND a.facts->'input'->>'submissionId'=$3 ORDER BY a.occurred_at DESC,a.id DESC LIMIT 10",
          [t, offering, submission.id],
        );

        base.evaluation = {
          results: evaluation.results,
          objectivePoints: evaluation.objective_points,
          manualPending: evaluation.manual_pending,
        };
        base.grade =
          (
            await this.rows(
              'SELECT id,revision::text,score_points,max_points,published_version,feedback FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2',
              [t, submission.id],
            )
          )[0] ?? null;
      }
      if (teacher && base.grade) {
        const [details] = await this.rows(
          'SELECT marks FROM zhiban_assessment.quiz_grade_details WHERE tenant_id=$1 AND grade_id=$2 AND revision<=$3 ORDER BY revision DESC LIMIT 1',
          [t, base.grade.id, base.grade.revision],
        );
        base.gradeMarks = details?.marks ?? base.review?.publications?.[0]?.marks;
      }
      const release =
        teacher || a.mode === 'PRACTICE' || (a.review_closed_at !== null && pubs.length > 0);
      if (release) {
        base.review = { questions: version!.content.questions, results: evaluation.results };
        if (pubs.length) {
          base.review.publications = await this.rows(
            'SELECT d.publication_id,d.marks,d.overrides FROM zhiban_assessment.quiz_publication_details d JOIN zhiban_assessment.publications p ON p.tenant_id=d.tenant_id AND p.id=d.publication_id WHERE d.tenant_id=$1 AND d.submission_id=$2 ORDER BY p.version DESC',
            [t, submission.id],
          );
        }
      }
    }
    return base;
  }
  async generatedReplay(
    actor: AcademicActor,
    offering: string,
    key: string,
    source: GeneratedQuizSource,
  ) {
    const [row] = await this.rows(
      'SELECT c.actor_id,a.facts FROM zhiban_academic.commands c JOIN zhiban_academic.audit_events a ON a.tenant_id=c.tenant_id AND a.command_key=c.command_key WHERE c.tenant_id=$1 AND c.command_key=$2 AND a.event_type=$3',
      [actor.tenantId, key, 'LEARNING_ADOPT_GENERATED_QUIZ'],
    );
    if (!row) return null;
    requireAcademic(
      row.actor_id === actor.membershipId &&
        row.facts.offeringId === offering &&
        canonical(row.facts.result.generatedSource) === canonical(source),
      'CONFLICT',
    );
    return row.facts.result;
  }
  async authorizeGenerated(actor: AcademicActor, offering: string) {
    await progressBarrier(this.client, actor, offering);
    const access = await this.learning.access(actor, offering, 'TEACHER');
    requireAcademic(access.offering.status === 'OPEN', 'INVALID_STATE');
  }
  async execute(
    actor: AcademicActor,
    offering: string,
    c: QuizCommand,
    key: string,
    source?: GeneratedQuizSource,
  ) {
    await progressBarrier(this.client, actor, offering);
    let mapped: LearningCommand;
    let normalized: Content | undefined;
    let normalizedAnswers: Answers | undefined;
    let current: Row | undefined;
    let version: Row | undefined;
    if (c.type === 'COPY_QUIZ')
      mapped = {
        type: 'CREATE_ACTIVITY',
        title: '测验副本',
        prompt: '课程测验',
        deadlineAt: null,
        allowResubmit: false,
        maxAttempts: 1,
      };
    else if (c.type === 'CREATE_QUIZ' || c.type === 'EDIT_QUIZ')
      mapped = {
        type: c.type === 'CREATE_QUIZ' ? 'CREATE_ACTIVITY' : 'EDIT_ACTIVITY',
        ...('id' in c ? { id: c.id, revision: c.revision } : {}),
        title: c.title,
        prompt: '课程测验',
        deadlineAt: c.deadlineAt,
        allowResubmit: c.allowResubmit,
        maxAttempts: c.maxAttempts,
      } as LearningCommand;
    else if (c.type === 'START_QUIZ_ATTEMPT')
      mapped = { type: 'START_ATTEMPT', id: c.activityId, expectedVersion: c.expectedVersion };
    else if (c.type === 'SAVE_QUIZ_DRAFT' || c.type === 'SUBMIT_QUIZ')
      mapped = {
        type: c.type === 'SAVE_QUIZ_DRAFT' ? 'SAVE_DRAFT' : 'SUBMIT',
        id: c.attemptId,
        revision: c.revision,
        answer: summary,
      };
    else {
      requireAcademic('id' in c);
      mapped = {
        type:
          c.type === 'PUBLISH_QUIZ'
            ? 'PUBLISH_ACTIVITY'
            : c.type === 'WITHDRAW_QUIZ'
              ? 'WITHDRAW_ACTIVITY'
              : 'EDIT_ACTIVITY',
        id: c.id,
        revision: c.revision,
      } as LearningCommand;
    }
    // CLOSE maps to a revision-only parent edit after the locked row is known.
    const extension = {
      kind: 'QUIZ' as const,
      command: source ? { command: c, generatedSource: source } : c,
      eventType: source ? 'ADOPT_GENERATED_QUIZ' : c.type,
      before: async (a: Row, now: number) => {
        const [d] = await this.rows(
          'SELECT * FROM zhiban_learning.quiz_definitions WHERE tenant_id=$1 AND activity_id=$2',
          [actor.tenantId, a.id],
        );
        requireAcademic(!!d, 'UNAVAILABLE');
        requireAcademic(d.review_closed_at === null, 'INVALID_STATE');
        current = { ...a, ...d };
        if (c.type === 'CLOSE_QUIZ_REVIEW') {
          requireAcademic(a.published_version > 0, 'INVALID_STATE');
          Object.assign(mapped, {
            title: a.title,
            prompt: a.prompt,
            deadlineAt: a.deadline_at,
            allowResubmit: a.allow_resubmit,
            maxAttempts: a.max_attempts,
          });
          current.closedAt = now;
        }
        if (c.type === 'PUBLISH_QUIZ') normalized = content(d.draft, true);
        if ('answers' in c) {
          const [attempt] = await this.rows(
            'SELECT activity_version FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2 AND activity_id=$3',
            [actor.tenantId, c.attemptId, a.id],
          );
          requireAcademic(!!attempt, 'NOT_FOUND');
          [version] = await this.rows(
            'SELECT * FROM zhiban_learning.quiz_versions WHERE tenant_id=$1 AND activity_id=$2 AND version=$3',
            [actor.tenantId, a.id, attempt.activity_version],
          );
          requireAcademic(!!version, 'UNAVAILABLE');
          normalizedAnswers = answers(c.answers, version!.content.questions);
        }
      },
      after: async (result: Row) => {
        const t = actor.tenantId;
        if (source) result.generatedSource = source;
        // Runs after parent authorization/idempotency, inside the same transaction and offering barrier.
        // A failed source check rolls back the parent DRAFT as well.
        if (c.type === 'COPY_QUIZ') {
          const [source] = await this.rows(
            'SELECT a.title,a.revision::text,d.mode,d.draft,d.draft_hash FROM zhiban_learning.activities a JOIN zhiban_learning.quiz_definitions d ON d.tenant_id=a.tenant_id AND d.activity_id=a.id WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=$3 FOR UPDATE OF a',
            [t, offering, c.sourceId],
          );
          requireAcademic(!!source, 'NOT_FOUND');
          requireAcademic(source.revision === c.sourceRevision, 'CONFLICT');
          let original = source.draft,
            sourceHash = source.draft_hash,
            title = source.title;
          if (c.sourceVersion !== null) {
            const [v] = await this.rows(
              'SELECT q.content,q.content_hash,v.title FROM zhiban_learning.quiz_versions q JOIN zhiban_learning.activity_versions v USING(tenant_id,activity_id,version) WHERE q.tenant_id=$1 AND q.activity_id=$2 AND q.version=$3',
              [t, c.sourceId, c.sourceVersion],
            );
            requireAcademic(!!v, 'NOT_FOUND');
            original = v.content;
            sourceHash = v.content_hash;
            title = v.title;
          }
          requireAcademic(hash(original) === sourceHash, 'UNAVAILABLE');
          const copied = content(original);
          copied.questions.forEach((q) => {
            q.id = randomUUID();
          });
          await this.client.query(
            'UPDATE zhiban_learning.activities SET title=$3 WHERE tenant_id=$1 AND id=$2',
            [t, result.id, `${title.slice(0, 97)}（副本）`],
          );
          await this.client.query(
            'INSERT INTO zhiban_learning.quiz_definitions(tenant_id,activity_id,mode,draft,draft_hash) VALUES($1,$2,$3,$4,$5)',
            [t, result.id, source.mode, JSON.stringify(copied), hash(copied)],
          );
          result.source = {
            activityId: c.sourceId,
            revision: c.sourceRevision,
            version: c.sourceVersion,
            hash: sourceHash,
          };
        }
        if (c.type === 'CREATE_QUIZ')
          await this.client.query(
            'INSERT INTO zhiban_learning.quiz_definitions(tenant_id,activity_id,mode,draft,draft_hash) VALUES($1,$2,$3,$4,$5)',
            [t, result.id, c.mode, JSON.stringify(c.content), hash(c.content)],
          );
        if (c.type === 'EDIT_QUIZ')
          await this.client.query(
            'UPDATE zhiban_learning.quiz_definitions SET draft=$3,draft_hash=$4 WHERE tenant_id=$1 AND activity_id=$2',
            [t, c.id, JSON.stringify(c.content), hash(c.content)],
          );
        if (c.type === 'CLOSE_QUIZ_REVIEW')
          await this.client.query(
            'UPDATE zhiban_learning.quiz_definitions SET review_closed_at=$3,review_closed_by=$4 WHERE tenant_id=$1 AND activity_id=$2 AND review_closed_at IS NULL',
            [t, c.id, current!.closedAt, actor.membershipId],
          );
        if (c.type === 'PUBLISH_QUIZ') {
          const qs = publicQuiz(normalized!.questions);
          await this.client.query(
            'INSERT INTO zhiban_learning.quiz_versions(tenant_id,activity_id,version,content,public_questions,content_hash,public_hash,max_points,algorithm,source_pin) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [
              t,
              c.id,
              result.version,
              JSON.stringify(normalized),
              JSON.stringify(qs),
              hash(normalized),
              hash(qs),
              normalized!.questions.reduce((n, q) => n + points(q.points), 0),
              algorithm(normalized!.questions),
              'a9da60b3b4adb429369c0da13d5637a904ead2b0',
            ],
          );
        }
        if (c.type === 'START_QUIZ_ATTEMPT')
          await this.client.query(
            "INSERT INTO zhiban_learning.quiz_attempt_answers(tenant_id,attempt_id,answers,answers_hash) VALUES($1,$2,'{}',$3) ON CONFLICT DO NOTHING",
            [t, result.id, hash({})],
          );
        if ('answers' in c) {
          const saved = await this.client.query(
            'UPDATE zhiban_learning.quiz_attempt_answers SET answers=$3,answers_hash=$4 WHERE tenant_id=$1 AND attempt_id=$2',
            [t, c.attemptId, JSON.stringify(normalizedAnswers), hash(normalizedAnswers)],
          );
          requireAcademic(saved.rowCount === 1, 'UNAVAILABLE');
          if (c.type === 'SUBMIT_QUIZ') {
            const results = gradeQuiz(version!.content.questions, normalizedAnswers!);
            await this.client.query(
              'INSERT INTO zhiban_learning.quiz_submission_answers(tenant_id,submission_id,attempt_id,answers,answers_hash,activity_id,activity_version,quiz_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [
                t,
                result.submissionId,
                c.attemptId,
                JSON.stringify(normalizedAnswers),
                hash(normalizedAnswers),
                current!.id,
                version!.version,
                version!.content_hash,
              ],
            );
            await this.client.query(
              'INSERT INTO zhiban_learning.quiz_evaluations(tenant_id,submission_id,results,objective_points,manual_pending,algorithm,answers_hash,quiz_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [
                t,
                result.submissionId,
                JSON.stringify(results),
                results.reduce((n, r) => n + Math.round(r.earned * 100), 0),
                version!.content.questions.some(
                  (q: Content['questions'][number]) => q.type === 'short_answer',
                ),
                version!.algorithm,
                hash(normalizedAnswers),
                version!.content_hash,
              ],
            );
          }
        }
      },
    };
    return this.learning.execute(actor, offering, mapped, key, undefined, extension);
  }

  async adviceSnapshot(
    actor: AcademicActor,
    offering: string,
    submission: string,
  ): Promise<AdviceInput> {
    await progressBarrier(this.client, actor, offering);
    await this.learning.access(actor, offering, 'TEACHER');
    const view = await this.read(actor, offering, { submission });
    requireAcademic(view.quizMode === 'ASSESSED' && !view.publications.length, 'INVALID_STATE');
    const [anchor] = await this.rows(
      'SELECT attempt_id,version FROM zhiban_learning.submissions WHERE tenant_id=$1 AND id=$2',
      [actor.tenantId, submission],
    );
    await this.rows(
      'SELECT id FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2 FOR SHARE',
      [actor.tenantId, view.activityId],
    );
    await this.rows(
      'SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [actor.tenantId, anchor.attempt_id],
    );
    const [latest] = await this.rows(
      'SELECT max(version) AS version FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
      [actor.tenantId, anchor.attempt_id],
    );
    requireAcademic(latest.version === anchor.version, 'CONFLICT');
    const fresh = await this.read(actor, offering, { submission });
    requireAcademic(!fresh.publications.length, 'INVALID_STATE');
    requireAcademic(
      (fresh.content as Content).questions.some((q) => q.type === 'short_answer'),
      'INVALID_STATE',
    );
    return {
      submissionId: submission,
      gradeRevision: fresh.grade?.revision ?? null,
      version: String(fresh.version),
      content: fresh.content,
      answers: fresh.answers,
    };
  }
  async findAdvice(actor: AcademicActor, offering: string, submission: string, id: string) {
    await this.learning.access(actor, offering, 'TEACHER');
    const [row] = await this.rows(
      "SELECT facts FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2 AND event_type='QUIZ_AI_SUGGESTION'",
      [actor.tenantId, id],
    );
    if (!row) return null;
    requireAcademic(
      row.facts.offering === offering && row.facts.input.submissionId === submission,
      'CONFLICT',
    );
    return row.facts;
  }
  async adviceEvent(actor: AcademicActor, key: string, event: string, facts: unknown) {
    await this.client.query(
      'INSERT INTO zhiban_academic.commands(tenant_id,command_key,actor_id,payload_digest,completed_at) VALUES($1,$2,$3,$4,$5)',
      [actor.tenantId, key, actor.membershipId, adviceHash(facts), actor.now],
    );
    await this.client.query(
      'INSERT INTO zhiban_academic.audit_events(tenant_id,id,actor_id,command_key,event_type,occurred_at,facts) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        actor.tenantId,
        randomUUID(),
        actor.membershipId,
        key,
        event,
        actor.now,
        JSON.stringify(facts),
      ],
    );
  }
  async saveAdvice(
    actor: AcademicActor,
    offering: string,
    input: AdviceInput,
    id: string,
    result: AdviceResult,
  ) {
    const fresh = await this.adviceSnapshot(actor, offering, input.submissionId);
    requireAcademic(adviceHash(fresh) === adviceHash(input), 'CONFLICT');
    const previous = await this.findAdvice(actor, offering, input.submissionId, id);
    if (previous) return previous;
    requireAcademic(
      result &&
        typeof result.feedback === 'string' &&
        result.feedback.trim().length > 0 &&
        result.feedback.length <= 2000 &&
        typeof result.model === 'string' &&
        result.model.length > 0 &&
        result.model.length <= 200,
    );
    const questions = (input.content as Content).questions.filter((q) => q.type === 'short_answer');
    exact(
      result.marks,
      questions.map((q) => q.id),
    );
    for (const q of questions) requireAcademic(scorePoints(result.marks[q.id]) <= points(q.points));
    const facts = { id, offering, input, sourceHash: adviceHash(input), result, status: 'PENDING' };
    await this.adviceEvent(actor, id, 'QUIZ_AI_SUGGESTION', facts);
    return facts;
  }
  async decideAdvice(
    actor: AcademicActor,
    offering: string,
    submission: string,
    id: string,
    accept: boolean,
  ) {
    await progressBarrier(this.client, actor, offering);
    await this.learning.access(actor, offering, 'TEACHER');
    const advice = await this.findAdvice(actor, offering, submission, id);
    requireAcademic(advice, 'NOT_FOUND');
    const key = adviceHash({ decision: id });
    const [prior] = await this.rows(
      "SELECT facts FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2 AND event_type='QUIZ_AI_DECISION'",
      [actor.tenantId, key],
    );
    if (prior) {
      requireAcademic(prior.facts.accept === accept, 'CONFLICT');
      return prior.facts;
    }
    const fresh = await this.adviceSnapshot(actor, offering, submission);
    requireAcademic(adviceHash(fresh) === advice.sourceHash, 'CONFLICT');
    let grade = null;
    if (accept)
      grade = await this.grade(
        actor,
        offering,
        {
          type: 'SAVE_QUIZ_GRADE',
          submissionId: submission,
          gradeRevision: fresh.gradeRevision,
          manualMarks: advice.result.marks,
          feedback: advice.result.feedback,
        },
        adviceHash({ grade: id }),
      );
    const facts = {
      id,
      offering,
      submissionId: submission,
      accept,
      status: accept ? 'ACCEPTED' : 'REJECTED',
      grade,
    };
    await this.adviceEvent(actor, key, 'QUIZ_AI_DECISION', facts);
    return facts;
  }
  async grade(actor: AcademicActor, offering: string, c: QuizGradeCommand, key: string) {
    const view = await this.read(actor, offering, { submission: c.submissionId });
    requireAcademic(view.mode === 'TEACHER', 'FORBIDDEN');
    requireAcademic(view.quizMode === 'ASSESSED', 'INVALID_STATE');
    const questions = (view.content as Content).questions,
      results = view.evaluation.results as { questionId: string; earned: number }[];
    const marks: Record<string, number> = {};
    let overrides: Record<string, string> = {};
    if (c.type === 'SAVE_QUIZ_GRADE') {
      exact(
        c.manualMarks,
        questions.filter((q) => q.type === 'short_answer').map((q) => q.id),
      );
      for (const q of questions)
        marks[q.id] =
          q.type === 'short_answer'
            ? scorePoints(c.manualMarks[q.id])
            : Math.round(results.find((r) => r.questionId === q.id)!.earned * 100);
    } else {
      exact(
        c.marks,
        questions.map((q) => q.id),
      );
      requireAcademic(
        !!c.overrides && typeof c.overrides === 'object' && !Array.isArray(c.overrides),
      );
      overrides = c.overrides;
      requireAcademic(
        Object.keys(overrides).every((id) =>
          questions.some((q) => q.id === id && q.type !== 'short_answer'),
        ),
      );
      for (const q of questions) {
        marks[q.id] = scorePoints(c.marks[q.id]);
        if (
          q.type !== 'short_answer' &&
          marks[q.id] !== Math.round(results.find((r) => r.questionId === q.id)!.earned * 100)
        ) {
          requireAcademic(
            typeof overrides[q.id] === 'string' &&
              overrides[q.id].trim().length > 0 &&
              overrides[q.id].length <= 1000,
          );
        }
      }
    }
    for (const q of questions) requireAcademic(marks[q.id] <= points(q.points));
    const score = (Object.values(marks).reduce((a, b) => a + b, 0) / 100).toFixed(2),
      maxScore = (questions.reduce((n, q) => n + points(q.points), 0) / 100).toFixed(2);
    const mapped: AssessmentCommand =
      c.type === 'SAVE_QUIZ_GRADE'
        ? {
            type: 'SAVE_GRADE',
            submissionId: c.submissionId,
            revision: c.gradeRevision,
            score,
            maxScore,
            feedback: c.feedback,
          }
        : {
            type: 'CORRECT_GRADE',
            submissionId: c.submissionId,
            revision: c.revision,
            score,
            maxScore,
            feedback: c.feedback,
            reason: c.reason,
          };
    return new AssessmentPgTransaction(this.client).execute(actor, offering, mapped, key, {
      command: c,
      marks,
      overrides,
    });
  }
}
