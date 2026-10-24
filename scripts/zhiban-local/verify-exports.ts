/** LOCAL real HTTPS reads + native editable PPTX + offline file:// player. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import JSZip from 'jszip';
import type { prepareTrial } from './prepare-trial';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
type Unit = { id: string; title: string; target: string; kind: string };
export async function verifyExports({
  browser,
  actors,
  http,
  tenant,
  origin,
  trial,
  record,
}: Input) {
  const [teacher, student, , foreign, manager] = actors;
  const obase = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/outline`;
  const o = await http(obase, student);
  assert.equal(o.status, 200);
  const chapters = (o.json as { chapters: { units: Unit[] }[] }).chapters;
  const units = chapters.flatMap((c) => c.units);
  const lecture = units.find((u) => u.kind === 'LECTURE'),
    material = units.find((u) => u.kind === 'MATERIAL');
  assert.ok(lecture && material);
  const dir = 'docs/v2/evidence/course-export';
  await mkdir(dir, { recursive: true });
  const artifacts: Record<string, string> = {};
  const errors: string[] = [];
  for (const [role, actor] of [
    ['teacher', teacher],
    ['student', student],
  ] as const) {
    const context = await browser.newContext();
    try {
      await context.addCookies([
        {
          name: actor.cookie!.split('=')[0],
          value: actor.cookie!.split('=').slice(1).join('='),
          url: origin,
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      for (const unit of [lecture, material]) {
        await p.goto(
          `${origin}/zhiban/${role}/courses/${trial.courseId}/learning-center/${unit.id}?space=${tenant}&offering=${trial.offeringId}`,
        );
        await expect(p.getByRole('region', { name: '导出已发布单元' })).toBeVisible();
        for (const format of ['pptx', 'html'] as const) {
          const pending = p.waitForEvent('download');
          await p
            .getByRole('button', {
              name: format === 'pptx' ? '导出 PPTX' : '导出离线 HTML',
              exact: true,
            })
            .click();
          const download = await pending;
          await expect(p.getByRole('region', { name: '导出已发布单元' })).toContainText(
            '已生成发布版本文件',
          );
          const file = resolve(dir, `${role}-${unit.kind.toLowerCase()}.${format}`);
          await download.saveAs(file);
          const bytes = await readFile(file);
          artifacts[file] = createHash('sha256').update(bytes).digest('hex');
          if (format === 'pptx') {
            const zip = await JSZip.loadAsync(bytes);
            const slides = Object.values(zip.files).filter((f) =>
              /^ppt\/slides\/slide\d+\.xml$/.test(f.name),
            );
            assert.ok(slides.length);
            const xml = (await Promise.all(slides.map((f) => f.async('string')))).join('');
            assert.match(xml, /<a:t>/);
            if (unit.kind === 'LECTURE')
              assert.ok(Object.keys(zip.files).some((n) => n.startsWith('ppt/media/')));
            for (const rel of Object.values(zip.files).filter((f) => f.name.endsWith('.rels')))
              assert.ok(!(await rel.async('string')).includes('TargetMode="External"'));
          } else {
            const html = bytes.toString();
            assert.ok(html.includes("connect-src 'none'"));
            assert.ok(!html.includes(tenant));
            assert.ok(!html.includes(trial.offeringId));
            assert.ok(!html.includes('__Host-zhiban_session'));
            // The player runtime mentions the optional key; only the embedded
            // config must omit the owner link. Inspect data, not minified code.
            const config = html.match(
              /<script[^>]*id="openmaic-player-config"[^>]*>([\s\S]*?)<\/script>/,
            );
            assert.ok(config);
            assert.equal(JSON.parse(config[1]).classroomUrl, undefined);
            const offline = await browser.newContext({ offline: true });
            try {
              const q = await offline.newPage();
              const requests: string[] = [];
              q.on('request', (r) => {
                if (/^https?:/.test(r.url())) requests.push(r.url());
              });
              q.on('pageerror', (e) => errors.push(e.message));
              await q.goto('file://' + file);
              await expect(q.locator('#openmaic-player')).toContainText(unit.title);
              await expect(q.locator('#openmaic-player [contenteditable]')).toHaveCount(0);
              if (unit.kind === 'LECTURE')
                await expect(q.locator('#openmaic-player img').first()).toBeVisible();
              else await expect(q.locator('#openmaic-player')).toContainText('增加仪表自检');
              assert.deepEqual(requests, []);
              await q.screenshot({
                path: resolve(dir, `${role}-${unit.kind.toLowerCase()}-offline.png`),
                fullPage: true,
              });
            } finally {
              await offline.close();
            }
          }
        }
      }
      await p.screenshot({ path: resolve(dir, `${role}-entry.png`), fullPage: true });
      const activity = units.find((u) => u.kind === 'ACTIVITY');
      assert.ok(activity);
      await p.goto(
        `${origin}/zhiban/${role}/courses/${trial.courseId}/learning-center/${activity.id}?space=${tenant}&offering=${trial.offeringId}`,
      );
      await expect(p.getByRole('heading', { name: '课程学习中心', exact: true })).toBeVisible();
      await expect(p.getByRole('region', { name: '导出已发布单元' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
  const mbase = `/api/zhiban/materials/${tenant}/offerings/${trial.offeringId}/${material.target}`;
  for (const actor of [foreign, manager, actors[6]])
    assert.ok([403, 404].includes((await http(mbase, actor)).status));
  assert.equal((await http(mbase)).status, 401);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(dir, 'journey.json'),
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        origin,
        checks: [
          'Teacher/student current published lecture and resource: 8 real downloads',
          'Editable PPTX text and embedded PNG; no external relationships',
          'Offline file:// native player with browser offline, rendered text/PNG and zero network requests',
          'No tenant/account/session/owner link in offline snapshot',
          'Activity exports absent; unauthorized/admin-proxy/withdrawn-member source reads denied',
        ],
        artifacts,
        at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'EXPORT published-content journey: teacher/student 8 real PPTX/HTML downloads; editable text and embedded PNG; file:// offline native player with no network; activities/credentials excluded; source authorization preserved',
  );
}
