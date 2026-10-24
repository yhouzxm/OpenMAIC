import { describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import {
  academicAdmin,
  academicTeacher,
  academicStudent,
  academicCommand,
  type AcademicActor,
  type AcademicGrant,
} from '@/lib/zhiban/domain/academic/model';

const course = v7(),
  offering = v7();
const actor = (grant: Partial<AcademicGrant>): AcademicActor => ({
  tenantId: v7(),
  membershipId: v7(),
  userId: v7(),
  now: 100,
  expiresAt: 200,
  grants: [
    {
      roleCode: 'TEACHER',
      scopeKind: 'TENANT',
      scopeId: null,
      validFrom: 10,
      validUntil: null,
      ...grant,
    },
  ],
});
describe('academic authority and command boundary', () => {
  it('CLASS authority is exact offering, with no implied course containment', () => {
    expect(
      academicTeacher(actor({ scopeKind: 'CLASS', scopeId: offering }), course, offering),
    ).toBe(true);
    expect(academicTeacher(actor({ scopeKind: 'CLASS', scopeId: course }), course, offering)).toBe(
      false,
    );
    expect(academicTeacher(actor({ scopeKind: 'CLASS', scopeId: offering }), course, v7())).toBe(
      false,
    );
  });
  it('COURSE authority is exact course', () => {
    expect(academicTeacher(actor({ scopeKind: 'COURSE', scopeId: course }), course, offering)).toBe(
      true,
    );
    expect(academicTeacher(actor({ scopeKind: 'COURSE', scopeId: course }), v7(), offering)).toBe(
      false,
    );
  });
  it('student role requires SELF and administrator requires TENANT', () => {
    expect(academicStudent(actor({ roleCode: 'STUDENT', scopeKind: 'SELF' }))).toBe(true);
    expect(academicStudent(actor({ roleCode: 'STUDENT' }))).toBe(false);
    expect(academicAdmin(actor({ roleCode: 'TENANT_ADMIN' }))).toBe(true);
    expect(
      academicAdmin(actor({ roleCode: 'TENANT_ADMIN', scopeKind: 'CLASS', scopeId: offering })),
    ).toBe(false);
  });
  it.each([{ validUntil: 100 }, { validFrom: 101 }])(
    'expired/future grants confer no authority: %j',
    (grant) => {
      expect(academicTeacher(actor(grant), course, offering)).toBe(false);
      expect(academicAdmin(actor({ ...grant, roleCode: 'TENANT_ADMIN' }))).toBe(false);
    },
  );
  it('refuses DTO authority injection and unknown command types', () => {
    expect(() =>
      academicCommand({ type: 'CREATE_CLASS', code: 'A', name: '班', mode: 'ADMIN' }),
    ).toThrow('INVALID_INPUT');
    expect(() => academicCommand({ type: 'SELF_ENROLL' })).toThrow('INVALID_INPUT');
  });
  it.each(['2026-02-30', '2026-2-01'])('rejects invalid dates %s', (startsOn) => {
    expect(() =>
      academicCommand({
        type: 'CREATE_TERM',
        code: 'T',
        name: '学期',
        startsOn,
        endsOn: '2026-07-01',
      }),
    ).toThrow('INVALID_INPUT');
  });
  it('accepts explicit null revision on first enrollment, rejects lossy numeric CAS', () => {
    expect(
      academicCommand({ type: 'ENROLL', offeringId: offering, membershipId: v7(), revision: null })
        .revision,
    ).toBe(null);
    expect(() => academicCommand({ type: 'WITHDRAW', id: v7(), revision: 1 })).toThrow(
      'INVALID_INPUT',
    );
  });
  it.each([0, 1001, 1.5])('rejects unsupported capacity %s', (capacity) => {
    expect(() =>
      academicCommand({
        type: 'CREATE_OFFERING',
        courseId: course,
        termId: v7(),
        classId: null,
        code: 'A',
        name: '班',
        capacity,
      }),
    ).toThrow('INVALID_INPUT');
  });
});
