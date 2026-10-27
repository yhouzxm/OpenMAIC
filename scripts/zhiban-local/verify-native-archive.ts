/** LOCAL real scanner + PG16 + native format downloads/restore. No model/remote CI. */
/* eslint-disable @typescript-eslint/no-explicit-any -- bounded archive fixtures and native wire envelopes */
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { expect } from '@playwright/test';
import { v7 } from 'uuid';
import { trustedDevelopmentCa } from './config';
import { lecturePng } from './verify-trial-content';
import { makeDocument, makeSlideScene } from '../../tests/agent-runtime/_stage-fixtures';
import { autonomousProject } from '../../tests/zhiban/classroom-ai/pbl-fixtures';
import type { verifyClassroomAi } from './verify-classroom-ai';
import { readBoundedZip } from '../../lib/zhiban/infrastructure/authoring/archive/zip';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
type Input = Parameters<typeof verifyClassroomAi>[0];
export async function verifyNativeArchive(input: Input) {
  const { actors, http, tenant, trial, browser, origin, admin, record } = input,
    [teacher, student, outsider, , manager] = actors;
  const base = `/api/zhiban/authoring/${tenant}/offerings/${trial.offeringId}`,
    n = base + '/native/api',
    content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const ca = await trustedDevelopmentCa();
  const wire = async (
    path: string,
    bytes?: Buffer,
    actor = teacher,
    extra: Record<string, string> = {},
    contentType = 'application/zip',
  ) =>
    new Promise<{ status: number; bytes: Buffer; json: any }>((resolve, reject) => {
      const r = httpsRequest(
        origin + path,
        {
          ca,
          method: bytes ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            Cookie: actor.cookie!,
            ...(bytes
              ? {
                  Origin: origin,
                  'Content-Type': contentType,
                  'Content-Length': bytes.length,
                  'x-zhiban-csrf': actor.csrf!,
                }
              : {}),
            ...extra,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const data = Buffer.concat(chunks);
            let json;
            try {
              json = JSON.parse(data.toString());
            } catch {}
            resolve({ status: res.statusCode!, bytes: data, json });
          });
        },
      );
      r.on('error', reject);
      r.setTimeout(175000, () => r.destroy(Error('Archive LOCAL timeout')));
      r.end(bytes);
    });
  const ok = async (path: string, payload?: unknown, method?: string, actor = teacher) => {
    const r = await http(path, actor, payload, method);
    assert.ok(
      r.status >= 200 && r.status < 300,
      JSON.stringify({ path, status: r.status, body: r.json }),
    );
    return r.json as any;
  };
  const upload = async (bytes: Buffer, mime: string) => {
    const f = new FormData();
    f.set('meta', new Blob(['{}'], { type: 'application/json' }), 'meta.json');
    f.set('bytes', new Blob([new Uint8Array(bytes)], { type: mime }), 'asset');
    const req = new Request(origin, { method: 'POST', body: f });
    const r = await wire(
      n + '/persistence/assets',
      Buffer.from(await req.arrayBuffer()),
      teacher,
      {},
      req.headers.get('content-type')!,
    );
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.id as string;
  };
  const countBefore = (
    await admin.query(
      'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1',
      [tenant],
    )
  ).rows[0].n;
  const stage = (await ok(n + '/stages', { name: '归档完整保真演示' })).stage.id;
  const imageBytes = lecturePng(),
    image = await upload(imageBytes, 'image/png');
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
  const mediaPage = await browser.newPage();
  const videoBytes = Buffer.from(
    await mediaPage.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 60;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#176ddd';
      ctx.fillRect(0, 0, 80, 60);
      const stream = c.captureStream(12),
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }),
        chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise<Blob>((r) => {
        recorder.onstop = () => r(new Blob(chunks, { type: 'video/webm' }));
      });
      recorder.start();
      const timer = setInterval(() => {
        ctx.fillStyle = '#176ddd';
        ctx.fillRect(0, 0, 80, 60);
        ctx.fillStyle = 'white';
        ctx.fillText('LOCAL', 10, 30);
      }, 30);
      await new Promise((r) => setTimeout(r, 300));
      recorder.stop();
      clearInterval(timer);
      const blob = await done;
      stream.getTracks().forEach((t) => t.stop());
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }),
  );
  await mediaPage.close();
  assert.ok(videoBytes.length > 100);
  const video = await upload(videoBytes, 'video/webm');
  const slide = makeSlideScene('archive-slide', stage, 0, '图文公式与媒体');
  if (slide.content.type === 'slide') {
    slide.content.canvas.viewportRatio = 9 / 16;
    slide.content.canvas.elements = [
      {
        id: 'text',
        type: 'text',
        left: 30,
        top: 30,
        width: 850,
        height: 110,
        rotate: 0,
        defaultFontName: 'Arial',
        defaultColor: '#111827',
        content: '<p>归档测试：欧姆定律 I = U / R</p>',
      },
      {
        id: 'image',
        type: 'image',
        left: 30,
        top: 180,
        width: 200,
        height: 120,
        rotate: 0,
        fixedRatio: true,
        src: image,
      },
      {
        id: 'formula',
        type: 'latex',
        left: 300,
        top: 160,
        width: 240,
        height: 100,
        rotate: 0,
        latex: 'I = \\frac{U}{R}',
        color: '#111827',
      },
      {
        id: 'video',
        type: 'video',
        left: 580,
        top: 160,
        width: 250,
        height: 150,
        rotate: 0,
        src: video,
        mediaRef: video,
        poster: image,
      },
      {
        id: 'audio',
        type: 'audio',
        left: 850,
        top: 160,
        width: 60,
        height: 60,
        rotate: 0,
        src: audio,
      },
    ] as any[];
  }
  slide.actions = [
    {
      id: 'speech',
      type: 'speech',
      text: '归档原生讲稿，保持数学公式与教学设计。',
      audioId: audio,
    },
  ];
  const pbl = autonomousProject();
  pbl.submissions.push({
    id: 'PRIVATE-PBL',
    microtaskId: 'task-1',
    kind: 'text',
    content: 'PRIVATE-LEARNER-MUST-NOT-TRAVEL',
    createdAt: '',
  });
  pbl.threads[0].messages.push({
    id: 'PRIVATE-CHAT',
    roleType: 'user',
    content: 'PRIVATE-CHAT-MUST-NOT-TRAVEL',
    ts: '',
  });
  const scenes = [
    slide,
    {
      ...makeSlideScene('archive-quiz', stage, 1, '原生测验'),
      type: 'quiz',
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'q',
            type: 'single',
            question: '电流单位？',
            options: [
              { value: 'A', label: '安培' },
              { value: 'B', label: '伏特' },
            ],
            answer: ['A'],
            points: 1,
          },
        ],
      },
    },
    {
      ...makeSlideScene('archive-html', stage, 2, '离线互动'),
      type: 'interactive',
      content: {
        type: 'interactive',
        html: '<!doctype html><html><body><button id="archive-counter">0</button><script>document.getElementById("archive-counter").onclick=e=>e.target.textContent=Number(e.target.textContent)+1</script></body></html>',
      },
    },
    {
      ...makeSlideScene('archive-pbl', stage, 3, 'PBL 项目'),
      type: 'pbl',
      content: { type: 'pbl', projectV2: pbl },
    },
  ] as any[];
  const doc = makeDocument(stage, '归档完整保真演示', scenes);
  doc.stage.whiteboard =
    slide.content.type === 'slide' ? [structuredClone(slide.content.canvas)] : [];
  await ok(n + '/persistence/documents/' + stage, doc, 'PUT');
  const preview = await ok(base + '/snapshot', { type: 'PREVIEW', stageId: stage }),
    adopted = await ok(base + '/snapshot', {
      type: 'ADOPT',
      stageId: stage,
      sourceDigest: preview.sourceDigest,
    });
  const resource = (await ok(content)).resources.find((r: any) => r.id === adopted.id);
  await ok(content, { type: 'PUBLISH_CONTENT', id: resource.id, revision: resource.revision });
  const pub = (
    await ok(
      content + `/resources/${resource.id}/preview?source=published`,
      undefined,
      undefined,
      student,
    )
  ).publicationId;
  const source = `resource=${resource.id}&publication=${pub}`,
    exportPath = base + '/archive/export?' + source;
  for (const actor of [student, outsider, manager])
    assert.equal((await wire(exportPath, undefined, actor)).status, 403);
  const exported = await wire(exportPath);
  assert.equal(exported.status, 200, JSON.stringify(exported.json));
  const files = await readBoundedZip(exported.bytes),
    decoded = JSON.parse(files.get('zhiban-document.json')!.toString()),
    meta = JSON.parse(files.get('zhiban-archive.json')!.toString());
  assert.equal(decoded.scenes.length, 4);
  assert.ok(decoded.stage.whiteboard.length);
  assert.ok(!JSON.stringify(decoded).includes('PRIVATE-'));
  assert.equal(meta.assets.length, 3);
  for (const bytes of [imageBytes, wav, videoBytes])
    assert.ok(meta.assets.some((a: any) => a.digest === sha(bytes)));
  const inspect = await wire(base + '/archive/inspect?kind=maic', exported.bytes);
  assert.equal(inspect.status, 200, JSON.stringify(inspect.json));
  assert.equal(inspect.json.scannerAvailable, true);
  const digest = inspect.json.digest,
    key = v7();
  assert.equal(
    (
      await wire(base + '/archive/restore?kind=maic', exported.bytes, teacher, {
        'x-zhiban-command': key,
        'x-zhiban-archive-digest': '0'.repeat(64),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await wire(base + '/archive/restore?kind=maic', exported.bytes, teacher, {
        'x-zhiban-command': key,
        'x-zhiban-archive-digest': digest,
        'x-zhiban-csrf': 'invalid',
      })
    ).status,
    403,
  );
  const restored = await wire(base + '/archive/restore?kind=maic', exported.bytes, teacher, {
    'x-zhiban-command': key,
    'x-zhiban-archive-digest': digest,
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.equal(restored.json.published, false);
  assert.match(restored.json.clearance, /^clamav-archive-sha256:/);
  const copy = await ok(n + '/persistence/documents/' + restored.json.stageId);
  assert.notEqual(copy.stage.id, stage);
  assert.equal(copy.scenes.length, 4);
  assert.equal(copy.outline.restoredFrom.archiveSha256, digest);
  assert.equal(copy.outline.generationComplete, true);
  assert.ok(!JSON.stringify(copy).includes('PRIVATE-'));
  assert.ok(copy.stage.whiteboard.length);
  const again = await wire(base + '/archive/restore?kind=maic', exported.bytes, teacher, {
    'x-zhiban-command': key,
    'x-zhiban-archive-digest': digest,
  });
  assert.equal(again.json.stageId, copy.stage.id);
  assert.equal(again.json.alreadyExists, true);
  const copyPreview = await ok(base + '/snapshot', { type: 'PREVIEW', stageId: copy.stage.id });
  for (const bytes of [imageBytes, wav, videoBytes])
    assert.ok(copyPreview.assets.some((a: any) => a.digest === sha(bytes)));
  const copyAdopt = await ok(base + '/snapshot', {
    type: 'ADOPT',
    stageId: copy.stage.id,
    sourceDigest: copyPreview.sourceDigest,
  });
  assert.ok(
    (await http(content + `/resources/${copyAdopt.id}/preview?source=published`, student)).status >=
      400,
  );
  const copyRow = (await ok(content)).resources.find((r: any) => r.id === copyAdopt.id);
  await ok(content, { type: 'PUBLISH_CONTENT', id: copyRow.id, revision: copyRow.revision });
  await ok(
    content + `/resources/${copyRow.id}/preview?source=published`,
    undefined,
    undefined,
    student,
  );
  record(
    'Native MAIC: real scanner, complete design/media hashes, fresh owner/scene/asset IDs, source provenance, ACK retry, explicit adopt/publish and student access PASS',
  );
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
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
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text().slice(0, 600));
  });
  await page.goto(
    origin +
      '/zhiban/native-archive?tenant=' +
      tenant +
      '&offering=' +
      trial.offeringId +
      '&' +
      source,
  );
  await expect(page.getByRole('button', { name: '读取本次课件' })).toBeVisible();
  await page.getByRole('button', { name: '读取本次课件' }).click();
  await expect(page.getByRole('status')).toContainText('4 个场景', { timeout: 30000 });
  const downloads: Record<string, { sha256: string; size: number; name: string }> = {};
  let pptxBytes: Buffer | undefined, htmlPath: string | undefined;
  for (const label of [
    '原生归档 .maic.zip',
    'PowerPoint',
    'PPTX＋互动资源包',
    '完整离线 HTML',
    'Markdown 讲稿',
    'Word 讲稿',
  ]) {
    console.log('LOCAL native download: ' + label);
    const waiting = page.waitForEvent('download', { timeout: 60000 }).catch(async () => {
      throw Error(
        JSON.stringify({
          label,
          status: await page.getByRole('status').innerText(),
          errors,
          consoleErrors,
        }),
      );
    });
    await page.getByRole('button', { name: label, exact: true }).click();
    const download = await waiting,
      path = await download.path();
    assert.ok(path);
    const bytes = await readFile(path);
    assert.ok(bytes.length > 20, label);
    downloads[label] = {
      sha256: sha(bytes),
      size: bytes.length,
      name: download.suggestedFilename(),
    };
    if (label === 'PowerPoint') {
      pptxBytes = bytes;
      const xml = await JSZip.loadAsync(bytes);
      assert.ok(xml.file('ppt/presentation.xml'));
      const media = await Promise.all(
        Object.keys(xml.files)
          .filter((n) => n.startsWith('ppt/media/') && !xml.files[n].dir)
          .map((n) => xml.file(n)!.async('nodebuffer')),
      );
      for (const original of [imageBytes, wav, videoBytes])
        assert.ok(
          media.some((b) => sha(b) === sha(original)),
          'PPTX must embed exact image/audio/video bytes',
        );
      assert.equal(
        Object.keys(xml.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length,
        4,
      );
    }
    if (label === 'PPTX＋互动资源包') {
      const zip = await JSZip.loadAsync(bytes);
      assert.ok(Object.keys(zip.files).some((n) => n.endsWith('.pptx')));
      assert.ok(Object.keys(zip.files).some((n) => n.endsWith('.html')));
    }
    if (label === 'Markdown 讲稿') assert.ok(bytes.toString().includes('归档原生讲稿'));
    if (label === 'Word 讲稿') assert.ok((await JSZip.loadAsync(bytes)).file('word/document.xml'));
    if (label === '完整离线 HTML') {
      htmlPath = join(tmpdir(), 'zhiban-archive-' + v7() + '.html');
      await writeFile(htmlPath, bytes, { mode: 0o600 });
      assert.ok(bytes.toString().includes('PRIVATE-') === false);
    }
  }
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'docs/v2/evidence/zhiban-native-archive-mobile.png' });
  const offline = await browser.newContext();
  await offline.setOffline(true);
  const offlinePage = await offline.newPage();
  await offlinePage.goto('file://' + htmlPath);
  await expect(offlinePage.getByText('归档测试：欧姆定律 I = U / R', { exact: false })).toBeVisible(
    { timeout: 20000 },
  );
  await offlinePage.screenshot({ path: 'docs/v2/evidence/zhiban-native-archive-offline.png' });
  await offline.close();
  // PPTX is a genuine native export converted by the real isolated native parser, not a synthetic success.
  const pi = await wire(base + '/archive/inspect?kind=pptx', pptxBytes);
  assert.equal(pi.status, 200, JSON.stringify(pi.json));
  const ppt = await wire(base + '/archive/restore?kind=pptx', pptxBytes, teacher, {
    'x-zhiban-command': v7(),
    'x-zhiban-archive-digest': pi.json.digest,
  });
  assert.equal(ppt.status, 200, JSON.stringify(ppt.json));
  const pd = await ok(n + '/persistence/documents/' + ppt.json.stageId);
  assert.equal(pd.scenes.length, 4);
  assert.ok(pd.scenes.every((s: any) => s.type === 'slide'));
  assert.equal(pd.outline.restoredFrom.kind, 'pptx');
  record(
    'Six native downloads + genuine OOXML/ZIP/MD payloads, offline HTML, 390px UI, isolated PPTX conversion PASS; MP4/experimental renderer excluded',
  );
  await context.close();
  // Self-consistent malicious archive reaches the real scanner, not merely CRC rejection.
  const bad = await JSZip.loadAsync(exported.bytes),
    eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  const entry = meta.assets[0];
  bad.file(entry.path, eicar);
  entry.digest = sha(eicar);
  entry.size = eicar.length;
  bad.file('zhiban-archive.json', JSON.stringify(meta));
  const malware = await bad.generateAsync({ type: 'nodebuffer' });
  const mi = await wire(base + '/archive/inspect?kind=maic', malware);
  assert.equal(mi.status, 200, JSON.stringify(mi.json));
  const blocked = await wire(base + '/archive/restore?kind=maic', malware, teacher, {
    'x-zhiban-command': v7(),
    'x-zhiban-archive-digest': mi.json.digest,
  });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.json.error.code, 'ARCHIVE_NOT_CLEARED');
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
  assert.equal((await wire(exportPath)).status, 403);
  assert.equal((await wire(base + '/archive/access?' + source)).status, 403);
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    countBefore,
  );
  record(
    'Student/admin/foreign access, CSRF/digest mismatch, real EICAR denial and ended-teacher export barrier PASS; no formal learning facts',
  );
  await writeFile(
    'docs/v2/evidence/zhiban-native-archive-downloads.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        checkedAt: new Date().toISOString(),
        downloads,
        sourceDigest: preview.sourceDigest,
        archiveSha256: digest,
        restoredStageId: copy.stage.id,
        pptxStageId: pd.stage.id,
        modelCalls: 0,
      },
      null,
      2,
    ) + '\n',
  );
}
