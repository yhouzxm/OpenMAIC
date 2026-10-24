import assert from 'node:assert/strict';
import { request } from 'node:https';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import {
  directory,
  origin,
  database,
  pgPort,
  privateFile,
  trustedDevelopmentCa,
  digest,
  loadRuntime,
} from './config';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { RoleGrant, instant, tenantId, membershipId } from '@/lib/zhiban/domain/identity';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import type { AcademicSnapshot } from '@/lib/zhiban/application/academic/service';

type Account = {
  userId: string;
  password: string;
  label: string;
  membershipId: string;
  tenantId: string;
};
type Session = { cookie: string; csrf: string; account: Account };
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
  const http = async (
    path: string,
    session?: Session,
    command?: unknown,
    key = randomUUID().replaceAll('-', ''),
    extra: Record<string, string> = {},
  ) =>
    new Promise<{
      status: number;
      data: AcademicSnapshot & { csrfToken: string };
      cookie?: string;
    }>((done, reject) => {
      const req = request(
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
          const chunks: Buffer[] = [];
          response.on('data', (b) => chunks.push(b));
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            done({
              status: response.statusCode!,
              data: raw ? JSON.parse(raw) : null,
              cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
            });
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('HTTPS timeout')));
      req.end(command ? JSON.stringify(command) : undefined);
    });
  const login = async (account: Account): Promise<Session> => {
    const result = await http('/api/zhiban/identity/login', undefined, {
      userId: account.userId,
      password: account.password,
    });
    assert.equal(result.status, 200);
    const session = { account, cookie: result.cookie!, csrf: '' };
    const proof = await http('/api/zhiban/identity/csrf', session);
    assert.equal(proof.status, 200);
    session.csrf = proof.data.csrfToken;
    return session;
  };
  const admin = await login(accounts[0]);
  const teacher = await login(accounts.find((a) => a.label === '任教教师')!);
  const studentA = await login(accounts.find((a) => a.label === '学生甲')!);
  const studentB = await login(accounts.find((a) => a.label === '学生乙')!);
  const unassigned = await login(accounts.find((a) => a.label === '非任教教师')!);
  const other = await login(accounts.find((a) => a.label === '其他空间管理员')!);
  const path = `/api/zhiban/academic/${admin.account.tenantId}`;
  const snapshot = async (session = admin) => {
    const result = await http(path, session);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data as AcademicSnapshot;
  };
  let state = await snapshot();
  assert.equal(state.mode, 'ADMIN');
  record('real Identity session reused for academic admin');
  const command = async (value: unknown, key?: string) => {
    const result = await http(path, admin, value, key);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    state = result.data;
    return state;
  };
  const suffix = Date.now().toString(36);
  const priorStudentOfferings = (await snapshot(studentA)).offerings.length;
  const termCode = `T-${suffix}`,
    courseCode = `C-${suffix}`,
    classCode = `A-${suffix}`;
  await command({
    type: 'CREATE_TERM',
    code: termCode,
    name: '本地验证学期',
    startsOn: '2026-09-01',
    endsOn: '2027-01-31',
  });
  const term = state.terms.find((t) => t.code === termCode)!;
  await command({ type: 'CREATE_CLASS', code: classCode, name: '机电体验行政班' });
  const cls = state.classes.find((c) => c.code === classCode)!;
  await command({
    type: 'CLASS_HEAD_TEACHER',
    id: cls.id,
    revision: cls.revision,
    membershipId: teacher.account.membershipId,
  });
  for (const previous of state.classMembers.filter(
    (m) => m.membership_id === studentA.account.membershipId && m.active,
  )) {
    await command({
      type: 'CLASS_MEMBER',
      classId: previous.class_id,
      membershipId: studentA.account.membershipId,
      active: false,
      revision: previous.revision,
    });
  }
  await command({
    type: 'CLASS_MEMBER',
    classId: cls.id,
    membershipId: studentA.account.membershipId,
    active: true,
    revision: null,
  });
  assert.equal((await snapshot(studentA)).offerings.length, priorStudentOfferings);
  record('administrative class/head teacher does not imply enrollment or teaching access');
  const courseName = `机电技术基础 ${suffix}`;
  await command({
    type: 'CREATE_COURSE',
    code: courseCode,
    name: courseName,
    description: '本地课程与班级体验',
    ownerMembershipId: teacher.account.membershipId,
  });
  let course = state.courses.find((c) => c.code === courseCode)!;
  assert.equal(
    (
      await http(path, admin, {
        type: 'CREATE_OFFERING',
        courseId: course.id,
        termId: term.id,
        classId: cls.id,
        code: `draft-${suffix}`,
        name: '草稿不得开班',
        capacity: 1,
      })
    ).status,
    409,
  );
  await command({ type: 'PUBLISH_COURSE', id: course.id, revision: course.revision });
  course = state.courses.find((c) => c.id === course.id)!;
  const offering = async (code: string, capacity: number) => {
    await command({
      type: 'CREATE_OFFERING',
      courseId: course.id,
      termId: term.id,
      classId: cls.id,
      code: `${code}-${suffix}`,
      name: `机电教学班 ${code} ${suffix}`,
      capacity,
    });
    return state.offerings.find((o) => o.code === `${code}-${suffix}`)!;
  };
  const source = await offering('A', 1),
    target = await offering('B', 1),
    demo = await offering('DEMO', 30);
  // Codes deliberately remain ASCII; names can be Chinese.
  await command({
    type: 'ASSIGN_TEACHER',
    offeringId: source.id,
    membershipId: teacher.account.membershipId,
    revision: null,
  });
  assert.equal(
    (await snapshot(unassigned)).offerings.filter((o) => o.course_id === course.id).length,
    0,
  );
  assert.equal(
    (await snapshot(teacher)).offerings.filter((o) => o.course_id === course.id).length,
    1,
  );
  record('teacher requires actual assignment; course owner alone cannot read');
  const enroll = (o: Record<string, unknown>, s: Session) => ({
    type: 'ENROLL',
    offeringId: o.id,
    membershipId: s.account.membershipId,
    revision: null,
  });
  const racing = await Promise.all([
    http(path, admin, enroll(source, studentA)),
    http(path, admin, enroll(source, studentB)),
  ]);
  assert.deepEqual(racing.map((r) => r.status).sort(), [200, 409]);
  state = await snapshot();
  const winner = state.enrollments.find(
    (e) => e.offering_id === source.id && e.status === 'ACTIVE',
  )!;
  const win = winner.membership_id === studentA.account.membershipId ? studentA : studentB,
    lose = win === studentA ? studentB : studentA;
  assert.equal((await snapshot(lose)).offerings.filter((o) => o.course_id === course.id).length, 0);
  assert.equal(
    (await snapshot(win)).enrollments.filter((e) => e.offering_id === source.id).length,
    1,
  );
  record('last seat serialized; student reads only own enrollment');
  await command(enroll(target, lose));
  const transfer = {
    type: 'TRANSFER',
    id: winner.id,
    revision: winner.revision,
    targetOfferingId: target.id,
    targetRevision: null,
  };
  assert.equal((await http(path, admin, transfer)).status, 409);
  state = await snapshot();
  assert.equal(state.enrollments.find((e) => e.id === winner.id)!.status, 'ACTIVE');
  record('full target transfer rolls back source withdrawal');
  const targetEnrollment = state.enrollments.find(
    (e) => e.offering_id === target.id && e.membership_id === lose.account.membershipId,
  )!;
  await command({ type: 'WITHDRAW', id: targetEnrollment.id, revision: targetEnrollment.revision });
  await command(transfer);
  assert.equal(state.enrollments.find((e) => e.id === winner.id)!.status, 'WITHDRAWN');
  assert.equal(
    state.enrollments.filter(
      (e) =>
        [source.id, target.id].includes(e.offering_id) &&
        e.membership_id === win.account.membershipId &&
        e.status === 'ACTIVE',
    ).length,
    1,
  );
  record('successful transfer commits both relations atomically');
  assert.equal(
    (await http(path, studentA, { type: 'CREATE_CLASS', code: `bad-${suffix}`, name: '禁止' }))
      .status,
    403,
  );
  assert.equal(
    (await http(path, teacher, { type: 'CREATE_CLASS', code: `bad-${suffix}`, name: '禁止' }))
      .status,
    403,
  );
  assert.equal((await http(path, other)).status, 403);
  assert.equal(
    (
      await http(path, admin, {
        type: 'ENROLL',
        offeringId: demo.id,
        membershipId: other.account.membershipId,
        revision: null,
      })
    ).status,
    403,
  );
  record('student/teacher writes and cross tenant session/member denied');
  assert.equal(
    (await http(path, admin, enroll(demo, studentA), undefined, { 'x-zhiban-csrf': '' })).status,
    403,
  );
  assert.equal(
    (
      await http(path, admin, enroll(demo, studentA), undefined, {
        Origin: 'https://attacker.invalid',
      })
    ).status,
    403,
  );
  assert.equal((await http(path)).status, 401);
  record('anonymous, missing CSRF and foreign Origin denied');
  const key = randomUUID().replaceAll('-', ''),
    payload = enroll(demo, studentA);
  await command(payload, key);
  await command(payload, key);
  assert.equal(
    state.enrollments.filter(
      (e) => e.offering_id === demo.id && e.membership_id === studentA.account.membershipId,
    ).length,
    1,
  );
  assert.equal((await http(path, admin, enroll(demo, studentB), key)).status, 409);
  record('same key/payload idempotent; key payload substitution denied');
  await command({
    type: 'EDIT_COURSE',
    id: course.id,
    revision: course.revision,
    name: courseName + ' 新草稿',
    description: '不覆盖已发布版本',
    ownerMembershipId: teacher.account.membershipId,
  });
  assert.equal(
    (await snapshot(studentA)).courses.find((c) => c.id === course.id)!.name,
    courseName,
  );
  assert.equal(
    (await http(path, admin, { type: 'ARCHIVE_COURSE', id: course.id, revision: course.revision }))
      .status,
    409,
  );
  record('published snapshot preserved; stale revision rejected');
  assert.equal(state.offerings.find((o) => o.id === demo.id)!.course_name, courseName);
  course = state.courses.find((c) => c.id === course.id)!;
  await command({ type: 'PUBLISH_COURSE', id: course.id, revision: course.revision });
  const assignment = state.assignments.find((a) => a.offering_id === source.id)!;
  await command({ type: 'END_TEACHER', id: assignment.id, revision: assignment.revision });
  assert.equal(
    (await snapshot(teacher)).offerings.filter((o) => o.course_id === course.id).length,
    0,
  );
  record('ending assignment immediately removes access on existing session');
  const demoEnrollment = state.enrollments.find(
    (e) => e.offering_id === demo.id && e.membership_id === studentA.account.membershipId,
  )!;
  await command({ type: 'WITHDRAW', id: demoEnrollment.id, revision: demoEnrollment.revision });
  assert.ok(!(await snapshot(studentA)).offerings.some((o) => o.id === demo.id));
  await command({
    ...payload,
    revision: state.enrollments.find((e) => e.id === demoEnrollment.id)!.revision,
  });
  record('withdrawal revokes access and controlled rejoin requires current revision');
  await command({
    type: 'ASSIGN_TEACHER',
    offeringId: demo.id,
    membershipId: teacher.account.membershipId,
    revision: null,
  });
  await command(enroll(demo, studentB));
  assert.equal((await http(path, admin, enroll(demo, teacher))).status, 403);
  assert.equal(
    (
      await http(path, admin, {
        type: 'ASSIGN_TEACHER',
        offeringId: demo.id,
        membershipId: studentA.account.membershipId,
        revision: null,
      })
    ).status,
    403,
  );
  record('assignment/enrollment target requires current matching role and active member');
  const runtime = await loadRuntime();
  const identityPool = new Pool({ connectionString: runtime.secrets.LOCAL_M1_TENANT, max: 1 });
  const repository = new PostgresMembershipRepository(identityPool);
  const context = tenantScopeContext(tenantId(admin.account.tenantId));
  const currentTeacher = await repository.findById(
    context,
    membershipId(teacher.account.membershipId),
  );
  assert.ok(currentTeacher);
  const activeGrants = currentTeacher.value.roleGrants.filter((g) =>
    g.isEffectiveAt(instant(Date.now())),
  );
  try {
    let member = currentTeacher;
    for (const grant of activeGrants) {
      await repository.save(
        context,
        member.value.revokeGrant({
          expectedAuthorizationVersion: member.value.authorizationVersion,
          now: instant(Date.now()),
          grantId: grant.id,
        }),
        member.revision,
      );
      member = (await repository.findById(context, member.value.id))!;
    }
    assert.equal((await snapshot(teacher)).offerings.length, 0);
    assert.equal((await http('/api/zhiban/identity/me', teacher)).status, 200);
    record('grant revocation removes business access without requiring logout');
  } finally {
    try {
      let member = (await repository.findById(
        context,
        membershipId(teacher.account.membershipId),
      ))!;
      for (const old of activeGrants) {
        const now = instant(Date.now());
        await repository.save(
          context,
          member.value.grantRole({
            expectedAuthorizationVersion: member.value.authorizationVersion,
            now,
            approvedGrant: RoleGrant.create({
              id: new IdentityIds().nextRoleGrantId(),
              roleCode: old.roleCode,
              scope: old.scope,
              createdAt: now,
              validFrom: now,
              validUntil: old.validUntil,
            }),
          }),
          member.revision,
        );
        member = (await repository.findById(context, member.value.id))!;
      }
    } finally {
      await identityPool.end();
    }
  }
  const config = JSON.parse((await privateFile('academic.json')).toString());
  const pool = new Pool({ connectionString: config.academic, max: 1 });
  const privileged = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 1,
  });
  try {
    const client = await pool.connect();
    try {
      assert.equal((await client.query('SELECT * FROM zhiban_academic.courses')).rows.length, 0);
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [other.account.tenantId]);
      assert.equal(
        (await client.query('SELECT * FROM zhiban_academic.courses WHERE id=$1', [course.id])).rows
          .length,
        0,
      );
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [admin.account.tenantId]);
      await assert.rejects(
        client.query(
          "INSERT INTO zhiban_academic.courses(tenant_id,id,code,name,description,owner_membership_id,status,created_at,updated_at) VALUES($1,$2,$3,'cross tenant','',$4,'DRAFT',1,1)",
          [admin.account.tenantId, v7(), `FK-${suffix}`, other.account.membershipId],
        ),
        (e) => (e as { code?: string }).code === '23503',
      );
      await client.query('ROLLBACK');
      await assert.rejects(
        client.query('UPDATE zhiban_academic.course_versions SET name=$1', ['forbidden']),
        (e) => (e as { code?: string }).code === '42501',
      );
      await assert.rejects(
        client.query('DELETE FROM zhiban_academic.enrollments'),
        (e) => (e as { code?: string }).code === '42501',
      );
      await assert.rejects(
        client.query('SELECT * FROM zhiban_identity.memberships'),
        (e) => (e as { code?: string }).code === '42501',
      );
    } finally {
      client.release();
    }
    const count = await privileged.query(
      'SELECT (SELECT count(*) FROM zhiban_academic.commands WHERE tenant_id=$1 AND command_key=$2)::integer AS commands,(SELECT count(*) FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2)::integer AS audit',
      [admin.account.tenantId, key],
    );
    assert.deepEqual(count.rows[0], { commands: 1, audit: 1 });
    record(
      'RLS/ACL closed without tenant; no immutable update/delete or Identity reads; audit atomic',
    );
  } finally {
    await pool.end();
    await privileged.end();
  }
  assert.equal((await http('/api/zhiban/identity/logout', admin, {})).status, 204);
  assert.equal((await http(path, admin)).status, 401);
  record('revoked cookie rejected on academic endpoint without trusting public refusal codes');
  const certificate = new X509Certificate(await privateFile('localhost.crt'));
  const pin = createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
  const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${pin}`] });
  try {
    for (const [session, label] of [
      [admin, 'admin'],
      [teacher, 'teacher'],
      [studentA, 'student'],
    ] as const) {
      const context = await browser.newContext({ viewport: { width: 1360, height: 950 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${origin}/zhiban`);
      await page.getByLabel('账号 ID').fill(session.account.userId);
      await page.getByLabel('密码', { exact: true }).fill(session.account.password);
      await page.getByRole('button', { name: '登录并进入' }).click();
      await expect(page.getByRole('heading', { name: '你的工作台', exact: true })).toBeVisible();
      await page.goto(`${origin}/zhiban?space=${admin.account.tenantId}`);
      await expect(
        page.getByRole('heading', {
          name: label === 'admin' ? '教务管理' : '我的课程',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: `机电教学班 DEMO ${suffix}`, exact: true }),
      ).toBeVisible();
      if (label === 'admin') {
        await page.getByRole('button', { name: '学期', exact: true }).click();
        await page.getByText('新建学期', { exact: true }).click();
        await page.getByLabel('学期编号', { exact: true }).fill(`UI-${suffix}`);
        await page.getByLabel('学期名称', { exact: true }).fill(`浏览器创建学期 ${suffix}`);
        await page.getByLabel('开始日期', { exact: true }).fill('2027-02-01');
        await page.getByLabel('结束日期', { exact: true }).fill('2027-07-01');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: `浏览器创建学期 ${suffix}`, exact: true }),
        ).toBeVisible();
        await page.reload();
        await page.getByRole('button', { name: '学期', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: `浏览器创建学期 ${suffix}`, exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: '课程', exact: true }).click();
        await page.getByText('新建课程', { exact: true }).click();
        const creation = page
          .locator('details')
          .filter({ has: page.getByText('新建课程', { exact: true }) });
        await creation.getByLabel('课程编号', { exact: true }).fill(`UI-C-${suffix}`);
        await creation.getByLabel('课程名称', { exact: true }).fill(`浏览器课程 ${suffix}`);
        await creation.getByLabel('课程简介', { exact: true }).fill('从页面建立的实际课程');
        await creation.getByRole('button', { name: '保存', exact: true }).click();
        const courseCard = page.locator('article').filter({
          has: page.getByRole('heading', { name: `浏览器课程 ${suffix}`, exact: true }),
        });
        await courseCard.getByRole('button', { name: '发布课程', exact: true }).click();
        await expect(courseCard.getByText(/已发布/)).toBeVisible();
        await page.getByRole('button', { name: '教学班', exact: true }).click();
        await page.getByText('新建教学班', { exact: true }).click();
        const opening = page
          .locator('details')
          .filter({ has: page.getByText('新建教学班', { exact: true }) });
        await opening
          .getByLabel('课程', { exact: true })
          .selectOption({ label: `浏览器课程 ${suffix}` });
        await opening
          .getByLabel('学期', { exact: true })
          .selectOption({ label: `浏览器创建学期 ${suffix}` });
        await opening.getByLabel('教学班编号', { exact: true }).fill(`UI-O-${suffix}`);
        await opening.getByLabel('教学班名称', { exact: true }).fill(`浏览器教学班 ${suffix}`);
        await opening.getByRole('button', { name: '保存', exact: true }).click();
        const teaching = page.locator('article').filter({
          has: page.getByRole('heading', { name: `浏览器教学班 ${suffix}`, exact: true }),
        });
        await teaching.getByText('指定任教教师', { exact: true }).click();
        const assignmentForm = teaching
          .locator('details')
          .filter({ has: page.getByText('指定任教教师', { exact: true }) });
        await assignmentForm
          .getByLabel('教师', { exact: true })
          .selectOption({ label: '任教教师' });
        await assignmentForm.getByRole('button', { name: '保存', exact: true }).click();
        await expect(teaching.getByText('任教 · 任教教师')).toBeVisible();
        await teaching.getByText('添加学生', { exact: true }).click();
        const enrollmentForm = teaching
          .locator('details')
          .filter({ has: page.getByText('添加学生', { exact: true }) });
        await enrollmentForm.getByLabel('学生', { exact: true }).selectOption({ label: '学生甲' });
        await enrollmentForm.getByRole('button', { name: '保存', exact: true }).click();
        await expect(
          teaching.locator('.academic-roster').getByText('学生甲', { exact: true }),
        ).toBeVisible();
        await page.reload();
        await expect(
          teaching.locator('.academic-roster').getByText('学生甲', { exact: true }),
        ).toBeVisible();
        record(
          'browser creates/publishes course, opens class, assigns teacher and enrolls student with persisted reload',
        );
      } else assert.equal(await page.getByText('添加学生', { exact: true }).count(), 0);
      await page.screenshot({ path: join(directory, `m2-${label}.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.deepEqual(errors, []);
      await context.close();
      record(`${label} browser workspace, persistence, mobile layout and no credential storage`);
    }
  } finally {
    await browser.close();
  }
  const files = [
    'package.json',
    'scripts/zhiban-local/server.ts',
    'scripts/zhiban-local/academic.ts',
    'scripts/zhiban-local/setup-m2.ts',
    'scripts/zhiban-local/verify-m2.ts',
    'lib/zhiban/domain/academic/model.ts',
    'lib/zhiban/application/academic/service.ts',
    'lib/zhiban/infrastructure/academic/http.ts',
    'lib/zhiban/infrastructure/academic/session-authentication.ts',
    'scripts/zhiban-local/verify-concurrency.ts',
    'lib/zhiban/infrastructure/academic/postgres/store.ts',
    'lib/zhiban/infrastructure/academic/postgres/migrations/0001_academic.sql',
    'app/zhiban/local/index.html',
    'app/zhiban/local/client.js',
    'app/zhiban/local/academic.js',
    'app/zhiban/local/style.css',
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(files.map(async (f) => [f, digest(await readFile(resolve(f), 'utf8'))])),
  );
  await writeFile(
    join(directory, 'm2-verification.json'),
    JSON.stringify(
      {
        mode: 'LOCAL',
        scope:
          'M2 synthetic PG16 + strict HTTPS + isolated browser; not enabled Bridge/production/CI signoff',
        baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        verifiedAt: new Date().toISOString(),
        passed,
        sourceHashes,
        migrationHash: config.migrationHash,
        policyHash: config.policyHash,
        demo: { tenantId: admin.account.tenantId, courseId: course.id, offeringId: demo.id },
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    `LOCAL M2 ${passed.length}/${passed.length} PASS; private evidence m2-verification.json. Demo teaching class retained.`,
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
