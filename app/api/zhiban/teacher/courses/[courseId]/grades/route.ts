import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  changeAssessmentStatus,
  createAssessment,
  createGradeItem,
  gradeAssessmentAnswers,
  gradeAssessmentAttempt,
  handleGradeReview,
  listTeacherGradebook,
  publishAssessment,
  publishFinalGrades,
  publishGradeRecords,
  recalculateFinalGrades,
  saveGradeRecord,
  updateAssessment,
  withdrawFinalGrades,
} from '@/lib/zhiban/grades';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
const item = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  category: z.enum(['formative', 'project', 'final']),
  weight: z.number().min(0).max(100),
  maxScore: z.number().positive().max(10000),
  dropLowest: z.boolean().optional(),
  sourceType: z.enum(['manual', 'assessment', 'pbl', 'classroom_quiz']).optional(),
  sourceId: z.string().max(160).optional(),
});
const question = z.object({
  type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'essay']),
  prompt: z.string().min(1).max(10000),
  options: z.array(z.unknown()).optional(),
  answerKey: z.record(z.string(), z.unknown()).optional(),
  maxScore: z.number().positive().max(10000),
});
async function auth(raw: string) {
  const courseId = z.uuid().parse(raw);
  return {
    courseId,
    principal: await requireRequestScopedPermission('grade:publish', { courseIds: [courseId] }),
  };
}
export async function GET(_: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId, principal } = await auth((await params).courseId);
    return NextResponse.json(await listTeacherGradebook(getZhibanPool(), principal, courseId));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load gradebook' },
        { status: 400 },
      )
    );
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId, principal } = await auth((await params).courseId);
    const data = await request.json();
    const action = z
      .enum([
        'grade_item',
        'assessment',
        'update_assessment',
        'publish_assessment',
        'close_assessment',
        'archive_assessment',
        'delete_assessment',
        'grade_attempt',
        'grade_answers',
        'grade',
        'publish_records',
        'recalculate',
        'publish',
        'withdraw',
        'handle_review',
      ])
      .parse(data.action);
    let result: unknown;
    const assessmentSchema = item.extend({
      title: z.string().min(1).max(240),
      description: z.string().max(5000).optional(),
      assessmentType: z.enum(['quiz', 'assignment', 'exam', 'practice']),
      maxAttempts: z.number().int().min(1).max(100),
      scoringMethod: z.enum(['highest', 'latest', 'average']),
      opensAt: z.iso.datetime().nullable().optional(),
      dueAt: z.iso.datetime().nullable().optional(),
      questions: z.array(question).min(1).max(200),
    });
    if (action === 'grade_item')
      result = await createGradeItem(getZhibanPool(), principal, courseId, item.parse(data));
    else if (action === 'assessment')
      result = await createAssessment(
        getZhibanPool(),
        principal,
        courseId,
        assessmentSchema.parse(data),
      );
    else if (action === 'update_assessment') {
      const parsed = assessmentSchema
        .pick({
          title: true,
          description: true,
          maxAttempts: true,
          scoringMethod: true,
          opensAt: true,
          dueAt: true,
          questions: true,
        })
        .extend({ assessmentId: z.uuid() })
        .parse(data);
      result = await updateAssessment(
        getZhibanPool(),
        principal,
        courseId,
        parsed.assessmentId,
        parsed,
      );
    } else if (action === 'publish_assessment')
      result = await publishAssessment(
        getZhibanPool(),
        principal,
        courseId,
        z.uuid().parse(data.assessmentId),
      );
    else if (['close_assessment', 'archive_assessment', 'delete_assessment'].includes(action))
      result = await changeAssessmentStatus(
        getZhibanPool(),
        principal,
        courseId,
        z.uuid().parse(data.assessmentId),
        action === 'close_assessment'
          ? 'close'
          : action === 'archive_assessment'
            ? 'archive'
            : 'delete',
      );
    else if (action === 'grade_answers')
      result = await gradeAssessmentAnswers(
        getZhibanPool(),
        principal,
        courseId,
        z
          .object({
            attemptId: z.uuid(),
            answers: z.array(
              z.object({
                answerId: z.uuid(),
                score: z.number().min(0).max(10000),
                feedback: z.string().max(5000).optional(),
              }),
            ),
            feedback: z.string().max(5000).optional(),
          })
          .parse(data),
      );
    else if (action === 'grade_attempt')
      result = await gradeAssessmentAttempt(
        getZhibanPool(),
        principal,
        courseId,
        z
          .object({
            attemptId: z.uuid(),
            score: z.number().min(0).max(10000),
            feedback: z.string().max(5000).optional(),
          })
          .parse(data),
      );
    else if (action === 'grade')
      result = await saveGradeRecord(
        getZhibanPool(),
        principal,
        courseId,
        z
          .object({
            studentId: z.uuid(),
            gradeItemId: z.uuid(),
            score: z.number().min(0).max(10000).nullable(),
            status: z
              .enum(['draft', 'published', 'excused', 'absent', 'deferred', 'makeup'])
              .optional(),
            feedback: z.string().max(5000).optional(),
            reason: z.string().max(2000).optional(),
          })
          .parse(data),
      );
    else if (action === 'publish_records')
      result = await publishGradeRecords(getZhibanPool(), principal, courseId);
    else if (action === 'recalculate')
      result = await recalculateFinalGrades(getZhibanPool(), principal, courseId);
    else if (action === 'publish')
      result = await publishFinalGrades(getZhibanPool(), principal, courseId);
    else if (action === 'withdraw')
      result = await withdrawFinalGrades(
        getZhibanPool(),
        principal,
        courseId,
        z.string().min(1).max(2000).parse(data.reason),
      );
    else
      result = await handleGradeReview(
        getZhibanPool(),
        principal,
        courseId,
        z
          .object({
            reviewId: z.uuid(),
            status: z.enum(['approved', 'rejected']),
            resolution: z.string().min(1).max(5000),
          })
          .parse(data),
      );
    return NextResponse.json(result);
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to update grades' },
        { status: 400 },
      )
    );
  }
}
