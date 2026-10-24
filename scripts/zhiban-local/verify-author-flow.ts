import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { v7 } from 'uuid';
import type { prepareTrial } from './prepare-trial';
type Shared = Parameters<typeof prepareTrial>[0];
type Unit = { id: string; title: string; kind: string; target: string };
type Outline = { revision: string; chapters: { id: string; title: string; units: Unit[] }[] };
export async function verifyAuthorFlow(
  input: Shared & { trial: Awaited<ReturnType<typeof prepareTrial>> },
) {
  const { admin, browser, actors, http, tenant, origin, trial, record } = input;
  const [teacher, student] = actors;
  const base = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`,
    outline = base + '/outline';
  const read = async () => {
    const r = await http(outline, teacher);
    assert.equal(r.status, 200);
    return r.json as Outline;
  };
  const current = await read(),
    chapterId = current.chapters[0].id;
  const course = (
    await admin.query(
      'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
      [tenant, trial.offeringId],
    )
  ).rows[0].course_id;
  const home = `${origin}/zhiban/teacher/courses/${course}?space=${tenant}&offering=${trial.offeringId}`;
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
    const page = await tc.newPage(),
      sp = await sc.newPage();
    await page.goto(home);
    await page.getByLabel('章节 1 名称', { exact: true }).fill('第一章 · 连贯备课');
    const chapter = () =>
      page
        .locator('.outline-chapter')
        .filter({ has: page.getByLabel('章节 1 名称', { exact: true }) });
    await chapter().getByRole('link', { name: '本章新建讲义', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '请先保存目录草稿' })).toBeVisible();
    assert.equal(page.url(), home);
    await page.getByRole('button', { name: '保存目录草稿', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '目录已保存' })).toBeVisible();
    await chapter().getByRole('link', { name: '本章新建讲义', exact: true }).click();
    await page
      .getByRole('textbox', { name: '新内容标题', exact: true })
      .fill('连贯备课：设备检查讲义');
    await page.getByRole('button', { name: '新建内容', exact: true }).click();
    await expect(page.getByRole('heading', { name: '内容草稿', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '添加文本框', exact: true }).click();
    await page
      .getByRole('textbox', { name: '正文 1', exact: true })
      .fill('课堂准备：断电检查，再确认防护装置。');
    await expect(page.getByText('请先保存讲义草稿，再返回原章节。', { exact: true })).toBeVisible();
    await expect(page.getByText('返回原章节并加入目录', { exact: true })).not.toHaveAttribute(
      'href',
      /.+/,
    );
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '发布保存版本', exact: true }).click();
    await expect(page.getByRole('button', { name: '撤回发布', exact: true })).toBeVisible();
    await page.getByRole('link', { name: '返回原章节并加入目录', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已加入原章节' })).toBeVisible();
    const localLecture = chapter().getByRole('link', {
      name: '讲义 · 连贯备课：设备检查讲义',
      exact: true,
    });
    await expect(localLecture).toBeVisible();
    assert.equal(
      (await read()).chapters[0].units.some((u) => u.title === '连贯备课：设备检查讲义'),
      false,
    );
    await page.getByRole('button', { name: '保存目录草稿', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '目录已保存' })).toBeVisible();
    await page.getByRole('button', { name: '发布已保存目录', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '目录已保存' })).toBeVisible();
    await expect(page.getByRole('button', { name: '发布已保存目录', exact: true })).toBeEnabled();
    await chapter().getByRole('link', { name: '本章新建活动', exact: true }).click();
    const form = page
      .locator('details.academic-form')
      .filter({ has: page.getByText('新建文字活动', { exact: true }) });
    await expect(form).toHaveAttribute('open', '');
    await form.getByRole('textbox', { name: '活动标题', exact: true }).fill('连贯备课：检查记录');
    await form
      .getByRole('textbox', { name: '活动要求', exact: true })
      .fill('按顺序记录设备检查步骤。');
    await form.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(
      page.getByRole('link', { name: '返回原章节并加入目录', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '操作已完成' })).toBeVisible();
    await page.getByRole('link', { name: '返回原章节并加入目录', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已加入原章节' })).toBeVisible();
    await page.getByRole('button', { name: '保存目录草稿', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '目录已保存' })).toBeVisible();
    await page.getByRole('button', { name: '发布已保存目录', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '引用的内容未发布' })).toBeVisible();
    const activityRow = chapter()
      .locator('.outline-unit')
      .filter({ has: page.getByRole('link', { name: '活动 · 连贯备课：检查记录', exact: true }) });
    await activityRow.getByRole('link', { name: '编辑活动并返回本章', exact: true }).click();
    const edit = page
      .locator('.learning-activity')
      .filter({ has: page.getByRole('heading', { name: '连贯备课：检查记录', exact: true }) });
    await expect(edit.locator('details.academic-form')).toHaveAttribute('open', '');
    await edit
      .getByRole('textbox', { name: '活动要求', exact: true })
      .fill('按顺序记录设备检查步骤，并说明理由。');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: '返回原章节并加入目录', exact: true }).click();
    await expect(edit.getByRole('textbox', { name: '活动要求', exact: true })).toHaveValue(
      '按顺序记录设备检查步骤，并说明理由。',
    );
    await edit.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '操作已完成' })).toBeVisible();
    await edit.getByRole('button', { name: '发布新版本', exact: true }).click();
    await expect(edit).toContainText('已发布');
    await page.getByRole('link', { name: '返回原章节并加入目录', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '没有重复添加' })).toBeVisible();
    const ready = await read();
    assert.equal(ready.chapters[0].units.filter((u) => u.title === '连贯备课：检查记录').length, 1);
    await page.getByRole('button', { name: '发布已保存目录', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '目录已保存' })).toBeVisible();
    await page
      .getByRole('button', { name: '发布已保存目录', exact: true })
      .waitFor({ state: 'visible' });
    const studentHome = home.replace('/teacher/', '/student/');
    await sp.goto(studentHome);
    await expect(
      sp.getByRole('link', { name: '讲义 · 连贯备课：设备检查讲义', exact: true }),
    ).toBeVisible();
    await expect(
      sp.getByRole('link', { name: '活动 · 连贯备课：检查记录', exact: true }),
    ).toBeVisible();
    await expect(sp.getByRole('link', { name: '本章新建活动', exact: true })).toHaveCount(0);
    record(
      'author flow: chapter -> lecture create/edit/save/publish -> attach draft -> outline save; chapter -> activity create/edit/publish -> same chapter without duplicate; student sees only published outline',
    );
    // Concurrent chapter removal keeps the created content and does not silently place it elsewhere.
    const target = ready.chapters[0].units.find(
      (u) => u.kind === 'ACTIVITY' && u.title === '连贯备课：检查记录',
    )!;
    await page.goto(home + `#attach-${v7()}-ACTIVITY-${target.target}`);
    await expect(page.getByRole('status').filter({ hasText: '原章节已移除' })).toBeVisible();
    assert.deepEqual((await read()).chapters, ready.chapters);
    await page.goto(home + `#attach-${chapterId}-ACTIVITY-${v7()}`);
    await expect(page.getByRole('status').filter({ hasText: '该内容当前不可访问' })).toBeVisible();
    assert.deepEqual((await read()).chapters, ready.chapters);
    record(
      'author flow: unsaved outline launch blocked; lecture save required before return; activity cancel preserves edits; missing chapter/invalid reference leaves outline unchanged and existing content retained',
    );
  } finally {
    await tc.close();
    await sc.close();
  }
}
