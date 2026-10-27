import { localPgMajor } from './pg-version';
/** LOCAL disposable classroom-host acceptance; no formal Runtime activation. */
/* eslint-disable @typescript-eslint/no-explicit-any -- wire assertions include malformed native envelopes */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import { makeDocument, makeSlideScene } from '../../tests/agent-runtime/_stage-fixtures';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  native: Pool;
};
export async function verifyClassroomAi(input: Input) {
  const { http, actors, tenant, trial, browser, origin, native, admin, record } = input;
  const [teacher, student, outsider, , manager] = actors;
  const author = `/api/zhiban/authoring/${tenant}/offerings/${trial.offeringId}`;
  const content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const ok = async (path: string, payload?: unknown, actor = teacher, method?: string) => {
    const r = await http(path, actor, payload, method);
    assert.ok(
      r.status >= 200 && r.status < 300,
      JSON.stringify({ path, status: r.status, body: r.json }),
    );
    return r.json as any;
  };
  const before = (
    await admin.query(
      'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1',
      [tenant],
    )
  ).rows[0].n;
  const stage = (await ok(author + '/native/api/stages', { name: '原生 AI 课堂：欧姆定律' })).stage
    .id;
  const scene = makeSlideScene('ai-slide', stage, 0, '欧姆定律与电路计算');
  if (scene.content.type === 'slide') {
    scene.content.canvas.viewportRatio = 9 / 16;
    scene.content.canvas.elements = [
      {
        id: 'ohm-text',
        type: 'text',
        left: 40,
        top: 40,
        width: 850,
        height: 200,
        rotate: 0,
        defaultFontName: 'Arial',
        defaultColor: '#111827',
        content: '<p>欧姆定律 I = U / R。电压 12V，电阻 6Ω，电流 2A。</p>',
      },
    ];
  }
  scene.actions = [{ id: 'speech-1', type: 'speech', text: '请观察电压、电流和电阻的关系。' }];
  const second = makeSlideScene('ai-slide-2', stage, 1, '电路证据与解释');
  if (second.content.type === 'slide') second.content.canvas.viewportRatio = 9 / 16;
  const interactive = {
    ...makeSlideScene('ai-interactive', stage, 2, '原生互动'),
    type: 'interactive',
    content: {
      type: 'interactive',
      html: '<!doctype html><html><body><button id="measure">开始测量</button><script>document.getElementById("measure").onclick=e=>e.target.textContent="测量完成 2A"</script></body></html>',
    },
  };
  const quiz = {
    ...makeSlideScene('ai-quiz', stage, 3, '个人课件自测'),
    type: 'quiz',
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'unit-current',
          type: 'single',
          question: '电流的单位是什么？',
          options: [
            { value: 'A', label: '安培' },
            { value: 'B', label: '伏特' },
          ],
          answer: 'A',
          points: 1,
        },
      ],
    },
  };
  const doc = makeDocument(stage, '原生 AI 课堂：欧姆定律', [
    scene,
    second,
    interactive,
    quiz,
  ] as any);
  await ok(author + '/native/api/stages/' + stage, doc, teacher, 'PUT');
  const preview = await ok(author + '/snapshot', { type: 'PREVIEW', stageId: stage });
  const adopted = await ok(author + '/snapshot', {
    type: 'ADOPT',
    stageId: stage,
    sourceDigest: preview.sourceDigest,
  });
  const row = (await ok(content)).resources.find((r: any) => r.id === adopted.id);
  await ok(content, { type: 'PUBLISH_CONTENT', id: adopted.id, revision: row.revision });
  const publication = (
    await ok(content + `/resources/${adopted.id}/preview?source=published`, undefined, student)
  ).publicationId;
  const base = `/api/zhiban/classroom-ai/${tenant}/offerings/${trial.offeringId}/resources/${adopted.id}/publications/${publication}`;
  let boot = await ok(base, undefined, student);
  assert.equal(boot.enabled, false);
  assert.equal(boot.formalResults, false);
  assert.equal((await http(base, outsider)).status, 403);
  assert.equal((await http(base)).status, 401);
  assert.equal(
    (await http(base + '/policy', student, { enabled: true, revision: '0' })).status,
    403,
  );
  assert.equal(
    (await http(base + '/policy', manager, { enabled: true, revision: '0' })).status,
    403,
  );
  assert.equal((await http(base + '/native/api/stage-meta/' + boot.stageId, student)).status, 403);
  await ok(base + '/policy', { enabled: true, revision: '0' });
  assert.equal(
    (await http(base + '/policy', teacher, { enabled: false, revision: '0' })).status,
    409,
  );
  assert.ok(
    (
      await http(base + '/policy', teacher, { enabled: false, revision: '1' }, 'POST', {
        'x-zhiban-csrf': 'invalid',
      })
    ).status >= 400,
  );
  boot = await ok(base, undefined, student);
  const teacherBoot = await ok(base);
  assert.notEqual(teacherBoot.stageId, boot.stageId);
  const n = base + '/native/api';
  const loaded = await ok(n + '/persistence/documents/' + boot.stageId, undefined, student);
  assert.equal(loaded.stage.name, doc.stage.name);
  assert.ok(loaded.scenes[2].content.url.includes('/frame?publication='));
  assert.equal(loaded.scenes[2].content.html, undefined);
  assert.equal(
    (await http(n + '/persistence/documents/' + teacherBoot.stageId, student)).status,
    403,
  );
  assert.equal(
    (await http(n + '/persistence/documents/' + boot.stageId, student, loaded, 'PUT')).status,
    403,
  );
  assert.equal((await http(author + '/native/api/stages/' + stage, student)).status, 403);
  assert.ok((await http(n + '/runtime', student, {}, 'DELETE')).status >= 400);
  const sessionId = 'local-ai-' + randomUUID();
  await ok(
    n + '/persistence/runtime/sessions',
    {
      id: sessionId,
      stageId: boot.stageId,
      learnerKey: boot.owner,
      kind: 'chat',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
    },
    student,
  );
  assert.equal((await http(n + '/persistence/runtime/sessions/' + sessionId, teacher)).status, 404);
  assert.equal(
    (await ok(n + '/persistence/runtime/sessions/' + sessionId, undefined, student)).id,
    sessionId,
  );
  assert.equal(
    (
      await http(n + '/persistence/runtime/sessions', student, {
        id: 'forged-' + randomUUID(),
        stageId: boot.stageId,
        learnerKey: teacherBoot.owner,
        kind: 'chat',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await http(n + '/chat/pi', student, {
        messages: [],
        storeState: { stage: { id: stage }, currentSceneId: scene.id },
        config: { agentIds: ['default-1'] },
      })
    ).status,
    403,
  );
  await ok(
    author + '/native/api/stages/' + stage,
    { ...doc, stage: { ...doc.stage, name: '发布后的私有修改' } },
    teacher,
    'PUT',
  );
  assert.equal(
    (await ok(n + '/persistence/documents/' + boot.stageId, undefined, student)).stage.name,
    doc.stage.name,
  );
  await assert.rejects(
    native.query(
      'UPDATE zhiban_classroom_ai_policy_events SET enabled=false WHERE publication_id=$1',
      [publication],
    ),
    /append only/,
  );
  record(
    'Fixed publication, teacher-only CAS policy/audit, CSRF, member/private runtime and document/provider forgery boundaries PASS',
  );
  // A concurrent disable must wait for an in-flight native commit lease.
  const lock = await native.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT 1 FROM zhiban_classroom_ai_policy WHERE publication_id=$1 FOR SHARE', [
    publication,
  ]);
  let settled = false;
  const disabling = ok(base + '/policy', { enabled: false, revision: '1' }).finally(() => {
    settled = true;
  });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(settled, false);
  await lock.query('COMMIT');
  lock.release();
  await disabling;
  assert.equal((await http(n + '/persistence/runtime/sessions/' + sessionId, student)).status, 403);
  await ok(base + '/policy', { enabled: true, revision: '2' });
  record(
    'Concurrent policy disable waits for runtime transaction lease; subsequent runtime access refused PASS',
  );
  const sc = await browser.newContext();
  await sc.addCookies([
    {
      name: student.cookie!.split('=')[0],
      value: student.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await sc.newPage(),
    errors: string[] = [],
    failed: string[] = [];
  let expectRevocation = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (
      r.status() >= 400 &&
      !(expectRevocation && r.status() === 403) &&
      !(
        r.status() === 404 &&
        r.request().method() === 'GET' &&
        r.url().includes('/runtime/sessions/quiz-attempt%3A')
      )
    )
      failed.push(r.status() + ' ' + new URL(r.url()).pathname);
  });
  try {
    await page.goto(
      origin +
        `/zhiban/native-classroom?tenant=${tenant}&offering=${trial.offeringId}&resource=${adopted.id}&publication=${publication}`,
    );
    await expect(
      page.getByText('欧姆定律 I = U / R。电压 12V，电阻 6Ω，电流 2A。', { exact: false }).first(),
    ).toBeVisible({ timeout: 45000 });
    await expect(
      page.getByText('本人问答／圆桌／白板／自测与自主 PBL', { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path:
        localPgMajor === 18
          ? 'docs/v2/evidence/zhiban-pg18-native-classroom-desktop.png'
          : 'docs/v2/evidence/zhiban-native-ai-classroom-desktop.png',
      fullPage: true,
    });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
        'Responsive width ' + width,
      );
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({
      path:
        localPgMajor === 18
          ? 'docs/v2/evidence/zhiban-pg18-native-classroom-desktop.png'
          : 'docs/v2/evidence/zhiban-native-ai-classroom-desktop.png',
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByText('欧姆定律 I = U / R。电压 12V，电阻 6Ω，电流 2A。', { exact: false }).first(),
    ).toBeVisible({ timeout: 30000 });
    const next = page.getByLabel('Next scene', { exact: true });
    await next.click();
    await next.click();
    const frame = page.frameLocator('iframe:visible');
    await expect(frame.getByRole('button', { name: '开始测量', exact: true })).toBeVisible();
    await frame.getByRole('button', { name: '开始测量', exact: true }).click();
    await expect(frame.getByRole('button', { name: '测量完成 2A', exact: true })).toBeVisible();
    await next.click();
    await page.getByRole('button', { name: /开始.*(测验|答题)/ }).click();
    await page.getByText('安培', { exact: true }).click();
    await page.getByRole('button', { name: '提交答案', exact: true }).click();
    await expect(page.getByText('答题报告', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('答题报告', { exact: true })).toBeVisible({ timeout: 30000 });
    for (let i = 0; i < 3; i++) {
      await page.getByLabel('Previous scene', { exact: true }).click();
      await page.waitForLoadState('networkidle');
    }
    record(
      'Native opaque HTML interaction and personal Quiz submission/review survive reload without formal grades PASS',
    );
    expectRevocation = true;
    await ok(base + '/policy', { enabled: false, revision: '3' });
    await expect(page.getByRole('heading', { name: '该发布版本的 AI 课堂尚未启用' })).toBeVisible({
      timeout: 12000,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    await ok(base + '/policy', { enabled: true, revision: '4' });
    await expect(page.getByLabel('Play', { exact: true })).toBeVisible({ timeout: 15000 });
    record(
      'Native ClassroomSurface load/reload, desktop/tablet/mobile and live disable/re-enable PASS',
    );
  } catch (e) {
    await page.screenshot({ path: '/tmp/zhiban-classroom-ai-failure.png', fullPage: true });
    console.error(
      'CLASSROOM_BROWSER',
      JSON.stringify({
        errors,
        failed,
        body: (await page.locator('body').innerText()).slice(0, 12000),
      }),
    );
    throw e;
  } finally {
    await sc.close();
  }
  const manage = (command: unknown) =>
    ok(`/api/zhiban/management/${tenant}/commands`, command, manager);
  const enrollment = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [tenant, trial.offeringId, student.member],
    )
  ).rows[0];
  await manage({ type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision });
  assert.equal((await http(base, student)).status, 403);
  assert.equal((await http(n + '/persistence/runtime/sessions/' + sessionId, student)).status, 403);
  const withdrawn = (
    await admin.query('SELECT revision::text FROM zhiban_academic.enrollments WHERE id=$1', [
      enrollment.id,
    ])
  ).rows[0];
  await manage({
    type: 'ENROLL',
    offeringId: trial.offeringId,
    membershipId: student.member,
    revision: withdrawn.revision,
  });
  assert.equal(
    (await ok(n + '/persistence/runtime/sessions/' + sessionId, undefined, student)).id,
    sessionId,
  );
  const assignment = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [tenant, trial.offeringId, teacher.member],
    )
  ).rows[0];
  await manage({ type: 'END_TEACHER', id: assignment.id, revision: assignment.revision });
  assert.equal((await http(base, teacher)).status, 403);
  assert.equal(
    (await http(base + '/policy', teacher, { enabled: false, revision: '5' })).status,
    403,
  );
  const ended = (
    await admin.query('SELECT revision::text FROM zhiban_academic.assignments WHERE id=$1', [
      assignment.id,
    ])
  ).rows[0];
  await manage({
    type: 'ASSIGN_TEACHER',
    offeringId: trial.offeringId,
    membershipId: teacher.member,
    revision: ended.revision,
  });
  record(
    'Enrollment withdrawal and ended teaching assignment refuse cached classroom/history/policy; restored authorization restores only own history PASS',
  );
  const current = (await ok(content)).resources.find((r: any) => r.id === adopted.id);
  await ok(content, { type: 'WITHDRAW_CONTENT', id: adopted.id, revision: current.revision });
  assert.ok((await http(base, student)).status >= 400);
  assert.ok((await http(n + '/persistence/runtime/sessions/' + sessionId, student)).status >= 400);
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    before,
  );
  record(
    'Withdrawn publication rejects boot/history; personal native practice creates no formal Attempt PASS',
  );
}
