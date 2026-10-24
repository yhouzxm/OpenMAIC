/** Real PG16/Identity/control journey; negative metadata and audit faults are owned-fixture only. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import type { MemberControlConfig, Authority } from './member-authority';
import { issueLocalAdmission } from './member-authority';
import { approveLocalAccount, loadAccountEnvelope, revokeLocalAccount } from './account-authority';
import { loadOnboarding } from './onboarding';
import { OrdinaryCredentials } from '../../lib/zhiban/infrastructure/onboarding/credentials';
import { Argon2PasswordHasher } from '../../lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '../../lib/zhiban/infrastructure/identity/credentials/password-screening';
import { userId } from '../../lib/zhiban/domain/identity';
import { createIdentityComposition } from '../../lib/zhiban/infrastructure/identity/composition/root';
import { localAuthorityStore } from './member-authority';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: Pool;
  authPool: Pool;
  tenantPool: Pool;
  control: Pool;
  authority: Authority;
  ordinaryCredentials: OrdinaryCredentials;
};
// Fixture response projection only; authorization and secrets never derive from this cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
export async function verifyOnboarding(input: Input) {
  const {
    admin,
    businessPool,
    authPool,
    tenantPool,
    control,
    authority,
    ordinaryCredentials,
    browser,
    http,
    actors: [teacher, student, outsider, foreign, manager],
    tenant: t,
    origin,
    record,
    trial,
  } = input;
  const base = `/api/zhiban/onboarding/${t}/requests`,
    setup = '/api/zhiban/onboarding/claim';
  const cfg = JSON.parse(
      await readFile(join(authority.root, 'member-control.json'), 'utf8'),
    ) as MemberControlConfig,
    pools = { auth: authPool, tenant: tenantPool, control, business: businessPool };
  const cast = (v: unknown) => v as View;
  const ok = async (
    path: string,
    actor: typeof manager | undefined,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const r = await http(path, actor, body, body ? 'POST' : 'GET', extra);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r as typeof r & { cookie?: string };
  };
  const request = async (name: string) =>
    cast(
      (
        await ok(base, manager, {
          type: 'REQUEST_ACCOUNT',
          name,
          subjectReference: 'LOCAL-SYNTHETIC-' + name,
          requestedRole: 'STUDENT',
        })
      ).json,
    );
  const point = async (id: string) =>
    (await admin.query('SELECT *,revision::text FROM zhiban_onboarding.requests WHERE id=$1', [id]))
      .rows[0];
  const approve = (id: string, reissue = false) => approveLocalAccount(cfg, pools, id, reissue);
  const delivery = async (file: string) =>
    JSON.parse(await readFile(file, 'utf8')) as { ticket: string };
  const inspect = async (ticket: string) => {
    const r = await ok(setup, undefined, { type: 'INSPECT', ticket });
    assert.ok(r.cookie);
    return { data: cast(r.json), cookie: r.cookie };
  };
  const set = (
    ticket: string,
    p: { data: View; cookie: string },
    password: string,
    extra: Record<string, string> = {},
  ) =>
    http(
      setup,
      undefined,
      {
        type: 'SET_PASSWORD',
        ticket,
        revision: p.data.revision,
        proof: p.data.proof,
        password,
        confirmPassword: password,
      },
      'POST',
      { cookie: p.cookie, ...extra },
    );
  const secret = () => randomBytes(24).toString('base64url');
  const slotCount = async (uid: string) =>
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_identity.credential_slots WHERE user_id=$1',
          [uid],
        )
      ).rows[0].n,
    );
  const signins = async (uid: string, password: string) => {
    const r = await ok('/api/zhiban/identity/login', undefined, { userId: uid, password });
    assert.ok(r.cookie);
    const a = {
      uid: userId(uid),
      password,
      member: '',
      grant: '',
      tenant: t,
      cookie: r.cookie,
      csrf: '',
    };
    const csrf = await ok('/api/zhiban/identity/csrf', a);
    a.csrf = cast(csrf.json).csrfToken;
    return a;
  };
  const bc = await browser.newContext();
  const errors: string[] = [];
  try {
    assert.equal((await http(base)).status, 401);
    for (const a of [teacher, student, foreign]) assert.equal((await http(base, a)).status, 403);
    assert.equal(
      (
        await http(base, manager, {
          type: 'REQUEST_ACCOUNT',
          name: '拒绝',
          subjectReference: 'LOCAL',
          requestedRole: 'TENANT_ADMIN',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await http(base, manager, {
          type: 'REQUEST_ACCOUNT',
          name: '拒绝',
          subjectReference: 'LOCAL',
          requestedRole: 'STUDENT',
          password: 'not-accepted',
        })
      ).status,
      400,
    );
    assert.equal((await http(base, outsider)).status, 200); // Another current same-tenant admin may submit requests, never global approval.
    const cancelled = await request('撤回样例');
    await ok(base, manager, {
      type: 'WITHDRAW_REQUEST',
      id: cancelled.id,
      revision: cancelled.revision,
    });
    await assert.rejects(() => approve(cancelled.id));
    await bc.addCookies([
      {
        name: manager.cookie!.split('=')[0],
        value: manager.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await bc.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${origin}/zhiban?space=${t}`);
    await page.getByRole('link', { name: '普通账户开通', exact: true }).click();
    await expect(page.getByRole('heading', { name: '普通账户开通', exact: true })).toBeVisible();
    await page.getByLabel('新账户姓名', { exact: true }).fill('开户旅程林同学');
    await page.getByLabel('受控名册引用', { exact: true }).fill('LOCAL-ROSTER-LIN');
    const saving = page.waitForResponse(
      (r) => new URL(r.url()).pathname === base && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '提交开户申请', exact: true }).click();
    const sr = await saving;
    assert.equal(sr.status(), 200);
    const req = cast(await sr.json());
    const submitted = sr.request().postDataJSON(),
      command = sr.request().headers()['x-zhiban-command'];
    assert.deepEqual(
      cast((await ok(base, manager, submitted, { 'x-zhiban-command': command })).json),
      req,
    );
    assert.equal(
      (
        await http(base, manager, { ...submitted, name: '不能替换原命令' }, 'POST', {
          'x-zhiban-command': command,
        })
      ).status,
      409,
    );

    await expect(page.locator('#onboarding')).toContainText('等待平台独立核验');
    const beforeUsers = Number(
      (await admin.query('SELECT count(*) AS n FROM zhiban_identity.users')).rows[0].n,
    );
    const issued = await approve(req.id),
      file = await delivery(issued.deliveryFile);
    assert.equal(await slotCount(issued.userId), 0);
    assert.equal(
      Number((await admin.query('SELECT count(*) AS n FROM zhiban_identity.users')).rows[0].n),
      beforeUsers + 1,
    );
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_identity.memberships WHERE user_id=$1',
            [issued.userId],
          )
        ).rows[0].n,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_identity.system_admin_grants WHERE user_id=$1',
            [issued.userId],
          )
        ).rows[0].n,
      ),
      0,
    );
    await assert.rejects(() =>
      approveLocalAccount(
        { ...cfg, operator: { ...cfg.operator, password: secret() } },
        pools,
        req.id,
        true,
      ),
    );
    const same = await approve(req.id);
    assert.equal(same.claimId, issued.claimId);
    assert.equal((await delivery(same.deliveryFile)).ticket, file.ticket);
    const source = (await point(req.id)).source_ref,
      sourcePath = join(authority.root, 'account-approvals', source + '.json'),
      original = await readFile(sourcePath);
    try {
      const tampered = JSON.parse(original.toString());
      tampered.manifest.kind = 'FIRST_PLATFORM_ADMIN';
      await chmod(sourcePath, 0o600);
      await writeFile(sourcePath, JSON.stringify(tampered));
      await assert.rejects(() => loadAccountEnvelope(cfg, source));
    } finally {
      await writeFile(sourcePath, original);
      await chmod(sourcePath, 0o400);
    }
    const inspected = await inspect(file.ticket);
    assert.equal(inspected.data.userId, issued.userId);
    assert.equal(inspected.data.state, 'READY');
    const noCookie = await http(setup, undefined, {
      type: 'SET_PASSWORD',
      ticket: file.ticket,
      revision: inspected.data.revision,
      proof: inspected.data.proof,
      password: secret(),
      confirmPassword: 'mismatch',
    });
    assert.equal(noCookie.status, 400);
    assert.equal((await set(file.ticket, inspected, secret(), { cookie: '' })).status, 403);
    assert.equal((await set(file.ticket, inspected, 'local-compromised-vector')).status, 400);
    const pw = secret(),
      race = await Promise.all([set(file.ticket, inspected, pw), set(file.ticket, inspected, pw)]);
    assert.equal(race.filter((r) => r.status === 200).length, 1);
    assert.ok(race.some((r) => [403, 409].includes(r.status)));
    assert.equal(await slotCount(issued.userId), 1);
    assert.equal((await inspect(file.ticket)).data.state, 'CLAIMED');
    assert.ok([403, 409].includes((await set(file.ticket, inspected, secret())).status));
    await assert.rejects(() => approve(req.id, true));
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) AS n FROM zhiban_identity.audit_events WHERE event_type='CREDENTIAL_CREATED' AND subject_user_id=$1",
            [issued.userId],
          )
        ).rows[0].n,
      ),
      1,
    );
    const who = await signins(issued.userId, pw);
    assert.equal((await http('/api/zhiban/identity/spaces', who)).status, 200);
    assert.equal(cast((await http('/api/zhiban/identity/spaces', who)).json).spaces.length, 0);
    assert.equal(
      (await http(`/api/zhiban/learning/${t}/offerings/${trial.offeringId}/activities`, who))
        .status,
      403,
    );
    const originalComposition = await createIdentityComposition(
      { auth: pools.auth, tenant: pools.tenant, control: pools.control },
      {
        ...cfg.composition,
        admission: {
          ...cfg.composition.admission,
          hmacKey: Buffer.from(cfg.composition.admission.hmacKey, 'hex'),
        },
        membership: {
          policy: cfg.composition.membership.policy,
          operator: localAuthorityStore(cfg.authority),
        },
      },
    );
    const admission = await issueLocalAdmission(
        authority,
        originalComposition,
        control,
        cfg.operator,
        t,
        who.uid,
        'INVITE',
        null,
      ),
      identity = `/api/zhiban/identity/tenants/${t}`;
    const managerPoint = cast(
      (
        await ok(
          `${identity}/memberships/${manager.member}?actorMembershipId=${manager.member}`,
          manager,
        )
      ).json,
    );
    const env = (p: View) => ({
      actorMembershipId: manager.member,
      expectedActorRevision: p.actorRevision,
      expectedActorAuthorizationVersion: p.actorAuthorizationVersion,
      expectedTenantRevision: p.tenantRevision,
    });
    const invitation = cast(
      (
        await ok(
          identity + '/invitations',
          manager,
          { ...env(managerPoint), admissionId: admission, password: manager.password },
          { 'idempotency-key': v7() },
        )
      ).json,
    );
    who.member = invitation.effects[0].membershipId;
    const consentContext = cast(
      (await ok(identity + '/consent-context?admissionId=' + admission, who)).json,
    );
    await ok(
      identity + '/consents',
      who,
      {
        admissionId: admission,
        expectedMemberRevision: consentContext.expectedMemberRevision,
        expectedAuthorizationVersion: consentContext.expectedAuthorizationVersion,
      },
      { 'idempotency-key': v7() },
    );
    const pending = cast(
      (
        await ok(
          `${identity}/memberships/${who.member}?actorMembershipId=${manager.member}&consentPurpose=ACTIVATE`,
          manager,
        )
      ).json,
    );
    assert.equal(pending.status, 'PENDING');
    await ok(
      `${identity}/memberships/${who.member}/activate`,
      manager,
      {
        ...env(pending),
        expectedRevision: pending.revision,
        expectedAuthorizationVersion: pending.authorizationVersion,
        admissionId: admission,
        consentId: pending.consent.consentId,
        grants: [{ roleCode: 'STUDENT', scope: { type: 'SELF', scopeId: null }, validUntil: null }],
        password: manager.password,
      },
      { 'idempotency-key': v7() },
    );
    assert.equal(cast((await ok('/api/zhiban/identity/spaces', who)).json).spaces.length, 1);
    assert.equal(
      (await http(`/api/zhiban/learning/${t}/offerings/${trial.offeringId}/activities`, who))
        .status,
      403,
    );
    await page.getByRole('button', { name: '刷新申请状态', exact: true }).click();
    await expect(page.locator('#onboarding')).toContainText('本人已设置密码');
    await page.screenshot({ path: 'docs/v2/evidence/onboarding/directed-admin.png' });
    record(
      'Ordinary account: independent signed USER_CREATE -> recipient first credential -> original login -> no automatic membership/grants/Enrollment -> original invite/consent/admin activation; tenant UI never gets ticket/password',
    );
    const partial = await request('部分交付接续');
    await chmod(join(authority.root, 'account-delivery'), 0o500);
    await assert.rejects(() => approve(partial.id));
    const partialState = await point(partial.id);
    assert.equal(partialState.state, 'APPROVED');
    assert.ok(partialState.planned_user_id);
    assert.equal(await slotCount(partialState.planned_user_id), 0);
    await chmod(join(authority.root, 'account-delivery'), 0o700);
    const resumed = await approve(partial.id);
    assert.equal(resumed.userId, partialState.planned_user_id);
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) AS n FROM zhiban_identity.audit_events WHERE subject_user_id=$1 AND event_type='USER_CREATED'",
            [resumed.userId],
          )
        ).rows[0].n,
      ),
      1,
    );
    const rd = await delivery(resumed.deliveryFile),
      rp = await inspect(rd.ticket);
    await admin.query(
      `CREATE FUNCTION public.onboarding_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.subject_user_id='${resumed.userId}'::uuid AND NEW.event_type='CREDENTIAL_CREATED' THEN RAISE EXCEPTION 'LOCAL audit fault';END IF;RETURN NEW;END$$;CREATE TRIGGER onboarding_fault BEFORE INSERT ON zhiban_identity.audit_events FOR EACH ROW EXECUTE FUNCTION public.onboarding_fault()`,
    );
    assert.equal((await set(rd.ticket, rp, secret())).status, 503);
    assert.equal(await slotCount(resumed.userId), 0);
    assert.equal((await point(partial.id)).state, 'READY');
    await admin.query(
      'DROP TRIGGER onboarding_fault ON zhiban_identity.audit_events;DROP FUNCTION public.onboarding_fault()',
    );
    const acknowledged = secret();
    assert.equal((await set(rd.ticket, rp, acknowledged)).status, 200);
    assert.equal((await inspect(rd.ticket)).data.state, 'CLAIMED');
    await signins(resumed.userId, acknowledged);
    record(
      'Ordinary account partial failure: committed User stays without credentials; same signed control receipt and protected file resume once; credential audit failure rolls everything back; explicit CLAIMED read/login confirms discarded ACK',
    );
    const revoked = await request('撤销与重发');
    const rev = await approve(revoked.id),
      oldTicket = await delivery(rev.deliveryFile);
    await revokeLocalAccount(cfg, pools, revoked.id);
    assert.equal(
      (await http(setup, undefined, { type: 'INSPECT', ticket: oldTicket.ticket })).status,
      403,
    );
    const replacement = await approve(revoked.id, true);
    assert.equal(replacement.userId, rev.userId);
    assert.notEqual(replacement.claimId, rev.claimId);
    const newTicket = await delivery(replacement.deliveryFile);
    await inspect(newTicket.ticket);
    assert.equal(
      (await http(setup, undefined, { type: 'INSPECT', ticket: oldTicket.ticket })).status,
      403,
    );
    const realHasher = new Argon2PasswordHasher(
      new LocalCompromisedPasswordScreening(cfg.composition.corpus.values),
    );
    async function gatedSet(ticket: string, mutate: () => Promise<void>) {
      let entered!: () => void, release!: () => void;
      const enteredP = new Promise<void>((r) => (entered = r)),
        gate = new Promise<void>((r) => (release = r));
      const gated = new OrdinaryCredentials(
        authPool,
        {
          hash: async (s) => {
            const v = await realHasher.hash(s);
            entered();
            await gate;
            return v;
          },
          verify: realHasher.verify.bind(realHasher),
          needsRehash: realHasher.needsRehash.bind(realHasher),
          rehashVerified: realHasher.rehashVerified.bind(realHasher),
        },
        true,
      );
      const current = await ordinaryCredentials.inspect(ticket),
        promise = gated.set(ticket, current.revision, secret());
      await enteredP;
      await mutate();
      release();
      await assert.rejects(() => promise);
    }
    await gatedSet(newTicket.ticket, async () => {
      await admin.query('UPDATE zhiban_onboarding.claims SET expires_at=issued_at+1 WHERE id=$1', [
        replacement.claimId,
      ]);
    });
    assert.equal(await slotCount(replacement.userId), 0);
    const disabled = await request('停用屏障');
    const di = await approve(disabled.id),
      dt = await delivery(di.deliveryFile);
    await gatedSet(dt.ticket, async () => {
      await admin.query(
        "UPDATE zhiban_identity.users SET status='DISABLED',repository_revision=repository_revision+1,updated_at=$2,disabled_at=$2,disabled_reason='ADMIN_REQUEST' WHERE user_id=$1",
        [di.userId, Date.now()],
      );
    });
    assert.equal(await slotCount(di.userId), 0);
    assert.equal(
      (
        await http(setup, undefined, {
          type: 'INSPECT',
          ticket: manager.uid + '.' + randomBytes(32).toString('base64url'),
        })
      ).status,
      403,
    );
    const roles = await request('平台撤权屏障');
    const gi = await approve(roles.id),
      gt = await delivery(gi.deliveryFile);
    const elevated = await authPool.connect();
    try {
      await elevated.query('BEGIN');
      await assert.rejects(() => elevated.query('SELECT * FROM zhiban_onboarding.claims'));
    } finally {
      await elevated.query('ROLLBACK');
      elevated.release();
    }
    assert.equal(await loadOnboarding(businessPool), true);
    await admin.query(
      'GRANT EXECUTE ON FUNCTION zhiban_onboarding.lock_claim(uuid,text,bigint) TO PUBLIC',
    );
    try {
      await assert.rejects(() => loadOnboarding(businessPool));
    } finally {
      await admin.query(
        'REVOKE EXECUTE ON FUNCTION zhiban_onboarding.lock_claim(uuid,text,bigint) FROM PUBLIC',
      );
    }
    assert.equal(await loadOnboarding(businessPool), true);
    await gatedSet(gt.ticket, async () => {
      await admin.query(
        'UPDATE zhiban_identity.system_admin_grants SET revoked_at=$2,repository_revision=repository_revision+1 WHERE grant_id=$1',
        [cfg.operator.grant, Date.now()],
      );
    });
    assert.equal(await slotCount(gi.userId), 0);
    const acl = await businessPool.connect();
    try {
      await acl.query('BEGIN');
      await acl.query("SELECT set_config('app.tenant_id',$1,true)", [foreign.tenant]);
      assert.equal(
        Number(
          (
            await acl.query(
              'SELECT count(*) AS n FROM zhiban_onboarding.requests WHERE tenant_id=$1',
              [t],
            )
          ).rows[0].n,
        ),
        0,
      );
    } finally {
      await acl.query('ROLLBACK');
      acl.release();
    }
    assert.deepEqual(errors, []);
    record(
      'First-password boundary: expired/revoked/replaced ticket, disabled target, revoked platform authority during real KDF, permanent slot, auth helper ACL and source/profile drift refuse; old bootstrap/recovery untouched',
    );
    await writeFile(
      'docs/v2/evidence/onboarding/directed-journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          scope:
            'ORDINARY_GLOBAL_USER_CREATE_RECIPIENT_FIRST_PASSWORD_ORIGINAL_LOGIN_AND_EXPLICIT_MEMBERSHIP_JOIN',
          syntheticAuthority: true,
          humanIdentityVerification: false,
          originalControlUserCreate: true,
          recipientChoosesPassword: true,
          tenantAdminReceivesPasswordOrTicket: false,
          noAutomaticMembershipRoleEnrollment: true,
          canonicalRequestReplay: true,
          oneCredentialRace: true,
          credentialAuditRollback: true,
          partialCreationAndDeliveryResume: true,
          discardedAckReadAndLogin: true,
          revokeAndSupersedingDelivery: true,
          kdfExpiryTargetAndAuthorityBarriers: true,
          rlsAclAndExpectedProfile: true,
          bootstrapAndRecoveryReused: false,
          realPg55432Or55433: false,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await bc.close();
  }
}
