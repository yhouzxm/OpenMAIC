/* eslint-disable @typescript-eslint/no-explicit-any -- raw browser/model evidence envelopes are checked before public projection */
/** Explicit LOCAL real-model/native UI journey. Never run by default startup. */
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { request } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import { makeDocument, makeSlideScene } from '../../tests/agent-runtime/_stage-fixtures';
import { autonomousProject } from '../../tests/zhiban/classroom-ai/pbl-fixtures';
async function main() {
  assert.ok(process.argv.includes('--local-real-model'), 'Explicit --local-real-model required');
  const meta = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  assert.equal(meta.evidenceOrigin, 'LOCAL');
  assert.equal(meta.status, 'RUNNING_LOCAL_PERSISTENT');
  assert.equal(meta.origin, 'https://127.0.0.1:3461');
  assert.equal(meta.port, 56517);
  assert.match(meta.root, /^\/tmp\/zhiban-trial-content-[a-zA-Z0-9]+$/);
  assert.equal(meta.database, 'zhiban_trial_content_disposable');
  const stat = await lstat(meta.accountsPath);
  assert.ok(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid!() &&
      !(stat.mode & 0o077),
  );
  const accountBytes = await readFile(meta.accountsPath),
    accountHash = createHash('sha256').update(accountBytes).digest('hex');
  const accounts = JSON.parse(accountBytes.toString()).accounts as {
    role: string;
    userId: string;
    password: string;
  }[];
  const ca = await readFile('/home/zxm/.local/share/zhiban-m1/development-ca.crt');
  const raw = (
    path: string,
    payload?: unknown,
    cookie?: string,
    csrf?: string,
  ): Promise<{ status: number; json: any; cookie?: string }> =>
    new Promise((resolve, reject) => {
      const text = payload === undefined ? undefined : JSON.stringify(payload);
      const r = request(
        meta.origin + path,
        {
          ca,
          method: text
            ? path.includes('/native/api/persistence/documents/')
              ? 'PUT'
              : 'POST'
            : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(text
              ? {
                  Origin: meta.origin,
                  'content-type': 'application/json',
                  'x-zhiban-command': v7(),
                  'content-length': Buffer.byteLength(text),
                }
              : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...(csrf ? { 'x-zhiban-csrf': csrf } : {}),
          },
        },
        (s) => {
          const chunks: Buffer[] = [];
          s.on('data', (c) => chunks.push(c));
          s.on('end', () => {
            try {
              const bytes = Buffer.concat(chunks).toString();
              resolve({
                status: s.statusCode!,
                json: bytes ? JSON.parse(bytes) : null,
                cookie: s.headers['set-cookie']?.[0]?.split(';')[0],
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      r.on('error', reject);
      r.setTimeout(15000, () => r.destroy(Error('LOCAL request timeout')));
      r.end(text);
    });
  const login = async (role: string) => {
    const a = accounts.find((a) => a.role === role)!;
    const r = await raw('/api/zhiban/identity/login', { userId: a.userId, password: a.password });
    assert.equal(r.status, 200);
    return r.cookie!;
  };
  const teacher = await login('TEACHER');
  let csrf: string | undefined;
  const api = async (path: string, payload?: unknown) => {
    if (payload !== undefined && !csrf) {
      for (let i = 0; i < 4; i++) {
        const t = await raw('/api/zhiban/identity/csrf', undefined, teacher);
        if (t.status === 200) {
          csrf = t.json.csrfToken;
          break;
        }
        assert.equal(t.status, 503);
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(csrf);
    }
    const r = await raw(path, payload, teacher, csrf);
    assert.ok(
      r.status >= 200 && r.status < 300,
      JSON.stringify({ path, status: r.status, body: r.json }),
    );
    return r.json;
  };
  const tenant = meta.trial.tenantId,
    offering = meta.trial.offeringId;
  const author = `/api/zhiban/authoring/${tenant}/offerings/${offering}`,
    content = `/api/zhiban/content/${tenant}/offerings/${offering}`;
  const resume = process.argv.includes('--resume');
  const prepare = async () => {
    const stage = (
      await api(author + '/native/api/stages', { name: '自主PBL：节能与维修沟通（真实模型）' })
    ).stage.id;
    const scenes = [false, true].map((scenario, index) => ({
      ...makeSlideScene(
        'autonomous-' + randomUUID(),
        stage,
        index,
        scenario ? '设备维修角色扮演' : '教室节能自主项目',
      ),
      type: 'pbl',
      content: { type: 'pbl', projectV2: autonomousProject(scenario) },
    }));
    await api(
      author + '/native/api/persistence/documents/' + stage,
      makeDocument(stage, '原生自主PBL：真实旅程', scenes as any),
    );
    const preview = await api(author + '/snapshot', { type: 'PREVIEW', stageId: stage });
    const adopted = await api(author + '/snapshot', {
      type: 'ADOPT',
      stageId: stage,
      sourceDigest: preview.sourceDigest,
    });
    const row = (await api(content)).resources.find((r: any) => r.id === adopted.id);
    await api(content, { type: 'PUBLISH_CONTENT', id: row.id, revision: row.revision });
    const publication = (await api(content + `/resources/${row.id}/preview?source=published`))
      .publicationId;
    const base = `/api/zhiban/classroom-ai/${tenant}/offerings/${offering}/resources/${row.id}/publications/${publication}`;
    await api(base + '/policy', { enabled: true, revision: '0' });
    await api(base + '/pbl-policy', { enabled: true, revision: '0' });
    const url =
      meta.origin +
      '/zhiban/native-classroom?' +
      new URLSearchParams({ tenant, offering, resource: row.id, publication });
    // Persist an exact scope before model calls.
    const sample = {
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      url,
      tenant,
      offering,
      resource: row.id,
      publication,
      sourceDigest: preview.sourceDigest,
      scenes: scenes.map((s) => s.id),
    };
    await writeFile('/tmp/zhiban-native-pbl-real-sample.json', JSON.stringify(sample, null, 2), {
      mode: 0o600,
    });
    return { sample, scenes, base, url };
  };
  const readPrivate = async (path: string) => {
    const st = await lstat(path);
    assert.ok(
      st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid!() && !(st.mode & 0o077),
    );
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const restoredSample = resume
    ? await readPrivate('/tmp/zhiban-native-pbl-real-sample.json')
    : null;
  if (restoredSample) {
    assert.equal(restoredSample.tenant, tenant);
    assert.equal(restoredSample.offering, offering);
    assert.ok(restoredSample.url.startsWith(meta.origin + '/zhiban/native-classroom?'));
  }
  const { sample, scenes, base, url } = restoredSample
    ? {
        sample: restoredSample,
        scenes: restoredSample.scenes.map((id: string) => ({ id })),
        base: `/api/zhiban/classroom-ai/${tenant}/offerings/${offering}/resources/${restoredSample.resource}/publications/${restoredSample.publication}`,
        url: restoredSample.url,
      }
    : await prepare();
  const currentConfigSha256 = createHash('sha256')
    .update(await readFile('openmaic.yml'))
    .digest('hex');
  const earlierConfig = await readFile(
    '/home/zxm/.local/share/zhiban-m1/openmaic-before-autonomous-pbl.json',
  ).catch(() => null);
  const historicalConfigSha256 = earlierConfig
    ? createHash('sha256').update(earlierConfig).digest('hex')
    : undefined;
  const previousCapture = resume
    ? await readPrivate('/tmp/zhiban-native-pbl-real-events.json')
    : null;
  if (previousCapture) assert.deepEqual(previousCapture.sample, sample);
  const failedAttempts = [
    ...(previousCapture?.failedAttempts ?? []),
    ...(previousCapture?.capture ?? [])
      .filter((s: any) => !s.events.some((e: any) => e.type === 'zhiban_commit'))
      .map((s: any) => ({
        endpoint: s.path.split('/').at(-1),
        status: s.status,
        eventCount: s.events.length,
        terminal: 'NO_COMMIT_REOPEN_REQUIRED',
      })),
  ];
  let priorStreams = (previousCapture?.capture ?? [])
    .filter((s: any) => s.events.some((e: any) => e.type === 'zhiban_commit'))
    .map((s: any) => ({
      ...s,
      modelConfigSha256: s.modelConfigSha256 ?? historicalConfigSha256 ?? null,
      configEvidence: s.modelConfigSha256
        ? 'recorded at request'
        : 'historical stream before configuration change; backup hash',
    }));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const cookie = await login('STUDENT');
  await context.addCookies([
    {
      name: cookie.split('=')[0],
      value: cookie.split('=').slice(1).join('='),
      url: meta.origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await context.addInitScript(
    ({ configSha }) => {
      const original = window.fetch.bind(window);
      (window as any).__pblStreams = [];
      window.fetch = async (...args) => {
        const response = await original(...args),
          path = new URL(String((args[0] as Request)?.url ?? args[0]), location.origin).pathname;
        if (/\/native\/api\/pbl\/v2\/(open-task|instructor|evaluate|simulator)$/.test(path)) {
          const captured = {
            path,
            status: response.status,
            done: false,
            modelConfigSha256: configSha,
            events: [] as any[],
          };
          (window as any).__pblStreams.push(captured);
          void (async () => {
            let buffer = '';
            const decoder = new TextDecoder(),
              reader = response.clone().body?.getReader();
            try {
              if (reader)
                while (true) {
                  const chunk = await reader.read();
                  if (chunk.done) break;
                  buffer += decoder.decode(chunk.value, { stream: true });
                  let i: number;
                  while ((i = buffer.indexOf('\n\n')) >= 0) {
                    const frame = buffer.slice(0, i);
                    buffer = buffer.slice(i + 2);
                    const type = /^event: (.+)$/m.exec(frame)?.[1],
                      data = /^data: (.+)$/m.exec(frame)?.[1];
                    if (type && data && type !== 'token')
                      captured.events.push({ ...JSON.parse(data), type });
                  }
                }
            } finally {
              captured.done = true;
            }
          })();
        }
        return response;
      };
    },
    { configSha: currentConfigSha256 },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => {
    if (r.url().includes('/pbl/v2/'))
      console.log(
        'PBL transport ended',
        new URL(r.url()).pathname.split('/').at(-1),
        r.failure()?.errorText,
      );
  });
  const streams = async () => [
    ...priorStreams,
    ...(await page.evaluate(() => (window as any).__pblStreams as any[])),
  ];
  const waitCommit = async (count: number) => {
    await page.waitForFunction(
      (n) => {
        const s = (window as any).__pblStreams;
        return s.length >= n && s.slice(0, n).every((x: any) => x.done);
      },
      count - priorStreams.length,
      { timeout: 190000 },
    );
    const capture = await streams();
    await writeFile(
      '/tmp/zhiban-native-pbl-real-events.json',
      JSON.stringify({ sample, capture, failedAttempts }),
      { mode: 0o600 },
    );
    for (const stream of capture.slice(0, count)) {
      assert.equal(stream.status, 200);
      assert.ok(
        stream.events.some((e: any) => e.type === 'zhiban_commit'),
        JSON.stringify(stream.events),
      );
      assert.ok(!stream.events.some((e: any) => e.type === 'error'));
    }
  };
  const readState = (scene: string) =>
    page.evaluate(
      async ({ base, scene }) =>
        (await fetch(base + '/native/api/pbl/v2/state?scene=' + encodeURIComponent(scene))).json(),
      { base, scene },
    );
  const say = async (text: string) => {
    const n = (await streams()).length;
    const input = page.getByPlaceholder(/聊聊你的进度|选一个，或自己输入/);
    await input.fill(text);
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await input.press('Enter');
    await waitCommit(n + 1);
  };
  try {
    await page.goto(url);
    const initial = await readState(scenes[0].id);
    const greeted = initial.project.threads.some((t: any) =>
      t.messages.some((m: any) => m.roleType === 'instructor'),
    );
    if (initial.project.uiPhase === 'hero')
      await page
        .getByRole('button', { name: greeted ? '继续做项目' : '开始项目', exact: true })
        .click({ timeout: 45000 });
    if (!greeted) await waitCommit(priorStreams.length + 1);
    console.log('PASS real native Instructor greeting (or exact saved greeting restored)');
    const question = '我打算按题设计算节电量，再用电表核对实际用电。请提醒我怎样区分估算和实测。';
    if (initial.project.status !== 'completed') {
      if (
        !initial.project.threads.some((t: any) =>
          t.messages.some((m: any) => m.content === question),
        )
      )
        await say(question);
      console.log('PASS real native Instructor learner turn');
      if (initial.project.submissions.length === 0) {
        const n = (await streams()).length;
        await page.getByRole('button', { name: '提交产出', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '提交产出' });
        await expect(dialog).toBeVisible();
        await dialog
          .getByRole('textbox')
          .fill(
            '题设有10盏20W灯，每天少开2小时，节约电量=10×20W×2h=400Wh=0.4kWh。这是基于题设的估算，不是现场自动测量。先核对灯具额定功率，记录一周开灯时长，用同一电表在相近教学安排下比较；记录光照、人数等干扰因素，保护教学照度和用电安全。',
          );
        await dialog.getByRole('button', { name: '提交产出', exact: true }).click();
        await waitCommit(n + 1);
      }
      console.log('PASS real native task evaluation');
      const n = (await streams()).length;
      await page.getByRole('button', { name: '完成', exact: true }).click({ timeout: 20000 });
      await waitCommit(n + 2);
    }
    const history = await readState(scenes[0].id);
    assert.equal(history.project.status, 'completed');
    assert.equal(history.project.submissions.length, 1);
    assert.ok(history.project.evaluations.some((e: any) => e.kind === 'final'));
    if (history.project.uiPhase !== 'completed')
      await page.getByRole('button', { name: '查看结业报告', exact: true }).click();
    await expect(page.getByText('项目结业报告', { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await readState(scenes[0].id)).project.uiPhase)
      .toBe('completed');
    await page.screenshot({ path: 'docs/v2/evidence/zhiban-native-pbl-real.png' });
    priorStreams = await streams();
    await page.reload();
    await expect(page.getByText('项目结业报告', { exact: true })).toBeVisible({
      timeout: 45000,
    });
    const restored = await readState(scenes[0].id);
    assert.equal(restored.project.evaluations.length, history.project.evaluations.length);
    console.log('PASS real task, milestone/final evaluations and report reload');
    // Exercise the original native Simulator surface in a second published scene.
    await page.goto(url + '&scene=' + encodeURIComponent(scenes[1].id));
    let scenario = await readState(scenes[1].id);
    const prepGreeted = scenario.project.threads.some((t: any) =>
      t.messages.some((m: any) => m.roleType === 'instructor'),
    );
    if (scenario.project.uiPhase === 'hero')
      await page
        .getByRole('button', { name: prepGreeted ? '继续做项目' : '开始项目', exact: true })
        .click({ timeout: 45000 });
    if (!prepGreeted) await waitCommit(priorStreams.length + 1);
    if (scenario.project.milestones[1].status === 'locked') {
      const n = (await streams()).length;
      await page
        .getByRole('button', { name: '进入情景模拟', exact: true })
        .click({ timeout: 30000 });
      await waitCommit(n + 1);
    }
    scenario = await readState(scenes[1].id);
    if (scenario.project.milestones[1].status !== 'completed') {
      if (
        !scenario.project.threads.some((t: any) =>
          t.messages.some((m: any) => m.roleType === 'user' && m.content.includes('请问指示灯')),
        )
      )
        await say(
          '王老师您好，请问指示灯是否亮起，最近是否更换过插座或连接线？请先停止通电尝试，不拆带电设备，我们核对现象后联系专业维修。',
        );
      await page.getByRole('button', { name: '完成这一幕', exact: true }).click({ timeout: 30000 });
    }
    await expect
      .poll(
        async () => {
          const s = await readState(scenes[1].id);
          return (
            s.project.status === 'completed' &&
            s.project.evaluations.some((e: any) => e.kind === 'final')
          );
        },
        { timeout: 300000, intervals: [1000] },
      )
      .toBe(true);
    scenario = await readState(scenes[1].id);
    if (scenario.project.uiPhase !== 'completed')
      await page
        .getByRole('button', { name: '查看结业报告', exact: true })
        .click({ timeout: 30000 });
    await expect(page.getByText('项目结业报告', { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await readState(scenes[1].id)).project.uiPhase)
      .toBe('completed');
    await page.screenshot({ path: 'docs/v2/evidence/zhiban-native-pbl-scenario-real.png' });
    await page.waitForFunction(() => (window as any).__pblStreams.every((s: any) => s.done));
    priorStreams = await streams();
    await page.reload();
    await expect(page.getByText('项目结业报告', { exact: true })).toBeVisible({ timeout: 45000 });
    assert.equal((await readState(scenes[1].id)).project.status, 'completed');
    await writeFile(
      '/tmp/zhiban-native-pbl-real-events.json',
      JSON.stringify({ sample, capture: await streams(), failedAttempts }),
      { mode: 0o600 },
    );
    console.log('PASS real Simulator, act completion, automatic wrapup/final report and reload');
    assert.deepEqual(errors, []);
    assert.equal(
      createHash('sha256')
        .update(await readFile(meta.accountsPath))
        .digest('hex'),
      accountHash,
    );
    const events = await readFile('/tmp/zhiban-native-pbl-real-events.json');
    await writeFile(
      'docs/v2/evidence/zhiban-native-pbl-real-model.json',
      JSON.stringify(
        {
          ...sample,
          status: 'PASS',
          checkedAt: new Date().toISOString(),
          gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          dirtyCandidate: true,
          mode: resume
            ? 'REAL_MODEL_NATIVE_UI_RESUMED_NO_REPLAY'
            : 'REAL_MODEL_NATIVE_UI_NO_REPLAY',
          captureSha256: createHash('sha256').update(events).digest('hex'),
          accountsPreserved: accountHash,
          checks: [
            'Native Instructor greeting and learner turn',
            'Native text submission and real task evaluation',
            'Learner completion confirmation, real milestone/final evaluations',
            'Own persistent project/evaluation reload; no formal grade claim',
            'Native Simulator greeting, learner turn, act completion, automatic wrapup/final report and reload',
          ],
          failedAttempts,
          localModelConfigSha256: createHash('sha256')
            .update(await readFile('openmaic.yml'))
            .digest('hex'),
          classroomThinking:
            'currently disabled; first five successful historical streams used the prior inherited default',
          streamConfiguration: (await streams()).map((s: any) => ({
            endpoint: s.path.split('/').at(-1),
            configSha256: s.modelConfigSha256 ?? null,
          })),
          nativeRuntimeStreams: (await streams()).length,
          providerCallCount: 'not asserted (native agents may make multiple provider calls)',
          evaluations: history.project.evaluations.map((e: any) => ({
            kind: e.kind,
            score: e.score ?? null,
          })),
          pageErrors: errors,
        },
        null,
        2,
      ) + '\n',
    );
    assert.deepEqual(errors, []);
    assert.equal(
      createHash('sha256')
        .update(await readFile(meta.accountsPath))
        .digest('hex'),
      accountHash,
    );
    console.log('PASS LOCAL real autonomous PBL; public evidence omits raw chat and credentials');
  } catch (error) {
    await page.screenshot({ path: '/tmp/zhiban-native-pbl-real-failure.png' }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
