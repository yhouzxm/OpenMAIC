import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  addClassMember,
  createAcademicClass,
  createAcademicCourse,
  createAcademicTerm,
  createCourseOffering,
  enrollStudent,
  listAcademicOverview,
} from '@/lib/zhiban/academic';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  authorizationErrorResponse,
  requireRequestPermission,
  requireRequestScopedPermission,
} from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

const optionalUuid = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.uuid().optional(),
);
const optionalPositiveInt = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : Number(value)),
  z.number().int().positive().optional(),
);

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_term'),
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(160),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
  }),
  z.object({
    action: z.literal('create_class'),
    termId: z.uuid(),
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    headTeacherId: optionalUuid,
    capacity: optionalPositiveInt,
  }),
  z.object({
    action: z.literal('create_course'),
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional(),
    credits: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : Number(value)),
      z.number().nonnegative().max(99).optional(),
    ),
    ownerTeacherId: optionalUuid,
  }),
  z.object({
    action: z.literal('create_offering'),
    courseId: z.uuid(),
    termId: z.uuid(),
    classId: optionalUuid,
    code: z.string().trim().min(1).max(80),
    capacity: optionalPositiveInt,
    teacherId: optionalUuid,
  }),
  z.object({ action: z.literal('add_class_member'), classId: z.uuid(), studentId: z.uuid() }),
  z.object({ action: z.literal('enroll_student'), offeringId: z.uuid(), studentId: z.uuid() }),
]);

export async function GET() {
  try {
    const principal = await requireRequestPermission('course:manage');
    return NextResponse.json({ overview: await listAcademicOverview(getZhibanPool(), principal) });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to load academic data' }, { status: 500 })
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid academic operation' }, { status: 400 });
    const input = parsed.data;
    const pool = getZhibanPool();
    if (input.action === 'add_class_member') {
      const principal = await requireRequestScopedPermission('class:manage', {
        classIds: [input.classId],
      });
      return NextResponse.json(
        { result: await addClassMember(pool, principal, input) },
        { status: 201 },
      );
    }
    const permission =
      input.action === 'enroll_student'
        ? 'enrollment:manage'
        : input.action === 'create_class'
          ? 'class:manage'
          : 'course:manage';
    const principal = await requireRequestPermission(permission);
    const result =
      input.action === 'create_term'
        ? await createAcademicTerm(pool, principal, input)
        : input.action === 'create_class'
          ? await createAcademicClass(pool, principal, input)
          : input.action === 'create_course'
            ? await createAcademicCourse(pool, principal, input)
            : input.action === 'create_offering'
              ? await createCourseOffering(pool, principal, input)
              : await enrollStudent(pool, principal, input);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Academic operation failed' },
      { status: 409 },
    );
  }
}
