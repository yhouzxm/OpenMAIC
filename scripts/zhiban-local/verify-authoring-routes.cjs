/* eslint-disable @typescript-eslint/no-require-imports -- Standalone LOCAL browser journey. */
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
async function main() {
  const meta = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(meta.evidenceOrigin, 'LOCAL');
  assert.equal(meta.githubActions, false);
  assert.equal(meta.origin, 'https://127.0.0.1:3461');
  const accounts = JSON.parse(fs.readFileSync(meta.accountsPath)).accounts;
  const origin = meta.origin,
    tenant = meta.trial.tenantId,
    offering = meta.trial.offeringId;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    checks = [];
  let course;
  try {
    const anon = await browser.newContext(),
      page = await anon.newPage();
    await page.goto(origin + '/zhiban/teacher/agents');
    await expect(page.getByText('请先返回工作台登录。', { exact: true })).toBeVisible();
    await anon.close();
    for (const role of ['TEACHER', 'STUDENT', 'ADMIN']) {
      const c = await browser.newContext(),
        p = await c.newPage(),
        a = accounts.find((a) => a.role === role);
      const errors = [],
        writes = [],
        aiReads = [];
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('request', (r) => {
        if (r.method() === 'POST' && !r.url().includes('/identity/login'))
          writes.push(new URL(r.url()).pathname);
        if (/\/api\/zhiban\/content\/.*\/ai$/.test(new URL(r.url()).pathname))
          aiReads.push(r.method());
      });
      try {
        await p.goto(origin + '/zhiban?space=' + tenant);
        await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(a.userId);
        await p.getByLabel('密码', { exact: true }).fill(a.password);
        await p.getByRole('button', { name: '登录并进入', exact: true }).click();
        await expect(p.getByRole('link', { name: '个人资料与账户', exact: true })).toBeVisible();
        const global = origin + '/zhiban/teacher/agents?space=' + tenant;
        if (role === 'TEACHER') {
          await p.getByRole('link', { name: 'AI 备课', exact: true }).click();
          await expect(p).toHaveURL(global);
          await p.getByLabel('搜索课程或教学班', { exact: true }).fill('试用');
          await p.getByLabel('AI 备课入口每页条数', { exact: true }).selectOption('10');
          await p.getByRole('button', { name: '查询AI 备课课程', exact: true }).click();
          const entry = p.getByRole('link', { name: '进入课程 AI 备课', exact: true });
          await expect(entry).toHaveCount(1);
          const href = await entry.getAttribute('href');
          course = /\/courses\/([0-9a-f-]+)\//.exec(href)[1];
          await entry.click();
          const panel = p.getByRole('region', { name: '教师 AI 备课', exact: true });
          await expect(panel).toBeVisible();
          await expect(p.getByLabel('备课要求', { exact: true })).toBeVisible();
          await expect(p.getByRole('button', { name: '生成讲义草稿', exact: true })).toBeEnabled();
          await expect(
            p.getByText('模型已配置；每次生成会调用配置的模型并可能产生费用。', { exact: true }),
          ).toBeVisible();
          await expect(p.getByRole('link', { name: 'AI 备课', exact: true })).toHaveAttribute(
            'aria-current',
            'page',
          );
          await expect(p.getByLabel('新内容标题', { exact: true })).toBeVisible({ timeout: 15000 });
          const brief = p.getByLabel('备课要求', { exact: true });
          await brief.fill('未保存备课要求');
          p.once('dialog', (d) => d.dismiss());
          await p.getByRole('link', { name: '返回教师 AI 备课课程列表', exact: true }).click();
          await expect(brief).toHaveValue('未保存备课要求');
          p.once('dialog', (d) => d.accept());
          await p.getByRole('link', { name: '返回教师 AI 备课课程列表', exact: true }).click();
          await expect(p).toHaveURL(global);
          await expect(p.getByLabel('搜索课程或教学班', { exact: true })).toHaveValue('试用');
          await expect(p.getByLabel('AI 备课入口每页条数', { exact: true })).toHaveValue('10');
          await p.goto(global + '&courseId=' + course);
          await expect(entry).toHaveCount(1);
          await entry.click();
          await expect(
            p.getByText('暂无备课任务；填写要求后可开始生成。', { exact: true }),
          ).toBeVisible();
          const old =
            origin +
            `/zhiban/teacher/courses/${course}/agents?space=${tenant}&offering=${offering}&aiCourse=${course}`;
          await expect(p).toHaveURL(old);
          await expect(p.getByLabel('备课要求', { exact: true })).toBeVisible();
          await p.screenshot({
            path: 'docs/v2/evidence/authoring-routes/teacher-course.png',
            fullPage: true,
          });
          await p.getByRole('link', { name: '返回教师 AI 备课课程列表', exact: true }).click();
          await expect(p).toHaveURL(global + '&courseId=' + course);
          await p.screenshot({
            path: 'docs/v2/evidence/authoring-routes/teacher-selector.png',
            fullPage: true,
          });
          await p.goto(origin + `/zhiban/teacher/courses/${course}/agents`);
          await expect(
            p.getByText('请先选择备课课程所在空间和教学班。', { exact: true }),
          ).toBeVisible();
          await p.getByRole('link', { name: '返回教师 AI 备课课程列表', exact: true }).click();
          await expect(entry).toHaveCount(1);
          await p.goto(origin + '/zhiban/teacher/agents');
          await expect(p).toHaveURL(global);
          await expect(entry).toHaveCount(1);
          for (const q of [
            '?space=bad',
            '?space=' + tenant + '&space=' + tenant,
            '?next=outside',
          ]) {
            await p.goto(origin + '/zhiban/teacher/agents' + q);
            await expect(
              p.getByText('AI 备课入口地址无效，请从工作台进入。', { exact: true }),
            ).toBeVisible();
          }
          for (const tail of [
            '&aiCourse=00000000-0000-7000-8000-000000000001',
            '&next=outside',
            '&offering=' + offering,
          ]) {
            await p.goto(
              origin +
                `/zhiban/teacher/courses/${course}/agents?space=${tenant}&offering=${offering}` +
                tail,
            );
            await expect(p.getByLabel('备课要求', { exact: true })).toHaveCount(0);
            await expect(p.getByText(/地址无效/)).toBeVisible();
          }
          await p.goto(
            origin +
              `/zhiban/teacher/courses/${course}/agents?space=${tenant}&offering=00000000-0000-7000-8000-000000000001`,
          );
          await expect(
            p.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
          ).toBeVisible();
          // Canonical resources and course overview both retain a working AI navigation entry.
          await p.goto(
            origin +
              `/zhiban/teacher/courses/${course}/resources?space=${tenant}&offering=${offering}`,
          );
          await expect(p.getByLabel('新内容标题', { exact: true })).toBeVisible({ timeout: 15000 });
          await p.getByRole('link', { name: 'AI 备课', exact: true }).click();
          await expect(brief).toBeVisible();
          await p.getByRole('link', { name: '课程概览', exact: true }).click();
          await p.getByRole('link', { name: 'AI 备课', exact: true }).click();
          await expect(brief).toBeVisible();
          checks.push(
            'TEACHER: sidebar/filter -> old course URL -> existing model capability/editor; open AI panel; unsaved cancel retains brief; returns preserve query/courseId; bare bookmarks recover; invalid contexts denied; canonical course navigation works',
          );
        } else {
          await expect(p.getByRole('link', { name: 'AI 备课', exact: true })).toHaveCount(0);
          await p.goto(global);
          await expect(
            p.getByText('当前身份不具备此 AI 备课入口的角色，请返回工作台。', { exact: true }),
          ).toBeVisible();
          await p.goto(
            origin +
              `/zhiban/teacher/courses/${course}/agents?space=${tenant}&offering=${offering}`,
          );
          await expect(
            p.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
          ).toBeVisible();
          await expect(p.getByLabel('备课要求', { exact: true })).toHaveCount(0);
          assert.deepEqual(aiReads, []);
          checks.push(
            role + ': global and old course authoring entries denied; no generation API requests',
          );
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
      } finally {
        await c.close();
      }
    }
    const p = await browser.newPage();
    for (const path of [
      '/zhiban/student/agents',
      `/zhiban/student/courses/${course}/agents`,
      '/zhiban/teacher/agents/extra',
    ]) {
      const r = await p.goto(origin + path);
      assert.equal(r.status(), 404);
    }
    await p.close();
  } finally {
    await browser.close();
  }
  const files = [
    'global-authoring.js',
    'global-authoring.html',
    'client.js',
    'workspace.js',
    'course-page.js',
    'lesson.js',
  ]
    .map((x) => 'app/zhiban/local/' + x)
    .concat(
      [
        'request-target.ts',
        'server.ts',
        'verify-m6-catalog.mts',
        'verify-authoring-routes.cjs',
      ].map((x) => 'scripts/zhiban-local/' + x),
    );
  const receipt = {
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    status: 'PASS',
    at: new Date().toISOString(),
    root: meta.root,
    scope: 'TWO_TEACHER_LEGACY_AUTHORING_ROUTES_REUSING_EXISTING_PIPELINE',
    checks,
    businessWrites: false,
    modelCalls: false,
    studentOrAdminGenerationRequests: 0,
    sourceHashes: Object.fromEntries(
      files.map((p) => [p, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]),
    ),
    excluded: [
      'No completed generation run injected',
      'No new generation/adoption/publication writes; previous real-model receipts retain independent scope',
      'No multi-space/multi-page fixture journey',
      'No Agent intervention/Peer/monitor enablement',
      'No full classroom/PG16/CI rerun',
    ],
  };
  fs.writeFileSync(
    'docs/v2/evidence/authoring-routes/browser-local.json',
    JSON.stringify(receipt, null, 2) + '\n',
  );
  console.log(JSON.stringify({ status: 'PASS', checks }));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
