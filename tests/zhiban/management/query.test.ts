import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { managementQuery, managementCursor } from '@/lib/zhiban/application/management/service';
import type { AcademicContext, AcademicStore } from '@/lib/zhiban/application/academic/service';
import { AcademicService } from '@/lib/zhiban/application/academic/service';
import { localRequestTarget } from '@/scripts/zhiban-local/request-target';
const context = { tenantId: v7(), actorMembershipId: v7() } as AcademicContext;
it('bounds page size, preserves literal search and requires a roster target', () => {
  expect(managementQuery(context, 'offerings', {})).toMatchObject({
    limit: 20,
    state: 'ALL',
    after: null,
  });
  expect(
    managementQuery(context, 'enrollments', { offering: v7(), q: '  百分%_学生  ' }),
  ).toMatchObject({ q: '百分%_学生', state: 'ACTIVE' });
  for (const input of [
    { limit: '501' },
    { limit: '01' },
    { state: 'WITHDRAWN' },
    { q: 'x'.repeat(121) },
    { q: 'x\ny' },
    { unexpected: 'x' },
  ] as Record<string, string>[]) {
    expect(() => managementQuery(context, 'offerings', input)).toThrow('INVALID_INPUT');
  }
  expect(() => managementQuery(context, 'enrollments', {})).toThrow('INVALID_INPUT');
});
it('binds continuation to actor, tenant, kind, target, filters, and page size', () => {
  const offering = v7(),
    input = { offering, state: 'ALL', limit: '10', q: '学生' },
    q = managementQuery(context, 'enrollments', input),
    cursor = managementCursor(context, q, v7());
  expect(managementQuery(context, 'enrollments', { ...input, cursor }).after).not.toBeNull();
  for (const change of [
    { offering: v7() },
    { state: 'ACTIVE' },
    { limit: '50' },
    { q: '其他' },
    { member: v7() },
    { cursor: cursor + '=' },
  ] as Record<string, string>[])
    expect(() =>
      managementQuery(context, 'enrollments', { ...input, cursor, ...change }),
    ).toThrow();
  for (const change of [{ tenantId: v7() }, { actorMembershipId: v7() }])
    expect(() =>
      managementQuery({ ...context, ...change }, 'enrollments', { ...input, cursor }),
    ).toThrow();
  expect(() => managementQuery(context, 'offerings', { cursor })).toThrow();
});
it('permits only new encoded read queries and retains path and legacy restrictions', () => {
  const id = v7();
  for (const kind of ['offerings', 'enrollments'])
    expect(localRequestTarget(`/api/zhiban/management/${id}/${kind}?q=%E5%AD%A6`)).toBe(true);
  for (const path of [
    `/api/zhiban/management/${id}/commands?q=%31`,
    `/api/zhiban/management/${id}%2f/offerings`,
    `/api/zhiban/identity/spaces?limit=%31`,
  ])
    expect(localRequestTarget(path)).toBe(false);
});
it('ACK method executes under the command store transaction without loading a snapshot', async () => {
  let writes = 0,
    snapshots = 0;
  const actorStore = {
    run: async (_context: unknown, _command: unknown, work: Parameters<AcademicStore['run']>[2]) =>
      work(
        {
          tenantId: context.tenantId,
          membershipId: context.actorMembershipId,
          userId: v7(),
          now: 10,
          expiresAt: 1000,
          grants: [
            {
              roleCode: 'TENANT_ADMIN',
              scopeKind: 'TENANT',
              scopeId: null,
              validFrom: 0,
              validUntil: null,
            },
          ],
        },
        {
          execute: async () => {
            writes++;
          },
          snapshot: async () => {
            snapshots++;
            throw Error('snapshot cap');
          },
        } as unknown as Parameters<Parameters<AcademicStore['run']>[2]>[1],
      ),
  } as AcademicStore;
  const service = new AcademicService(actorStore);
  const result = await service.acknowledge(
    context,
    { type: 'WITHDRAW', id: v7(), revision: '1' },
    'command_key_123456',
  );
  expect(result.status).toBe('COMPLETED');
  expect(writes).toBe(1);
  expect(snapshots).toBe(0);
});
it('paginates master data with kind-bound cursors and admits only course states', () => {
  for (const kind of ['courses', 'terms', 'classes'] as const) {
    const q = managementQuery(context, kind, { q: '名称%_', limit: '10' }),
      cursor = managementCursor(context, q, v7());
    expect(q).toMatchObject({ state: 'ALL', limit: 10 });
    expect(
      managementQuery(context, kind, { q: '名称%_', limit: '10', cursor }).after,
    ).not.toBeNull();
    const other = kind === 'courses' ? 'terms' : 'courses';
    expect(() => managementQuery(context, other, { q: '名称%_', limit: '10', cursor })).toThrow();
    for (const input of [
      { source: v7() },
      { member: v7() },
      { offering: v7() },
      { state: 'ACTIVE' },
      { limit: '100' },
    ] as Record<string, string>[])
      expect(() => managementQuery(context, kind, input)).toThrow();
    expect(
      localRequestTarget(`/api/zhiban/management/${context.tenantId}/${kind}?q=%E8%AF%BE`),
    ).toBe(true);
  }
  expect(managementQuery(context, 'courses', { state: 'PUBLISHED' }).state).toBe('PUBLISHED');
  expect(() => managementQuery(context, 'terms', { state: 'PUBLISHED' })).toThrow();
  expect(() => managementQuery(context, 'classes', { state: 'DRAFT' })).toThrow();
});
it('requires exactly one teacher context, bounds relationship states and binds class/teacher cursors', () => {
  const classId = v7(),
    offering = v7();
  for (const input of [
    {},
    { offering, classId },
    { offering, state: 'ALL' },
    { classId, member: v7() },
  ] as Record<string, string>[])
    expect(() => managementQuery(context, 'teachers', input)).toThrow();
  for (const [kind, query] of [
    ['assignments', { offering }],
    ['class-members', { classId }],
    ['teachers', { classId }],
  ] as const) {
    const parsed = managementQuery(context, kind, query),
      cursor = managementCursor(context, parsed, v7());
    expect(managementQuery(context, kind, { ...query, cursor }).after).not.toBeNull();
    expect(() =>
      managementQuery(context, kind, {
        ...query,
        cursor,
        ...(kind === 'assignments' ? { offering: v7() } : { classId: v7() }),
      }),
    ).toThrow();
    expect(
      localRequestTarget(`/api/zhiban/management/${context.tenantId}/${kind}?q=%E6%95%99`),
    ).toBe(true);
  }
  expect(() => managementQuery(context, 'assignments', {})).toThrow();
  expect(() => managementQuery(context, 'class-members', { classId, state: 'ENDED' })).toThrow();
  expect(() => managementQuery(context, 'assignments', { offering, state: 'INACTIVE' })).toThrow();
});
it('binds owner candidates to exact create/edit purpose and course without broadening teacher contexts', () => {
  const courseId = v7(),
    target = v7(),
    input = { purpose: 'EDIT_COURSE', courseId, q: target.toUpperCase(), limit: '10' };
  const parsed = managementQuery(context, 'owner-candidates', input),
    cursor = managementCursor(context, parsed, v7());
  expect(parsed).toMatchObject({
    purpose: 'EDIT_COURSE',
    courseId,
    q: target,
    state: 'CURRENT',
    limit: 10,
  });
  expect(managementQuery(context, 'owner-candidates', { ...input, cursor }).after).not.toBeNull();
  for (const change of [
    { courseId: v7() },
    { q: '' },
    { limit: '50' },
    { purpose: 'CREATE_COURSE' },
  ])
    expect(() =>
      managementQuery(context, 'owner-candidates', { ...input, cursor, ...change }),
    ).toThrow();
  for (const actor of [
    { ...context, actorMembershipId: v7() },
    { ...context, tenantId: v7() },
  ])
    expect(() => managementQuery(actor, 'owner-candidates', { ...input, cursor })).toThrow();
  for (const bad of [
    {},
    { purpose: 'CREATE_COURSE', courseId },
    { purpose: 'EDIT_COURSE' },
    { purpose: 'CREATE_COURSE', state: 'ALL' },
    { purpose: 'CREATE_COURSE', offering: v7() },
    { purpose: 'CREATE_COURSE', q: 'x'.repeat(121) },
  ] as Record<string, string>[])
    expect(() => managementQuery(context, 'owner-candidates', bad)).toThrow();
  expect(managementQuery(context, 'owner-candidates', { purpose: 'CREATE_COURSE' })).toMatchObject({
    courseId: null,
    purpose: 'CREATE_COURSE',
  });
  expect(() => managementQuery(context, 'teachers', { purpose: 'CREATE_COURSE' })).toThrow();
  expect(
    localRequestTarget(
      `/api/zhiban/management/${context.tenantId}/owner-candidates?purpose=CREATE_COURSE&q=%E8%AF%BE`,
    ),
  ).toBe(true);
});
it('validates audit event/UTC date ranges and binds history continuation without changing old query shapes', () => {
  const input = {
      event: 'EDIT_COURSE',
      from: '2026-10-10',
      through: '2026-10-10',
      limit: '10',
      q: '历史%_名称',
    },
    parsed = managementQuery(context, 'history', input),
    cursor = managementCursor(context, parsed, v7());
  expect(parsed).toMatchObject({
    event: 'EDIT_COURSE',
    from: Date.parse('2026-10-10T00:00:00Z'),
    through: Date.parse('2026-10-11T00:00:00Z'),
    state: 'ALL',
  });
  expect(managementQuery(context, 'history', { ...input, cursor }).after).not.toBeNull();
  for (const change of [
    { event: 'ALL' },
    { from: '2026-10-09' },
    { through: '2026-10-11' },
    { q: '其他' },
    { limit: '50' },
  ])
    expect(() => managementQuery(context, 'history', { ...input, cursor, ...change })).toThrow();
  for (const bad of [
    { event: 'LOGIN' },
    { from: '2026-02-30' },
    { from: '2026-2-01' },
    { from: '' },
    { through: '2026-01-00' },
    { from: '1969-12-31' },
    { from: '2026-10-11', through: '2026-10-10' },
    { state: 'ACTIVE' },
    { member: v7() },
  ] as Record<string, string>[])
    expect(() => managementQuery(context, 'history', bad)).toThrow();
  expect(managementQuery(context, 'history', {})).toMatchObject({
    event: 'ALL',
    from: null,
    through: null,
  });
  const old = managementQuery(context, 'courses', {});
  expect(old).not.toHaveProperty('event');
  expect(old).not.toHaveProperty('from');
  expect(() => managementQuery(context, 'courses', { event: 'CREATE_COURSE' })).toThrow();
  expect(localRequestTarget(`/api/zhiban/management/${context.tenantId}/history?q=%E5%8E%86`)).toBe(
    true,
  );
  expect(
    localRequestTarget(`/api/zhiban/management/${context.tenantId}/commands?q=%E5%8E%86`),
  ).toBe(false);
});
