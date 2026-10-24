import { verifyGradingQueue } from './verify-grading-queue';
/** Focused product journey on an owned disposable PG16 supplied by the local workspace harness. */
import assert from 'node:assert/strict';
import { v7 } from 'uuid';
import type { Pool } from 'pg';
import { expect, type Browser, type Page } from '@playwright/test';
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
  title: string;
  prompt: string;
  revision: string;
  draft: string | null;
  attempt_no: number;
  version: number;
  latest_attempt: boolean;
  latest_submission: boolean;
  current_version: number;
  membership_id: string;
  published_version: number;
  latest_attempt_no: number;
  has_active_attempt: boolean;
  status: string;
  answer: string;
  feedback: string;
};
type Data = {
  mode: string;
  rows: Row[];
  grades: Row[];
  nextCursor: string | null;
  id: string;
  revision: string;
  submissionId: string;
};
export async function verifyLearningRecords({
  gradingQueue = false,
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
}: {
  gradingQueue?: boolean;
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
}) {
  const base = `/api/zhiban/learning/${tenant}/offerings/${offering}`,
    gradeBase = `/api/zhiban/assessment/${tenant}/offerings/${offering}`;
  async function ok(path: string, actor = student, payload?: unknown, key?: string): Promise<Data> {
    const r = await http(path, actor, payload, undefined, key ? { 'x-zhiban-command': key } : {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Data;
  }
  const draft = {
    type: 'CREATE_ACTIVITY',
    title: '实训分页作业',
    prompt: '冻结版本要求',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 621,
  };
  const main = await ok(base, teacher, draft);
  await ok(base, teacher, { type: 'PUBLISH_ACTIVITY', id: main.id, revision: main.revision });
  const ids = Array.from({ length: 620 }, () => v7());
  await admin.query(
    `INSERT INTO zhiban_learning.activities(tenant_id,id,offering_id,title,prompt,deadline_at,allow_resubmit,max_attempts,status,published_version,created_at,updated_at)
    SELECT $1,id,$2,'分页活动'||lpad((n-1)::text,4,'0'),'已发布要求',NULL,true,NULL,'PUBLISHED',1,$4,$4 FROM unnest($3::uuid[]) WITH ORDINALITY AS x(id,n)`,
    [tenant, offering, ids, now],
  );
  await admin.query(
    `INSERT INTO zhiban_learning.activity_versions SELECT tenant_id,id,1,offering_id,title,prompt,deadline_at,allow_resubmit,max_attempts,$2 FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=ANY($3::uuid[])`,
    [tenant, now, ids],
  );
  const hidden = await ok(base, teacher, { ...draft, title: '禁止学生看见的未发布草稿' });
  const enrollment = (
    await admin.query(
      'SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [tenant, offering, student.member],
    )
  ).rows[0].id;
  const attempts = Array.from({ length: 620 }, () => v7());
  await admin.query(
    `INSERT INTO zhiban_learning.attempts(tenant_id,id,offering_id,activity_id,activity_version,enrollment_id,membership_id,attempt_no,status,draft,started_at,updated_at)
    SELECT $1,id,$2,$3,1,$4,$5,n,'SUBMITTED',CASE WHEN n=620 THEN '未提交私密草稿' ELSE '' END,$7,$7 FROM unnest($6::uuid[]) WITH ORDINALITY AS x(id,n)`,
    [tenant, offering, main.id, enrollment, student.member, attempts, now],
  );
  const extraEnrollment = (
      await admin.query(
        'SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
        [tenant, offering, extra.member],
      )
    ).rows[0].id,
    otherAttempt = v7();
  await admin.query(
    "INSERT INTO zhiban_learning.attempts VALUES($1,$2,$3,$4,1,$5,$6,1,'IN_PROGRESS','其他学生私密草稿',1,$7,$7)",
    [tenant, otherAttempt, offering, main.id, extraEnrollment, extra.member, now],
  );
  const submissions = Array.from({ length: 620 }, () => v7()),
    lastAttempt = attempts.at(-1)!,
    lastSubmission = submissions.at(-1)!;
  await admin.query(
    `INSERT INTO zhiban_learning.submissions SELECT $1,id,$2,n,'正式提交版本'||n,$4 FROM unnest($3::uuid[]) WITH ORDINALITY AS x(id,n)`,
    [tenant, lastAttempt, submissions, now],
  );
  const oldSubmission = v7();
  await admin.query(
    "INSERT INTO zhiban_learning.submissions VALUES($1,$2,$3,1,'旧尝试正式作答',$4)",
    [tenant, oldSubmission, attempts[0], now],
  );
  const grade = v7(),
    publications = Array.from({ length: 620 }, () => v7());
  await admin.query(
    "INSERT INTO zhiban_assessment.grades VALUES($1,$2,$3,8000,10000,'当前反馈',620,1,$4,$5,$5)",
    [tenant, grade, lastSubmission, teacher.member, now],
  );
  await admin.query(
    `INSERT INTO zhiban_assessment.publications SELECT $1,id,$2,$3,n,8000,10000,'公开反馈'||n,CASE WHEN n=1 THEN NULL ELSE '公开更正'||n END,$4,$6 FROM unnest($5::uuid[]) WITH ORDINALITY AS x(id,n)`,
    [tenant, grade, lastSubmission, teacher.member, publications, now],
  );
  assert.equal((await http(base, teacher)).status, 503);
  assert.equal((await http(base, student)).status, 503);
  assert.equal((await http(gradeBase, student)).status, 503);
  record(
    '621 published activities, 620 own attempts/submission versions/grade publications exceed legacy caps while owned PG16 remains isolated',
  );
  if (gradingQueue) {
    await verifyGradingQueue({
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
      activityId: main.id,
      attempts,
      otherAttempt,
      activities: ids,
      lastSubmission,
    });
    return;
  }
  async function scan(path: string, actor: Actor) {
    let cursor: string | null = null;
    const rows: Row[] = [];
    do {
      const data = await ok(
        path +
          (path.includes('?') ? '&' : '?') +
          new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) }),
        actor,
      );
      assert.ok(data.rows.length <= 50);
      rows.push(...data.rows);
      cursor = data.nextCursor;
    } while (cursor);
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
    return rows;
  }
  assert.equal((await scan(base + '/activities', teacher)).length, 622);
  const studentActivities = await scan(base + '/activities', student);
  assert.equal(studentActivities.length, 621);
  assert.ok(!studentActivities.some((r) => r.id === hidden.id));
  assert.equal((await scan(base + `/attempts?activity=${main.id}`, teacher)).length, 621);
  const own = await scan(base + `/attempts?activity=${main.id}`, student);
  assert.equal(own.length, 620);
  assert.ok(own.every((r) => r.membership_id === student.member));
  assert.equal(own.filter((r) => r.latest_attempt).length, 1);
  assert.equal((await scan(base + `/submissions?attempt=${lastAttempt}`, student)).length, 620);
  const history = await scan(gradeBase + `/publications?submission=${lastSubmission}`, student);
  assert.equal(history.length, 620);
  assert.ok(history.every((r) => r.current_version === 620));
  assert.ok(
    (await scan(base + `/attempts?activity=${main.id}`, teacher)).every((r) => r.draft === null),
  );
  record(
    'all four page types traverse >500 records completely without duplicate IDs; student isolation, teacher draft redaction and global latest flags hold across pages',
  );
  const first = await ok(base + `/attempts?activity=${main.id}&limit=10`, student),
    cursor = first.nextCursor!;
  for (const [path, a, status] of [
    [base + '/activities', undefined, 401],
    [base + '/activities', outsider, 403],
    [base + '/activities', manager, 403],
    [base + '/activities', foreign, 403],
    [base + `/attempts?activity=${hidden.id}`, student, 404],
    [base + `/submissions?attempt=${otherAttempt}`, student, 404],
    [base + `/attempts?activity=${main.id}&member=${extra.member}`, student, 403],
    [base + `/attempts?activity=${main.id}&limit=10&cursor=${cursor}`, teacher, 400],
    [base + `/attempts?activity=${ids[0]}&limit=10&cursor=${cursor}`, student, 400],
    [
      base + `/attempts?activity=${main.id}&limit=10&state=SUBMITTED&cursor=${cursor}`,
      student,
      400,
    ],
    [base + '/activities?limit=501', student, 400],
    [base + '/activities?limit=10&limit=20', student, 400],
    [base + '/activities?mode=TEACHER', student, 400],
    [base + '/submissions', student, 400],
    [`/api/zhiban/learning/${tenant}/offerings/${otherOffering}/activities`, student, 403],
    [gradeBase + `/publications?submission=${v7()}`, student, 404],
  ] as const)
    assert.equal((await http(path, a)).status, status, path);
  assert.equal((await http(base + '/activities', teacher, {})).status, 405);
  assert.equal(
    (await ok(gradeBase + `/publications?submission=${lastSubmission}`, student)).grades.length,
    0,
  );
  record(
    'anonymous/admin/other tenant and student-owned targets fail closed; stale actor/target/filter cursors, duplicate/forged queries and writes to page endpoints are rejected',
  );
  const mainRow = (await ok(base + `/activities?q=${main.id}`, teacher)).rows[0];
  await ok(base, teacher, {
    type: 'EDIT_ACTIVITY',
    id: main.id,
    revision: mainRow.revision,
    ...Object.fromEntries(Object.entries(draft).filter(([k]) => k !== 'type')),
    title: '教师尚未发布的新要求',
  });
  const studentMain = (
    await ok(base + '/activities?q=' + encodeURIComponent('实训分页作业'), student)
  ).rows[0];
  assert.equal(studentMain.title, '实训分页作业');
  assert.equal(studentMain.latest_attempt_no, 620);
  assert.equal(
    (await ok(base + `/attempts?activity=${main.id}`, student)).rows.find(
      (r) => r.id === lastAttempt,
    )!.prompt,
    '冻结版本要求',
  );
  record(
    'activity searches use visible published versions and attempts keep their immutable prompt; attempt limits use complete server history rather than current page length',
  );
  async function open(actor: Actor) {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: actor.cookie!.split('=')[0],
        value: actor.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await context.newPage();
    return { context, page };
  }
  async function enter(page: Page) {
    await page.goto(origin + `/zhiban?space=${tenant}`);
    await page.locator('.workspace-courses>article .learning-section>summary').first().click();
    await expect(page.getByLabel('搜索活动', { exact: true })).toBeVisible();
  }
  async function searchMain(page: Page) {
    await page.getByLabel('搜索活动', { exact: true }).fill(main.id);
    await page.getByRole('button', { name: '查询活动', exact: true }).click();
    await expect(page.locator('.learning-activities-list>.learning-activity')).toHaveCount(1);
  }
  const studentUi = await open(student),
    page = studentUi.page,
    errors: string[] = [],
    paths: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => r.method() === 'GET' && paths.push(new URL(r.url()).pathname));
  await enter(page);
  await expect(page.locator('.learning-activities-list>.learning-activity')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页活动', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '活动分页' })).toContainText('第 2 页');
  await searchMain(page);
  await page.getByText('我的尝试', { exact: true }).click();
  await expect(page.locator('.learning-attempts-list>.learning-attempt')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页尝试', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '尝试分页' })).toContainText('第 2 页');
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/zhiban/identity/spaces') && r.status() === 200,
    ),
    page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))),
  ]);
  await expect(page.getByRole('navigation', { name: '尝试分页' })).toContainText('第 2 页');
  record(
    'passive session/space checks preserve an open learning view and its cursor instead of rebuilding the workspace',
  );

  assert.equal(await page.getByRole('button', { name: '提交新版本', exact: true }).count(), 0);
  await page.getByRole('button', { name: '上一页尝试', exact: true }).click();
  await expect(page.getByLabel('尝试 620 作答', { exact: true })).toBeEnabled();
  await page
    .locator('.learning-attempts-list>.learning-attempt')
    .first()
    .getByText('查看提交版本与成绩', { exact: true })
    .click();
  await expect(page.locator('.learning-submissions-list>.learning-submission')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页提交', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '提交分页' })).toContainText('第 2 页');
  assert.equal(
    await page
      .locator('.learning-submissions-list')
      .getByText(/最新提交/)
      .count(),
    0,
  );
  await page.getByRole('button', { name: '上一页提交', exact: true }).click();
  const latest = page.locator('.learning-submissions-list>.learning-submission').first();
  await expect(latest).toContainText('最新提交');
  await latest.getByText('人工评分与成绩', { exact: true }).click();
  await expect(latest.getByRole('button', { name: '下一页成绩历史', exact: true })).toBeEnabled();
  await latest.getByRole('button', { name: '下一页成绩历史', exact: true }).click();
  await expect(latest.getByRole('navigation', { name: '成绩历史分页' })).toContainText('第 2 页');
  await latest.getByRole('button', { name: '下一页成绩历史', exact: true }).click();
  await expect(latest.getByRole('navigation', { name: '成绩历史分页' })).toContainText('第 3 页');
  await latest.getByRole('button', { name: '上一页成绩历史', exact: true }).click();
  await expect(latest.getByRole('navigation', { name: '成绩历史分页' })).toContainText('第 2 页');
  assert.equal(await latest.getByText(/该提交当前成绩/).count(), 0);
  await expect(latest.getByText(/更正前成绩/).first()).toBeVisible();
  record(
    'student UI pages activities, own attempts, submission versions and grade corrections; older pages never gain latest-only editing or current-grade labels',
  );
  let droppedKey = '';
  await page.route(
    origin + base,
    async (route) => {
      droppedKey = route.request().headers()['x-zhiban-command'];
      assert.equal(
        (
          await http(base, student, route.request().postDataJSON(), 'POST', {
            'x-zhiban-command': droppedKey,
          })
        ).status,
        200,
      );
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByLabel('尝试 620 作答', { exact: true }).fill('分页后提交的新正式作答');
  await page.getByRole('button', { name: '提交新版本', exact: true }).click();
  await expect(page.getByRole('button', { name: '按原命令号重试', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一页活动', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '按原命令号重试', exact: true }).click();
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
          [tenant, droppedKey],
        )
      ).rows[0].n,
    ),
    1,
  );

  await expect(
    page.locator('.learning-submissions-list').getByText('分页后提交的新正式作答', { exact: true }),
  ).toBeVisible();
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT max(version) AS n FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
          [tenant, lastAttempt],
        )
      ).rows[0].n,
    ),
    621,
  );
  const replayKey = v7();
  const command = { type: 'START_ATTEMPT', id: main.id };
  const started = await ok(base, student, command, replayKey);
  assert.equal((await ok(base, student, command, replayKey)).id, started.id);
  await ok(base, student, {
    type: 'SUBMIT',
    id: started.id,
    revision: started.revision,
    answer: '第621次尝试',
  });
  assert.equal((await http(base, student, command)).status, 409);
  record(
    'student submit response loss replays one durable audit without duplicate versions; original-key start replay consumes one attempt, and the full 621-attempt limit remains enforced',
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
  await page.route(
    `**/api/zhiban/learning/${tenant}/offerings/${offering}/submissions?**`,
    async (route) => {
      const response = await http(base + `/submissions?attempt=${lastAttempt}&limit=20`, student);
      arrived();
      await held;
      try {
        await route.fulfill({
          status: response.status,
          contentType: 'application/json',
          body: JSON.stringify(response.json),
        });
      } catch {
        /* Removed components abort outstanding fetches. */
      } finally {
        complete();
      }
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '刷新活动', exact: true }).click();
  await seen;
  await page.getByLabel('搜索我的课程', { exact: true }).fill('不存在的教学班');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.workspace-courses>article')).toHaveCount(0);
  release();
  await finished;
  await expect(page.locator('.learning-submissions-list')).toHaveCount(0);
  record(
    'removing a course view while submission read is delayed destroys nested lists and prevents stale record backfill',
  );
  const teacherUi = await open(teacher),
    teacherPage = teacherUi.page;
  teacherPage.on('pageerror', (e) => errors.push(e.message));
  teacherPage.on('request', (r) => r.method() === 'GET' && paths.push(new URL(r.url()).pathname));
  await enter(teacherPage);
  await searchMain(teacherPage);
  await teacherPage.getByText('查看学生尝试', { exact: true }).click();
  await expect(teacherPage.locator('.learning-attempts-list>.learning-attempt')).toHaveCount(20);
  assert.equal(await teacherPage.getByText('未提交私密草稿', { exact: true }).count(), 0);
  await teacherPage
    .locator('.learning-attempts-list>.learning-attempt')
    .first()
    .locator(':scope > summary')
    .click();
  await teacherPage
    .locator('.learning-attempts-list>.learning-attempt')
    .first()
    .getByText('查看提交版本与成绩', { exact: true })
    .click();
  await expect(teacherPage.locator('.learning-submissions-list>.learning-submission')).toHaveCount(
    1,
  );
  await teacherPage
    .locator('.learning-submissions-list>.learning-submission')
    .first()
    .getByText('人工评分与成绩', { exact: true })
    .click();
  await teacherPage.getByLabel('满分', { exact: true }).fill('100');
  await teacherPage.getByLabel('得分', { exact: true }).fill('88');
  await teacherPage.getByLabel('评分反馈', { exact: true }).fill('分页评分反馈');
  await teacherPage.getByRole('button', { name: '保存评分草稿', exact: true }).click();
  await expect(teacherPage.getByRole('button', { name: '发布成绩', exact: true })).toBeVisible();
  await teacherPage.getByRole('button', { name: '发布成绩', exact: true }).click();
  await expect(teacherPage.getByText(/该提交当前成绩/)).toBeVisible();
  await teacherPage.getByLabel('得分', { exact: true }).fill('90');
  await teacherPage.getByLabel('公开更正说明', { exact: true }).fill('更正计分');
  await teacherPage.getByRole('button', { name: '发布更正', exact: true }).click();
  await expect(teacherPage.getByText('更正说明：更正计分', { exact: true })).toBeVisible();
  record(
    'teacher grades an exact paged submission, publishes and corrects it through the unchanged audited commands without aggregate snapshots',
  );
  assert.equal(
    paths.filter((p) => p === base || p === gradeBase).length,
    0,
    'paged UI must never issue aggregate learning/assessment GETs',
  );
  // POST uses the original command routes; only legacy GET reads are forbidden.
  await teacherPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(await teacherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  await teacherPage.screenshot({
    path: 'docs/v2/evidence/m6-learning-records-teacher-local.png',
    fullPage: true,
  });
  record('390px teacher UI has no horizontal overflow or script errors');
  // Fresh authorization is checked after state change, not cached by the cursor.
  await admin.query(
    "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=$4,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
    [tenant, offering, student.member, now + 1],
  );
  assert.equal((await http(base + '/activities', student)).status, 403);
  assert.equal(
    (await http(gradeBase + `/publications?submission=${lastSubmission}`, student)).status,
    403,
  );
  await admin.query(
    "UPDATE zhiban_academic.enrollments SET status='ACTIVE',valid_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
    [tenant, offering, student.member],
  );
  await admin.query(
    "UPDATE zhiban_academic.courses SET status='ARCHIVED' WHERE tenant_id=$1 AND id=$2",
    [tenant, course],
  );
  assert.equal((await http(base + '/activities', teacher)).status, 403);
  await admin.query(
    "UPDATE zhiban_academic.courses SET status='PUBLISHED' WHERE tenant_id=$1 AND id=$2",
    [tenant, course],
  );
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录智伴', exact: true })).toBeVisible();
  assert.equal((await http(base + '/activities', student)).status, 401);
  record(
    'withdrawal and course archive invalidate new reads, and logout clears learning views and rejects further page access',
  );
  await teacherUi.context.close();
  await studentUi.context.close();
}
