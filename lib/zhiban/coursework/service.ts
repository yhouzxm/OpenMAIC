import { createHash, randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { ActivityAssignmentRecord, AssignmentSubmissionRecord } from './types';

type Row = Record<string, unknown>;

async function requireEnrollment(
  client: ZhibanDatabaseClient,
  studentId: string,
  courseId: string,
) {
  const found = await client.query(
    `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
     WHERE e.student_id=$1 AND e.status='enrolled' AND o.course_id=$2 LIMIT 1`,
    [studentId, courseId],
  );
  if (!found.rows[0]) throw new Error('Course is unavailable');
}

function filesFrom(value: unknown) {
  return (Array.isArray(value) ? value : []).map((file) => {
    const row = file as Row;
    return {
      id: String(row.id),
      fileName: String(row.fileName),
      mimeType: String(row.mimeType),
      fileSize: Number(row.fileSize),
    };
  });
}

function mapSubmission(row: Row): AssignmentSubmissionRecord {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    studentName: row.student_name ? String(row.student_name) : undefined,
    attemptNo: Number(row.attempt_no),
    textContent: String(row.text_content ?? ''),
    status: row.status as AssignmentSubmissionRecord['status'],
    isLate: Boolean(row.is_late),
    feedback: String(row.feedback ?? ''),
    score: row.score == null ? null : Number(row.score),
    submittedAt: row.submitted_at ? new Date(String(row.submitted_at)).toISOString() : null,
    files: filesFrom(row.files),
  };
}

function mapAssignment(row: Row): ActivityAssignmentRecord {
  return {
    id: String(row.id),
    activityId: String(row.activity_id),
    activityTitle: String(row.activity_title),
    title: String(row.title),
    instructions: String(row.instructions ?? ''),
    submissionType: row.submission_type as ActivityAssignmentRecord['submissionType'],
    maxFiles: Number(row.max_files),
    maxFileSize: Number(row.max_file_size),
    maxAttempts: Number(row.max_attempts),
    opensAt: row.opens_at ? new Date(String(row.opens_at)).toISOString() : null,
    dueAt: row.due_at ? new Date(String(row.due_at)).toISOString() : null,
    allowLate: Boolean(row.allow_late),
    status: row.status as ActivityAssignmentRecord['status'],
    gradeItemId: row.grade_item_id ? String(row.grade_item_id) : null,
  };
}

const submissionSelect = `SELECT s.*,a.display_name AS student_name,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'fileName',f.file_name,'mimeType',f.mime_type,'fileSize',f.file_size)
  ORDER BY f.created_at) FROM zhiban.activity_assignment_files f WHERE f.submission_id=s.id),'[]'::jsonb) AS files
  FROM zhiban.activity_assignment_submissions s JOIN zhiban.accounts a ON a.id=s.student_id`;

export async function getTeacherCoursework(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const [assignments, submissions, gradeItems] = await Promise.all([
      client.query<Row>(
        `SELECT x.*,a.title AS activity_title FROM zhiban.activity_assignments x
         JOIN zhiban.course_activities a ON a.id=x.activity_id WHERE x.course_id=$1 ORDER BY a.position`,
        [courseId],
      ),
      client.query<Row>(`${submissionSelect} WHERE s.course_id=$1 ORDER BY s.submitted_at DESC`, [
        courseId,
      ]),
      client.query<Row>(
        `SELECT id,name,max_score FROM zhiban.course_grade_items WHERE course_id=$1 AND status='active' ORDER BY name`,
        [courseId],
      ),
    ]);
    const byAssignment = new Map<string, AssignmentSubmissionRecord[]>();
    for (const row of submissions.rows) {
      const key = String(row.assignment_id);
      byAssignment.set(key, [...(byAssignment.get(key) ?? []), mapSubmission(row)]);
    }
    return {
      assignments: assignments.rows.map((row) => ({
        ...mapAssignment(row),
        submissions: byAssignment.get(String(row.id)) ?? [],
      })),
      gradeItems: gradeItems.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        maxScore: Number(row.max_score),
      })),
    };
  });
}

export async function saveActivityAssignment(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: Omit<ActivityAssignmentRecord, 'id' | 'activityTitle' | 'submissions' | 'mySubmissions'>,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const activity = await client.query(
      `SELECT id FROM zhiban.course_activities WHERE id=$1 AND course_id=$2 AND activity_type='assignment'`,
      [input.activityId, courseId],
    );
    if (!activity.rows[0]) throw new Error('请选择当前课程中的作业活动');
    if (input.gradeItemId) {
      const gradeItem = await client.query(
        `SELECT id FROM zhiban.course_grade_items WHERE id=$1 AND course_id=$2 AND status='active'`,
        [input.gradeItemId, courseId],
      );
      if (!gradeItem.rows[0]) throw new Error('成绩项不属于当前课程');
    }
    const id = randomUUID();
    const result = await client.query<{ id: string }>(
      `INSERT INTO zhiban.activity_assignments
       (id,tenant_id,course_id,activity_id,title,instructions,submission_type,max_files,max_file_size,max_attempts,opens_at,due_at,allow_late,status,grade_item_id,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT(tenant_id,activity_id) DO UPDATE SET title=excluded.title,instructions=excluded.instructions,
       submission_type=excluded.submission_type,max_files=excluded.max_files,max_file_size=excluded.max_file_size,
       max_attempts=excluded.max_attempts,opens_at=excluded.opens_at,due_at=excluded.due_at,allow_late=excluded.allow_late,
       status=excluded.status,grade_item_id=excluded.grade_item_id,updated_at=now() RETURNING id`,
      [
        id,
        principal.tenantId,
        courseId,
        input.activityId,
        input.title,
        input.instructions,
        input.submissionType,
        input.maxFiles,
        input.maxFileSize,
        input.maxAttempts,
        input.opensAt,
        input.dueAt,
        input.allowLate,
        input.status,
        input.gradeItemId,
        principal.id,
      ],
    );
    await client.query(
      `UPDATE zhiban.course_activities SET reference_id=$1,updated_at=now() WHERE id=$2`,
      [result.rows[0].id, input.activityId],
    );
    return result.rows[0];
  });
}

export async function getStudentCoursework(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal.id, courseId);
    const [assignments, submissions] = await Promise.all([
      client.query<Row>(
        `SELECT x.*,a.title AS activity_title FROM zhiban.activity_assignments x
         JOIN zhiban.course_activities a ON a.id=x.activity_id
         WHERE x.course_id=$1 AND x.status IN('published','closed') AND EXISTS(
           SELECT 1 FROM zhiban.course_design_versions v,LATERAL jsonb_array_elements(v.snapshot->'modules') m,
           LATERAL jsonb_array_elements(m->'chapters') c,LATERAL jsonb_array_elements(c->'activities') item
           WHERE v.course_id=x.course_id AND v.status='published' AND item->>'id'=x.activity_id::text)
         ORDER BY a.position`,
        [courseId],
      ),
      client.query<Row>(
        `${submissionSelect} WHERE s.course_id=$1 AND s.student_id=$2 ORDER BY s.attempt_no DESC`,
        [courseId, principal.id],
      ),
    ]);
    const byAssignment = new Map<string, AssignmentSubmissionRecord[]>();
    for (const row of submissions.rows) {
      const key = String(row.assignment_id);
      byAssignment.set(key, [...(byAssignment.get(key) ?? []), mapSubmission(row)]);
    }
    return assignments.rows.map((row) => ({
      ...mapAssignment(row),
      mySubmissions: byAssignment.get(String(row.id)) ?? [],
    }));
  });
}

export async function submitActivityAssignment(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    assignmentId: string;
    textContent: string;
    files: Array<{ name: string; type: string; content: Buffer }>;
    mode?: 'draft' | 'submit';
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal.id, courseId);
    const assignment = (
      await client.query<Row>(
        `SELECT * FROM zhiban.activity_assignments WHERE id=$1 AND course_id=$2 AND status='published'
         AND (opens_at IS NULL OR opens_at<=now())`,
        [input.assignmentId, courseId],
      )
    ).rows[0];
    if (!assignment) throw new Error('作业当前不可提交');
    const isLate = Boolean(assignment.due_at && new Date(String(assignment.due_at)) < new Date());
    if (isLate && !assignment.allow_late) throw new Error('作业已截止且不允许迟交');
    if (assignment.submission_type === 'text' && input.files.length)
      throw new Error('该作业仅允许文本提交');
    if (assignment.submission_type === 'file' && input.textContent.trim())
      throw new Error('该作业仅允许文件提交');
    if (!input.textContent.trim() && !input.files.length) throw new Error('请填写内容或上传文件');
    if (input.files.length > Number(assignment.max_files)) throw new Error('上传文件数量超过限制');
    for (const file of input.files)
      if (file.content.length > Number(assignment.max_file_size))
        throw new Error(`${file.name} 超过大小限制`);
    const previous = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM zhiban.activity_assignment_submissions
       WHERE assignment_id=$1 AND student_id=$2 AND status IN('submitted','graded')`,
      [input.assignmentId, principal.id],
    );
    const nextAttemptNo = Number(previous.rows[0]?.count ?? 0) + 1;
    const digest = createHash('sha256');
    digest.update(input.textContent);
    for (const file of input.files) digest.update(file.content);
    const draft = await client.query<{ id: string; attempt_no: number }>(
      `SELECT id,attempt_no FROM zhiban.activity_assignment_submissions
       WHERE assignment_id=$1 AND student_id=$2 AND status IN('draft','returned') ORDER BY updated_at DESC LIMIT 1`,
      [input.assignmentId, principal.id],
    );
    const attemptNo = draft.rows[0]?.attempt_no ?? nextAttemptNo;
    if (!draft.rows[0] && attemptNo > Number(assignment.max_attempts))
      throw new Error('已达到最大提交次数');
    const submissionId = draft.rows[0]?.id ?? randomUUID(),
      contentHash = digest.digest('hex');
    if (draft.rows[0]) {
      await client.query(
        `UPDATE zhiban.activity_assignment_submissions SET attempt_no=$1,text_content=$2,status=$3,is_late=$4,
         content_hash=$5,submitted_at=CASE WHEN $3='submitted' THEN now() ELSE NULL END,updated_at=now() WHERE id=$6`,
        [
          attemptNo,
          input.textContent,
          input.mode === 'draft' ? 'draft' : 'submitted',
          isLate,
          contentHash,
          submissionId,
        ],
      );
      await client.query(`DELETE FROM zhiban.activity_assignment_files WHERE submission_id=$1`, [
        submissionId,
      ]);
    } else
      await client.query(
        `INSERT INTO zhiban.activity_assignment_submissions
       (id,tenant_id,course_id,assignment_id,student_id,attempt_no,text_content,status,is_late,content_hash,submitted_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $8='submitted' THEN now() ELSE NULL END)`,
        [
          submissionId,
          principal.tenantId,
          courseId,
          input.assignmentId,
          principal.id,
          attemptNo,
          input.textContent,
          input.mode === 'draft' ? 'draft' : 'submitted',
          isLate,
          contentHash,
        ],
      );
    for (const file of input.files)
      await client.query(
        `INSERT INTO zhiban.activity_assignment_files(id,tenant_id,course_id,submission_id,file_name,mime_type,file_size,content,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(),
          principal.tenantId,
          courseId,
          submissionId,
          file.name,
          file.type || 'application/octet-stream',
          file.content.length,
          file.content,
          createHash('sha256').update(file.content).digest('hex'),
        ],
      );
    if (input.mode === 'draft')
      return { id: submissionId, attemptNo, isLate: false, contentHash, status: 'draft' };
    await client.query(
      `INSERT INTO zhiban.student_activity_progress(id,tenant_id,course_id,activity_id,student_id,status,progress_percent,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,'completed',100,now(),now()) ON CONFLICT(tenant_id,activity_id,student_id)
       DO UPDATE SET status='completed',progress_percent=100,completed_at=now(),updated_at=now()`,
      [randomUUID(), principal.tenantId, courseId, assignment.activity_id, principal.id],
    );
    await recordEvent(client, principal, courseId, submissionId, 'assignment_submitted', {
      assignmentId: input.assignmentId,
      attemptNo,
      isLate,
    });
    return { id: submissionId, attemptNo, isLate, contentHash };
  });
}

async function recordEvent(
  client: ZhibanDatabaseClient,
  principal: AuthorizedPrincipal,
  courseId: string,
  sourceId: string,
  eventType: string,
  payload: Row,
) {
  await client.query(
    `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,payload,occurred_at)
     VALUES($1,$2,$3,$4,'submission',$5,$6,$7::jsonb,now()) ON CONFLICT DO NOTHING`,
    [
      randomUUID(),
      principal.tenantId,
      principal.id,
      courseId,
      sourceId,
      eventType,
      JSON.stringify(payload),
    ],
  );
}

export async function reviewActivityAssignment(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    submissionId: string;
    action: 'return' | 'grade';
    feedback: string;
    score: number | null;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const submission = (
      await client.query<Row>(
        `SELECT s.*,x.activity_id,x.grade_item_id FROM zhiban.activity_assignment_submissions s
         JOIN zhiban.activity_assignments x ON x.id=s.assignment_id WHERE s.id=$1 AND s.course_id=$2 FOR UPDATE`,
        [input.submissionId, courseId],
      )
    ).rows[0];
    if (!submission) throw new Error('提交记录不存在');
    if (input.action === 'grade' && input.score == null) throw new Error('评分时必须填写分数');
    const status = input.action === 'return' ? 'returned' : 'graded';
    await client.query(
      `UPDATE zhiban.activity_assignment_submissions SET status=$1,feedback=$2,score=$3,returned_at=CASE WHEN $1='returned' THEN now() ELSE returned_at END,
       graded_at=CASE WHEN $1='graded' THEN now() ELSE NULL END,graded_by=$4,updated_at=now() WHERE id=$5`,
      [status, input.feedback, input.score, principal.id, input.submissionId],
    );
    if (status === 'returned')
      await client.query(
        `UPDATE zhiban.student_activity_progress SET status='in_progress',progress_percent=50,completed_at=NULL,updated_at=now()
         WHERE activity_id=$1 AND student_id=$2`,
        [submission.activity_id, submission.student_id],
      );
    else {
      await client.query(
        `UPDATE zhiban.student_activity_progress SET status='completed',progress_percent=100,score=$3,completed_at=now(),updated_at=now()
         WHERE activity_id=$1 AND student_id=$2`,
        [submission.activity_id, submission.student_id, input.score],
      );
      if (submission.grade_item_id)
        await client.query(
          `INSERT INTO zhiban.course_grade_records(id,tenant_id,course_id,grade_item_id,student_id,raw_score,normalized_score,status,source_type,source_id,feedback,graded_by,graded_at)
           VALUES($1,$2,$3,$4,$5,$6,$6,'draft','assessment',$7,$8,$9,now()) ON CONFLICT(tenant_id,grade_item_id,student_id)
           DO UPDATE SET raw_score=$6,normalized_score=$6,source_id=$7,feedback=$8,graded_by=$9,graded_at=now(),updated_at=now() WHERE NOT course_grade_records.is_override`,
          [
            randomUUID(),
            principal.tenantId,
            courseId,
            submission.grade_item_id,
            submission.student_id,
            input.score,
            input.submissionId,
            input.feedback,
            principal.id,
          ],
        );
    }
    return { id: input.submissionId, status };
  });
}

export async function readAssignmentFile(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  fileId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const file = (
      await client.query<{
        file_name: string;
        mime_type: string;
        content: Buffer;
        student_id: string;
        course_id: string;
      }>(
        `SELECT f.file_name,f.mime_type,f.content,s.student_id,s.course_id FROM zhiban.activity_assignment_files f
         JOIN zhiban.activity_assignment_submissions s ON s.id=f.submission_id WHERE f.id=$1`,
        [fileId],
      )
    ).rows[0];
    if (!file) throw new Error('文件不存在');
    if (principal.accountType === 'student' && file.student_id !== principal.id)
      throw new Error('Permission denied');
    if (
      principal.accountType !== 'student' &&
      (!principal.permissions.includes('grade:publish') ||
        !principal.grants.some(
          (grant) =>
            grant.permission === 'grade:publish' &&
            (grant.scopeType === 'system' ||
              grant.scopeType === 'tenant' ||
              (grant.scopeType === 'course' && grant.scopeId === file.course_id)),
        ))
    )
      throw new Error('Permission denied');
    return file;
  });
}
