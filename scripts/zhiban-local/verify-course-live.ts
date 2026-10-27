/** Directed real PG16 + browser + renderer journey. No model calls or unrelated teaching suite. */
/* eslint-disable @typescript-eslint/no-explicit-any -- malformed HTTP boundary assertions and native fixture */
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { trustedDevelopmentCa } from './config';
import { makeDocument, makeSlideScene } from '../../tests/agent-runtime/_stage-fixtures';
import type { verifyClassroomAi } from './verify-classroom-ai';
export async function verifyCourseLive(input: Parameters<typeof verifyClassroomAi>[0]) {
  const { actors, http, tenant, trial, browser, origin, native, record } = input,
    [teacher, student, outsider, , manager] = actors;
  const a = `/api/zhiban/authoring/${tenant}/offerings/${trial.offeringId}`,
    c = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const ok = async (path: string, value?: unknown, actor = teacher, method?: string) => {
    const r = await http(path, actor, value, method);
    assert.ok(
      r.status >= 200 && r.status < 300,
      JSON.stringify({ path, status: r.status, json: r.json }),
    );
    return r.json as any;
  };
  const stage = (await ok(a + '/native/api/stages', { name: '整课视频与教师共享：电路基础' })).stage
    .id;
  // Real persisted PCM cue: exercises audio without another TTS/model call.
  const wav = Buffer.alloc(44 + 32000);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(32000, 40);
  for (let i = 0; i < 16000; i++)
    wav.writeInt16LE(Math.round(Math.sin((i / 16000) * 440 * 2 * Math.PI) * 2000), 44 + i * 2);
  const form = new FormData();
  form.set('meta', new Blob(['{}'], { type: 'application/json' }), 'meta.json');
  form.set('bytes', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'cue.wav');
  const req = new Request(origin, { method: 'POST', body: form }),
    upload = Buffer.from(await req.arrayBuffer()),
    ca = await trustedDevelopmentCa();
  const cue = await new Promise<any>((resolve, reject) => {
    const r = httpsRequest(
      origin + a + '/native/api/persistence/assets',
      {
        ca,
        method: 'POST',
        headers: {
          'x-zhiban-request': 'identity-v1',
          Cookie: teacher.cookie!,
          Origin: origin,
          'x-zhiban-csrf': teacher.csrf!,
          'Content-Type': req.headers.get('content-type')!,
          'Content-Length': String(upload.length),
        },
      },
      (res) => {
        const b: Buffer[] = [];
        res.on('data', (c) => b.push(c));
        res.on('end', () => {
          const result = JSON.parse(Buffer.concat(b).toString());
          if (res.statusCode !== 201) return reject(Error('Cue asset upload ' + res.statusCode));
          resolve(result);
        });
      },
    );
    r.on('error', reject);
    r.end(upload);
  });
  const scenes = [0, 1].map((i) => {
    const s = makeSlideScene('live-slide-' + i, stage, i, i ? '计算与回顾' : '电路基础');
    if (s.content.type === 'slide') {
      s.content.canvas.viewportRatio = 9 / 16;
      s.content.canvas.elements = [
        {
          id: 'heading-' + i,
          type: 'text',
          left: 80,
          top: 80,
          width: 800,
          height: 180,
          rotate: 0,
          defaultFontName: 'Arial',
          defaultColor: '#176ddd',
          content: i ? '<p>12 V / 6 Ω = 2 A</p>' : '<p>电路基础 · 教师公开课堂</p>',
        },
      ];
    }
    s.actions = [];
    return s;
  });
  const doc = makeDocument(stage, '整课视频与教师共享：电路基础', scenes);
  scenes[0].actions = [
    { id: 'stored-cue', type: 'speech', text: '课堂演示提示音', audioId: cue.id },
  ];
  await ok(a + '/native/api/stages/' + stage, doc, teacher, 'PUT');
  const preview = await ok(a + '/snapshot', { type: 'PREVIEW', stageId: stage });
  const adopted = await ok(a + '/snapshot', {
    type: 'ADOPT',
    stageId: stage,
    sourceDigest: preview.sourceDigest,
  });
  const row = (await ok(c)).resources.find((r: any) => r.id === adopted.id);
  await ok(c, { type: 'PUBLISH_CONTENT', id: adopted.id, revision: row.revision });
  const publication = (
    await ok(c + `/resources/${adopted.id}/preview?source=published`, undefined, student)
  ).publicationId;
  const b = `/api/zhiban/classroom-ai/${tenant}/offerings/${trial.offeringId}/resources/${adopted.id}/publications/${publication}`,
    source = `resource=${adopted.id}&publication=${publication}`;
  await ok(b + '/policy', { enabled: true, revision: '0' });
  const command = {
    kind: 'START',
    revision: '0',
    controller: randomUUID(),
    state: {
      sceneId: scenes[0].id,
      actionIndex: 0,
      mode: 'paused',
      board: '欧姆定律 I=U/R',
      summary: '先辨识电压与电阻',
    },
  };
  assert.equal((await http(b + '/shared', student, command)).status, 403);
  assert.equal((await http(b + '/shared', manager, command)).status, 403);
  assert.equal((await http(b + '/shared', outsider)).status, 403);
  assert.equal((await http(b + '/shared')).status, 401);
  assert.equal(
    (await http(b + '/shared', teacher, { ...command, privateChat: 'leak' })).status,
    400,
  );
  assert.equal(
    (
      await http(b + '/shared', teacher, {
        ...command,
        state: { ...command.state, answers: { q: 'A' } },
      })
    ).status,
    400,
  );
  assert.equal(
    (await http(b + '/shared', teacher, command, 'POST', { 'x-zhiban-csrf': 'invalid' })).status,
    403,
  );
  const first = await ok(b + '/shared', command);
  assert.equal(first.revision, '1');
  const race = await Promise.all([
    http(b + '/shared', teacher, { ...command, kind: 'UPDATE', revision: '1' }),
    http(b + '/shared', teacher, { ...command, kind: 'UPDATE', revision: '1' }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const current = await ok(b + '/shared');
  assert.equal(
    (
      await http(b + '/shared', teacher, {
        ...command,
        kind: 'UPDATE',
        revision: current.revision,
        controller: randomUUID(),
      })
    ).status,
    409,
  );
  const takeover = { ...command, revision: current.revision, controller: randomUUID() };
  const took = await ok(b + '/shared', takeover);
  assert.equal(
    (await http(b + '/shared', teacher, { ...command, kind: 'UPDATE', revision: took.revision }))
      .status,
    409,
  );
  await native.query(
    "UPDATE zhiban_live_classroom SET updated_at=now()-interval '16 seconds' WHERE publication_id=$1",
    [publication],
  );
  const stale = await ok(b + '/shared', undefined, student);
  assert.equal(stale.active, false);
  assert.equal(stale.state, null);
  await assert.rejects(
    native.query("UPDATE zhiban_live_events SET kind='STOP' WHERE publication_id=$1", [
      publication,
    ]),
    /append only/,
  );
  assert.equal((await http(a + '/video/capability?' + source, student)).status, 403);
  assert.equal((await http(a + '/video/jobs?' + source, outsider)).status, 403);
  record(
    'Real shared-state tenant/teacher/CSRF/private-payload/CAS/controller/TTL/append-only boundaries PASS',
  );
  const contexts = [];
  const pages = [];
  const pageErrors: string[] = [];
  try {
    for (const actor of [teacher, student]) {
      const ctx = await browser.newContext({
        viewport: { width: 1360, height: 1000 },
        acceptDownloads: true,
      });
      contexts.push(ctx);
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
      const p = await ctx.newPage();
      p.on('pageerror', (e) => pageErrors.push(e.message));
      pages.push(p);
      await p.goto(
        origin +
          `/zhiban/native-classroom?tenant=${tenant}&offering=${trial.offeringId}&resource=${adopted.id}&publication=${publication}`,
      );
      await expect(p.getByText('原生 AI 课堂', { exact: false }).first()).toBeVisible();
    }
    const [tp, sp] = pages;
    await expect(tp.getByText('电路基础 · 教师公开课堂', { exact: false }).first()).toBeVisible({
      timeout: 45000,
    });
    await tp.getByText('教师课堂共享 ·', { exact: false }).click();
    await tp.getByLabel('公开板书', { exact: true }).fill('公开板书：12/6=2A');
    await tp.getByLabel('公开课堂小结').fill('本堂课回顾');
    await tp.getByRole('button', { name: '开始课堂共享', exact: true }).click();
    await expect(sp.getByRole('button', { name: '跟随教师', exact: true })).toBeEnabled({
      timeout: 20000,
    });
    await sp.getByRole('button', { name: '跟随教师', exact: true }).click();
    await expect(sp.getByText('公开板书：12/6=2A', { exact: true })).toBeVisible();
    await tp.getByLabel('Next scene', { exact: true }).click();
    await expect(sp.getByText('12 V / 6 Ω = 2 A', { exact: true }).first()).toBeVisible({
      timeout: 20000,
    });
    const out = 'docs/v2/evidence/course-live';
    await mkdir(out, { recursive: true });
    await tp.screenshot({ path: out + '/teacher-sharing.png' });
    await sp.setViewportSize({ width: 390, height: 844 });
    await sp.screenshot({ path: out + '/student-sharing-mobile.png' });
    await sp.reload();
    await expect(sp.getByRole('button', { name: '跟随教师', exact: true })).toBeEnabled({
      timeout: 15000,
    });
    await sp.getByRole('button', { name: '跟随教师', exact: true }).click();
    await expect(sp.getByText('12 V / 6 Ω = 2 A', { exact: true }).first()).toBeVisible({
      timeout: 20000,
    });
    await tp.getByRole('button', { name: '停止课堂共享', exact: true }).click();
    await expect(sp.getByText('公开板书：12/6=2A', { exact: true })).toHaveCount(0, {
      timeout: 15000,
    });
    await tp.goto(
      origin + `/zhiban/native-archive?tenant=${tenant}&offering=${trial.offeringId}&${source}`,
    );
    await expect(tp.getByRole('button', { name: '生成整课 MP4', exact: true })).toBeEnabled({
      timeout: 20000,
    });
    await tp.getByRole('button', { name: '生成整课 MP4', exact: true }).click();
    await tp.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('button')).some(
          (b) => b.textContent === '下载整课 MP4',
        ) || document.body.innerText.includes('当前渲染：失败'),
      {},
      { timeout: 240000 },
    );
    await expect(tp.getByRole('button', { name: '下载整课 MP4', exact: true })).toBeVisible();
    const download = tp.waitForEvent('download');
    await tp.getByRole('button', { name: '下载整课 MP4', exact: true }).click();
    const d = await download;
    const video = out + '/classroom.mp4';
    await d.saveAs(video);
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video],
        { encoding: 'utf8' },
      ),
    );
    assert.ok(probe.streams.some((s: any) => s.codec_type === 'video' && s.codec_name === 'h264'));
    assert.ok(probe.streams.some((s: any) => s.codec_type === 'audio'));
    assert.ok(Number(probe.format.duration) > 0);
    assert.ok(Number(probe.format.size) > 1000);
    const jobs = await ok(a + '/video/jobs?' + source);
    assert.ok(jobs.length);
    assert.equal((await http(a + '/video/jobs/' + jobs[0].id, student)).status, 404);
    await tp.screenshot({ path: out + '/mp4-ready.png' });
    const assignment = (
      await input.admin.query(
        'SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
        [tenant, trial.offeringId, teacher.member],
      )
    ).rows[0];
    await ok(
      `/api/zhiban/management/${tenant}/commands`,
      { type: 'END_TEACHER', id: assignment.id, revision: assignment.revision },
      manager,
    );
    assert.equal((await http(a + '/video/jobs/' + jobs[0].id, teacher)).status, 403);
    assert.equal(
      (
        await http(b + '/shared', teacher, {
          ...command,
          revision: (await ok(b + '/shared', undefined, student)).revision,
        })
      ).status,
      403,
    );
    const ended = (
      await input.admin.query(
        'SELECT revision::text FROM zhiban_academic.assignments WHERE id=$1',
        [assignment.id],
      )
    ).rows[0];
    await ok(
      `/api/zhiban/management/${tenant}/commands`,
      {
        type: 'ASSIGN_TEACHER',
        offeringId: trial.offeringId,
        membershipId: teacher.member,
        revision: ended.revision,
      },
      manager,
    );
    const currentPolicy = await ok(b);
    await ok(b + '/policy', { enabled: false, revision: currentPolicy.revision });
    assert.equal((await http(b + '/shared', student)).status, 403);
    const cmd = (await ok(c)).resources.find((r: any) => r.id === adopted.id);
    await ok(c, { type: 'WITHDRAW_CONTENT', id: adopted.id, revision: cmd.revision });
    assert.ok((await http(a + '/video/jobs/' + jobs[0].id)).status >= 400);
    assert.deepEqual(pageErrors, []);
    await writeFile(
      out + '/local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS_REAL_NATIVE_MP4_AND_SHARED_PUBLIC_STATE',
          tenant,
          offering: trial.offeringId,
          resource: adopted.id,
          publication,
          stage,
          video,
          videoCodec: probe.streams.find((s: any) => s.codec_type === 'video').codec_name,
          audioCodec: probe.streams.find((s: any) => s.codec_type === 'audio').codec_name,
          audioFixture: 'ONE_SECOND_LOCAL_PCM_CUE_NOT_GENERATED_SPEECH',
          duration: Number(probe.format.duration),
          bytes: Number(probe.format.size),
          videoSha256: createHash('sha256')
            .update(await readFile(video))
            .digest('hex'),
          teacherAndStudentBrowser: true,
          studentPrivateStateShared: false,
          formalLearningFactsWritten: false,
          modelCalls: 0,
          sourceDigest: preview.sourceDigest,
          sourceDocumentSha256: createHash('sha256').update(JSON.stringify(doc)).digest('hex'),
          pageErrors,
        },
        null,
        2,
      ),
    );
    record(
      'Native whole-deck browser compilation → real renderer → H264 MP4 download/ffprobe; shared public state and stop; policy/withdrawal access denied PASS',
    );
  } catch (error) {
    for (let i = 0; i < pages.length; i++) {
      await pages[i]
        .screenshot({ path: '/tmp/zhiban-course-live-failure-' + i + '.png' })
        .catch(() => {});
      console.error(
        'COURSE_LIVE_BROWSER',
        i,
        JSON.stringify({
          errors: pageErrors,
          text: (await pages[i].locator('body').innerText()).slice(0, 7000),
        }),
      );
    }
    throw error;
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
}
