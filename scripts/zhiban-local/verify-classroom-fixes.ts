/** CL-01/02: owned PG16 + real commands; HTTP fault injection is confined to this context. */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
type Shared = Parameters<typeof prepareTrial>[0];
type Result = { id: string; revision: string };
export async function verifyClassroomFixes(
  input: Shared & { trial: Awaited<ReturnType<typeof prepareTrial>> },
) {
  const { admin, browser, actors, http, tenant, origin, record, trial } = input;
  const [teacher, student] = actors;
  const path = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const send = async (body: unknown, actor = teacher) => {
    const r = await http(path, actor, body);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const created = await send({
    type: 'CREATE_ACTIVITY',
    title: 'CL 不可重交',
    prompt: '课堂验证',
    deadlineAt: null,
    allowResubmit: false,
    maxAttempts: 1,
  });
  await send({ type: 'PUBLISH_ACTIVITY', ...created });
  const attempt = await send({ type: 'START_ATTEMPT', id: created.id }, student);
  const count = async (id = attempt.id) =>
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
        [tenant, id],
      )
    ).rows[0].n;
  const context = await browser.newContext();
  const page = await context.newPage();
  const login = async (actor: typeof teacher) => {
    await context.clearCookies();
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
    await page.goto(trial.urls.workspace);
    await page.getByText('学习活动与提交', { exact: true }).click();
    await page.getByRole('textbox', { name: '搜索活动', exact: true }).fill('CL 不可重交');
    await page.getByRole('button', { name: '查询活动', exact: true }).click();
    await expect(page.locator('.learning-activity')).toHaveCount(1);
    await expect(page.locator('.learning-activity h4')).toHaveText('CL 不可重交');
  };
  try {
    await login(teacher);
    await page.getByText('查看学生尝试', { exact: true }).click();
    const member = page.getByRole('textbox', { name: '完整学生成员 ID', exact: true });
    await expect(member).toBeVisible();
    let reads = 0;
    page.on('request', (r) => {
      if (r.method() === 'GET' && new URL(r.url()).pathname === path + '/attempts') reads++;
    });
    await member.fill('陈同学');
    const initial = reads;
    await page.getByRole('button', { name: '查询尝试', exact: true }).click();
    assert.equal(await member.evaluate((n: HTMLInputElement) => n.checkValidity()), false);
    assert.equal(reads, initial);
    await expect(member).toBeEnabled();
    record('CL-01 malformed member/name rejected before request; editable filter retained');
    const pattern = '**/attempts?*';
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INVALID_INPUT' } }),
      }),
    );
    await member.fill(student.member);
    await page.getByRole('button', { name: '查询尝试', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('筛选条件无效，请修改筛选条件后重新查询。');
    await expect(member).toBeEnabled();
    await expect(member).toHaveValue(student.member);
    await expect(page.locator('.learning-attempt')).toHaveCount(0);
    await page.unroute(pattern);
    await member.fill('');
    await page.getByRole('button', { name: '查询尝试', exact: true }).click();
    await expect(page.locator('.learning-attempt')).toHaveCount(1);
    record(
      'CL-01 server validation failure retains filters, removes stale rows, and supports corrected requery',
    );
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FORBIDDEN' } }),
      }),
    );
    await page.getByRole('button', { name: '查询尝试', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('资格已失效');
    await expect(page.locator('.learning-attempt')).toHaveCount(0);
    await expect(member).toBeEnabled();
    await page.unroute(pattern);
    await page.getByRole('button', { name: '重新读取尝试', exact: true }).click();
    await expect(page.locator('.learning-attempt')).toHaveCount(1);
    record('CL-01 denied read exposes no stale attempts; retry restores normal list');

    await login(student);
    await page.getByRole('button', { name: '继续未完成作答', exact: true }).click();
    const answer = page.getByRole('textbox', { name: '尝试 1 作答', exact: true });
    await answer.fill('确认前不写入');
    let posts = 0;
    const keys: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === path) {
        posts++;
        keys.push(r.headers()['x-zhiban-command']);
      }
    });
    await page.getByRole('button', { name: '最终提交', exact: true }).click();
    await expect(page.getByRole('group', { name: '最终提交确认' })).toBeVisible();
    await expect(answer).toBeDisabled();
    assert.equal(posts, 0);
    assert.equal(await count(), 0);
    await page.getByRole('button', { name: '取消提交', exact: true }).click();
    await expect(answer).toBeEnabled();
    await expect(answer).toHaveValue('确认前不写入');
    assert.equal(posts, 0);
    record('CL-02 open/cancel confirmation issues no write, preserves answer and restores editing');
    await answer.fill('取消后修订的最终正文');
    await page.getByRole('button', { name: '最终提交', exact: true }).click();
    await page.route('**/offerings/' + trial.offeringId, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'CONFLICT' } }),
      }),
    );
    await page.getByRole('button', { name: '确认最终提交', exact: true }).click();
    await expect(page.getByText('记录已变更，请刷新后重新操作。', { exact: true })).toBeVisible();
    await expect(answer).toBeEnabled();
    await expect(answer).toHaveValue('取消后修订的最终正文');
    assert.equal(await count(), 0);
    await page.unroute('**/offerings/' + trial.offeringId);
    record('CL-02 definitive conflict preserves editable answer without a submission');
    let dropped = false;
    await page.route('**/offerings/' + trial.offeringId, async (route) => {
      if (!dropped) {
        dropped = true;
        const response = await http(path, student, route.request().postDataJSON(), 'POST', {
          'x-zhiban-command': route.request().headers()['x-zhiban-command'],
        });
        assert.equal(response.status, 200);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: '最终提交', exact: true }).click();
    await page.getByRole('button', { name: '确认最终提交', exact: true }).click();
    await expect(page.getByRole('button', { name: '按原命令号重试', exact: true })).toBeVisible();
    const originalKey = keys.at(-1);
    assert.equal(await count(), 1);
    await page.getByRole('button', { name: '按原命令号重试', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看已提交尝试', exact: true })).toBeEnabled();
    assert.equal(keys.at(-1), originalKey);
    assert.equal(await count(), 1);
    await expect(answer).toBeDisabled();
    await expect(page.getByRole('button', { name: '提交新版本', exact: true })).toHaveCount(0);
    await expect(page.locator('.learning-submission')).toContainText('取消后修订的最终正文');
    await page.unroute('**/offerings/' + trial.offeringId);
    record(
      'CL-02 lost success response retried with original key creates exactly one immutable submission',
    );
    const current = (
      await admin.query(
        'SELECT revision::text FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2',
        [tenant, attempt.id],
      )
    ).rows[0];
    assert.equal(
      (
        await http(path, student, {
          type: 'SUBMIT',
          id: attempt.id,
          revision: current.revision,
          answer: '禁止重交',
        })
      ).status,
      409,
    );
    assert.equal(await count(), 1);
    record('CL-02 server still denies resubmission; original attempt rule unchanged');
    const safety = (
      await admin.query(
        "SELECT id FROM zhiban_learning.activities WHERE tenant_id=$1 AND title='试用：安全巡检报告'",
        [tenant],
      )
    ).rows[0].id;
    const retry = await send({ type: 'START_ATTEMPT', id: safety }, student);
    await page.getByRole('textbox', { name: '搜索活动', exact: true }).fill('试用：安全巡检报告');
    await page.getByRole('button', { name: '查询活动', exact: true }).click();
    await expect(page.locator('.learning-activity h4')).toHaveText('试用：安全巡检报告');
    await page.getByRole('button', { name: '继续未完成作答', exact: true }).click();
    await answer.fill('允许重交版本一');
    await page.getByRole('button', { name: '最终提交', exact: true }).click();
    await expect(page.getByRole('button', { name: '提交新版本', exact: true })).toBeEnabled();
    await expect(page.getByRole('group', { name: '最终提交确认' })).toHaveCount(0);
    await answer.fill('允许重交版本二');
    await page.getByRole('button', { name: '提交新版本', exact: true }).click();
    await expect(page.locator('.learning-submission')).toHaveCount(2);
    assert.equal(await count(retry.id), 2);
    record('CL-02 resubmittable activity retains original direct submission/versioning flow');
  } finally {
    await context.close();
  }
}
