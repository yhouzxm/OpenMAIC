/* eslint-disable @typescript-eslint/no-require-imports -- Standalone LOCAL browser verifier. */
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
async function main() {
  const m = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(m.evidenceOrigin, 'LOCAL');
  assert.equal(m.githubActions, false);
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  const accounts = JSON.parse(fs.readFileSync(m.accountsPath)).accounts,
    origin = m.origin,
    tenant = m.trial.tenantId,
    offering = m.trial.offeringId;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    checks = [];
  try {
    const c = await browser.newContext(),
      p = await c.newPage();
    try {
      for (const role of ['teacher', 'student']) {
        await p.goto(origin + `/zhiban/${role}/grades`);
        await expect(p.getByText('请先返回工作台登录。', { exact: true })).toBeVisible();
        await expect(p.getByRole('link', { name: /进入课程成绩簿|查看本人课程成绩/ })).toHaveCount(
          0,
        );
      }
      checks.push(
        'Anonymous teacher/student legacy entries require original login and reveal no grade/course data',
      );
    } finally {
      await c.close();
    }
    for (const role of ['TEACHER', 'STUDENT']) {
      const c = await browser.newContext(),
        p = await c.newPage(),
        a = accounts.find((x) => x.role === role),
        kind = role.toLowerCase(),
        base = `/zhiban/${kind}/grades`,
        url = origin + base + '?space=' + tenant;
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      try {
        await p.goto(origin + '/zhiban?space=' + tenant);
        await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(a.userId);
        await p.getByLabel('密码', { exact: true }).fill(a.password);
        await p.getByRole('button', { name: '登录并进入', exact: true }).click();
        const nav = p.getByRole('link', {
          name: role === 'TEACHER' ? '学生成绩' : '测评与成绩',
          exact: true,
        });
        await expect(nav).toHaveAttribute('href', base + '?space=' + tenant);
        await nav.click();
        await expect(
          p.getByRole('heading', {
            name: role === 'TEACHER' ? '学生成绩' : '测评与我的成绩',
            exact: true,
          }),
        ).toBeVisible();
        const search = p.getByLabel('搜索课程或教学班', { exact: true });
        await search.fill('试用');
        await p.getByLabel('成绩入口每页条数', { exact: true }).selectOption('10');
        await p.getByRole('button', { name: '查询成绩课程', exact: true }).click();
        await expect(p.getByRole('button', { name: '查询成绩课程', exact: true })).toBeEnabled();
        const entry = p.getByRole('link', {
          name: role === 'TEACHER' ? '进入课程成绩簿' : '查看本人课程成绩',
          exact: true,
        });
        await expect(entry).toHaveCount(1);
        await expect(p.getByRole('button', { name: '上一页成绩课程', exact: true })).toBeDisabled();
        await expect(p.getByRole('button', { name: '下一页成绩课程', exact: true })).toBeDisabled();
        await entry.click();
        await expect(p).toHaveURL(
          new RegExp(
            `/zhiban/${kind}/courses/[0-9a-f-]+/grades\\?space=${tenant}&offering=${offering}`,
          ),
        );
        if (role === 'TEACHER') {
          await expect(p.getByRole('heading', { name: '课程成绩簿', exact: true })).toBeVisible();
          await expect(
            p.getByRole('button', { name: '按查询条件跨页导出 CSV', exact: true }),
          ).toBeVisible();
        } else {
          await expect(p.getByText(/88 \/ 100/).first()).toBeVisible();
          await expect(p.getByRole('button', { name: '发布成绩', exact: true })).toHaveCount(0);
        }
        await p.getByRole('link', { name: '返回全局成绩入口', exact: true }).click();
        await expect(search).toHaveValue('试用');
        await expect(p.getByLabel('成绩入口每页条数', { exact: true })).toHaveValue('10');
        await p.reload();
        await expect(search).toHaveValue('试用');
        await search.fill('不存在的课程XYZ');
        await p.getByRole('button', { name: '查询成绩课程', exact: true }).click();
        await expect(p.getByRole('button', { name: '查询成绩课程', exact: true })).toBeEnabled();
        await expect(p.getByText('暂无匹配的可访问成绩课程。', { exact: true })).toBeVisible();
        await search.fill('');
        await p.getByLabel('教学班状态', { exact: true }).selectOption('CLOSED');
        await p.getByRole('button', { name: '查询成绩课程', exact: true }).click();
        await expect(p.getByRole('button', { name: '查询成绩课程', exact: true })).toBeEnabled();
        await expect(p.getByText('暂无匹配的可访问成绩课程。', { exact: true })).toBeVisible();
        await p.getByLabel('教学班状态', { exact: true }).selectOption('ALL');
        await p.getByRole('button', { name: '查询成绩课程', exact: true }).click();
        await expect(p.getByRole('button', { name: '查询成绩课程', exact: true })).toBeEnabled();
        await expect(entry).toHaveCount(1);
        const href = await entry.getAttribute('href'),
          course = /\/courses\/([0-9a-f-]+)\//.exec(href)[1];
        await p.goto(origin + base + '?tenant=' + tenant + '&courseId=' + course);
        await expect(entry).toHaveCount(1);
        await expect(
          p.getByText('当前按旧链接指定课程筛选教学班。', { exact: true }),
        ).toBeVisible();
        await entry.click();
        await expect(p.getByRole('link', { name: '返回全局成绩入口', exact: true })).toBeVisible();
        await p.getByRole('link', { name: '返回全局成绩入口', exact: true }).click();
        await expect(p).toHaveURL(url + '&courseId=' + course);
        await expect(entry).toHaveCount(1);
        await p.getByRole('link', { name: '显示全部课程', exact: true }).click();
        await expect(p).toHaveURL(url);
        for (const suffix of [
          '?space=bad',
          '?space=' + tenant + '&space=' + tenant,
          '?tenant=' + tenant + '&space=' + tenant,
          '?courseId=123',
          '?next=outside',
        ]) {
          await p.goto(origin + base + suffix);
          await expect(
            p.getByText('成绩入口地址无效，请从工作台进入。', { exact: true }),
          ).toBeVisible();
          await expect(
            p.getByRole('link', { name: /进入课程成绩簿|查看本人课程成绩/ }),
          ).toHaveCount(0);
        }
        await p.goto(origin + base + '?space=00000000-0000-7000-8000-000000000001');
        await expect(
          p.getByText('当前空间不可访问，请返回工作台。', { exact: true }),
        ).toBeVisible();
        await p.goto(
          origin + `/zhiban/${role === 'TEACHER' ? 'student' : 'teacher'}/grades?space=${tenant}`,
        );
        await expect(
          p.getByText('当前身份不具备此成绩入口的角色，请返回工作台。', { exact: true }),
        ).toBeVisible();
        const response = await p.goto(origin + base + '/extra');
        assert.equal(response.status(), 404);
        await p.goto(origin + base);
        await expect(p).toHaveURL(url);
        await expect(entry).toHaveCount(1);
        await p.screenshot({
          path: 'docs/v2/evidence/global-grades/' + kind + '.png',
          fullPage: true,
        });
        await p.getByRole('link', { name: '返回当前空间工作台', exact: true }).click();
        await expect(p).toHaveURL(origin + '/zhiban?space=' + tenant);
        assert.deepEqual(errors, []);
        checks.push(
          role +
            ': sidebar -> bounded searchable/state-filtered course selector -> existing authorized course grades -> sticky return/reload; correct gradebook or own 88/100; legacy courseId/tenant and bare bookmark; wrong role/space/malformed contexts denied',
        );
      } finally {
        await c.close();
      }
    }
  } finally {
    await browser.close();
  }
  const paths = [
    'app/zhiban/local/global-grades.html',
    'app/zhiban/local/global-grades.js',
    'app/zhiban/local/client.js',
    'app/zhiban/local/course-page.js',
    'scripts/zhiban-local/request-target.ts',
    'scripts/zhiban-local/verify-m6-catalog.mts',
    'scripts/zhiban-local/server.ts',
    'scripts/zhiban-local/verify-global-grades.cjs',
  ];
  fs.writeFileSync(
    'docs/v2/evidence/global-grades/browser-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        at: new Date().toISOString(),
        scope: 'GLOBAL_GRADE_ENTRY_ROUTES_AND_AUTHORIZED_COURSE_RETURN_ONLY',
        root: require('node:path').dirname(m.accountsPath),
        tenant,
        checks,
        businessWrites: false,
        sourceHashes: Object.fromEntries(
          paths.map((p) => [
            p,
            crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
          ]),
        ),
        excluded: [
          'No new totals/weights/appeals or global student CSV',
          'No multi-page/multi-space real fixture coverage; existing Workspace API pagination reused',
          'No full classroom/PG16 regression/CI',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ status: 'PASS', checks }));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
