import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { AssessmentInput, GradeItemInput } from './types';

function canManage(principal: AuthorizedPrincipal, courseId: string) {
  return principal.grants.some(
    (grant) =>
      grant.permission === 'grade:publish' &&
      (grant.scopeType === 'tenant' ||
        grant.scopeType === 'system' ||
        (grant.scopeType === 'course' && grant.scopeId === courseId)),
  );
}
function requireManage(principal: AuthorizedPrincipal, courseId: string) {
  if (!canManage(principal, courseId)) throw new Error('Permission denied');
}

async function syncPblGrades(client: { query: ZhibanDatabasePool['query'] }, courseId: string) {
  await client.query(
    `INSERT INTO zhiban.course_grade_items(id,tenant_id,course_id,code,name,category,source_type,source_id,weight,max_score,created_by)
    SELECT gen_random_uuid(),g.tenant_id,g.course_id,'PBL_'||g.code,g.name,'project','pbl',g.id::text,g.weight,g.max_score,p.created_by FROM zhiban.pbl_grade_items g
    JOIN LATERAL(SELECT created_by FROM zhiban.pbl_projects WHERE course_id=g.course_id ORDER BY created_at LIMIT 1)p ON true WHERE g.course_id=$1
    ON CONFLICT(tenant_id,course_id,code) DO UPDATE SET name=excluded.name,weight=excluded.weight,max_score=excluded.max_score,updated_at=now()`,
    [courseId],
  );
  await client.query(
    `INSERT INTO zhiban.course_grade_records(id,tenant_id,course_id,grade_item_id,student_id,raw_score,normalized_score,status,source_type,source_id,graded_by,graded_at)
    SELECT gen_random_uuid(),e.tenant_id,p.course_id,cg.id,i.student_id,e.score,LEAST(100,GREATEST(0,e.score/NULLIF(cg.max_score,0)*100)),'draft','pbl',e.id::text,p.created_by,e.evaluated_at
    FROM zhiban.pbl_evaluations e JOIN zhiban.pbl_project_instances i ON i.id=e.instance_id JOIN zhiban.pbl_projects p ON p.id=i.project_id
    JOIN zhiban.course_grade_items cg ON cg.course_id=p.course_id AND cg.source_type='pbl' AND cg.source_id=e.grade_item_id::text
    WHERE p.course_id=$1 AND e.grade_item_id IS NOT NULL ON CONFLICT(tenant_id,grade_item_id,student_id) DO UPDATE SET raw_score=excluded.raw_score,normalized_score=excluded.normalized_score,source_id=excluded.source_id,graded_at=excluded.graded_at WHERE NOT zhiban.course_grade_records.is_override`,
    [courseId],
  );
}

async function syncClassroomQuizGrades(
  client: { query: ZhibanDatabasePool['query'] },
  courseId: string,
) {
  await client.query(
    `INSERT INTO zhiban.course_grade_records(id,tenant_id,course_id,grade_item_id,student_id,raw_score,normalized_score,status,source_type,source_id,graded_at)
    SELECT gen_random_uuid(),g.tenant_id,g.course_id,g.id,s.student_id,max((e.payload->>'score')::numeric),LEAST(100,GREATEST(0,max((e.payload->>'score')::numeric)/NULLIF(g.max_score,0)*100)),'draft','classroom_quiz',max(e.id::text),max(e.occurred_at)
    FROM zhiban.course_grade_items g JOIN zhiban.course_classrooms cc ON cc.course_id=g.course_id JOIN zhiban.classroom_learning_sessions s ON s.course_classroom_id=cc.id
    JOIN zhiban.classroom_learning_events e ON e.session_id=s.id AND e.event_type='quiz_completed' AND e.scene_id=g.source_id
    WHERE g.course_id=$1 AND g.source_type='classroom_quiz' AND (e.payload->>'score') ~ '^[0-9]+(\.[0-9]+)?$' GROUP BY g.id,s.student_id
    ON CONFLICT(tenant_id,grade_item_id,student_id) DO UPDATE SET raw_score=excluded.raw_score,normalized_score=excluded.normalized_score,source_id=excluded.source_id,graded_at=excluded.graded_at,updated_at=now() WHERE NOT zhiban.course_grade_records.is_override`,
    [courseId],
  );
}

export async function listTeacherGradebook(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await syncPblGrades(client, courseId);
    await syncClassroomQuizGrades(client, courseId);
    const [
      course,
      items,
      students,
      assessments,
      records,
      finals,
      pendingAttempts,
      quizScenes,
      reviews,
    ] = await Promise.all([
      client.query(
        `SELECT c.id,c.code,c.name,COALESCE(s.grading_policy,'{"formativeWeight":40,"projectWeight":30,"finalWeight":30}'::jsonb) grading_policy FROM zhiban.courses c LEFT JOIN zhiban.course_settings s ON s.course_id=c.id WHERE c.id=$1`,
        [courseId],
      ),
      client.query(
        `SELECT * FROM zhiban.course_grade_items WHERE course_id=$1 AND status='active' ORDER BY category,code`,
        [courseId],
      ),
      client.query(
        `SELECT DISTINCT a.id,a.login_name,a.display_name FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id JOIN zhiban.accounts a ON a.id=e.student_id WHERE o.course_id=$1 AND e.status='enrolled' ORDER BY a.display_name`,
        [courseId],
      ),
      client.query(
        `SELECT a.*,g.code grade_item_code,COALESCE((SELECT jsonb_agg(jsonb_build_object('type',q.question_type,'prompt',q.prompt,'options',q.options,'answerKey',q.answer_key,'maxScore',q.max_score) ORDER BY q.display_order) FROM zhiban.assessment_questions q WHERE q.assessment_id=a.id),'[]'::jsonb) questions FROM zhiban.course_assessments a JOIN zhiban.course_grade_items g ON g.id=a.grade_item_id WHERE a.course_id=$1 ORDER BY a.created_at DESC`,
        [courseId],
      ),
      client.query(`SELECT * FROM zhiban.course_grade_records WHERE course_id=$1`, [courseId]),
      client.query(`SELECT * FROM zhiban.course_final_grades WHERE course_id=$1`, [courseId]),
      client.query(
        `SELECT x.id,x.attempt_no,x.submitted_at,x.student_id,a.title,g.max_score,u.display_name,u.login_name,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('answerId',n.id,'questionId',q.id,'question',q.prompt,'answer',n.answer,'score',n.score,'maxScore',q.max_score,'feedback',n.feedback) ORDER BY q.display_order) FROM zhiban.assessment_answers n JOIN zhiban.assessment_questions q ON q.id=n.question_id WHERE n.attempt_id=x.id),'[]'::jsonb) answers
        FROM zhiban.assessment_attempts x JOIN zhiban.course_assessments a ON a.id=x.assessment_id JOIN zhiban.course_grade_items g ON g.id=a.grade_item_id JOIN zhiban.accounts u ON u.id=x.student_id WHERE a.course_id=$1 AND x.status='submitted' ORDER BY x.submitted_at`,
        [courseId],
      ),
      client.query(
        `SELECT DISTINCT e.scene_id FROM zhiban.classroom_learning_events e JOIN zhiban.classroom_learning_sessions s ON s.id=e.session_id JOIN zhiban.course_classrooms c ON c.id=s.course_classroom_id WHERE c.course_id=$1 AND e.event_type='quiz_completed' AND e.scene_id IS NOT NULL ORDER BY e.scene_id`,
        [courseId],
      ),
      client.query(
        `SELECT r.*,a.display_name,a.login_name FROM zhiban.grade_review_requests r JOIN zhiban.accounts a ON a.id=r.student_id WHERE r.course_id=$1 ORDER BY r.created_at DESC`,
        [courseId],
      ),
    ]);
    if (!course.rows[0]) throw new Error('Course not found');
    return {
      course: course.rows[0],
      items: items.rows,
      students: students.rows,
      assessments: assessments.rows,
      records: records.rows,
      finalGrades: finals.rows,
      pendingAttempts: pendingAttempts.rows,
      quizScenes: quizScenes.rows.map((r) => r.scene_id),
      reviews: reviews.rows,
    };
  });
}

export async function createGradeItem(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: GradeItemInput,
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const total = await client.query<{ weight: string }>(
      `SELECT COALESCE(sum(weight),0)::text weight FROM zhiban.course_grade_items WHERE course_id=$1 AND category=$2 AND status='active'`,
      [courseId, input.category],
    );
    if (Number(total.rows[0].weight) + input.weight > 100)
      throw new Error('Grade item weights in this category cannot exceed 100');
    if (input.sourceType === 'classroom_quiz' && !input.sourceId)
      throw new Error('Quiz scene ID is required');
    return (
      await client.query(
        `INSERT INTO zhiban.course_grade_items(id,tenant_id,course_id,code,name,category,source_type,source_id,weight,max_score,drop_lowest,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          randomUUID(),
          principal.tenantId,
          courseId,
          input.code,
          input.name,
          input.category,
          input.sourceType ?? 'manual',
          input.sourceId ?? null,
          input.weight,
          input.maxScore,
          input.dropLowest ?? false,
          principal.id,
        ],
      )
    ).rows[0];
  });
}

export async function createAssessment(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: AssessmentInput,
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const totalWeight = await client.query<{ weight: string }>(
      `SELECT COALESCE(sum(weight),0)::text weight FROM zhiban.course_grade_items WHERE course_id=$1 AND category=$2 AND status='active'`,
      [courseId, input.category],
    );
    if (Number(totalWeight.rows[0].weight) + input.weight > 100)
      throw new Error('Grade item weights in this category cannot exceed 100');
    const itemId = randomUUID(),
      assessmentId = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_grade_items(id,tenant_id,course_id,code,name,category,source_type,source_id,weight,max_score,created_by) VALUES($1,$2,$3,$4,$5,$6,'assessment',$7,$8,$9,$10)`,
      [
        itemId,
        principal.tenantId,
        courseId,
        input.code,
        input.name,
        input.category,
        assessmentId,
        input.weight,
        input.maxScore,
        principal.id,
      ],
    );
    await client.query(
      `INSERT INTO zhiban.course_assessments(id,tenant_id,course_id,grade_item_id,title,description,assessment_type,max_attempts,scoring_method,opens_at,due_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        assessmentId,
        principal.tenantId,
        courseId,
        itemId,
        input.title,
        input.description ?? '',
        input.assessmentType,
        input.maxAttempts,
        input.scoringMethod,
        input.opensAt ?? null,
        input.dueAt ?? null,
        principal.id,
      ],
    );
    for (const [order, question] of input.questions.entries())
      await client.query(
        `INSERT INTO zhiban.assessment_questions(id,tenant_id,assessment_id,question_type,prompt,options,answer_key,max_score,display_order) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
        [
          randomUUID(),
          principal.tenantId,
          assessmentId,
          question.type,
          question.prompt,
          JSON.stringify(question.options ?? []),
          JSON.stringify(question.answerKey ?? {}),
          question.maxScore,
          order + 1,
        ],
      );
    return { assessmentId, gradeItemId: itemId };
  });
}

export async function saveGradeRecord(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    studentId: string;
    gradeItemId: string;
    score: number | null;
    status?: 'draft' | 'published' | 'excused' | 'absent' | 'deferred' | 'makeup';
    feedback?: string;
    reason?: string;
  },
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const item = await client.query<{ max_score: string }>(
      `SELECT max_score::text FROM zhiban.course_grade_items WHERE id=$1 AND course_id=$2`,
      [input.gradeItemId, courseId],
    );
    if (!item.rows[0]) throw new Error('Grade item not found');
    const normalized =
      input.score === null
        ? null
        : Math.min(100, Math.max(0, (input.score / Number(item.rows[0].max_score)) * 100));
    const before = await client.query(
      `SELECT * FROM zhiban.course_grade_records WHERE grade_item_id=$1 AND student_id=$2`,
      [input.gradeItemId, input.studentId],
    );
    const result = await client.query(
      `INSERT INTO zhiban.course_grade_records(id,tenant_id,course_id,grade_item_id,student_id,raw_score,normalized_score,status,source_type,feedback,is_override,graded_by,graded_at,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,true,$10,now(),CASE WHEN $8='published' THEN now() END)
      ON CONFLICT(tenant_id,grade_item_id,student_id) DO UPDATE SET raw_score=excluded.raw_score,normalized_score=excluded.normalized_score,status=excluded.status,feedback=excluded.feedback,is_override=true,graded_by=excluded.graded_by,graded_at=now(),published_at=CASE WHEN excluded.status='published' THEN now() ELSE course_grade_records.published_at END,updated_at=now() RETURNING *`,
      [
        randomUUID(),
        principal.tenantId,
        courseId,
        input.gradeItemId,
        input.studentId,
        input.score,
        normalized,
        input.status ?? 'draft',
        input.feedback ?? '',
        principal.id,
      ],
    );
    await client.query(
      `INSERT INTO zhiban.grade_change_log(id,tenant_id,course_id,student_id,grade_record_id,actor_id,action,before_value,after_value,reason) VALUES($1,$2,$3,$4,$5,$6,'grade.override',$7::jsonb,$8::jsonb,$9)`,
      [
        randomUUID(),
        principal.tenantId,
        courseId,
        input.studentId,
        result.rows[0].id,
        principal.id,
        JSON.stringify(before.rows[0] ?? null),
        JSON.stringify(result.rows[0]),
        input.reason ?? '',
      ],
    );
    return result.rows[0];
  });
}

function letter(score: number) {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}
export function calculateFinalGrade(
  scores: { formative?: number; project?: number; final?: number },
  weights: { formativeWeight: number; projectWeight: number; finalWeight: number },
) {
  const formative = scores.formative ?? 0,
    project = scores.project ?? 0,
    finalExam = scores.final ?? 0;
  const total =
    (formative * weights.formativeWeight) / 100 +
    (project * weights.projectWeight) / 100 +
    (finalExam * weights.finalWeight) / 100;
  return { formative, project, finalExam, total, letterGrade: letter(total) };
}
export async function recalculateFinalGrades(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await syncPblGrades(client, courseId);
    await syncClassroomQuizGrades(client, courseId);
    const policy = await client.query<{ grading_policy: Record<string, number> }>(
      `SELECT COALESCE(grading_policy,'{"formativeWeight":40,"projectWeight":30,"finalWeight":30}'::jsonb) grading_policy FROM zhiban.course_settings WHERE course_id=$1`,
      [courseId],
    );
    const weights = (policy.rows[0]?.grading_policy ?? {
      formativeWeight: 40,
      projectWeight: 30,
      finalWeight: 30,
    }) as { formativeWeight: number; projectWeight: number; finalWeight: number };
    const rows = await client.query<{ student_id: string; category: string; score: string }>(
      `WITH base AS(SELECT e.student_id,g.category,g.weight,g.drop_lowest,r.normalized_score,row_number() OVER(PARTITION BY e.student_id,g.category,g.drop_lowest ORDER BY r.normalized_score NULLS LAST) drop_rank,count(r.normalized_score) OVER(PARTITION BY e.student_id,g.category,g.drop_lowest) eligible_count FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id CROSS JOIN zhiban.course_grade_items g LEFT JOIN zhiban.course_grade_records r ON r.grade_item_id=g.id AND r.student_id=e.student_id AND r.status NOT IN('void','absent','deferred','excused') WHERE o.course_id=$1 AND e.status='enrolled' AND g.course_id=$1 AND g.status='active') SELECT student_id,category,(sum(normalized_score*weight)/NULLIF(sum(weight) FILTER(WHERE normalized_score IS NOT NULL),0))::text score FROM base WHERE NOT(drop_lowest AND eligible_count>1 AND drop_rank=1) GROUP BY student_id,category`,
      [courseId],
    );
    const grouped = new Map<string, Record<string, number>>();
    for (const row of rows.rows) {
      const value = Number(row.score);
      if (!grouped.has(row.student_id)) grouped.set(row.student_id, {});
      if (Number.isFinite(value)) grouped.get(row.student_id)![row.category] = value;
    }
    for (const [studentId, scores] of grouped) {
      const grade = calculateFinalGrade(scores, weights);
      await client.query(
        `INSERT INTO zhiban.course_final_grades(id,tenant_id,course_id,student_id,formative_score,project_score,final_exam_score,total_score,letter_grade,calculation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(tenant_id,course_id,student_id) DO UPDATE SET formative_score=excluded.formative_score,project_score=excluded.project_score,final_exam_score=excluded.final_exam_score,total_score=excluded.total_score,letter_grade=excluded.letter_grade,calculation=excluded.calculation,status='draft',published_at=NULL,published_by=NULL,version=course_final_grades.version+1,calculated_at=now()`,
        [
          randomUUID(),
          principal.tenantId,
          courseId,
          studentId,
          grade.formative,
          grade.project,
          grade.finalExam,
          grade.total,
          grade.letterGrade,
          JSON.stringify({ weights, scores }),
        ],
      );
    }
    return { recalculated: grouped.size };
  });
}

export async function publishFinalGrades(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE zhiban.course_final_grades SET status='published',published_at=now(),published_by=$2 WHERE course_id=$1 AND status='draft' RETURNING id,student_id,total_score`,
      [courseId, principal.id],
    );
    for (const row of result.rows)
      await client.query(
        `INSERT INTO zhiban.grade_change_log(id,tenant_id,course_id,student_id,final_grade_id,actor_id,action,after_value) VALUES($1,$2,$3,$4,$5,$6,'final_grade.publish',$7::jsonb)`,
        [
          randomUUID(),
          principal.tenantId,
          courseId,
          row.student_id,
          row.id,
          principal.id,
          JSON.stringify(row),
        ],
      );
    const batchId = randomUUID();
    await client.query(
      `INSERT INTO zhiban.grade_publication_batches(id,tenant_id,course_id,publication_type,record_count,actor_id,snapshot) VALUES($1,$2,$3,'final_grades',$4,$5,$6::jsonb)`,
      [
        batchId,
        principal.tenantId,
        courseId,
        result.rows.length,
        principal.id,
        JSON.stringify({ grades: result.rows }),
      ],
    );
    return { published: result.rows.length, batchId };
  });
}

export async function publishAssessment(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  assessmentId: string,
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE zhiban.course_assessments SET status='published',updated_at=now() WHERE id=$1 AND course_id=$2 AND status='draft' RETURNING id`,
      [assessmentId, courseId],
    );
    if (!result.rows[0]) throw new Error('Assessment not found or already published');
    return { status: 'published' };
  });
}

export async function publishGradeRecords(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE zhiban.course_grade_records SET status='published',published_at=now(),updated_at=now() WHERE course_id=$1 AND status IN('draft','makeup') RETURNING id,student_id,raw_score,status`,
      [courseId],
    );
    const batchId = randomUUID();
    await client.query(
      `INSERT INTO zhiban.grade_publication_batches(id,tenant_id,course_id,publication_type,record_count,actor_id,snapshot) VALUES($1,$2,$3,'records',$4,$5,$6::jsonb)`,
      [
        batchId,
        principal.tenantId,
        courseId,
        result.rows.length,
        principal.id,
        JSON.stringify({ records: result.rows }),
      ],
    );
    for (const row of result.rows)
      await client.query(
        `INSERT INTO zhiban.grade_change_log(id,tenant_id,course_id,student_id,grade_record_id,actor_id,action,after_value) VALUES($1,$2,$3,$4,$5,$6,'grade.publish',$7::jsonb)`,
        [
          randomUUID(),
          principal.tenantId,
          courseId,
          row.student_id,
          row.id,
          principal.id,
          JSON.stringify(row),
        ],
      );
    return { published: result.rows.length, batchId };
  });
}

export async function gradeAssessmentAttempt(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { attemptId: string; score: number; feedback?: string },
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const found = await client.query<{
      student_id: string;
      grade_item_id: string;
      max_score: string;
    }>(
      `SELECT x.student_id,a.grade_item_id,g.max_score::text FROM zhiban.assessment_attempts x JOIN zhiban.course_assessments a ON a.id=x.assessment_id JOIN zhiban.course_grade_items g ON g.id=a.grade_item_id WHERE x.id=$1 AND a.course_id=$2 AND x.status='submitted' FOR UPDATE OF x`,
      [input.attemptId, courseId],
    );
    const row = found.rows[0];
    if (!row) throw new Error('Pending attempt not found');
    if (input.score > Number(row.max_score)) throw new Error('Score exceeds maximum');
    await client.query(
      `UPDATE zhiban.assessment_attempts SET status='graded',score=$2,graded_at=now(),graded_by=$3 WHERE id=$1`,
      [input.attemptId, input.score, principal.id],
    );
    const result = await client.query(
      `INSERT INTO zhiban.course_grade_records(id,tenant_id,course_id,grade_item_id,student_id,raw_score,normalized_score,status,source_type,source_id,feedback,graded_by,graded_at) VALUES($1,$2,$3,$4,$5,$6,$7,'draft','assessment',$8,$9,$10,now()) ON CONFLICT(tenant_id,grade_item_id,student_id) DO UPDATE SET raw_score=excluded.raw_score,normalized_score=excluded.normalized_score,source_id=excluded.source_id,feedback=excluded.feedback,graded_by=excluded.graded_by,graded_at=now(),updated_at=now() WHERE NOT course_grade_records.is_override RETURNING *`,
      [
        randomUUID(),
        principal.tenantId,
        courseId,
        row.grade_item_id,
        row.student_id,
        input.score,
        (input.score / Number(row.max_score)) * 100,
        input.attemptId,
        input.feedback ?? '',
        principal.id,
      ],
    );
    return result.rows[0];
  });
}

export async function updateAssessment(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  assessmentId: string,
  input: Pick<
    AssessmentInput,
    'title' | 'description' | 'maxAttempts' | 'scoringMethod' | 'opensAt' | 'dueAt' | 'questions'
  >,
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const found = await client.query(
      `SELECT 1 FROM zhiban.course_assessments WHERE id=$1 AND course_id=$2 AND status='draft' FOR UPDATE`,
      [assessmentId, courseId],
    );
    if (!found.rows[0]) throw new Error('Only draft assessments can be edited');
    await client.query(
      `UPDATE zhiban.course_assessments SET title=$3,description=$4,max_attempts=$5,scoring_method=$6,opens_at=$7,due_at=$8,updated_at=now() WHERE id=$1 AND course_id=$2`,
      [
        assessmentId,
        courseId,
        input.title,
        input.description ?? '',
        input.maxAttempts,
        input.scoringMethod,
        input.opensAt ?? null,
        input.dueAt ?? null,
      ],
    );
    await client.query(`DELETE FROM zhiban.assessment_questions WHERE assessment_id=$1`, [
      assessmentId,
    ]);
    for (const [order, q] of input.questions.entries())
      await client.query(
        `INSERT INTO zhiban.assessment_questions(id,tenant_id,assessment_id,question_type,prompt,options,answer_key,max_score,display_order) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
        [
          randomUUID(),
          principal.tenantId,
          assessmentId,
          q.type,
          q.prompt,
          JSON.stringify(q.options ?? []),
          JSON.stringify(q.answerKey ?? {}),
          q.maxScore,
          order + 1,
        ],
      );
    return { updated: true };
  });
}

export async function changeAssessmentStatus(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  assessmentId: string,
  action: 'close' | 'archive' | 'delete',
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    if (action === 'delete') {
      const deleted = await client.query(
        `DELETE FROM zhiban.course_assessments WHERE id=$1 AND course_id=$2 AND status='draft' RETURNING grade_item_id`,
        [assessmentId, courseId],
      );
      if (!deleted.rows[0]) throw new Error('Only draft assessments can be deleted');
      await client.query(`DELETE FROM zhiban.course_grade_items WHERE id=$1`, [
        deleted.rows[0].grade_item_id,
      ]);
      return { deleted: true };
    }
    const status = action === 'close' ? 'closed' : 'archived';
    const updated = await client.query(
      `UPDATE zhiban.course_assessments SET status=$3,updated_at=now() WHERE id=$1 AND course_id=$2 RETURNING id`,
      [assessmentId, courseId, status],
    );
    if (!updated.rows[0]) throw new Error('Assessment not found');
    return { status };
  });
}

export async function gradeAssessmentAnswers(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    attemptId: string;
    answers: Array<{ answerId: string; score: number; feedback?: string }>;
    feedback?: string;
  },
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const found = await client.query<{
      student_id: string;
      grade_item_id: string;
      max_score: string;
    }>(
      `SELECT x.student_id,a.grade_item_id,g.max_score::text FROM zhiban.assessment_attempts x JOIN zhiban.course_assessments a ON a.id=x.assessment_id JOIN zhiban.course_grade_items g ON g.id=a.grade_item_id WHERE x.id=$1 AND a.course_id=$2 AND x.status='submitted' FOR UPDATE OF x`,
      [input.attemptId, courseId],
    );
    const meta = found.rows[0];
    if (!meta) throw new Error('Pending attempt not found');
    let total = 0;
    for (const answer of input.answers) {
      const max = await client.query<{ max_score: string }>(
        `SELECT q.max_score::text FROM zhiban.assessment_answers n JOIN zhiban.assessment_questions q ON q.id=n.question_id WHERE n.id=$1 AND n.attempt_id=$2`,
        [answer.answerId, input.attemptId],
      );
      if (!max.rows[0] || answer.score > Number(max.rows[0].max_score))
        throw new Error('Invalid answer score');
      total += answer.score;
      await client.query(
        `UPDATE zhiban.assessment_answers SET score=$2,feedback=$3,is_auto_graded=false WHERE id=$1`,
        [answer.answerId, answer.score, answer.feedback ?? ''],
      );
    }
    if (total > Number(meta.max_score)) throw new Error('Score exceeds maximum');
    await client.query(
      `UPDATE zhiban.assessment_attempts SET status='graded',score=$2,graded_at=now(),graded_by=$3 WHERE id=$1`,
      [input.attemptId, total, principal.id],
    );
    await client.query(
      `INSERT INTO zhiban.course_grade_records(id,tenant_id,course_id,grade_item_id,student_id,raw_score,normalized_score,status,source_type,source_id,feedback,graded_by,graded_at) VALUES($1,$2,$3,$4,$5,$6,$7,'draft','assessment',$8,$9,$10,now()) ON CONFLICT(tenant_id,grade_item_id,student_id) DO UPDATE SET raw_score=excluded.raw_score,normalized_score=excluded.normalized_score,feedback=excluded.feedback,graded_by=excluded.graded_by,graded_at=now(),updated_at=now() WHERE NOT course_grade_records.is_override`,
      [
        randomUUID(),
        principal.tenantId,
        courseId,
        meta.grade_item_id,
        meta.student_id,
        total,
        (total / Number(meta.max_score)) * 100,
        input.attemptId,
        input.feedback ?? '',
        principal.id,
      ],
    );
    return { score: total };
  });
}

export async function withdrawFinalGrades(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  reason: string,
) {
  requireManage(principal, courseId);
  if (!reason.trim()) throw new Error('Withdrawal reason is required');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE zhiban.course_final_grades SET status='draft',published_at=NULL,published_by=NULL WHERE course_id=$1 AND status='published' RETURNING id,student_id,total_score`,
      [courseId],
    );
    await client.query(
      `INSERT INTO zhiban.grade_publication_batches(id,tenant_id,course_id,publication_type,record_count,actor_id,reason,snapshot) VALUES($1,$2,$3,'withdrawal',$4,$5,$6,$7::jsonb)`,
      [
        randomUUID(),
        principal.tenantId,
        courseId,
        result.rows.length,
        principal.id,
        reason,
        JSON.stringify({ grades: result.rows }),
      ],
    );
    return { withdrawn: result.rows.length };
  });
}

export async function createGradeReview(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: { courseId: string; gradeRecordId?: string; finalGradeId?: string; reason: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const owns = input.gradeRecordId
      ? await client.query(
          `SELECT 1 FROM zhiban.course_grade_records WHERE id=$1 AND course_id=$2 AND student_id=$3 AND status='published'`,
          [input.gradeRecordId, input.courseId, principal.id],
        )
      : await client.query(
          `SELECT 1 FROM zhiban.course_final_grades WHERE id=$1 AND course_id=$2 AND student_id=$3 AND status='published'`,
          [input.finalGradeId, input.courseId, principal.id],
        );
    if (!owns.rows[0]) throw new Error('Published grade not found');
    const result = await client.query(
      `INSERT INTO zhiban.grade_review_requests(id,tenant_id,course_id,student_id,grade_record_id,final_grade_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        randomUUID(),
        principal.tenantId,
        input.courseId,
        principal.id,
        input.gradeRecordId ?? null,
        input.finalGradeId ?? null,
        input.reason,
      ],
    );
    return result.rows[0];
  });
}

export async function handleGradeReview(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { reviewId: string; status: 'approved' | 'rejected'; resolution: string },
) {
  requireManage(principal, courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE zhiban.grade_review_requests SET status=$3,resolution=$4,handled_by=$5,handled_at=now() WHERE id=$1 AND course_id=$2 AND status='pending' RETURNING *`,
      [input.reviewId, courseId, input.status, input.resolution, principal.id],
    );
    if (!result.rows[0]) throw new Error('Pending review not found');
    return result.rows[0];
  });
}

export async function listStudentGrades(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const courses = await client.query(
      `SELECT c.id,c.code,c.name,f.id final_grade_id,f.formative_score,f.project_score,f.final_exam_score,f.total_score,f.letter_grade,f.published_at FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id JOIN zhiban.courses c ON c.id=o.course_id LEFT JOIN zhiban.course_final_grades f ON f.course_id=c.id AND f.student_id=e.student_id AND f.status='published' WHERE e.student_id=$1 AND e.status='enrolled' ORDER BY c.name`,
      [principal.id],
    );
    const records = await client.query(
      `SELECT r.id grade_record_id,r.course_id,g.code,g.name,g.category,r.raw_score,g.max_score,r.normalized_score,r.feedback,r.published_at FROM zhiban.course_grade_records r JOIN zhiban.course_grade_items g ON g.id=r.grade_item_id WHERE r.student_id=$1 AND r.status='published' ORDER BY g.category,g.code`,
      [principal.id],
    );
    const reviews = await client.query(
      `SELECT * FROM zhiban.grade_review_requests WHERE student_id=$1 ORDER BY created_at DESC`,
      [principal.id],
    );
    return { courses: courses.rows, records: records.rows, reviews: reviews.rows };
  });
}

export async function listStudentAssessments(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
) {
  return withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query(
          `SELECT a.id,a.course_id,c.name course_name,a.title,a.description,a.assessment_type,a.max_attempts,a.due_at,g.max_score,
    (SELECT count(*) FROM zhiban.assessment_attempts x WHERE x.assessment_id=a.id AND x.student_id=$1 AND x.status<>'void')::int attempt_count,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q.id,'type',q.question_type,'prompt',q.prompt,'options',q.options,'maxScore',q.max_score) ORDER BY q.display_order) FROM zhiban.assessment_questions q WHERE q.assessment_id=a.id),'[]'::jsonb) questions
    FROM zhiban.course_assessments a JOIN zhiban.courses c ON c.id=a.course_id JOIN zhiban.course_grade_items g ON g.id=a.grade_item_id
    WHERE a.status='published' AND (a.opens_at IS NULL OR a.opens_at<=now()) AND (a.due_at IS NULL OR a.due_at>=now()) AND EXISTS(SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE e.student_id=$1 AND e.status='enrolled' AND o.course_id=a.course_id) ORDER BY a.due_at NULLS LAST,a.created_at`,
          [principal.id],
        )
      ).rows,
  );
}

export async function submitAssessment(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  assessmentId: string,
  answers: Array<{ questionId: string; answer: unknown }>,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const assessment = await client.query<{
      course_id: string;
      grade_item_id: string;
      max_attempts: number;
      scoring_method: string;
      max_score: string;
    }>(
      `SELECT a.course_id,a.grade_item_id,a.max_attempts,a.scoring_method,g.max_score::text FROM zhiban.course_assessments a JOIN zhiban.course_grade_items g ON g.id=a.grade_item_id WHERE a.id=$1 AND a.status='published' AND (a.opens_at IS NULL OR a.opens_at<=now()) AND (a.due_at IS NULL OR a.due_at>=now())`,
      [assessmentId],
    );
    const meta = assessment.rows[0];
    if (!meta) throw new Error('Assessment is not available');
    const allowed = await client.query(
      `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE e.student_id=$1 AND e.status='enrolled' AND o.course_id=$2`,
      [principal.id, meta.course_id],
    );
    if (!allowed.rows[0]) throw new Error('Permission denied');
    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text count FROM zhiban.assessment_attempts WHERE assessment_id=$1 AND student_id=$2 AND status<>'void'`,
      [assessmentId, principal.id],
    );
    const attemptNo = Number(count.rows[0].count) + 1;
    if (attemptNo > meta.max_attempts) throw new Error('Maximum attempts reached');
    const questions = await client.query<{
      id: string;
      question_type: string;
      answer_key: Record<string, unknown>;
      max_score: string;
    }>(
      `SELECT id,question_type,answer_key,max_score::text FROM zhiban.assessment_questions WHERE assessment_id=$1 ORDER BY display_order`,
      [assessmentId],
    );
    const byId = new Map(answers.map((a) => [a.questionId, a.answer]));
    let total = 0;
    let manual = false;
    const attemptId = randomUUID();
    await client.query(
      `INSERT INTO zhiban.assessment_attempts(id,tenant_id,assessment_id,student_id,attempt_no,status,started_at,submitted_at) VALUES($1,$2,$3,$4,$5,'submitted',now(),now())`,
      [attemptId, principal.tenantId, assessmentId, principal.id, attemptNo],
    );
    for (const q of questions.rows) {
      const answer = byId.get(q.id) ?? '';
      const needsManual =
        ['essay', 'short_answer'].includes(q.question_type) && q.answer_key.value === undefined;
      manual ||= needsManual;
      const expected = q.answer_key.value;
      const correct =
        !needsManual &&
        JSON.stringify(answer).toLowerCase() === JSON.stringify(expected).toLowerCase();
      const score = needsManual ? null : correct ? Number(q.max_score) : 0;
      if (score !== null) total += score;
      await client.query(
        `INSERT INTO zhiban.assessment_answers(id,tenant_id,attempt_id,question_id,answer,score,is_auto_graded) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [
          randomUUID(),
          principal.tenantId,
          attemptId,
          q.id,
          JSON.stringify(answer),
          score,
          !needsManual,
        ],
      );
    }
    if (!manual) {
      await client.query(
        `UPDATE zhiban.assessment_attempts SET status='graded',score=$2,graded_at=now() WHERE id=$1`,
        [attemptId, total],
      );
      const existing = await client.query<{ raw_score: string }>(
        `SELECT raw_score::text FROM zhiban.course_grade_records WHERE grade_item_id=$1 AND student_id=$2`,
        [meta.grade_item_id, principal.id],
      );
      const previous = existing.rows[0] ? Number(existing.rows[0].raw_score) : null;
      const average = await client.query<{ score: string }>(
        `SELECT avg(score)::text score FROM zhiban.assessment_attempts WHERE assessment_id=$1 AND student_id=$2 AND status='graded'`,
        [assessmentId, principal.id],
      );
      const chosen =
        meta.scoring_method === 'average'
          ? Number(average.rows[0].score)
          : meta.scoring_method === 'highest' && previous !== null
            ? Math.max(previous, total)
            : total;
      await client.query(
        `INSERT INTO zhiban.course_grade_records(id,tenant_id,course_id,grade_item_id,student_id,raw_score,normalized_score,status,source_type,source_id,graded_at) VALUES($1,$2,$3,$4,$5,$6,$7,'draft','assessment',$8,now()) ON CONFLICT(tenant_id,grade_item_id,student_id) DO UPDATE SET raw_score=$6,normalized_score=$7,source_id=$8,graded_at=now(),updated_at=now() WHERE NOT course_grade_records.is_override`,
        [
          randomUUID(),
          principal.tenantId,
          meta.course_id,
          meta.grade_item_id,
          principal.id,
          chosen,
          Math.min(100, (chosen / Number(meta.max_score)) * 100),
          attemptId,
        ],
      );
    }
    return {
      attemptId,
      attemptNo,
      status: manual ? 'submitted' : 'graded',
      score: manual ? null : total,
    };
  });
}
