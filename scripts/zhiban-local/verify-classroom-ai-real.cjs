/* eslint-disable @typescript-eslint/no-require-imports -- Explicit bounded real-model LOCAL journey, never part of default startup. */
const fs = require('node:fs'),
  https = require('node:https'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
const { Pool } = require('pg');
async function main() {
  const arg = (name) => process.argv.find((v) => v.startsWith('--' + name + '='))?.split('=')[1];
  const reuse = arg('reuse-captured');
  const resource = arg('resource'),
    publication = arg('publication');
  for (const value of [resource, publication])
    assert.match(
      value ?? '',
      /^[0-9a-f-]{36}$/,
      'Explicit LOCAL published resource/publication required',
    );
  const m = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(m.status, 'RUNNING_LOCAL_PERSISTENT');
  assert.equal(m.evidenceOrigin, 'LOCAL');
  assert.equal(m.githubActions, false);
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  assert.match(m.root, /^\/tmp\/zhiban-trial-content-[a-zA-Z0-9]+$/);
  assert.equal(m.port, 56517);
  const stat = fs.lstatSync(m.accountsPath);
  assert.ok(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid() &&
      !(stat.mode & 0o077),
  );
  const accounts = JSON.parse(fs.readFileSync(m.accountsPath)).accounts;
  const ca = fs.readFileSync('/home/zxm/.local/share/zhiban-m1/development-ca.crt');
  const tenant = m.trial.tenantId,
    offering = m.trial.offeringId;
  const base = `/api/zhiban/classroom-ai/${tenant}/offerings/${offering}/resources/${resource}/publications/${publication}`;
  const login = (a) =>
    new Promise((resolve, reject) => {
      const d = JSON.stringify({ userId: a.userId, password: a.password });
      const r = https.request(
        m.origin + '/api/zhiban/identity/login',
        {
          method: 'POST',
          ca,
          headers: {
            Origin: m.origin,
            'content-type': 'application/json',
            'x-zhiban-request': 'identity-v1',
            'content-length': Buffer.byteLength(d),
          },
        },
        (s) => {
          s.resume();
          s.on('end', () => {
            try {
              assert.equal(s.statusCode, 200);
              resolve(s.headers['set-cookie'][0].split(';')[0]);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      r.on('error', reject);
      r.setTimeout(10000, () => r.destroy(Error('Login timeout')));
      r.end(d);
    });
  const db = new Pool({
    host: m.root + '/socket',
    port: m.port,
    user: 'postgres',
    database: 'zhiban_trial_lesson_native',
  });
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let page;
  const errors = [],
    failed = [],
    checks = [];
  let csrfRequests = 0;
  const api = async (p, path, payload) =>
    p.evaluate(
      async ({ path, payload }) => {
        const headers = { 'x-zhiban-request': 'identity-v1' };
        if (payload) {
          const c = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
          headers['x-zhiban-csrf'] = (await c.json()).csrfToken;
          headers['content-type'] = 'application/json';
        }
        const r = await fetch(path, {
          method: payload ? 'POST' : 'GET',
          headers,
          body: payload ? JSON.stringify(payload) : undefined,
          cache: 'no-store',
        });
        return { status: r.status, json: await r.json() };
      },
      { path, payload },
    );
  const url =
    m.origin +
    '/zhiban/native-classroom?' +
    new URLSearchParams({ tenant, offering, resource, publication });
  try {
    const tc = await b.newContext(),
      sc = await b.newContext({ viewport: { width: 1440, height: 1000 } });
    for (const [c, role] of [
      [tc, 'TEACHER'],
      [sc, 'STUDENT'],
    ]) {
      const cookie = await login(accounts.find((a) => a.role === role));
      await c.addCookies([
        {
          name: cookie.split('=')[0],
          value: cookie.split('=')[1],
          url: m.origin,
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
    }
    const tp = await tc.newPage();
    await tp.goto(url);
    const initial = await api(tp, base);
    assert.equal(initial.status, 200);
    if (!initial.json.enabled) {
      const r = await api(tp, base + '/policy', { enabled: true, revision: initial.json.revision });
      assert.equal(r.status, 200);
    }
    await tp.close();
    // Observe the actual UI fetch stream; Chromium's Network.getResponseBody cannot reliably read SSE.
    await sc.addInitScript(() => {
      const f = window.fetch.bind(window);
      window.__nativeEvents = [];
      window.__nativeFinished = false;
      window.fetch = async (...a) => {
        const r = await f(...a);
        if (
          new URL(String(a[0]?.url ?? a[0]), location.origin).pathname.endsWith(
            '/native/api/chat/pi',
          )
        ) {
          const reader = r.clone().body?.getReader();
          void (async () => {
            let text = '';
            try {
              while (reader) {
                const n = await reader.read();
                if (n.done) break;
                text += new TextDecoder().decode(n.value);
              }
            } catch (e) {
              window.__nativeReadError = String(e);
            } finally {
              window.__nativeEvents = text
                .split('\n')
                .filter((l) => l.startsWith('data: '))
                .map((l) => {
                  try {
                    return JSON.parse(l.slice(6));
                  } catch {
                    return { type: 'partial' };
                  }
                });
              window.__nativeFinished = true;
            }
          })();
        }
        return r;
      };
    });
    page = await sc.newPage();
    page.on('console', (event) => {
      if (['error', 'warning'].includes(event.type()) || /ChatArea|Playback/.test(event.text()))
        fs.appendFileSync(
          '/tmp/zhiban-classroom-ai-client.log',
          event.type() + ' ' + event.text() + '\n',
          { mode: 0o600 },
        );
    });
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/zhiban/identity/csrf') csrfRequests++;
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      if (
        r.status() >= 400 &&
        !(r.status() === 503 && new URL(r.url()).pathname === '/api/zhiban/identity/csrf') &&
        !(
          r.status() === 404 &&
          new URL(r.url()).pathname.endsWith('/native/api/chat/pi/whiteboard-visibility')
        )
      )
        failed.push(r.status() + ' ' + new URL(r.url()).pathname);
    });
    await page.goto(url);
    await expect(page.getByLabel('Play', { exact: true })).toBeVisible({ timeout: 45000 });
    const boot = (await api(page, base)).json;
    const before = (
      await db.query(
        "SELECT count(*)::int AS n FROM runtime_records r JOIN runtime_sessions s ON s.id=r.session_id WHERE s.stage_id=$1 AND s.learner_key=$2 AND s.kind='whiteboard'",
        [boot.stageId, boot.owner],
      )
    ).rows[0].n;
    let events;
    let capturedAt;
    let capturedDigest;
    if (reuse) {
      const stat = fs.lstatSync(reuse);
      assert.ok(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.uid === process.getuid() &&
          !(stat.mode & 0o077),
      );
      const bytes = fs.readFileSync(reuse),
        capture = JSON.parse(bytes);
      events = capture.events;
      capturedAt = stat.mtime.toISOString();
      capturedDigest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (capture.scope)
        assert.deepEqual(capture.scope, {
          tenant,
          offering,
          resource,
          publication,
          sourceDigest: boot.sourceDigest,
          owner: boot.owner,
          stage: boot.stageId,
        });
      const projections = events.filter(
        (e) => e.type === 'whiteboard' && e.data.kind === 'projection',
      );
      assert.ok(projections.length > 0);
      for (const e of projections) {
        assert.equal(e.data.stageId, boot.stageId);
        assert.equal(
          (
            await db.query(
              "SELECT 1 FROM runtime_records r JOIN runtime_sessions s ON s.id=r.session_id WHERE s.stage_id=$1 AND s.learner_key=$2 AND s.kind='whiteboard' AND r.seq=$3",
              [boot.stageId, boot.owner, e.data.lastSeq],
            )
          ).rowCount,
          1,
        );
      }
    } else {
      await page.locator('button[title="打开白板"]').click();
      await page
        .locator('button:visible')
        .filter({ has: page.locator('svg.lucide-message-square') })
        .last()
        .click();
      const input = page.getByPlaceholder('输入你的消息...', { exact: true });
      await expect(input).toBeVisible();
      const question =
        '请先让老师在白板新增一行“电路证据 U=IR”，并用一句话说明12V、6Ω时电流是2A；再让助教用一句话给出单位检查。老师和助教两位角色都须发言，最后请我继续提问。';
      await input.fill(question);
      const pending = page.waitForResponse(
        (r) => r.url().endsWith('/native/api/chat/pi') && r.request().method() === 'POST',
        { timeout: 120000 },
      );
      await input.press('Enter');
      const r = await pending;
      assert.equal(r.status(), 200);
      await page.waitForFunction(() => window.__nativeFinished, {}, { timeout: 240000 });
      events = await page.evaluate(() => window.__nativeEvents);
      fs.writeFileSync(
        '/tmp/zhiban-classroom-ai-real-events.json',
        JSON.stringify(
          {
            events,
            scope: {
              tenant,
              offering,
              resource,
              publication,
              sourceDigest: boot.sourceDigest,
              owner: boot.owner,
              stage: boot.stageId,
            },
            readError: await page.evaluate(() => window.__nativeReadError),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    const done = events.find((e) => e.type === 'done');
    assert.ok(done, 'Native provider stream reached done');
    assert.equal(events.filter((e) => e.type === 'error').length, 0);
    const participants = [
      ...new Set(events.filter((e) => e.type === 'agent_start').map((e) => e.data.agentId)),
    ];
    assert.ok(participants.length >= 2, 'Actual Director must execute two classroom agents');
    assert.ok(
      done.data.directorToolTrace.some(
        (t) => t.details?.nativeChildRun?.providerTransportCount > 0,
      ),
    );
    checks.push(
      'Actual browser -> native Pi Director -> multiple real GLM classroom agents -> done',
    );
    await expect
      .poll(
        async () =>
          Number(
            (
              await db.query(
                "SELECT count(*)::int AS n FROM runtime_records r JOIN runtime_sessions s ON s.id=r.session_id WHERE s.stage_id=$1 AND s.learner_key=$2 AND s.kind='whiteboard'",
                [boot.stageId, boot.owner],
              )
            ).rows[0].n,
          ),
        { timeout: 20000 },
      )
      .toBeGreaterThan(reuse ? 0 : before);
    checks.push('Real native child whiteboard tool committed a personal runtime operation');
    await page.waitForTimeout(8000);
    const stop = page.getByRole('button', { name: '结束讨论', exact: true });
    if (await stop.isVisible()) await stop.click();
    await page.reload();
    await expect(page.getByLabel('Play', { exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByLabel('Toggle chat', { exact: true }).click();
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    const sessions = page.getByRole('button', { name: /Q&A/ });
    for (let i = 0; i < (await sessions.count()); i++) await sessions.nth(i).click();
    await expect(
      page
        .getByRole('tabpanel', { name: '对话', exact: true })
        .getByText(/2\s*(安培|A)/)
        .last(),
    ).toBeVisible({ timeout: 15000 });
    await page.screenshot({
      path: 'docs/v2/evidence/zhiban-native-ai-classroom-real-model.png',
      fullPage: true,
    });
    checks.push('Reloaded native chat panel displays persisted assistant answer');
    await page.locator('button[title="打开白板"]').click();
    await expect(page.getByText('电路证据 U=IR', { exact: false }).first()).toBeVisible();
    checks.push('Reloaded native whiteboard displays persisted model tool output');
    assert.ok(csrfRequests <= 8, 'Parallel native saves reuse page Session CSRF proof');
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    const record = await db.query(
      'SELECT r.data FROM runtime_records r JOIN runtime_sessions s ON s.id=r.session_id WHERE s.stage_id=$1 AND s.learner_key=$2 ORDER BY r.created_at',
      [boot.stageId, boot.owner],
    );
    fs.writeFileSync(
      'docs/v2/evidence/zhiban-native-ai-classroom-real-model.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          at: new Date().toISOString(),
          scope: 'REAL_NATIVE_CLASSROOM_BROWSER_DIRECTOR_AGENTS_WHITEBOARD_PERSONAL_HISTORY',
          origin: m.origin,
          tenant,
          offering,
          resource,
          publication,
          sourceDigest: boot.sourceDigest,
          model: 'operator-configured native classroom slot',
          modelConfigurationDigest: fs.existsSync('openmaic.yml')
            ? crypto.createHash('sha256').update(fs.readFileSync('openmaic.yml')).digest('hex')
            : null,
          modelEvidenceMode: reuse
            ? 'REAL_CAPTURE_PLUS_AUTHORIZED_UI_RUNTIME_REPLAY_NO_MODEL_REPEAT'
            : 'FRESH_REAL_PROVIDER_CALL',
          capturedAt,
          capturedDigest,
          participants,
          csrfRequests,
          eventTypes: [...new Set(events.map((e) => e.type))],
          checks,
          runtimeRecordCount: record.rowCount,
          runtimeDigest: crypto
            .createHash('sha256')
            .update(JSON.stringify(record.rows))
            .digest('hex'),
          errors,
          failed,
          excluded: [
            'TTS/ASR services unconfigured',
            'formal Attempt/grade/completion',
            'autonomous PBL',
            'frozen Native maintenance activation',
          ],
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS real native classroom agents, whiteboard and reloaded personal history');
  } catch (e) {
    if (page) {
      await page
        .screenshot({ path: '/tmp/zhiban-classroom-ai-real-failure.png', fullPage: true })
        .catch(() => {});
      console.error(
        'BROWSER',
        JSON.stringify({
          errors,
          failed,
          body: (
            await page
              .locator('body')
              .innerText()
              .catch(() => '')
          ).slice(-7000),
        }),
      );
    }
    throw e;
  } finally {
    await b.close();
    await db.end();
  }
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
