/** LOCAL disposable PG16 + actual native browser host. No trusted Runtime activation. */
/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP wire assertions deliberately inspect upstream JSON and malformed boundary fixtures. */
import { request as httpsRequest } from 'node:https';
import { trustedDevelopmentCa } from './config';
import { lecturePng } from './verify-trial-content';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import { writeFile, readFile } from 'node:fs/promises';
import { authoringEvidenceDirectory } from './evidence-directory';
import { join } from 'node:path';
import { localPgMajor } from './pg-version';
import type { prepareTrial } from './prepare-trial';
import { makeDocument, makeSlideScene } from '../../tests/agent-runtime/_stage-fixtures';
type Input = Omit<Parameters<typeof prepareTrial>[0], 'http'> & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  native: Pool;
  http: (
    ...args: Parameters<Parameters<typeof prepareTrial>[0]['http']>
  ) => Promise<{ status: number; json: unknown; bytes: Buffer }>;
};
export async function verifyNativeAuthoring(input: Input) {
  const { actors, http, tenant, trial, browser, origin, record, native } = input;
  const evidence = await authoringEvidenceDirectory(localPgMajor);
  record(`Native authoring artifacts use isolated run directory: ${evidence}`);
  const [teacher, student, outsider, , manager] = actors;
  const base = `/api/zhiban/authoring/${tenant}/offerings/${trial.offeringId}`,
    n = base + '/native/api';
  const ok = async (path: string, payload?: unknown, method?: string) => {
    const r = await http(path, teacher, payload, method);
    assert.ok(
      r.status >= 200 && r.status < 300,
      JSON.stringify({ path, status: r.status, body: r.json }),
    );
    return r.json as any;
  };
  assert.equal((await http(base, student)).status, 403);
  assert.equal((await http(base, manager)).status, 403);
  assert.equal((await http(base)).status, 401);
  await ok(base);
  await input.admin.query('BEGIN');
  try {
    await assert.rejects(
      input.admin.query(
        "UPDATE zhiban_bridge.deployment_registry SET storage_version='0.37.3' WHERE official_sha='c0f296aa36096ec3d1e1e2b94a7a48e20075e0a1'",
      ),
      (error: any) => error.code === '23514',
    );
  } finally {
    await input.admin.query('ROLLBACK');
  }
  record('v1.3.0 provider tuple rejects mixed old/new versions in real PostgreSQL PASS');
  const created = await ok(n + '/stages', { name: '完整原生备课：电路' }),
    stage = created.stage.id;
  const scene = makeSlideScene('full-slide', stage, 0, '完整课件第一页');
  (scene.content as any).canvas.viewportRatio = 9 / 16;
  (scene.content as any).canvas.elements = [
    {
      id: 'text-1',
      type: 'text',
      left: 40,
      top: 40,
      width: 800,
      height: 100,
      rotate: 0,
      defaultFontName: 'Arial',
      defaultColor: '#111827',
      content: '<p>电压、电流与<strong>完整富文本</strong></p>',
    },
  ];
  const upload = async (bytes: Buffer, mime: string) => {
    const form = new FormData();
    form.set('meta', new Blob(['{}'], { type: 'application/json' }), 'meta.json');
    form.set('bytes', new Blob([new Uint8Array(bytes)], { type: mime }), 'asset');
    const encoded = new Request('https://localhost', { method: 'POST', body: form }),
      data = Buffer.from(await encoded.arrayBuffer()),
      ca = await trustedDevelopmentCa();
    return new Promise<string>((resolve, reject) => {
      const req = httpsRequest(
        origin + n + '/persistence/assets',
        {
          ca,
          method: 'POST',
          headers: {
            'Content-Type': encoded.headers.get('content-type')!,
            'Content-Length': String(data.length),
            Origin: origin,
            Cookie: teacher.cookie!,
            'x-zhiban-request': 'identity-v1',
            'x-zhiban-csrf': teacher.csrf!,
          },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => {
            try {
              const v = JSON.parse(Buffer.concat(chunks).toString());
              assert.equal(r.statusCode, 201, JSON.stringify(v));
              resolve(v.id);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
      req.end(data);
    });
  };
  const image = await upload(lecturePng(), 'image/png');
  const wav = Buffer.alloc(1644);
  wav.write('RIFF');
  wav.writeUInt32LE(1636, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(1600, 40);
  const audio = await upload(wav, 'audio/wav');
  (scene.content as any).canvas.elements.push(
    {
      id: 'image-1',
      type: 'image',
      left: 40,
      top: 220,
      width: 200,
      height: 120,
      rotate: 0,
      fixedRatio: true,
      src: image,
    },
    {
      id: 'formula-1',
      type: 'latex',
      left: 300,
      top: 220,
      width: 240,
      height: 100,
      rotate: 0,
      latex: 'I = \\frac{U}{R}',
      color: '#111827',
    },
    {
      id: 'audio-1',
      type: 'audio',
      left: 600,
      top: 220,
      width: 64,
      height: 64,
      rotate: 0,
      src: audio,
      fixedRatio: true,
      color: '#176ddd',
      autoplay: false,
      loop: false,
    },
  );
  scene.actions = [
    { id: 'narration-1', type: 'speech', text: '完整课件的原生旁白', audioId: audio },
  ];
  const quiz = {
    ...makeSlideScene('native-quiz', stage, 1, '课件自测'),
    type: 'quiz',
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q-1',
          type: 'single',
          question: '电流的单位是？',
          options: [
            { value: 'A', label: '安培' },
            { value: 'B', label: '伏特' },
          ],
          answer: 'A',
        },
      ],
    },
  };
  const interactive = {
    ...makeSlideScene('native-interactive', stage, 2, '离线互动'),
    type: 'interactive',
    content: {
      type: 'interactive',
      html: '<!doctype html><html lang="zh-CN"><body><button id="counter">测量次数 0</button><script>let n=0;document.getElementById("counter").addEventListener("click",()=>{document.getElementById("counter").textContent="测量次数 "+(++n)})</script></body></html>',
    },
  };
  const pbl = {
    ...makeSlideScene('native-pbl', stage, 3, 'PBL 项目简报'),
    type: 'pbl',
    content: {
      type: 'pbl',
      projectV2: {
        id: 'pbl-1',
        title: '电路测量项目',
        description: '分工完成测量并解释证据',
        milestones: [],
        roles: [],
        threads: [],
        submissions: [],
        evaluations: [],
        engagementEvents: [],
      },
    },
  };
  const doc = makeDocument(stage, '完整原生备课：电路', [scene, quiz, interactive, pbl] as any);

  await ok(n + '/stages/' + stage, doc, 'PUT');
  const loaded = await ok(n + '/stages/' + stage);
  assert.deepEqual(
    loaded.scenes[0].content.canvas.elements,
    (scene.content as any).canvas.elements,
  );
  const preview = await ok(base + '/snapshot', { type: 'PREVIEW', stageId: stage });
  assert.equal(preview.scenes.length, 4);
  assert.equal(preview.assets.length, 2);
  await ok(
    n + '/stages/' + stage,
    { ...doc, stage: { ...doc.stage, name: '修改后的完整原生备课' } },
    'PUT',
  );
  assert.equal(
    (
      await http(base + '/snapshot', teacher, {
        type: 'ADOPT',
        stageId: stage,
        sourceDigest: preview.sourceDigest,
      })
    ).status,
    409,
  );
  const latest = await ok(base + '/snapshot', { type: 'PREVIEW', stageId: stage });
  const adopted = await ok(base + '/snapshot', {
    type: 'ADOPT',
    stageId: stage,
    sourceDigest: latest.sourceDigest,
  });
  const duplicate = await ok(base + '/snapshot', {
    type: 'ADOPT',
    stageId: stage,
    sourceDigest: latest.sourceDigest,
  });
  assert.equal(duplicate.id, adopted.id);
  const content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const ownDraft = base + `/draft/${adopted.id}/document?revision=1`;
  await ok(ownDraft);
  assert.equal((await http(ownDraft, student)).status, 403);
  assert.equal((await http(ownDraft.replace('revision=1', 'revision=2'), teacher)).status, 409);
  const offeringRow = (
    await input.admin.query(
      'SELECT course_id,term_id,class_id FROM zhiban_academic.offerings WHERE id=$1',
      [trial.offeringId],
    )
  ).rows[0];
  const second = await http(`/api/zhiban/management/${tenant}/commands`, manager, {
    type: 'CREATE_OFFERING',
    code: 'NATIVE_BOUNDARY',
    name: '原生备课隔离教学班',
    courseId: offeringRow.course_id,
    termId: offeringRow.term_id,
    classId: offeringRow.class_id,
    capacity: 20,
  });
  assert.equal(second.status, 200);
  const otherId = (
    await input.admin.query(
      "SELECT id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND code='NATIVE_BOUNDARY'",
      [tenant],
    )
  ).rows[0].id;
  assert.equal(
    (
      await http(`/api/zhiban/management/${tenant}/commands`, manager, {
        type: 'ASSIGN_TEACHER',
        offeringId: otherId,
        membershipId: teacher.member,
        revision: null,
      })
    ).status,
    200,
  );
  const other = base.replace(trial.offeringId, otherId);
  assert.equal((await http(other, teacher)).status, 200);
  assert.equal((await http(other + '/native/api/stages/' + stage, teacher)).status, 404);
  assert.equal((await http(other + '/native/api/stage-meta/' + stage, teacher)).status, 404);
  assert.equal(
    (await http(other + '/native/api/persistence/assets/' + image + '/content', teacher)).status,
    404,
  );
  assert.equal(
    (await http(other + '/snapshot', teacher, { type: 'PREVIEW', stageId: stage })).status >= 400,
    true,
  );

  const resources = (await ok(content)).resources;
  const resource = resources.find((r: any) => r.id === adopted.id);
  assert.ok(resource);
  assert.equal(
    (
      await http(
        base + '/published/' + adopted.id + '?publication=00000000-0000-7000-8000-000000000000',
        student,
      )
    ).status >= 400,
    true,
  );
  await ok(content, {
    type: 'PUBLISH_CONTENT',
    id: adopted.id,
    revision: resource.revision,
  });
  const p = (await http(content + `/resources/${adopted.id}/preview?source=published`, student))
    .json as any;
  const published = base + '/published/' + adopted.id + '?publication=' + p.publicationId;
  const full = await http(published, student);
  assert.equal(full.status, 200);
  assert.equal((full.json as any).manifest.scenes[0].content.canvas.elements[0].type, 'text');
  await ok(
    n + '/stages/' + stage,
    { ...doc, stage: { ...doc.stage, name: '发布后私有改动' } },
    'PUT',
  );
  assert.equal(
    ((await http(published, student)).json as any).manifest.stage.name,
    '修改后的完整原生备课',
  );
  const imageUrl =
    new URL(
      (full.json as any).manifest.scenes[0].content.canvas.elements.find(
        (e: any) => e.type === 'image',
      ).src,
    ).pathname +
    new URL(
      (full.json as any).manifest.scenes[0].content.canvas.elements.find(
        (e: any) => e.type === 'image',
      ).src,
    ).search;
  const audioUrl = Object.values((full.json as any).mediaTable).find(
    (a: any) => a.mimeType === 'audio/wav',
  ) as { src: string };
  assert.equal((await http(imageUrl, student)).status, 200);
  assert.equal(
    (
      await http(
        new URL(audioUrl.src).pathname + new URL(audioUrl.src).search,
        student,
        undefined,
        'GET',
        { Range: 'bytes=0-43' },
      )
    ).status,
    206,
  );
  assert.equal((await http(imageUrl, outsider)).status, 403);
  assert.equal(
    (
      await http(
        imageUrl.replace(
          'publication=' + p.publicationId,
          'publication=00000000-0000-7000-8000-000000000000',
        ),
        student,
      )
    ).status >= 400,
    true,
  );
  assert.equal((await http(published, outsider)).status, 403);
  assert.equal((await http(n + '/stages/' + stage, student)).status, 403);
  assert.ok(
    (
      await http(n + '/stages/' + stage, teacher, undefined, 'GET', {
        'sec-fetch-site': 'cross-site',
      })
    ).status >= 400,
  );
  assert.ok((await http(n + '/model-config', teacher, { foo: 'bar' }, 'PUT')).status >= 400);
  assert.equal((await http('/api/zhiban/runtime/sessions', teacher)).status, 404);
  await assert.rejects(
    native.query('UPDATE zhiban_authoring_snapshots SET digest=$1 WHERE id=$2', [
      '0'.repeat(64),
      adopted.snapshot,
    ]),
    /immutable/,
  );
  record(
    'Native full document source/hash CAS, idempotent adoption, fixed publication, role/CSRF/config/Runtime boundaries and immutable snapshot PASS',
  );
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
  const page = await tc.newPage(),
    sp = await sc.newPage(),
    errors: string[] = [],
    failed: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(r.status() + ' ' + new URL(r.url()).pathname);
  });
  try {
    await page.goto(
      origin +
        `/zhiban/native-workbench?tenant=${tenant}&offering=${trial.offeringId}&course=${stage}`,
    );
    await expect(page.getByRole('strong').filter({ hasText: '原生备课工作台' })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText('发布后私有改动', { exact: true }).first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText('完整富文本', { exact: false }).first()).toBeVisible({
      timeout: 30000,
    });
    await page.getByTestId('workbench-mode-editing').click();
    await expect(page.getByRole('button', { name: '文本框', exact: true })).toBeVisible();
    await page.locator('[data-select-element-id="text-1"]').click();
    const editable = page.locator('[contenteditable="true"]').last();
    await expect(editable).toBeVisible();
    await editable.fill('原生编辑器实际新增文字');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '核对完整课件', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已核对' })).toContainText('2 份资产');
    assert.ok(
      JSON.stringify((await ok(n + '/stages/' + stage)).scenes).includes('原生编辑器实际新增文字'),
    );
    await page.screenshot({
      path: join(evidence, 'native-authoring-workspace.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: '采用为课程草稿', exact: true }).click();
    const reviewLink = page.getByRole('link', { name: '审核并发布草稿 →', exact: true });
    await expect(reviewLink).toBeVisible();
    const review = await tc.newPage();
    await review.goto(origin + (await reviewLink.getAttribute('href'))!);
    await expect(review.getByRole('heading', { name: '完整原生课件审核与发布' })).toBeVisible();
    const draftLink = review.getByRole('link', { name: '预览待发布固定草稿 →' });
    await expect(draftLink).toBeVisible();
    await review.getByRole('button', { name: '发布当前课程草稿', exact: true }).click();
    await expect(review.getByText('当前状态：PUBLISHED', { exact: true })).toBeVisible();
    const publishedLink = review.getByRole('link', { name: '打开固定发布版本 →' });
    await expect(publishedLink).toBeVisible();
    const edited = await sc.newPage();
    await edited.goto(origin + (await publishedLink.getAttribute('href'))!);
    await expect(
      edited.getByText('原生编辑器实际新增文字', { exact: false }).first(),
    ).toBeVisible();
    await edited.close();
    await review.close();
    await sp.goto(
      origin +
        `/zhiban/native-published?tenant=${tenant}&offering=${trial.offeringId}&resource=${adopted.id}&publication=${p.publicationId}`,
    );
    await expect(sp.getByText('完整富文本', { exact: false }).first()).toBeVisible();
    await expect(sp.locator('#openmaic-player img').first()).toBeVisible();
    const next = sp.getByRole('button', { name: '下一页', exact: true });
    await next.click();
    await expect(sp.getByText('电流的单位是？')).toBeVisible();
    await sp.getByLabel('安培', { exact: false }).check();
    await next.click();
    await expect(
      sp.frameLocator('iframe').getByRole('button', { name: '测量次数 0' }),
    ).toBeVisible();
    await sp.frameLocator('iframe').getByRole('button', { name: '测量次数 0' }).click();
    await expect(
      sp.frameLocator('iframe').getByRole('button', { name: '测量次数 1' }),
    ).toBeVisible();
    await next.click();
    await expect(sp.getByText('电路测量项目')).toBeVisible();
    await sp.screenshot({
      path: join(evidence, 'native-authoring-published.png'),
      fullPage: true,
    });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'Native horizontal overflow ' + width,
      );
    }
    await ok(content, {
      type: 'WITHDRAW_CONTENT',
      id: adopted.id,
      revision: (await ok(content)).resources.find((r: any) => r.id === adopted.id).revision,
    });
    assert.ok((await http(published, student)).status >= 400);
    assert.ok((await http(imageUrl, student)).status >= 400);
    await expect(sp.locator('#player-status')).toContainText('不可用', { timeout: 10000 });
    await writeFile(
      join(evidence, 'native-authoring-browser.json'),
      JSON.stringify({ evidenceOrigin: 'LOCAL', githubActions: false, errors, failed }, null, 2) +
        '\n',
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    record(
      'Actual WorkspaceShell/native editor + fixed publication player responsive browser journey PASS',
    );
    const nativeMaterialBytes = Buffer.from(
      '课程资料：欧姆定律 I = U/R；电压12V，电阻6Ω，电流2A。',
    );
    const postBytes = async (
      path: string,
      bytes: Buffer,
      mime: string,
      extra: Record<string, string> = {},
    ) =>
      new Promise<{ status: number; json: any }>((resolve, reject) => {
        trustedDevelopmentCa()
          .then((ca) => {
            const req = httpsRequest(
              origin + path,
              {
                ca,
                method: 'POST',
                headers: {
                  'Content-Type': mime,
                  'Content-Length': String(bytes.length),
                  Origin: origin,
                  Cookie: teacher.cookie!,
                  'x-zhiban-request': 'identity-v1',
                  'x-zhiban-csrf': teacher.csrf!,
                  ...extra,
                },
              },
              (r) => {
                const chunks: Buffer[] = [];
                r.on('data', (c) => chunks.push(c));
                r.on('end', () => {
                  try {
                    resolve({
                      status: r.statusCode!,
                      json: JSON.parse(Buffer.concat(chunks).toString()),
                    });
                  } catch (e) {
                    reject(e);
                  }
                });
              },
            );
            req.on('error', reject);
            req.end(bytes);
          })
          .catch(reject);
      });
    const material = await postBytes(n + '/materials', nativeMaterialBytes, 'text/plain', {
      'x-material-filename': encodeURIComponent('欧姆定律.txt'),
    });
    assert.equal(material.status, 201, JSON.stringify(material.json));
    await expect
      .poll(
        async () =>
          (await ok(n + '/materials/' + material.json.materialId)).material?.extraction?.status,
        { timeout: 30000, intervals: [1000] },
      )
      .toBe('ready');
    const pooled = await postBytes(
      n + '/materials?scope=library',
      nativeMaterialBytes,
      'text/plain',
      { 'x-material-filename': 'pooled.txt' },
    );
    assert.equal(pooled.status, 201, JSON.stringify(pooled.json));
    await expect
      .poll(
        async () =>
          (await ok(n + '/materials/' + pooled.json.materialId)).material?.extraction?.status,
        { timeout: 30000, intervals: [1000] },
      )
      .toBe('done');
    const roots = await native.query(
      'SELECT count(*)::int AS n,count(DISTINCT a.principal)::int AS owners FROM asset_root_refs r JOIN asset_entries a ON a.id=r.asset_id WHERE r.root_id=$1',
      [pooled.json.materialId],
    );
    assert.ok(roots.rows[0].n >= 2);
    assert.equal(roots.rows[0].owners, 1);
    assert.deepEqual(
      (await http(n + '/materials/' + pooled.json.materialId + '/original', teacher)).bytes,
      nativeMaterialBytes,
    );
    assert.equal(
      (await http(other + '/native/api/materials/' + pooled.json.materialId + '/original', teacher))
        .status,
      404,
    );
    record(
      'Real library pool upload → course-authorized owner extraction → rooted original/text → restricted read PASS',
    );
    const materialId = material.json.materialId;
    const folder = (await ok(n + '/materials/folders', { name: 'v1.3.0 知识库' })).folder;
    await ok(n + '/materials/move', { materialIds: [materialId], folderId: folder.id });
    await ok(n + '/materials/' + materialId, { name: '可复用欧姆定律' }, 'PATCH');
    const library = await ok(n + '/materials/library?limits=1&folderId=' + folder.id);
    assert.equal(library.limits.documentMaxBytes, 1048576);
    assert.equal(library.limits.mediaMaxBytes, 1048576);
    assert.ok(JSON.stringify(library).includes(materialId));
    assert.equal(
      (await http(n + '/materials/' + materialId + '/original', teacher)).bytes.toString(),
      nativeMaterialBytes.toString(),
    );
    assert.equal((await http(n + '/materials/library', student)).status, 403);
    assert.equal(
      (await http(other + '/native/api/materials/' + materialId + '/original', teacher)).status,
      404,
    );
    assert.equal(
      (
        await http(
          other + '/native/api/materials/folders/' + folder.id,
          teacher,
          { name: 'foreign' },
          'PATCH',
        )
      ).status,
      404,
    );
    await ok(n + '/materials/folders/' + folder.id, { name: '正式备课资料' }, 'PATCH');
    assert.equal(
      (await http(n + '/materials/folders/' + folder.id, teacher, {}, 'DELETE')).status,
      204,
    );
    assert.equal((await http(n + '/materials/' + materialId + '/original', teacher)).status, 200);
    record(
      'v1.3.0 knowledge library upload/extract/rename/move/folder removal/original; cross-course and student isolation PASS',
    );
    await page.goto(
      origin +
        `/zhiban/native-workbench?tenant=${tenant}&offering=${trial.offeringId}&view=library`,
    );
    await expect(page.getByText('可复用欧姆定律', { exact: true }).first()).toBeVisible();
    await page.getByTestId('kb-material-menu-' + materialId).click();
    const downloaded = page.waitForEvent('download');
    await page.getByTestId('kb-material-menu-' + materialId + '-open').click();
    const file = await downloaded;
    assert.deepEqual(await readFile((await file.path())!), nativeMaterialBytes);
    await page.screenshot({
      path: join(evidence, 'library-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('可复用欧姆定律', { exact: true }).first()).toBeVisible();
    await page.screenshot({
      path: join(evidence, 'library-mobile.png'),
      fullPage: true,
    });
    record('Actual v1.3.0 library page and scoped original download, desktop/mobile PASS');
    if (!process.argv.includes('--upstream130-focus')) {
      const bad = await postBytes(
        n + '/materials',
        Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
        'text/plain',
        { 'x-material-filename': 'blocked.txt' },
      );
      assert.equal(bad.status, 503);
    }
    assert.equal((await http(n + '/usage', teacher)).status, 403);
    record(
      'Trusted scanner admits owner-scoped native material, native extraction ready; deployment usage remains private PASS',
    );
    if (process.argv.includes('--authoring-real-model')) {
      const ai = await ok(n + '/agent/sessions', {
        materialIds: [material.json.materialId],
        prompt:
          '请直接创建名为“原生真实备课验证”的课件，只有一页PPT：解释欧姆定律，并给出12V、6Ω算出2A的例子。不要图片、音视频或联网资料。请用create_stage创建课程，再用patch_stage补入包含标题、正文和公式的slide；不需要提问，不要发布，保持私有备课源。',
      });
      let aiStage: string | null = null,
        confirmed = false;
      await expect
        .poll(
          async () => {
            const meta = await ok(n + '/agent/sessions/' + ai.id);
            if (meta.status === 'failed')
              throw Error('Native Agent failed: ' + String(meta.error ?? '').slice(0, 200));
            const list = await ok(n + '/stages');
            const found = list.stages.find((d: any) => d.name === '原生真实备课验证');
            if (found) {
              const doc = await ok(n + '/stages/' + found.id);
              if (doc.scenes?.length && meta.status === 'succeeded') {
                aiStage = found.id;
                return true;
              }
            }
            if (meta.status === 'succeeded' && !confirmed) {
              confirmed = true;
              await ok(n + '/agent/sessions/' + ai.id + '/messages', {
                text: '确认采用上述方案，请继续完成已经授权的一页课件；无需更多提问，保持私有源草稿，不要发布。',
              });
            }
            return false;
          },
          { timeout: 960000, intervals: [1000, 2000, 3000] },
        )
        .toBe(true);
      assert.ok(aiStage);
      const aiSource = await ok(base + '/snapshot', { type: 'PREVIEW', stageId: aiStage }),
        aiDraft = await ok(base + '/snapshot', {
          type: 'ADOPT',
          stageId: aiStage,
          sourceDigest: aiSource.sourceDigest,
        });
      const aiResource = (await ok(content)).resources.find((r: any) => r.id === aiDraft.id);
      await ok(base + '/review', {
        type: 'PUBLISH_CONTENT',
        id: aiDraft.id,
        revision: aiResource.revision,
      });
      const aiPublication = (
        await http(content + '/resources/' + aiDraft.id + '/preview?source=published', student)
      ).json as any;
      assert.equal(
        (
          await http(
            base + '/published/' + aiDraft.id + '?publication=' + aiPublication.publicationId,
            student,
          )
        ).status,
        200,
      );
      await writeFile(
        join(evidence, 'native-authoring-real-model.json'),
        JSON.stringify(
          {
            evidenceOrigin: 'LOCAL',
            githubActions: false,
            status: 'PASS',
            session: ai.id,
            stage: aiStage,
            sourceDigest: aiSource.sourceDigest,
            resource: aiDraft.id,
            publication: aiPublication.publicationId,
            modelConfigured: true,
          },
          null,
          2,
        ) + '\n',
      );
      record(
        'Real configured model → native Agent tool edit → full document adoption → explicit publication → current student view PASS',
      );
    } else {
      record(
        'Real model invocation excluded from structural authoring checks; independent model evidence retains actual provider status',
      );
    }
    const beforeRevocation = (await ok(content)).resources.find((r: any) => r.id === adopted.id);
    await input.admin.query(
      "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=(extract(epoch FROM clock_timestamp())*1000)::bigint,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
      [tenant, trial.offeringId, teacher.member],
    );
    assert.equal((await http(base, teacher)).status, 403);
    assert.equal((await http(n + '/materials/library', teacher)).status, 403);
    assert.equal(
      (await http(n + '/materials/' + pooled.json.materialId + '/original', teacher)).status,
      403,
    );
    assert.equal((await http(n + '/materials/' + materialId + '/original', teacher)).status, 403);
    assert.equal(
      (await http(base + '/snapshot', teacher, { type: 'PREVIEW', stageId: stage })).status,
      403,
    );
    assert.equal(
      (
        await http(content, teacher, {
          type: 'PUBLISH_CONTENT',
          id: adopted.id,
          revision: beforeRevocation.revision,
        })
      ).status,
      403,
    );
    record('Current assignment revocation blocks workspace, adoption and publication PASS');
  } catch (e) {
    await page.screenshot({
      path: join(evidence, 'native-authoring-failure.png'),
      fullPage: true,
    });
    await writeFile(
      join(evidence, 'native-authoring-browser.json'),
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          errors,
          failed,
          body: (await page.locator('body').innerText()).slice(-3000),
        },
        null,
        2,
      ),
    );
    throw e;
  } finally {
    await tc.close();
    await sc.close();
  }
}
