/** Directed LOCAL contract journey. Seeded native result is explicitly FIXTURE, never provider proof. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { v7 } from 'uuid';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import {
  document as contentDocument,
  draft,
  hash,
  emptyDraft,
} from '@/lib/zhiban/infrastructure/content/model';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { generateRunId } from '@/lib/server/generation/run/store';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  native: Pool;
  product?: boolean;
};
export async function verifyLesson(input: Input) {
  const { actors, http, trial, tenant, record, native, browser, origin } = input;
  const artifactRoot = input.product
    ? 'docs/v2/evidence/lesson-product'
    : 'docs/v2/evidence/lesson';
  const [teacher, student, , , manager] = actors;
  const offering = trial.offeringId;
  const base = `/api/zhiban/content/${tenant}/offerings/${offering}`;
  const ai = base + '/ai';
  const send = (value: unknown, actor = teacher, key = randomUUID().replaceAll('-', '')) =>
    http(ai, actor, value, 'POST', { 'x-zhiban-command': key });
  const capability = await http(ai, teacher);
  assert.equal(capability.status, 200);
  // This verifier intentionally requires a keyless host and never bills a provider.
  assert.equal((capability.json as { capability: { ready: boolean } }).capability.ready, false);
  assert.equal(
    (await send({ type: 'START', requirement: '说明欧姆定律并给出课堂例题' })).status,
    503,
  );
  assert.equal((await native.query('SELECT count(*) FROM generation_runs')).rows[0].count, '0');
  for (const actor of [student, manager]) assert.equal((await http(ai, actor)).status, 403);
  assert.equal((await http(ai)).status, 401);
  record(
    'AI lesson: missing model is explicit, creates no native run; anonymous/student/admin cannot acquire authoring',
  );
  assert.equal(
    (await send({ type: 'START', requirement: '合法备课要求', apiKey: 'not-a-secret' })).status,
    400,
  );
  assert.equal(
    (
      await http(ai, teacher, { type: 'START', requirement: '合法备课要求' }, 'POST', {
        'x-zhiban-command': randomUUID().replaceAll('-', ''),
        'x-zhiban-csrf': 'invalid',
      })
    ).status,
    403,
  );
  const owner = `lesson:${hash(`${tenant}:${offering}:${teacher.member}`)}`;
  const run = generateRunId(),
    stage = randomUUID(),
    d = emptyDraft('FIXTURE：欧姆定律文字讲义');
  d.slides[0].elements = [
    {
      id: d.slides[0].id.slice(0, -1) + (d.slides[0].id.endsWith('1') ? '2' : '1'),
      text: '电压、电流与电阻：U = I × R。',
      x: 20,
      y: 20,
      width: 900,
      height: 480,
    },
  ];
  if (input.product)
    d.slides.push({
      id: v7(),
      elements: [
        {
          x: 20,
          y: 20,
          width: 900,
          height: 480,
          id: d.slides[0].elements[0].id.slice(0, -1) + '5',
          text: '第二页同步讲义',
        },
      ],
    });
  const doc = contentDocument(
    draft(d),
    stage,
    d.slides.map(() => randomUUID()),
    Date.now(),
  );
  if (input.product)
    doc.scenes[0].content.canvas.elements.push({
      id: randomUUID(),
      type: 'latex',
      latex: String.raw`I=\frac{12}{6}=2`,
      left: 20,
      top: 300,
      width: 500,
      height: 100,
      rotate: 0,
    });
  await (await getOwnerScopedDocumentStore(owner)).createDocument(doc);
  const seed = {
    requirement: 'FIXTURE ONLY — no model was invoked',
    materialIds: [],
    interactive: false,
    taskEngine: false,
    agents: { mode: 'preset', agentIds: ['default-1'] },
    outlineReview: 'wait',
  };
  await native.query(
    `INSERT INTO generation_runs(id,owner_id,input,state,stage_id,scenes_total,scenes_completed) VALUES($1,$2,$3,'completed',$4,1,1)`,
    [run, owner, seed, stage],
  );
  await native.query(
    'INSERT INTO zhiban_lesson_runs(owner_id,command_key,intent_digest,run_id,tenant_id,offering_id,member_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [owner, 'fixture-command', hash('fixture'), run, tenant, offering, teacher.member],
  );
  const preview = await send({ type: 'PREVIEW', runId: run });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  if (input.product) assert.ok(JSON.stringify(preview.json).includes('(12) / (6)'));
  const concurrent = await Promise.all([
    send({ type: 'ADOPT', runId: run }),
    send({ type: 'ADOPT', runId: run }),
  ]);
  assert.equal(concurrent[0].status, 200, JSON.stringify(concurrent));
  assert.equal(concurrent[1].status, 200, JSON.stringify(concurrent));
  assert.deepEqual(concurrent[0].json, concurrent[1].json);
  const adopted = concurrent[0];
  assert.equal(adopted.status, 200, JSON.stringify(adopted.json));
  const id = (adopted.json as { id: string }).id;
  const replay = await send({ type: 'ADOPT', runId: run });
  assert.equal((replay.json as { id: string }).id, id);
  assert.equal(
    (await http(`${base}/resources/${id}/preview?source=published`, student)).status,
    409,
  );
  assert.equal((await send({ type: 'ADOPT', runId: run }, student)).status, 403);
  const unknown = await send({ type: 'PREVIEW', runId: 'run_unknown' });
  assert.equal(unknown.status, 404);
  const other = actors[2];
  assert.notEqual(other.member, teacher.member);
  // Same tenant teacher with no assignment cannot read or adopt another owner's source.
  assert.equal((await send({ type: 'PREVIEW', runId: run }, other)).status, 403);
  record(
    'AI lesson FIXTURE: native completed result preview/adopt creates one audited DRAFT; replay is stable and students cannot read unpublished content',
  );
  const publish = await http(
    base,
    teacher,
    { type: 'PUBLISH_CONTENT', id, revision: '1' },
    'POST',
    { 'x-zhiban-command': randomUUID().replaceAll('-', '') },
  );
  assert.equal(publish.status, 200, JSON.stringify(publish.json));
  const seen = await http(`${base}/resources/${id}/preview?source=published`, student);
  assert.equal(seen.status, 200, JSON.stringify(seen.json));
  assert.ok(JSON.stringify(seen.json).includes('电压、电流与电阻'));
  record(
    'AI lesson FIXTURE: explicit existing Bridge publication activates immutable text; enrolled student reads published content only',
  );
  await native.query("UPDATE generation_runs SET state='paused' WHERE id=$1", [run]);
  assert.equal((await send({ type: 'ADOPT', runId: run })).status, 409);
  await native.query("UPDATE generation_runs SET state='completed' WHERE id=$1", [run]);
  // Ending the actual assignment blocks every new generation read/adopt, including replays.
  const ended = await input.admin.query(
    "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=(extract(epoch FROM clock_timestamp())*1000)::bigint,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 RETURNING id",
    [tenant, offering, teacher.member],
  );
  assert.equal(ended.rowCount, 1);
  assert.equal((await http(ai, teacher)).status, 403);
  assert.equal((await send({ type: 'ADOPT', runId: run })).status, 403);
  await input.admin.query(
    "UPDATE zhiban_academic.assignments SET status='ACTIVE',valid_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND id=$2",
    [tenant, ended.rows[0].id],
  );
  record(
    'AI lesson: incomplete results cannot adopt; ended assignment denies new reads and adoption replays',
  );
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/zhiban');
  await page.getByLabel('账号 ID', { exact: true }).fill(teacher.uid);
  await page.getByLabel('密码', { exact: true }).fill(teacher.password);
  await page.getByRole('button', { name: '登录并进入', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  const workspace = await http(
    `/api/zhiban/workspace/${tenant}/courses?q=${offering}&limit=50`,
    teacher,
  );
  const course = (workspace.json as { rows: Array<{ id: string; course_id: string }> }).rows.find(
    (r) => r.id === offering,
  )!;
  await page.goto(
    `${origin}/zhiban/teacher/courses/${course.course_id}/resources?space=${tenant}&offering=${offering}`,
  );
  await page.getByText('教师 AI 备课：生成 → 采用 → 发布', { exact: true }).click();
  await expect(page.getByRole('button', { name: '生成讲义草稿', exact: true })).toBeDisabled();
  await expect(
    page.getByText('尚未配置生成模型；可继续使用下方手工讲义编辑。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '审核生成讲义', exact: true }).click();
  await expect(
    page.getByText('电压、电流与电阻：U = I × R。', { exact: false }).last(),
  ).toBeVisible();
  await page.getByRole('button', { name: '采用为可编辑讲义草稿', exact: true }).click();
  await expect(page.getByRole('link', { name: '打开已采用草稿', exact: true })).toHaveAttribute(
    'href',
    new RegExp(id),
  );
  if (input.product) {
    await expect(page.getByRole('heading', { name: '内容草稿', exact: true })).toBeVisible();
    await expect(page.getByLabel('正文 1', { exact: true })).toHaveValue(/\(12\) \/ \(6\)/);
    await page.getByLabel('正文 1', { exact: true }).fill('取消切换后保留的未保存内容');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: '采用为可编辑讲义草稿', exact: true }).click();
    await expect(page.getByLabel('正文 1', { exact: true })).toHaveValue(
      '取消切换后保留的未保存内容',
    );
    await expect(
      page.getByText('已采用为草稿；当前修改已保留，可稍后打开采用草稿。', { exact: true }),
    ).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('link', { name: '打开已采用草稿', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: '内容草稿', exact: true })).toBeVisible();
    await expect(page.getByLabel('正文 1', { exact: true })).toHaveValue(/\(12\) \/ \(6\)/);
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${artifactRoot}/teacher.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${artifactRoot}/teacher-mobile.png`, fullPage: true });
  await context.close();
  const isolation = (
    await input.admin.query(
      "SELECT has_database_privilege('zhiban_bridge_runtime','zhiban_trial_lesson_native','CONNECT') AS bridge_connect,has_database_privilege('zhiban_runtime','zhiban_trial_lesson_native','CONNECT') AS identity_connect,has_table_privilege('zhiban_lesson_runtime','zhiban_identity.memberships','SELECT') AS identity_read",
    )
  ).rows[0];
  assert.deepEqual(isolation, {
    bridge_connect: false,
    identity_connect: false,
    identity_read: false,
  });
  assert.equal((await http('/api/generation-runs', teacher)).status, 404);
  const cancelled = generateRunId();
  await native.query(
    "INSERT INTO generation_runs(id,owner_id,input,state) VALUES($1,$2,$3,'paused')",
    [cancelled, owner, seed],
  );
  await native.query(
    'INSERT INTO zhiban_lesson_runs(owner_id,command_key,intent_digest,run_id,tenant_id,offering_id,member_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [owner, 'cancel-fixture', hash('cancel'), cancelled, tenant, offering, teacher.member],
  );
  assert.equal((await send({ type: 'CANCEL', runId: cancelled })).status, 200);
  assert.equal(
    (await native.query('SELECT state FROM generation_runs WHERE id=$1', [cancelled])).rows[0]
      .state,
    'ended',
  );
  record(
    input.product
      ? 'AI lesson browser: formula-preserving adoption opens draft automatically; dirty cancel preserves input and guarded fallback opens draft without script errors'
      : 'AI lesson browser: course panel, missing-model explanation, review and idempotent adopt link work without script errors',
  );
  await writeFile(
    input.product
      ? `${artifactRoot}/adopt-journey.json`
      : 'docs/v2/evidence/zhiban-lesson-journey-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        providerGeneration: 'NOT_CONFIGURED_NOT_EXECUTED',
        fixture: 'EXPLICIT_NATIVE_RESULT_FIXTURE_ONLY',
        checks: 5,
      },
      null,
      2,
    ) + '\n',
  );
  return { resourceId: id };
}
