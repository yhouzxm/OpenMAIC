/* eslint-disable @typescript-eslint/no-require-imports -- Focused real LOCAL entry journey; no classroom full regression. */
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
    tenant = m.trial.tenantId,
    offering = m.trial.offeringId,
    origin = m.origin,
    b = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    contexts = [],
    posts = [],
    errors = [],
    checks = [];
  async function actor(role) {
    const c = await b.newContext();
    contexts.push(c);
    const p = await c.newPage(),
      a = accounts.find((a) => a.role === role);
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('request', (r) => {
      if (r.method() === 'POST' && !r.url().includes('/identity/login'))
        posts.push(r.postDataJSON().type);
    });
    await p.goto(origin + '/zhiban?space=' + tenant);
    await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(a.userId);
    await p.getByLabel('密码', { exact: true }).fill(a.password);
    await p.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(p.getByRole('link', { name: '个人资料与账户', exact: true })).toBeVisible();
    return p;
  }
  async function api(p, url, body) {
    return p.evaluate(
      async ({ url, body }) => {
        const headers = { 'x-zhiban-request': 'identity-v1' };
        if (body) {
          const r = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
          if (!r.ok) throw Error('CSRF unavailable');
          headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
          headers['content-type'] = 'application/json';
          headers['x-zhiban-command'] = crypto.randomUUID().replaceAll('-', '');
        }
        const r = await fetch(url, {
          method: body ? 'POST' : 'GET',
          headers,
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
        });
        return { status: r.status, json: await r.json() };
      },
      { url, body },
    );
  }
  let t, session, sessionRevision, course;
  const classBase = `/api/zhiban/learning/${tenant}/offerings/${offering}/classrooms`;
  let ended = false;
  try {
    const anon = await b.newPage();
    await anon.goto(origin + '/zhiban/teacher/courses');
    await expect(anon.getByText('请先返回工作台登录。', { exact: true })).toBeVisible();
    await anon.close();
    t = await actor('TEACHER');
    const s = await actor('STUDENT'),
      a = await actor('ADMIN');
    await t.getByRole('link', { name: '我的课程', exact: true }).click();
    await expect(t).toHaveURL(origin + '/zhiban/teacher/courses?space=' + tenant);
    await t.getByLabel('搜索课程或教学班', { exact: true }).fill('试用');
    await t.getByLabel('课程入口每页条数', { exact: true }).selectOption('10');
    await t.getByRole('button', { name: '查询课程', exact: true }).click();
    const entry = t.getByRole('link', { name: '进入课程工作区', exact: true });
    await expect(entry).toHaveCount(1);
    course = /\/courses\/([0-9a-f-]+)\?/.exec(await entry.getAttribute('href'))[1];
    await entry.click();
    await t.getByRole('link', { name: '← 返回我的课程', exact: true }).click();
    await expect(t.getByLabel('搜索课程或教学班', { exact: true })).toHaveValue('试用');
    await expect(t.getByLabel('课程入口每页条数', { exact: true })).toHaveValue('10');
    await t.goto(origin + '/zhiban/teacher/courses');
    await expect(t).toHaveURL(origin + '/zhiban/teacher/courses?space=' + tenant);
    await expect(entry).toHaveCount(1);
    await t.screenshot({
      path: 'docs/v2/evidence/ordinary-entry-batch/teacher-courses.png',
      fullPage: true,
    });
    for (const who of [s, a]) {
      await who.goto(origin + '/zhiban/teacher/courses?space=' + tenant);
      await expect(
        who.getByText('当前身份不具备此课程入口的角色，请返回工作台。', { exact: true }),
      ).toBeVisible();
    }
    checks.push(
      'Teacher old course-list URL uses current bounded workspace; sidebar, search, page size, course return and bare bookmark work; student/admin cannot impersonate teacher',
    );
    const acts = await api(
      s,
      `/api/zhiban/learning/${tenant}/offerings/${offering}/activities?limit=10`,
    );
    assert.equal(acts.status, 200);
    const activity = acts.json.rows[0];
    assert.ok(activity);
    const snapshot = await api(s, `/api/zhiban/learning/${tenant}/offerings/${offering}`);
    assert.equal(snapshot.status, 200);
    const beforeAttempts = snapshot.json.attempts.length;
    const deep = `/zhiban/student/courses/${course}/activities/${activity.id}`,
      canonical = `/zhiban/student/courses/${course}/coursework?space=${tenant}&offering=${offering}`;
    await s.goto(origin + deep + `?space=${tenant}&offering=${offering}`);
    await expect(s).toHaveURL(origin + canonical + '#activity-' + activity.id);
    await expect(s.getByRole('heading', { name: activity.title, exact: true })).toBeVisible();
    await s.goto(origin + deep);
    await expect(s.getByRole('link', { name: '核对本教学班目标', exact: true })).toHaveCount(1);
    await s.getByRole('link', { name: '核对本教学班目标', exact: true }).click();
    await expect(s).toHaveURL(origin + canonical + '#activity-' + activity.id);
    const all = await api(
      t,
      `/api/zhiban/learning/${tenant}/offerings/${offering}/activities?limit=10`,
    );
    const draft = all.json.rows.find((r) => r.status === 'DRAFT');
    assert.ok(draft);
    await s.goto(
      origin +
        `/zhiban/student/courses/${course}/activities/${draft.id}?space=${tenant}&offering=${offering}`,
    );
    await expect(
      s.getByText('未找到可访问的当前活动；旧Native或机电活动ID不能自动转换。', { exact: true }),
    ).toBeVisible();
    await expect(s.getByText(draft.title, { exact: true })).toHaveCount(0);
    const created = await api(t, classBase, {
      type: 'CREATE_CLASSROOM',
      title: '旧入口定向验证课堂',
      description: '只验证入口，不派发任务或开始作答',
      opensAt: null,
      closesAt: null,
    });
    assert.equal(created.status, 200);
    session = created.json.id;
    sessionRevision = created.json.revision;
    assert.ok(session);
    const pub = await api(t, classBase, {
      type: 'PUBLISH_CLASSROOM',
      id: session,
      revision: sessionRevision,
    });
    assert.equal(pub.status, 200);
    sessionRevision = pub.json.revision;
    const classPath = `/zhiban/student/classroom/${session}`;
    await s.goto(origin + classPath + `?space=${tenant}&offering=${offering}`);
    await expect(s).toHaveURL(origin + canonical + '#classroom-' + session);
    await expect(s.getByRole('heading', { name: '旧入口定向验证课堂', exact: true })).toBeVisible();
    await s.goto(origin + classPath);
    await s.getByRole('link', { name: '核对本教学班目标', exact: true }).click();
    await expect(s).toHaveURL(origin + canonical + '#classroom-' + session);
    const end = await api(t, classBase, {
      type: 'END_CLASSROOM',
      id: session,
      revision: sessionRevision,
    });
    assert.equal(end.status, 200);
    ended = true;
    await s.goto(origin + classPath + `?space=${tenant}&offering=${offering}`);
    await expect(
      s.getByText('未找到当前开放课堂；课堂可能已结束、无权访问，或旧Native绑定尚未迁移。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      s.getByRole('link', { name: '返回本教学班活动与课堂', exact: true }),
    ).toBeVisible();
    const after = await api(s, `/api/zhiban/learning/${tenant}/offerings/${offering}`);
    assert.equal(after.status, 200);
    assert.equal(after.json.attempts.length, beforeAttempts);
    checks.push(
      'Student deep activity and classroom IDs resolved exactly by original authorized APIs; missing context selects offering; published activity/current classroom reach existing target; drafts and ended classrooms fail closed; no automatic task entry/Attempt creation',
    );
    for (const who of [t, a])
      for (const url of [deep, classPath]) {
        await who.goto(origin + url + `?space=${tenant}&offering=${offering}`);
        await expect(
          who.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
        ).toBeVisible();
      }
    await s.goto(origin + deep + `?space=${tenant}&offering=00000000-0000-7000-8000-000000000001`);
    await expect(
      s.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
    ).toBeVisible();
    for (const url of [deep, classPath])
      for (const suffix of ['&space=' + tenant, '&next=outside', '&sceneId=legacy']) {
        await s.goto(origin + url + `?space=${tenant}&offering=${offering}` + suffix);
        await expect(
          s.getByText('教学入口地址无效，请从工作台进入。', { exact: true }),
        ).toBeVisible();
      }
    await s.goto(
      origin +
        `/zhiban/student/courses/00000000-0000-7000-8000-000000000001/activities/${activity.id}?space=${tenant}&offering=${offering}`,
    );
    await expect(
      s.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
    ).toBeVisible();
    await a.goto(origin + '/zhiban/admin/import/registrations?tenant=' + tenant);
    await expect(a.getByLabel('导入类别', { exact: true })).toHaveValue('ENROLLMENTS');
    checks.push(
      'Wrong role/course/offering and duplicate/unknown/old scene parameters rejected; existing registrations URL renders actual ENROLLMENTS importer, not obsolete roster alias',
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(posts, ['CREATE_CLASSROOM', 'PUBLISH_CLASSROOM', 'END_CLASSROOM']);
  } finally {
    try {
      if (t && session && !ended)
        await api(t, classBase, { type: 'END_CLASSROOM', id: session, revision: sessionRevision });
    } finally {
      for (const c of contexts) await c.close();
      await b.close();
    }
  }
  const files = [
    'global-authoring.js',
    'global-tools.js',
    'client.js',
    'course-page.js',
    'workspace.js',
  ]
    .map((p) => 'app/zhiban/local/' + p)
    .concat(
      [
        'request-target.ts',
        'server.ts',
        'verify-m6-catalog.mts',
        'verify-ordinary-entry-batch.cjs',
      ].map((p) => 'scripts/zhiban-local/' + p),
      ['tests/zhiban/workspace/query.test.ts'],
    );
  fs.writeFileSync(
    'docs/v2/evidence/ordinary-entry-batch/browser-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        at: new Date().toISOString(),
        root: m.root,
        scope: 'THREE_ORDINARY_LEGACY_ENTRIES_AND_EXISTING_IMPORT_TARGET',
        checks,
        commands: posts,
        syntheticClassroom: { id: session, state: 'ENDED', tasks: 0 },
        attemptsCreated: false,
        modelCalls: false,
        sourceHashes: Object.fromEntries(
          files.map((p) => [
            p,
            crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
          ]),
        ),
        boundaries: [
          'Only exact current Academic activity/Classroom session IDs; no old Native binding translation',
          'Old Native/virtual-lab/scene Runtime gates retained',
          'No full classroom/CI/scanner/model rerun',
          'P7 archive not rebuilt',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ status: 'PASS', checks, commands: posts }));
}
main().catch((e) => {
  console.error(String(e.message ?? e).split('Call log:')[0]);
  console.error(
    String(e.stack ?? '')
      .split('\n')
      .filter((x) => /^\s+at main/.test(x))
      .join('\n'),
  );
  process.exitCode = 1;
});
