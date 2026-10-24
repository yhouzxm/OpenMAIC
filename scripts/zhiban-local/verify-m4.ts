import assert from 'node:assert/strict';
import { request } from 'node:https';
import { randomUUID, X509Certificate } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import { directory, origin, privateFile, trustedDevelopmentCa, digest } from './config';
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
  grades: Row[];
  publications: Row[];
  score_points: number;
  latest_submission: boolean;
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
  const path = () => `/api/zhiban/assessment/${teacher.account.tenantId}/offerings/${offeringId}`;
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
    const receipt = JSON.parse((await privateFile('m4-verification.json')).toString());
    offeringId = receipt.offeringId;
    const state = await read(student);
    assert.ok(state.publications.some((p) => p.id === receipt.publicationId));
    assert.equal(state.grades.length, 0);
    record('published exact-source history survives server restart');
    await writeFile(
      join(directory, 'm4-persistence.json'),
      JSON.stringify({
        mode: 'LOCAL',
        passed,
        verificationHash: digest((await privateFile('m4-verification.json')).toString()),
      }),
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
    code: `M4T-${suffix}`,
    name: 'M4 验证学期',
    startsOn: '2026-10-01',
    endsOn: '2027-07-01',
  });
  const term = state.terms.find((x: Row) => x.code === `M4T-${suffix}`)!;
  state = await academic({
    type: 'CREATE_COURSE',
    code: `M4C-${suffix}`,
    name: 'M4 学习活动验证课程',
    description: '本地合成课程，用于教师活动发布与学生提交。',
    ownerMembershipId: teacher.account.membershipId,
  });
  let course = state.courses.find((x: Row) => x.code === `M4C-${suffix}`)!;
  state = await academic({ type: 'PUBLISH_COURSE', id: course.id, revision: course.revision });
  course = state.courses.find((x: Row) => x.id === course.id)!;
  state = await academic({
    type: 'CREATE_OFFERING',
    courseId: course.id,
    termId: term.id,
    classId: null,
    code: `M4O-${suffix}`,
    name: `M4 活动与提交教学班 ${suffix}`,
    capacity: 10,
  });
  offeringId = state.offerings.find((x: Row) => x.code === `M4O-${suffix}`)!.id;
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
  record('real teaching assignment, enrollment and local fixture');
  const learningPath = `/api/zhiban/learning/${teacher.account.tenantId}/offerings/${offeringId}`;
  const learn = async (s: Session, c?: unknown) => {
    const r = await http(learningPath, s, c);
    assert.equal(r.status, 200, r.data?.error?.code);
    return r.data;
  };
  const activity = await learn(teacher, {
    type: 'CREATE_ACTIVITY',
    title: 'M4评分验证',
    prompt: '说明方案',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: null,
  });
  await learn(teacher, { type: 'PUBLISH_ACTIVITY', id: activity.id, revision: activity.revision });
  let attempt = await learn(student, { type: 'START_ATTEMPT', id: activity.id });
  const submitted = await learn(student, {
    type: 'SUBMIT',
    id: attempt.id,
    revision: attempt.revision,
    answer: '学生方案版本一',
  });
  const submissionId = submitted.submissionId;
  const draft = {
    type: 'SAVE_GRADE',
    submissionId,
    revision: null,
    score: '85.25',
    maxScore: '100',
    feedback: '仅任教教师可见的评分草稿',
  };
  for (const s of [unassigned, admin, other, student]) await command(s, draft, 403);
  assert.equal((await http(path())).status, 401);
  record('student, unassigned teacher, admin, other tenant and anonymous grading denied');
  assert.equal(
    (await http(path(), teacher, draft, undefined, { 'x-zhiban-csrf': '' })).status,
    403,
  );
  record('missing CSRF denied');
  for (const invalid of [
    { score: '1.001' },
    { score: '101' },
    { maxScore: '0' },
    { score: 85 },
    { score: '1e2' },
    { authority: true },
  ])
    await command(teacher, { ...draft, ...invalid }, 400);
  assert.equal((await read()).grades.length, 0);
  record('precision, bounds, types and forged authority rejected without partial grade');
  const key = randomUUID().replaceAll('-', '');
  let grade = await command(teacher, draft, 200, key);
  assert.deepEqual(await command(teacher, draft, 200, key), grade);
  await command(teacher, { ...draft, score: '80' }, 409, key);
  record('grade idempotent replay and payload mismatch');
  assert.equal((await read(student)).grades.length, 0);
  assert.equal((await read(student)).publications.length, 0);
  assert.equal(JSON.stringify(await read(student)).includes(draft.feedback), false);
  record('unpublished grade and feedback hidden from student');
  await command(teacher, draft, 409);
  await command(teacher, { ...draft, revision: '999' }, 409);
  record('duplicate creation and stale grade revision denied');
  const publish = { type: 'PUBLISH_GRADE', submissionId, revision: grade.revision };
  const race = await Promise.all([http(path(), teacher, publish), http(path(), teacher, publish)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await read(student)).publications.length, 1);
  assert.equal((await read(studentB)).publications.length, 0);
  assert.equal((await read(student)).publications[0].score_points, 8525);
  record('concurrent publish exactly once; own published score only');
  grade = (await read()).grades[0];
  await command(teacher, { ...draft, revision: grade.revision }, 409);
  const correction = {
    type: 'CORRECT_GRADE',
    submissionId,
    revision: grade.revision,
    score: '90.50',
    maxScore: '100',
    feedback: '补充依据后调整',
    reason: '复核发现漏计依据分',
  };
  await command(teacher, { ...correction, reason: '   ' }, 400);
  const corrected = await command(teacher, correction);
  const history = (await read(student)).publications;
  assert.deepEqual(
    history.map((p) => p.score_points),
    [8525, 9050],
  );
  assert.equal(history[1].reason, correction.reason);
  record('explicit correction reason; immutable original and appended public history');
  attempt = (await learn(student)).attempts.find((t) => t.id === attempt.id)!;
  const newSubmission = await learn(student, {
    type: 'SUBMIT',
    id: attempt.id,
    revision: attempt.revision,
    answer: '学生方案版本二',
  });
  assert.ok((await read(student)).publications.every((p) => p.latest_submission === false));
  assert.equal((await read()).grades.length, 1);
  await command(teacher, { ...draft, revision: corrected.revision }, 409);
  record('resubmission keeps historical score without inheriting grade; stale save rejected');
  grade = (await read()).grades[0];
  await command(teacher, { ...correction, revision: grade.revision, reason: '对历史提交再复核' });
  record('historical published submission can receive explicit audited correction');
  const next = await command(teacher, { ...draft, submissionId: newSubmission.submissionId });
  attempt = (await learn(student)).attempts.find((t) => t.id === attempt.id)!;
  const third = await learn(student, {
    type: 'SUBMIT',
    id: attempt.id,
    revision: attempt.revision,
    answer: '学生方案版本三',
  });
  await command(
    teacher,
    { type: 'PUBLISH_GRADE', submissionId: newSubmission.submissionId, revision: next.revision },
    409,
  );
  assert.equal((await read(student)).publications.length, 3);
  record('new resubmission blocks stale draft publish atomically');
  state = (await http(academicPath, admin)).data;
  let assignment = state.assignments.find(
    (a) => a.offering_id === offeringId && a.membership_id === teacher.account.membershipId,
  )!;
  state = await academic({ type: 'END_TEACHER', id: assignment.id, revision: assignment.revision });
  assert.equal((await http(path(), teacher)).status, 403);
  await command(teacher, draft, 403, key);
  assignment = state.assignments.find((a) => a.id === assignment.id)!;
  await academic({
    type: 'ASSIGN_TEACHER',
    offeringId,
    membershipId: teacher.account.membershipId,
    revision: assignment.revision,
  });
  record('removed teaching assignment denies read, write and idempotent replay');
  state = (await http(academicPath, admin)).data;
  let enrollment = state.enrollments.find(
    (a) => a.offering_id === offeringId && a.membership_id === student.account.membershipId,
  )!;
  state = await academic({ type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision });
  assert.equal((await http(path(), student)).status, 403);
  enrollment = state.enrollments.find((a) => a.id === enrollment.id)!;
  await academic({
    type: 'ENROLL',
    offeringId,
    membershipId: student.account.membershipId,
    revision: enrollment.revision,
  });
  record('withdrawn enrollment denies published score read');
  await command(teacher, { ...draft, submissionId: v7() }, 403);
  const previousM3 = JSON.parse((await privateFile('m3-verification.json')).toString());
  await command(teacher, { ...draft, submissionId: previousM3.submissionId }, 403);
  record('unknown and other Offering submission cannot be graded');
  const cfg = JSON.parse((await privateFile('academic.json')).toString());
  const pool = new Pool({ connectionString: cfg.academic, max: 1 });
  try {
    const c = await pool.connect();
    try {
      assert.equal(
        (await c.query('SELECT count(*)::integer AS count FROM zhiban_assessment.publications'))
          .rows[0].count,
        0,
      );
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.account.tenantId]);
      const tenantSetting = await c.query('SELECT zhiban_identity.current_tenant_id() AS tenant');
      assert.equal(tenantSetting.rows[0].tenant, teacher.account.tenantId);
      const permissions = (
        await c.query(
          "SELECT has_table_privilege('zhiban_assessment.publications','UPDATE') AS update,has_table_privilege('zhiban_assessment.publications','DELETE') AS delete,has_schema_privilege('zhiban_assessment','CREATE') AS ddl",
        )
      ).rows[0];
      assert.deepEqual(permissions, { update: false, delete: false, ddl: false });
      await c.query('ROLLBACK');
      record('tenant RLS default deny and immutable publication/DDL ACL');
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
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
  try {
    for (const session of [teacher, student]) {
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
        has: page.getByRole('heading', { name: `M4 活动与提交教学班 ${suffix}`, exact: true }),
      });
      await card.locator('.learning-section > summary').click();
      await expect(
        card.getByRole('heading', { name: '人工评分与成绩', exact: true }),
      ).toBeVisible();
      if (session === teacher) {
        const form = card.locator('details.academic-form').filter({ hasText: '提交版本 3' });
        await form.locator('summary').click();
        await form.getByLabel('满分', { exact: true }).fill('20');
        await form.getByLabel('得分', { exact: true }).fill('18.75');
        await form.getByLabel('评分反馈').fill('页面评分反馈');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect(form.getByLabel('得分', { exact: true })).toHaveValue('18.75');
        const response = page.waitForResponse(
          (r) => r.url().includes('/assessment/') && r.request().method() === 'POST',
        );
        await form.getByRole('button', { name: '保存评分草稿', exact: true }).click();
        const saveResponse = await response;
        assert.equal(saveResponse.status(), 200, JSON.stringify(await saveResponse.json()));
        await expect(form.locator('summary')).toBeVisible();
        await expect(
          form.getByRole('button', { name: '发布成绩', exact: true, includeHidden: true }),
        ).toHaveCount(1);
        await form.locator('summary').click();
        await form.getByRole('button', { name: '发布成绩', exact: true }).click();
        await expect(form.getByLabel('公开更正说明')).toHaveCount(1);
        await form.locator('summary').click();
        await form.getByLabel('得分', { exact: true }).fill('19.25');
        await form.getByLabel('公开更正说明').fill('页面复核更正');
        await form.getByRole('button', { name: '发布更正', exact: true }).click();
        await expect(card.getByText('更正说明：页面复核更正', { exact: true })).toBeVisible();
        record('teacher browser saves, publishes, corrects and preserves unsaved input');
      } else {
        await expect(card.getByText('更正说明：页面复核更正', { exact: true })).toBeVisible();
        await expect(card.getByLabel('得分', { exact: true })).toHaveCount(0);
        record('student browser sees public history only');
      }
      await page.reload();
      await card.locator('.learning-section > summary').click();
      await expect(card.getByText('更正说明：页面复核更正', { exact: true })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
      await page.screenshot({
        path: join(directory, `m4-${session === teacher ? 'teacher' : 'student'}.png`),
        fullPage: true,
      });
      await context.close();
      record(
        `${session === teacher ? 'teacher' : 'student'} refresh, mobile and no client secrets`,
      );
    }
  } finally {
    await browser.close();
  }
  state = (await http(academicPath, admin)).data;
  let offering = state.offerings.find((o) => o.id === offeringId)!;
  state = await academic({
    type: 'UPDATE_OFFERING',
    id: offeringId,
    revision: offering.revision,
    name: offering.name,
    capacity: offering.capacity,
    status: 'CLOSED',
  });
  grade = (await read()).grades.find((g) => g.submission_id === third.submissionId)!;
  await command(teacher, {
    type: 'CORRECT_GRADE',
    submissionId: third.submissionId,
    revision: grade.revision,
    score: '19.25',
    maxScore: '20',
    feedback: '关闭教学班后复核',
    reason: '已结课提交仍可人工复核',
  });
  offering = state.offerings.find((o) => o.id === offeringId)!;
  await academic({
    type: 'UPDATE_OFFERING',
    id: offeringId,
    revision: offering.revision,
    name: offering.name,
    capacity: offering.capacity,
    status: 'OPEN',
  });
  record('closed Offering preserves authorized review of existing submissions');
  const final = (await read(student)).publications;
  const sources = [
    'lib/zhiban/domain/assessment/model.ts',
    'lib/zhiban/application/assessment/service.ts',
    'lib/zhiban/infrastructure/assessment/http.ts',
    'lib/zhiban/infrastructure/assessment/postgres/transaction.ts',
    'lib/zhiban/infrastructure/assessment/postgres/migrations/0001_assessment.sql',
    'scripts/zhiban-local/assessment.ts',
    'scripts/zhiban-local/setup-m4.ts',
    'scripts/zhiban-local/academic.ts',
    'scripts/zhiban-local/server.ts',
    'app/zhiban/local/assessment.js',
    'app/zhiban/local/learning.js',
    'app/zhiban/local/index.html',
    'scripts/zhiban-local/verify-m4.ts',
    'lib/zhiban/application/academic/service.ts',
    'lib/zhiban/infrastructure/academic/postgres/store.ts',
    'app/zhiban/local/client.js',
    'app/zhiban/local/academic.js',
    'tests/zhiban/assessment/model.test.ts',
  ];
  const hashes = Object.fromEntries(
    await Promise.all(sources.map(async (file) => [file, digest(await readFile(file, 'utf8'))])),
  );
  await writeFile(
    join(directory, 'm4-verification.json'),
    JSON.stringify(
      {
        mode: 'LOCAL',
        at: new Date().toISOString(),
        passed,
        offeringId,
        publicationId: final.at(-1)!.id,
        submissionId: third.submissionId,
        hashes,
        scope:
          'Synthetic owned PG16 and standalone HTTPS only; no CI, production, AI grading, completion or course aggregation',
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(`LOCAL M4 ${passed.length}/${passed.length} PASS`);
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'M4 verification rejected');
  process.exitCode = 1;
});
