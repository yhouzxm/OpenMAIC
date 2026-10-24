/** Owned PG16 regression for the pagination state observed during administrator roster trial. */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
type Shared = Parameters<typeof prepareTrial>[0];
export async function verifyRosterTrial(
  input: Shared & { trial: Awaited<ReturnType<typeof prepareTrial>> },
) {
  const { admin, browser, actors, http, tenant: t, origin, record, trial } = input;
  const manager = actors[4],
    student = actors[1],
    peer = actors[5];
  const base = `/api/zhiban/management/${t}`;
  const command = async (body: unknown) => {
    const r = await http(base + '/commands', manager, body);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const source = (
    await admin.query(
      'SELECT term_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
      [t, trial.offeringId],
    )
  ).rows[0];
  await command({
    type: 'CREATE_OFFERING',
    code: 'LOCAL_STATE_TARGET',
    name: '控件状态目标班',
    courseId: trial.courseId,
    termId: source.term_id,
    classId: null,
    capacity: 1,
  });
  const target = (
    await admin.query(
      "SELECT id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND code='LOCAL_STATE_TARGET'",
      [t],
    )
  ).rows[0].id as string;
  await command({ type: 'ENROLL', offeringId: target, membershipId: peer.member, revision: null });
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: manager.cookie!.split('=')[0],
      value: manager.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage();
  await page.goto(trial.urls.workspace);
  await page
    .locator('.management-list > article')
    .filter({ has: page.getByRole('heading', { name: '试用教学班', exact: true }) })
    .getByRole('button', { name: '管理学生名单', exact: true })
    .click();
  await page.getByRole('textbox', { name: '搜索学生', exact: true }).fill('陈同学');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.management-list > article')).toHaveCount(1);
  await page.getByRole('button', { name: '转班', exact: true }).click();
  const destination = page.getByRole('button', { name: '转入 控件状态目标班（1/1）', exact: true });
  const bounds = async () => {
    for (const name of ['上一页', '下一页', '上一页目标', '下一页目标'])
      await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  };
  const unchanged = async () => {
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
          [t, trial.offeringId, student.member],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND status='ACTIVE'",
          [t, target],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type='TRANSFER'",
          [t],
        )
      ).rows[0].n,
      0,
    );
  };
  await expect(destination).toBeVisible();
  await bounds();
  const rejected = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === base + '/commands',
  );
  await destination.click();
  assert.equal((await rejected).status(), 409);
  await expect(page.getByText('目标教学班容量已满。请刷新名单。', { exact: true })).toBeVisible();
  await bounds();
  await expect(destination).toBeEnabled();
  await unchanged();
  record(
    'UAT-04 full-target rejection preserves source membership and audit; both list and target pagination keep original disabled boundaries while valid controls recover',
  );

  let firstKey = '';
  await page.route(
    '**' + base + '/commands',
    async (route) => {
      const request = route.request();
      firstKey = request.headers()['x-zhiban-command'];
      assert.ok(firstKey);
      const actual = await http(
        base + '/commands',
        manager,
        JSON.parse(request.postData()!),
        'POST',
        { 'x-zhiban-command': firstKey },
      );
      assert.equal(actual.status, 409);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await destination.click();
  const retry = page.getByRole('button', { name: '按原命令号重试', exact: true });
  await expect(retry).toBeVisible();
  await bounds();
  await expect(destination).toBeDisabled();
  const retried = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === base + '/commands',
  );
  await retry.click();
  const ack = await retried;
  assert.equal(ack.status(), 409);
  assert.equal(ack.request().headers()['x-zhiban-command'], firstKey);
  await expect(retry).toHaveCount(0);
  await bounds();
  await expect(destination).toBeEnabled();
  await unchanged();
  record(
    'UAT-04 lost rejection response pauses controls; retry retains original command key and original disabled states after definitive rejection, without transfer or duplicate audit',
  );

  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === base + '/commands') writes++;
  });
  await page.route(
    (url) => url.pathname === base + '/enrollments' && url.searchParams.get('offering') === target,
    (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FORBIDDEN' } }),
      }),
    { times: 1 },
  );
  await destination.click();
  await expect(page.getByText('没有管理员权限或授权已失效', { exact: true })).toBeVisible();
  await bounds();
  await expect(destination).toBeEnabled();
  assert.equal(writes, 0);
  await unchanged();
  record(
    'UAT-04 failed target-membership preflight restores original control states and issues no transfer command',
  );

  const occupant = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [t, target, peer.member],
    )
  ).rows[0];
  await command({ type: 'WITHDRAW', ...occupant });
  const committed = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === base + '/commands',
  );
  await destination.click();
  assert.equal((await committed).status(), 200);
  await expect(page.getByText('暂无匹配记录。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
  assert.equal(
    (
      await admin.query(
        'SELECT status FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
        [t, trial.offeringId, student.member],
      )
    ).rows[0].status,
    'WITHDRAWN',
  );
  assert.equal(
    (
      await admin.query(
        'SELECT status FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
        [t, target, student.member],
      )
    ).rows[0].status,
    'ACTIVE',
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type='TRANSFER'",
        [t],
      )
    ).rows[0].n,
    1,
  );
  await context.close();
  record(
    'UAT-04 after real capacity becomes available, original guarded transfer succeeds once and redraw keeps empty-list pagination disabled',
  );
}
