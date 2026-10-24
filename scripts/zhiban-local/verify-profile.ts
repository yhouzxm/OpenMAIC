/** LOCAL profile/directory product journey; synthetic credentials never appear in evidence. */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import { loadProfile } from './profile';
// Responses are narrowed by assertions at each boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  runtime: Pool;
};
export async function verifyProfile({
  admin,
  browser,
  actors,
  http,
  tenant,
  origin,
  record,
  runtime,
}: Input) {
  const [teacher, student, outsider, foreign, manager] = actors;
  const base = `/api/zhiban/profile/${tenant}`;
  const call = (command: unknown, actor = student, scope = 'me', key = randomUUID()) =>
    http(`${base}/${scope}`, actor, command, 'POST', { 'x-zhiban-command': key });
  const read = async (actor = student, path = '/me') => {
    const r = await http(base + path, actor);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const initial = await read();
  const command = {
    type: 'SAVE_PROFILE',
    revision: initial.revision,
    displayName: '陈同学',
    email: 'student@example.invalid',
    qq: '123456',
    wechat: 'classroom-student',
    bio: '机电学习者\n只对本人可见',
  };
  const key = randomUUID();
  assert.equal((await call(command, student, 'me', key)).status, 200);
  assert.equal((await call(command, student, 'me', key)).status, 200);
  assert.equal((await call({ ...command, bio: 'changed' }, student, 'me', key)).status, 409);
  assert.equal((await call(command)).status, 409);
  assert.equal((await read()).email, command.email);
  for (const field of ['userId', 'membershipId', 'formalName', 'studentNo', 'status', 'roles'])
    assert.equal((await call({ ...command, [field]: 'forged' })).status, 400);
  assert.equal((await http(base + '/me?membershipId=' + teacher.member, student)).status, 400);
  assert.equal((await http(base + '/members', student)).status, 403);
  assert.equal((await http(base + '/members', teacher)).status, 403);
  assert.equal((await http(base + '/me', foreign)).status, 403);
  assert.equal((await http(base + '/me')).status, 401);
  const directory = {
    type: 'SAVE_DIRECTORY',
    revision: null,
    membershipId: student.member,
    formalName: '陈同学正式姓名',
    studentNo: 'P3-ST-001',
    employeeNo: '',
  };
  assert.equal((await call(directory, student, 'members')).status, 403);
  assert.equal((await call(directory, manager, 'me')).status, 400);
  assert.equal(
    (await call({ ...directory, membershipId: foreign.member }, manager, 'members')).status,
    404,
  );
  assert.equal((await call(directory, manager, 'members')).status, 200);
  assert.equal(
    (
      await call(
        { ...directory, membershipId: teacher.member, studentNo: 'p3-st-001' },
        manager,
        'members',
      )
    ).status,
    409,
  );
  assert.equal((await read()).formalName, directory.formalName);
  const found = await read(manager, '/members?q=P3-ST-001&role=STUDENT&limit=10');
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].membershipId, student.member);
  assert.equal(JSON.stringify(found).includes(command.email), false);
  for (const k of ['email', 'qq', 'wechat', 'bio', 'password'])
    assert.equal(Object.hasOwn(found.rows[0], k), false);
  record(
    'PROFILE authorization/privacy: self only; admin formal records; tenant and role boundaries; contacts absent from member directory; unique business numbers',
  );

  const fresh = await read();
  const race = await Promise.all([
    call({ ...command, revision: fresh.revision, bio: '并发一' }),
    call({ ...command, revision: fresh.revision, bio: '并发二' }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const before = await read();
  const cutKey = randomUUID(),
    cut = { ...command, revision: before.revision, displayName: '不应留下的名字' };
  await admin.query(
    "CREATE FUNCTION public.local_profile_cut() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_PROFILE_CUT'; END $$; CREATE TRIGGER local_profile_cut BEFORE INSERT ON zhiban_profile.commands FOR EACH ROW EXECUTE FUNCTION public.local_profile_cut()",
  );
  try {
    assert.equal((await call(cut, student, 'me', cutKey)).status, 503);
    assert.deepEqual(await read(), before);
  } finally {
    await admin.query(
      'DROP TRIGGER local_profile_cut ON zhiban_profile.commands; DROP FUNCTION public.local_profile_cut()',
    );
  }
  assert.equal((await call(cut, student, 'me', cutKey)).status, 200);
  assert.equal((await call(cut, student, 'me', cutKey)).status, 200);
  assert.equal(
    (
      await admin.query(
        'SELECT display_name FROM zhiban_academic.people WHERE tenant_id=$1 AND membership_id=$2',
        [tenant, student.member],
      )
    ).rows[0].display_name,
    cut.displayName,
  );
  assert.equal((await call({ ...command, revision: (await read()).revision })).status, 200);
  record(
    'PROFILE atomicity/CAS: one concurrent winner; ledger failure rolls back private and public names; original-key retry and replay remain single effect',
  );

  const first = await read(manager, '/members?limit=10&state=ALL');
  if (first.nextCursor) {
    const next = await read(manager, `/members?limit=10&state=ALL&cursor=${first.nextCursor}`);
    assert.equal(
      next.rows.some((r: View) => first.rows.some((p: View) => p.membershipId === r.membershipId)),
      false,
    );
    assert.equal(
      (await http(base + `/members?limit=20&state=ALL&cursor=${first.nextCursor}`, manager)).status,
      400,
    );
    assert.equal(
      (await http(base + `/members?limit=10&state=ALL&cursor=${first.nextCursor}x`, manager))
        .status,
      400,
    );
  }
  assert.equal((await http(base + '/members?limit=9999', manager)).status, 400);
  assert.equal((await http(base + '/members?role=GLOBAL_ADMIN', manager)).status, 400);
  const conn = await runtime.connect();
  try {
    await conn.query('BEGIN');
    await conn.query("SELECT set_config('app.tenant_id',$1,true)", [foreign.tenant]);
    assert.equal(
      (await conn.query('SELECT * FROM zhiban_profile.profiles WHERE tenant_id=$1', [tenant]))
        .rowCount,
      0,
    );
    await assert.rejects(
      conn.query("UPDATE zhiban_identity.memberships SET status='DISABLED' WHERE tenant_id=$1", [
        tenant,
      ]),
      /permission denied/,
    );
    await conn.query('ROLLBACK');
  } finally {
    await conn.query('ROLLBACK');
    conn.release();
  }
  assert.equal(await loadProfile(runtime), true);
  await admin.query('GRANT DELETE ON zhiban_profile.profiles TO zhiban_academic_runtime');
  try {
    await assert.rejects(loadProfile(runtime), /catalog\/ACL rejected/);
  } finally {
    await admin.query('REVOKE DELETE ON zhiban_profile.profiles FROM zhiban_academic_runtime');
  }
  const originalHash = (
    await admin.query("SELECT checksum FROM zhiban_profile.schema_migrations WHERE version='0001'")
  ).rows[0].checksum;
  await admin.query(
    "UPDATE zhiban_profile.schema_migrations SET checksum=$1 WHERE version='0001'",
    ['0'.repeat(64)],
  );
  try {
    await assert.rejects(loadProfile(runtime), /ledger\/catalog\/ACL rejected/);
  } finally {
    await admin.query(
      "UPDATE zhiban_profile.schema_migrations SET checksum=$1 WHERE version='0001'",
      [originalHash],
    );
  }
  assert.equal(await loadProfile(runtime), true);
  record(
    'PROFILE paging/ACL: bounded signed pages, filter and tamper refusal, tenant RLS and no Identity mutation privileges; widened ACL and wrong ledger refused, exact expected profile restored',
  );

  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const errors: string[] = [];
  try {
    for (const [context, actor] of [
      [contexts[0], student],
      [contexts[1], manager],
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
    const sp = await contexts[0].newPage(),
      mp = await contexts[1].newPage();
    for (const p of [sp, mp]) p.on('pageerror', (e) => errors.push(e.message));
    await sp.goto(`${origin}/zhiban/profile?tenant=${tenant}`);
    await expect(sp.getByLabel('显示名', { exact: true })).toHaveValue('陈同学');
    await sp.getByLabel('个人简介', { exact: true }).fill('本地试用：资料保存与正式学号已验证。');
    sp.once('dialog', (d) => void d.dismiss());
    await sp.getByRole('link', { name: '返回当前空间工作台', exact: true }).click();
    await expect(sp.getByLabel('个人简介', { exact: true })).toHaveValue(
      '本地试用：资料保存与正式学号已验证。',
    );
    await sp.getByRole('button', { name: '保存个人资料', exact: true }).click();
    await expect(sp.getByRole('status')).toHaveText('保存已确认。');
    await sp.reload();
    await expect(sp.getByLabel('个人简介', { exact: true })).toHaveValue(
      '本地试用：资料保存与正式学号已验证。',
    );
    await expect(sp.getByText('正式姓名：陈同学正式姓名', { exact: true })).toBeVisible();
    await mp.goto(`${origin}/zhiban/admin/accounts?tenant=${tenant}`);
    await expect(mp.getByRole('link', { name: '成员账户目录', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await mp.getByLabel('搜索成员', { exact: true }).fill('P3-ST-001');
    await mp.getByRole('button', { name: '查询成员', exact: true }).click();
    await expect(mp.locator('article[data-member-id]')).toHaveCount(1);
    const card = mp.locator(`article[data-member-id="${student.member}"]`);
    await card.getByText('维护正式档案', { exact: true }).click();
    await card.getByLabel('正式姓名', { exact: true }).fill('陈同学');
    await card.getByRole('button', { name: '保存正式档案', exact: true }).click();
    await expect(mp.getByRole('status')).toHaveText('保存已确认。');
    await sp.getByRole('button', { name: '读取最新资料', exact: true }).click();
    await expect(sp.getByText('正式姓名：陈同学', { exact: true })).toBeVisible();
    await sp.screenshot({ path: 'docs/v2/evidence/zhiban-profile-self-local.png', fullPage: true });
    await mp.screenshot({
      path: 'docs/v2/evidence/zhiban-profile-directory-local.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
  record(
    'PROFILE browser journey: student edit/save/refresh + cancelled leave; admin search/update formal record; student readonly official fields; no page errors',
  );

  const auxiliary = outsider; // Not one of the delivered three demo accounts.
  const passwordState = (await http('/api/zhiban/identity/password', auxiliary)).json as View;
  const newPassword = randomBytes(30).toString('base64url');
  assert.equal(
    (
      await http('/api/zhiban/identity/password', auxiliary, {
        password: auxiliary.password,
        newPassword,
        expectedCredentialRevision: passwordState.credentialRevision,
      })
    ).status,
    204,
  );
  assert.equal((await http('/api/zhiban/identity/me', auxiliary)).status, 401);
  assert.equal(
    (
      await http('/api/zhiban/identity/login', undefined, {
        userId: auxiliary.uid,
        password: auxiliary.password,
      })
    ).status,
    401,
  );
  auxiliary.password = newPassword;
  const login = (await http('/api/zhiban/identity/login', undefined, {
    userId: auxiliary.uid,
    password: newPassword,
  })) as unknown as { status: number; cookie: string };
  assert.equal(login.status, 200);
  auxiliary.cookie = login.cookie;
  auxiliary.csrf = ((await http('/api/zhiban/identity/csrf', auxiliary)).json as View).csrfToken;
  assert.equal(
    (await http('/api/zhiban/identity/logout-all', auxiliary, { password: newPassword })).status,
    204,
  );
  assert.equal((await http('/api/zhiban/identity/me', auxiliary)).status, 401);
  record(
    'PROFILE own account security: existing password CAS and logout-all endpoints; old password/session rejected; synthetic auxiliary account only',
  );
  await writeFile(
    'docs/v2/evidence/zhiban-profile-journey-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        groups: 5,
        scope: ['SELF_PROFILE', 'ADMIN_MEMBER_DIRECTORY', 'OWN_ACCOUNT_SECURITY'],
        excluded: [
          'ACCOUNT_PROVISIONING',
          'IDENTITY_STATE_OR_ROLE_MUTATION',
          'NATIVE_RUNTIME_ACTIVATION',
          'NATIVE_REFRESH_CLOSE_MANUAL_SIGNOFF',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}
