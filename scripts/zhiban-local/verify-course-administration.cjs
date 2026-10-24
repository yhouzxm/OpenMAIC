/* eslint-disable @typescript-eslint/no-require-imports -- Real owned LOCAL PG16/API/browser journey. */
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
async function main() {
  const meta = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(meta.evidenceOrigin, 'LOCAL');
  assert.equal(meta.githubActions, false);
  assert.equal(meta.origin, 'https://127.0.0.1:3461');
  assert.equal(meta.port, 56517);
  const accounts = JSON.parse(fs.readFileSync(meta.accountsPath)).accounts,
    origin = meta.origin,
    tenant = meta.trial.tenantId,
    offering = meta.trial.offeringId;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    contexts = [],
    errors = [],
    commands = [],
    checks = [];
  async function actor(role) {
    const c = await browser.newContext();
    contexts.push(c);
    const p = await c.newPage(),
      a = accounts.find((a) => a.role === role);
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/management/'))
        commands.push(r.postDataJSON().type);
    });
    await p.goto(origin + '/zhiban?space=' + tenant);
    await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(a.userId);
    await p.getByLabel('密码', { exact: true }).fill(a.password);
    await p.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(p.getByRole('link', { name: '个人资料与账户', exact: true })).toBeVisible();
    return p;
  }
  async function api(p, path, body) {
    return p.evaluate(
      async ({ path, body }) => {
        const headers = { 'x-zhiban-request': 'identity-v1' };
        if (body) {
          const r = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
          if (!r.ok) throw Error('CSRF unavailable');
          headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
          headers['Content-Type'] = 'application/json';
          headers['x-zhiban-command'] = crypto.randomUUID().replaceAll('-', '');
        }
        const r = await fetch(path, {
          method: body ? 'POST' : 'GET',
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, json: await r.json() };
      },
      { path, body },
    );
  }
  let course,
    manager,
    ended = false,
    member;
  const manage = `/api/zhiban/management/${tenant}`,
    base = `/api/zhiban/workspace/${tenant}/teachers`;
  async function relation() {
    const r = await api(
      manager,
      manage + '/assignments?offering=' + offering + '&state=ALL&limit=50',
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.rows.length, 1);
    return r.json.rows[0];
  }
  async function restore() {
    const row = await relation();
    const r = await api(manager, manage + '/commands', {
      type: 'ASSIGN_TEACHER',
      offeringId: offering,
      membershipId: member,
      revision: row.revision,
    });
    assert.equal(r.status, 200);
    ended = false;
  }
  try {
    const anon = await browser.newPage();
    await anon.goto(origin + '/zhiban');
    assert.equal((await api(anon, origin + base + '?offering=' + offering)).status, 401);
    await anon.close();
    const t = await actor('TEACHER');
    manager = await actor('ADMIN');
    const courses = await api(t, `/api/zhiban/workspace/${tenant}/courses?q=${offering}&limit=50`);
    assert.equal(courses.status, 200);
    course = courses.json.rows[0].course_id;
    const page = (part) =>
      origin + `/zhiban/teacher/courses/${course}/${part}?space=${tenant}&offering=${offering}`;
    await t.goto(origin + `/zhiban/teacher/courses/${course}?space=${tenant}&offering=${offering}`);
    await t.getByRole('link', { name: '课程设置', exact: true }).click();
    await expect(t).toHaveURL(page('settings'));
    const root = t.locator('#course-administration');
    await expect(root.getByRole('heading', { name: '课程设置', exact: true })).toBeVisible();
    await expect(root.getByRole('definition')).toContainText([
      '试用课程：机电入门',
      '本地合成教学数据，可自由练习；停止后删除，不用于真实教学。',
      '1',
      '试用教学班',
      'TRY_01',
      '试用学期',
      '20',
      '开放',
      '1',
    ]);
    await expect(root.locator('input,textarea,select')).toHaveCount(0);
    for (const [label, part] of [
      ['编辑讲义与图片', 'resources'],
      ['教师 AI 备课', 'agents'],
      ['设置课程 AI 辅导', 'tutor'],
    ]) {
      await root.getByRole('link', { name: label, exact: true }).click();
      await expect(t).toHaveURL(page(part));
      await t.getByRole('link', { name: '课程设置', exact: true }).click();
      await expect(root.getByRole('heading', { name: '课程设置', exact: true })).toBeVisible();
    }
    await t.screenshot({
      path: 'docs/v2/evidence/course-administration/settings.png',
      fullPage: true,
    });
    await root.getByRole('link', { name: '查看任教名单', exact: true }).click();
    await expect(t).toHaveURL(page('teachers'));
    await expect(root.getByRole('heading', { name: '周老师', exact: true })).toBeVisible();
    await t.getByLabel('搜索任教姓名', { exact: true }).fill('周');
    await t.getByLabel('任教名单每页条数', { exact: true }).selectOption('10');
    await t.getByRole('button', { name: '查询任教名单', exact: true }).click();
    await expect(root.getByRole('heading', { name: '周老师', exact: true })).toBeVisible();
    const data = await api(
      t,
      base + '?offering=' + offering + '&q=' + encodeURIComponent('周') + '&limit=10',
    );
    assert.equal(data.status, 200);
    assert.equal(data.json.rows.length, 1);
    assert.deepEqual(Object.keys(data.json.rows[0]).sort(), ['id', 'name', 'valid_from']);
    assert.equal(data.json.nextCursor, null);
    await t.screenshot({
      path: 'docs/v2/evidence/course-administration/teachers.png',
      fullPage: true,
    });
    await t.getByLabel('搜索任教姓名', { exact: true }).fill('%_');
    await t.getByRole('button', { name: '查询任教名单', exact: true }).click();
    await expect(t.getByText('暂无匹配的任教关系。', { exact: true })).toBeVisible();
    await t.getByLabel('搜索任教姓名', { exact: true }).fill('');
    await t.getByRole('button', { name: '查询任教名单', exact: true }).click();
    await expect(root.getByRole('heading', { name: '周老师', exact: true })).toBeVisible();
    checks.push(
      'Teacher overview -> read-only published-version/offering settings -> existing content/AI/Tutor links -> settings; bounded current assignment-name projection; Chinese search and literal wildcard empty result; no private Identity/profile fields',
    );
    for (const q of [
      '',
      '?offering=' + offering + '&limit=100',
      '?offering=' + offering + '&member=' + offering,
      '?offering=' + offering + '&cursor=bad',
    ]) {
      assert.equal((await api(t, base + q)).status, 400);
    }
    assert.equal(
      (await api(t, base + '?offering=00000000-0000-7000-8000-000000000001')).status,
      403,
    );
    assert.equal(
      (
        await api(
          t,
          `/api/zhiban/workspace/00000000-0000-7000-8000-000000000001/teachers?offering=${offering}`,
        )
      ).status,
      403,
    );
    assert.equal((await api(t, manage + '/assignments?offering=' + offering)).status, 403);
    for (const who of [await actor('STUDENT'), manager]) {
      assert.equal((await api(who, base + '?offering=' + offering)).status, 403);
      for (const part of ['settings', 'teachers']) {
        await who.goto(page(part));
        await expect(
          who.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
        ).toBeVisible();
        await expect(who.locator('#course-administration')).toHaveCount(0);
      }
    }
    // Real PG16 revocation and restoration through existing administrator commands, no owner SQL writes.
    const row = await relation();
    member = row.membership_id;
    const end = await api(manager, manage + '/commands', {
      type: 'END_TEACHER',
      id: row.id,
      revision: row.revision,
    });
    assert.equal(end.status, 200);
    ended = true;
    assert.equal((await api(t, base + '?offering=' + offering)).status, 403);
    await t.getByRole('button', { name: '刷新任教名单', exact: true }).click();
    await expect(
      t.getByText('任教资格或会话已变化，请返回我的课程重新进入。', { exact: true }),
    ).toBeVisible();
    await expect(root.getByRole('heading', { name: '周老师', exact: true })).toHaveCount(0);
    await t.goto(page('settings'));
    await expect(
      t.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
    ).toBeVisible();
    await restore();
    await t.goto(page('teachers'));
    await expect(root.getByRole('heading', { name: '周老师', exact: true })).toBeVisible();
    checks.push(
      'Real PG16: student/admin/foreign tenant/nonexistent offering rejected; teacher cannot read admin assignment API; committed END_TEACHER denies new list read, refresh clears rows, settings fails; ASSIGN_TEACHER restores ACTIVE via original revision checks',
    );
    for (const part of ['settings', 'teachers']) {
      await t.goto(origin + `/zhiban/teacher/courses/${course}/${part}`);
      await expect(
        t.getByText('请先在我的课程选择教学班，再进入课程设置或任教名单。', { exact: true }),
      ).toBeVisible();
      await t.getByRole('link', { name: '返回工作台', exact: true }).click();
      await expect(t.getByText('选择一个空间，进入工作台。', { exact: true })).toBeVisible();
      for (const q of ['&space=' + tenant, '&next=outside']) {
        await t.goto(page(part) + q);
        await expect(t.getByText(/地址无效/)).toBeVisible();
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(commands, ['END_TEACHER', 'ASSIGN_TEACHER']);
  } finally {
    try {
      if (ended && manager) await restore();
    } finally {
      for (const c of contexts) await c.close();
      await browser.close();
    }
  }
  const paths = [
    'lib/zhiban/application/workspace/service.ts',
    'lib/zhiban/infrastructure/workspace/http.ts',
    'lib/zhiban/infrastructure/workspace/postgres/transaction.ts',
    'tests/zhiban/workspace/query.test.ts',
    ...[
      'course-administration.html',
      'course-administration.js',
      'course-page.js',
      'workspace.js',
    ].map((p) => 'app/zhiban/local/' + p),
    ...[
      'request-target.ts',
      'server.ts',
      'verify-m6-catalog.mts',
      'verify-course-administration.cjs',
    ].map((p) => 'scripts/zhiban-local/' + p),
  ];
  fs.writeFileSync(
    'docs/v2/evidence/course-administration/browser-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        at: new Date().toISOString(),
        root: meta.root,
        scope: 'TEACHER_SETTINGS_READ_ONLY_AND_MINIMAL_ASSIGNMENT_PROJECTION',
        checks,
        commands,
        relationRestored: 'ACTIVE; original command advances revision and valid_from',
        modelCalls: false,
        sourceHashes: Object.fromEntries(
          paths.map((p) => [
            p,
            crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
          ]),
        ),
        excluded: [
          'No new administrator configuration authority',
          'Assignment facts are not colleagues effective Identity authorization',
          'No contact/login/role directory exposed',
          'Single teaching relation fixture, no real multi-page/multi-space journey',
          'No new concurrency semantics; canonical access/assignment locks reused',
          'No migration/ACL/model/full classroom/CI changes',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ status: 'PASS', checks, commands }));
}
main().catch((e) => {
  console.error(String(e.message ?? e).split('Call log:')[0]);
  console.error(
    String(e.stack ?? '')
      .split('\n')
      .filter((line) => /^\s+at main/.test(line))
      .join('\n'),
  );
  process.exitCode = 1;
});
