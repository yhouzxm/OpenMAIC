/** Synthetic acceptance data only. Never imported by the installed runtime. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { expect, type Browser } from '@playwright/test';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresTenantRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/tenant';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '@/lib/zhiban/infrastructure/identity/credentials/password-screening';
import {
  User,
  Tenant,
  Membership,
  RoleGrant,
  instant,
  tenantScope,
  selfScope,
} from '@/lib/zhiban/domain/identity';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { prepareTrial } from '../zhiban-local/prepare-trial';
type Trial = Parameters<typeof prepareTrial>[0];
export async function verifyProductionTeaching(input: {
  pool: (role: string, database: string) => Pool;
  database: string;
  browser: Browser;
  origin: string;
  deliverAccounts?: (value: {
    workspace: string;
    accounts: { role: string; userId: string; password: string }[];
  }) => Promise<void>;
  call: (
    path: string,
    value?: unknown,
    cookie?: string,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: string; cookie: string }>;
}) {
  const { pool, database, browser, origin, call } = input,
    ids = new IdentityIds(),
    t = ids.nextTenantId(),
    foreign = ids.nextTenantId();
  const users = new PostgresIdentityRepository(pool('zhiban_control_runtime', database)),
    tenants = new PostgresTenantRepository(pool('zhiban_control_runtime', database)),
    members = new PostgresMembershipRepository(pool('zhiban_runtime', database)),
    credentials = new PostgresCredentialRepository(pool('zhiban_auth_runtime', database));
  const hasher = new Argon2PasswordHasher(
    new LocalCompromisedPasswordScreening(['installation-compromised-test-vector']),
  );
  for (const id of [t, foreign])
    await tenants.create(
      Tenant.create(
        id,
        id === t ? 'installation' : 'foreign',
        '正式宿主合成验收',
        instant(Date.now()),
      ),
    );
  const actors: Trial['actors'] = [];
  for (const [role, tenant] of [
    ['TEACHER', t],
    ['STUDENT', t],
    ['TENANT_ADMIN', t],
    ['TENANT_ADMIN', foreign],
    ['TENANT_ADMIN', t],
    ['STUDENT', t],
    ['STUDENT', t],
  ] as const) {
    const uid = ids.nextUserId(),
      password = randomBytes(32).toString('base64url'),
      at = instant(Date.now());
    await users.create(User.create(uid, at));
    await credentials.createPassword(uid, ids.nextCredentialId(), await hasher.hash(password), at, {
      actor: { kind: 'SERVICE', serviceCode: 'production_install_acceptance' },
      requestId: 'LOCAL_INSTALL_ACCEPTANCE',
      reason: 'SYSTEM_MAINTENANCE',
    });
    const grant = RoleGrant.create({
      id: ids.nextRoleGrantId(),
      roleCode: role,
      scope: role === 'STUDENT' ? selfScope() : tenantScope(),
      createdAt: at,
      validFrom: at,
      validUntil: null,
    });
    const member = Membership.create({
      id: ids.nextMembershipId(),
      userId: uid,
      tenantId: tenant,
      now: at,
    }).activatePending({ expectedAuthorizationVersion: 0, now: at, approvedGrants: [grant] });
    await members.create(tenantScopeContext(tenant), member);
    const login = await call('/api/zhiban/identity/login', { userId: uid, password });
    assert.equal(login.status, 200);
    const csrf = await call('/api/zhiban/identity/csrf', undefined, login.cookie);
    assert.equal(csrf.status, 200);
    actors.push({
      uid,
      password,
      member: member.id,
      grant: grant.id,
      tenant,
      cookie: login.cookie,
      csrf: JSON.parse(csrf.body).csrfToken,
    });
  }
  assert.equal((await call('/api/zhiban/platform', undefined, actors[1].cookie)).status, 403);
  const http: Trial['http'] = async (path, actor, value, method, extra) => {
    assert.ok(!method || method === 'GET' || method === 'POST');
    const r = await call(path, value, actor?.cookie, {
      ...(actor?.csrf ? { 'x-zhiban-csrf': actor.csrf } : {}),
      'x-zhiban-command': ids.nextCommandId().replaceAll('-', ''),
      ...extra,
    });
    return { status: r.status, json: r.body.startsWith('{') ? JSON.parse(r.body) : {} };
  };
  const records: string[] = [],
    trial = await prepareTrial({
      admin: pool('postgres', database),
      browser,
      actors,
      http,
      tenant: t,
      origin,
      record: (r) => records.push(r),
      contentEnabled: true,
      verifyExistingTeaching: false,
    });
  // Representative real pages, rather than repeating the entire classroom regression.
  for (const [actor, role] of [
    [actors[4], 'ADMIN'],
    [actors[0], 'TEACHER'],
    [actors[1], 'STUDENT'],
  ] as const) {
    const context = await browser.newContext(),
      page = await context.newPage();
    try {
      await page.goto(trial.urls.workspace);
      await page.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(actor.uid);
      await page.getByLabel('密码', { exact: true }).fill(actor.password);
      await page.getByRole('button', { name: '登录并进入', exact: true }).click();
      if (role === 'ADMIN')
        await expect(page.getByRole('heading', { name: '教务管理', exact: true })).toBeVisible();
      else {
        await page.getByRole('link', { name: '进入课程工作区', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: '试用课程：机电入门', exact: true }),
        ).toBeVisible();
      }
    } finally {
      await context.close();
    }
  }
  const teacher = await browser.newContext(),
    student = await browser.newContext();
  try {
    for (const [context, actor] of [
      [teacher, actors[0]],
      [student, actors[1]],
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
    const tp = await teacher.newPage(),
      sp = await student.newPage();
    const content = origin + `/zhiban/content?tenant=${t}&offering=${trial.offeringId}`;
    await tp.goto(content);
    await tp.getByRole('textbox', { name: '新内容标题', exact: true }).fill('正式宿主安装验收讲义');
    await tp.getByRole('button', { name: '新建内容', exact: true }).click();
    await tp.getByRole('button', { name: '添加文本框', exact: true }).click();
    await tp
      .getByRole('textbox', { name: '正文 1', exact: true })
      .fill('独立安装后通过受限 Bridge 发布的真实文本。');
    await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    await tp.getByRole('button', { name: '发布保存版本', exact: true }).click();
    await expect(tp.getByRole('button', { name: '撤回发布', exact: true })).toBeVisible();
    await sp.goto(content);
    await sp.getByRole('button', { name: '查看已发布', exact: true }).click();
    await expect(
      sp.getByText('独立安装后通过受限 Bridge 发布的真实文本。', { exact: false }),
    ).toBeVisible();
    await sp.goto(trial.urls.progress);
    await expect(
      sp
        .locator('.personal-activities')
        .getByText('教师反馈：步骤完整，建议补充复核依据。此反馈已正式发布。', { exact: true }),
    ).toBeVisible();
  } finally {
    await teacher.close();
    await student.close();
  }
  if (input.deliverAccounts)
    await input.deliverAccounts({
      workspace: trial.urls.workspace,
      accounts: [
        { role: 'TEACHER', userId: actors[0].uid, password: actors[0].password },
        { role: 'STUDENT', userId: actors[1].uid, password: actors[1].password },
        { role: 'ADMIN', userId: actors[2].uid, password: actors[2].password },
      ],
    });
  return {
    status: 'PASS',
    scope: 'SYNTHETIC_THREE_ROLE_COURSE_PUBLICATION_SUBMISSION_MANUAL_GRADE_AND_CONTENT_BRIDGE',
    records,
    student: { userId: actors[1].uid, password: actors[1].password, progress: trial.urls.progress },
  };
}
