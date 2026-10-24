/** LOCAL owned PG16 only; no scanner/model request or real account writes. */
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { pngCrc } from '../../lib/zhiban/infrastructure/content/png';
import type { prepareTrial } from './prepare-trial';
function png(width = 2) {
  const chunk = (type: string, data: Buffer) => {
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    b.write(type, 4);
    data.copy(b, 8);
    b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4);
    return b;
  };
  const h = Buffer.alloc(13);
  h.writeUInt32BE(width);
  h.writeUInt32BE(2, 4);
  h[8] = 8;
  h[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', h),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * 2))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export async function verifyAvatar(
  i: Parameters<typeof prepareTrial>[0] & { trial: Awaited<ReturnType<typeof prepareTrial>> },
) {
  const { http, actors, tenant, admin, browser, origin, record } = i;
  const [teacher, student, , foreign, manager] = actors,
    base = `/api/zhiban/profile/${tenant}`;
  const image = png().toString('base64');
  const send = (payload: unknown, key = randomUUID(), actor = student) =>
    http(base + '/me', actor, payload, 'POST', { 'x-zhiban-command': key });
  const get = async () => {
    const r = await http(base + '/me', student);
    assert.equal(r.status, 200);
    return r.json as {
      avatar: { png: string | null; revision: string } | null;
      revision: string | null;
      displayName: string;
    };
  };
  assert.equal((await http(base + '/me')).status, 401);
  assert.equal((await http(base + '/members', student)).status, 403);
  assert.equal((await http(base + '/me', foreign)).status, 403);
  const c = { type: 'SAVE_AVATAR', revision: null, png: image },
    key = randomUUID();
  assert.equal((await send(c, key)).status, 200);
  assert.equal((await send(c, key)).status, 200);
  assert.equal((await send({ ...c, png: null }, key)).status, 409);
  assert.equal((await send(c)).status, 409);
  const first = await get();
  assert.equal(first.avatar?.png, image);
  const listing = await http(base + '/members?q=' + student.member, manager);
  assert.equal(listing.status, 200);
  assert.equal((listing.json as { rows: { avatar: { png: string } }[] }).rows[0].avatar.png, image);
  for (const value of [
    '<svg/>',
    Buffer.from('not an image').toString('base64'),
    png(97).toString('base64'),
    'A'.repeat(16388),
  ])
    assert.equal(
      (await send({ type: 'SAVE_AVATAR', revision: first.avatar!.revision, png: value })).status,
      400,
    );
  assert.equal((await send({ ...c, membershipId: teacher.member })).status, 400);
  assert.equal((await http(base + '/members', manager, c)).status, 400);
  const pair = await Promise.all([
    send({ type: 'SAVE_AVATAR', revision: first.avatar!.revision, png: null }),
    send({ type: 'SAVE_AVATAR', revision: first.avatar!.revision, png: image }),
  ]);
  assert.deepEqual(pair.map((r) => r.status).sort(), [200, 409]);
  const fresh = await get();
  assert.equal(fresh.revision, first.revision);
  await send({ type: 'SAVE_AVATAR', revision: fresh.avatar!.revision, png: image });
  const fixture = '/tmp/zhiban-avatar-' + randomUUID() + '.png';
  await writeFile(fixture, png(), { mode: 0o600 });
  const context = await browser.newContext(),
    page = await context.newPage();
  try {
    await page.goto(origin + '/zhiban');
    await page.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(student.uid);
    await page.getByLabel('密码', { exact: true }).fill(student.password);
    await page.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
    await page.goto(origin + `/zhiban/profile?tenant=${tenant}`);
    await expect(page.getByRole('img', { name: /的头像/ })).toBeVisible();
    await page.getByLabel('显示名', { exact: true }).fill('保留未保存的姓名');
    await page.getByLabel('选择PNG头像', { exact: true }).setInputFiles(fixture);
    await page.getByRole('button', { name: '上传并保存头像', exact: true }).click();
    await expect(page.getByText('保存已确认。', { exact: true })).toBeVisible();
    await expect(page.getByLabel('显示名', { exact: true })).toHaveValue('保留未保存的姓名');
    await page.getByRole('button', { name: '移除本人头像', exact: true }).click();
    await expect(page.getByText('暂无头像', { exact: true })).toBeVisible();
    await page.getByLabel('选择PNG头像', { exact: true }).setInputFiles(fixture);
    await page.getByRole('button', { name: '上传并保存头像', exact: true }).click();
    await expect(page.getByRole('img', { name: /的头像/ })).toBeVisible();
    assert.equal(
      await page
        .getByRole('img', { name: /的头像/ })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
      2,
    );
    await page.screenshot({
      path: 'docs/v2/evidence/zhiban-avatar-self-local.png',
      fullPage: true,
    });
  } finally {
    await context.close();
    await import('node:fs/promises').then((fs) => fs.rm(fixture, { force: true }));
  }
  const directoryContext = await browser.newContext(),
    directoryPage = await directoryContext.newPage();
  try {
    await directoryPage.goto(origin + '/zhiban');
    await directoryPage.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(manager.uid);
    await directoryPage.getByLabel('密码', { exact: true }).fill(manager.password);
    await directoryPage.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(
      directoryPage.getByRole('button', { name: '退出登录', exact: true }),
    ).toBeVisible();
    await directoryPage.goto(origin + `/zhiban/admin/accounts?tenant=${tenant}`);
    await expect(directoryPage.getByRole('img', { name: /的头像/ })).toBeVisible();
    assert.equal(
      await directoryPage
        .getByRole('img', { name: /的头像/ })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
      2,
    );
    await directoryPage.screenshot({
      path: 'docs/v2/evidence/zhiban-avatar-directory-local.png',
      fullPage: true,
    });
  } finally {
    await directoryContext.close();
  }
  const audit = (
    await admin.query(
      'SELECT count(*)::int n FROM zhiban_profile.avatar_commands WHERE tenant_id=$1',
      [tenant],
    )
  ).rows[0].n;
  assert.ok(audit >= 4);
  record(
    'avatar real PG16/Identity: self-only CAS/idempotency, concurrent winner, independent text revision, restricted admin directory; PNG invalid/oversize/dimensions/target injection refused; browser upload/remove/replace preserves unsaved text and renders decoded PNG',
  );
}
