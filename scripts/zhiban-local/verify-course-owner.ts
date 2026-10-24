/** Synthetic owned-cluster journey: candidate restriction does not change the owner write contract. */
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { expect, type Browser } from '@playwright/test';
import { v7 } from 'uuid';
import { IdentityIds } from '../../lib/zhiban/infrastructure/identity/composition/ids';
import { PostgresIdentityRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresMembershipRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import {
  User,
  Membership,
  RoleGrant,
  instant,
  tenantScope,
  selfScope,
} from '../../lib/zhiban/domain/identity/index';
import { tenantScopeContext } from '../../lib/zhiban/application/identity/ports/tenant-context';
type Actor = {
  uid: ReturnType<IdentityIds['nextUserId']>;
  password: string;
  member: string;
  grant: string;
  tenant: string;
  cookie?: string;
  csrf?: string;
};
type Dto = {
  rows: {
    id: string;
    membership_id: string;
    name: string | null;
    owner_membership_id: string | null;
    revision: string;
  }[];
  nextCursor: string | null;
};
type Http = (
  path: string,
  a?: Actor,
  payload?: unknown,
  method?: string,
  extra?: Record<string, string>,
) => Promise<{ status: number; json: unknown }>;
export async function verifyCourseOwner(input: {
  browser: Browser;
  admin: Pool;
  ids: IdentityIds;
  users: PostgresIdentityRepository;
  members: PostgresMembershipRepository;
  tenant: ReturnType<IdentityIds['nextTenantId']>;
  otherTenant: ReturnType<IdentityIds['nextTenantId']>;
  now: number;
  actors: Actor[];
  http: Http;
  origin: string;
  record: (s: string) => void;
}) {
  const {
    browser,
    admin,
    ids,
    users,
    members,
    tenant: t,
    otherTenant,
    now,
    actors,
    http,
    origin,
    record,
  } = input;
  const [teacher, student, , foreign, manager] = actors,
    base = `/api/zhiban/management/${t}`;
  const seed = async (
    name: string,
    role: 'TEACHER' | 'STUDENT' = 'TEACHER',
    tid = t,
    mode = 'ACTIVE',
  ) => {
    const uid = ids.nextUserId();
    await users.create(User.create(uid, instant(now)));
    const grant = RoleGrant.create({
      id: ids.nextRoleGrantId(),
      roleCode: role,
      scope: role === 'TEACHER' ? tenantScope() : selfScope(),
      createdAt: instant(now),
      validFrom: instant(mode === 'FUTURE' ? Date.now() + 3600000 : now),
      validUntil: mode === 'EXPIRED' ? instant(now + 1) : null,
    });
    let value = Membership.create({
      id: ids.nextMembershipId(),
      userId: uid,
      tenantId: tid,
      now: instant(now),
    });
    if (mode !== 'PENDING')
      value = value.activatePending({
        expectedAuthorizationVersion: 0,
        now: instant(now),
        approvedGrants: [grant],
      });
    let loaded = await members.create(tenantScopeContext(tid), value);
    if (mode === 'DISABLED')
      loaded = await members.save(
        tenantScopeContext(tid),
        loaded.value.disable({
          expectedAuthorizationVersion: loaded.value.authorizationVersion,
          now: instant(Date.now()),
          reason: 'LOCAL_OWNER_TEST',
        }),
        loaded.revision,
      );
    if (mode === 'REVOKED')
      loaded = await members.save(
        tenantScopeContext(tid),
        loaded.value.revokeGrant({
          expectedAuthorizationVersion: loaded.value.authorizationVersion,
          now: instant(Date.now()),
          grantId: grant.id,
        }),
        loaded.revision,
      );
    await admin.query('INSERT INTO zhiban_academic.people VALUES($1,$2,$3)', [tid, value.id, name]);
    return { id: value.id, grant: grant.id, loaded, name, tid };
  };
  // More than 200 name matches with no eligible roles must still expose continuation.
  for (let i = 0; i < 201; i++) await seed('扫描继续学生' + i, 'STUDENT');
  const candidates = [];
  for (let i = 0; i < 620; i++)
    candidates.push(await seed('分页负责人' + String(i).padStart(4, '0')));
  const afterEmpty = await seed('扫描继续教师'),
    literal = await seed('百分%_负责人');
  const invalid = [];
  for (const mode of ['PENDING', 'DISABLED', 'REVOKED', 'FUTURE', 'EXPIRED'])
    invalid.push(await seed('受限' + mode, 'TEACHER', t, mode));
  const foreignTeacher = await seed('空间外负责人', 'TEACHER', otherTenant);
  const initialGrants = (
    await admin.query(
      'SELECT count(*)::int AS n FROM zhiban_identity.role_grants WHERE tenant_id=$1',
      [t],
    )
  ).rows[0].n;
  const params = { purpose: 'CREATE_COURSE', limit: '50' };
  const read = async (p: Record<string, string> = params, a = manager, tenant = t) => {
    const r = await http(
      `/api/zhiban/management/${tenant}/owner-candidates?` + new URLSearchParams(p),
      a,
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Dto;
  };
  const command = async (payload: unknown, key = v7()) =>
    http(`${base}/commands`, manager, payload, 'POST', { 'x-zhiban-command': key });
  const getCourse = async (code: string) => {
    const r = await http(`${base}/courses?q=` + encodeURIComponent(code), manager);
    assert.equal(r.status, 200);
    return (r.json as Dto).rows[0];
  };
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await read({ ...params, ...(cursor ? { cursor } : {}) });
    assert.ok(page.rows.length <= 50);
    for (const r of page.rows) {
      assert.ok(!seen.has(r.id));
      seen.add(r.id);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 623);
  assert.ok(seen.has(teacher.member));
  assert.ok(!seen.has(student.member));
  assert.ok(!seen.has(foreignTeacher.id));
  for (const x of invalid) assert.ok(!seen.has(x.id));
  assert.equal((await read({ ...params, q: literal.name })).rows[0].id, literal.id);
  assert.equal((await read({ ...params, q: literal.id.toUpperCase() })).rows[0].id, literal.id);
  const empty = await read({ ...params, q: '扫描继续' });
  assert.equal(empty.rows.length, 0);
  assert.ok(empty.nextCursor);
  assert.equal(
    (await read({ ...params, q: '扫描继续', cursor: empty.nextCursor })).rows[0].id,
    afterEmpty.id,
  );
  record(
    '623 current teachers traverse bounded pages without duplicates; tenant/status/grant/time filters, literal/full-ID search and empty-scan continuation',
  );
  for (const a of [teacher, student, foreign])
    assert.equal((await http(`${base}/owner-candidates?purpose=CREATE_COURSE`, a)).status, 403);
  assert.equal((await http(`${base}/owner-candidates?purpose=CREATE_COURSE`)).status, 401);
  const first = await read(params);
  for (const p of [
    {},
    { purpose: 'X' },
    { purpose: 'CREATE_COURSE', courseId: v7() },
    { purpose: 'EDIT_COURSE' },
    { purpose: 'CREATE_COURSE', limit: '500' },
    { ...params, cursor: first.nextCursor!, q: '其他' },
    { purpose: 'EDIT_COURSE', courseId: v7(), limit: '50', cursor: first.nextCursor! },
  ] as Record<string, string>[])
    assert.equal(
      (await http(`${base}/owner-candidates?` + new URLSearchParams(p), manager)).status,
      400,
    );
  assert.equal((await http(`${base}/teachers?purpose=CREATE_COURSE`, manager)).status, 400);
  assert.equal((await http(`${base}/teachers`, manager)).status, 400);
  assert.equal(
    (await http(`${base}/owner-candidates?purpose=EDIT_COURSE&courseId=${v7()}`, manager)).status,
    404,
  );
  record(
    'anonymous/non-admin/cross-space and invalid purposes/targets/limits/cursors fail; original teacher-context endpoint remains restricted',
  );
  // Frozen owner semantics: direct acknowledged command still admits an ACTIVE non-teacher.
  const old = await command({
    type: 'CREATE_COURSE',
    code: 'LEGACY_OWNER',
    name: '既有成员负责人课程',
    description: '保留合同',
    ownerMembershipId: student.member,
  });
  assert.equal(old.status, 200);
  const legacy = await getCourse('LEGACY_OWNER');
  assert.equal(legacy.owner_membership_id, student.member);
  assert.equal(
    (await command({ type: 'PUBLISH_COURSE', id: legacy.id, revision: legacy.revision })).status,
    200,
  );
  const foreignCourse = v7();
  await admin.query(
    "INSERT INTO zhiban_academic.courses VALUES($1,$2,'FOREIGN','外空间课程','',NULL,'DRAFT',0,1,$3,$3)",
    [otherTenant, foreignCourse, now],
  );
  assert.equal(
    (await http(`${base}/owner-candidates?purpose=EDIT_COURSE&courseId=${foreignCourse}`, manager))
      .status,
    404,
  );
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: manager.cookie!.split('=')[0],
      value: manager.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage(),
    errors: string[] = [],
    requests: string[] = [];
  await page.clock.install();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  const act = async (control: import('@playwright/test').Locator) => {
    const ack = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `${base}/commands` && r.request().method() === 'POST',
    );
    const refresh = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `${base}/courses` && r.request().method() === 'GET',
    );
    await control.click();
    assert.equal((await ack).status(), 200);
    await refresh;
    await expect(page.getByRole('button', { name: '刷新本页', exact: true })).toBeEnabled();
    await expect(
      page.getByLabel('编辑课程', { exact: true }).getByLabel('课程名称', { exact: true }),
    ).not.toBeVisible();
  };
  await page.goto(origin + `/zhiban?space=${t}`);
  await expect(page.getByRole('heading', { name: '教务管理', exact: true })).toBeVisible();
  const courses = () =>
    page
      .getByRole('navigation', { name: '教务分类' })
      .getByRole('button', { name: '课程', exact: true });
  await courses().click();
  await page.getByText('新建课程', { exact: true }).click();
  const create = page.getByLabel('新建课程', { exact: true });
  await create.getByLabel('课程编号', { exact: true }).fill('OWNER_UI');
  await create.getByLabel('课程名称', { exact: true }).fill('负责人选择演示课程');
  await create.getByText('选择课程负责人', { exact: true }).click();
  await expect(create.getByRole('button', { name: '下一页负责人', exact: true })).toBeEnabled();
  await create.getByRole('button', { name: '下一页负责人', exact: true }).click();
  await expect(create.getByRole('status')).toContainText('第 2 页');
  await create.getByRole('button', { name: '上一页负责人', exact: true }).click();
  await create.getByLabel('负责人每页条数', { exact: true }).selectOption('10');
  await expect(create.getByRole('status')).toContainText('第 1 页');
  const pick = async (scope: ReturnType<typeof page.getByLabel>, name: string) => {
    await scope.getByLabel('搜索课程负责人', { exact: true }).fill(name);
    await scope.getByRole('button', { name: '搜索负责人', exact: true }).click();
    await expect(
      scope.getByRole('button', { name: '选择负责人 ' + name, exact: true }),
    ).toBeVisible();
    await scope.getByRole('button', { name: '选择负责人 ' + name, exact: true }).click();
  };
  await pick(create, candidates[610].name);
  const rechecked = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/zhiban/workspace/${t}/courses`,
  );
  await page.clock.fastForward(60001);
  await rechecked;
  await expect(create.getByLabel('课程编号', { exact: true })).toHaveValue('OWNER_UI');
  await expect(
    create.getByText('当前负责人：' + candidates[610].name + ' · ' + candidates[610].id, {
      exact: true,
    }),
  ).toBeVisible();
  record(
    'minute identity/space/admin recheck preserves active course filters, form values and selected owner',
  );
  await act(create.getByRole('button', { name: '创建课程', exact: true }));
  await expect(page.getByText('操作已完成。', { exact: true })).toBeVisible();
  const course = await getCourse('OWNER_UI');
  assert.equal(course.owner_membership_id, candidates[610].id);
  assert.equal(requests.filter((p) => p.startsWith('/api/zhiban/academic/')).length, 0);
  record(
    'trusted HTTPS inline admin course form searches and paginates independent teacher candidates and creates with explicit owner; no legacy snapshot',
  );
  const find = async (code: string) => {
    await page.getByLabel('搜索课程', { exact: true }).fill(code);
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.locator('.management-list > article')).toHaveCount(1);
    await expect(page.locator('.management-list > article')).toContainText(code);
  };
  const edit = async () => {
    await page.getByText('编辑课程', { exact: true }).click();
    return page.getByLabel('编辑课程', { exact: true });
  };
  await find('LEGACY_OWNER');
  let editor = await edit();
  await editor.getByLabel('课程简介', { exact: true }).fill('原负责人保留');
  await act(editor.getByRole('button', { name: '保存课程', exact: true }));
  await expect(page.getByText('操作已完成。', { exact: true })).toBeVisible();
  assert.equal((await getCourse('LEGACY_OWNER')).owner_membership_id, student.member);
  await act(page.getByRole('button', { name: '发布课程', exact: true }));
  await expect(page.getByRole('button', { name: '发布课程', exact: true })).toHaveCount(0);
  editor = await edit();
  await editor.getByText('选择课程负责人', { exact: true }).click();
  await pick(editor, candidates[611].name);
  await editor.getByRole('button', { name: '保留原负责人', exact: true }).click();
  await act(editor.getByRole('button', { name: '保存课程', exact: true }));
  await expect(page.getByText('操作已完成。', { exact: true })).toBeVisible();
  assert.equal((await getCourse('LEGACY_OWNER')).owner_membership_id, student.member);
  editor = await edit();
  await editor.getByText('选择课程负责人', { exact: true }).click();
  await pick(editor, candidates[611].name);
  await act(editor.getByRole('button', { name: '保存课程', exact: true }));
  await expect(page.getByText('操作已完成。', { exact: true })).toBeVisible();
  assert.equal((await getCourse('LEGACY_OWNER')).owner_membership_id, candidates[611].id);
  let versions = await admin.query(
    'SELECT owner_membership_id FROM zhiban_academic.course_versions WHERE tenant_id=$1 AND id=$2 ORDER BY version',
    [t, legacy.id],
  );
  assert.ok(versions.rows.every((r) => r.owner_membership_id === student.member));
  await act(page.getByRole('button', { name: '发布课程', exact: true }));
  await expect(page.getByRole('button', { name: '发布课程', exact: true })).toHaveCount(0);
  versions = await admin.query(
    'SELECT owner_membership_id FROM zhiban_academic.course_versions WHERE tenant_id=$1 AND id=$2 ORDER BY version',
    [t, legacy.id],
  );
  assert.equal(versions.rows.at(-1).owner_membership_id, candidates[611].id);
  assert.equal(versions.rows[0].owner_membership_id, student.member);
  editor = await edit();
  await editor.getByText('选择课程负责人', { exact: true }).click();
  await editor.getByRole('button', { name: '清除负责人', exact: true }).click();
  await act(editor.getByRole('button', { name: '保存课程', exact: true }));
  await expect(page.getByText('操作已完成。', { exact: true })).toBeVisible();
  assert.equal((await getCourse('LEGACY_OWNER')).owner_membership_id, null);
  record(
    'edit preserves existing non-teacher owner, supports restore/replacement/explicit null; published versions retain original owners until new publication',
  );
  await find('OWNER_UI');
  editor = await edit();
  await editor.getByText('选择课程负责人', { exact: true }).click();
  await pick(editor, candidates[612].name);
  await editor.getByLabel('课程简介', { exact: true }).fill('撤权后保留输入');
  const revoked = candidates[612];
  await members.save(
    tenantScopeContext(t),
    revoked.loaded.value.revokeGrant({
      expectedAuthorizationVersion: revoked.loaded.value.authorizationVersion,
      now: instant(Date.now()),
      grantId: revoked.grant,
    }),
    revoked.loaded.revision,
  );
  const writes = () => requests.filter((p) => p === `${base}/commands`).length;
  const count = writes();
  await editor.getByRole('button', { name: '保存课程', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('不在有效候选');
  assert.equal(writes(), count);
  await expect(editor.getByLabel('课程简介', { exact: true })).toHaveValue('撤权后保留输入');
  assert.equal((await getCourse('OWNER_UI')).owner_membership_id, candidates[610].id);
  await editor.getByRole('button', { name: '保留原负责人', exact: true }).click();
  await act(editor.getByRole('button', { name: '保存课程', exact: true }));
  await expect(page.getByText('操作已完成。', { exact: true })).toBeVisible();
  record(
    'grant revoked after selection fails fresh exact-candidate preflight without a POST; inputs survive and original owner can be restored',
  );
  // Stop after preflight, disable membership, then forward original command through real HTTPS.
  editor = await edit();
  await editor.getByText('选择课程负责人', { exact: true }).click();
  await pick(editor, candidates[613].name);
  const inactive = candidates[613];
  await page.route(
    `**${base}/commands`,
    async (route) => {
      await members.save(
        tenantScopeContext(t),
        inactive.loaded.value.disable({
          expectedAuthorizationVersion: inactive.loaded.value.authorizationVersion,
          now: instant(Date.now()),
          reason: 'LOCAL_OWNER_RACE',
        }),
        inactive.loaded.revision,
      );
      const req = route.request(),
        r = await http(`${base}/commands`, manager, JSON.parse(req.postData()!), 'POST', {
          'x-zhiban-command': req.headers()['x-zhiban-command'],
        });
      await route.fulfill({
        status: r.status,
        contentType: 'application/json',
        body: JSON.stringify(r.json),
      });
    },
    { times: 1 },
  );
  await editor.getByRole('button', { name: '保存课程', exact: true }).click();
  await expect(page.getByText('成员不可用。请刷新名单。', { exact: true })).toBeVisible();
  assert.equal((await getCourse('OWNER_UI')).owner_membership_id, candidates[610].id);
  record(
    'membership disabled between preflight and POST is rejected by original guarded write; no owner change or partial success',
  );
  const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname === `${base}/courses`);
  await page.getByRole('button', { name: '刷新本页', exact: true }).click();
  await refreshed;
  await expect(
    page.getByLabel('编辑课程', { exact: true }).getByLabel('课程名称', { exact: true }),
  ).not.toBeVisible();
  editor = await edit();
  await editor.getByText('选择课程负责人', { exact: true }).click();
  await pick(editor, candidates[614].name);
  let key = '';
  await page.route(
    `**${base}/commands`,
    async (route) => {
      const req = route.request();
      key = req.headers()['x-zhiban-command'];
      assert.equal((await command(JSON.parse(req.postData()!), key)).status, 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await editor.getByRole('button', { name: '保存课程', exact: true }).click();
  await expect(page.getByRole('button', { name: '按原命令号重试', exact: true })).toBeVisible();
  await act(page.getByRole('button', { name: '按原命令号重试', exact: true }));
  await expect(page.getByText('操作已完成。', { exact: true })).toBeVisible();
  assert.equal((await getCourse('OWNER_UI')).owner_membership_id, candidates[614].id);
  const audits = await admin.query(
    'SELECT count(*)::int AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
    [t, key],
  );
  assert.equal(audits.rows[0].n, 1);
  record(
    'lost owner-edit ACK retains original command key and retries exactly one durable change/audit',
  );
  // Delayed candidate results must never refill a removed management page.
  editor = await edit();
  let release!: () => void, observed!: () => void;
  const gated = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (observed = r));
  await page.route(
    `**${base}/owner-candidates?**`,
    async (route) => {
      observed();
      await gated;
      await route.continue().catch(() => {});
    },
    { times: 1 },
  );
  await editor.getByText('选择课程负责人', { exact: true }).click();
  await entered;
  await page
    .getByRole('navigation', { name: '教务分类' })
    .getByRole('button', { name: '学期', exact: true })
    .click();
  await expect(page.getByLabel('搜索学期', { exact: true })).toBeVisible();
  release();
  await expect(page.getByLabel('搜索课程负责人', { exact: true })).toHaveCount(0);
  await courses().click();
  await page.getByText('新建课程', { exact: true }).click();
  await page
    .getByLabel('新建课程', { exact: true })
    .getByText('选择课程负责人', { exact: true })
    .click();
  await expect(
    page
      .getByLabel('新建课程', { exact: true })
      .getByRole('button', { name: '下一页负责人', exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  record(
    'detached candidate requests cannot backfill a different category; 390px layout and browser scripts pass',
  );
  const current = await getCourse('OWNER_UI');
  assert.equal(
    (await command({ type: 'ARCHIVE_COURSE', id: current.id, revision: current.revision })).status,
    200,
  );
  assert.equal(
    (await http(`${base}/owner-candidates?purpose=EDIT_COURSE&courseId=${current.id}`, manager))
      .status,
    409,
  );
  // Exactly the same fixed grant/assignment seed: selecting owners did not grant teaching.
  const permissions = await admin.query(
    'SELECT count(*)::int AS n FROM zhiban_academic.assignments WHERE tenant_id=$1 AND membership_id=ANY($2::uuid[])',
    [t, candidates.map((c) => c.id)],
  );
  assert.equal(permissions.rows[0].n, 0);
  assert.equal((await read({ ...params, q: candidates[614].id })).rows.length, 1);
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_identity.role_grants WHERE tenant_id=$1',
        [t],
      )
    ).rows[0].n,
    initialGrants,
  );
  record(
    'archived-course candidate target rejects; course owner changes create no teaching assignments or role grants',
  );
  await page.route(
    `**/api/zhiban/workspace/${t}/courses?limit=10`,
    (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FORBIDDEN' } }),
      }),
    { times: 1 },
  );
  await page.clock.fastForward(60001);
  await expect(
    page.getByText('暂时无法连接工作台。请确认本地服务正在运行。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('搜索课程负责人', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  record(
    'failed periodic administrator recheck clears the mounted course form instead of retaining candidate data',
  );
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录智伴', exact: true })).toBeVisible();
  await expect(page.getByLabel('搜索课程负责人', { exact: true })).toHaveCount(0);
  assert.equal((await http(`${base}/owner-candidates?purpose=CREATE_COURSE`, manager)).status, 401);
  record(
    'logout clears selected owner and candidate inputs and revokes direct candidate API access',
  );
  await context.close();
}
