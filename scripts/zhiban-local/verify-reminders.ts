import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import { loadReminder } from './reminder';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: import('pg').Pool;
};
type Result = { id: string; revision: string; confirmedAt: number };
export async function verifyReminders(input: Input) {
  const {
    admin,
    businessPool,
    browser,
    http,
    tenant: t,
    origin,
    trial,
    actors: [teacher, student, outsider, foreign, manager, peer],
    record,
  } = input;
  const o = trial.offeringId,
    url = `/api/zhiban/reminders/${t}/offerings/${o}`,
    cases = `/api/zhiban/analytics/${t}/offerings/${o}/followup-cases`,
    learning = `/api/zhiban/learning/${t}/offerings/${o}`;
  const ok = async (path: string, a: typeof teacher, c: unknown, key = v7()) => {
    const r = await http(path, a, c, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const read = async (a: typeof teacher, caseId?: string) => {
    const r = await http(url + (caseId ? '?case=' + caseId : ''), a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as { rows: Record<string, unknown>[]; next: string | null };
  };
  const activity = await ok(learning, teacher, {
    type: 'CREATE_ACTIVITY',
    title: '提醒课堂：检查观察记录',
    prompt: '请补充观察。',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await ok(learning, teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: activity.id,
    revision: activity.revision,
  });
  const create = (a: typeof student) =>
    ok(cases, teacher, {
      type: 'CREATE_CASE',
      activityId: activity.id,
      version: 1,
      membershipId: a.member,
      body: 'PRIVATE_NOTE_DO_NOT_DELIVER',
    });
  const c = await create(student),
    pc = await create(peer);
  const command = {
    type: 'SEND_REMINDER',
    caseId: c.id,
    revision: c.revision,
    title: '请补充观察记录',
    body: '请在学习活动中补充观察，完成后联系老师。',
  };
  const key = v7(),
    [first, retry] = await Promise.all([
      ok(url, teacher, command, key),
      ok(url, teacher, command, key),
    ]);
  assert.equal(first.id, retry.id);
  const changed = await http(url, teacher, { ...command, body: 'changed' }, 'POST', {
    'x-zhiban-command': key,
  });
  assert.equal(changed.status, 409);
  assert.equal(
    (await http(url, teacher, command)).status,
    409,
    'different keys must not create duplicate pending deliveries',
  );
  assert.equal((await read(student)).rows.length, 1);
  assert.equal((await read(peer)).rows.length, 0);
  assert.equal(JSON.stringify(await read(student)).includes('PRIVATE_NOTE'), false);
  for (const field of ['case_id', 'membership_id', 'enrollment_id', 'evidence', 'actor_id'])
    assert.equal(Object.hasOwn((await read(student)).rows[0], field), false);
  for (const a of [student, peer, outsider, foreign, manager])
    assert.notEqual((await http(url, a, command)).status, 200);
  assert.equal((await http(url, student)).status, 200);
  assert.equal((await http(url, teacher)).status, 403);
  assert.equal((await http(url, student, undefined, 'GET')).status, 200);
  assert.equal(
    (
      await http(url, student, {
        type: 'CONFIRM_REMINDER',
        id: first.id,
        membershipId: peer.member,
      })
    ).status,
    400,
  );
  assert.equal((await http(url, peer, { type: 'CONFIRM_REMINDER', id: first.id })).status, 404);
  assert.equal((await http(url + '?case=' + c.id, student)).status, 403);
  assert.equal((await http(url)).status, 401);
  assert.equal((await http(url, teacher, command, 'POST', { 'x-zhiban-csrf': 'bad' })).status, 403);
  assert.equal((await http(url, teacher, { ...command, membershipId: peer.member })).status, 400);
  const ack = { type: 'CONFIRM_REMINDER', id: first.id };
  const [a, b] = await Promise.all([ok(url, student, ack), ok(url, student, ack)]);
  assert.equal(a.confirmedAt, b.confirmedAt);
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) FROM zhiban_reminder.confirmations WHERE delivery_id=$1',
          [first.id],
        )
      ).rows[0].count,
    ),
    1,
  );
  assert.equal((await read(teacher, c.id)).rows[0].confirmed_at, String(a.confirmedAt));
  // Delivery and its durable receipt are atomic even when the final receipt INSERT is denied.
  await admin.query('REVOKE INSERT ON zhiban_reminder.commands FROM zhiban_academic_runtime');
  try {
    assert.equal((await http(url, teacher, command)).status, 503);
  } finally {
    await admin.query('GRANT INSERT ON zhiban_reminder.commands TO zhiban_academic_runtime');
  }
  assert.equal((await read(student)).rows.length, 1);
  assert.equal(await loadReminder(businessPool), true);
  for (const table of ['deliveries', 'confirmations', 'commands']) {
    const acl = (
      await admin.query(
        "SELECT has_table_privilege('zhiban_academic_runtime',$1,'UPDATE') AS u,has_table_privilege('zhiban_academic_runtime',$1,'DELETE') AS d",
        ['zhiban_reminder.' + table],
      )
    ).rows[0];
    assert.deepEqual(acl, { u: false, d: false });
  }
  const raw = await businessPool.connect();
  try {
    await raw.query('BEGIN');
    await raw.query("SELECT set_config('app.tenant_id',$1,true)", [v7()]);
    assert.equal((await raw.query('SELECT id FROM zhiban_reminder.deliveries')).rows.length, 0);
  } finally {
    await raw.query('ROLLBACK');
    raw.release();
  }
  // Browser journey uses the actual role cookies and explicit public form, never a private-note copy.
  const context = async (a: typeof teacher) => {
    const ctx = await browser.newContext();
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
    return ctx;
  };
  const tc = await context(teacher),
    sc = await context(student),
    tp = await tc.newPage(),
    sp = await sc.newPage();
  await tp.goto(
    `${origin}/zhiban/teacher/courses/${trial.courseId}/analytics?space=${t}&offering=${o}#followups`,
  );
  await tp.getByLabel('搜索待跟进学生或活动', { exact: true }).fill('提醒课堂：');
  await tp.getByRole('button', { name: '查询待跟进名单', exact: true }).click();
  // Two students have cases; choose the case matching the target student through its visible card.
  const target = tp.getByRole('row').filter({ hasText: '陈同学' });
  await target.getByRole('button', { name: '查看进行中跟进', exact: true }).click();
  await expect(tp.getByRole('heading', { name: '学生可见提醒与回执', exact: true })).toBeVisible();
  await tp.getByLabel('学生可见提醒标题', { exact: true }).fill('课堂提醒：准备观察记录');
  await tp
    .getByLabel('学生可见提醒正文', { exact: true })
    .fill('请阅读活动要求并准备观察记录，看到后点击我已知悉。');
  let dropped = false;
  await tp.route('**/api/zhiban/reminders/**', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      // Forward the exact browser command via the harness's pinned-CA HTTPS client.
      // Playwright route.fetch has a separate Node trust store from Chromium.
      const headers = route.request().headers();
      const committed = await http(
        new URL(route.request().url()).pathname,
        teacher,
        route.request().postDataJSON(),
        'POST',
        {
          'x-zhiban-command': headers['x-zhiban-command'],
          'x-zhiban-csrf': headers['x-zhiban-csrf'],
        },
      );
      assert.equal(committed.status, 200);
      await route.abort('failed');
    } else await route.continue();
  });
  await tp.getByRole('button', { name: '发送站内提醒', exact: true }).click();
  await expect(tp.getByRole('button', { name: '重试同一条提醒', exact: true })).toBeEnabled();
  await expect(tp.getByLabel('学生可见提醒正文', { exact: true })).toBeDisabled();
  await tp.getByRole('button', { name: '重试同一条提醒', exact: true }).click();

  await expect(tp.getByText('已送达学生站内，等待学生确认。', { exact: true })).toBeVisible();
  await sp.goto(`${origin}/zhiban/student/courses/${trial.courseId}?space=${t}&offering=${o}`);
  await sp.getByRole('link', { name: '站内提醒', exact: true }).click();
  await expect(
    sp.getByRole('heading', { name: '课堂提醒：准备观察记录', exact: true }),
  ).toBeVisible();
  await expect(sp.getByText('PRIVATE_NOTE_DO_NOT_DELIVER', { exact: true })).toHaveCount(0);
  await sp.screenshot({ path: 'docs/v2/evidence/reminders/student-pending.png' });
  await sp.getByRole('button', { name: '我已知悉', exact: true }).click();
  await expect(sp.getByText('已记录确认回执。', { exact: true })).toBeVisible();
  await tp.getByRole('button', { name: '刷新提醒与回执', exact: true }).click();
  await expect(tp.getByText('学生已确认 ·', { exact: false })).toHaveCount(2);
  await tp.screenshot({ path: 'docs/v2/evidence/reminders/teacher-receipts.png' });
  await sc.close();
  await tc.close();
  // SEND-first: pause only the business write after recipient Identity locks are held.
  const gate = await admin.connect(),
    revoke = await admin.connect();
  let sendFirst: ReturnType<typeof http> | undefined, revokePending: Promise<unknown> | undefined;
  try {
    await gate.query('BEGIN');
    await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `reminder-case:${t}:${c.id}`,
    ]);
    sendFirst = http(url, teacher, command);
    const until = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < until) {
      blocked = (
        await admin.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='zhiban_academic_runtime' AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock%') AS yes",
        )
      ).rows[0].yes;
      if (blocked) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(blocked, true, 'SEND must be paused after recipient locks');
    await revoke.query('BEGIN');
    const pid = (await revoke.query('SELECT pg_backend_pid() AS id')).rows[0].id;
    revokePending = revoke.query(
      "UPDATE zhiban_identity.memberships SET status='DISABLED',authorization_version=authorization_version+1,repository_revision=repository_revision+1,updated_at=$2,disabled_at=$2,disabled_reason='LOCAL SEND-first fixture' WHERE membership_id=$1",
      [student.member, Date.now()],
    );
    let revokeBlocked = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      revokeBlocked = (
        await admin.query(
          "SELECT wait_event_type='Lock' AS yes FROM pg_stat_activity WHERE pid=$1",
          [pid],
        )
      ).rows[0]?.yes;
      if (revokeBlocked) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(revokeBlocked, true, 'recipient revocation must wait until business commit');
    await gate.query('COMMIT');
    assert.equal((await sendFirst).status, 200);
    await revokePending;
    await revoke.query('COMMIT');
  } finally {
    await gate.query('ROLLBACK');
    await revoke.query('ROLLBACK');
    gate.release();
    revoke.release();
  }
  assert.equal((await http(url, teacher, command)).status, 403);
  await admin.query(
    "UPDATE zhiban_identity.memberships SET status='ACTIVE',authorization_version=authorization_version+1,repository_revision=repository_revision+1,updated_at=$2,disabled_at=NULL,disabled_reason=NULL WHERE membership_id=$1",
    [student.member, Date.now()],
  );
  const third = (await read(student)).rows[0];
  await ok(url, student, { type: 'CONFIRM_REMINDER', id: third.id });
  // Recipient role removal wins before SEND. Still enrolled but no STUDENT/SELF grant.
  await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1', [
    peer.grant,
    Date.now(),
  ]);
  assert.equal(
    (await http(url, teacher, { ...command, caseId: pc.id, revision: pc.revision })).status,
    403,
  );
  // Recipient membership status race: HOLD UPDATE before request; guard must wait, then reject.
  const lock = await admin.connect();
  let waiting: ReturnType<typeof http> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query(
      'SELECT membership_id FROM zhiban_identity.memberships WHERE membership_id=$1 FOR UPDATE',
      [student.member],
    );
    waiting = http(url, teacher, command);
    const until = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < until) {
      blocked = (
        await admin.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%bridge_identity_context(%') AS yes",
        )
      ).rows[0].yes;
      if (blocked) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(blocked, true);
    await lock.query(
      "UPDATE zhiban_identity.memberships SET status='DISABLED',authorization_version=authorization_version+1,repository_revision=repository_revision+1,updated_at=$2,disabled_at=$2,disabled_reason='LOCAL negative fixture' WHERE membership_id=$1",
      [student.member, Date.now()],
    );
    await lock.query('COMMIT');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  assert.equal((await waiting!).status, 403);
  assert.notEqual((await http(url, student)).status, 200);
  await admin.query(
    "UPDATE zhiban_identity.memberships SET status='ACTIVE',authorization_version=authorization_version+1,repository_revision=repository_revision+1,updated_at=$2,disabled_at=NULL,disabled_reason=NULL WHERE membership_id=$1",
    [student.member, Date.now()],
  );
  // Withdraw revokes inbox/ACK and even previously successful SEND replay.
  const enrollment = (
    await admin.query(
      "SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [t, o, student.member],
    )
  ).rows[0];
  await ok(`/api/zhiban/management/${t}/commands`, manager, {
    type: 'WITHDRAW',
    id: enrollment.id,
    revision: enrollment.revision,
  });
  assert.equal((await http(url, student)).status, 403);
  assert.equal((await http(url, student, ack)).status, 403);
  assert.equal(
    (await http(url, teacher, command, 'POST', { 'x-zhiban-command': key })).status,
    403,
  );
  assert.equal(
    (await read(teacher, c.id)).rows.length,
    3,
    'teacher historical receipts remain available',
  );
  await writeFile(
    'docs/v2/evidence/reminders/journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        sameKeySingleDelivery: true,
        differentKeyPendingSuppressed: true,
        explicitAckUnique: true,
        publicBodySeparateFromPrivateNotes: true,
        recipientRoleRequired: true,
        recipientRevocationRace: 'REVOKE_FIRST_DENIED_AND_SEND_FIRST_GUARDED',
        withdrawDeniesReadAckAndReplay: true,
        receiptFailureRollsBackDelivery: true,
        immutableAcl: true,
        tenantRls: true,
        browserJourney: 'TEACHER_SEND_STUDENT_CONFIRM_TEACHER_RECEIPT',
        lostCommitResponseRetrySameDelivery: true,
        externalDelivery: false,
      },
      null,
      2,
    ) + '\n',
  );
  record('PASS in-app reminder delivery, explicit confirmation, recipient locks and dedup');
}
