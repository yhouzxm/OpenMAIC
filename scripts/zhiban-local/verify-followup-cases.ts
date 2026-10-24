import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import { loadFollowup } from './followup';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: import('pg').Pool;
};
type Result = { id: string; revision: string; state: string; eventId: string };
type CaseRecord = Result & {
  activity_version: number;
  enrollment_id: string;
  evidence: Record<string, unknown>;
};
export async function verifyFollowupCases(input: Input) {
  const {
    admin,
    businessPool,
    browser,
    http,
    actors: [teacher, student, outsider, foreign, manager, peer],
    tenant,
    origin,
    trial,
    record,
  } = input;
  const base = `/api/zhiban/analytics/${tenant}/offerings/${trial.offeringId}`,
    url = base + '/followup-cases';
  const learning = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const send = async (path: string, command: unknown, key = v7()) => {
    const r = await http(path, teacher, command, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const read = async (id: string) => {
    const r = await http(url + '/' + id, teacher);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as {
      record: CaseRecord;
      rows: { id: string; body: string; revision: string; actor_id: string }[];
      next: string | null;
    };
  };
  const activity = await send(learning, {
    type: 'CREATE_ACTIVITY',
    title: '人工跟进：观察记录',
    prompt: '说明观察结果。',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await send(learning, { type: 'PUBLISH_ACTIVITY', id: activity.id, revision: activity.revision });
  const command = {
    type: 'CREATE_CASE',
    activityId: activity.id,
    version: 1,
    membershipId: student.member,
    body: '教师首次联系，约定补充观察记录。',
  };
  const key = v7();
  const [first, replay] = await Promise.all([send(url, command, key), send(url, command, key)]);
  assert.equal(first.id, replay.id);
  assert.equal((await read(first.id)).rows.length, 1);
  assert.equal(
    (
      await http(url, teacher, { ...command, body: '不同命令内容' }, 'POST', {
        'x-zhiban-command': key,
      })
    ).status,
    409,
  );
  assert.equal((await http(url, teacher, command)).status, 409);
  assert.equal((await http(url, teacher, { ...command, version: 2 })).status, 409);
  assert.equal(
    (await http(url, teacher, { ...command, membershipId: foreign.member })).status,
    409,
  );
  assert.equal(
    (await http(url, teacher, { ...command, evidence: { reason: 'COMPLETE' } })).status,
    400,
  );
  // Header state/revision and immutable events must not straddle a concurrent case update.
  const held = await admin.connect();
  let reading: ReturnType<typeof http> | undefined;
  try {
    await held.query('BEGIN');
    await held.query(
      'SELECT id FROM zhiban_followup.cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [tenant, first.id],
    );
    reading = http(url + '/' + first.id, teacher);
    const until = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < until) {
      blocked = (
        await admin.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='zhiban_academic_runtime' AND wait_event_type='Lock' AND query LIKE '%c.id=$3 FOR SHARE OF c%') AS waiting",
        )
      ).rows[0].waiting;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      blocked,
      true,
      'Case detail read must lock its mutable header while reading events',
    );
  } finally {
    await held.query('ROLLBACK');
    held.release();
  }
  assert.equal((await reading!).status, 200);
  const append = {
    type: 'ADD_NOTE',
    id: first.id,
    revision: first.revision,
    body: '计划完成后请教师复核。',
  };
  const close = {
    type: 'CLOSE_CASE',
    id: first.id,
    revision: first.revision,
    body: '教师确认本次人工沟通已完成。',
  };
  const raced = await Promise.all([http(url, teacher, append), http(url, teacher, close)]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
  let current = (await read(first.id)).record;
  if (current.state === 'CLOSED')
    current = (await send(url, {
      type: 'REOPEN_CASE',
      id: current.id,
      revision: current.revision,
      body: '仍需记录下一次人工复核。',
    })) as CaseRecord;
  const before = await read(first.id);
  await admin.query('REVOKE INSERT ON zhiban_followup.events FROM zhiban_academic_runtime');
  try {
    assert.equal(
      (
        await http(url, teacher, {
          type: 'ADD_NOTE',
          id: first.id,
          revision: current.revision,
          body: '审计写入失败不得单独更新主记录。',
        })
      ).status,
      503,
    );
  } finally {
    await admin.query('GRANT INSERT ON zhiban_followup.events TO zhiban_academic_runtime');
  }
  const after = await read(first.id);
  assert.equal(after.record.revision, before.record.revision);
  assert.equal(after.rows.length, before.rows.length);
  assert.equal(await loadFollowup(businessPool), true);
  for (const table of ['events', 'commands']) {
    const acl = (
      await admin.query(
        "SELECT has_table_privilege('zhiban_academic_runtime',$1,'UPDATE') AS update,has_table_privilege('zhiban_academic_runtime',$1,'DELETE') AS delete",
        ['zhiban_followup.' + table],
      )
    ).rows[0];
    assert.deepEqual(acl, { update: false, delete: false });
  }
  assert.equal(
    (
      await admin.query(
        "SELECT has_column_privilege('zhiban_academic_runtime','zhiban_followup.cases','enrollment_id','UPDATE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  const raw = await businessPool.connect();
  try {
    await raw.query('BEGIN');
    await raw.query("SELECT set_config('app.tenant_id',$1,true)", [v7()]);
    assert.equal(
      (await raw.query('SELECT id FROM zhiban_followup.cases WHERE id=$1', [first.id])).rows.length,
      0,
    );
    await raw.query('ROLLBACK');
    await raw.query('BEGIN');
    await raw.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    await assert.rejects(
      raw.query("UPDATE zhiban_followup.events SET body='tamper' WHERE case_id=$1", [first.id]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
  } finally {
    await raw.query('ROLLBACK');
    raw.release();
  }
  for (const actor of [student, peer, manager, outsider, foreign]) {
    assert.equal((await http(url, actor)).status, 403);
    assert.equal((await http(url + '/' + first.id, actor)).status, 403);
    assert.equal(
      (
        await http(url, actor, {
          type: 'ADD_NOTE',
          id: first.id,
          revision: current.revision,
          body: '未授权写入。',
        })
      ).status,
      403,
    );
  }
  assert.equal((await http(url)).status, 401);
  assert.equal(
    (
      await http(
        url,
        teacher,
        { type: 'ADD_NOTE', id: first.id, revision: current.revision, body: '无 CSRF' },
        'POST',
        { 'x-zhiban-csrf': 'bad' },
      )
    ).status,
    403,
  );
  const context = await browser.newContext();
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
  const page = await context.newPage();
  const teacherUrl = `${origin}/zhiban/teacher/courses/${trial.courseId}/analytics?space=${tenant}&offering=${trial.offeringId}#followups`;
  await page.goto(teacherUrl);
  await expect(page.getByRole('heading', { name: '教师待跟进名单', exact: true })).toBeVisible();
  const bounds = await page.locator('#analytics').boundingBox();
  assert.ok(bounds && bounds.width > 600 && bounds.x >= 240);
  await page.getByLabel('搜索待跟进学生或活动', { exact: true }).fill('人工跟进：');
  await page.getByRole('button', { name: '查询待跟进名单', exact: true }).click();
  await page.getByRole('button', { name: '查看进行中跟进', exact: true }).click();
  await expect(page.getByRole('heading', { name: '处理历史', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '追加跟进或结案', exact: true }).click();
  await page.getByLabel('处理动作', { exact: true }).selectOption('CLOSE_CASE');
  await page
    .getByLabel('跟进内容／处理说明', { exact: true })
    .fill('已完成本轮人工沟通，等待学生按原活动要求提交。');
  await page.getByLabel('跟进内容／处理说明', { exact: true }).press('Escape');
  await expect(page.getByLabel('跟进内容／处理说明', { exact: true })).toHaveValue(
    '已完成本轮人工沟通，等待学生按原活动要求提交。',
  );
  await expect(
    page.getByText('输入尚未保存，请保存或明确选择放弃未保存内容并关闭。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(page.getByText('人工跟进：已结案', { exact: false })).toBeVisible();
  assert.equal((await read(first.id)).record.state, 'CLOSED');
  const pending = await http(base + '/followups?q=' + encodeURIComponent('人工跟进：'), teacher);
  assert.equal(pending.status, 200);
  assert.equal((pending.json as { totalMatches: number }).totalMatches, 2);
  await page.screenshot({ path: 'docs/v2/evidence/followup-cases/closed.png' });
  await page.getByRole('button', { name: '重新打开跟进', exact: true }).click();
  await page
    .getByLabel('跟进内容／处理说明', { exact: true })
    .fill('学生需要进一步说明，重新开启人工跟进。');
  await page.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(page.getByText('人工跟进：进行中', { exact: false })).toBeVisible();
  // Events pagination remains bound to the exact case.
  for (let i = 0; i < 20; i++) {
    current = (await read(first.id)).record;
    await send(url, {
      type: 'ADD_NOTE',
      id: current.id,
      revision: current.revision,
      body: '后续复核记录 ' + i,
    });
  }
  const events = await read(first.id);
  assert.equal(events.rows.length, 20);
  assert.ok(events.next);
  const older = await http(url + '/' + first.id + '?cursor=' + events.next, teacher);
  assert.equal(older.status, 200);
  assert.ok((older.json as { rows: unknown[] }).rows.length > 0);
  const other = await send(url, {
    ...command,
    membershipId: peer.member,
    body: '另一学生跟进，隔离历史游标。',
  });
  assert.equal((await http(url + '/' + other.id + '?cursor=' + events.next, teacher)).status, 400);
  // Publishing a new version never inherits the old case or clears immutable history.
  const detail = await http(
    learning + '/activities?q=' + encodeURIComponent('人工跟进：'),
    teacher,
  );
  assert.equal(detail.status, 200);
  await send(learning, {
    type: 'PUBLISH_ACTIVITY',
    id: activity.id,
    revision: (detail.json as { rows: Result[] }).rows[0].revision,
  });
  const fresh = await http(base + '/followups?q=' + encodeURIComponent('人工跟进：'), teacher);
  assert.equal(fresh.status, 200);
  assert.ok(
    (fresh.json as { rows: { version: number; caseId?: string | null }[] }).rows.every(
      (r) => r.version === 2 && !r.caseId,
    ),
  );
  assert.equal((await read(first.id)).record.activity_version, 1);
  const enrollment = (
    await admin.query(
      "SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [tenant, trial.offeringId, student.member],
    )
  ).rows[0];
  const manage = async (command: unknown) => {
    const r = await http(`/api/zhiban/management/${tenant}/commands`, manager, command);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  await manage({ type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision });
  current = (await read(first.id)).record;
  await send(url, {
    type: 'CLOSE_CASE',
    id: first.id,
    revision: current.revision,
    body: '退班后的历史人工事项结案；不改变退班事实。',
  });
  assert.equal((await http(url, teacher, { ...command, version: 2 })).status, 409);
  const list = await http(
    url + '?q=' + encodeURIComponent('人工跟进：') + '&state=CLOSED',
    teacher,
  );
  assert.equal(list.status, 200);
  assert.ok((list.json as { rows: Result[] }).rows.some((r) => r.id === first.id));
  await page.getByRole('button', { name: '跟进记录与结案', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '人工跟进记录与结案', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/v2/evidence/followup-cases/history.png' });
  await context.close();
  const assignment = (
    await admin.query(
      "SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [tenant, trial.offeringId, teacher.member],
    )
  ).rows[0];
  await manage({ type: 'END_TEACHER', id: assignment.id, revision: assignment.revision });
  assert.equal((await http(url + '/' + first.id, teacher)).status, 403);
  assert.equal(
    (
      await http(url, teacher, {
        type: 'REOPEN_CASE',
        id: first.id,
        revision: current.revision,
        body: '撤权后不得操作。',
      })
    ).status,
    403,
  );
  await writeFile(
    'docs/v2/evidence/followup-cases/journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope: 'MANUAL_NOTE_CLOSE_REOPEN_IMMUTABLE_AUDIT',
        sameKeyReplayOnce: true,
        revisionRace: 'ONE_SUCCESS_ONE_CONFLICT',
        auditInsertFailureRollsBack: true,
        eventsAndReceiptsImmutableAcl: true,
        closedCaseDoesNotResolveLearningFacts: true,
        republishDoesNotInheritCase: true,
        historicalEnrollmentCaseClosable: true,
        revokedTeacherReadWriteDenied: true,
        eventsPagination: 'BOUND_TO_CASE',
        automaticNotification: false,
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'P5 manual cases: note/close/reopen browser, immutable audit, replay/race/rollback, current teacher revocation, old version/Enrollment history and cursor isolation PASS',
  );
}
