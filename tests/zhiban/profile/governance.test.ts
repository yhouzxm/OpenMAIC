import { describe, expect, it } from 'vitest';
import { getLearnerProfileDetail, setOwnProfilePreference } from '@/lib/zhiban/profile';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { QueryResult, ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';

const tenantId = '11111111-1111-4111-8111-111111111111';
const learnerId = '22222222-2222-4222-8222-222222222222';
const courseId = '33333333-3333-4333-8333-333333333333';
const student: AuthorizedPrincipal = {
  id: learnerId,
  tenantId,
  loginName: 's1',
  displayName: 'Student',
  accountType: 'student',
  mustChangePassword: false,
  roles: ['student'],
  permissions: ['course:read'],
  grants: [],
};

class Database implements ZhibanDatabasePool, ZhibanDatabaseClient {
  statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  connects = 0;
  async connect() {
    this.connects += 1;
    return this;
  }
  release() {}
  async query<TRow extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<TRow>> {
    this.statements.push({ text, values });
    if (text.includes('SELECT 1 FROM zhiban.enrollments'))
      return { rows: [{ ok: 1 }] as unknown as TRow[] };
    return { rows: [] };
  }
}

describe('learner profile governance', () => {
  it('updates collection preference, retention and audit in one tenant transaction', async () => {
    const db = new Database();
    await expect(
      setOwnProfilePreference(db, student, courseId, {
        collectionEnabled: false,
        retentionDays: 365,
      }),
    ).resolves.toMatchObject({ collectionEnabled: false, retentionDays: 365 });
    expect(db.statements.some((s) => s.text.includes('learner_profile_preferences'))).toBe(true);
    expect(
      db.statements.some((s) => s.text.includes('UPDATE zhiban.learning_events SET expires_at')),
    ).toBe(true);
    expect(
      db.statements.some((s) => s.values?.includes('learner_profile.preference_changed')),
    ).toBe(true);
    expect(db.statements.at(-1)?.text).toBe('COMMIT');
  });

  it('rejects an unrelated teacher before opening a database transaction', async () => {
    const db = new Database();
    const teacher: AuthorizedPrincipal = {
      ...student,
      id: '44444444-4444-4444-8444-444444444444',
      accountType: 'teacher',
      roles: ['teacher'],
    };
    await expect(getLearnerProfileDetail(db, teacher, learnerId, courseId)).rejects.toThrow(
      'Permission denied',
    );
    expect(db.connects).toBe(0);
  });
});
