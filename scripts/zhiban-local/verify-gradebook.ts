/** Directed LOCAL gradebook journey; uses owned synthetic fixtures only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
export async function verifyGradebook(input: Input) {
  const { admin, browser, actors, http, tenant, origin, record, trial } = input;
  const [teacher, student, outsider, foreign, manager] = actors;
  const base = `/api/zhiban/assessment/${tenant}/offerings/${trial.offeringId}`;
  const learning = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const read = async (search = '', actor = teacher) => {
    const r = await http(base + '/gradebook' + search, actor);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as any;
  };
  const send = async (path: string, payload: unknown, actor = teacher) => {
    const r = await http(path, actor, payload);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as any;
  };
  for (const actor of [student, outsider, foreign, manager])
    assert.equal((await http(base + '/gradebook', actor)).status, 403);
  assert.equal((await http(base + '/gradebook')).status, 401);
  for (const s of ['?limit=100', '?activityLimit=50', '?cursor=garbage', '?q=x&q=y', '?state=ALL'])
    assert.equal((await http(base + '/gradebook' + s, teacher)).status, 400);
  const first = await read();
  assert.equal(first.rows.length, 2);
  assert.equal(first.activities.length, 3);
  const row = first.rows.find((r: any) => r.membership_id === student.member);
  assert.deepEqual(row.cells.map((c: any) => c.state).sort(), [
    'AWAITING_GRADE',
    'NOT_STARTED',
    'PUBLISHED',
  ]);
  assert.equal(row.cells.find((c: any) => c.state === 'PUBLISHED').score_points, 8800);
  assert.equal(JSON.stringify(first).includes('feedback'), false);
  assert.equal(JSON.stringify(first).includes('answer'), false);
  const published = row.cells.find((c: any) => c.state === 'PUBLISHED');
  const grade = (
    await admin.query(
      'SELECT revision::text FROM zhiban_assessment.grades WHERE submission_id=$1',
      [published.submission_id],
    )
  ).rows[0];
  await send(base, {
    type: 'CORRECT_GRADE',
    submissionId: published.submission_id,
    revision: grade.revision,
    score: '91',
    maxScore: '100',
    feedback: '成绩簿更正验证',
    reason: '更正合成试用评分',
  });
  const corrected = (await read()).rows
    .find((r: any) => r.membership_id === student.member)
    .cells.find((c: any) => c.activity_id === published.activity_id);
  assert.equal(corrected.score_points, 9100);
  assert.equal(corrected.grade_version, 2);
  const attempt = (
    await admin.query('SELECT revision::text FROM zhiban_learning.attempts WHERE id=$1', [
      published.attempt_id,
    ])
  ).rows[0];
  await send(
    learning,
    {
      type: 'SUBMIT',
      id: published.attempt_id,
      revision: attempt.revision,
      answer: '新提交不得继承旧成绩',
    },
    student,
  );
  const resubmitted = (await read()).rows
    .find((r: any) => r.membership_id === student.member)
    .cells.find((c: any) => c.activity_id === published.activity_id);
  assert.equal(resubmitted.state, 'AWAITING_GRADE');
  assert.equal(resubmitted.score_points, null);
  // New attempt cannot inherit a previous submission or publication.
  await send(learning, { type: 'START_ATTEMPT', id: published.activity_id }, student);
  const newer = (await read()).rows
    .find((r: any) => r.membership_id === student.member)
    .cells.find((c: any) => c.activity_id === published.activity_id);
  assert.equal(newer.attempt_no, 2);
  assert.equal(newer.state, 'IN_PROGRESS');
  assert.equal(newer.submission_id, null);
  const activity = (
    await admin.query('SELECT revision::text FROM zhiban_learning.activities WHERE id=$1', [
      published.activity_id,
    ])
  ).rows[0];
  await send(learning, {
    type: 'PUBLISH_ACTIVITY',
    id: published.activity_id,
    revision: activity.revision,
  });
  const republished = (await read()).rows
    .find((r: any) => r.membership_id === student.member)
    .cells.find((c: any) => c.activity_id === published.activity_id);
  assert.equal(republished.activity_version, 2);
  assert.equal(republished.state, 'NOT_STARTED');
  record(
    'gradebook current-version/latest-attempt/latest-submission/latest-publication projection excludes drafts/answers; correction, resubmit, new attempt and republication do not carry old grades',
  );
  // Exercise bounded student axis with existing valid synthetic Membership FKs, not fake Identity rows.
  const members = (
    await admin.query(
      'SELECT membership_id FROM zhiban_identity.memberships WHERE tenant_id=$1 LIMIT 14',
      [tenant],
    )
  ).rows;
  for (const m of members)
    await admin.query(
      `INSERT INTO zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id,status,valid_from,valid_until) VALUES($1,$2,$3,$4,'ACTIVE',0,NULL) ON CONFLICT DO NOTHING`,
      [tenant, randomUUID(), trial.offeringId, m.membership_id],
    );
  assert.ok(members.length > 10, 'fixture must contain enough Memberships');
  for (let i = 0; i < 4; i++) {
    const a = await send(learning, {
      type: 'CREATE_ACTIVITY',
      title: '成绩簿分页活动 ' + i,
      prompt: '本地分页验证',
      deadlineAt: null,
      allowResubmit: false,
      maxAttempts: 1,
    });
    await send(learning, { type: 'PUBLISH_ACTIVITY', ...a });
  }
  const page1 = await read('?limit=10');
  assert.equal(page1.rows.length, 10);
  assert.equal(page1.activities.length, 5);
  assert.ok(page1.nextCursor);
  assert.ok(page1.activityNextCursor);
  const page2 = await read('?limit=10&cursor=' + page1.nextCursor);
  assert.ok(page2.rows.length > 0);
  assert.ok(
    !page2.rows.some((r: any) => page1.rows.some((p: any) => p.membership_id === r.membership_id)),
  );
  const col2 = await read('?limit=10&activityCursor=' + page1.activityNextCursor);
  assert.equal(col2.activities.length, 2);
  assert.equal(
    (await http(base + '/gradebook?limit=20&cursor=' + page1.nextCursor, teacher)).status,
    400,
  );
  assert.equal(
    (await http(base + '/gradebook?limit=10&q=changed&cursor=' + page1.nextCursor, teacher)).status,
    400,
  );
  assert.equal(
    (await http(base + '/gradebook?limit=10&activityCursor=' + page1.nextCursor, teacher)).status,
    400,
  );
  const searched = await read('?q=' + encodeURIComponent('陈同学'));
  assert.equal(searched.rows.length, 1);
  // Temporarily withdraw the original member and prove it disappears, then restore fixture.
  await admin.query(
    "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=$3 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$4",
    [tenant, trial.offeringId, Date.now(), student.member],
  );
  assert.equal((await read('?q=' + student.member)).rows.length, 0);
  await admin.query(
    "UPDATE zhiban_academic.enrollments SET status='ACTIVE',valid_until=NULL WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
    [tenant, trial.offeringId, student.member],
  );
  // Leave the usable demo with the original two-student roster; pagination-only rows are fixtures.
  await admin.query(
    'DELETE FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND NOT (membership_id=ANY($3::uuid[]))',
    [tenant, trial.offeringId, first.rows.map((r: any) => r.membership_id)],
  );
  record(
    'gradebook two-axis keyset pagination, no duplicate rows, filter/axis cursor binding, Chinese search and withdrawn-member exclusion pass; teacher/student/admin/foreign refusals hold',
  );
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai' }),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/zhiban');
  await page.getByLabel('账号 ID', { exact: true }).fill(teacher.uid);
  await page.getByLabel('密码', { exact: true }).fill(teacher.password);
  await page.getByRole('button', { name: '登录并进入', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  await page.goto(trial.urls.grading.replace('#queue', ''));
  await expect(page.getByRole('heading', { name: '课程成绩簿', exact: true })).toBeVisible();
  await page.getByLabel('搜索成绩簿学生', { exact: true }).fill('陈同学');
  await page.getByRole('button', { name: '查询成绩簿', exact: true }).click();
  await expect(page.getByRole('rowheader')).toHaveCount(1);
  await page.getByRole('button', { name: '评分该提交', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: '评分反馈', exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: '满分', exact: true }).fill('100');
  await page.getByRole('spinbutton', { name: '得分', exact: true }).fill('93');
  await page.getByRole('textbox', { name: '评分反馈', exact: true }).fill('成绩簿精确提交评分验证');
  await page.getByRole('button', { name: '保存评分草稿', exact: true }).click();
  await page.getByRole('button', { name: '发布成绩', exact: true }).click();
  await expect(page.getByRole('heading', { name: /成绩版本 1（该提交当前成绩）/ })).toBeVisible();
  await page.getByRole('button', { name: '返回成绩簿', exact: true }).click();
  await expect(page.getByLabel('搜索成绩簿学生', { exact: true })).toHaveValue('陈同学');
  await page.getByRole('button', { name: '下一页活动', exact: true }).click();
  await expect(page.getByRole('columnheader')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: '课程成绩表', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'docs/v2/evidence/zhiban-gradebook-mobile-local.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'docs/v2/evidence/zhiban-gradebook-teacher-local.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await context.close();
  record(
    'gradebook real browser search, activity-column paging, exact submission review and return with filter retained, mobile table scrolling and desktop page pass without script errors',
  );
}
