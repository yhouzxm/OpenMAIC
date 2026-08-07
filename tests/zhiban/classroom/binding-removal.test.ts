import { describe, expect, it } from 'vitest';
import { deleteCourseClassroom, unbindCourseClassroom } from '@/lib/zhiban/classroom';
import { deletePersistedClassroom } from '@/lib/server/classroom-storage';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { QueryResult, ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';

const tenantId = '11111111-1111-4111-8111-111111111111';
const teacherId = '22222222-2222-4222-8222-222222222222';
const courseId = '33333333-3333-4333-8333-333333333333';
const bindingId = '44444444-4444-4444-8444-444444444444';
const principal: AuthorizedPrincipal = {
  id: teacherId,
  tenantId,
  loginName: 't1',
  displayName: 'Teacher',
  accountType: 'teacher',
  mustChangePassword: false,
  roles: ['course_teacher'],
  permissions: ['course:manage'],
  grants: [
    {
      roleCode: 'course_teacher',
      permission: 'course:manage',
      scopeType: 'course',
      scopeId: courseId,
    },
  ],
};

class Database implements ZhibanDatabasePool, ZhibanDatabaseClient {
  statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  async connect() {
    return this;
  }
  release() {}
  async query<TRow extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<TRow>> {
    this.statements.push({ text, values });
    if (text.includes('SELECT course_id,classroom_id'))
      return {
        rows: [
          { course_id: courseId, classroom_id: 'missing-stage7-removal-fixture' },
        ] as unknown as TRow[],
      };
    return { rows: [] };
  }
}

describe('course classroom removal', () => {
  it('unbinds by archiving and preserves session rows', async () => {
    const db = new Database();
    await expect(unbindCourseClassroom(db, principal, bindingId)).resolves.toEqual({
      id: bindingId,
      unbound: true,
    });
    expect(db.statements.some((row) => row.text.includes("SET status='archived'"))).toBe(true);
    expect(
      db.statements.some((row) => row.text.includes('DELETE FROM zhiban.course_classrooms')),
    ).toBe(false);
    expect(db.statements.some((row) => row.text.includes("'classroom.unbound'"))).toBe(true);
  });

  it('permanently deletes an unshared binding and audits the action', async () => {
    const db = new Database();
    await expect(
      deleteCourseClassroom(db, principal, bindingId, async () => false),
    ).resolves.toEqual({
      id: bindingId,
      deleted: true,
    });
    expect(
      db.statements.some((row) => row.text.includes('DELETE FROM zhiban.course_classrooms')),
    ).toBe(true);
    expect(db.statements.some((row) => row.text.includes("'classroom.deleted'"))).toBe(true);
  });

  it('rejects invalid persisted classroom paths before touching disk', async () => {
    await expect(deletePersistedClassroom('../escape')).rejects.toThrow('Invalid classroom id');
  });
});
