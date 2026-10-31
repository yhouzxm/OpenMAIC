import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import {
  workspaceQuery,
  workspaceCursor,
  WorkspaceService,
} from '@/lib/zhiban/application/workspace/service';
import type { AcademicContext, AcademicStore } from '@/lib/zhiban/application/academic/service';
import {
  localAdminPageAsset,
  localCoursePageAsset,
  localCoursePageTarget,
  localRequestTarget,
  localOrdinaryEntryAsset,
} from '@/scripts/zhiban-local/request-target';
const context = { tenantId: v7(), actorMembershipId: v7() } as AcademicContext;
it('validates bounded query, literal search and required roster target', () => {
  expect(workspaceQuery(context, 'courses', {})).toMatchObject({
    limit: 20,
    state: 'ALL',
    offering: null,
  });
  for (const input of [
    { limit: '500' },
    { limit: '01' },
    { state: 'ACTIVE' },
    { member: v7() },
    { q: 'x\ny' },
    { q: 'x'.repeat(121) },
  ] as Record<string, string>[])
    expect(() => workspaceQuery(context, 'courses', input)).toThrow();
  expect(() => workspaceQuery(context, 'roster', {})).toThrow();
  expect(() => workspaceQuery(context, 'roster', { offering: v7(), state: 'OPEN' })).toThrow();
  expect(workspaceQuery(context, 'courses', { q: '  课程%_  ' }).q).toBe('课程%_');
});
it('binds cursors to tenant, member, list, target and filters', () => {
  const offering = v7(),
    q = workspaceQuery(context, 'roster', { offering }),
    cursor = workspaceCursor(context, q, v7());
  expect(workspaceQuery(context, 'roster', { offering, cursor }).after).not.toBeNull();
  for (const input of [
    { offering: v7() },
    { limit: '10' },
    { q: '学生' },
    { cursor: cursor + '=' },
  ] as Record<string, string>[])
    expect(() => workspaceQuery(context, 'roster', { offering, cursor, ...input })).toThrow();
  expect(() =>
    workspaceQuery({ ...context, actorMembershipId: v7() }, 'roster', { offering, cursor }),
  ).toThrow();
  expect(() =>
    workspaceQuery({ ...context, tenantId: v7() }, 'roster', { offering, cursor }),
  ).toThrow();
  expect(() => workspaceQuery(context, 'courses', { cursor })).toThrow();
});
it('permits only the new encoded read queries and keeps legacy path restrictions', () => {
  for (const kind of ['courses', 'roster'])
    expect(
      localRequestTarget(`/api/zhiban/workspace/${context.tenantId}/${kind}?q=%E8%AF%BE`),
    ).toBe(true);
  for (const raw of [
    `/api/zhiban/workspace/${context.tenantId}%2f/courses`,
    `/api/zhiban/workspace/${context.tenantId}/commands?q=%31`,
    `/api/zhiban/identity/spaces?limit=%31`,
  ])
    expect(localRequestTarget(raw)).toBe(false);
});
it('routes an admin bootstrap without querying the legacy snapshot', async () => {
  const store = {
    run: async (_c: unknown, _cmd: unknown, work: Parameters<AcademicStore['run']>[2]) =>
      work(
        {
          tenantId: context.tenantId,
          membershipId: context.actorMembershipId,
          userId: v7(),
          now: 10,
          expiresAt: 100,
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
        {} as Parameters<Parameters<AcademicStore['run']>[2]>[1],
      ),
  } as AcademicStore;
  expect((await new WorkspaceService(store).read(context, 'courses', {})).mode).toBe('ADMIN');
});

it('projects navigation roles without accepting expired, future or malformed grants', async () => {
  const { workspaceRoles } = await import('@/lib/zhiban/application/workspace/service');
  const base = { tenantId: v7(), membershipId: v7(), userId: v7(), now: 10, expiresAt: 100 };
  const grant = (roleCode: string, scopeKind: string, scopeId: string | null = null) => ({
    roleCode,
    scopeKind,
    scopeId,
    validFrom: 0,
    validUntil: null as number | null,
  });
  expect(workspaceRoles({ ...base, grants: [] })).toEqual([]);
  expect(
    workspaceRoles({
      ...base,
      grants: [
        { ...grant('TEACHER', 'TENANT'), validUntil: 10 },
        { ...grant('STUDENT', 'SELF'), validFrom: 11 },
        grant('TENANT_ADMIN', 'CLASS', v7()),
        grant('TEACHER', 'CLASS'),
        grant('TEACHER', 'SELF'),
        grant('STUDENT', 'TENANT'),
      ],
    }),
  ).toEqual([]);
  expect(
    workspaceRoles({
      ...base,
      grants: [
        grant('TENANT_ADMIN', 'TENANT'),
        grant('TEACHER', 'COURSE', v7()),
        grant('STUDENT', 'SELF'),
      ],
    }),
  ).toEqual(['ADMIN', 'TEACHER', 'STUDENT']);
});

it('limits course HTML routes to known roles, UUID paths and implemented sections', () => {
  const id = v7();
  expect(localCoursePageTarget(`/zhiban/teacher/courses/${id}`)).toBe(true);
  expect(localCoursePageTarget(`/zhiban/teacher/courses/${id}/students`)).toBe(true);
  expect(localCoursePageTarget(`/zhiban/student/courses/${id}/coursework`)).toBe(true);
  for (const path of [
    `/zhiban/admin/courses/${id}`,
    `/zhiban/student/courses/${id}/students`,
    `/zhiban/teacher/courses/${id}/coursework`,
    `/zhiban/teacher/courses/${id}/../../management`,
    `/zhiban/teacher/courses/${id}%2fstudents`,
    `/zhiban/teacher/courses/${id}/students/extra`,
  ])
    expect(localCoursePageTarget(path)).toBe(false);
});

it('maps course business pages to their own HTML and preserves the content CSP boundary', () => {
  const id = v7();
  expect(localCoursePageAsset(`/zhiban/teacher/courses/${id}/resources`)).toBe('/zhiban/content');
  expect(localCoursePageAsset(`/zhiban/student/courses/${id}/resources`)).toBe('/zhiban/content');
  expect(localCoursePageAsset(`/zhiban/teacher/courses/${id}/grades`)).toBe('/zhiban/grading');
  expect(localCoursePageAsset(`/zhiban/student/courses/${id}/grades`)).toBe('/zhiban/progress');
  expect(localCoursePageAsset(`/zhiban/teacher/courses/${id}/analytics`)).toBe('/zhiban/analytics');
  expect(localCoursePageAsset(`/zhiban/teacher/courses/${id}/students`)).toBe('/zhiban');
  expect(localCoursePageAsset(`/zhiban/student/courses/${id}/analytics`)).toBeNull();
});

it('maps only implemented administrator compatibility routes', () => {
  expect(localAdminPageAsset('/zhiban/admin/academic')).toBe('/zhiban/management');
  expect(localAdminPageAsset('/zhiban/admin/students')).toBe('/zhiban/directory');
  expect(localAdminPageAsset('/zhiban/admin/import/registrations')).toBe('/zhiban/admin/import');
  for (const path of [
    '/zhiban/admin',
    '/zhiban/admin/users',
    '/zhiban/admin/academic/extra',
    '/zhiban/admin/%61cademic',
  ])
    expect(localAdminPageAsset(path)).toBeNull();
});

it('requires an exact teacher-list target and binds its cursor independently from student roster', () => {
  const offering = v7();
  expect(() => workspaceQuery(context, 'teachers', {})).toThrow();
  for (const input of [
    { offering, state: 'OPEN' },
    { offering, limit: '100' },
    { offering, member: v7() },
  ])
    expect(() =>
      workspaceQuery(context, 'teachers', Object.fromEntries(Object.entries(input))),
    ).toThrow();
  const q = workspaceQuery(context, 'teachers', { offering, q: ' 周 ', limit: '10' });
  expect(q.q).toBe('周');
  const cursor = workspaceCursor(context, q, v7());
  expect(
    workspaceQuery(context, 'teachers', { offering, q: '周', limit: '10', cursor }).after,
  ).not.toBeNull();
  for (const [kind, input] of [
    ['roster', { offering, q: '周', limit: '10', cursor }],
    ['teachers', { offering: v7(), q: '周', limit: '10', cursor }],
    ['teachers', { offering, q: '其他', limit: '10', cursor }],
  ] as const)
    expect(() => workspaceQuery(context, kind, input)).toThrow();
  expect(() =>
    workspaceQuery({ ...context, actorMembershipId: v7() }, 'teachers', {
      offering,
      q: '周',
      limit: '10',
      cursor,
    }),
  ).toThrow();
});

it('keeps ordinary deep-entry routing closed to other roles, extra segments and encoded paths', () => {
  const id = v7();
  expect(localOrdinaryEntryAsset('/zhiban/teacher/courses')).toBe('/zhiban/global-authoring');
  expect(localOrdinaryEntryAsset(`/zhiban/student/classroom/${id}`)).toBe('/zhiban/global-tools');
  expect(localOrdinaryEntryAsset(`/zhiban/student/courses/${id}/activities/${id}`)).toBe(
    '/zhiban/global-tools',
  );
  for (const path of [
    `/zhiban/teacher/classroom/${id}`,
    `/zhiban/teacher/courses/${id}/activities/${id}`,
    `/zhiban/student/classroom/${id}/extra`,
    `/zhiban/student/classroom/%30${id.slice(1)}`,
    '/zhiban/teacher/courses/extra',
  ])
    expect(localOrdinaryEntryAsset(path)).toBeNull();
});
