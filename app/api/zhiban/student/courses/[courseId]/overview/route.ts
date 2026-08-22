import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import { authorizationErrorResponse, requireRequestGrantedPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const principal = await requireRequestGrantedPermission('course:read');
    const courseId = z.uuid().parse((await params).courseId);
    const overview = await withZhibanTenant(getZhibanPool(), principal.tenantId, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT c.id,c.code,c.name,COALESCE(c.description,'') description,
                COALESCE(c.course_type,c.course_nature,'一般课程') course_type,
                term.name term_name,term.starts_on,term.ends_on,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id',teachers.id,'name',teachers.name,'role',teachers.role
                  ) ORDER BY teachers.role,teachers.name)
                  FROM (
                    SELECT DISTINCT a.id,COALESCE(tp.real_name,a.display_name) name,
                      CASE ta.teaching_role WHEN 'primary' THEN '责任教师' WHEN 'assistant' THEN '辅导教师' ELSE '导师' END role
                    FROM zhiban.course_offerings teacher_offering
                    JOIN zhiban.teaching_assignments ta ON ta.offering_id=teacher_offering.id AND ta.ended_at IS NULL
                    JOIN zhiban.accounts a ON a.id=ta.teacher_id AND a.deleted_at IS NULL
                    LEFT JOIN zhiban.teacher_profiles tp ON tp.account_id=a.id
                    WHERE teacher_offering.course_id=c.id
                    UNION
                    SELECT owner.id,COALESCE(owner_profile.real_name,owner.display_name) name,'课程负责人' role
                    FROM zhiban.accounts owner
                    LEFT JOIN zhiban.teacher_profiles owner_profile ON owner_profile.account_id=owner.id
                    WHERE owner.id=c.owner_teacher_id AND owner.deleted_at IS NULL
                  ) teachers
                ),'[]'::jsonb) teachers
         FROM zhiban.enrollments e
         JOIN zhiban.course_offerings o ON o.id=e.offering_id
         JOIN zhiban.courses c ON c.id=o.course_id
         JOIN zhiban.academic_terms term ON term.id=o.term_id
         WHERE e.student_id=$1 AND e.status='enrolled' AND c.id=$2
         ORDER BY term.starts_on DESC LIMIT 1`,
        [principal.id, courseId],
      );
      if (!result.rows[0]) throw new Error('Permission denied');
      return result.rows[0];
    });
    return NextResponse.json({ overview });
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load course overview' },
      { status: 400 },
    );
  }
}
