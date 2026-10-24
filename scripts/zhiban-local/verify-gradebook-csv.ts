/** LOCAL current-page export; no production inputs. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
export async function verifyGradebookCsv(input: Input) {
  const { http, actors, tenant, trial, admin, browser, origin, record } = input;
  const [teacher, student, outsider, foreign, manager] = actors;
  const base = `/api/zhiban/assessment/${tenant}/offerings/${trial.offeringId}/gradebook`;
  const raw = async (search = '', actor: typeof teacher | undefined = teacher) => {
    const r = await http(base + '.csv' + search, actor);
    return r as typeof r & { bytes: Buffer; headers: Record<string, string> };
  };
  for (const actor of [student, outsider, foreign, manager])
    assert.equal((await raw('', actor)).status, 403);
  assert.equal((await http(base + '.csv')).status, 401);
  for (const q of ['?limit=100', '?activityLimit=50', '?cursor=invalid', '?q=a&q=b', '?all=true'])
    assert.equal((await raw(q)).status, 400);
  const normal = await raw();
  assert.equal(normal.status, 200);
  assert.ok(normal.headers['content-type'].startsWith('text/csv'));
  assert.match(
    normal.headers['content-disposition'],
    /^attachment; filename="zhiban-gradebook-[0-9a-f-]+\.csv"$/,
  );
  assert.equal(normal.headers['cache-control'], 'no-store');
  assert.equal(normal.headers['x-content-type-options'], 'nosniff');
  const text = normal.bytes.toString('utf8');
  assert.ok(text.startsWith('\ufeff'));
  assert.equal(text.split('\r\n').length, 12);
  assert.ok(text.includes('"93.00","100.00","1"'));
  assert.ok(text.includes('"未开始","","",""'));
  assert.ok(!text.includes('成绩簿精确提交评分验证'));
  assert.ok(!text.includes('先断电并确认安全状态'));
  const first = (await http(base, teacher)).json as any;
  const second = await raw('?activityCursor=' + first.activityNextCursor);
  assert.equal(second.status, 200);
  assert.equal(second.bytes.toString().split('\r\n').length, 6);
  const searched = await raw('?q=' + encodeURIComponent('陈同学'));
  assert.equal(searched.status, 200);
  assert.equal(searched.bytes.toString().split('\r\n').length, 7);
  assert.equal((await raw('?q=does-not-exist')).bytes.toString().split('\r\n').length, 2);
  const originalName = (
    await admin.query(
      'SELECT display_name FROM zhiban_academic.people WHERE tenant_id=$1 AND membership_id=$2',
      [tenant, student.member],
    )
  ).rows[0].display_name;
  try {
    await admin.query(
      'UPDATE zhiban_academic.people SET display_name=$3 WHERE tenant_id=$1 AND membership_id=$2',
      [tenant, student.member, ' =HYPERLINK("local","x")'],
    );
    const formula = await raw('?q=' + student.member);
    assert.ok(formula.bytes.toString().includes('"\' =HYPERLINK(""local"",""x"")"'));
  } finally {
    await admin.query(
      'UPDATE zhiban_academic.people SET display_name=$3 WHERE tenant_id=$1 AND membership_id=$2',
      [tenant, student.member, originalName],
    );
  }
  // Export must recheck the assignment even after a successful screen read.
  try {
    await admin.query(
      "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$3 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$4",
      [tenant, trial.offeringId, Date.now(), teacher.member],
    );
    assert.equal((await raw()).status, 403);
  } finally {
    await admin.query(
      "UPDATE zhiban_academic.assignments SET status='ACTIVE',valid_until=NULL WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
      [tenant, trial.offeringId, teacher.member],
    );
  }
  record(
    'gradebook CSV current-page bounds, column page/search/header-only export, published scores and blank missing scores, formula neutralization and private-text exclusion pass; student/admin/foreign and revoked teacher denied',
  );
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'Asia/Shanghai' }),
    page = await context.newPage();
  await page.goto(origin + '/zhiban');
  await page.getByLabel('账号 ID', { exact: true }).fill(teacher.uid);
  await page.getByLabel('密码', { exact: true }).fill(teacher.password);
  await page.getByRole('button', { name: '登录并进入', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  await page.goto(trial.urls.grading.replace('#queue', ''));
  await page.getByLabel('搜索成绩簿学生', { exact: true }).fill('陈同学');
  await page.getByRole('button', { name: '查询成绩簿', exact: true }).click();
  await expect(page.getByRole('rowheader')).toHaveCount(1);
  // Unsaved text in search must not silently change the already displayed export filter.
  await page.getByLabel('搜索成绩簿学生', { exact: true }).fill('未查询的姓名');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前页 CSV', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  assert.ok(path);
  const bytes = await readFile(path!);
  assert.equal(bytes.toString().split('\r\n').length, 7);
  assert.ok(bytes.toString().includes('陈同学'));
  await expect(
    page.getByText('当前页 CSV 已生成（按下载时数据，不含其他分页）。', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'docs/v2/evidence/zhiban-gradebook-csv-download-local.png',
    fullPage: true,
  });
  await context.close();
  record(
    'gradebook CSV actual browser download matches applied filter, UTF-8 filename/content and page dimensions; unsent search text does not change export scope',
  );
}
