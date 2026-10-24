/** Unified teaching journey, using the actual protected content UI and public provider. */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { pngCrc } from '../../lib/zhiban/infrastructure/content/png';
import type { prepareTrial } from './prepare-trial';
type Shared = Parameters<typeof prepareTrial>[0];
type Resource = { id: string; revision: string; draft: { slides: { id: string }[] } };
type Preview = {
  publicationId: string;
  slides: { id: string; elements: { assetId?: string; text?: string }[] }[];
};
const chunk = (name: string, b: Buffer) => {
  const a = Buffer.alloc(b.length + 12);
  a.writeUInt32BE(b.length);
  a.write(name, 4);
  b.copy(a, 8);
  a.writeUInt32BE(pngCrc(a.subarray(4, -4)), a.length - 4);
  return a;
};
export function lecturePng() {
  const w = 320,
    h = 180,
    hdr = Buffer.alloc(13),
    raw = Buffer.alloc((w * 4 + 1) * h);
  hdr.writeUInt32BE(w);
  hdr.writeUInt32BE(h, 4);
  hdr[8] = 8;
  hdr[9] = 6;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * (w * 4 + 1) + 1 + x * 4;
      const stop = (x - 85) ** 2 + (y - 90) ** 2 < 1600;
      raw[i] = stop ? 220 : 235;
      raw[i + 1] = stop ? 45 : 240;
      raw[i + 2] = stop ? 45 : 245;
      raw[i + 3] = 255;
      if (x > 170 && x < 285 && y > 40 && y < 140) {
        raw[i] = 60;
        raw[i + 1] = 100;
        raw[i + 2] = 140;
      }
    }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', hdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export async function verifyTrialContent(
  input: Shared & { trial: Awaited<ReturnType<typeof prepareTrial>> },
) {
  const { browser, actors, http, tenant, origin, record, trial } = input;
  const [teacher, student, outsider, foreign, manager] = actors;
  const base = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const tc = await browser.newContext(),
    sc = await browser.newContext();
  for (const [context, actor] of [
    [tc, teacher],
    [sc, student],
  ] as const)
    await context.addCookies([
      {
        name: actor.cookie!.split('=')[0],
        value: actor.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
  const tp = await tc.newPage(),
    sp = await sc.newPage(),
    errors: string[] = [];
  for (const p of [tp, sp]) {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
      if (m.type() === 'error' && m.text().includes('Content Security Policy'))
        errors.push(m.text());
    });
  }
  try {
    await tp.goto(trial.urls.workspace);
    await tp.getByRole('link', { name: '进入课程工作区' }).click();
    await tp.getByRole('link', { name: '讲义与图片', exact: true }).click();
    await expect(tp.getByRole('navigation', { name: '课程内导航' })).toBeVisible();
    const csp = JSON.parse(
      await readFile('docs/v2/evidence/m5-png-csp-profile.json', 'utf8'),
    ).policy;
    const contentResponse = await tp.reload();
    assert.ok(contentResponse);
    assert.equal(contentResponse.headers()['content-security-policy'], csp);
    await tp
      .getByRole('textbox', { name: '新内容标题', exact: true })
      .fill('课堂讲义：急停与安全复位');
    await tp.getByRole('button', { name: '新建内容', exact: true }).click();
    await expect(tp.getByRole('heading', { name: '内容草稿', exact: true })).toBeVisible();
    await tp.getByRole('button', { name: '添加文本框', exact: true }).click();
    await tp
      .getByRole('textbox', { name: '正文 1', exact: true })
      .fill('急停与安全复位\n先排除危险、确认现场人员和防护装置，再申请复位送电。');
    await expect(tp.locator('.content-status')).toContainText('未保存');
    let leaveConfirm = 0;
    tp.once('dialog', async (dialog) => {
      assert.equal(dialog.type(), 'confirm');
      leaveConfirm++;
      await dialog.dismiss();
    });
    await tp.getByRole('link', { name: '学生成绩', exact: true }).click();
    await expect(tp.getByRole('textbox', { name: '正文 1', exact: true })).toHaveValue(
      '急停与安全复位\n先排除危险、确认现场人员和防护装置，再申请复位送电。',
    );
    assert.equal(leaveConfirm, 1);
    record(
      'course lecture navigation cancel preserves unsaved text and content CSP remains scoped',
    );
    await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    const listing = await http(base, teacher),
      resource = (listing.json as { resources: Resource[] }).resources[0];
    assert.equal(
      (await http(`${base}/resources/${resource.id}/preview?source=draft`, student)).status,
      403,
    );
    record('unified teacher creates and saves real text draft; student cannot read draft');
    await tp.getByLabel('PNG 文件', { exact: true }).setInputFiles({
      name: 'invalid.png',
      mimeType: 'image/png',
      buffer: Buffer.from('invalid png'),
    });
    await tp.getByRole('button', { name: '上传 PNG', exact: true }).click();
    await expect(tp.getByRole('alert')).toContainText('请检查内容');
    await tp
      .getByLabel('PNG 文件', { exact: true })
      .setInputFiles({ name: 'safety.png', mimeType: 'image/png', buffer: lecturePng() });
    await tp.getByRole('button', { name: '上传 PNG', exact: true }).click();
    await expect(tp.getByRole('alert')).toContainText('PNG 已登记');
    await tp.getByRole('button', { name: '添加 PNG 到本页', exact: true }).click();
    await tp.getByRole('spinbutton', { name: 'top 2', exact: true }).fill('180');
    await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    await tp.getByRole('button', { name: '发布保存版本', exact: true }).click();
    await expect(tp.getByRole('button', { name: '撤回发布', exact: true })).toBeVisible();
    record(
      'unified UI rejects malformed PNG, registers valid PNG, saves text/image and publishes via guarded Content/Bridge',
    );
    await sp.goto(trial.urls.workspace);
    await sp.getByRole('link', { name: '进入课程工作区' }).click();
    await sp.getByRole('link', { name: '课程资源', exact: true }).click();
    await expect(sp.getByRole('navigation', { name: '课程内导航' })).toBeVisible();
    await sp.getByRole('button', { name: '查看已发布', exact: true }).click();
    await expect(
      sp.getByText('先排除危险、确认现场人员和防护装置，再申请复位送电。', { exact: false }),
    ).toBeVisible();
    const image = sp.getByRole('img', { name: '课件 PNG', exact: true });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((n: HTMLImageElement) => n.complete && n.naturalWidth === 320))
      .toBe(true);
    assert.equal(await sp.getByRole('button', { name: '上传 PNG', exact: true }).count(), 0);
    assert.equal(await sp.getByRole('button', { name: '保存草稿', exact: true }).count(), 0);
    await sp.screenshot({
      path: 'docs/v2/evidence/zhiban-trial-content-student-local.png',
      fullPage: true,
    });
    await tp.screenshot({
      path: 'docs/v2/evidence/zhiban-trial-content-teacher-local.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    const preview = (
      await http(`${base}/resources/${resource.id}/preview?source=published`, student)
    ).json as Preview;
    const slide = preview.slides[0],
      asset = slide.elements.find((e) => e.assetId)!;
    const imageUrl = `${base}/resources/${resource.id}/assets/${asset.assetId}?source=published&version=${preview.publicationId}&slide=${slide.id}`;
    const read = (await http(imageUrl, student)) as unknown as {
      status: number;
      bytes: Buffer;
      headers: Record<string, string>;
    };
    assert.equal(read.status, 200);
    assert.deepEqual(read.bytes, lecturePng());
    assert.equal(read.headers['cache-control'], 'private, no-store');
    assert.equal((await http(imageUrl, student, undefined, 'HEAD')).status, 200);
    assert.equal(
      (await http(imageUrl, student, undefined, 'GET', { Range: 'bytes=0-7' })).status,
      206,
    );
    record(
      'same-origin student text/decoded PNG read-only UI; private gateway, HEAD, Range and CSP verified',
    );
    for (const actor of [outsider, foreign, manager, actors[6]])
      assert.equal((await http(imageUrl, actor)).status, 403);
    assert.equal((await http(imageUrl)).status, 401);
    const adminList = await http(base, manager);
    assert.equal(adminList.status, 200);
    assert.deepEqual((adminList.json as { resources: unknown[] }).resources, []);
    assert.equal((adminList.json as { canEdit: boolean }).canEdit, false);
    for (const actor of [student, manager])
      assert.equal(
        (await http(base, actor, { type: 'CREATE_CONTENT', title: 'denied' })).status,
        403,
      );
    assert.equal((await http(`${base}/resources/${resource.id}/assets`, student)).status, 403);
    for (const route of ['/api/zhiban/runtime/', '/api/zhiban/control/', '/api/assets/anything'])
      assert.equal((await http(route, teacher)).status, 404);
    record(
      'student write/catalog, admin, unenrolled, foreign and anonymous resource access denied; Native/Runtime/control not exposed',
    );
    await tp
      .getByRole('textbox', { name: '正文 1', exact: true })
      .fill('急停与安全复位\n更新版：危险未排除、防护罩未关闭时不得恢复运行。');
    await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    await tp.getByRole('button', { name: '发布保存版本', exact: true }).click();
    await expect(tp.getByRole('button', { name: '撤回发布', exact: true })).toBeEnabled();
    await expect.poll(async () => (await http(imageUrl, student)).status).toBe(403);
    await tp.getByRole('button', { name: '撤回发布', exact: true }).click();
    await expect(tp.getByRole('button', { name: '撤回发布', exact: true })).toHaveCount(0);
    await expect
      .poll(async () =>
        [403, 409].includes(
          (await http(`${base}/resources/${resource.id}/preview?source=published`, student)).status,
        ),
      )
      .toBe(true);
    await tp.getByRole('button', { name: '发布保存版本', exact: true }).click();
    await expect(tp.getByRole('button', { name: '撤回发布', exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await http(`${base}/resources/${resource.id}/preview?source=published`, student)).status,
      )
      .toBe(200);
    await sp.getByRole('button', { name: '刷新列表', exact: true }).click();
    await sp.getByRole('button', { name: '查看已发布', exact: true }).click();
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((n: HTMLImageElement) => n.complete && n.naturalWidth === 320))
      .toBe(true);
    await sp.screenshot({
      path: 'docs/v2/evidence/zhiban-trial-content-student-local.png',
      fullPage: true,
    });
    record(
      'new publication rejects old image URL; withdrawal denies student preview; explicit republish restores current lecture',
    );
  } finally {
    await tc.close();
    await sc.close();
  }
}
