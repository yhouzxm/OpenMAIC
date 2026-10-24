/* eslint-disable @typescript-eslint/no-require-imports -- Real LOCAL trusted HTTPS + owned PG16 journey. */
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test'),
  { Pool } = require('pg');
async function main() {
  const m = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(m.evidenceOrigin, 'LOCAL');
  assert.equal(m.githubActions, false);
  assert.equal(m.port, 56517);
  assert.ok(m.root.startsWith('/tmp/zhiban-trial-content-'));
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  const accounts = JSON.parse(fs.readFileSync(m.accountsPath)).accounts,
    tenant = m.trial.tenantId,
    offering = m.trial.offeringId;
  const base = `/api/zhiban/learning/${tenant}/offerings/${offering}`,
    url = base + '/quizzes';
  const db = new Pool({
      host: m.root + '/socket',
      port: m.port,
      user: 'postgres',
      database: 'zhiban_trial_content_disposable',
      max: 3,
    }),
    pg = Number((await db.query('SHOW server_version_num')).rows[0].server_version_num);
  assert.ok(pg >= 160000 && pg < 170000);
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    contexts = [],
    errors = [],
    checks = [],
    ids = {};
  let t, t2, s, a;
  const concurrencyTokens = new Map();
  async function actor(role) {
    const c = await b.newContext();
    contexts.push(c);
    const p = await c.newPage(),
      account = accounts.find((a) => a.role === role);
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(m.origin + '/zhiban?space=' + tenant);
    await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(account.userId);
    await p.getByLabel('密码', { exact: true }).fill(account.password);
    await p.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(p.getByRole('link', { name: '个人资料与账户', exact: true })).toBeVisible();
    return p;
  }
  async function api(p, path, body, key = crypto.randomUUID()) {
    return p.evaluate(
      async ({ path, body, key, supplied }) => {
        const headers = { 'x-zhiban-request': 'identity-v1' };
        if (body) {
          const r = supplied
            ? null
            : await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
          if (r && !r.ok) throw Error('CSRF ' + r.status + ' ' + (await r.text()).slice(0, 300));
          headers['x-zhiban-csrf'] = supplied ?? (await r.json()).csrfToken;
          headers['content-type'] = 'application/json';
          headers['x-zhiban-command'] = key;
        }
        const r = await fetch(path, {
          method: body ? 'POST' : 'GET',
          headers,
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
        });
        return { status: r.status, json: await r.json() };
      },
      { path, body, key, supplied: concurrencyTokens.get(p) },
    );
  }
  async function ok(p, path, body, key) {
    const r = await api(p, path, body, key);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  }

  const ai = `/api/zhiban/content/${tenant}/offerings/${offering}/ai?kind=quiz`;
  const src = JSON.parse(fs.readFileSync(m.root + '/ai-quiz-source.json'));
  const adopt = { type: 'ADOPT', runId: src.runId, sourceHash: src.sourceHash };
  const read = (id, p = t) => ok(p, url + '?activity=' + id);
  const manage = `/api/zhiban/management/${tenant}`;
  let ended = false,
    member;
  async function relation() {
    return (await ok(a, manage + '/assignments?offering=' + offering + '&state=ALL&limit=50'))
      .rows[0];
  }
  async function restore() {
    const row = await relation();
    await ok(a, manage + '/commands', {
      type: 'ASSIGN_TEACHER',
      offeringId: offering,
      membershipId: member,
      revision: row.revision,
    });
    ended = false;
  }
  try {
    t = await actor('TEACHER');
    t2 = await actor('TEACHER');
    s = await actor('STUDENT');
    a = await actor('ADMIN');
    const asset = await t.evaluate(async () => {
      const r = await fetch('/zhiban/lesson.js');
      return { status: r.status, text: await r.text() };
    });
    assert.equal(asset.status, 200);
    const assetHash = crypto.createHash('sha256').update(asset.text).digest('hex');
    assert.equal(
      assetHash,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync('app/zhiban/local/lesson.js'))
        .digest('hex'),
    );
    ids.liveLessonAssetSha256 = assetHash;
    for (const p of [s, a]) {
      assert.equal((await api(p, ai)).status, 403);
      assert.equal((await api(p, ai, adopt)).status, 403);
    }
    const handout = ai.replace('?kind=quiz', '');
    assert.ok(!(await ok(t, handout)).runs.some((r) => r.id === src.runId));
    assert.equal((await api(t, handout, { type: 'PREVIEW', runId: src.runId })).status, 404);
    assert.equal((await api(t, ai, { ...adopt, runId: 'unbound_native_run' })).status, 404);
    assert.equal((await api(t, ai, { ...adopt, sourceHash: '0'.repeat(64) })).status, 409);
    assert.equal((await api(t, ai, { type: 'ADOPT', runId: src.runId })).status, 400);
    assert.equal((await api(t, ai, { ...adopt, content: src.content })).status, 400);
    checks.push(
      'Current teacher only; handout/quiz owner namespaces isolated; unbound run, missing/changed hash and client content injection rejected',
    );
    const count = async () =>
      Number(
        (
          await db.query(
            'SELECT count(*) FROM zhiban_learning.activities WHERE tenant_id=$1 AND offering_id=$2',
            [tenant, offering],
          )
        ).rows[0].count,
      );
    const before = await count();
    // Fault only this owned disposable database, always removed before retry.
    await db.query(
      "CREATE FUNCTION public.local_ai_quiz_cut() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL adoption fault'; END $$",
    );
    await db.query(
      'CREATE TRIGGER local_ai_quiz_cut BEFORE INSERT ON zhiban_learning.quiz_definitions FOR EACH ROW EXECUTE FUNCTION public.local_ai_quiz_cut()',
    );
    try {
      assert.equal((await api(t, ai, adopt)).status, 503);
      assert.equal(await count(), before);
    } finally {
      await db.query('DROP TRIGGER local_ai_quiz_cut ON zhiban_learning.quiz_definitions');
      await db.query('DROP FUNCTION public.local_ai_quiz_cut()');
    }
    const receipts = await Promise.all([ok(t, ai, adopt), ok(t2, ai, adopt)]);
    assert.equal(receipts[0].id, receipts[1].id);
    assert.equal(await count(), before + 1);
    const id = (ids.quiz = receipts[0].id);
    const audit = await db.query(
      "SELECT facts FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type='LEARNING_ADOPT_GENERATED_QUIZ' AND facts->'result'->>'id'=$2",
      [tenant, id],
    );
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].facts.result.generatedSource.sourceHash, src.sourceHash);
    assert.equal((await read(id)).status, 'DRAFT');
    assert.equal((await api(s, url + '?activity=' + id)).status, 404);
    checks.push(
      'Injected quiz INSERT failure rolls back parent activity; retry and simultaneous independent sessions produce one draft and one audited source receipt',
    );
    await t.goto(
      m.origin +
        `/zhiban/teacher/courses/${src.course}/agents?space=${tenant}&offering=${offering}`,
    );
    await expect(t.getByRole('region', { name: '教师 AI 备课' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
    await t.getByLabel('生成内容类型', { exact: true }).selectOption('quiz');
    await t.getByRole('button', { name: '审核生成测验', exact: true }).click();
    await t.getByRole('button', { name: '采用为可编辑测验草稿', exact: true }).click();
    const title = 'AI 电气安全审核测验 ' + Date.now();
    await t.getByLabel('测验标题', { exact: true }).fill(title);
    await t.getByRole('button', { name: '刷新生成任务', exact: true }).click();
    await expect(t.getByLabel('测验标题', { exact: true })).toHaveValue(title);
    await t.getByRole('button', { name: '审核生成测验', exact: true }).click();
    await t.getByRole('button', { name: '采用为可编辑测验草稿', exact: true }).click();
    await expect(t.getByLabel('测验标题', { exact: true })).toHaveValue(title);
    await t.getByRole('button', { name: '保存测验草稿', exact: true }).click();
    await expect(t.getByText('操作已确认', { exact: true })).toBeVisible();
    await t.getByRole('button', { name: '发布测验', exact: true }).click();
    await expect.poll(async () => (await read(id)).status).toBe('PUBLISHED');
    const outline = await ok(t, base + '/outline');
    if (!outline.chapters.length)
      outline.chapters.push({ id: crypto.randomUUID(), title: 'AI 备课课堂', units: [] });
    const unit = (ids.unit = crypto.randomUUID());
    outline.chapters[0].units.push({ id: unit, title, kind: 'ACTIVITY', target: id });
    const arranged = await ok(t, base + '/outline', {
      type: 'SAVE_OUTLINE',
      revision: outline.revision,
      chapters: outline.chapters,
    });
    await ok(t, base + '/outline', { type: 'PUBLISH_OUTLINE', revision: arranged.revision });
    const route =
      m.origin +
      `/zhiban/student/courses/${src.course}/learning-center/${unit}?space=${tenant}&offering=${offering}`;
    const studentView = await read(id, s);
    assert.ok(!JSON.stringify(studentView).includes('"answer"'));
    assert.ok(!JSON.stringify(studentView).includes('"analysis"'));
    await s.goto(route);
    s.once('dialog', (d) => d.accept());
    await s.getByRole('button', { name: '开始新一次尝试', exact: true }).click();
    let ri = 0,
      ci = 0;
    for (const q of src.content.questions) {
      if (q.type === 'short_answer') {
        await s.getByPlaceholder('请输入答案').fill(q.answer?.[0] ?? '安全操作，断电并检查');
        continue;
      }
      const role = q.type === 'single' ? 'radio' : 'checkbox';
      const offset = role === 'radio' ? ri : ci;
      for (let i = 0; i < q.options.length; i++)
        if (q.answer.includes(q.options[i].value))
          await s
            .getByRole(role)
            .nth(offset + i)
            .click();
      if (role === 'radio') ri += q.options.length;
      else ci += q.options.length;
    }
    await s.getByRole('button', { name: '提交答案', exact: true }).click();
    await s.getByRole('button', { name: '确认提交测验', exact: true }).click();
    await expect(s.getByText('已提交；', { exact: false })).toBeVisible();
    const attempt = (await read(id, s)).latestAttempt;
    ids.attempt = attempt.id;
    await t.goto(
      m.origin +
        `/zhiban/teacher/courses/${src.course}/grades?space=${tenant}&offering=${offering}#queue`,
    );
    await t
      .locator('.grading-rows article')
      .filter({ has: t.getByRole('heading', { name: title, exact: true }) })
      .getByRole('button', { name: '打开评分', exact: true })
      .click();
    for (const q of src.content.questions)
      if (q.type === 'short_answer')
        await t.getByLabel('评分-' + q.id, { exact: true }).fill(String(q.points));
    await t.getByRole('button', { name: '确认分项并保存评分', exact: true }).click();
    await t.getByRole('button', { name: '发布成绩', exact: true }).click();
    const max = src.content.questions.reduce((n, q) => n + q.points, 0);
    await expect(
      t.getByText(`成绩版本 1：${max.toFixed(2)} / ${max.toFixed(2)}`, { exact: false }),
    ).toBeVisible();
    await s.reload();
    await s.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
    await s.getByRole('button', { name: '查看本次提交与成绩', exact: true }).click();
    await expect(
      s.getByText(`成绩版本 1：${max.toFixed(2)} / ${max.toFixed(2)}`, { exact: false }),
    ).toBeVisible();
    checks.push(
      'Browser: review native generation, adopt editable draft, task refresh/re-adopt preserves unsaved title, save/publish, arrange course unit, student answer/submit, teacher grade/publish, student result',
    );
    await ok(t, ai, { type: 'CANCEL', runId: src.runId });
    assert.equal((await ok(t, ai, adopt)).id, id);
    assert.equal((await api(t, ai, { ...adopt, sourceHash: '0'.repeat(64) })).status, 409);
    const row = await relation();
    member = row.membership_id;
    const blocker = await db.connect();
    let inFlight;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `progress:${tenant}:${offering}`,
      ]);
      inFlight = api(t2, ai, adopt);
      let waiting = false;
      const limit = Date.now() + 2500;
      while (Date.now() < limit) {
        waiting =
          Number(
            (
              await db.query(
                "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted",
              )
            ).rows[0].count,
          ) > 0;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(waiting, 'Adoption must be blocked at the offering progress barrier');
      await ok(a, manage + '/commands', {
        type: 'END_TEACHER',
        id: row.id,
        revision: row.revision,
      });
      ended = true;
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    assert.equal((await inFlight).status, 403);
    assert.equal((await api(t, ai, adopt)).status, 403);
    assert.equal((await api(t, ai)).status, 403);
    await restore();
    assert.equal((await ok(t, ai, adopt)).id, id);
    checks.push(
      'Source cancellation preserves acknowledged draft receipt; hash mismatch conflicts; PG-lock-proven in-flight adoption rechecks assignment after a committed revocation and is denied; committed revocation also denies receipt replay; restoration recovers same id',
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      'docs/v2/evidence/ai-quiz/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          root: m.root,
          ids,
          checks,
          browserErrors: errors,
          realNativeSource: src.runId,
          sourceHash: src.sourceHash,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS AI Quiz adoption/publication journey', JSON.stringify(ids));
  } finally {
    if (ended) await restore();
    await b.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
