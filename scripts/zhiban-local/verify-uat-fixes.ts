/** Focused owned-cluster checks for trial findings; never changes applied SQL/contracts. */
import assert from 'node:assert/strict';
import { expect, type Browser, type Locator } from '@playwright/test';
import type { Pool } from 'pg';
import { v7 } from 'uuid';
import type { prepareTrial } from './prepare-trial';
type Actor = Parameters<typeof prepareTrial>[0]['actors'][number];
type Http = Parameters<typeof prepareTrial>[0]['http'];
type Result = { id: string; revision: string; submissionId: string };
type MemberRow = {
  id: string;
  member_id: string | null;
  member_name: string | null;
  event_type: string;
  [key: string]: unknown;
};
export async function verifyUatFixes(input: {
  admin: Pool;
  browser: Browser;
  actors: Actor[];
  http: Http;
  tenant: string;
  otherTenant: string;
  origin: string;
  record: (s: string) => void;
  trial: Awaited<ReturnType<typeof prepareTrial>>;
}) {
  const { admin, browser, actors, http, tenant: t, otherTenant, origin, record, trial } = input;
  const [teacher, student, , foreign, manager] = actors,
    path = `/api/zhiban/learning/${t}/offerings/${trial.offeringId}`;
  const send = async (payload: unknown, a = student, key = v7()) => {
    const r = await http(path, a, payload, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const activity = async (title: string) =>
    (
      await admin.query(
        'SELECT id FROM zhiban_learning.activities WHERE tenant_id=$1 AND offering_id=$2 AND title=$3',
        [t, trial.offeringId, title],
      )
    ).rows[0].id as string;
  const safety = await activity('试用：安全巡检报告');
  const attempts = async (id = safety) =>
    (
      await admin.query(
        'SELECT id,attempt_no,status,revision::text FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2 AND membership_id=$3 ORDER BY attempt_no DESC',
        [t, id, student.member],
      )
    ).rows;
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: student.cookie!.split('=')[0],
      value: student.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage();
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === path) writes++;
  });
  const write = async (control: Locator) => {
    const ack = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path,
    );
    const refresh = page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === path + '/activities',
    );
    await control.click();
    assert.equal((await ack).status(), 200);
    await refresh;
    await expect(page.getByRole('button', { name: '刷新活动', exact: true })).toBeEnabled();
  };
  await page.goto(trial.urls.workspace);
  await page.getByText('学习活动与提交', { exact: true }).click();
  const filter = async (title: string) => {
    await page.getByRole('textbox', { name: '搜索活动', exact: true }).fill(title);
    await page.getByRole('button', { name: '查询活动', exact: true }).click();
    await expect(page.locator('.learning-activity')).toHaveCount(1);
    await expect(page.locator('.learning-activity h4')).toHaveText(title);
  };
  await filter('试用：安全巡检报告');
  await page.getByText('开始首次尝试', { exact: true }).click();
  await expect(
    page.getByText(
      '开始将占用 1 次尝试次数；当前已用 0 次，上限 3 次。使用当前发布版本 1，无截止时间。',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: '取消新建尝试', exact: true }).click();
  assert.equal((await attempts()).length, 0);
  assert.equal(writes, 0);
  await page.getByText('开始首次尝试', { exact: true }).click();
  await write(page.getByRole('button', { name: '确认开始新尝试', exact: true }));
  await expect(page.getByRole('textbox', { name: '尝试 1 作答', exact: true })).toBeVisible();
  assert.equal((await attempts()).length, 1);
  await page
    .getByRole('textbox', { name: '尝试 1 作答', exact: true })
    .fill('UAT 修复：原尝试作答');
  await write(page.getByRole('button', { name: '保存作答草稿', exact: true }));
  await expect(page.getByRole('textbox', { name: '尝试 1 作答', exact: true })).toHaveValue(
    'UAT 修复：原尝试作答',
  );
  let before = writes;
  await page.getByRole('button', { name: '继续未完成作答', exact: true }).click();
  assert.equal(writes, before);
  assert.equal((await attempts()).length, 1);
  await write(page.getByRole('button', { name: '最终提交', exact: true }));
  await expect(page.getByRole('button', { name: '查看已提交尝试', exact: true })).toBeVisible();
  before = writes;
  await page.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
  assert.equal(writes, before);
  assert.equal((await attempts()).length, 1);
  await page
    .getByRole('textbox', { name: '尝试 1 作答', exact: true })
    .fill('UAT 修复：同一次尝试提交版本二');
  await write(page.getByRole('button', { name: '提交新版本', exact: true }));
  await expect(page.getByRole('textbox', { name: '尝试 1 作答', exact: true })).toHaveValue(
    'UAT 修复：同一次尝试提交版本二',
  );
  assert.equal((await attempts()).length, 1);
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
        [t, (await attempts())[0].id],
      )
    ).rows[0].n,
    2,
  );
  record(
    'UAT-01 first attempt requires explicit confirmation; cancel/view/continue issue no START; original-attempt resubmission adds a version without consuming an attempt',
  );
  await page.getByText('新建下一次尝试', { exact: true }).click();
  before = writes;
  await page.getByRole('button', { name: '取消新建尝试', exact: true }).click();
  assert.equal((await attempts()).length, 1);
  assert.equal(writes, before);
  await page.getByText('新建下一次尝试', { exact: true }).click();
  await write(page.getByRole('button', { name: '确认开始新尝试', exact: true }));
  await expect(page.getByRole('textbox', { name: '尝试 2 作答', exact: true })).toBeVisible();
  assert.equal((await attempts()).length, 2);
  // Render Continue for IN_PROGRESS, then submit in another session before clicking it.
  await page.reload();
  await page.getByText('学习活动与提交', { exact: true }).click();
  await filter('试用：安全巡检报告');
  let latest = (await attempts())[0];
  await send({
    type: 'SUBMIT',
    id: latest.id,
    revision: latest.revision,
    answer: '另一会话先提交',
  });
  before = writes;
  await page.getByRole('button', { name: '继续未完成作答', exact: true }).click();
  await expect(
    page.getByText('尝试 2 · 活动版本 1 · 已提交 · 最新尝试', { exact: true }),
  ).toBeVisible();
  assert.equal(writes, before);
  assert.equal((await attempts()).length, 2);
  await page.getByRole('button', { name: '刷新活动', exact: true }).click();
  await page.getByText('新建下一次尝试', { exact: true }).click();
  await write(page.getByRole('button', { name: '确认开始新尝试', exact: true }));
  await expect(page.getByRole('textbox', { name: '尝试 3 作答', exact: true })).toBeVisible();
  latest = (await attempts())[0];
  await send({
    type: 'SUBMIT',
    id: latest.id,
    revision: latest.revision,
    answer: '第三次正式提交',
  });
  await page.getByRole('button', { name: '刷新活动', exact: true }).click();
  await page.getByText('新建下一次尝试', { exact: true }).click();
  await expect(page.getByRole('button', { name: '确认开始新尝试', exact: true })).toBeDisabled();
  assert.equal((await http(path, student, { type: 'START_ATTEMPT', id: safety })).status, 409);
  assert.equal((await attempts()).length, 3);
  record(
    'UAT-01 explicit next attempt consumes exactly one; stale Continue after concurrent submit remains read-only; original cap rejects attempt four',
  );
  const create = async (
    title: string,
    deadlineAt: number | null,
    maxAttempts: number,
    allowResubmit = true,
  ) => {
    const r = await send(
      {
        type: 'CREATE_ACTIVITY',
        title,
        prompt: '定向验证',
        deadlineAt,
        allowResubmit,
        maxAttempts,
      },
      teacher,
    );
    await send({ type: 'PUBLISH_ACTIVITY', id: r.id, revision: r.revision }, teacher);
    return r.id;
  };
  const single = await create('UAT 不允许重交', null, 2, false);
  await filter('UAT 不允许重交');
  await page.getByText('开始首次尝试', { exact: true }).click();
  await write(page.getByRole('button', { name: '确认开始新尝试', exact: true }));
  await page.getByRole('textbox', { name: '尝试 1 作答', exact: true }).fill('一次正式提交');
  await page.getByRole('button', { name: '最终提交', exact: true }).click();
  await write(page.getByRole('button', { name: '确认最终提交', exact: true }));
  before = writes;
  await page.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
  await expect(page.getByText('此尝试规则：无截止时间 · 不可重交', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '尝试 1 作答', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '提交新版本', exact: true })).toHaveCount(0);
  assert.equal(writes, before);
  const submitted = (await attempts(single))[0];
  assert.equal(
    (
      await http(path, student, {
        type: 'SUBMIT',
        id: submitted.id,
        revision: submitted.revision,
        answer: '不可重交',
      })
    ).status,
    409,
  );
  assert.equal((await attempts(single)).length, 1);
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
        [t, submitted.id],
      )
    ).rows[0].n,
    1,
  );
  record(
    'UAT-03 submitted-entry wording promises no resubmission; forbidden resubmission stays read-only and server-denied, with no extra attempt or submission',
  );
  const cutoff = Date.now() + 3500;
  const expired = await create('UAT 已截止', cutoff, 1);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, cutoff - Date.now() + 30)));
  await filter('UAT 已截止');
  await page.getByText('开始首次尝试', { exact: true }).click();
  await expect(page.getByRole('button', { name: '确认开始新尝试', exact: true })).toBeDisabled();
  assert.equal((await http(path, student, { type: 'START_ATTEMPT', id: expired })).status, 409);
  assert.equal((await attempts(expired)).length, 0);
  const lost = await create('UAT 响应丢失', null, 1);
  await filter('UAT 响应丢失');
  await page.getByText('开始首次尝试', { exact: true }).click();
  let commandKey = '';
  await page.route(
    `**${path}`,
    async (route) => {
      const request = route.request();
      commandKey = request.headers()['x-zhiban-command'];
      assert.equal(
        (
          await http(path, student, JSON.parse(request.postData()!), 'POST', {
            'x-zhiban-command': commandKey,
          })
        ).status,
        200,
      );
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '确认开始新尝试', exact: true }).click();
  await expect(page.getByRole('button', { name: '按原命令号重试', exact: true })).toBeVisible();
  await write(page.getByRole('button', { name: '按原命令号重试', exact: true }));
  await expect(page.getByRole('textbox', { name: '尝试 1 作答', exact: true })).toBeVisible();
  assert.equal((await attempts(lost)).length, 1);
  assert.ok(commandKey);
  record(
    'UAT-01 deadline stays server-enforced; lost START response retries original durable key and creates one attempt',
  );
  await context.close();
  const base = `/api/zhiban/management/${t}/history`,
    read = async (params: Record<string, string> = {}) => {
      const r = await http(base + '?' + new URLSearchParams(params), manager);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return (r.json as { rows: MemberRow[] }).rows;
    };
  const enrolled = await read({ event: 'ENROLL' });
  assert.equal(enrolled.length, 2);
  assert.deepEqual(
    new Set(enrolled.map((r) => r.member_id)),
    new Set([student.member, actors[5].member]),
  );
  assert.deepEqual(new Set(enrolled.map((r) => r.member_name)), new Set(['陈同学', '李明']));
  for (const event of ['ASSIGN_TEACHER', 'CREATE_COURSE']) {
    const r = await read({ event });
    assert.equal(r[0].member_id, teacher.member);
    assert.equal(r[0].member_name, '周老师');
  }
  assert.equal((await read({ event: 'ENROLL', q: student.member })).length, 1);
  assert.equal((await read({ event: 'ENROLL', q: '陈同学' })).length, 1);
  const execute = async (command: unknown) => {
    const r = await http(`/api/zhiban/management/${t}/commands`, manager, command);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const enrollment = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [t, trial.offeringId, actors[5].member],
    )
  ).rows[0];
  await execute({ type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision });
  assert.equal((await read({ event: 'WITHDRAW' }))[0].member_id, actors[5].member);
  const assignment = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [t, trial.offeringId, teacher.member],
    )
  ).rows[0];
  await execute({ type: 'END_TEACHER', id: assignment.id, revision: assignment.revision });
  assert.equal((await read({ event: 'END_TEACHER' }))[0].member_id, teacher.member);
  record(
    'UAT-02 two real enrollments identify different students; owner/teacher/new and ended relationships project the correct whitelisted member and support literal member search',
  );
  await admin.query('DELETE FROM zhiban_academic.people WHERE tenant_id=$1 AND membership_id=$2', [
    t,
    actors[5].member,
  ]);
  const fallback = (await read({ event: 'WITHDRAW' }))[0];
  assert.equal(fallback.member_id, actors[5].member);
  assert.equal(fallback.member_name, null);
  // Owned fixture rows test corrupt legacy refs and foreign names without altering any real history.
  await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [
    otherTenant,
    foreign.member,
    '外空间姓名不可串入',
  ]);
  for (const ref of ['not-a-uuid', foreign.member]) {
    const key = v7();
    await admin.query('INSERT INTO zhiban_academic.commands VALUES($1,$2,$3,$4,$5)', [
      t,
      key,
      manager.member,
      'a'.repeat(64),
      Date.now(),
    ]);
    await admin.query(
      "INSERT INTO zhiban_academic.audit_events VALUES($1,$2,$3,$4,'ENROLL',$5,$6)",
      [
        t,
        v7(),
        manager.member,
        key,
        Date.now(),
        JSON.stringify({
          before: { private: 'DO_NOT_RETURN' },
          command: { membershipId: ref, description: 'DO_NOT_RETURN' },
        }),
      ],
    );
  }
  const legacy = await read({ event: 'ENROLL' });
  assert.equal(legacy.find((r) => r.member_id === foreign.member)!.member_name, null);
  assert.ok(legacy.some((r) => r.member_id === null));
  assert.ok(!JSON.stringify(legacy).includes('DO_NOT_RETURN'));
  assert.ok(!JSON.stringify(legacy).includes('外空间姓名不可串入'));
  assert.ok(legacy.every((r) => Object.keys(r).length === 10));
  for (const a of [student, teacher, foreign]) assert.equal((await http(base, a)).status, 403);
  record(
    'UAT-02 historical missing directory falls back to ID; malformed refs do not break reads; tenant-bound joins never borrow foreign names or expose raw facts; current authorization unchanged',
  );
  const adminContext = await browser.newContext();
  await adminContext.addCookies([
    {
      name: manager.cookie!.split('=')[0],
      value: manager.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const adminPage = await adminContext.newPage();
  await adminPage.goto(trial.urls.workspace);
  await adminPage.getByRole('button', { name: '操作历史', exact: true }).click();
  await adminPage.getByLabel('操作类型', { exact: true }).selectOption('ENROLL');
  await adminPage.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(adminPage.getByText('涉及成员：陈同学', { exact: true })).toHaveCount(1);
  await expect(adminPage.getByText('涉及成员：陈同学', { exact: true })).toBeVisible();
  await expect(adminPage.getByText('涉及成员：未记录姓名', { exact: true })).toHaveCount(2);
  await adminPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await adminContext.close();
  record(
    'UAT-02 administrator page renders named subjects and ID fallback without overflow at 390px',
  );
}
