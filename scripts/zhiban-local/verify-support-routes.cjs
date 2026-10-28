/* eslint-disable @typescript-eslint/no-require-imports -- Standalone owned LOCAL browser journey. */
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
async function main() {
  const meta = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(meta.evidenceOrigin, 'LOCAL');
  assert.equal(meta.githubActions, false);
  assert.equal(meta.origin, 'https://127.0.0.1:3461');
  const origin = meta.origin,
    tenant = meta.trial.tenantId,
    offering = meta.trial.offeringId,
    accounts = JSON.parse(fs.readFileSync(meta.accountsPath)).accounts;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    checks = [];
  try {
    const c = await browser.newContext(),
      p = await c.newPage();
    try {
      for (const path of [
        '/zhiban/teacher/profiles',
        '/zhiban/teacher/risks',
        '/zhiban/student/profile',
        '/zhiban/student/risks',
      ]) {
        await p.goto(origin + path);
        await expect(p.getByText('请先返回工作台登录。', { exact: true })).toBeVisible();
      }
      checks.push(
        'All four anonymous global entries require original login, no evidence/support data',
      );
    } finally {
      await c.close();
    }
    for (const role of ['TEACHER', 'STUDENT']) {
      const c = await browser.newContext(),
        p = await c.newPage(),
        a = accounts.find((x) => x.role === role),
        kindRole = role.toLowerCase();
      const errors = [],
        privateStudentReads = [],
        businessPosts = [];
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('request', (r) => {
        const u = new URL(r.url());
        if (r.method() === 'POST' && !u.pathname.includes('/identity/login'))
          businessPosts.push(u.pathname);
        if (
          role === 'STUDENT' &&
          (/^\/api\/zhiban\/risk\//.test(u.pathname) ||
            /^\/api\/zhiban\/analytics\//.test(u.pathname))
        )
          privateStudentReads.push(u.pathname);
      });
      try {
        await p.goto(origin + '/zhiban?space=' + tenant);
        await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(a.userId);
        await p.getByLabel('密码', { exact: true }).fill(a.password);
        await p.getByRole('button', { name: '登录并进入', exact: true }).click();
        await expect(p.getByRole('link', { name: '个人资料与账户', exact: true })).toBeVisible();
        let course;
        for (const kind of ['profile', 'support']) {
          const path = `/zhiban/${kindRole}/${kind === 'support' ? 'risks' : role === 'TEACHER' ? 'profiles' : 'profile'}`,
            url = origin + path + '?space=' + tenant;
          if (kind === 'profile') {
            await p
              .getByRole('link', {
                name: role === 'TEACHER' ? '学习分析' : '学习档案',
                exact: true,
              })
              .click();
          } else {
            await p.goto(origin + '/zhiban?space=' + tenant);
            await p
              .getByRole('link', {
                name: role === 'TEACHER' ? '风险预警' : '学习支持',
                exact: true,
              })
              .click();
          }
          await expect(p).toHaveURL(url);
          await expect(p.getByText(/画像维度仍在审阅中/)).toBeVisible();
          const search = p.getByLabel('搜索课程或教学班', { exact: true });
          await search.fill('试用');
          await p.getByLabel('画像与支持入口每页条数', { exact: true }).selectOption('10');
          await p.getByRole('button', { name: '查询画像与支持课程', exact: true }).click();
          await expect(
            p.getByRole('button', { name: '查询画像与支持课程', exact: true }),
          ).toBeEnabled();
          const entry = p.getByRole('link', {
            name: kind === 'profile' ? '进入课程学习画像' : '进入课程学习支持',
            exact: true,
          });
          await expect(entry).toHaveCount(1);
          const target = await entry.getAttribute('href');
          course = /\/courses\/([0-9a-f-]+)\//.exec(target)[1];
          await entry.click();
          await expect(
            p.getByRole('heading', {
              name: kind === 'profile' ? '课程学习证据与观察' : '课程风险与学习支持',
              exact: true,
            }),
          ).toBeVisible();
          await expect(p.getByText(/画像维度仍在审阅中/)).toBeVisible();
          const featureNames =
            kind === 'profile'
              ? [
                  '学习证据与教师观察',
                  '概念证据与纠错',
                  role === 'TEACHER' ? '课程成绩簿' : '本人课程成绩',
                ]
              : role === 'TEACHER'
                ? ['风险规则与教师审阅', '待跟进与教学统计', '补救计划与效果回看', '概念证据与纠错']
                : [
                    '本人站内提醒与回执',
                    '本人补救任务与反馈',
                    '本人公开概念纠错',
                    '本人已发布学习观察',
                  ];
          for (const name of featureNames) {
            await p.getByRole('link', { name: '打开' + name, exact: true }).click();
            const ret = p.getByRole('link', { name: '返回学习证据与支持入口', exact: true });
            await expect(ret).toBeVisible();
            if (name.includes('学习证据') || name.includes('学习观察'))
              await expect(p.getByText(/画像维度尚未启用/)).toBeVisible();
            if (name === '风险规则与教师审阅')
              await expect(
                p.getByRole('navigation', { name: '风险审阅视图', exact: true }),
              ).toBeVisible();
            if (name === '本人站内提醒与回执')
              await expect(
                p.getByRole('heading', { name: '我的站内提醒', exact: true }),
              ).toBeVisible();
            await expect(p.getByRole('alert')).toHaveCount(0);
            await ret.click();
            await expect(
              p.getByRole('heading', {
                name: kind === 'profile' ? '课程学习证据与观察' : '课程风险与学习支持',
                exact: true,
              }),
            ).toBeVisible();
          }
          if (role === 'STUDENT')
            await expect(
              p.getByRole('link', { name: '打开风险规则与教师审阅', exact: true }),
            ).toHaveCount(0);
          await p.screenshot({
            path: `docs/v2/evidence/support-routes/${kindRole}-${kind}.png`,
            fullPage: true,
          });
          await p.getByRole('link', { name: '返回画像与支持课程列表', exact: true }).click();
          await expect(p).toHaveURL(url);
          await expect(search).toHaveValue('试用');
          await expect(p.getByLabel('画像与支持入口每页条数', { exact: true })).toHaveValue('10');
          await p.goto(origin + path + '?tenant=' + tenant + '&courseId=' + course);
          await expect(entry).toHaveCount(1);
          await entry.click();
          await p.getByRole('link', { name: '打开' + featureNames[0], exact: true }).click();
          await p.getByRole('link', { name: '返回学习证据与支持入口', exact: true }).click();
          await p.getByRole('link', { name: '返回画像与支持课程列表', exact: true }).click();
          await expect(p).toHaveURL(url + '&courseId=' + course);
          const section =
            kind === 'profile'
              ? role === 'TEACHER'
                ? 'profiles'
                : 'analysis'
              : role === 'TEACHER'
                ? 'risks'
                : 'support';
          await p.goto(origin + `/zhiban/${kindRole}/courses/${course}/${section}`);
          await expect(
            p.getByText('请先选择课程所在空间和教学班。', { exact: true }),
          ).toBeVisible();
          await p.getByRole('link', { name: '返回画像与支持课程列表', exact: true }).click();
          await expect(entry).toHaveCount(1);
          await p.goto(origin + path);
          await expect(p).toHaveURL(url);
          await expect(entry).toHaveCount(1);
          for (const q of [
            '?space=bad',
            '?space=' + tenant + '&space=' + tenant,
            '?next=outside',
          ]) {
            await p.goto(origin + path + q);
            await expect(
              p.getByText('画像与支持入口地址无效，请从工作台进入。', { exact: true }),
            ).toBeVisible();
          }
          const other = role === 'TEACHER' ? 'student' : 'teacher',
            otherSection =
              kind === 'profile'
                ? other === 'teacher'
                  ? 'profiles'
                  : 'analysis'
                : other === 'teacher'
                  ? 'risks'
                  : 'support';
          await p.goto(
            origin +
              `/zhiban/${other}/courses/${course}/${otherSection}?space=${tenant}&offering=${offering}`,
          );
          await expect(
            p.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
          ).toBeVisible();
          await p.goto(
            origin +
              `/zhiban/${kindRole}/courses/${course}/${section}?space=${tenant}&offering=00000000-0000-7000-8000-000000000001`,
          );
          await expect(
            p.getByText('当前课程不可访问，或课程关系已变化。', { exact: true }),
          ).toBeVisible();
          checks.push(
            role +
              ' ' +
              kind +
              ': global sidebar/search -> old course hub -> every governed feature -> return; courseId retained through nested return, bare bookmarks recover selection, wrong role/offering/context denied',
          );
        }
        assert.deepEqual(privateStudentReads, []);
        assert.deepEqual(businessPosts, []);
        assert.deepEqual(errors, []);
      } finally {
        await c.close();
      }
    }
  } finally {
    await browser.close();
  }
  const paths = [
    'app/zhiban/local/global-support.js',
    'app/zhiban/local/global-support.html',
    'app/zhiban/local/support-hub.js',
    'app/zhiban/local/support-hub.html',
    'app/zhiban/local/client.js',
    'app/zhiban/local/course-page.js',
    'scripts/zhiban-local/request-target.ts',
    'scripts/zhiban-local/server.ts',
    'scripts/zhiban-local/verify-m6-catalog.mts',
    'scripts/zhiban-local/verify-support-routes.cjs',
    'scripts/zhiban-local/verify-settings-routes.cjs',
  ];
  fs.writeFileSync(
    'docs/v2/evidence/support-routes/browser-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        at: new Date().toISOString(),
        scope: 'EIGHT_LEGACY_PROFILE_AND_SUPPORT_ENTRY_ROUTES_WITH_DIMENSIONS_REVIEW',
        root: require('node:path').dirname(meta.accountsPath),
        tenant,
        checks,
        businessWrites: false,
        studentPrivateRiskOrAnalyticsReads: 0,
        sourceHashes: Object.fromEntries(
          paths.map((p) => [
            p,
            crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
          ]),
        ),
        excluded: [
          'No synthetic observations/reminders/plans published; empty states are real',
          'No scoring dimensions/diagnosis/ranking',
          'No real multi-page or multi-space fixtures',
          'No full classroom/PG16/CI rerun',
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
