/** Teacher queue journey reuses only the owned PG16 bootstrap and immutable-record seed. */
import assert from 'node:assert/strict';
import { v7 } from 'uuid';
import type { Pool } from 'pg';
import { expect, type Browser } from '@playwright/test';
type Actor = {
  uid: string;
  password: string;
  member: string;
  grant: string;
  tenant: string;
  cookie?: string;
  csrf?: string;
};
type Http = (
  path: string,
  actor?: Actor,
  payload?: unknown,
  method?: string,
  extra?: Record<string, string>,
) => Promise<{ status: number; json: unknown }>;
type Row = {
  id: string;
  grading_state: string;
  activity_title: string;
  membership_id: string;
  published_version: number;
  revision: string;
  title: string;
  latest_submission: boolean;
};
type Data = { rows: Row[]; nextCursor: string | null; review: Row; grades: Row[] };
export async function verifyGradingQueue({
  admin,
  http,
  teacher,
  student,
  outsider,
  foreign,
  manager,
  extra,
  tenant,
  offering,
  otherOffering,
  course,
  now,
  origin,
  browser,
  record,
  activityId,
  attempts,
  otherAttempt,
  activities,
  lastSubmission,
}: {
  admin: Pool;
  http: Http;
  teacher: Actor;
  student: Actor;
  outsider: Actor;
  foreign: Actor;
  manager: Actor;
  extra: Actor;
  tenant: string;
  offering: string;
  otherOffering: string;
  course: string;
  now: number;
  origin: string;
  browser: Browser;
  record: (s: string) => void;
  activityId: string;
  attempts: string[];
  otherAttempt: string;
  activities: string[];
  lastSubmission: string;
}) {
  const base = `/api/zhiban/assessment/${tenant}/offerings/${offering}`,
    queue = base + '/queue',
    learning = `/api/zhiban/learning/${tenant}/offerings/${offering}`;
  async function ok(path: string, actor = teacher, payload?: unknown) {
    const r = await http(path, actor, payload);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Data;
  }
  const submissionIds = attempts.slice(1, -1).map(() => v7());
  await admin.query(
    `INSERT INTO zhiban_learning.submissions SELECT $1,id,attempt,1,'已提交答卷',$4 FROM unnest($2::uuid[],$3::uuid[]) AS x(id,attempt)`,
    [tenant, submissionIds, attempts.slice(1, -1), now],
  );
  const gradeIds = Array.from({ length: 10 }, () => v7());
  await admin.query(
    `INSERT INTO zhiban_assessment.grades SELECT $1,id,submission,7000,10000,'原评分反馈',CASE WHEN n<=5 THEN 0 ELSE 1 END,1,$4,$5,$5 FROM unnest($2::uuid[],$3::uuid[]) WITH ORDINALITY AS x(id,submission,n)`,
    [tenant, gradeIds, submissionIds.slice(1, 11), teacher.member, now],
  );
  await admin.query(
    `INSERT INTO zhiban_assessment.publications SELECT $1,id,grade,submission,1,7000,10000,'原评分反馈',NULL,$5,$6 FROM unnest($2::uuid[],$3::uuid[],$4::uuid[]) AS x(id,grade,submission)`,
    [
      tenant,
      gradeIds.slice(5).map(() => v7()),
      gradeIds.slice(5),
      submissionIds.slice(6, 11),
      teacher.member,
      now,
    ],
  );
  const extraSubmission = v7();
  await admin.query(
    "INSERT INTO zhiban_learning.submissions VALUES($1,$2,$3,1,'另一位学生正式答卷',$4)",
    [tenant, extraSubmission, otherAttempt, now],
  );
  await admin.query(
    "UPDATE zhiban_learning.attempts SET status='SUBMITTED' WHERE tenant_id=$1 AND id=$2",
    [tenant, otherAttempt],
  );
  const enrollment = (
    await admin.query(
      'SELECT enrollment_id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2',
      [tenant, attempts[0]],
    )
  ).rows[0].enrollment_id;
  const otherActivityAttempt = v7(),
    otherActivitySubmission = v7();
  await admin.query(
    "INSERT INTO zhiban_learning.attempts VALUES($1,$2,$3,$4,1,$5,$6,1,'SUBMITTED','',1,$7,$7)",
    [tenant, otherActivityAttempt, offering, activities[0], enrollment, student.member, now],
  );
  await admin.query(
    "INSERT INTO zhiban_learning.submissions VALUES($1,$2,$3,1,'其他活动正式答卷',$4)",
    [tenant, otherActivitySubmission, otherActivityAttempt, now],
  );
  const emptyAttempt = v7();
  await admin.query(
    "INSERT INTO zhiban_learning.attempts VALUES($1,$2,$3,$4,1,$5,$6,1,'IN_PROGRESS','不应出现在队列的私密草稿',1,$7,$7)",
    [tenant, emptyAttempt, offering, activities[1], enrollment, student.member, now],
  );
  async function scan(params: Record<string, string> = {}) {
    let cursor: string | null = null;
    const all: Row[] = [];
    do {
      const d = await ok(
        queue +
          '?' +
          new URLSearchParams({ ...params, limit: '50', ...(cursor ? { cursor } : {}) }),
      );
      assert.ok(d.rows.length <= 50);
      all.push(...d.rows);
      cursor = d.nextCursor;
    } while (cursor);
    assert.equal(new Set(all.map((r) => r.id)).size, all.length);
    return all;
  }
  assert.equal((await scan()).length, 616);
  assert.equal((await scan({ state: 'ALL' })).length, 622);
  assert.equal((await scan({ state: 'UNSCORED' })).length, 611);
  assert.equal((await scan({ state: 'DRAFT' })).length, 5);
  assert.equal((await scan({ state: 'PUBLISHED' })).length, 6);
  const initial = await ok(queue);
  assert.equal(initial.rows.length, 20);
  assert.ok(initial.nextCursor);
  assert.ok(initial.rows.every((r) => !('answer' in r) && !('draft' in r) && !('feedback' in r)));
  record(
    '622 latest formal submissions and >500 actionable rows page completely; default TODO, unscored, draft and published partitions are exact, and list DTOs exclude answer/draft/feedback',
  );
  assert.equal((await scan({ state: 'ALL', q: '陈晓' })).length, 621);
  assert.equal((await scan({ q: '李明' })).length, 1);
  assert.equal((await scan({ q: extra.member })).length, 1);
  assert.equal((await scan({ activity: activities[0] })).length, 1);
  assert.equal((await scan({ member: extra.member })).length, 1);
  const current = (await ok(learning + '/activities?q=' + activityId)).rows[0];
  await ok(learning, teacher, {
    type: 'EDIT_ACTIVITY',
    id: activityId,
    revision: current.revision,
    title: '未发布的教师草稿标题',
    prompt: '不公开的新草稿要求',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 621,
  });
  assert.equal((await scan({ q: '未发布的教师草稿标题' })).length, 0);
  assert.equal((await scan({ q: '实训分页作业', state: 'ALL' })).length, 621);
  assert.equal(
    (await ok(base + `/publications?submission=${lastSubmission}`)).review.title,
    '实训分页作业',
  );
  record(
    'activity/member/student-name filters use exact offering scope and immutable attempt-version titles, including after teacher edits an unpublished draft',
  );
  const first = await ok(queue + '?limit=10');
  for (const [path, a, status] of [
    [queue, undefined, 401],
    [queue, student, 403],
    [queue, outsider, 403],
    [queue, manager, 403],
    [queue, foreign, 403],
    [`/api/zhiban/assessment/${tenant}/offerings/${otherOffering}/queue`, teacher, 403],
    [queue + '?mode=TEACHER', teacher, 400],
    [queue + '?limit=501', teacher, 400],
    [queue + '?limit=10&limit=20', teacher, 400],
    [queue + '?activity=all', teacher, 400],
    [queue + `?limit=10&state=ALL&cursor=${first.nextCursor}`, teacher, 400],
    [queue + `?limit=10&activity=${activities[0]}&cursor=${first.nextCursor}`, teacher, 400],
  ] as const)
    assert.equal((await http(path, a)).status, status, path);
  assert.equal((await http(queue, teacher, {})).status, 405);
  assert.ok(
    !('review' in (await ok(base + `/publications?submission=${lastSubmission}`, student))),
  );
  record(
    'anonymous, student, admin, cross-tenant and unassigned-teacher reads reject; forged/duplicate/unbounded filters, stale cursors and POST to queue reject; student detail never receives teacher review DTO',
  );
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: teacher.cookie!.split('=')[0],
      value: teacher.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage(),
    errors: string[] = [],
    reads: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.method() === 'GET') reads.push(new URL(r.url()).pathname);
  });
  await page.goto(origin + `/zhiban?space=${tenant}`);
  await page.getByRole('link', { name: '待评分与成绩', exact: true }).first().click();
  await expect(page.locator('.grading-rows>article')).toHaveCount(20);
  await page.route(
    `**/api/zhiban/assessment/${tenant}/offerings/${offering}/queue?**`,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: '刷新评分名单', exact: true }).click();
  await expect(page.locator('.grading-rows')).toHaveCount(0);
  await page.getByRole('button', { name: '重新读取评分名单', exact: true }).click();
  await expect(page.locator('.grading-rows>article')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页评分', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '评分名单分页' })).toContainText('第 2 页');
  await page.getByLabel('评分每页条数', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: '查询评分', exact: true }).click();
  await expect(page.locator('.grading-rows>article')).toHaveCount(10);
  await expect(page.getByRole('navigation', { name: '评分名单分页' })).toContainText('第 1 页');
  await page.getByText('按活动筛选', { exact: true }).click();
  await expect(page.getByRole('button', { name: '下一页活动选项', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '下一页活动选项', exact: true }).click();
  await expect(page.getByText('活动选项第 2 页', { exact: true })).toBeVisible();
  await page.getByLabel('搜索筛选活动', { exact: true }).fill(activities[0]);
  await page.getByRole('button', { name: '查询筛选活动', exact: true }).click();
  await page.getByRole('button', { name: '选择活动 分页活动0000', exact: true }).click();
  await expect(page.locator('.grading-rows>article')).toHaveCount(1);
  await expect(page.getByText('已选活动：分页活动0000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除活动筛选', exact: true }).click();
  await expect(page.locator('.grading-rows>article')).toHaveCount(10);
  await page.getByLabel('搜索学生或活动', { exact: true }).fill('李明');
  await page.getByRole('button', { name: '查询评分', exact: true }).click();
  await expect(page.locator('.grading-rows>article')).toHaveCount(1);
  record(
    'teacher workspace links directly to the paged queue; page size/search reset, multi-page activity picker and clear-selection work without aggregate snapshots',
  );
  await page.getByRole('button', { name: '打开评分', exact: true }).click();
  await expect(page.getByLabel('满分', { exact: true })).toBeVisible();
  await expect(page.getByText('另一位学生正式答卷', { exact: true })).toBeVisible();
  assert.equal(await page.getByText('其他学生私密草稿', { exact: true }).count(), 0);
  await page.getByLabel('满分', { exact: true }).fill('100');
  await page.getByLabel('得分', { exact: true }).fill('85');
  await page.getByLabel('评分反馈', { exact: true }).fill('评分工作台反馈');
  await page.getByRole('button', { name: '保存评分草稿', exact: true }).click();
  await expect(page.locator('.grading-rows>article')).toContainText('评分草稿待发布');
  await expect(page.getByRole('button', { name: '发布成绩', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '发布成绩', exact: true }).click();
  await expect(page.getByText('暂无匹配的正式提交。', { exact: true })).toBeVisible();
  await expect(page.getByText(/该提交当前成绩/)).toBeVisible();
  await page.getByLabel('评分状态', { exact: true }).selectOption('PUBLISHED');
  await page.getByRole('button', { name: '查询评分', exact: true }).click();
  await page.getByRole('button', { name: '查看成绩／更正', exact: true }).click();
  await expect(page.getByLabel('公开更正说明', { exact: true })).toBeVisible();
  await page.getByLabel('得分', { exact: true }).fill('90');
  await page.getByLabel('公开更正说明', { exact: true }).fill('核对后更正');
  let lostKey = '';
  await page.route(
    origin + base,
    async (route) => {
      lostKey = route.request().headers()['x-zhiban-command'];
      assert.equal(
        (
          await http(base, teacher, route.request().postDataJSON(), 'POST', {
            'x-zhiban-command': lostKey,
          })
        ).status,
        200,
      );
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '发布更正', exact: true }).click();
  await expect(page.getByRole('button', { name: '按原命令号重试', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '按原命令号重试', exact: true }).click();
  await expect(page.getByText('更正说明：核对后更正', { exact: true })).toBeVisible();
  await expect(page.locator('.grading-rows>article')).toContainText('成绩版本 2');
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=$2',
          [tenant, extraSubmission],
        )
      ).rows[0].n,
    ),
    2,
  );
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
          [tenant, lostKey],
        )
      ).rows[0].n,
    ),
    1,
  );
  record(
    'exact submission review saves draft, leaves TODO after publish, and corrects published score; lost correction response retries original key with one audit/publication',
  );
  const obsolete = submissionIds[0],
    newer = v7();
  await admin.query("INSERT INTO zhiban_learning.submissions VALUES($1,$2,$3,2,'学生新重交',$4)", [
    tenant,
    newer,
    attempts[1],
    now,
  ]);
  const latestRows = await scan({ state: 'ALL' });
  assert.ok(!latestRows.some((r) => r.id === obsolete));
  assert.ok(latestRows.some((r) => r.id === newer));
  assert.equal(
    (await ok(base + `/publications?submission=${obsolete}`)).review.latest_submission,
    false,
  );
  assert.equal(
    (
      await http(base, teacher, {
        type: 'SAVE_GRADE',
        submissionId: obsolete,
        revision: null,
        score: '80',
        maxScore: '100',
        feedback: '',
      })
    ).status,
    409,
  );
  record(
    'student resubmission removes superseded work from queue, exact detail recomputes latest status, and original write guard refuses grading an obsolete unpublished submission',
  );
  let arrived!: () => void, release!: () => void, complete!: () => void;
  const seen = new Promise<void>((done) => {
      arrived = done;
    }),
    held = new Promise<void>((done) => {
      release = done;
    }),
    finished = new Promise<void>((done) => {
      complete = done;
    });
  await page.getByRole('button', { name: '关闭评分', exact: true }).click();
  await page.route(
    `**/api/zhiban/assessment/${tenant}/offerings/${offering}/publications?**`,
    async (route) => {
      const response = await http(base + `/publications?submission=${extraSubmission}`, teacher);
      arrived();
      await held;
      try {
        await route.fulfill({
          status: response.status,
          contentType: 'application/json',
          body: JSON.stringify(response.json),
        });
      } catch {
        /* Selection cleanup aborts obsolete reads. */
      } finally {
        complete();
      }
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '查看成绩／更正', exact: true }).click();
  await seen;
  await page.getByRole('button', { name: '关闭评分', exact: true }).click();
  release();
  await finished;
  await expect(page.locator('#grading-editor')).toBeEmpty();
  record(
    'closing a selected review while its detail read is delayed aborts/discards stale editor content',
  );
  const studentContext = await browser.newContext();
  await studentContext.addCookies([
    {
      name: student.cookie!.split('=')[0],
      value: student.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const studentPage = await studentContext.newPage();
  studentPage.on('pageerror', (e) => errors.push(e.message));
  await studentPage.goto(origin + `/zhiban?space=${tenant}`);
  await expect(studentPage.locator('.workspace-courses>article').first()).toBeVisible();
  assert.equal(
    await studentPage.getByRole('link', { name: '待评分与成绩', exact: true }).count(),
    0,
  );
  await studentPage.locator('.learning-section>summary').first().click();
  await studentPage.getByLabel('搜索活动', { exact: true }).fill(activityId);
  await studentPage.getByRole('button', { name: '查询活动', exact: true }).click();
  await expect(studentPage.locator('.learning-activities-list>.learning-activity')).toHaveCount(1);
  await studentPage.getByText('我的尝试', { exact: true }).click();
  await expect(studentPage.locator('.learning-attempts-list>.learning-attempt')).toHaveCount(20);
  await studentPage
    .locator('.learning-attempts-list>.learning-attempt')
    .first()
    .getByText('查看提交版本与成绩', { exact: true })
    .click();
  await expect(studentPage.locator('.learning-submissions-list>.learning-submission')).toHaveCount(
    20,
  );
  await studentPage
    .locator('.learning-submissions-list>.learning-submission')
    .first()
    .getByText('人工评分与成绩', { exact: true })
    .click();
  await expect(
    studentPage.getByRole('button', { name: '下一页成绩历史', exact: true }),
  ).toBeEnabled();
  await studentPage.getByRole('button', { name: '下一页成绩历史', exact: true }).click();
  await expect(studentPage.getByRole('navigation', { name: '成绩历史分页' })).toContainText(
    '第 2 页',
  );
  assert.equal(await studentPage.getByLabel('得分', { exact: true }).count(), 0);
  await studentPage.goto(origin + `/zhiban/grading?tenant=${tenant}&offering=${offering}`);
  await expect(studentPage.getByText('当前任教或教师授权已失效。', { exact: true })).toBeVisible();
  await expect(studentPage.locator('.grading-rows')).toHaveCount(0);
  await studentContext.close();
  record(
    'shared assessment renderer still pages student-owned published history without draft controls; student workbench hides queue entry and direct page access refuses',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  assert.equal(reads.filter((p) => p === base || p === learning).length, 0);
  await page.screenshot({
    path: 'docs/v2/evidence/m6-grading-queue-mobile-local.png',
    fullPage: true,
  });
  record(
    '390px queue has no horizontal overflow/script errors and issues no aggregate learning or assessment GET',
  );
  await admin.query(
    "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$4,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
    [tenant, offering, teacher.member, now + 1],
  );
  assert.equal((await http(queue, teacher)).status, 403);
  await page.getByRole('button', { name: '刷新评分名单', exact: true }).click();
  await expect(page.locator('.grading-rows')).toHaveCount(0);
  await expect(page.getByText('当前任教或教师授权已失效。', { exact: true })).toBeVisible();
  assert.equal(
    (await http(base + `/publications?submission=${extraSubmission}`, teacher)).status,
    403,
  );
  await admin.query(
    "UPDATE zhiban_academic.assignments SET status='ACTIVE',valid_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
    [tenant, offering, teacher.member],
  );
  await admin.query(
    "UPDATE zhiban_academic.courses SET status='ARCHIVED' WHERE tenant_id=$1 AND id=$2",
    [tenant, course],
  );
  assert.equal((await http(queue, teacher)).status, 403);
  await admin.query(
    "UPDATE zhiban_academic.courses SET status='PUBLISHED' WHERE tenant_id=$1 AND id=$2",
    [tenant, course],
  );
  await page.getByRole('button', { name: '重新读取评分名单', exact: true }).click();
  await expect(page.locator('.grading-rows>article')).toHaveCount(1);
  const peer = await context.newPage();
  await peer.goto(origin + `/zhiban?space=${tenant}`);
  await peer.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(peer.getByRole('heading', { name: '登录智伴', exact: true })).toBeVisible();
  await expect(page.locator('.grading-rows')).toHaveCount(0);
  assert.equal((await http(queue, teacher)).status, 401);
  // The shared --serve delivery needs a current teacher session after this deliberate logout.
  const login = await http('/api/zhiban/identity/login', undefined, {
    userId: teacher.uid,
    password: teacher.password,
  });
  assert.equal(login.status, 200);
  record(
    'ending teaching assignment, archiving course and cross-tab logout invalidate queue/detail access and clear the live list',
  );
  await context.close();
}
