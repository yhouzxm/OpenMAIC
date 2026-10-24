/** LOCAL affected product journey. Real text/PNG publication; no generation fixture or model calls. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { IncomingHttpHeaders } from 'node:http';
import type { prepareTrial } from './prepare-trial';
import { lecturePng } from './verify-trial-content';
import { PUBLISHED_PLAYER_CSP } from '../../lib/zhiban/infrastructure/content/player';
type Shared = Parameters<typeof prepareTrial>[0];
type Input = Shared & { trial: Awaited<ReturnType<typeof prepareTrial>> };
type Resource = { id: string; revision: string };
export async function verifyNativePlayer(input: Input) {
  const { actors, http, tenant, trial, browser, origin, admin, record } = input;
  const [teacher, student, outsider, , manager] = actors;
  const base = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const send = async (cmd: unknown) => {
    const r = await http(base, teacher, cmd);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Resource;
  };
  const list = async () => {
    const r = await http(base, teacher);
    assert.equal(r.status, 200);
    return (r.json as { resources: Resource[] }).resources;
  };
  const created = await send({ type: 'CREATE_CONTENT', title: '原生 PPT 定向讲义' });
  const slides = [1, 2].map((n) => ({
    id: v7(),
    elements: [
      { id: v7(), text: `原生讲义第 ${n} 页：固定发布版本`, x: 20, y: 20, width: 900, height: 160 },
    ],
  }));
  await send({
    type: 'SAVE_CONTENT',
    id: created.id,
    revision: '1',
    title: '原生 PPT 定向讲义',
    slides,
  });
  const resourceBase = base + `/resources/${created.id}`;
  const tc = await browser.newContext(),
    sc = await browser.newContext();
  for (const [ctx, a] of [
    [tc, teacher],
    [sc, student],
  ] as const)
    await ctx.addCookies([
      {
        name: a.cookie!.split('=')[0],
        value: a.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
  const tp = await tc.newPage(),
    sp = await sc.newPage(),
    errors: string[] = [],
    writes: string[] = [],
    external: string[] = [];
  const course = (
    await admin.query(
      'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
      [tenant, trial.offeringId],
    )
  ).rows[0].course_id;
  const teacherUrl = `${origin}/zhiban/teacher/courses/${course}/resources?space=${tenant}&offering=${trial.offeringId}#resource-${created.id}-draft`;
  const studentUrl = `${origin}/zhiban/student/courses/${course}/resources?space=${tenant}&offering=${trial.offeringId}#resource-${created.id}`;
  try {
    await tp.goto(teacherUrl);
    await expect(tp.getByRole('heading', { name: '内容草稿', exact: true })).toBeVisible();
    await tp
      .getByLabel('PNG 文件', { exact: true })
      .setInputFiles({ name: 'slide.png', mimeType: 'image/png', buffer: lecturePng() });
    await tp.getByRole('button', { name: '上传 PNG', exact: true }).click();
    await expect(tp.getByRole('alert')).toContainText('PNG 已登记');
    await tp.getByRole('button', { name: '添加 PNG 到本页', exact: true }).click();
    await tp.getByRole('spinbutton', { name: 'top 2', exact: true }).fill('200');
    await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    await tp.getByRole('button', { name: '发布保存版本', exact: true }).click();
    await expect(tp.getByRole('button', { name: '撤回发布', exact: true })).toBeVisible();
    const preview = (await http(resourceBase + '/preview?source=published', student)).json as {
      publicationId: string;
      publicationNo: number;
    };
    assert.equal(preview.publicationNo, 1);
    const path = resourceBase + '/player?publication=' + preview.publicationId;
    const docResponse = (await http(path, student)) as {
      status: number;
      json: unknown;
      bytes: Buffer;
      headers: IncomingHttpHeaders;
    };
    assert.equal(docResponse.status, 200);
    assert.equal(docResponse.headers['content-security-policy'], PUBLISHED_PLAYER_CSP);
    assert.match(docResponse.headers['cache-control']!, /no-store/);
    assert.ok(docResponse.bytes.toString().includes('openmaic-classroom'));
    for (const a of [outsider, manager]) assert.equal((await http(path, a)).status, 403);
    assert.equal((await http(path)).status, 401);
    assert.equal((await http(resourceBase + '/player', student)).status, 400);
    assert.equal((await http(path + '&publication=' + preview.publicationId, student)).status, 400);
    assert.equal((await http(resourceBase + '/player?publication=' + v7(), student)).status, 409);
    assert.equal(
      (await http(path, student, undefined, 'GET', { 'sec-fetch-site': 'cross-site' })).status,
      403,
    );
    assert.equal((await http(path, teacher, {}, 'POST')).status, 405);
    record(
      'native PPT: exact publication required; ordinary course authorization, no-store, isolated document CSP and malformed/cross-site reads checked',
    );
    for (const p of [tp, sp]) p.on('pageerror', (e) => errors.push(e.message));
    await tp.getByRole('button', { name: '查看已发布', exact: true }).click();
    await tp.getByRole('link', { name: '使用 OpenMAIC 原生 PPT 播放器', exact: true }).click();
    await expect(tp.getByTestId('counter')).toHaveText('1 / 2');
    await expect(tp.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
    await tp.getByTestId('next').click();
    await expect(tp.getByTestId('counter')).toHaveText('2 / 2');
    await tp.getByRole('button', { name: '返回课程页面', exact: true }).click();
    await expect(tp.getByRole('heading', { name: '内容草稿', exact: true })).toBeVisible();
    const outlinePath = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/outline`;
    const unitId = v7();
    let outline = (await http(outlinePath, teacher)).json as { revision: string };
    assert.equal(
      (
        await http(outlinePath, teacher, {
          type: 'SAVE_OUTLINE',
          revision: outline.revision,
          chapters: [
            {
              id: v7(),
              title: '原生播放章',
              units: [{ id: unitId, title: '原生 PPT 单元', kind: 'LECTURE', target: created.id }],
            },
          ],
        })
      ).status,
      200,
    );
    outline = (await http(outlinePath, teacher)).json as { revision: string };
    assert.equal(
      (await http(outlinePath, teacher, { type: 'PUBLISH_OUTLINE', revision: outline.revision }))
        .status,
      200,
    );
    await sp.goto(
      `${origin}/zhiban/student/courses/${course}/learning-center/${unitId}?space=${tenant}&offering=${trial.offeringId}`,
    );
    await expect(
      sp.getByRole('link', { name: '使用 OpenMAIC 原生 PPT 播放器', exact: true }),
    ).toHaveAttribute('href', path);
    await sp.goto(studentUrl);
    await expect(
      sp.getByRole('link', { name: '使用 OpenMAIC 原生 PPT 播放器', exact: true }),
    ).toBeVisible();
    sp.on('request', (r) => {
      if (r.method() !== 'GET') writes.push(r.url());
      if (new URL(r.url()).origin !== origin) external.push(r.url());
    });
    sp.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await sp.getByRole('link', { name: '使用 OpenMAIC 原生 PPT 播放器', exact: true }).click();
    await expect(sp.getByTestId('counter')).toHaveText('1 / 2');
    await expect(sp.locator('img')).toHaveCount(1);
    await expect
      .poll(() =>
        sp.locator('img').evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth === 320),
      )
      .toBe(true);
    await sp.getByRole('button', { name: '全屏', exact: true }).click();
    await expect.poll(() => sp.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await sp.getByRole('button', { name: '退出全屏', exact: true }).click();
    await expect.poll(() => sp.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await sp.getByTestId('next').click();
    await expect(sp.getByTestId('counter')).toHaveText('2 / 2');
    await sp.locator('body').press('ArrowLeft');
    await expect(sp.getByTestId('counter')).toHaveText('1 / 2');
    await sp.getByRole('button', { name: '场景', exact: true }).click();
    await sp
      .getByRole('navigation', { name: '场景', exact: true })
      .getByRole('button')
      .nth(1)
      .click();
    await expect(sp.getByTestId('counter')).toHaveText('2 / 2');
    await sp.reload();
    await expect(sp.getByTestId('counter')).toHaveText('2 / 2');
    await sc.setOffline(true);
    await sc.setOffline(false);
    await expect(sp.getByTestId('counter')).toHaveText('2 / 2');
    await sp.setViewportSize({ width: 390, height: 844 });
    assert.ok(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await sp.screenshot({
      path: 'docs/v2/evidence/native-player/student-mobile.png',
      fullPage: true,
    });
    await sp.setViewportSize({ width: 1280, height: 800 });
    await sp.screenshot({ path: 'docs/v2/evidence/native-player/student.png', fullPage: true });
    const enrollment = (
      await admin.query(
        "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=(extract(epoch FROM clock_timestamp())*1000)::bigint,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 RETURNING id",
        [tenant, trial.offeringId, student.member],
      )
    ).rows[0];
    try {
      await expect(sp.getByRole('status')).toContainText('课程资格或发布版本已变化', {
        timeout: 15000,
      });
      await expect(sp.getByTestId('counter')).toHaveCount(0);
    } finally {
      await admin.query(
        "UPDATE zhiban_academic.enrollments SET status='ACTIVE',valid_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, enrollment.id],
      );
    }
    await sp.goto(origin + path + '#scene-2');
    await sp.reload(); // A same-document hash change must not revive a revoked player.
    await expect(sp.getByTestId('counter')).toHaveText('2 / 2');
    let resource = (await list()).find((x) => x.id === created.id)!;
    await send({
      type: 'SAVE_CONTENT',
      id: created.id,
      revision: resource.revision,
      title: '新草稿不可混入旧发布',
      slides,
    });
    assert.equal((await http(path, student)).status, 200);
    resource = (await list()).find((x) => x.id === created.id)!;
    await send({ type: 'PUBLISH_CONTENT', id: created.id, revision: resource.revision });
    await expect(sp.getByRole('status')).toContainText('发布版本已变化', { timeout: 15000 });
    await expect(sp.getByTestId('counter')).toHaveCount(0);
    assert.equal((await http(path, student)).status, 409);
    const p2 = (await http(resourceBase + '/preview?source=published', student)).json as {
      publicationId: string;
    };
    const path2 = resourceBase + '/player?publication=' + p2.publicationId;
    await sp.goto(origin + path2);
    await expect(sp.getByTestId('counter')).toHaveText('1 / 2');
    resource = (await list()).find((x) => x.id === created.id)!;
    await send({ type: 'WITHDRAW_CONTENT', id: created.id, revision: resource.revision });
    await expect(sp.getByRole('status')).toContainText('发布版本已变化', { timeout: 15000 });
    assert.equal((await http(path2, student)).status, 409);
    assert.deepEqual(
      errors.filter((e) => !e.includes('409') && !e.includes('403')),
      [],
    );
    assert.deepEqual(writes, []);
    assert.deepEqual(external, []);
    const attempts = (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2',
        [tenant, created.id],
      )
    ).rows[0].n;
    assert.equal(attempts, 0);
    record(
      'native OpenMAIC App: teacher/student text+PNG, native buttons/keyboard/scene list, reload pin, mobile and context return; revoked Enrollment, replacement and withdrawal unmount playback; no writes, external fetches or completion facts',
    );
    await writeFile(
      'docs/v2/evidence/native-player/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          scope: 'NATIVE_OPENMAIC_APP_FIXED_PUBLICATION_TEXT_PNG_ONLY',
          modelCalls: false,
          nativePlayer: 'lib/standalone-player/App.tsx',
          customPlayer: false,
          completionEvidence: false,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await tc.close();
    await sc.close();
  }
}
