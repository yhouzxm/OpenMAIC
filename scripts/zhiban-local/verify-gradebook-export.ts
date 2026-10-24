/** Directed LOCAL disposable PG16/HTTPS/browser checks. No real teaching data. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
export async function verifyGradebookExport(input: Input) {
  const { admin, actors, tenant, trial, http, browser, origin, record } = input;
  const [teacher, student, outsider, foreign, manager] = actors;
  let storageState: Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>;
  const base = `/api/zhiban/assessment/${tenant}/offerings/${trial.offeringId}/gradebook`;
  const raw = async (search = '', actor: typeof teacher | undefined = teacher) =>
    (await http(base + '-export.csv' + search, actor)) as Awaited<ReturnType<typeof http>> & {
      bytes: Buffer;
      headers: Record<string, string>;
    };
  // Only simple synthetic cells below: production CSV quoting is separately unit tested.
  const records = (bytes: Buffer) =>
    bytes
      .toString('utf8')
      .replace(/^\ufeff/, '')
      .trimEnd()
      .split('\r\n')
      .slice(1)
      .map((line) =>
        [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replaceAll('""', '"')),
      );
  assert.equal((await http(base + '-export.csv')).status, 401);
  for (const actor of [student, outsider, foreign, manager])
    assert.equal((await raw('', actor)).status, 403);
  for (const search of [
    '?cursor=x',
    '?activityCursor=x',
    '?limit=500',
    '?activityLimit=100',
    '?all=true',
    '?q=a&q=b',
  ])
    assert.equal((await raw(search)).status, 400);
  assert.equal((await http(base + '-export.csv', teacher, { q: '' })).status, 405);
  const initial = await raw();
  assert.equal(initial.status, 200);
  assert.equal(initial.headers['cache-control'], 'no-store');
  assert.equal(initial.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(initial.headers['x-content-type-options'], 'nosniff');
  assert.match(
    initial.headers['content-disposition'],
    /^attachment; filename="zhiban-gradebook-filtered-[0-9a-f-]+\.csv"$/,
  );
  assert.equal(records(initial.bytes).length, 6);
  assert.ok(initial.bytes.toString().includes('"88.00","100.00","1"'));
  assert.ok(initial.bytes.toString().includes('"未开始","","",""'));
  assert.ok(!initial.bytes.toString().includes('先断电并确认安全状态'));
  assert.equal(records((await raw('?q=none-match')).bytes).length, 0);
  record(
    'cross-page CSV authenticates session and current tenant/teacher assignment; student/admin/foreign/no-session denied; query/cursor/method contract and safe download headers pass',
  );

  // Fixture-only cardinality seeds under the owned cluster owner. They confer no credentials,
  // role grants or product command authority; disposed with the isolated harness cluster.
  const memberIds = Array.from({ length: 499 }, () => v7()),
    userIds = Array.from({ length: 499 }, () => v7()),
    activityIds = Array.from({ length: 98 }, () => v7());
  const original = (
    await admin.query(
      'SELECT membership_id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2',
      [tenant, trial.offeringId],
    )
  ).rows.map((r) => r.membership_id);
  await admin.query(
    `INSERT INTO zhiban_identity.users(user_id,status,created_at,updated_at)
    SELECT unnest($1::uuid[]),'ACTIVE',0,0`,
    [userIds],
  );
  await admin.query(
    `INSERT INTO zhiban_identity.memberships(membership_id,tenant_id,user_id,status,created_at,updated_at)
    SELECT m,$1,u,'ACTIVE',0,0 FROM unnest($2::uuid[],$3::uuid[]) x(m,u)`,
    [tenant, memberIds, userIds],
  );
  await admin.query(
    `INSERT INTO zhiban_academic.people(tenant_id,membership_id,display_name)
    SELECT $1,m,'导出边界学生' FROM unnest($2::uuid[]) x(m)`,
    [tenant, memberIds],
  );
  const addStudents = async (ids: string[]) => {
    for (const id of ids)
      await admin.query(
        `INSERT INTO zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id,status,valid_from)
      VALUES($1,$2,$3,$4,'ACTIVE',0) ON CONFLICT DO NOTHING`,
        [tenant, v7(), trial.offeringId, id],
      );
  };
  const addActivities = async (ids: string[]) => {
    for (const id of ids) {
      await admin.query(
        `INSERT INTO zhiban_learning.activities(tenant_id,id,offering_id,title,prompt,allow_resubmit,max_attempts,status,published_version,created_at,updated_at)
        VALUES($1,$2,$3,'跨页导出活动','私有正文不得导出',false,1,'PUBLISHED',1,0,0)`,
        [tenant, id, trial.offeringId],
      );
      await admin.query(
        `INSERT INTO zhiban_learning.activity_versions(tenant_id,activity_id,version,offering_id,title,prompt,allow_resubmit,max_attempts,published_at)
        VALUES($1,$2,1,$3,'跨页导出活动','私有正文不得导出',false,1,0)`,
        [tenant, id, trial.offeringId],
      );
    }
  };
  try {
    await addStudents(memberIds.slice(0, 10));
    await addActivities(activityIds.slice(0, 9));
    const all = await raw();
    assert.equal(all.status, 200);
    const rows = records(all.bytes);
    assert.equal(rows.length, 144); // 12 students × 12 activities, beyond both page axes.
    assert.equal(new Set(rows.map((r) => r[2] + ':' + r[4])).size, 144);
    assert.equal(new Set(rows.map((r) => r[0])).size, 1);
    assert.equal((await http(base + '?limit=10', teacher)).status, 200);
    const searched = await raw('?q=' + encodeURIComponent('陈同学'));
    assert.equal(searched.status, 200, JSON.stringify(searched.json));
    assert.equal(records(searched.bytes).length, 12);
    assert.ok(!all.bytes.toString().includes('私有正文不得导出'));
    const context = await browser.newContext({ acceptDownloads: true }),
      page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(origin + '/zhiban');
      await page.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(teacher.uid);
      await page.getByLabel('密码', { exact: true }).fill(teacher.password);
      await page.getByRole('button', { name: '登录并进入', exact: true }).click();
      await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
      await page.goto(trial.urls.grading.replace('#queue', ''));
      await page.getByLabel('成绩簿学生每页条数', { exact: true }).selectOption('10');
      await page.getByRole('button', { name: '查询成绩簿', exact: true }).click();
      await expect(page.getByRole('rowheader')).toHaveCount(10);
      await page.getByRole('button', { name: '下一页学生', exact: true }).click();
      await expect(page.getByRole('rowheader')).toHaveCount(2);
      await page.getByRole('button', { name: '下一页活动', exact: true }).click();
      await expect(page.getByRole('columnheader')).toHaveCount(6);
      // Unsubmitted input must not narrow the already queried (empty) filter.
      await page.getByLabel('搜索成绩簿学生', { exact: true }).fill('未查询的输入');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: '按查询条件跨页导出 CSV', exact: true }).click();
      const downloaded = await pending;
      assert.equal(records(await readFile((await downloaded.path())!)).length, 144);
      await expect(page.getByText(/^跨页 CSV 已生成/)).toBeVisible();
      await page.screenshot({
        path: 'docs/v2/evidence/zhiban-gradebook-export-download-local.png',
        fullPage: true,
      });
      await page.getByLabel('搜索成绩簿学生', { exact: true }).fill('陈同学');
      await page.getByRole('button', { name: '查询成绩簿', exact: true }).click();
      await expect(page.getByRole('rowheader')).toHaveCount(1);
      const filtered = page.waitForEvent('download');
      await page.getByRole('button', { name: '按查询条件跨页导出 CSV', exact: true }).click();
      assert.equal(records(await readFile((await (await filtered).path())!)).length, 12);
      // Existing page export remains scoped to this page.
      const current = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出当前页 CSV', exact: true }).click();
      assert.equal(records(await readFile((await (await current).path())!)).length, 5);
      assert.deepEqual(errors, []);
      storageState = await context.storageState();
    } finally {
      await context.close();
    }
    record(
      'actual browser downloads from second student/activity pages contain all 144 unique cells; unsent input ignored, applied Chinese filter yields 12, existing current-page yields 5; no answers/feedback/drafts exported',
    );

    await addActivities(activityIds.slice(9, 97)); // 100 total.
    assert.equal((await raw()).status, 200);
    await addActivities(activityIds.slice(97)); // 101 total.
    const deniedActivities = await raw('?q=none-match');
    assert.equal(deniedActivities.status, 413);
    assert.equal((deniedActivities.json as { error: { code: string } }).error.code, 'EXPORT_LIMIT');
    assert.ok(!deniedActivities.headers['content-type'].startsWith('text/csv'));
    // Withdraw fixture activities to exactly 20; immutable versions remain intact.
    await admin.query(
      "UPDATE zhiban_learning.activities SET status='WITHDRAWN' WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
      [tenant, activityIds.slice(17)],
    );
    await addStudents(memberIds.slice(10, 498)); // 500 total.
    const exact = await raw();
    assert.equal(exact.status, 200);
    assert.equal(records(exact.bytes).length, 10000);
    await admin.query(
      "UPDATE zhiban_learning.activities SET status='PUBLISHED' WHERE tenant_id=$1 AND id=$2",
      [tenant, activityIds[17]],
    );
    assert.equal((await raw()).status, 413); // 500 × 21 exceeds record limit.
    const overflowContext = await browser.newContext({ storageState }),
      overflowPage = await overflowContext.newPage();
    try {
      await overflowPage.goto(trial.urls.grading.replace('#queue', ''));
      const downloads: string[] = [];
      overflowPage.on('download', (d) => downloads.push(d.suggestedFilename()));
      await overflowPage
        .getByRole('button', { name: '按查询条件跨页导出 CSV', exact: true })
        .click();
      await expect(overflowPage.getByText(/^导出超限：最多500名学生/)).toBeVisible();
      await expect(
        overflowPage.getByRole('button', { name: '查询成绩簿', exact: true }),
      ).toBeEnabled();
      assert.deepEqual(downloads, []);
      await overflowPage.screenshot({
        path: 'docs/v2/evidence/zhiban-gradebook-export-limit-local.png',
        fullPage: true,
      });
    } finally {
      await overflowContext.close();
    }
    await admin.query(
      "UPDATE zhiban_learning.activities SET status='WITHDRAWN' WHERE tenant_id=$1 AND id=$2",
      [tenant, activityIds[17]],
    );
    await addStudents(memberIds.slice(498)); // 501 total, within 20 activities.
    assert.equal((await raw()).status, 413);
    assert.equal((await raw('?q=' + student.member)).status, 200); // Narrowing resolves row/product bound.
    record(
      'PG16 bounded snapshot accepts 100 activities and exactly 500×20=10000 cells; rejects 101 activities (including zero matching students), 501 students, and 500×21 product without CSV/truncated success; narrowed filter succeeds; browser shows overflow guidance, restores controls and downloads nothing',
    );
    try {
      await admin.query(
        "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$3 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$4",
        [tenant, trial.offeringId, Date.now(), teacher.member],
      );
      assert.equal((await raw('?q=' + student.member)).status, 403);
    } finally {
      await admin.query(
        "UPDATE zhiban_academic.assignments SET status='ACTIVE',valid_until=NULL WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
        [tenant, trial.offeringId, teacher.member],
      );
    }
    record(
      'teacher assignment revoked after successful export is denied on next export; original authorization barriers retained',
    );
  } finally {
    // No immutable publication deletion or Identity mutation cleanup; owned cluster is disposed.
    await admin.query(
      "UPDATE zhiban_learning.activities SET status='WITHDRAWN' WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
      [tenant, activityIds],
    );
    await admin.query(
      'DELETE FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND NOT(membership_id=ANY($3::uuid[]))',
      [tenant, trial.offeringId, original],
    );
  }
}
