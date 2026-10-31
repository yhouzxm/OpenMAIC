/** One LOCAL cross-feature journey for the canonical teaching entry. Existing slice suites are not repeated. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { lecturePng } from './verify-trial-content';
import type { prepareTrial } from './prepare-trial';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
type Result = { id: string; revision: string; dispatchId: string; attemptId: string };
export async function verifyUnifiedTrial(input: Input) {
  const { browser, actors, http, tenant, origin, trial, record, admin } = input;
  const [teacher, student, outsider, , manager] = actors;
  const learning = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const assessment = `/api/zhiban/assessment/${tenant}/offerings/${trial.offeringId}`;
  const route = (role: string, section = '') =>
    `${origin}/zhiban/${role}/courses/${trial.courseId}${section ? '/' + section : ''}?space=${tenant}&offering=${trial.offeringId}`;
  const send = async (path: string, command: unknown, actor = teacher) => {
    const r = await http(path, actor, command, 'POST', { 'x-zhiban-command': randomUUID() });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const tc = await browser.newContext({ acceptDownloads: true }),
    sc = await browser.newContext({ acceptDownloads: true });
  for (const [ctx, actor] of [
    [tc, teacher],
    [sc, student],
  ] as const) {
    await ctx.addCookies([
      {
        name: actor.cookie!.split('=')[0],
        value: actor.cookie!.split('=').slice(1).join('='),
        url: origin,
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
  }
  const tp = await tc.newPage(),
    sp = await sc.newPage(),
    errors: string[] = [];
  for (const p of [tp, sp]) p.on('pageerror', (e) => errors.push(e.message));
  const networkTrace: {
    at: number;
    actor: string;
    event: string;
    method: string;
    path: string;
    command?: string;
    status?: number;
    error?: string;
  }[] = [];
  for (const [actor, page] of [
    ['teacher', tp],
    ['student', sp],
  ] as const) {
    const tracked = (url: string) =>
      url.includes('/api/zhiban/assessment/') || url.endsWith('/api/zhiban/identity/csrf');
    page.on('request', (request) => {
      if (!tracked(request.url())) return;
      const command = request.method() === 'POST' ? request.postDataJSON()?.type : undefined;
      networkTrace.push({
        at: Date.now(),
        actor,
        event: 'REQUEST',
        method: request.method(),
        path: new URL(request.url()).pathname,
        command,
      });
    });
    page.on('response', (response) => {
      if (!tracked(response.url())) return;
      const item = {
        at: Date.now(),
        actor,
        event: 'HEADERS',
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
      };
      networkTrace.push(item);
      void response
        .finished()
        .then((error) =>
          networkTrace.push({
            ...item,
            at: Date.now(),
            event: 'FINISHED',
            ...(error ? { error: error.message } : {}),
          }),
        )
        .catch((error: unknown) => {
          networkTrace.push({
            ...item,
            at: Date.now(),
            event: 'FINISHED_REJECTED',
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
    page.on('requestfailed', (request) => {
      if (tracked(request.url()))
        networkTrace.push({
          at: Date.now(),
          actor,
          event: 'FAILED',
          method: request.method(),
          path: new URL(request.url()).pathname,
          error: request.failure()?.errorText,
        });
    });
  }

  try {
    await tp.goto(route('teacher', 'resources'));
    await tp.getByLabel('新内容标题', { exact: true }).fill('统一试用：安全操作讲义');
    await tp.getByRole('button', { name: '新建内容', exact: true }).click();
    await expect(tp.getByRole('heading', { name: '内容草稿', exact: true })).toBeVisible();
    await tp.getByRole('button', { name: '添加文本框', exact: true }).click();
    await tp
      .getByLabel('正文 1', { exact: true })
      .fill('先阅读讲义与示意图，再提交巡检步骤和记录附件。');
    await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    await tp
      .getByLabel('PNG 文件', { exact: true })
      .setInputFiles({ name: 'lesson.png', mimeType: 'image/png', buffer: lecturePng() });
    await tp.getByRole('button', { name: '上传 PNG', exact: true }).click();
    await expect(tp.getByRole('alert')).toContainText('PNG 已登记');
    await tp.getByRole('button', { name: '添加 PNG 到本页', exact: true }).click();
    await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    await tp.getByRole('button', { name: '发布保存版本', exact: true }).click();
    await expect(tp.getByRole('button', { name: '撤回发布', exact: true })).toBeVisible();
    const resources = (await http(content, teacher)).json as {
      resources: { id: string; title: string }[];
    };
    const lecture = resources.resources.find((r) => r.title === '统一试用：安全操作讲义')!;
    assert.ok(lecture);
    const activity = await send(learning, {
      type: 'CREATE_ACTIVITY',
      title: '统一试用：巡检作业',
      prompt: '结合讲义说明巡检步骤并附记录。',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 3,
    });
    await send(learning, { type: 'PUBLISH_ACTIVITY', ...activity });
    const chapters = [
      {
        id: randomUUID(),
        title: '第一章：安全操作',
        units: [
          { id: randomUUID(), kind: 'LECTURE', target: lecture.id, title: lecture.title },
          { id: randomUUID(), kind: 'ACTIVITY', target: activity.id, title: '巡检作业' },
        ],
      },
    ];
    const outline = (await http(learning + '/outline', teacher)).json as { revision: string };
    const saved = await send(learning + '/outline', {
      type: 'SAVE_OUTLINE',
      revision: outline.revision,
      chapters,
    });
    await send(learning + '/outline', { type: 'PUBLISH_OUTLINE', revision: saved.revision });
    await sp.goto(route('student'));
    await expect(
      sp.getByRole('heading', { name: '1. 第一章：安全操作', exact: true }),
    ).toBeVisible();
    await sp.goto(route('student', 'learning-center'));
    await expect(sp.getByRole('heading', { name: '课程学习中心', exact: true })).toBeVisible();
    await expect(sp.getByRole('navigation', { name: '课程单元目录' })).toContainText(lecture.title);
    await expect(sp.getByLabel('新内容标题', { exact: true })).toHaveCount(0);
    await expect(sp.locator('.content-preview img')).toBeVisible();
    await expect
      .poll(() =>
        sp
          .locator('.content-preview img')
          .evaluate((n: HTMLImageElement) => n.complete && n.naturalWidth === 320),
      )
      .toBe(true);
    record(
      'unified origin: teacher edits/publishes text+PNG and course outline; student learning center reads published directory and decoded PNG using public SlideCanvas and real Content provider',
    );
    const classroom = await send(learning + '/classrooms', {
      type: 'CREATE_CLASSROOM',
      title: '统一试用课堂',
      description: '讲义 → 作业附件 → 评分 → 成绩簿',
      opensAt: null,
      closesAt: null,
    });
    const published = await send(learning + '/classrooms', {
      type: 'PUBLISH_CLASSROOM',
      ...classroom,
    });
    const dispatch = await send(learning + '/classrooms', {
      type: 'DISPATCH_TASK',
      id: classroom.id,
      revision: published.revision,
      kind: 'ACTIVITY',
      target: activity.id,
      version: '1',
    });
    const entered = await send(
      learning + '/classrooms',
      {
        type: 'ENTER_TASK',
        id: classroom.id,
        revision: dispatch.revision,
        dispatchId: dispatch.dispatchId,
      },
      student,
    );
    assert.ok(entered.attemptId);
    await sp.getByRole('link', { name: '下一单元', exact: true }).click();
    await expect(sp).toHaveURL(route('student', 'learning-center/' + chapters[0].units[1].id));
    await expect(sp.getByRole('heading', { name: '巡检作业', exact: true })).toBeVisible();
    const card = sp
      .locator('section.learning-activity')
      .filter({ has: sp.getByRole('heading', { name: '统一试用：巡检作业', exact: true }) });
    await card.getByRole('button', { name: '继续未完成作答', exact: true }).click();
    await card
      .getByLabel('尝试 1 作答', { exact: true })
      .fill('已按讲义检查防护装置，记录见附件。');
    const bytes = Buffer.from('统一课程实际扫描文件\n检查结果：防护完好，已复核。\n');
    await card
      .getByLabel('本次提交附件（PDF／TXT，最多1 MiB，可选）', { exact: true })
      .setInputFiles({ name: '巡检记录.txt', mimeType: 'text/plain', buffer: bytes });
    await expect(card.getByText(/已选择：巡检记录.txt/)).toBeVisible();
    await card.getByRole('button', { name: '最终提交', exact: true }).click();
    await expect(card.getByRole('button', { name: '提交新版本', exact: true })).toBeVisible({
      timeout: 75000,
    });
    const submission = (
      await admin.query(
        'SELECT id FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2 ORDER BY version DESC LIMIT 1',
        [tenant, entered.attemptId],
      )
    ).rows[0];
    assert.ok(submission);
    const stored = (
      await admin.query(
        'SELECT digest,clearance_status,clearance_ref FROM zhiban_learning_files.files WHERE tenant_id=$1 AND submission_id=$2',
        [tenant, submission.id],
      )
    ).rows[0];
    assert.equal(stored.clearance_status, 'TRUSTED_SCANNER');
    assert.equal(stored.digest, createHash('sha256').update(bytes).digest('hex'));
    await tp.goto(route('teacher', 'grades') + '#queue');
    await tp.getByLabel('搜索学生或活动', { exact: true }).fill('统一试用：巡检作业');
    await tp.getByRole('button', { name: '查询评分', exact: true }).click();
    await tp
      .locator('article')
      .filter({ hasText: '统一试用：巡检作业' })
      .getByRole('button', { name: '打开评分', exact: true })
      .click();
    const downloadButton = tp.getByRole('button', { name: /下载附件 巡检记录.txt/ });
    await expect(downloadButton).toBeEnabled();
    const downloading = tp.waitForEvent('download');
    await downloadButton.click();
    const downloaded = await (await downloading).path();
    assert.ok(downloaded);
    assert.deepEqual(await readFile(downloaded!), bytes);
    await tp.getByLabel('满分', { exact: true }).fill('100');
    await tp.getByLabel('得分', { exact: true }).fill('92');
    await tp
      .getByLabel('评分反馈', { exact: true })
      .fill('讲义、作答与附件对应，已完成本次人工评分。');
    const refreshedQueue = tp.waitForResponse(
      (r) => new URL(r.url()).pathname === assessment + '/queue' && r.request().method() === 'GET',
    );
    const savedGrade = tp.waitForResponse(
      (r) =>
        r.url() === origin + assessment &&
        r.request().method() === 'POST' &&
        r.request().postDataJSON()?.type === 'SAVE_GRADE',
    );
    await tp.getByRole('button', { name: '保存评分草稿', exact: true }).click();
    assert.equal((await savedGrade).status(), 200);
    const queueResponse = await refreshedQueue;
    assert.equal(queueResponse.status(), 200);
    assert.equal(await queueResponse.finished(), null);
    await expect(tp.getByText('评分草稿待发布', { exact: true })).toBeVisible();
    const publishedGrade = tp.waitForResponse(
      (r) =>
        r.url() === origin + assessment &&
        r.request().method() === 'POST' &&
        r.request().postDataJSON()?.type === 'PUBLISH_GRADE',
      { timeout: 15000 },
    );
    await tp.getByRole('button', { name: '发布成绩', exact: true }).click();
    assert.equal((await publishedGrade).status(), 200);
    await expect(tp.getByRole('heading', { name: /成绩版本 1（该提交当前成绩）/ })).toBeVisible();
    await tp.screenshot({
      path: 'docs/v2/evidence/zhiban-unified-teacher-local.png',
      fullPage: true,
    });
    await sp.goto(route('student', 'grades'));
    await expect(sp.getByText(/已发布成绩 92 \/ 100/).first()).toBeVisible();
    record(
      'same course: classroom dispatch binds student attempt; UI submits scanned TXT; teacher downloads exact bytes and publishes 92/100; student sees published grade',
    );
    await tp.goto(route('teacher', 'grades'));
    await expect(tp.getByRole('heading', { name: '课程成绩簿', exact: true })).toBeVisible();
    const csvWaiting = tp.waitForEvent('download');
    await tp.getByRole('button', { name: '导出当前页 CSV', exact: true }).click();
    const csvPath = await (await csvWaiting).path();
    assert.ok(csvPath);
    assert.ok((await readFile(csvPath, 'utf8')).includes('92.00'));
    for (const actor of [student, outsider, manager])
      assert.equal((await http(assessment + '/gradebook.csv', actor)).status, 403);
    assert.equal(
      (await http(`${content}/resources/${lecture.id}/preview?source=published`, outsider)).status,
      403,
    );
    for (const path of ['/api/zhiban/runtime/', '/api/zhiban/control/'])
      assert.equal((await http(path, teacher)).status, 404);
    await tp.goto(route('teacher', 'learning-center'));
    await expect(tp.getByText(/教师预览（已发布内容）/)).toBeVisible();
    await expect(tp.getByRole('button', { name: '新建内容', exact: true })).toHaveCount(0);
    await sp.goto(route('student', 'learning-center/' + randomUUID()));
    await expect(sp.getByRole('alert')).toContainText('单元不存在、未发布或已不可访问');
    await sp.getByRole('link', { name: '返回学习目录', exact: true }).click();
    await expect(sp.locator('.content-preview img')).toBeVisible();
    await sp.getByRole('link', { name: '下一单元', exact: true }).click();
    await sp.getByRole('link', { name: '上一单元', exact: true }).click();
    await expect(sp.locator('.content-preview img')).toBeVisible();
    record(
      'course learning entry: typed unit URLs, previous/next navigation, published-only teacher preview, unknown-unit denial and return to authorized directory pass',
    );
    await sp.setViewportSize({ width: 390, height: 844 });
    assert.ok(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await sp.screenshot({
      path: 'docs/v2/evidence/zhiban-unified-student-local.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await writeFile(
      'docs/v2/evidence/zhiban-unified-journey-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          origin,
          tenant,
          course: trial.courseId,
          offering: trial.offeringId,
          classroom: classroom.id,
          lecture: lecture.id,
          activity: activity.id,
          attempt: entered.attemptId,
          submission: submission.id,
          file: stored,
          grade: '92/100',
          ordinaryChromiumDownloads: 'attachment bytes and gradebook CSV read back',
          excluded: [
            'Native maintenance inputs',
            'Runtime/AI',
            'old visual parity',
            'native refresh/close signoff',
          ],
        },
        null,
        2,
      ) + '\n',
    );
    record(
      'unified gradebook CSV reads back current 92/100; unauthorized export/content rejected, Runtime/control closed; student 390px has no overflow or script errors',
    );
  } catch (error) {
    await tp
      .screenshot({
        path: 'docs/v2/evidence/zhiban-learning-center-failure-local.png',
        fullPage: true,
      })
      .catch(() => {});
    await writeFile(
      '/tmp/zhiban-learning-center-failure.txt',
      await tp.locator('body').innerText(),
    ).catch(() => {});
    throw error;
  } finally {
    await writeFile(
      'docs/v2/evidence/zhiban-upgrade-120-journey-network-local.json',
      JSON.stringify({ evidenceOrigin: 'LOCAL', githubActions: false, networkTrace }, null, 2) +
        '\n',
    );
    await tc.close();
    await sc.close();
  }
}
