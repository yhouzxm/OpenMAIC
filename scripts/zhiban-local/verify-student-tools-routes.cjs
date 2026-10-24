/* eslint-disable @typescript-eslint/no-require-imports -- Real LOCAL compatibility journey, no model call. */
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
async function main() {
  const meta = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(meta.evidenceOrigin, 'LOCAL');
  assert.equal(meta.githubActions, false);
  assert.equal(meta.origin, 'https://127.0.0.1:3461');
  const accounts = JSON.parse(fs.readFileSync(meta.accountsPath)).accounts,
    origin = meta.origin,
    tenant = meta.trial.tenantId,
    offering = meta.trial.offeringId;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    checks = [],
    errors = [],
    commands = [];
  const contexts = [];
  async function actor(role) {
    const c = await browser.newContext();
    contexts.push(c);
    const p = await c.newPage(),
      a = accounts.find((x) => x.role === role);
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/zhiban/tutor/'))
        commands.push(r.postDataJSON().type);
    });
    await p.goto(origin + '/zhiban?space=' + tenant);
    await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(a.userId);
    await p.getByLabel('密码', { exact: true }).fill(a.password);
    await p.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(p.getByRole('link', { name: '个人资料与账户', exact: true })).toBeVisible();
    return p;
  }
  let course, sessionId;
  try {
    const anon = await browser.newPage();
    await anon.goto(origin + '/zhiban/student/tools');
    await expect(anon.getByText('请先返回工作台登录。', { exact: true })).toBeVisible();
    await anon.close();
    const s = await actor('STUDENT'),
      t = await actor('TEACHER');
    const global = origin + '/zhiban/student/tools?space=' + tenant;
    await s.getByRole('link', { name: 'AI 学习辅导', exact: true }).click();
    await expect(s).toHaveURL(global);
    await s.getByLabel('搜索课程或教学班', { exact: true }).fill('试用');
    await s.getByLabel('AI 学习辅导入口每页条数', { exact: true }).selectOption('10');
    await s.getByRole('button', { name: '查询AI 学习辅导课程', exact: true }).click();
    const entry = s.getByRole('link', { name: '进入课程 AI 学习辅导', exact: true });
    await expect(entry).toHaveCount(1);
    course = /\/courses\/([0-9a-f-]+)\//.exec(await entry.getAttribute('href'))[1];
    const legacy =
        origin + `/zhiban/student/courses/${course}/tools?space=${tenant}&offering=${offering}`,
      canonical =
        origin + `/zhiban/student/courses/${course}/tutor?space=${tenant}&offering=${offering}`,
      teacher =
        origin + `/zhiban/teacher/courses/${course}/tutor?space=${tenant}&offering=${offering}`;
    await entry.click();
    await expect(s).toHaveURL(legacy);
    await expect(s.getByRole('heading', { name: 'AI 学习辅导', exact: true })).toBeVisible();
    await expect(s.getByText(/教师尚未启用本班 AI 辅导/)).toBeVisible();
    await expect(s.getByRole('button', { name: '新建私人对话', exact: true })).toBeDisabled();
    await expect(
      s.getByText('旧课程工具入口复用课程 Tutor；AI Peer 和工具型 Agent 未启用。', { exact: true }),
    ).toBeVisible();
    await expect(s.getByText('教师设置', { exact: true })).toHaveCount(0);
    await expect(s.getByRole('link', { name: 'AI 学习辅导', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await s.getByRole('link', { name: '返回 AI 学习辅导课程列表', exact: true }).click();
    await expect(s.getByLabel('搜索课程或教学班', { exact: true })).toHaveValue('试用');
    await expect(s.getByLabel('AI 学习辅导入口每页条数', { exact: true })).toHaveValue('10');
    await s.goto(global + '&courseId=' + course);
    await entry.click();
    await expect(s).toHaveURL(legacy + '&toolsCourse=' + course);
    await s.getByRole('link', { name: '返回 AI 学习辅导课程列表', exact: true }).click();
    await expect(s).toHaveURL(global + '&courseId=' + course);
    await s.goto(origin + `/zhiban/student/courses/${course}/tools`);
    await expect(s.getByText('请先选择辅导课程所在空间和教学班。', { exact: true })).toBeVisible();
    await s.getByRole('link', { name: '返回 AI 学习辅导课程列表', exact: true }).click();
    await expect(entry).toHaveCount(1);
    await s.goto(origin + '/zhiban/student/tools');
    await expect(s).toHaveURL(global);
    await expect(entry).toHaveCount(1);
    checks.push(
      'Student sidebar/search/pagination controls and courseId return; bare old deep link selects a governed offering; teacher-disabled Tutor blocks new session; Peer remains gated',
    );
    await t.goto(teacher);
    await t.getByText('教师设置', { exact: true }).click();
    await t.getByLabel('为本教学班启用 AI 辅导', { exact: true }).check();
    await t.getByRole('button', { name: '保存辅导设置', exact: true }).click();
    await expect(t.getByText(/教师已启用本班 AI 辅导/)).toBeVisible();
    await s.goto(legacy);
    const create = s.getByRole('button', { name: '新建私人对话', exact: true });
    await expect(create).toBeEnabled();
    await s.getByLabel('新对话标题', { exact: true }).fill('旧入口兼容：本人空对话');
    const response = s.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/offerings/' + offering),
    );
    await create.click();
    const created = await (await response).json();
    sessionId = created.id;
    assert.ok(sessionId);
    await expect(
      s.getByRole('heading', { name: '旧入口兼容：本人空对话', exact: true }),
    ).toBeVisible();
    await s.getByLabel('向 AI 提问', { exact: true }).fill('尚未发送的问题');
    s.once('dialog', (d) => d.dismiss());
    await s.getByRole('link', { name: '返回 AI 学习辅导课程列表', exact: true }).click();
    await expect(s.getByLabel('向 AI 提问', { exact: true })).toHaveValue('尚未发送的问题');
    await s.getByLabel('向 AI 提问', { exact: true }).fill('');
    await s.getByRole('button', { name: '结束此对话', exact: true }).click();
    await expect(
      s.getByRole('heading', { name: '旧入口兼容：本人空对话 · 已结束', exact: true }),
    ).toBeVisible();
    await s.goto(canonical);
    await s.getByRole('button', { name: '旧入口兼容：本人空对话 · 已结束', exact: true }).click();
    await expect(
      s.getByRole('heading', { name: '旧入口兼容：本人空对话 · 已结束', exact: true }),
    ).toBeVisible();
    await s.getByRole('link', { name: '目录', exact: true }).click();
    await s.getByRole('link', { name: 'AI 学习辅导', exact: true }).click();
    await expect(s).toHaveURL(legacy);
    await s.getByRole('button', { name: '旧入口兼容：本人空对话 · 已结束', exact: true }).click();
    await s.screenshot({
      path: 'docs/v2/evidence/student-tools-routes/student-tools.png',
      fullPage: true,
    });
    await t.reload();
    await expect(t.getByText(/教师已启用本班 AI 辅导/)).toBeVisible();
    await expect(
      t.getByRole('button', { name: '旧入口兼容：本人空对话 · 已结束', exact: true }),
    ).toHaveCount(0);
    const forbidden = await t.evaluate(
      async (url) =>
        (
          await fetch(url, {
            headers: { 'x-zhiban-request': 'identity-v1' },
            credentials: 'same-origin',
            cache: 'no-store',
          })
        ).status,
      origin + `/api/zhiban/tutor/${tenant}/offerings/${offering}?mode=TEACHER&id=${sessionId}`,
    );
    assert.equal(forbidden, 404);
    await t.getByText('教师设置', { exact: true }).click();
    await t.getByLabel('为本教学班启用 AI 辅导', { exact: true }).uncheck();
    await t.getByRole('button', { name: '保存辅导设置', exact: true }).click();
    await expect(t.getByText(/教师尚未启用本班 AI 辅导/)).toBeVisible();
    await s.reload();
    await expect(s.getByText(/教师尚未启用本班 AI 辅导/)).toBeVisible();
    await expect(create).toBeDisabled();
    await s.getByRole('button', { name: '旧入口兼容：本人空对话 · 已结束', exact: true }).click();
    await expect(
      s.getByRole('heading', { name: '旧入口兼容：本人空对话 · 已结束', exact: true }),
    ).toBeVisible();
    checks.push(
      'Original teacher policy enabled then restored disabled; real student CREATE_SESSION/CLOSE_SESSION shared across legacy/canonical Tutor and reload; unsent question cancellation retained; teacher list/read cannot access student private session; closed-policy personal history remains available; no ASK/model call',
    );
    for (const q of ['?space=bad', '?space=' + tenant + '&space=' + tenant, '?next=outside']) {
      await s.goto(origin + '/zhiban/student/tools' + q);
      await expect(
        s.getByText('AI 学习辅导入口地址无效，请从工作台进入。', { exact: true }),
      ).toBeVisible();
    }
    for (const q of [
      '&toolsCourse=00000000-0000-7000-8000-000000000001',
      '&next=outside',
      '&offering=' + offering,
    ]) {
      await s.goto(legacy + q);
      await expect(s.getByText(/地址无效/)).toBeVisible();
      await expect(s.getByRole('heading', { name: 'AI 学习辅导', exact: true })).toHaveCount(0);
    }
    await s.goto(
      origin +
        `/zhiban/student/courses/${course}/tools?space=${tenant}&offering=00000000-0000-7000-8000-000000000001`,
    );
    await expect(
      s.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
    ).toBeVisible();
    for (const p of [t, await actor('ADMIN')]) {
      await p.goto(global);
      await expect(
        p.getByText('当前身份不具备此 AI 学习辅导入口的角色，请返回工作台。', { exact: true }),
      ).toBeVisible();
      await p.goto(legacy);
      await expect(
        p.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
      ).toBeVisible();
    }
    for (const path of [
      '/zhiban/teacher/tools',
      `/zhiban/teacher/courses/${course}/tools`,
      '/zhiban/student/tools/extra',
    ]) {
      const r = await s.goto(origin + path);
      assert.equal(r.status(), 404);
    }
    checks.push(
      'Malformed/duplicate/unknown context and wrong course offering rejected; teacher/admin cannot impersonate student tools; unsupported paths remain 404',
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(commands, ['SET_POLICY', 'CREATE_SESSION', 'CLOSE_SESSION', 'SET_POLICY']);
  } finally {
    for (const c of contexts) await c.close();
    await browser.close();
  }
  const files = [
    'global-tools.js',
    'global-tools.html',
    'course-page.js',
    'client.js',
    'workspace.js',
    'tutor.js',
  ]
    .map((x) => 'app/zhiban/local/' + x)
    .concat(
      [
        'request-target.ts',
        'server.ts',
        'verify-m6-catalog.mts',
        'verify-student-tools-routes.cjs',
      ].map((x) => 'scripts/zhiban-local/' + x),
    );
  const receipt = {
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    status: 'PASS',
    at: new Date().toISOString(),
    root: meta.root,
    scope: 'STUDENT_LEGACY_TOOLS_USING_EXISTING_COURSE_TUTOR',
    checks,
    commands,
    modelCalls: false,
    policyRestored: 'DISABLED',
    syntheticPrivateSession: {
      id: sessionId,
      title: '旧入口兼容：本人空对话',
      state: 'CLOSED',
      turnCount: 0,
    },
    sourceHashes: Object.fromEntries(
      files.map((p) => [p, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]),
    ),
    excluded: [
      'No ASK/provider response invented or model rerun',
      'No Peer/tool Agent/Runtime enablement',
      'No new API/schema/ACL/migration',
      'No multi-space/multi-page fixture journey',
      'No full classroom/PG16/CI rerun',
    ],
  };
  fs.writeFileSync(
    'docs/v2/evidence/student-tools-routes/browser-local.json',
    JSON.stringify(receipt, null, 2) + '\n',
  );
  console.log(JSON.stringify({ status: 'PASS', checks, commands }));
}
main().catch((e) => {
  console.error(String(e.message ?? e).split('Call log:')[0]);
  process.exitCode = 1;
});
