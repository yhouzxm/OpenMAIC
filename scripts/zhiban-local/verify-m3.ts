import assert from 'node:assert/strict';
import { request } from 'node:https';
import { randomUUID, X509Certificate } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import {
  directory,
  database,
  pgPort,
  origin,
  privateFile,
  trustedDevelopmentCa,
  digest,
} from './config';
import { learningPolicy } from '@/lib/zhiban/domain/learning/model';
type Row = Record<string, unknown> & {
  id: string;
  revision: string;
  code: string;
  prompt: string;
  draft: string;
  status: string;
  membership_id: string;
  offering_id: string;
  attempt_id: string;
  deadline_at: number | null;
  submissionId: string;
  csrfToken: string;
  error: { code: string };
  activities: Row[];
  attempts: Row[];
  submissions: Row[];
  courses: Row[];
  terms: Row[];
  offerings: Row[];
  assignments: Row[];
  enrollments: Row[];
}; // Test DTO shape; assertions check behavior and never supply authorization facts.
type Account = {
  userId: string;
  password: string;
  label: string;
  tenantId: string;
  membershipId: string;
};
type Session = { account: Account; cookie: string; csrf: string };
async function main() {
  const ca = await trustedDevelopmentCa();
  const { accounts } = JSON.parse((await privateFile('accounts.json')).toString()) as {
    accounts: Account[];
  };
  const passed: string[] = [];
  const record = (name: string) => {
    passed.push(name);
    console.log(`PASS ${name}`);
  };
  const http = (
    path: string,
    session?: Session,
    command?: unknown,
    key = randomUUID().replaceAll('-', ''),
    extra: Record<string, string> = {},
  ) =>
    new Promise<{ status: number; data: Row; cookie?: string }>((done, reject) => {
      const r = request(
        origin + path,
        {
          ca,
          servername: '',
          method: command ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(session ? { Cookie: session.cookie } : {}),
            ...(command
              ? {
                  Origin: origin,
                  'Content-Type': 'application/json',
                  'x-zhiban-command': key,
                  ...(session ? { 'x-zhiban-csrf': session.csrf } : {}),
                }
              : {}),
            ...extra,
          },
        },
        (response) => {
          const parts: Buffer[] = [];
          response.on('data', (b) => parts.push(b));
          response.on('end', () => {
            try {
              const raw = Buffer.concat(parts).toString();
              done({
                status: response.statusCode!,
                data: raw ? JSON.parse(raw) : null,
                cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      r.on('error', reject);
      r.setTimeout(10000, () => r.destroy(new Error('HTTPS timeout')));
      r.end(command ? JSON.stringify(command) : undefined);
    });
  const login = async (label: string) => {
    const account = accounts.find((a) => a.label === label)!;
    assert.ok(account);
    const result = await http('/api/zhiban/identity/login', undefined, {
      userId: account.userId,
      password: account.password,
    });
    assert.equal(result.status, 200);
    const s = { account, cookie: result.cookie!, csrf: '' };
    s.csrf = (await http('/api/zhiban/identity/csrf', s)).data.csrfToken;
    return s;
  };
  const teacher = await login('任教教师'),
    student = await login('学生甲'),
    studentB = await login('学生乙');
  let offeringId: string;
  const path = () => `/api/zhiban/learning/${teacher.account.tenantId}/offerings/${offeringId}`;
  const read = async (s = teacher) => {
    const r = await http(path(), s);
    assert.equal(r.status, 200, r.data?.error?.code);
    return r.data;
  };
  const command = async (s: Session, value: unknown, status = 200, key?: string) => {
    const r = await http(path(), s, value, key);
    assert.equal(r.status, status, r.data?.error?.code);
    return r.data;
  };
  if (process.argv.includes('--persistence')) {
    const previous = JSON.parse((await privateFile('m3-verification.json')).toString());
    offeringId = previous.offeringId;
    const t = await read(),
      s = await read(student);
    assert.ok(t.activities.some((a: Row) => a.id === previous.activityId));
    assert.ok(s.submissions.some((x: Row) => x.id === previous.submissionId));
    record('restart preserves exact published activity and final submission');
    await writeFile(
      join(directory, 'm3-persistence.json'),
      JSON.stringify(
        {
          mode: 'LOCAL',
          at: new Date().toISOString(),
          passed,
          verificationHash: digest((await privateFile('m3-verification.json')).toString()),
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    return;
  }
  const admin = await login('本地教务管理员'),
    unassigned = await login('非任教教师'),
    other = await login('其他空间管理员');
  const academicPath = `/api/zhiban/academic/${admin.account.tenantId}`;
  const academic = async (value: unknown) => {
    const r = await http(academicPath, admin, value);
    assert.equal(r.status, 200, r.data?.error?.code);
    return r.data;
  };
  const suffix = Date.now().toString(36);
  let state = await academic({
    type: 'CREATE_TERM',
    code: `M3T-${suffix}`,
    name: 'M3 验证学期',
    startsOn: '2026-10-01',
    endsOn: '2027-07-01',
  });
  const term = state.terms.find((x: Row) => x.code === `M3T-${suffix}`)!;
  state = await academic({
    type: 'CREATE_COURSE',
    code: `M3C-${suffix}`,
    name: 'M3 学习活动验证课程',
    description: '本地合成课程，用于教师活动发布与学生提交。',
    ownerMembershipId: teacher.account.membershipId,
  });
  let course = state.courses.find((x: Row) => x.code === `M3C-${suffix}`)!;
  state = await academic({ type: 'PUBLISH_COURSE', id: course.id, revision: course.revision });
  course = state.courses.find((x: Row) => x.id === course.id)!;
  state = await academic({
    type: 'CREATE_OFFERING',
    courseId: course.id,
    termId: term.id,
    classId: null,
    code: `M3O-${suffix}`,
    name: `M3 活动与提交教学班 ${suffix}`,
    capacity: 10,
  });
  offeringId = state.offerings.find((x: Row) => x.code === `M3O-${suffix}`)!.id;
  state = await academic({
    type: 'ASSIGN_TEACHER',
    offeringId,
    membershipId: teacher.account.membershipId,
    revision: null,
  });
  for (const s of [student, studentB])
    state = await academic({
      type: 'ENROLL',
      offeringId,
      membershipId: s.account.membershipId,
      revision: null,
    });
  record('real Course version, Offering, TeachingAssignment and Enrollment fixture');
  for (const s of [unassigned, admin, other]) assert.equal((await http(path(), s)).status, 403);
  assert.equal((await http(path())).status, 401);
  record('unassigned teacher, tenant admin, other tenant and unauthenticated access denied');
  const definition = {
    title: '解释你的方案',
    prompt: '请用文字说明方案。\n保留假设、依据和局限。',
    deadlineAt: null,
    allowResubmit: false,
    maxAttempts: 1,
  };
  const created = await command(teacher, { type: 'CREATE_ACTIVITY', ...definition });
  const activityId = created.id;
  assert.equal((await read(student)).activities.length, 0);
  await command(student, { type: 'START_ATTEMPT', id: activityId }, 409);
  await command(student, { type: 'CREATE_ACTIVITY', ...definition }, 403);
  record('draft never exposed to learner; student cannot author');
  await command(teacher, { type: 'PUBLISH_ACTIVITY', id: activityId, revision: created.revision });
  assert.equal((await read(student)).activities[0].prompt, definition.prompt);
  record('immutable published text activity visible through active Enrollment');
  const startKey = randomUUID().replaceAll('-', '');
  const startCommand = { type: 'START_ATTEMPT', id: activityId };
  const first = await command(student, startCommand, 200, startKey);
  assert.deepEqual(await command(student, startCommand, 200, startKey), first);
  assert.equal((await command(student, startCommand)).id, first.id);
  assert.equal((await read(student)).attempts.length, 1);
  record('START replay/resume does not consume a second attempt');
  await command(
    studentB,
    { type: 'SUBMIT', id: first.id, revision: first.revision, answer: 'forged' },
    403,
  );
  await command(teacher, startCommand, 403);
  await command(student, { ...startCommand, enrolled: true }, 400);
  assert.equal(
    (
      await http(
        path(),
        student,
        { type: 'SUBMIT', id: first.id, revision: first.revision, answer: 'x' },
        undefined,
        { 'x-zhiban-csrf': '' },
      )
    ).status,
    403,
  );
  record('cross-student attempt, teacher learner command, DTO authority and missing CSRF denied');
  const saved = await command(student, {
    type: 'SAVE_DRAFT',
    id: first.id,
    revision: first.revision,
    answer: '草稿：方案 A\n用传感器验证。',
  });
  assert.equal((await read(student)).attempts[0].draft, '草稿：方案 A\n用传感器验证。');
  assert.equal((await read()).attempts[0].draft, null);
  record('multiline learner draft persists privately without completing learning');
  const submissions = await Promise.all([
    http(path(), student, {
      type: 'SUBMIT',
      id: first.id,
      revision: saved.revision,
      answer: '最终方案 A',
    }),
    http(path(), student, {
      type: 'SUBMIT',
      id: first.id,
      revision: saved.revision,
      answer: '竞争方案 B',
    }),
  ]);
  assert.deepEqual(submissions.map((x) => x.status).sort(), [200, 409]);
  let view = await read(student);
  assert.equal(view.submissions.length, 1);
  assert.equal(view.attempts[0].status, 'SUBMITTED');
  const final = view.attempts[0];
  await command(
    student,
    { type: 'SUBMIT', id: first.id, revision: final.revision, answer: '非法重交' },
    409,
  );
  const limit = await command(student, startCommand, 409);
  assert.equal(limit.error.code, 'ATTEMPT_LIMIT');
  record('concurrent submit writes exactly one version; no-resubmit and attempt cap enforced');
  assert.equal((await read(studentB)).attempts.length, 0);
  assert.equal((await read(studentB)).submissions.length, 0);
  assert.equal((await read()).submissions.length, 1);
  record('teacher can review submissions; student cannot see peer work');
  let activity = (await read()).activities.find((x: Row) => x.id === activityId)!;
  const edited = await command(teacher, {
    type: 'EDIT_ACTIVITY',
    id: activityId,
    revision: activity.revision,
    ...definition,
    prompt: '新版要求：提出第二种方案。',
    allowResubmit: true,
    maxAttempts: 3,
  });
  assert.equal((await read(student)).activities[0].prompt, definition.prompt);
  record('editing published definition changes only teacher draft');
  await command(teacher, { type: 'PUBLISH_ACTIVITY', id: activityId, revision: edited.revision });
  view = await read(student);
  assert.equal(view.activities[0].prompt, '新版要求：提出第二种方案。');
  assert.equal(view.attempts[0].prompt, definition.prompt);
  await command(
    student,
    { type: 'SUBMIT', id: first.id, revision: final.revision, answer: '旧版本非法重交' },
    409,
  );
  record('republish pins old attempt prompt and no-resubmit rules');
  const second = await command(student, startCommand);
  assert.equal((await read(student)).attempts.length, 2);
  let secondSubmit = await command(student, {
    type: 'SUBMIT',
    id: second.id,
    revision: second.revision,
    answer: '新版方案一',
  });
  const resubmitKey = randomUUID().replaceAll('-', '');
  const resubmit = {
    type: 'SUBMIT',
    id: second.id,
    revision: secondSubmit.revision,
    answer: '新版方案二\n保留版本。',
  };
  secondSubmit = await command(student, resubmit, 200, resubmitKey);
  assert.deepEqual(await command(student, resubmit, 200, resubmitKey), secondSubmit);
  await command(student, { ...resubmit, answer: '不同 payload' }, 409, resubmitKey);
  view = await read(student);
  assert.equal(view.attempts.length, 2);
  assert.equal(view.submissions.filter((x: Row) => x.attempt_id === second.id).length, 2);
  record(
    'resubmission appends versions; replay is stable; changed payload conflicts without extra attempt',
  );
  const third = await command(student, startCommand);
  await command(
    student,
    { type: 'SAVE_DRAFT', id: second.id, revision: secondSubmit.revision, answer: '修改旧尝试' },
    409,
  );
  await command(student, {
    type: 'SUBMIT',
    id: third.id,
    revision: third.revision,
    answer: '第三次方案',
  });
  assert.equal((await command(student, startCommand, 409)).error.code, 'ATTEMPT_LIMIT');
  record('only latest attempt writable; cap counts all published versions');
  let deadlineDraft = await command(teacher, {
    type: 'CREATE_ACTIVITY',
    ...definition,
    title: '截止规则验证',
    deadlineAt: Date.now() + 3500,
    maxAttempts: null,
    allowResubmit: true,
  });
  await command(teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: deadlineDraft.id,
    revision: deadlineDraft.revision,
  });
  const timed = await command(student, { type: 'START_ATTEMPT', id: deadlineDraft.id });
  const cutoff = (await read()).activities.find((a: Row) => a.id === deadlineDraft.id)!.deadline_at;
  await new Promise((r) => setTimeout(r, Math.max(0, Number(cutoff) - Date.now() + 50)));
  assert.equal(
    (
      await command(
        student,
        { type: 'SUBMIT', id: timed.id, revision: timed.revision, answer: '超期' },
        409,
      )
    ).error.code,
    'DEADLINE_PASSED',
  );
  assert.equal(
    (await command(studentB, { type: 'START_ATTEMPT', id: deadlineDraft.id }, 409)).error.code,
    'DEADLINE_PASSED',
  );
  record('server deadline blocks both new attempts and submission; client clock is irrelevant');
  deadlineDraft = await command(teacher, {
    type: 'CREATE_ACTIVITY',
    ...definition,
    title: '过期活动不发布',
    deadlineAt: Date.now() - 1000,
  });
  await command(
    teacher,
    { type: 'PUBLISH_ACTIVITY', id: deadlineDraft.id, revision: deadlineDraft.revision },
    409,
  );
  assert.ok(!(await read(student)).activities.some((a: Row) => a.id === deadlineDraft.id));
  record('expired publication rolls back without exposing draft');
  activity = (await read()).activities.find((x: Row) => x.id === activityId)!;
  await command(teacher, {
    type: 'WITHDRAW_ACTIVITY',
    id: activityId,
    revision: activity.revision,
  });
  await command(studentB, startCommand, 409);
  assert.equal((await read(student)).submissions.length, 4);
  record('withdrawal closes writes and preserves pinned work/history');
  state = (await http(academicPath, admin)).data;
  let enrollment = state.enrollments.find(
    (e: Row) => e.offering_id === offeringId && e.membership_id === student.account.membershipId,
  )!;
  state = await academic({ type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision });
  assert.equal((await http(path(), student)).status, 403);
  await command(
    student,
    { type: 'SAVE_DRAFT', id: timed.id, revision: timed.revision, answer: '撤权' },
    403,
  );
  enrollment = state.enrollments.find((e: Row) => e.id === enrollment.id)!;
  await academic({
    type: 'ENROLL',
    offeringId,
    membershipId: student.account.membershipId,
    revision: enrollment.revision,
  });
  record('committed enrollment withdrawal denies next read/write');
  state = (await http(academicPath, admin)).data;
  let assignment = state.assignments.find(
    (a: Row) => a.offering_id === offeringId && a.membership_id === teacher.account.membershipId,
  )!;
  state = await academic({ type: 'END_TEACHER', id: assignment.id, revision: assignment.revision });
  assert.equal((await http(path(), teacher)).status, 403);
  await command(teacher, { type: 'CREATE_ACTIVITY', ...definition }, 403);
  assignment = state.assignments.find((a: Row) => a.id === assignment.id)!;
  await academic({
    type: 'ASSIGN_TEACHER',
    offeringId,
    membershipId: teacher.account.membershipId,
    revision: assignment.revision,
  });
  record('committed teaching assignment removal denies next read/write');
  activity = (await read()).activities.find((x: Row) => x.id === activityId)!;
  await command(teacher, { type: 'PUBLISH_ACTIVITY', id: activityId, revision: activity.revision }); // Leave a usable local journey.
  const academicConfig = JSON.parse((await privateFile('academic.json')).toString());
  const pool = new Pool({ connectionString: academicConfig.academic, max: 1 });
  try {
    const db = (
      await pool.query(
        "SELECT current_database() AS database,current_setting('server_version_num')::integer AS version",
      )
    ).rows[0];
    assert.equal(db.database, database);
    assert.ok(db.version >= 160000 && db.version < 170000);
    assert.equal((await pool.query('SELECT * FROM zhiban_learning.activities')).rows.length, 0);
    record('PG16 runtime without tenant context sees no rows');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [other.account.tenantId]);
      assert.equal((await client.query('SELECT * FROM zhiban_learning.attempts')).rows.length, 0);
      await client.query('ROLLBACK');
      for (const sql of [
        "UPDATE zhiban_learning.activity_versions SET prompt='forged'",
        "UPDATE zhiban_learning.submissions SET answer='forged'",
        'DELETE FROM zhiban_learning.events',
      ]) {
        await assert.rejects(
          client.query(sql),
          (error: Error & { code?: string }) => error.code === '42501',
        );
      }
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.account.tenantId]);
      await assert.rejects(
        client.query(
          "INSERT INTO zhiban_learning.activities(tenant_id,id,offering_id,title,prompt,status,allow_resubmit,created_at,updated_at) VALUES($1,$2,$3,'x','x','DRAFT',false,1,1)",
          [other.account.tenantId, v7(), offeringId],
        ),
        (error: Error & { code?: string }) => error.code === '42501',
      );
      await client.query('ROLLBACK');
      record(
        'tenant RLS rejects cross-tenant insert; versions/submissions/events remain append-only',
      );
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.account.tenantId]);
      await assert.rejects(
        client.query(
          "INSERT INTO zhiban_learning.attempts(tenant_id,id,offering_id,activity_id,activity_version,enrollment_id,membership_id,attempt_no,status,started_at,updated_at) VALUES($1,$2,$3,$4,1,$5,$6,1,'IN_PROGRESS',1,1)",
          [
            teacher.account.tenantId,
            v7(),
            offeringId,
            activityId,
            enrollment.id,
            studentB.account.membershipId,
          ],
        ),
        (error: Error & { code?: string }) => error.code === '23503',
      );
      await client.query('ROLLBACK');
      record('composite enrollment FK rejects learner substitution');
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.account.tenantId]);
      const rows = (
        await client.query(
          'SELECT count(*)::integer AS count FROM zhiban_learning.events WHERE attempt_id=$1 AND event_type=$2',
          [first.id, 'SUBMISSION_RECORDED'],
        )
      ).rows;
      assert.equal(rows[0].count, 1);
      const audit = (
        await client.query(
          "SELECT facts FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type LIKE 'LEARNING_%'",
          [teacher.account.tenantId],
        )
      ).rows;
      assert.ok(audit.every((r) => !JSON.stringify(r.facts).includes('方案')));
      await client.query('ROLLBACK');
      record('exactly one trusted submit event; audit excludes prompt/learner text');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  } finally {
    await pool.end();
  }
  const certificate = new X509Certificate(await privateFile('localhost.crt'));
  const { createHash } = await import('node:crypto');
  const spki = createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
  const browser = await chromium.launch({
    args: [`--ignore-certificate-errors-spki-list=${spki}`],
  });
  const browserTitle = `浏览器配置与提交 ${suffix}`;
  try {
    for (const [session, label] of [
      [teacher, 'teacher'],
      [student, 'student'],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${origin}/zhiban`);
      await page.getByLabel('账号 ID').fill(session.account.userId);
      await page.getByLabel('密码', { exact: true }).fill(session.account.password);
      await page.getByRole('button', { name: '登录并进入' }).click();
      await page.getByRole('button').filter({ hasText: '本地学习空间' }).click();
      const card = page.locator('.academic-card').filter({
        has: page.getByRole('heading', { name: `M3 活动与提交教学班 ${suffix}`, exact: true }),
      });
      await card.locator('.learning-section > summary').click();
      await expect(
        card.getByRole('heading', { name: '学习活动与提交', exact: true }),
      ).toBeVisible();
      await expect(
        card.getByRole('heading', { name: definition.title, exact: true }),
      ).toBeVisible();
      if (label === 'teacher') {
        await expect(card.getByText('新建文字活动', { exact: true })).toBeVisible();
        await card
          .locator('.learning-attempt')
          .filter({ hasText: '尝试 2' })
          .locator('summary')
          .click();
        await expect(
          card.locator('.learning-attempt').getByText('新版方案二\n保留版本。', { exact: true }),
        ).toBeVisible();
        const create = card.locator('.academic-form').filter({ hasText: '新建文字活动' });
        await create.locator('summary').click();
        await create.getByLabel('活动标题').fill(browserTitle);
        await create.getByLabel('活动要求').fill('通过页面说明方案，并重交一次修订。');
        const tomorrow = new Date(Date.now() + 86400000);
        const localDeadline = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        await create.getByLabel('截止时间（本机时区，可不设）').fill(localDeadline);
        await create.getByLabel('允许重交').selectOption('true');
        await create.getByLabel('最多尝试次数（留空表示不限）').fill('2');
        await create.getByRole('button', { name: '保存草稿', exact: true }).click();
        const uiActivity = card
          .locator('.learning-activity')
          .filter({ has: page.getByRole('heading', { name: browserTitle, exact: true }) });
        await uiActivity.getByRole('button', { name: '发布新版本', exact: true }).click();
        await expect(
          uiActivity.getByRole('button', { name: '撤回活动', exact: true }),
        ).toBeVisible();
        const published = (await read()).activities.find((a) => a.title === browserTitle)!;
        assert.equal(published.allow_resubmit, true);
        assert.equal(published.max_attempts, 2);
        assert.equal(Number(published.deadline_at), new Date(localDeadline).getTime());
        record('teacher page saves explicit deadline/resubmit/cap and publishes a real activity');
      } else {
        await expect(card.getByText('新建文字活动', { exact: true })).toHaveCount(0);
        await expect(
          card.getByRole('button', { name: '确认开始新尝试', includeHidden: true }).first(),
        ).toBeDisabled();
        const uiActivity = card
          .locator('.learning-activity')
          .filter({ has: page.getByRole('heading', { name: browserTitle, exact: true }) });
        await uiActivity.getByText('开始首次尝试', { exact: true }).click();
        await uiActivity.getByRole('button', { name: '确认开始新尝试', exact: true }).click();
        const answer = uiActivity.getByLabel('尝试 1 作答');
        await answer.fill('页面输入的未保存方案');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect(answer).toHaveValue('页面输入的未保存方案');
        await uiActivity.getByRole('button', { name: '保存作答草稿', exact: true }).click();
        await expect(answer).toHaveValue('页面输入的未保存方案');
        await uiActivity.getByRole('button', { name: '最终提交', exact: true }).click();
        await expect(
          uiActivity.getByRole('button', { name: '提交新版本', exact: true }),
        ).toBeVisible();
        await answer.fill('页面重交的修订方案');
        await uiActivity.getByRole('button', { name: '提交新版本', exact: true }).click();
        await expect(uiActivity.getByText('页面重交的修订方案', { exact: true })).toBeVisible();
        const current = await read(student);
        const published = current.activities.find((a) => a.title === browserTitle)!;
        const ownAttempts = current.attempts.filter((a) => a.activity_id === published.id);
        assert.equal(ownAttempts.length, 1);
        assert.equal(
          current.submissions.filter((s) => s.attempt_id === ownAttempts[0].id).length,
          2,
        );
        record(
          'student page starts, preserves unsaved input, saves, submits and resubmits without extra attempt',
        );
      }
      await page.reload();
      await card.locator('.learning-section > summary').click();
      await expect(
        card.getByRole('heading', { name: definition.title, exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
      await page.screenshot({ path: join(directory, `m3-${label}.png`), fullPage: true });
      await card
        .locator('.learning-activity')
        .filter({ has: page.getByRole('heading', { name: browserTitle, exact: true }) })
        .screenshot({ path: join(directory, `m3-${label}-activity.png`) });
      await context.close();
      record(
        `${label} browser activity/history, refresh, mobile layout and no client secret storage`,
      );
    }
  } finally {
    await browser.close();
  }
  const sources = [
    'lib/zhiban/domain/learning/model.ts',
    'lib/zhiban/application/learning/service.ts',
    'lib/zhiban/infrastructure/learning/http.ts',
    'lib/zhiban/infrastructure/learning/postgres/transaction.ts',
    'lib/zhiban/infrastructure/learning/postgres/migrations/0001_learning.sql',
    'lib/zhiban/infrastructure/academic/postgres/store.ts',
    'lib/zhiban/application/academic/service.ts',
    'lib/zhiban/domain/academic/model.ts',
    'scripts/zhiban-local/learning.ts',
    'scripts/zhiban-local/setup-m3.ts',
    'scripts/zhiban-local/academic.ts',
    'scripts/zhiban-local/server.ts',
    'scripts/zhiban-local/verify-m3.ts',
    'app/zhiban/local/client.js',
    'app/zhiban/local/learning.js',
    'app/zhiban/local/academic.js',
    'app/zhiban/local/index.html',
    'app/zhiban/local/style.css',
  ];
  const hashes = Object.fromEntries(
    await Promise.all(sources.map(async (f) => [f, digest(await readFile(f, 'utf8'))])),
  );
  await writeFile(
    join(directory, 'm3-verification.json'),
    JSON.stringify(
      {
        mode: 'LOCAL',
        at: new Date().toISOString(),
        head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        worktree: 'UNCOMMITTED_CANDIDATE',
        environment: {
          node: process.version,
          pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
          database,
          pgPort,
        },
        scope:
          'M3 TEXT_RESPONSE/API/PG16/isolated browser only; no Runtime, grading, production or CI signoff',
        policy: learningPolicy,
        hashes,
        passed,
        offeringId,
        activityId,
        submissionId: secondSubmit.submissionId,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    `LOCAL M3 ${passed.length}/${passed.length} PASS; private evidence m3-verification.json`,
  );
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'M3 verification failed');
  process.exitCode = 1;
});
