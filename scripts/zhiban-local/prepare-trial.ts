/** Compact synthetic teaching trial; uses the real commands after the owned-cluster bootstrap. */
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { expect, type Browser } from '@playwright/test';
import type { IdentityIds } from '../../lib/zhiban/infrastructure/identity/composition/ids';
type Actor = {
  uid: ReturnType<IdentityIds['nextUserId']>;
  password: string;
  member: string;
  grant: string;
  tenant: string;
  cookie?: string;
  csrf?: string;
};
type Http = (
  path: string,
  a?: Actor,
  payload?: unknown,
  method?: string,
  extra?: Record<string, string>,
) => Promise<{ status: number; json: unknown }>;
type Result = { id: string; revision: string; submissionId: string };
export async function prepareTrial(input: {
  admin: Pool;
  browser: Browser;
  actors: Actor[];
  http: Http;
  tenant: string;
  origin: string;
  record: (s: string) => void;
  contentEnabled?: boolean;
  verifyExistingTeaching?: boolean;
}) {
  const { admin, browser, actors, http, tenant: t, origin, record } = input;
  const [teacher, student, , , manager] = actors;
  for (const [a, name] of [
    [teacher, '周老师'],
    [student, '陈同学'],
    [manager, '王管理员'],
  ] as const)
    await admin.query(
      'INSERT INTO zhiban_academic.people VALUES($1,$2,$3) ON CONFLICT(tenant_id,membership_id) DO UPDATE SET display_name=excluded.display_name',
      [t, a.member, name],
    );
  const send = async (path: string, a: Actor, payload: unknown) => {
    const r = await http(path, a, payload);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const manage = (command: unknown) =>
    send(`/api/zhiban/management/${t}/commands`, manager, command);
  const find = async (table: 'courses' | 'terms' | 'classes' | 'offerings', code: string) =>
    (
      await admin.query(
        `SELECT id,revision::text FROM zhiban_academic.${table} WHERE tenant_id=$1 AND code=$2`,
        [t, code],
      )
    ).rows[0] as { id: string; revision: string };
  await manage({
    type: 'CREATE_COURSE',
    code: 'TRY_MECHA',
    name: '试用课程：机电入门',
    description: '本地合成教学数据，可自由练习；停止后删除，不用于真实教学。',
    ownerMembershipId: teacher.member,
  });
  const course = await find('courses', 'TRY_MECHA');
  await manage({ type: 'PUBLISH_COURSE', ...course });
  await manage({
    type: 'CREATE_TERM',
    code: 'TRY_TERM',
    name: '试用学期',
    startsOn: '2026-10-01',
    endsOn: '2027-01-31',
  });
  await manage({ type: 'CREATE_CLASS', code: 'TRY_CLASS', name: '试用行政班' });
  const term = await find('terms', 'TRY_TERM'),
    classInfo = await find('classes', 'TRY_CLASS');
  for (const a of [student, actors[5]])
    await manage({
      type: 'CLASS_MEMBER',
      classId: classInfo.id,
      membershipId: a.member,
      active: true,
      revision: null,
    });
  await manage({
    type: 'CREATE_OFFERING',
    code: 'TRY_01',
    name: '试用教学班',
    courseId: course.id,
    termId: term.id,
    classId: classInfo.id,
    capacity: 20,
  });
  const offering = await find('offerings', 'TRY_01');
  await manage({
    type: 'ASSIGN_TEACHER',
    offeringId: offering.id,
    membershipId: teacher.member,
    revision: null,
  });
  for (const a of [student, actors[5]])
    await manage({
      type: 'ENROLL',
      offeringId: offering.id,
      membershipId: a.member,
      revision: null,
    });
  record(
    'trial course/term/class/offering, owner, teacher assignment and two enrollments prepared through real guarded Academic commands',
  );
  const learning = `/api/zhiban/learning/${t}/offerings/${offering.id}`,
    assessment = `/api/zhiban/assessment/${t}/offerings/${offering.id}`;
  const titles = ['试用：安全巡检报告', '试用：待评分作业', '试用：已发布成绩', '试用：未发布草稿'];
  const activities: Result[] = [];
  for (const [i, title] of titles.entries()) {
    const activity = await send(learning, teacher, {
      type: 'CREATE_ACTIVITY',
      title,
      prompt: '请说明检查步骤、发现的问题与处理依据。仅用于本地试用。',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 3,
    });
    activities.push(activity);
    if (i !== 3)
      await send(learning, teacher, {
        type: 'PUBLISH_ACTIVITY',
        id: activity.id,
        revision: activity.revision,
      });
    if (i === 1 || i === 2) {
      const attempt = await send(learning, student, { type: 'START_ATTEMPT', id: activity.id });
      const submission = await send(learning, student, {
        type: 'SUBMIT',
        id: attempt.id,
        revision: attempt.revision,
        answer: '先断电并确认安全状态，按检查表逐项记录，异常需说明依据和复核。',
      });
      if (i === 2) {
        const grade = await send(assessment, teacher, {
          type: 'SAVE_GRADE',
          submissionId: submission.submissionId,
          revision: null,
          score: '88',
          maxScore: '100',
          feedback: '步骤完整，建议补充复核依据。此反馈已正式发布。',
        });
        await send(assessment, teacher, {
          type: 'PUBLISH_GRADE',
          submissionId: submission.submissionId,
          revision: grade.revision,
        });
      }
    }
  }
  record(
    'real teacher publication -> student attempts/submissions -> manual grading/publication leaves one unstarted activity, one TODO, one published grade and one teacher-only draft',
  );
  const urls = {
    workspace: origin + `/zhiban?space=${t}`,
    grading: origin + `/zhiban/grading?tenant=${t}&offering=${offering.id}#queue`,
    analytics: origin + `/zhiban/analytics?tenant=${t}&offering=${offering.id}`,
    progress: origin + `/zhiban/progress?tenant=${t}&offering=${offering.id}`,
    roster: origin + `/zhiban/roster?tenant=${t}&offering=${offering.id}`,
  };
  const result = {
    tenantId: t,
    offeringId: offering.id,
    courseId: course.id,
    urls,
    activityTitles: titles,
    importMembershipId: actors[6].member,
    accounts: [
      {
        role: 'ADMIN',
        label: '管理员 · 王管理员',
        userId: manager.uid,
        membershipId: manager.member,
        password: manager.password,
      },
      {
        role: 'TEACHER',
        label: '教师 · 周老师',
        userId: teacher.uid,
        membershipId: teacher.member,
        password: teacher.password,
      },
      {
        role: 'STUDENT',
        label: '学生 · 陈同学',
        userId: student.uid,
        membershipId: student.member,
        password: student.password,
      },
    ],
  };
  if (input.verifyExistingTeaching === false) return result;
  for (const [a, role] of [
    [manager, 'ADMIN'],
    [teacher, 'TEACHER'],
    [student, 'STUDENT'],
  ] as const) {
    const context = await browser.newContext(),
      page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(urls.workspace);
    await page.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(a.uid);
    await page.getByLabel('密码', { exact: true }).fill(a.password);
    await page.getByRole('button', { name: '登录并进入', exact: true }).click();
    if (role === 'ADMIN') {
      await expect(page.getByRole('heading', { name: '教务管理', exact: true })).toBeVisible();
      await page.goto(
        origin + `/zhiban/teacher/courses/${course.id}?space=${t}&offering=${offering.id}`,
      );
      await expect(page.getByText('当前课程不可访问，或课程关系已变化。')).toBeVisible();
      await page.goto(urls.workspace);
      await page.getByRole('button', { name: '操作历史', exact: true }).click();
      await expect(page.locator('.management-list > article')).toHaveCount(10);
      const adminNav = page.getByRole('navigation', { name: '管理员教务导航', exact: true });
      await adminNav.getByRole('link', { name: '课程', exact: true }).click();
      await expect(page.getByRole('table', { name: '课程列表', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '学期', exact: true }).click();
      await expect(page.getByRole('table', { name: '学期列表', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('table', { name: '学期列表', exact: true })).toBeVisible();
      await adminNav.getByRole('link', { name: '行政班', exact: true }).click();
      await page.getByRole('link', { name: '管理成员与班主任', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: '行政班成员与班主任', exact: true }),
      ).toBeVisible();
      await page.getByRole('link', { name: '返回分页教务管理', exact: true }).click();
      await expect(page.getByRole('table', { name: '行政班列表', exact: true })).toBeVisible();
      await adminNav.getByRole('link', { name: '教学班', exact: true }).click();
      await page.getByRole('button', { name: '管理学生名单', exact: true }).click();
      await page.getByRole('link', { name: '管理任教', exact: true }).click();
      await expect(page.getByRole('heading', { name: '任教关系管理', exact: true })).toBeVisible();
      await page.getByRole('link', { name: '返回分页教务管理', exact: true }).click();
      await expect(page.getByRole('button', { name: '返回教学班列表', exact: true })).toBeVisible();
      await page.getByRole('link', { name: '批量导入学生', exact: true }).click();
      await expect(page.getByText('批量导入学生名册', { exact: true })).toBeVisible();
      await expect(adminNav).toBeVisible();
      await page.getByRole('link', { name: '← 返回原名录', exact: true }).click();
      await expect(page.getByRole('button', { name: '返回教学班列表', exact: true })).toBeVisible();
      await adminNav.getByRole('link', { name: '学生目录', exact: true }).click();
      await expect(page.getByRole('heading', { name: '学生目录', exact: true })).toBeVisible();
      await expect(page.locator('.directory-table table')).toBeVisible();
    } else {
      const card = page
        .locator('.academic-card')
        .filter({ has: page.getByRole('heading', { name: '试用教学班', exact: true }) });
      await card.getByRole('link', { name: '进入课程工作区' }).click();
      await expect(
        page.getByRole('heading', { name: '试用课程：机电入门', exact: true }),
      ).toBeVisible();
      if (role === 'TEACHER') {
        await page.getByRole('link', { name: '课堂与互动', exact: true }).click();
      } else {
        await page.getByRole('link', { name: '学习活动', exact: true }).click();
      }
      await expect(page.getByText(titles[0], { exact: true })).toBeVisible();
      if (input.contentEnabled && role === 'TEACHER') {
        await page.getByRole('link', { name: '讲义与图片', exact: true }).click();
        await expect(page.getByRole('heading', { name: '教学内容', exact: true })).toBeVisible();
      } else if (input.contentEnabled) {
        await page.getByRole('link', { name: '课程资源', exact: true }).click();
        await expect(page.getByRole('heading', { name: '教学内容', exact: true })).toBeVisible();
      }
      await expect(page.getByRole('navigation', { name: '课程内导航' })).toBeVisible();
      await page
        .getByRole('link', { name: role === 'TEACHER' ? '学生成绩' : '学习成绩', exact: true })
        .click();
      if (role === 'TEACHER') {
        await page.getByRole('button', { name: '待评分列表', exact: true }).click();
        await expect(page.getByRole('button', { name: '打开评分', exact: true })).toHaveCount(1);
        await page.getByRole('button', { name: '打开评分', exact: true }).click();
        await page
          .getByRole('textbox', { name: '评分反馈', exact: true })
          .fill('尚未保存的课程内评分反馈');
        let cancelled = 0;
        page.once('dialog', async (dialog) => {
          cancelled++;
          await dialog.dismiss();
        });
        await page.getByRole('link', { name: '教学分析', exact: true }).click();
        await expect(page.getByRole('textbox', { name: '评分反馈', exact: true })).toHaveValue(
          '尚未保存的课程内评分反馈',
        );
        assert.equal(cancelled, 1);
        await page.getByRole('textbox', { name: '评分反馈', exact: true }).fill('');
        await page.getByRole('link', { name: '教学分析', exact: true }).click();
        await expect(page.locator('#analytics[aria-busy="false"]')).toBeVisible();
      } else {
        await expect(page.locator('#personal[aria-busy="false"]')).toBeVisible();
      }
      await expect(page.getByRole('navigation', { name: '课程内导航' })).toBeVisible();
      await page.getByRole('link', { name: '← 返回我的课程' }).click();
      await card.getByText('学习活动与提交', { exact: true }).click();
      await expect(card.getByText(titles[0], { exact: true })).toBeVisible();
      if (role === 'TEACHER') {
        await page.goto(
          origin + `/zhiban/student/courses/${course.id}?space=${t}&offering=${offering.id}`,
        );
        await expect(page.getByText('当前课程不可访问，或课程关系已变化。')).toBeVisible();
        await page.goto(urls.grading);
        await expect(page.getByRole('button', { name: '打开评分', exact: true })).toHaveCount(1);
        await page.goto(urls.analytics);
        await expect(page.locator('#analytics[aria-busy="false"]')).toBeVisible();
      } else {
        await page.goto(
          origin + `/zhiban/teacher/courses/${course.id}?space=${t}&offering=${offering.id}`,
        );
        await expect(page.getByText('当前课程不可访问，或课程关系已变化。')).toBeVisible();
        await page.goto(urls.workspace);
        await expect(card.getByText(titles[3], { exact: true })).toHaveCount(0);
        await page.goto(urls.progress);
        await expect(
          page
            .locator('.personal-activities')
            .getByText('教师反馈：步骤完整，建议补充复核依据。此反馈已正式发布。', { exact: true }),
        ).toBeVisible();
      }
    }
    if (role !== 'ADMIN') {
      await page.goto(origin + `/zhiban/admin/academic?tenant=${t}`);
      await expect(
        page.getByText('当前身份没有管理员教务权限，请返回工作台。', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('#management-content')).toHaveCount(0);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  record(
    'three real browser logins share one origin: admin history, teacher activities/queue/analytics, student activities/published feedback; no script errors',
  );
  assert.equal((await http(`/api/zhiban/management/${t}/history`, student)).status, 403);
  assert.equal((await http(assessment + '/queue', manager)).status, 403);
  assert.equal((await http(assessment + '/queue', student)).status, 403);
  for (const path of ['/api/zhiban/content/', '/api/zhiban/runtime/', '/api/zhiban/control/'])
    assert.equal((await http(path, manager)).status, 404);
  for (const path of ['/zhiban/grading', '/zhiban/grading.js', '/zhiban/content'])
    assert.equal((await http(path)).status, 200);
  record(
    input.contentEnabled
      ? 'student/admin cannot acquire teacher grading; malformed content routes and Runtime/control remain closed'
      : 'student/admin cannot acquire teacher grading; content/Runtime/control APIs stay CLOSED and their trial page explains the boundary',
  );
  return result;
}
