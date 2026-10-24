/** One directed LOCAL teacher authorization package. No old classroom, scanner or export suites. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import { loadTeacherRelationships } from './teaching';
// Closed HTTP projections are asserted at the real boundary below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  tenantPool: Pool;
  businessPool: Pool;
  bridgePool: Pool;
  composition: unknown;
};
export async function verifyTeacherScope(input: Input) {
  const { admin, browser, actors, http, tenant, origin, record, trial, tenantPool } = input;
  const manager = actors[4],
    teacher = actors[9],
    other = actors[8];
  const base = `/api/zhiban/identity/tenants/${tenant}`;
  const manage = `/api/zhiban/management/${tenant}`;
  const learn = (offering: string) =>
    `/api/zhiban/learning/${tenant}/offerings/${offering}/activities`;
  const get = async (path: string, a = manager) => {
    const r = await http(path, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const command = async (body: unknown, a = manager, key = randomUUID()) =>
    http(manage + '/commands', a, body, 'POST', { 'x-zhiban-command': key });
  const send = async (body: unknown) => {
    const r = await command(body);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const point = async (who = teacher) =>
    get(`${base}/memberships/${who.member}?actorMembershipId=${manager.member}`);
  const envelope = (p: View) => ({
    actorMembershipId: manager.member,
    expectedActorRevision: p.actorRevision,
    expectedActorAuthorizationVersion: p.actorAuthorizationVersion,
    expectedTenantRevision: p.tenantRevision,
    expectedRevision: p.revision,
    expectedAuthorizationVersion: p.authorizationVersion,
    password: manager.password,
  });
  const role = (scope: string, id: string) => ({
    roleCode: 'TEACHER',
    scope: { type: scope, scopeId: id },
    validUntil: null,
  });
  const grant = async (
    scope: string,
    id: string,
    who = teacher,
    payload?: View,
    key = randomUUID(),
  ) => {
    const p = payload ?? (await point(who));
    return http(
      `${base}/memberships/${who.member}/grant`,
      manager,
      { ...envelope(p), grant: role(scope, id) },
      'POST',
      { 'idempotency-key': key },
    );
  };
  const revoke = async (id: string, who = teacher, payload?: View, key = randomUUID()) => {
    const p = payload ?? (await point(who));
    return http(
      `${base}/memberships/${who.member}/revoke-grant`,
      manager,
      { ...envelope(p), revokeGrantId: id },
      'POST',
      { 'idempotency-key': key },
    );
  };
  const find = async (table: string, code: string) =>
    (
      await admin.query(`SELECT * FROM zhiban_academic.${table} WHERE tenant_id=$1 AND code=$2`, [
        tenant,
        code,
      ])
    ).rows[0];
  const a = (
    await admin.query('SELECT * FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2', [
      tenant,
      trial.offeringId,
    ])
  ).rows[0];
  await send({
    type: 'CREATE_OFFERING',
    courseId: a.course_id,
    termId: a.term_id,
    classId: null,
    code: 'SCOPED_A2',
    name: '作用域：同课程第二班',
    capacity: 20,
  });
  const a2 = await find('offerings', 'SCOPED_A2');
  await send({
    type: 'CREATE_COURSE',
    code: 'SCOPED_B',
    name: '作用域：另一课程',
    description: '本地授权验证',
    ownerMembershipId: null,
  });
  const courseB = await find('courses', 'SCOPED_B');
  await send({ type: 'PUBLISH_COURSE', id: courseB.id, revision: String(courseB.revision) });
  await send({
    type: 'CREATE_OFFERING',
    courseId: courseB.id,
    termId: a.term_id,
    classId: null,
    code: 'SCOPED_B1',
    name: '作用域：另一课程教学班',
    capacity: 20,
  });
  const b = await find('offerings', 'SCOPED_B1');
  const assignment = async (offering: string, who = teacher) =>
    (
      await admin.query(
        'SELECT * FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
        [tenant, offering, who.member],
      )
    ).rows[0];
  const prepare = async (offering: string, who = teacher) => {
    const old = await assignment(offering, who);
    if (old?.status === 'ACTIVE') return;
    await send({
      type: 'PREPARE_TEACHER',
      offeringId: offering,
      membershipId: who.member,
      revision: old ? String(old.revision) : null,
    });
  };
  const expectDenied = (r: { status: number }) =>
    assert.ok([403, 404, 409, 503].includes(r.status), String(r.status));
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addCookies([
    {
      name: manager.cookie!.split('=')[0],
      value: manager.cookie!.split('=').slice(1).join('='),
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  try {
    const before = await point();
    expectDenied(await grant('COURSE', b.course_id));
    assert.equal((await point()).revision, before.revision);
    const invalid = await http(
      `${base}/memberships/${teacher.member}/grant`,
      manager,
      {
        ...envelope(before),
        grant: { roleCode: 'TEACHER', scope: { type: 'TENANT', scopeId: null }, validUntil: null },
      },
      'POST',
      { 'idempotency-key': randomUUID() },
    );
    expectDenied(invalid);
    assert.equal((await point()).revision, before.revision);
    expectDenied(
      await command(
        { type: 'PREPARE_TEACHER', offeringId: a.id, membershipId: teacher.member, revision: null },
        actors[1],
      ),
    );
    const foreign = actors[3],
      foreignManage = `/api/zhiban/management/${foreign.tenant}/commands`;
    const foreignSend = async (body: unknown) => {
      const r = await http(foreignManage, foreign, body);
      assert.equal(r.status, 200);
    };
    const foreignFind = async (table: string, code: string) =>
      (
        await admin.query(`SELECT * FROM zhiban_academic.${table} WHERE tenant_id=$1 AND code=$2`, [
          foreign.tenant,
          code,
        ])
      ).rows[0];
    await foreignSend({
      type: 'CREATE_TERM',
      code: 'SCOPE_FOREIGN_TERM',
      name: '外空间学期',
      startsOn: '2026-10-01',
      endsOn: '2027-01-01',
    });
    await foreignSend({
      type: 'CREATE_COURSE',
      code: 'SCOPE_FOREIGN_COURSE',
      name: '外空间课程',
      description: '',
      ownerMembershipId: null,
    });
    const foreignCourse = await foreignFind('courses', 'SCOPE_FOREIGN_COURSE'),
      foreignTerm = await foreignFind('terms', 'SCOPE_FOREIGN_TERM');
    await foreignSend({
      type: 'PUBLISH_COURSE',
      id: foreignCourse.id,
      revision: String(foreignCourse.revision),
    });
    await foreignSend({
      type: 'CREATE_OFFERING',
      courseId: foreignCourse.id,
      termId: foreignTerm.id,
      classId: null,
      code: 'SCOPE_FOREIGN_CLASS',
      name: '外空间教学班',
      capacity: 20,
    });
    const foreignOffering = await foreignFind('offerings', 'SCOPE_FOREIGN_CLASS');
    expectDenied(await grant('CLASS', foreignOffering.id));
    expectDenied(await grant('CLASS', a.class_id));
    await page.goto(`${origin}/zhiban/admin/members?tenant=${tenant}&member=${teacher.member}`);
    const selectResource = async (kind: string) => {
      await page.getByLabel('授予角色', { exact: true }).selectOption(kind);
      await page.getByLabel('任教教学班搜索', { exact: true }).fill(a.code);
      await page.getByRole('button', { name: '搜索任教教学班', exact: true }).click();
      await expect(
        page.getByLabel('任教教学班', { exact: true }).locator(`option[value="${a.id}"]`),
      ).toHaveCount(1);
      await page.getByLabel('任教教学班', { exact: true }).selectOption(a.id);
    };
    await selectResource('TEACHER_CLASS');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: '登记任教待授权', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('任教关系已登记');
    assert.equal((await http(learn(a.id), teacher)).status, 403);
    assert.equal(
      (await point()).grants.some((g: View) => g.roleCode === 'TEACHER'),
      false,
    );
    await selectResource('TEACHER_CLASS');
    await page.getByLabel('授权截止时间（留空长期）', { exact: true }).fill('2020-01-01T00:00');
    await page.getByRole('button', { name: '授予所选角色', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('授权截止必须是有效的未来时间');
    assert.equal(
      (await point()).grants.some((g: View) => g.roleCode === 'TEACHER'),
      false,
    );
    const future = await page.evaluate(() => {
      const d = new Date(Date.now() + 3600000);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    });
    await page.getByLabel('授权截止时间（留空长期）', { exact: true }).fill(future);
    await page.getByLabel('操作人当前密码', { exact: true }).fill(manager.password);
    const granting = page.waitForResponse(
      (r) => r.url().endsWith('/grant') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '授予所选角色', exact: true }).click();
    assert.equal((await granting).status(), 200);
    await expect(page.getByText(new RegExp('TEACHER / CLASS / ' + a.id))).toBeVisible();
    assert.equal((await http(learn(a.id), teacher)).status, 200);
    assert.equal((await http(learn(a2.id), teacher)).status, 403);
    await page.screenshot({ path: 'docs/v2/evidence/teacher-scope/admin.png', fullPage: true });
    record(
      'TEACHER UI: current admin registers real assignment without access; password-confirmed CLASS grant enables exactly that teaching class; no assignment/foreign tenant/administrative class/TENANT teacher delegation refused',
    );
    await prepare(a2.id);
    assert.equal((await http(learn(a2.id), teacher)).status, 403);
    expectDenied(
      await command({
        type: 'ASSIGN_TEACHER',
        offeringId: b.id,
        membershipId: teacher.member,
        revision: null,
      }),
    );
    const filtered = await get(
      manage +
        '/teachers?' +
        new URLSearchParams({ offering: a2.id, q: teacher.member, limit: '10' }),
    );
    assert.equal(filtered.rows.length, 0);
    const own = await get(
      manage +
        '/teachers?' +
        new URLSearchParams({ offering: a.id, q: teacher.member, limit: '10' }),
    );
    assert.equal(own.rows.length, 1);
    assert.equal(
      (
        await get(
          manage +
            '/owner-candidates?' +
            new URLSearchParams({ purpose: 'CREATE_COURSE', q: teacher.member, limit: '10' }),
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await get(
          manage +
            '/owner-candidates?' +
            new URLSearchParams({
              purpose: 'EDIT_COURSE',
              courseId: b.course_id,
              q: teacher.member,
              limit: '10',
            }),
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await get(
          manage +
            '/owner-candidates?' +
            new URLSearchParams({
              purpose: 'EDIT_COURSE',
              courseId: a.course_id,
              q: teacher.member,
              limit: '10',
            }),
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await get(
          manage +
            '/teachers?' +
            new URLSearchParams({ classId: a.class_id, q: teacher.member, limit: '10' }),
        )
      ).rows.length,
      0,
    );
    expectDenied(
      await command({
        type: 'CLASS_HEAD_TEACHER',
        id: a.class_id,
        revision: String((await find('classes', 'TRY_CLASS')).revision),
        membershipId: teacher.member,
      }),
    );
    record(
      'TEACHER scope consumers: same-course other class remains denied for CLASS; assignment picker/write, course-owner picker and administrative-class head designation do not widen a local grant',
    );
    await selectResource('TEACHER_COURSE');
    await page.getByLabel('操作人当前密码', { exact: true }).fill(manager.password);
    const courseGrant = page.waitForResponse(
      (r) => r.url().endsWith('/grant') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '授予所选角色', exact: true }).click();
    assert.equal((await courseGrant).status(), 200);
    await expect(page.getByText(new RegExp('TEACHER / COURSE / ' + a.course_id))).toBeVisible();
    await prepare(b.id);
    assert.equal((await http(learn(a2.id), teacher)).status, 200);
    assert.equal((await http(learn(b.id), teacher)).status, 403);
    const workspace = await get(`/api/zhiban/workspace/${tenant}/courses?limit=50`, teacher);
    assert.ok(workspace.rows.some((r: View) => r.id === a.id));
    assert.ok(workspace.rows.some((r: View) => r.id === a2.id));
    assert.ok(!workspace.rows.some((r: View) => r.id === b.id));
    const scopedCourse = (await point()).grants.find(
      (g: View) => g.roleCode === 'TEACHER' && g.scope.type === 'COURSE',
    );
    assert.equal((await revoke(scopedCourse.grantId)).status, 200);
    assert.equal((await http(learn(a2.id), teacher)).status, 403);
    assert.equal((await http(learn(a.id), teacher)).status, 200);
    record(
      'TEACHER COURSE journey: explicit COURSE grant plus independent assignments enables two classes of that course; other course stays denied; revoke removes second-class access while remaining CLASS grant still works',
    );
    // Real business commands stop before COMMIT on a dedicated advisory gate. Identity must wait on the target User guard.
    async function barrier(
      key: string,
      start: () => Promise<{ status: number }>,
      compete: () => Promise<{ status: number }>,
      check: (first: { status: number }, second: { status: number }) => void,
    ) {
      const gate = await admin.connect();
      const lock = 470051;
      const functionSql = `CREATE FUNCTION zhiban_academic.local_teacher_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command_key='${key}' THEN PERFORM pg_advisory_xact_lock(${lock}); END IF; RETURN NEW; END $$`;
      await admin.query(functionSql);
      await admin.query(
        'CREATE TRIGGER local_teacher_gate BEFORE INSERT ON zhiban_academic.commands FOR EACH ROW EXECUTE FUNCTION zhiban_academic.local_teacher_gate()',
      );
      let first: Promise<{ status: number }> | undefined,
        second: Promise<{ status: number }> | undefined;
      const wait = async (sql: string, args: unknown[] = []) => {
        const end = Date.now() + 10000;
        while (Date.now() < end) {
          if (Number((await admin.query(sql, args)).rows[0].n) > 0) return;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw Error('Teacher concurrency barrier not reached');
      };
      try {
        await gate.query('SELECT pg_advisory_lock($1)', [lock]);
        first = start();
        await wait(
          "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND NOT granted",
          [lock],
        );
        second = compete();
        await wait(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='zhiban_runtime' AND state='active' AND wait_event_type='Lock'",
        );
        await gate.query('SELECT pg_advisory_unlock($1)', [lock]);
        check(await first, await second);
      } finally {
        await gate.query('SELECT pg_advisory_unlock($1)', [lock]).catch(() => {});
        await Promise.allSettled([first, second].filter(Boolean));
        await admin.query('DROP TRIGGER local_teacher_gate ON zhiban_academic.commands');
        await admin.query('DROP FUNCTION zhiban_academic.local_teacher_gate()');
        gate.release();
      }
    }
    const classGrant = (await point()).grants.find(
      (g: View) => g.roleCode === 'TEACHER' && g.scope.type === 'CLASS',
    );
    const p = await point();
    const key = randomUUID();
    await barrier(
      key,
      () =>
        http(
          learn(a.id).replace(/\/activities$/, ''),
          teacher,
          {
            type: 'CREATE_ACTIVITY',
            title: '授权屏障内已批准的教师草稿',
            prompt: '真实事务',
            deadlineAt: null,
            allowResubmit: true,
            maxAttempts: 2,
          },
          'POST',
          { 'x-zhiban-command': key },
        ),
      () => revoke(classGrant.grantId, teacher, p),
      (written, revoked) => {
        assert.equal(written.status, 200);
        assert.equal(revoked.status, 200);
      },
    );
    assert.equal((await http(learn(a.id), teacher)).status, 403);
    assert.equal(
      (
        await http(learn(a.id).replace(/\/activities$/, ''), teacher, {
          type: 'CREATE_ACTIVITY',
          title: '撤权后不得写入',
          prompt: '拒绝',
          deadlineAt: null,
          allowResubmit: true,
          maxAttempts: 1,
        })
      ).status,
      403,
    );
    record(
      'TEACHER revocation concurrency: real teacher write holds current Identity guard through business COMMIT; role revoke waits, then new reads/writes are denied; existing committed activity remains',
    );
    await prepare(a.id, other);
    const otherAssignment = await assignment(a.id, other),
      original = await point(other),
      endKey = randomUUID(),
      grantKey = randomUUID();
    await barrier(
      endKey,
      () =>
        command(
          {
            type: 'END_TEACHER',
            id: otherAssignment.id,
            revision: String(otherAssignment.revision),
          },
          actors[2],
          endKey,
        ),
      () => grant('CLASS', a.id, other, original, grantKey),
      (ended, refused) => {
        assert.equal(ended.status, 200);
        expectDenied(refused);
      },
    );
    assert.equal(
      (await point(other)).grants.some((g: View) => g.roleCode === 'TEACHER'),
      false,
    );
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_identity.identity_tenant_commands WHERE idempotency_key=$1',
            [grantKey],
          )
        ).rows[0].n,
      ),
      0,
    );
    record(
      'TEACHER relationship concurrency: real END_TEACHER commits before waiting role grant; same-client resource reload refuses ended assignment without role/audit/command partial effect',
    );
    await admin.query(
      'GRANT EXECUTE ON FUNCTION zhiban_teaching.identity_teacher_relationship(uuid,uuid,text,uuid) TO PUBLIC',
    );
    try {
      await assert.rejects(loadTeacherRelationships(tenantPool));
    } finally {
      await admin.query(
        'REVOKE EXECUTE ON FUNCTION zhiban_teaching.identity_teacher_relationship(uuid,uuid,text,uuid) FROM PUBLIC',
      );
    }
    await loadTeacherRelationships(tenantPool);
    const privileges = (
      await admin.query(
        "SELECT has_table_privilege('zhiban_runtime','zhiban_academic.assignments','SELECT') AS read,has_table_privilege('zhiban_runtime','zhiban_academic.assignments','UPDATE') AS write",
      )
    ).rows[0];
    assert.deepEqual(privileges, { read: false, write: false });
    const finalKey = randomUUID();
    assert.equal((await grant('CLASS', a.id, teacher, undefined, finalKey)).status, 200);
    const confirmedPoint = await point();
    assert.equal((await grant('CLASS', a.id, teacher, confirmedPoint, finalKey)).status, 200);
    assert.equal((await point()).revision, confirmedPoint.revision);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_identity.identity_tenant_commands WHERE idempotency_key=$1',
            [finalKey],
          )
        ).rows[0].n,
      ),
      1,
    );
    const studentContext = await browser.newContext();
    try {
      await studentContext.addCookies([
        {
          name: teacher.cookie!.split('=')[0],
          value: teacher.cookie!.split('=').slice(1).join('='),
          url: origin,
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
      const tp = await studentContext.newPage();
      tp.on('pageerror', (e) => errors.push(e.message));
      await tp.goto(`${origin}/zhiban?space=${tenant}`);
      await expect(
        tp.getByRole('link', { name: '进入课程工作区', exact: true }).first(),
      ).toBeVisible();
      await tp.screenshot({ path: 'docs/v2/evidence/teacher-scope/teacher.png', fullPage: true });
    } finally {
      await studentContext.close();
    }
    assert.deepEqual(errors, []);
    record(
      'TEACHER loader/ACL and handoff: widened helper ACL rejected and restored; Identity runtime has no direct Academic read/write; current-version same-key Teacher grant confirmation creates no second effect; final scoped teacher workspace is usable with other courses excluded',
    );
    const roots = (await admin.query("SELECT current_setting('data_directory') AS root")).rows[0]
      .root as string;
    const owned = roots.slice(0, -'/data'.length);
    await writeFile(
      owned + '/teacher-inputs.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          scope: 'EXACT_CLASS_WITH_REAL_ASSIGNMENT',
          teacher: {
            userId: teacher.uid,
            password: teacher.password,
            membershipId: teacher.member,
          },
          tenant,
          courseId: a.course_id,
          offeringId: a.id,
          deniedOfferingId: b.id,
          adminUrl: `${origin}/zhiban/admin/members?tenant=${tenant}&member=${teacher.member}`,
          workspace: `${origin}/zhiban?space=${tenant}`,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await writeFile(
      'docs/v2/evidence/zhiban-teacher-scope-journey-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          groups: 6,
          origin,
          tenant,
          courseId: a.course_id,
          offeringId: a.id,
          otherOfferingId: a2.id,
          deniedOfferingId: b.id,
          privateInputs: owned + '/teacher-inputs.json',
          at: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    await page
      .screenshot({ path: 'docs/v2/evidence/teacher-scope/failure.png', fullPage: true })
      .catch(() => {});
    await writeFile('/tmp/zhiban-teacher-failure.txt', await page.locator('body').innerText(), {
      mode: 0o600,
    }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
