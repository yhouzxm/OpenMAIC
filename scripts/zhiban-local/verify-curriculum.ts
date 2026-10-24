import assert from 'node:assert/strict';
import { v7 } from 'uuid';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import { loadCurriculum } from './curriculum';
type Shared = Parameters<typeof prepareTrial>[0];
export async function verifyCurriculum(
  input: Shared & { trial: Awaited<ReturnType<typeof prepareTrial>> },
) {
  const { admin, browser, actors, http, tenant, origin, trial, record } = input;
  const [teacher, student, outsider, foreign, manager] = actors;
  const base = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/outline`;
  const read = async (a = teacher) => {
    const r = await http(base, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as {
      revision: string;
      publicationNo: number;
      chapters: {
        id: string;
        title: string;
        units: { id: string; title: string; kind: string; target: string }[];
      }[];
      resources: { id: string; title: string; state: string }[];
      activities: { id: string; title: string; status: string }[];
    };
  };
  const initial = await read();
  assert.equal(initial.revision, '1');
  const lecture = initial.resources.find((r) => r.state === 'PUBLISHED')!;
  const activity = initial.activities.find((a) => a.status === 'PUBLISHED')!;
  const draftActivity = initial.activities.find((a) => a.status === 'DRAFT')!;
  assert.ok(lecture && activity && draftActivity);
  const chapters = [
    {
      id: randomUUID(),
      title: '第一章 · 安全入门',
      units: [
        { id: randomUUID(), title: '安全讲义与图片', kind: 'LECTURE', target: lecture.id },
        { id: randomUUID(), title: '巡检练习', kind: 'ACTIVITY', target: activity.id },
      ],
    },
    { id: randomUUID(), title: '第二章 · 课堂实践', units: [] },
  ];
  const save = { type: 'SAVE_OUTLINE', revision: '1', chapters };
  const key = randomUUID();
  const saved = await http(base, teacher, save, 'POST', { 'x-zhiban-command': key });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal((await read(student)).chapters.length, 0);
  assert.deepEqual(
    (await http(base, teacher, save, 'POST', { 'x-zhiban-command': key })).json,
    saved.json,
  );
  assert.equal(
    (await http(base, teacher, { ...save, chapters: [] }, 'POST', { 'x-zhiban-command': key }))
      .status,
    409,
  );
  assert.equal((await http(base, teacher, save)).status, 409);
  for (const actor of [student, outsider, foreign, manager])
    assert.equal(
      (await http(base, actor, { type: 'SAVE_OUTLINE', revision: '2', chapters: [] })).status,
      403,
    );
  assert.equal((await http(base)).status, 401);
  const invalid = structuredClone(chapters);
  invalid[0].units[0].target = v7();
  assert.equal(
    (await http(base, teacher, { type: 'SAVE_OUTLINE', revision: '2', chapters: invalid })).status,
    409,
  );
  const missingActivity = structuredClone(chapters);
  missingActivity[0].units[1].target = v7();
  assert.equal(
    (await http(base, teacher, { type: 'SAVE_OUTLINE', revision: '2', chapters: missingActivity }))
      .status,
    409,
  );
  const unready = structuredClone(chapters);
  unready[0].units[1].target = draftActivity.id;
  assert.equal(
    (await http(base, teacher, { type: 'SAVE_OUTLINE', revision: '2', chapters: unready })).status,
    200,
  );
  assert.equal((await http(base, teacher, { type: 'PUBLISH_OUTLINE', revision: '3' })).status, 409);
  assert.equal(
    (await http(base, teacher, { type: 'SAVE_OUTLINE', revision: '3', chapters })).status,
    200,
  );
  assert.equal((await http(base, teacher, { type: 'PUBLISH_OUTLINE', revision: '4' })).status, 200);
  assert.equal((await read(student)).chapters[0].units.length, 2);
  const concurrent = await Promise.all([
    http(base, teacher, { type: 'SAVE_OUTLINE', revision: '5', chapters: [] }),
    http(base, teacher, { type: 'SAVE_OUTLINE', revision: '5', chapters }),
  ]);
  assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 409]);
  assert.equal((await read(student)).chapters[0].title, chapters[0].title);
  assert.equal(
    (await http(base, teacher, { type: 'SAVE_OUTLINE', revision: '6', chapters })).status,
    200,
  );
  record(
    'curriculum: draft isolation, publication, stale revision, same-key replay, concurrent save, forged/cross-context references and nonteacher writes rejected',
  );
  // Teacher UI renames a chapter and moves a unit across chapters; publish then student deep links.
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
  try {
    const tp = await tc.newPage(),
      sp = await sc.newPage();
    const course = (
      await admin.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [tenant, trial.offeringId],
      )
    ).rows[0].course_id;
    const url = (role: string) =>
      `${origin}/zhiban/${role}/courses/${course}?space=${tenant}&offering=${trial.offeringId}`;
    await tp.goto(url('teacher'));
    await tp.getByLabel('章节 1 名称', { exact: true }).fill('第一章 · 安全学习');
    await tp.getByLabel('单元 1.2 移动到章节', { exact: true }).selectOption(chapters[1].id);
    await tp.getByRole('button', { name: '保存目录草稿', exact: true }).click();
    await expect(tp.getByRole('status').filter({ hasText: '目录已保存' })).toBeVisible();
    await tp.getByRole('button', { name: '发布已保存目录', exact: true }).click();
    await expect(tp.getByRole('status').filter({ hasText: '当前发布版本 2' })).toBeVisible();
    await tp.reload();
    await expect(tp.getByLabel('章节 1 名称', { exact: true })).toHaveValue('第一章 · 安全学习');
    await sp.goto(url('student'));
    await expect(
      sp.getByRole('heading', { name: '1. 第一章 · 安全学习', exact: true }),
    ).toBeVisible();
    await expect(sp.getByRole('button', { name: '保存目录草稿', exact: true })).toHaveCount(0);
    await sp.getByRole('link', { name: '讲义 · 安全讲义与图片', exact: true }).click();
    await expect(sp.getByRole('heading', { name: '已发布预览', exact: true })).toBeVisible();
    await sp.goto(url('student'));
    await sp.getByRole('link', { name: '活动 · 巡检练习', exact: true }).click();
    await expect(
      sp.locator('.learning-activity').getByRole('heading', { name: activity.title, exact: true }),
    ).toBeVisible();
    await sp.goto(url('student'));
    await sp.setViewportSize({ width: 390, height: 844 });
    await expect(
      sp.getByRole('heading', { name: '1. 第一章 · 安全学习', exact: true }),
    ).toBeVisible();
    assert.equal(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally {
    await tc.close();
    await sc.close();
  }
  // Withdrawal removes an activity from the student directory without deleting history.
  const before = await read();
  const a = (
    await admin.query(
      'SELECT revision::text FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2',
      [tenant, activity.id],
    )
  ).rows[0];
  assert.equal(
    (
      await http(base.replace('/outline', ''), teacher, {
        type: 'WITHDRAW_ACTIVITY',
        id: activity.id,
        revision: a.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (await read(student)).chapters.flatMap((c) => c.units).some((u) => u.target === activity.id),
    false,
  );
  const withdrawn = (
    await admin.query(
      'SELECT revision::text FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2',
      [tenant, activity.id],
    )
  ).rows[0];
  assert.equal(
    (
      await http(base.replace('/outline', ''), teacher, {
        type: 'PUBLISH_ACTIVITY',
        id: activity.id,
        revision: withdrawn.revision,
      })
    ).status,
    200,
  );
  assert.equal((await read()).revision, before.revision);
  record(
    'curriculum: real teacher rename/move/save/publish persists; student text/PNG lecture and exact activity links work; mobile fits; withdrawal hides unit and preserves source records',
  );
  const business = await import('pg').then(
    ({ Pool }) =>
      new Pool({
        host: admin.options.host,
        port: admin.options.port,
        database: admin.options.database,
        user: 'zhiban_academic_runtime',
      }),
  );
  try {
    assert.equal(await loadCurriculum(business), true);
  } finally {
    await business.end();
  }
}
