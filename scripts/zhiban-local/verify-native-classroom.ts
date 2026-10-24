/** Native presentation with existing classroom authorization. No model, maintenance or Runtime enablement. */
import assert from 'node:assert/strict';
import { v7 } from 'uuid';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { QueryResultRow } from 'pg';
import type { prepareTrial } from './prepare-trial';
import type { PresentationView } from '../../app/zhiban/local/classroom-player';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
export async function verifyNativeClassroom(input: Input) {
  const { http, actors, tenant, trial, browser, origin, admin, record } = input;
  const [teacher, student, outsider] = actors;
  const content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const learning = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const classrooms = learning + '/classrooms';
  const folder = 'docs/v2/evidence/native-classroom';
  await mkdir(folder, { recursive: true });
  const send = async (path: string, command: unknown, actor = teacher) => {
    const r = await http(path, actor, command);
    assert.equal(r.status, 200, JSON.stringify({ command, response: r.json }));
    return r.json as QueryResultRow;
  };
  const read = async () => {
    const r = await http(classrooms, teacher);
    assert.equal(r.status, 200);
    return r.json as PresentationView;
  };
  const baseline = await admin.query(
    'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1',
    [tenant],
  );
  const resource = await send(content, { type: 'CREATE_CONTENT', title: '原生课堂同步：电路观察' });
  await send(content, {
    type: 'SAVE_CONTENT',
    id: resource.id,
    revision: '1',
    title: '原生课堂同步：电路观察',
    slides: [1, 2].map((n) => ({
      id: v7(),
      elements: [{ id: v7(), text: `原生课堂第 ${n} 页`, x: 20, y: 20, width: 800, height: 180 }],
    })),
  });
  const row = (
    (await http(content, teacher)).json as { resources: QueryResultRow[] }
  ).resources.find((r) => r.id === resource.id)!;
  await send(content, { type: 'PUBLISH_CONTENT', id: resource.id, revision: row.revision });
  const preview = (
    await http(content + '/resources/' + resource.id + '/preview?source=published', teacher)
  ).json as { publicationId: string };
  const outline = (await http(learning + '/outline', teacher)).json as { revision: string };
  await send(learning + '/outline', {
    type: 'SAVE_OUTLINE',
    revision: outline.revision,
    chapters: [
      {
        id: v7(),
        title: '原生课堂',
        units: [{ id: v7(), kind: 'LECTURE', target: resource.id, title: '演示讲义' }],
      },
    ],
  });
  await send(learning + '/outline', {
    type: 'PUBLISH_OUTLINE',
    revision: String(BigInt(outline.revision) + BigInt(1)),
  });
  let session = await send(classrooms, {
    type: 'CREATE_CLASSROOM',
    title: '原生课堂同步',
    description: '原生播放器，共享页码不计完成',
    opensAt: null,
    closesAt: null,
  });
  session = await send(classrooms, {
    type: 'PUBLISH_CLASSROOM',
    id: session.id,
    revision: session.revision,
  });
  const dispatched = await send(classrooms, {
    type: 'DISPATCH_TASK',
    id: session.id,
    revision: session.revision,
    kind: 'LECTURE',
    target: resource.id,
    version: '1',
  });
  const task = () =>
    read().then(
      (v) =>
        v.sessions
          .find((s) => s.id === session.id)!
          .tasks.find((t) => t.id === dispatched.dispatchId)!,
    );
  assert.equal((await task()).publicationId, preview.publicationId);
  const path = `${content}/resources/${resource.id}/player?publication=${preview.publicationId}&classroom=${session.id}`;
  assert.equal((await http(path, outsider)).status, 403);
  assert.equal((await http(path + '&extra=1', teacher)).status, 400);
  assert.equal((await http(path + '&classroom=' + session.id, teacher)).status, 400);
  assert.equal((await http(path.replace(String(session.id), 'invalid'), teacher)).status, 400);
  assert.equal((await http(path + '&dispatch=' + dispatched.dispatchId, teacher)).status, 400);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const [i, actor] of [teacher, student].entries()) {
      await contexts[i].addCookies([
        {
          name: actor.cookie!.split('=')[0],
          value: actor.cookie!.split('=').slice(1).join('='),
          url: origin,
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
    }
    const tp = await contexts[0].newPage(),
      sp = await contexts[1].newPage();
    await sp.goto(origin + path);
    await expect(sp.locator('#player-status')).toContainText('任务已切换');
    await expect(sp.getByTestId('counter')).toHaveCount(0);
    await send(
      classrooms,
      {
        type: 'ENTER_TASK',
        id: session.id,
        revision: dispatched.revision,
        dispatchId: dispatched.dispatchId,
      },
      student,
    );
    await tp.goto(origin + path);
    await sp.goto(origin + path);
    await expect(tp.getByTestId('counter')).toHaveText('1 / 2');
    await expect(sp.getByTestId('counter')).toHaveText('1 / 2');
    await tp.keyboard.press('ArrowRight');
    await expect(tp.getByTestId('counter')).toHaveText('2 / 2');
    assert.equal((await task()).current_page, 1); // Local preview is not an implicit business write.
    await tp.getByRole('button', { name: '共享当前原生播放器页', exact: true }).click();
    await expect(tp.locator('#classroom-presentation')).toContainText('全班共享第 2');
    await expect(sp.getByTestId('counter')).toHaveText('2 / 2', { timeout: 15000 });
    await sp.getByRole('button', { name: '切换自主浏览', exact: true }).click();
    await sp.keyboard.press('ArrowLeft');
    await expect(sp.getByTestId('counter')).toHaveText('1 / 2');
    await sp.reload(); // Reconnect takes the current teacher page, not a stale scene fragment.
    await expect(sp.getByTestId('counter')).toHaveText('2 / 2');
    await sp.getByRole('button', { name: '切换自主浏览', exact: true }).click();
    await tp.keyboard.press('ArrowLeft');
    await tp.getByRole('button', { name: '共享当前原生播放器页', exact: true }).click();
    await expect(sp.locator('#classroom-presentation')).toContainText('教师第 1', {
      timeout: 15000,
    });
    await expect(sp.getByTestId('counter')).toHaveText('2 / 2');
    await sp.getByRole('button', { name: '恢复跟随教师', exact: true }).click();
    await expect(sp.getByTestId('counter')).toHaveText('1 / 2');
    const current = await task();
    assert.equal(
      (
        await http(classrooms, student, {
          type: 'PRESENT_LECTURE_PAGE',
          id: session.id,
          revision: dispatched.revision,
          dispatchId: current.id,
          presentationRevision: current.presentation_revision,
          page: 2,
        })
      ).status,
      403,
    );
    await contexts[1].setOffline(true);
    await expect(sp.locator('#player-status')).toContainText('连接中断');
    await expect(sp.getByTestId('counter')).toHaveText('1 / 2');
    await contexts[1].setOffline(false);
    await expect(sp.locator('#player-status')).toBeHidden({ timeout: 15000 });
    // Different valid-looking classroom IDs must not silently degrade to standalone playback.
    await sp.goto(origin + path.replace(String(session.id), v7()));
    await expect(sp.getByTestId('counter')).toHaveCount(0);
    await expect(sp.locator('#player-status')).toContainText('任务已切换');
    await sp.goto(origin + path);
    await expect(sp.getByTestId('counter')).toHaveText('1 / 2');
    await sp.getByRole('link', { name: '返回本次课堂', exact: true }).click();
    await expect(sp).toHaveURL(
      new RegExp('/zhiban/student/courses/[^/]+/coursework\\?space=' + tenant),
    );
    await expect(sp.getByRole('button', { name: '继续课堂任务', exact: true })).toBeVisible();
    await sp.getByRole('button', { name: '继续课堂任务', exact: true }).click();
    await expect(sp).toHaveURL(/\/player\?publication=.*&classroom=/);
    await expect(sp.getByTestId('counter')).toHaveText('1 / 2');
    await sp.screenshot({ path: folder + '/student.png', fullPage: true });
    const fresh = (await read()).sessions.find((s) => s.id === session.id)!;
    await send(classrooms, { type: 'END_CLASSROOM', id: session.id, revision: fresh.revision });
    for (const page of [sp, tp]) {
      await expect(page.locator('#player-status')).toContainText('任务已切换', { timeout: 15000 });
      await expect(page.getByTestId('counter')).toHaveCount(0);
      await expect(page.locator('#classroom-presentation')).toBeHidden();
    }
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      baseline.rows[0].n,
    );
    await writeFile(
      folder + '/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          scope: 'NATIVE_PLAYER_EXISTING_CLASSROOM_PRESENTATION_ONLY',
          entry: origin,
          classroomId: session.id,
          publicationId: preview.publicationId,
          checks: [
            'native App keyboard and explicit teacher sharing',
            'student follow and independent browse',
            'reload and offline recovery',
            'exact classroom context return and continue',
            'no-entry and wrong classroom do not mount',
            'student share and unknown query refused',
            'ended classroom unmounts both hosts',
            'zero new Attempts / no completion or grade claims',
          ],
          maintenanceExecuted: false,
          nativeRuntimeEnabled: false,
          modelCalls: false,
        },
        null,
        2,
      ) + '\n',
    );
    record(
      'native classroom: teacher native page sharing, student follow / independent browse, reconnect / context return, ended-task unmount; original authorization, no Native maintenance or completion writes',
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
}
