/** LOCAL real materials/scanner/asset adoption; external services are NOT configured or simulated. */
/* eslint-disable @typescript-eslint/no-explicit-any -- original native wire views */
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { v7 } from 'uuid';
import { trustedDevelopmentCa } from './config';
import { lecturePng } from './verify-trial-content';
import type { verifyClassroomAi } from './verify-classroom-ai';
export async function verifyMultimodal(input: Parameters<typeof verifyClassroomAi>[0]) {
  const { actors, http, tenant, origin, trial, browser, admin, record } = input,
    [teacher, student, outsider, , manager] = actors;
  const base = `/api/zhiban/authoring/${tenant}/offerings/${trial.offeringId}`,
    content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const ca = await trustedDevelopmentCa();
  const wire = (
    path: string,
    bytes: Buffer,
    mime: string,
    actor = teacher,
    extra: Record<string, string> = {},
  ) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const r = request(
        origin + path,
        {
          ca,
          method: 'POST',
          headers: {
            'x-zhiban-request': 'identity-v1',
            Cookie: actor.cookie!,
            Origin: origin,
            'x-zhiban-csrf': actor.csrf!,
            'content-type': mime,
            'content-length': bytes.length,
            ...extra,
          },
        },
        (s) => {
          const parts: Buffer[] = [];
          s.on('data', (p) => parts.push(p));
          s.on('end', () =>
            resolve({ status: s.statusCode!, json: JSON.parse(Buffer.concat(parts).toString()) }),
          );
        },
      );
      r.on('error', reject);
      r.setTimeout(120000, () => r.destroy(Error('LOCAL media timeout')));
      r.end(bytes);
    });
  const ok = async (path: string, body?: unknown, method?: string, actor = teacher) => {
    const r = await http(path, actor, body, method);
    assert.ok(
      r.status >= 200 && r.status < 300,
      JSON.stringify({ path, status: r.status, json: r.json }),
    );
    return r.json as any;
  };
  const counts = async () =>
      (
        await admin.query(
          'SELECT count(*)::int n FROM zhiban_learning.attempts WHERE tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
    before = await counts();
  const status = await ok(base + '/media/status');
  assert.equal(status.scanner, true);
  for (const k of ['image', 'video', 'tts', 'asr'])
    assert.equal(status.kinds[k].available, false, 'user has not configured external services');
  assert.ok(!JSON.stringify(status).match(/apiKey|baseUrl|accessKey|secret/));
  for (const a of [student, outsider, manager])
    assert.equal((await http(base + '/media/status', a)).status, 403);
  for (const k of ['image', 'video', 'tts'])
    assert.equal(
      (
        await http(
          base + '/native/api/generate/' + k,
          teacher,
          k === 'tts' ? { text: '课件', audioId: 'audio' } : { prompt: '课件' },
        )
      ).status,
      503,
    );
  assert.equal(
    (await wire(base + '/native/api/transcription', Buffer.from('not audio'), 'audio/wav')).status,
    503,
  );
  assert.equal(
    (
      await wire(
        base + '/native/api/materials',
        Buffer.from('PK UNCONFIGURED OFFICE'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        teacher,
        { 'x-material-filename': 'lesson.docx' },
      )
    ).status,
    503,
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addCookies([
    {
      name: teacher.cookie!.split('=')[0],
      value: teacher.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + `/zhiban/native-services?tenant=${tenant}&offering=${trial.offeringId}`);
  await expect(page.getByRole('heading', { name: '当前可用服务' })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled();
  const materialText =
    '原生资料：欧姆定律 I = U / R\n<script>globalThis.MULTIMODAL_EXECUTED=true</script>';
  await page.getByLabel('选择资料或音频').setInputFiles({
    name: 'multimodal-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(materialText),
  });
  await page.getByRole('button', { name: '扫描上传资料', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('原件已扫描保存', { timeout: 90000 });
  let material: any;
  for (let i = 0; i < 90; i++) {
    material = (await ok(base + '/native/api/materials')).materials.find(
      (m: any) => m.originalName === 'multimodal-notes.txt',
    );
    if (material?.extraction?.status === 'ready') break;
    assert.notEqual(material?.extraction?.status, 'failed', JSON.stringify(material));
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(material.extraction.status, 'ready');
  await page.getByRole('button', { name: '刷新资料状态' }).click();
  await page.getByRole('button', { name: '查看抽取正文' }).click();
  await expect(page.locator('pre')).toContainText('I = U / R');
  assert.equal(await page.evaluate(() => Boolean((globalThis as any).MULTIMODAL_EXECUTED)), false);
  const extracted = await ok(base + '/media/material-result?id=' + material.materialId);
  assert.ok(extracted.text.includes('I = U / R'));
  assert.equal(
    (await http(base + '/media/material-result?id=' + material.materialId, student)).status,
    403,
  );
  record(
    'Real trusted scan -> native TXT extraction -> course-owned material preview, safe text rendering and no external provider calls PASS',
  );
  const png = lecturePng();
  await page
    .getByLabel('选择资料或音频')
    .setInputFiles({ name: 'local-teaching.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: '导入已有图片／音视频素材' }).click();
  await expect(page.getByRole('status')).toContainText('本地素材已扫描保存', { timeout: 90000 });
  await expect(page.getByAltText('本次教学素材')).toBeVisible();
  await expect
    .poll(() =>
      page.getByAltText('本次教学素材').evaluate((e) => (e as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByLabel('教学素材描述／朗读文本').fill('本地教学图片：审核发布');
  await page.getByRole('button', { name: '创建新课件编辑副本' }).click();
  await expect(page.getByRole('link', { name: '打开课件 → 核对／采用／发布' })).toBeVisible();
  const href = await page
      .getByRole('link', { name: '打开课件 → 核对／采用／发布' })
      .getAttribute('href'),
    stage = new URL(href!, origin).searchParams.get('course')!;
  const doc = await ok(base + '/native/api/persistence/documents/' + stage),
    asset = doc.scenes[0].content.canvas.elements[0].src;
  const meta = doc.outline.mediaSource;
  assert.equal(meta.sha256, createHash('sha256').update(png).digest('hex'));
  assert.equal(doc.stage.name, '本地教学图片：审核发布');
  const key = v7();
  const a = await wire(
    base + '/media/adopt',
    Buffer.from(JSON.stringify({ assetId: asset, title: '重放查证' })),
    'application/json',
    teacher,
    { 'x-zhiban-command': key },
  );
  assert.equal(a.status, 200);
  const b = await wire(
    base + '/media/adopt',
    Buffer.from(JSON.stringify({ assetId: asset, title: '重放查证' })),
    'application/json',
    teacher,
    { 'x-zhiban-command': key },
  );
  assert.equal(b.json.stageId, a.json.stageId);
  assert.equal(b.json.alreadyExists, true);
  assert.equal(
    (
      await wire(
        base + '/media/adopt',
        Buffer.from(JSON.stringify({ assetId: asset, title: '变化' })),
        'application/json',
        teacher,
        { 'x-zhiban-command': key },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await wire(
        base + '/media/adopt',
        Buffer.from(JSON.stringify({ assetId: asset, title: 'CSRF' })),
        'application/json',
        teacher,
        { 'x-zhiban-command': v7(), 'x-zhiban-csrf': 'invalid' },
      )
    ).status,
    403,
  );
  const preview = await ok(base + '/snapshot', { type: 'PREVIEW', stageId: stage });
  assert.ok(preview.assets.some((a: any) => a.digest === meta.sha256));
  const courseDraft = await ok(base + '/snapshot', {
    type: 'ADOPT',
    stageId: stage,
    sourceDigest: preview.sourceDigest,
  });
  assert.ok(
    (await http(content + `/resources/${courseDraft.id}/preview?source=published`, student))
      .status >= 400,
  );
  const row = (await ok(content)).resources.find((r: any) => r.id === courseDraft.id);
  await ok(content, { type: 'PUBLISH_CONTENT', id: row.id, revision: row.revision });
  await ok(
    content + `/resources/${row.id}/preview?source=published`,
    undefined,
    undefined,
    student,
  );
  await page.screenshot({ path: 'docs/v2/evidence/zhiban-multimodal-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'docs/v2/evidence/zhiban-multimodal-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
  record(
    'LOCAL_UPLOAD (not AI generation): real image scan -> new native editing copy -> fixed adoption/publication -> student read, ACK replay/CAS/CSRF and responsive UI PASS',
  );
  assert.equal(
    (await wire(base + '/media/upload', Buffer.from('<html>not media'), 'image/png')).status,
    415,
  );
  const eicar = Buffer.from(
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  );
  const infected = await wire(base + '/native/api/materials', eicar, 'text/plain', teacher, {
    'x-material-filename': 'eicar.txt',
  });
  assert.equal(infected.status, 503);
  assert.equal(infected.json.error.code, 'FILE_NOT_CLEARED');
  const assignment = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [tenant, trial.offeringId, teacher.member],
    )
  ).rows[0];
  await ok(
    `/api/zhiban/management/${tenant}/commands`,
    { type: 'END_TEACHER', id: assignment.id, revision: assignment.revision },
    'POST',
    manager,
  );
  assert.equal((await http(base + '/media/status', teacher)).status, 403);
  assert.equal((await wire(base + '/media/upload', png, 'image/png')).status, 403);
  assert.equal(await counts(), before);
  await writeFile(
    'docs/v2/evidence/zhiban-multimodal-services-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS_LOCAL_AVAILABLE_SCOPE',
        checkedAt: new Date().toISOString(),
        externalServicesVerified: false,
        externalCalls: 0,
        services: status.kinds,
        materialId: material.materialId,
        localUploadStageId: stage,
        publishedResource: row.id,
        sha256: meta.sha256,
        formalFactsChanged: false,
        remaining: [
          'Office/OCR/media external extraction',
          'Image/video generation',
          'TTS/ASR actual service calls',
        ],
        source: 'LOCAL_UPLOAD_NOT_GENERATED',
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'Unavailable services reject before dispatch; ended teacher blocked; formal learning facts unchanged PASS. External success explicitly NOT claimed',
  );
}
