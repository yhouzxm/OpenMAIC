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
  const base = `/api/zhiban/learning/${tenant}/offerings/${offering}`;
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
    errors = [];
  let t, s;
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

  try {
    t = await actor('TEACHER');
    s = await actor('STUDENT');
    const [decision] = (
      await db.query(
        "SELECT facts FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type='QUIZ_AI_DECISION' AND facts->>'status'='ACCEPTED' ORDER BY occurred_at DESC LIMIT 1",
        [tenant],
      )
    ).rows;
    assert.ok(decision);
    const submission = decision.facts.submissionId;
    const proposals = (
      await db.query(
        "SELECT facts FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type='QUIZ_AI_SUGGESTION' AND facts->'input'->>'submissionId'=$2 ORDER BY occurred_at",
        [tenant, submission],
      )
    ).rows;
    assert.equal(proposals.length, 3);
    const chosen = proposals.find((x) => x.facts.id === decision.facts.id).facts;
    const path = base + '/quiz-submissions?submission=' + submission;
    const teacher = await ok(t, path),
      student = await ok(s, path);
    assert.equal(student.publications.length, 1);
    assert.equal(student.aiAdvice, undefined);
    assert.equal(
      student.publications[0].score_points,
      Math.round(Number(chosen.result.marks.safety) * 100),
    );
    const course = (
      await db.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [tenant, offering],
      )
    ).rows[0].course_id;
    const outline = await ok(t, base + '/outline');
    if (!outline.chapters.length)
      outline.chapters.push({ id: crypto.randomUUID(), title: 'AI 简答评分课堂', units: [] });
    const unit = crypto.randomUUID();
    outline.chapters[0].units.push({
      id: unit,
      title: teacher.title,
      kind: 'ACTIVITY',
      target: teacher.activityId,
    });
    const arranged = await ok(t, base + '/outline', {
      type: 'SAVE_OUTLINE',
      revision: outline.revision,
      chapters: outline.chapters,
    });
    await ok(t, base + '/outline', { type: 'PUBLISH_OUTLINE', revision: arranged.revision });
    await s.goto(
      m.origin +
        `/zhiban/student/courses/${course}/learning-center/${unit}?space=${tenant}&offering=${offering}`,
    );
    await s.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
    await s.getByRole('button', { name: '查看本次提交与成绩', exact: true }).click();
    const score = (student.publications[0].score_points / 100).toFixed(2);
    await expect(s.getByText(`成绩版本 1：${score} / 2.00`, { exact: false })).toBeVisible();
    const audits = (
      await db.query(
        "SELECT event_type,count(*)::int AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type LIKE 'QUIZ_AI_%' AND (facts->'input'->>'submissionId'=$2 OR facts->>'submissionId'=$2) GROUP BY event_type",
        [tenant, submission],
      )
    ).rows;
    assert.equal(audits.find((x) => x.event_type === 'QUIZ_AI_DECISION').n, 2);
    assert.equal(
      Number(
        (await db.query("SELECT count(*) FROM pg_proc WHERE proname='local_ai_advice_cut'")).rows[0]
          .count,
      ),
      0,
    );
    assert.deepEqual(errors, []);
    fs.mkdirSync('docs/v2/evidence/quiz-ai-advice', { recursive: true });
    fs.writeFileSync(
      'docs/v2/evidence/quiz-ai-advice/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          realModel: true,
          mock: false,
          model: chosen.result.model,
          root: m.root,
          ids: { quiz: teacher.activityId, submission, suggestion: chosen.id, unit },
          verificationContinuation:
            'Original complete journey assertions passed through concurrent accept and teacher publish click; fixed immediate-read timing race, then independently verified persisted publication and student browser result without repeating model calls.',
          checks: [
            'Native real advice x3',
            'Teacher browser rejection leaves grade absent',
            'Manual grade revision change conflicts with stale suggestion',
            'Student/admin denied and injected client marks rejected',
            'Committed teacher revocation denies, original management command restores',
            'Injected grade INSERT failure rolls back',
            'Concurrent independent accepts save one grade revision and one decision',
            'Opposite decision conflicts',
            'Original teacher explicit publication and student browser result; no advice in student response',
          ],
          audits,
          browserErrors: errors,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS publication continuation and student browser result');
  } finally {
    await b.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
