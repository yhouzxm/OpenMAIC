/** Real LOCAL AI companion journey; never substitutes a generated answer. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { chromium, expect } from '@playwright/test';
import { trustedDevelopmentCa } from './config';
type Account = { role: string; userId: string; password: string };
type Row = {
  id: string;
  title: string;
  state: string;
  answer: string;
  error_code?: string;
  model: { provider: string; model: string };
};
type Json = {
  csrfToken: string;
  id: string;
  turnId: string;
  rows: Row[];
  policy: { enabled: boolean; peer_enabled: boolean; revision: string; guidance: string };
  session: { style: string; revision: string };
  capability: { ready: boolean };
};
async function main() {
  const m = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  assert.equal(m.status, 'RUNNING_LOCAL_PERSISTENT');
  const accounts = JSON.parse(await readFile(m.accountsPath, 'utf8')).accounts as Account[];
  const ca = await trustedDevelopmentCa();
  type Actor = { cookie: string; csrf: string };
  const call = (path: string, a?: Actor, body?: unknown, key = randomUUID().replaceAll('-', '')) =>
    new Promise<{ status: number; json: Json; cookie: string }>((done, reject) => {
      const r = request(
        m.origin + path,
        {
          ca,
          method: body ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(a ? { cookie: a.cookie } : {}),
            ...(body
              ? {
                  'content-type': 'application/json',
                  origin: m.origin,
                  'x-zhiban-command': key,
                  ...(a ? { 'x-zhiban-csrf': a.csrf } : {}),
                }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (b) => chunks.push(b));
          res.on('end', () => {
            try {
              done({
                status: res.statusCode!,
                json: JSON.parse(Buffer.concat(chunks).toString()),
                cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '',
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      r.on('error', reject);
      r.setTimeout(15000, () => r.destroy(Error('timeout')));
      r.end(body ? JSON.stringify(body) : undefined);
    });
  async function login(role: string) {
    const a = accounts.find((x: Account) => x.role === role);
    assert.ok(a);
    const l = await call('/api/zhiban/identity/login', undefined, {
      userId: a.userId,
      password: a.password,
    });
    assert.equal(l.status, 200);
    const actor = { cookie: l.cookie, csrf: '' };
    actor.csrf = (await call('/api/zhiban/identity/csrf', actor)).json.csrfToken;
    return actor;
  }
  const teacher = await login('TEACHER'),
    student = await login('STUDENT'),
    admin = await login('ADMIN');
  const base = `/api/zhiban/tutor/${m.trial.tenantId}/offerings/${m.trial.offeringId}`;
  const read = (a: Actor, mode = 'STUDENT', id?: string) =>
    call(base + `?mode=${mode}` + (id ? '&id=' + id : ''), a);
  let p = (await read(teacher, 'TEACHER')).json.policy;
  const continuation = process.argv.includes('--continue');
  let prior: Row | null = null;
  if (continuation) {
    for (const candidate of (await read(student)).json.rows) {
      if (candidate.title !== '持久化 AI 学习伙伴验收') continue;
      if (
        (await read(student, 'STUDENT', candidate.id)).json.rows.some(
          (r) => r.state === 'COMPLETED',
        )
      ) {
        prior = candidate;
        break;
      }
    }
  }
  if (continuation) {
    assert.ok(prior);
    assert.equal(
      (
        await call(base, teacher, {
          type: 'SET_POLICY',
          mode: 'TEACHER',
          revision: p.revision,
          enabled: true,
          peerEnabled: false,
          guidance: p.guidance,
        })
      ).status,
      200,
    );
    p = (await read(teacher, 'TEACHER')).json.policy;
  }
  const checks: string[] = [];
  assert.equal(p.peer_enabled, false);
  const create = {
    type: 'CREATE_SESSION',
    mode: 'STUDENT',
    style: 'PEER',
    title: '持久化 AI 学习伙伴验收',
    resourceId: null,
  };
  assert.equal((await call(base, student, create)).status, 409);
  assert.equal(
    (
      await call(base, student, {
        type: 'SET_POLICY',
        mode: 'TEACHER',
        revision: p.revision,
        enabled: true,
        peerEnabled: true,
        guidance: p.guidance,
      })
    ).status,
    403,
  );
  checks.push('Companion defaults closed; student cannot enable teacher policy');
  const policyBody = {
    type: 'SET_POLICY',
    mode: 'TEACHER',
    revision: p.revision,
    enabled: true,
    peerEnabled: true,
    guidance: p.guidance,
  };
  const races = await Promise.all([
    call(base, teacher, policyBody),
    call(base, teacher, policyBody),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  checks.push('Concurrent teacher policy update has one winner and one conflict');
  const key = randomUUID().replaceAll('-', '');
  const made = await call(base, student, create, key);
  assert.equal(made.status, 200);
  const duplicate = await call(base, student, create, key);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.json, made.json);
  const id = prior?.id ?? made.json.id;
  const detail = await read(student, 'STUDENT', id);
  assert.equal(detail.json.session.style, 'PEER');
  assert.ok([403, 404].includes((await read(teacher, 'TEACHER', id)).status));
  assert.ok([403, 404].includes((await read(admin, 'STUDENT', id)).status));
  checks.push('Creation is idempotent; session remains private to its owner');
  assert.equal(detail.json.capability.ready, true, 'Real model configuration required');
  let turnId: string;
  if (continuation) {
    turnId = detail.json.rows.find((r: Row) => r.state === 'COMPLETED')!.id;
  } else {
    const asked = await call(base, student, {
      type: 'ASK',
      mode: 'STUDENT',
      id,
      revision: detail.json.session.revision,
      message:
        '请作为 AI 学习伙伴，帮我讨论串联电路为什么各处电流相等。先给一个提示，再问我一个检查理解的问题。',
    });
    assert.equal(asked.status, 200);
    turnId = asked.json.turnId;
  }
  let answer: Row | undefined;
  for (let i = 0; i < 110; i++) {
    const r = await read(student, 'STUDENT', id);
    answer = r.json.rows.find((t: Row) => t.id === turnId);
    if (answer && answer.state !== 'RUNNING') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(
    answer?.state,
    'COMPLETED',
    JSON.stringify({ state: answer?.state, error: answer?.error_code }),
  );
  assert.ok(answer.answer.trim().length > 0);
  assert.ok(answer.model?.provider && answer.model?.model);
  checks.push(
    continuation
      ? 'Prior real native Agent/model response remains persisted; no duplicate model call'
      : 'Actual native Agent/model produces a persisted AI companion response',
  );
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const sql = new Pool({
    host: m.root + '/socket',
    port: 56517,
    user: 'postgres',
    database: m.database,
    max: 1,
  });
  try {
    const course = (
      await sql.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [m.trial.tenantId, m.trial.offeringId],
      )
    ).rows[0].course_id;
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('Browser runtime error:', e.message));
    await page.goto(m.origin + '/zhiban');
    const account = accounts.find((x: Account) => x.role === 'STUDENT');
    assert.ok(account);
    await page.getByLabel('账号 ID 或 @登录标识').fill(account.userId);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    const logged = page.waitForResponse(
      (r) => r.url().endsWith('/api/zhiban/identity/login') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '登录并进入', exact: true }).click();
    assert.equal((await logged).status(), 200);
    await expect(page.locator('#password')).toHaveCount(0);
    await page.waitForURL((u) => !u.pathname.includes('login') && u.pathname.startsWith('/zhiban'));
    await page.goto(
      `${m.origin}/zhiban/student/courses/${course}/tutor?space=${m.trial.tenantId}&offering=${m.trial.offeringId}#session-${id}`,
    );
    await page.waitForLoadState('networkidle');
    console.log(
      'Peer page diagnostic:',
      page.url(),
      (await page.locator('body').innerText()).slice(0, 1000),
    );
    await expect(page.getByRole('heading', { name: 'AI 辅导与学习伙伴' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '持久化 AI 学习伙伴验收 · AI 学习伙伴' }),
    ).toBeVisible();
    await expect(page.getByText(answer.answer, { exact: true })).toBeVisible();
    await page.screenshot({ path: 'docs/v2/evidence/zhiban-peer-local.png', fullPage: true });
    checks.push('Student browser shows labelled companion, fixed private session and real answer');
    const beforeWithdrawal = (await read(student, 'STUDENT', id)).json;
    const pending = await call(base, student, {
      type: 'ASK',
      mode: 'STUDENT',
      id,
      revision: beforeWithdrawal.session.revision,
      message: '请再给一个分步学习练习，先问我问题再等待回答。',
    });
    assert.equal(pending.status, 200);
    const latest = (await read(teacher, 'TEACHER')).json.policy;
    assert.equal(
      (await call(base, teacher, { ...policyBody, revision: latest.revision, peerEnabled: false }))
        .status,
      200,
    );
    let interrupted: Row | undefined;
    for (let i = 0; i < 30; i++) {
      interrupted = (await read(student, 'STUDENT', id)).json.rows.find(
        (r) => r.id === pending.json.turnId,
      );
      if (interrupted && interrupted.state !== 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(interrupted && ['CANCELLED', 'BLOCKED'].includes(interrupted.state));
    assert.ok(!interrupted.answer);
    checks.push('Withdrawal during a real in-flight companion turn prevents answer delivery');
    const current = (await read(student, 'STUDENT', id)).json;
    assert.equal(
      (
        await call(base, student, {
          type: 'ASK',
          mode: 'STUDENT',
          id,
          revision: current.session.revision,
          message: '继续',
        })
      ).status,
      409,
    );
    assert.equal(current.rows.find((r: Row) => r.id === turnId)!.answer, answer.answer);
    checks.push('Teacher withdrawal blocks new companion turns while preserving private history');
    const runtime = new Pool({
      host: m.root + '/socket',
      port: 56517,
      user: 'zhiban_academic_runtime',
      database: m.database,
      max: 1,
    });
    try {
      await assert.rejects(
        runtime.query("UPDATE zhiban_tutor.sessions SET style='TUTOR'"),
        /permission denied/,
      );
    } finally {
      await runtime.end();
    }
    checks.push('Runtime SQL role cannot mutate the fixed session style');
    const last = (await read(teacher, 'TEACHER')).json.policy;
    assert.equal(
      (await call(base, teacher, { ...policyBody, revision: last.revision, peerEnabled: true }))
        .status,
      200,
    );
  } finally {
    await browser.close();
    await sql.end();
  }
  await writeFile(
    'docs/v2/evidence/zhiban-peer-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        at: new Date().toISOString(),
        scope: 'PRIVATE_COURSE_AI_LEARNING_COMPANION_NOT_CLINICAL_OR_HUMAN_PEER',
        root: m.root,
        sourceHashes: m.sourceHashes,
        model: answer.model,
        continuation,
        answerHash: createHash('sha256').update(answer.answer).digest('hex'),
        sessionId: id,
        checks,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS', checks);
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
