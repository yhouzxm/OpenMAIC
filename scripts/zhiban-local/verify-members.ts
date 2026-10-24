/** LOCAL product journey over real Identity HTTP/PG16, no browser approval issuer. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import type { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { issueLocalAdmission, type Authority, type MemberControlConfig } from './member-authority';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  authority: Authority;
  composition: Awaited<ReturnType<typeof createIdentityComposition>>;
  control: Pool;
  operator: MemberControlConfig['operator'];
  subjects: Parameters<typeof prepareTrial>[0]['actors'];
};
// Response projections are checked at each trust boundary by assertions below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
export async function verifyMembers({
  admin,
  browser,
  actors,
  http,
  tenant,
  origin,
  record,
  trial,
  authority,
  composition,
  control,
  operator,
  subjects,
}: Input) {
  const [, , , foreign, manager] = actors,
    [subject, demo] = subjects;
  const base = `/api/zhiban/identity/tenants/${tenant}`;
  const issue = async (purpose: 'INVITE' | 'REACTIVATE', who = subject) => {
    const current = who.member
      ? (
          await admin.query(
            'SELECT repository_revision::text,authorization_version FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2',
            [tenant, who.member],
          )
        ).rows[0]
      : null;
    return issueLocalAdmission(
      authority,
      composition,
      control,
      operator,
      tenant,
      who.uid,
      purpose,
      current
        ? {
            id: who.member,
            revision: current.repository_revision,
            authorizationVersion: Number(current.authorization_version),
          }
        : null,
    );
  };
  const point = async (a = manager, id = subject.member, purpose?: string) => {
    const r = await http(
      `${base}/memberships/${id}?actorMembershipId=${a.member}${purpose ? '&consentPurpose=' + purpose : ''}`,
      a,
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const env = (p: View) => ({
    actorMembershipId: manager.member,
    expectedActorRevision: p.actorRevision,
    expectedActorAuthorizationVersion: p.actorAuthorizationVersion,
    expectedTenantRevision: p.tenantRevision,
  });
  const body = (p: View, extra: View = {}): View => ({
    ...env(p),
    expectedRevision: p.revision,
    expectedAuthorizationVersion: p.authorizationVersion,
    ...extra,
    password: manager.password,
  });
  const post = (action: string, payload: unknown, key = randomUUID(), a = manager) =>
    http(`${base}/memberships/${subject.member}/${action}`, a, payload, 'POST', {
      'idempotency-key': key,
    });
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]),
    errors: string[] = [];
  try {
    for (const [ctx, a] of [
      [contexts[0], manager],
      [contexts[1], subject],
    ] as const)
      await ctx.addCookies([
        {
          name: a.cookie!.split('=')[0],
          value: a.cookie!.split('=').slice(1).join('='),
          url: origin,
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
    const mp = await contexts[0].newPage(),
      sp = await contexts[1].newPage();
    for (const p of [mp, sp]) p.on('pageerror', (e) => errors.push(e.message));
    const admission = await issue('INVITE');
    await mp.goto(`${origin}/zhiban/admin/members?tenant=${tenant}`);
    await mp.getByLabel('已登记入驻引用', { exact: true }).fill(admission);
    await mp.getByLabel('邀请操作人当前密码', { exact: true }).fill(manager.password);
    const inviting = mp.waitForResponse(
      (r) => r.url().endsWith('/invitations') && r.request().method() === 'POST',
    );
    await mp.getByRole('button', { name: '创建待确认邀请', exact: true }).click();
    const ir = await inviting;
    assert.equal(ir.status(), 200);
    subject.member = (await ir.json()).effects[0].membershipId;
    assert.ok(subject.member);
    await expect(mp.getByText(/状态：PENDING/)).toBeVisible();
    assert.equal(
      (
        await http(
          `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/activities`,
          subject,
        )
      ).status,
      403,
    );
    await sp.goto(`${origin}/zhiban/join?tenant=${tenant}&admission=${admission}`);
    await sp.getByRole('button', { name: '本人同意该加入请求', exact: true }).click();
    await expect(sp.getByRole('status')).toContainText('操作已确认');
    assert.equal((await point()).status, 'PENDING');
    await mp.getByRole('button', { name: '读取最新成员状态', exact: true }).click();
    await expect(mp.getByRole('button', { name: '激活并授予所选角色', exact: true })).toBeVisible();
    await mp.getByLabel('操作人当前密码', { exact: true }).fill(manager.password);
    await mp.getByRole('button', { name: '激活并授予所选角色', exact: true }).click();
    await expect(mp.getByText(/状态：ACTIVE/)).toBeVisible();
    const enrolled = await http(`/api/zhiban/management/${tenant}/commands`, manager, {
      type: 'ENROLL',
      offeringId: trial.offeringId,
      membershipId: subject.member,
      revision: null,
    });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.json));
    await sp.goto(`${origin}/zhiban?space=${tenant}`);
    await expect(sp.getByRole('link', { name: '进入课程工作区', exact: true })).toBeVisible();
    assert.equal(
      (
        await http(
          `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/activities`,
          subject,
        )
      ).status,
      200,
    );
    await mp.screenshot({
      path: 'docs/v2/evidence/zhiban-member-management-local.png',
      fullPage: true,
    });
    record(
      'MEMBER journey: signed LOCAL synthetic admission -> admin invite -> target consent stays PENDING -> fresh admin activation -> independent Enrollment -> student course access',
    );
    // Scope/identity barriers stay server-enforced even when a client bypasses disabled UI options.
    let p = await point();
    const teacher = body(p, {
      grant: { roleCode: 'TEACHER', scope: { type: 'TENANT', scopeId: null }, validUntil: null },
    });
    const deniedTeacher = await post('grant', teacher);
    assert.ok([403, 503].includes(deniedTeacher.status), JSON.stringify(deniedTeacher.json));
    assert.equal((await point()).revision, p.revision);
    assert.ok(!(await point()).grants.some((g: View) => g.roleCode === 'TEACHER')); // Frozen missing-capability paths may report UNAVAILABLE.
    assert.ok(
      [403, 404].includes(
        (
          await http(
            `${base}/memberships/${subject.member}?actorMembershipId=${foreign.member}`,
            foreign,
          )
        ).status,
      ),
    );
    assert.ok(
      [403, 404].includes(
        (await http(`${base}/consent-context?admissionId=${admission}`, manager)).status,
      ),
    );
    const demoAdmission = await issue('INVITE', demo);
    const refusedInvite = await http(
      base + '/invitations',
      subject,
      {
        actorMembershipId: subject.member,
        expectedActorRevision: p.revision,
        expectedActorAuthorizationVersion: p.authorizationVersion,
        expectedTenantRevision: p.tenantRevision,
        admissionId: demoAdmission,
        password: subject.password,
      },
      'POST',
      { 'idempotency-key': randomUUID() },
    );
    assert.ok([403, 503].includes(refusedInvite.status), JSON.stringify(refusedInvite.json));
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) FROM zhiban_identity.memberships WHERE tenant_id=$1 AND user_id=$2',
            [tenant, demo.uid],
          )
        ).rows[0].count,
      ),
      0,
    );
    await expect(mp.getByRole('option', { name: /教师/ })).toHaveCount(0);
    // Two identical CAS proposals, distinct command IDs: one state transition only.
    const beforeCount = Number(
      (
        await admin.query(
          'SELECT count(*) FROM zhiban_identity.audit_events WHERE subject_membership_id=$1',
          [subject.member],
        )
      ).rows[0].count,
    );
    const race = await Promise.all([
      post('disable', body(p, { reason: 'ADMIN_REQUEST' })),
      post('disable', body(p, { reason: 'ADMIN_REQUEST' })),
    ]);
    assert.equal(race.filter((r) => r.status === 200).length, 1, JSON.stringify(race));
    assert.ok(race.some((r) => [409, 503].includes(r.status))); // Frozen internal CAS refusals can normalize as unavailable; state/effect checks prove the winner.
    assert.equal((await point()).status, 'DISABLED');
    assert.equal(
      (
        await http(
          `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/activities`,
          subject,
        )
      ).status,
      403,
    );
    const spaces = (await http('/api/zhiban/identity/spaces', subject)).json as View;
    assert.ok(spaces.spaces.length > 0);
    assert.ok(!spaces.spaces.some((s: View) => s.tenantId === tenant));
    assert.equal((await http('/api/zhiban/identity/me', subject)).status, 200);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) FROM zhiban_identity.audit_events WHERE subject_membership_id=$1',
            [subject.member],
          )
        ).rows[0].count,
      ),
      beforeCount + 1,
    );
    const restore = await issue('REACTIVATE');
    await sp.goto(`${origin}/zhiban/join?tenant=${tenant}&admission=${restore}`);
    await sp.getByRole('button', { name: '本人同意该加入请求', exact: true }).click();
    await expect(sp.getByRole('status')).toContainText('操作已确认');
    await mp.getByRole('button', { name: '读取最新成员状态', exact: true }).click();
    await expect(
      mp.getByRole('button', { name: '恢复并重新授予所选角色', exact: true }),
    ).toBeVisible();
    await mp.getByLabel('操作人当前密码', { exact: true }).fill(manager.password);
    await mp.getByRole('button', { name: '恢复并重新授予所选角色', exact: true }).click();
    await expect(mp.getByText(/状态：ACTIVE/)).toBeVisible();
    assert.equal(
      (
        await http(
          `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/activities`,
          subject,
        )
      ).status,
      200,
    );
    record(
      'MEMBER authorization/concurrency: teacher and non-self consent/admin/tenant escalation refused; competing disable CAS has one winner/audit; disabled space denied with global Session and other space live; new admission+consent restores allowed role',
    );
    // Wait for the exact response revision, so an old success notice cannot satisfy a new write.
    async function clickRole(name: string, action: string) {
      const response = mp.waitForResponse(
        (r) => r.url().endsWith('/' + action) && r.request().method() === 'POST',
      );
      await mp.getByRole('button', { name, exact: true }).click();
      const r = await response;
      assert.equal(r.status(), 200);
      const revision = (await r.json()).effects[0].revision;
      await expect(mp.getByText(new RegExp('修订：' + revision + ' ·'))).toBeVisible();
    }
    await mp.getByLabel('操作人当前密码', { exact: true }).fill(manager.password);
    mp.once('dialog', (d) => void d.accept());
    await clickRole('以所选角色替换全部授权', 'replace-grants');
    const previous = (await point()).grants[0].grantId;
    await mp.getByLabel('操作人当前密码', { exact: true }).fill(manager.password);
    await clickRole('撤销授权 ' + previous, 'revoke-grant');
    assert.equal((await point()).grants.length, 0);
    await mp.getByLabel('操作人当前密码', { exact: true }).fill(manager.password);
    await clickRole('授予所选角色', 'grant');
    assert.equal((await point()).grants.length, 1);
    // Simulate a lost HTTP acknowledgement after a real committed Identity write.
    const rolePath = `${base}/memberships/${subject.member}/replace-grants`;
    let lostKey = '';
    await mp.route(origin + rolePath, async (route) => {
      lostKey = route.request().headers()['idempotency-key'];
      const r = await http(rolePath, manager, route.request().postDataJSON(), 'POST', {
        'idempotency-key': lostKey,
      });
      assert.equal(r.status, 200);
      await route.abort('failed');
    });
    await mp.getByLabel('操作人当前密码', { exact: true }).fill(manager.password);
    mp.once('dialog', (d) => void d.accept());
    await mp.getByRole('button', { name: '以所选角色替换全部授权', exact: true }).click();
    await expect(
      mp.getByRole('button', { name: '读取当前版本并确认原操作', exact: true }),
    ).toBeVisible();
    await expect(mp.getByLabel('操作人当前密码', { exact: true })).toHaveValue('');
    const ackRevision = (await point()).revision;
    await mp.unroute(origin + rolePath);
    await mp.getByLabel('操作人当前密码', { exact: true }).fill(manager.password);
    await clickRole('读取当前版本并确认原操作', 'replace-grants');
    assert.equal((await point()).revision, ackRevision);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) FROM zhiban_identity.identity_tenant_commands WHERE idempotency_key=$1',
            [lostKey],
          )
        ).rows[0].count,
      ),
      1,
    );
    record(
      'MEMBER roles UI: full explicit replacement, grant-ID revocation and renewed STUDENT/SELF grant; real committed write with simulated ACK loss clears password and confirms current version without another effect; no teacher assignment shortcut or self-management button',
    );
    // Fail after domain mutation/audit, before the durable effect; everything must roll back.
    p = await point();
    const key = randomUUID(),
      intent = body(p, {
        grants: [
          {
            roleCode: 'STUDENT',
            scope: { type: 'SELF', scopeId: null },
            validUntil: Date.now() + 3600000,
          },
        ],
      });
    await admin.query(
      `CREATE FUNCTION zhiban_identity.local_member_effect_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_MEMBER_FAULT'; END $$`,
    );
    await admin.query(
      'CREATE TRIGGER local_member_effect_failure BEFORE INSERT ON zhiban_identity.identity_tenant_command_effects FOR EACH ROW EXECUTE FUNCTION zhiban_identity.local_member_effect_failure()',
    );
    try {
      assert.equal((await post('replace-grants', intent, key)).status, 503);
      assert.equal((await point()).revision, p.revision);
      assert.equal(
        Number(
          (
            await admin.query(
              'SELECT count(*) FROM zhiban_identity.identity_tenant_commands WHERE idempotency_key=$1',
              [key],
            )
          ).rows[0].count,
        ),
        0,
      );
    } finally {
      await admin.query(
        'DROP TRIGGER local_member_effect_failure ON zhiban_identity.identity_tenant_command_effects',
      );
      await admin.query('DROP FUNCTION zhiban_identity.local_member_effect_failure()');
    }
    const applied = await post('replace-grants', intent, key);
    assert.equal(applied.status, 200, JSON.stringify(applied.json));
    assert.equal((await post('replace-grants', intent, key)).status, 409);
    p = await point();
    const confirmed = await post('replace-grants', body(p, { grants: intent.grants }), key);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal((await point()).revision, p.revision);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) FROM zhiban_identity.identity_tenant_commands WHERE idempotency_key=$1',
            [key],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.deepEqual(errors, []);
    await sp.screenshot({
      path: 'docs/v2/evidence/zhiban-member-student-local.png',
      fullPage: true,
    });
    record(
      'MEMBER atomicity/confirmation: effect fault rolls back state/audit/ledger; original key retries once; stale original body refused; current-version same-intent confirmation creates no second effect',
    );
    // Existing second administrator transfers its authority in one two-target transaction.
    const transferContext = await browser.newContext();
    try {
      const from = actors[2],
        to = actors[5];
      // The profile journey deliberately revoked this auxiliary account's sessions.
      const freshLogin = await http('/api/zhiban/identity/login', undefined, {
        userId: from.uid,
        password: from.password,
      });
      assert.equal(freshLogin.status, 200);
      from.cookie = (freshLogin as unknown as { cookie: string }).cookie;
      await transferContext.addCookies([
        {
          name: from.cookie!.split('=')[0],
          value: from.cookie!.split('=').slice(1).join('='),
          url: origin,
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
      const tp = await transferContext.newPage();
      await tp.goto(`${origin}/zhiban/admin/members?tenant=${tenant}&member=${from.member}`);
      await tp.getByLabel('接任成员ID', { exact: true }).fill(to.member);
      await tp.getByLabel('操作人当前密码', { exact: true }).fill(from.password);
      tp.once('dialog', (d) => void d.accept());
      const transfer = tp.waitForResponse(
        (r) => r.url().endsWith('/admin-transfer') && r.request().method() === 'POST',
      );
      await tp.getByRole('button', { name: '原子交接管理员授权', exact: true }).click();
      assert.equal((await transfer).status(), 200);
      await expect(
        tp.getByRole('heading', { name: '管理员授权交接已提交', exact: true }),
      ).toBeVisible();
      const state = await admin.query(
        "SELECT membership_id FROM zhiban_identity.role_grants WHERE tenant_id=$1 AND membership_id=ANY($2::uuid[]) AND role_code='TENANT_ADMIN' AND revoked_at IS NULL",
        [tenant, [from.member, to.member]],
      );
      assert.deepEqual(
        state.rows.map((r) => r.membership_id),
        [to.member],
      );
    } finally {
      await transferContext.close();
    }
    record(
      'MEMBER admin transfer UI: one two-target transaction grants successor and removes current authority; explicit success remains visible after actor loses management permission',
    );
    await writeFile(
      authority.root + '/member-inputs.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          syntheticAuthority: true,
          tenant,
          adminUrl: `${origin}/zhiban/admin/members?tenant=${tenant}`,
          admissionId: demoAdmission,
          joinUrl: `${origin}/zhiban/join?tenant=${tenant}&admission=${demoAdmission}`,
          subject: { userId: demo.uid, password: demo.password },
          managedSubject: {
            userId: subject.uid,
            password: subject.password,
            membershipId: subject.member,
          },
          preparer:
            'pnpm exec tsx scripts/zhiban-local/prepare-member-admission.ts TENANT USER INVITE|REACTIVATE|REJOIN [MEMBER]',
          expiresWithinMinutes: 30,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await writeFile(
      'docs/v2/evidence/zhiban-membership-journey-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          scope: 'LOCAL_REGISTERED_USER_SPACE_MEMBERSHIP_AND_ALLOWED_ROLES',
          tenant,
          member: subject.member,
          adminUrl: `${origin}/zhiban/admin/members?tenant=${tenant}&member=${subject.member}`,
          privateInputFile: authority.root + '/member-inputs.json',
          checks: 5,
          at: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    for (const [i, c] of contexts.entries()) {
      const p = c.pages()[0];
      if (p) {
        await p
          .screenshot({
            path: `docs/v2/evidence/member-management/failure-${i}.png`,
            fullPage: true,
          })
          .catch(() => {});
        await writeFile(
          `/tmp/zhiban-member-ui-failure-${i}.txt`,
          await p
            .locator('body')
            .innerText()
            .catch(() => ''),
          { mode: 0o600 },
        );
      }
    }
    throw error;
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
}
