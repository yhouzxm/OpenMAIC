import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
/** Owned disposable PG16 only: original control mutations, cross-space sessions and restricted projection. */
import assert from 'node:assert/strict';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { sign } from 'node:crypto';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import type { Authority, MemberControlConfig } from './member-authority';
import { prepareAccountStatus, executeAccountStatus, inspectAccountStatus } from './account-status';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import { Membership, RoleGrant, instant, selfScope, tenantId } from '@/lib/zhiban/domain/identity';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { controlManifestDigest } from '@/lib/zhiban/infrastructure/identity/composition/control-approval';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  authority: Authority;
  authPool: Pool;
  tenantPool: Pool;
  control: Pool;
  businessPool: Pool;
};
// Validated LOCAL response projections; never used as authorization evidence.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
export async function verifyAccountStatus(input: Input) {
  const {
    admin,
    actors,
    http,
    tenant: t,
    origin,
    browser,
    record,
    authority,
    authPool,
    tenantPool,
    control,
  } = input;
  const [teacher, student, , foreign, manager] = actors;
  const cfg = JSON.parse(
    await readFile(join(authority.root, 'member-control.json'), 'utf8'),
  ) as MemberControlConfig;
  const pools = { auth: authPool, tenant: tenantPool, control };
  const ok = async (path: string, a = manager) => {
    const r = await http(path, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const dir = (a = manager, tenant = t) =>
    ok(`/api/zhiban/profile/${tenant}/members?state=ALL&limit=50`, a);
  const row = async () => {
    const page = await dir();
    assert.ok(Number.isSafeInteger(page.globalStatusAsOf));
    return page.rows.find((r: View) => r.membershipId === student.member) as View;
  };
  const prepare = (action: 'USER_DISABLE' | 'USER_RESTORE', uid = student.uid) =>
    prepareAccountStatus(cfg, pools, uid, action, 'ACCESS_REVIEW');
  const execute = (ref: string, confirmation = false) =>
    executeAccountStatus(cfg, pools, ref, confirmation);
  const inspect = (ref: string) => inspectAccountStatus(cfg, pools, ref);
  const status = async () =>
    (
      await admin.query(
        'SELECT status,repository_revision::text AS revision FROM zhiban_identity.users WHERE user_id=$1',
        [student.uid],
      )
    ).rows[0];
  const login = async () => {
    const r = await http('/api/zhiban/identity/login', undefined, {
      userId: student.uid,
      password: student.password,
    });
    assert.equal(r.status, 200);
    return { ...student, cookie: (r as typeof r & { cookie: string }).cookie };
  };
  const auditCount = async (type: string) =>
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_identity.audit_events WHERE event_type=$1 AND subject_user_id=$2',
          [type, student.uid],
        )
      ).rows[0].n,
    );
  // Real second tenant Membership via original repository, solely synthetic fixture initialization.
  const ids = new IdentityIds(),
    at = instant(Date.now()),
    second = Membership.create({
      id: ids.nextMembershipId(),
      userId: student.uid,
      tenantId: tenantId(foreign.tenant),
      now: at,
    }).activatePending({
      expectedAuthorizationVersion: 0,
      now: at,
      approvedGrants: [
        RoleGrant.create({
          id: ids.nextRoleGrantId(),
          roleCode: 'STUDENT',
          scope: selfScope(),
          createdAt: at,
          validFrom: at,
          validUntil: null,
        }),
      ],
    });
  await new PostgresMembershipRepository(tenantPool).create(
    tenantScopeContext(tenantId(foreign.tenant)),
    second,
  );
  const snapshot = async () => ({
    members: (
      await admin.query(
        'SELECT row_to_json(m) AS v FROM zhiban_identity.memberships m WHERE user_id=$1 ORDER BY membership_id',
        [student.uid],
      )
    ).rows,
    roles: (
      await admin.query(
        'SELECT row_to_json(g) AS v FROM zhiban_identity.role_grants g JOIN zhiban_identity.memberships m USING(tenant_id,membership_id) WHERE m.user_id=$1 ORDER BY grant_id',
        [student.uid],
      )
    ).rows,
    enrollment: (
      await admin.query(
        'SELECT row_to_json(e) AS v FROM zhiban_academic.enrollments e WHERE membership_id=$1 ORDER BY id',
        [student.member],
      )
    ).rows,
    submissions: (
      await admin.query(
        'SELECT row_to_json(s) AS v FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts a ON a.tenant_id=s.tenant_id AND a.id=s.attempt_id WHERE a.membership_id=$1 ORDER BY s.id',
        [student.member],
      )
    ).rows,
  });
  const before = await snapshot();
  assert.equal((await row()).globalStatus, 'ACTIVE');
  for (const a of [teacher, student])
    assert.equal((await http(`/api/zhiban/profile/${t}/members`, a)).status, 403);
  assert.equal((await http(`/api/zhiban/profile/${t}/members`, foreign)).status, 403);
  const fields = JSON.stringify(await dir());
  for (const secret of [
    'disabledReason',
    'disabled_reason',
    'system_admin',
    'auditEvent',
    'credential',
    'email',
  ])
    assert.equal(fields.includes(secret), false);
  assert.equal(
    (await ok(`/api/zhiban/profile/${t}/members?q=${foreign.member}&state=ALL`)).rows.length,
    0,
  );
  assert.equal(
    (await http('/api/zhiban/control/users/' + student.uid, manager, { action: 'USER_DISABLE' }))
      .status,
    404,
  );
  await assert.rejects(
    prepareAccountStatus(cfg, pools, cfg.operator.uid, 'USER_DISABLE', 'ACCESS_REVIEW'),
  );
  await assert.rejects(
    prepareAccountStatus(
      { ...cfg, operator: { ...cfg.operator, password: 'not-the-operator-password' } },
      pools,
      student.uid,
      'USER_DISABLE',
      'ACCESS_REVIEW',
    ),
  );
  await assert.rejects(
    prepareAccountStatus(
      {
        ...cfg,
        operator: { uid: manager.uid, password: manager.password, grant: cfg.operator.grant },
      },
      pools,
      student.uid,
      'USER_DISABLE',
      'ACCESS_REVIEW',
    ),
  );
  const p = await prepare('USER_DISABLE'),
    competing = await prepare('USER_DISABLE');
  const source = join(authority.root, 'account-status-approvals', p.operationRef + '.json'),
    original = await readFile(source, 'utf8');
  const tampered = JSON.parse(original);
  tampered.manifest.purpose = 'USER_RESTORE';
  await chmod(source, 0o600);
  await writeFile(source, JSON.stringify(tampered));
  await chmod(source, 0o400);
  await assert.rejects(execute(p.operationRef));
  await chmod(source, 0o600);
  await writeFile(source, original);
  await chmod(source, 0o400);
  assert.equal((await status()).status, 'ACTIVE');
  const s1 = await login(),
    s2 = await login();
  assert.equal((await ok('/api/zhiban/identity/spaces', s1)).spaces.length, 2);
  const applied = await execute(p.operationRef);
  assert.equal(applied.globalStatus, 'DISABLED');
  assert.equal((await inspect(p.operationRef)).outcome, 'APPLIED_CURRENT');
  assert.equal((await row()).globalStatus, 'DISABLED');
  assert.equal((await row()).status, 'ACTIVE');
  assert.equal(
    (await dir(foreign, foreign.tenant)).rows.find((r: View) => r.userId === student.uid)
      .globalStatus,
    'DISABLED',
  );
  for (const a of [s1, s2]) assert.equal((await http('/api/zhiban/identity/me', a)).status, 401);
  assert.equal(
    (
      await http('/api/zhiban/identity/login', undefined, {
        userId: student.uid,
        password: student.password,
      })
    ).status,
    401,
  );
  assert.equal((await http(`/api/zhiban/profile/${t}/me`, s1)).status, 401);
  assert.equal((await http('/api/zhiban/identity/me', teacher)).status, 200);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await auditCount('USER_DISABLED'), 1);
  await assert.rejects(execute(p.operationRef));
  await execute(p.operationRef, true);
  assert.equal(await auditCount('USER_DISABLED'), 1);
  await assert.rejects(execute(competing.operationRef));
  const bc = await browser.newContext();
  try {
    const page = await bc.newPage();
    await page.goto(origin + '/zhiban');
    await page.getByLabel('账号 ID').fill(manager.uid);
    await page.getByLabel('密码', { exact: true }).fill(manager.password);
    await page.getByRole('button', { name: '登录并进入' }).click();
    await expect(page.getByText('我的空间', { exact: true })).toBeVisible();
    await page.goto(origin + `/zhiban/admin/accounts?tenant=${t}`);
    await expect(page.getByText('全局账户：已停用', { exact: false })).toBeVisible();
    await page.screenshot({
      path: 'docs/v2/evidence/account-status/directed-directory.png',
      fullPage: true,
    });
  } finally {
    await bc.close();
  }
  const restore = await prepare('USER_RESTORE');
  await execute(restore.operationRef);
  assert.equal((await inspect(p.operationRef)).outcome, 'APPLIED_SUPERSEDED');
  await assert.rejects(execute(p.operationRef, true));
  assert.equal((await row()).globalStatus, 'ACTIVE');
  for (const a of [s1, s2]) assert.equal((await http('/api/zhiban/identity/me', a)).status, 401);
  const fresh = await login();
  assert.equal((await ok('/api/zhiban/identity/spaces', fresh)).spaces.length, 2);
  assert.equal((await http(`/api/zhiban/profile/${t}/me`, fresh)).status, 200);
  assert.deepEqual(await snapshot(), before);
  record(
    'PASS global account control: independent two-key source + original SystemAdmin/password/Session USER_DISABLE/RESTORE; two spaces deny old sessions, fresh login after restore; directory shows global vs member state, business history and grants preserved',
  );
  // Owned audit failure: original control + session revocation must all roll back.
  const fault = await prepare('USER_DISABLE');
  await admin.query(
    `CREATE FUNCTION zhiban_identity.local_status_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='USER_DISABLED' AND NEW.subject_user_id='${student.uid}'::uuid THEN RAISE EXCEPTION 'LOCAL owned audit fault'; END IF; RETURN NEW; END $$`,
  );
  await admin.query(
    'CREATE TRIGGER local_status_audit_fault BEFORE INSERT ON zhiban_identity.audit_events FOR EACH ROW EXECUTE FUNCTION zhiban_identity.local_status_audit_fault()',
  );
  try {
    await assert.rejects(execute(fault.operationRef));
    assert.equal((await status()).status, 'ACTIVE');
    assert.equal((await http('/api/zhiban/identity/me', fresh)).status, 200);
    assert.equal((await inspect(fault.operationRef)).outcome, 'NOT_APPLIED');
  } finally {
    await admin.query('DROP TRIGGER local_status_audit_fault ON zhiban_identity.audit_events');
    await admin.query('DROP FUNCTION zhiban_identity.local_status_audit_fault()');
  }
  // Two independently prepared approvals race on one current target revision: exactly one mutation.
  const rival = await prepare('USER_DISABLE');
  const race = await Promise.allSettled([execute(fault.operationRef), execute(rival.operationRef)]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await auditCount('USER_DISABLED'), 2);
  const winner = race[0].status === 'fulfilled' ? fault : rival;
  assert.equal((await inspect(winner.operationRef)).outcome, 'APPLIED_CURRENT'); // Discarded execute result is confirmed through proof, not password replay.
  const resume = await prepare('USER_RESTORE');
  await execute(resume.operationRef);
  // Expired but valid two-signature LOCAL source is rejected by the original locked control protocol.
  const expired = await prepare('USER_DISABLE'),
    expiredPath = join(authority.root, 'account-status-approvals', expired.operationRef + '.json');
  const e = JSON.parse(await readFile(expiredPath, 'utf8'));
  e.manifest.issued_at = String(Date.now() - 20000);
  e.manifest.expires_at = String(Date.now() - 1000);
  e.manifest.manifest_digest = controlManifestDigest(e.manifest);
  const bytes = Buffer.from(JSON.stringify(e.manifest));
  for (const role of ['operator', 'approver'])
    e[role + 'Signature'] = sign(
      null,
      bytes,
      await readFile(join(authority.root, `member-${role}.pem`)),
    ).toString('base64');
  await chmod(expiredPath, 0o600);
  await writeFile(expiredPath, JSON.stringify(e));
  await chmod(expiredPath, 0o400);
  await assert.rejects(execute(expired.operationRef));
  assert.equal((await inspect(expired.operationRef)).sourceExpired, true);
  // A controlled gate pauses original register after password proof, before target lock. Revoke its actual Session on a separate connection.
  const sessionProbe = await prepare('USER_DISABLE');
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (reached = r)),
    released = new Promise<void>((r) => (release = r));
  let gated = false;
  const gatedControl = {
    query: control.query.bind(control),
    async connect() {
      const c = await control.connect();
      return {
        release: (destroy?: boolean) => c.release(destroy),
        query: async (...args: Parameters<typeof c.query>) => {
          if (
            !gated &&
            typeof args[0] === 'string' &&
            args[0].includes('FROM zhiban_identity.users WHERE user_id = $1 FOR UPDATE')
          ) {
            gated = true;
            reached();
            await released;
          }
          return c.query(...args);
        },
      };
    },
  } as unknown as Pool;
  const pending = executeAccountStatus(
    cfg,
    { ...pools, control: gatedControl },
    sessionProbe.operationRef,
  );
  await Promise.race([
    entered,
    pending.then(() => {
      throw Error('Expected original target-lock gate');
    }),
  ]);
  try {
    const revoked = await admin.query(
      `UPDATE zhiban_identity.sessions SET revoked_at=floor(extract(epoch FROM clock_timestamp())*1000)::bigint,repository_revision=repository_revision+1 WHERE session_id=(SELECT session_id FROM zhiban_identity.sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1)`,
      [cfg.operator.uid],
    );
    assert.equal(revoked.rowCount, 1);
  } finally {
    release();
  }
  await assert.rejects(pending);
  assert.equal((await status()).status, 'ACTIVE');
  // Last check consumes the fixture operator grant only; no teardown can restore this authority.
  const denied = await prepare('USER_DISABLE');
  await admin.query(
    'UPDATE zhiban_identity.system_admin_grants SET revoked_at=$2,repository_revision=repository_revision+1 WHERE grant_id=$1',
    [cfg.operator.grant, Date.now()],
  );
  await assert.rejects(execute(denied.operationRef));
  assert.equal((await status()).status, 'ACTIVE');
  record(
    'PASS global control boundaries: source tamper/expiry, tenant-only actor, wrong password/self target, stale and superseded confirmation refuse; audit fault rolls back session revocation, concurrent same-revision commands yield once; independently revoked Session/operator grant refuse',
  );
  await writeFile(
    'docs/v2/evidence/account-status/directed-journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope: 'ORIGINAL_GLOBAL_USER_DISABLE_RESTORE_RESTRICTED_TENANT_DIRECTORY',
        syntheticAuthority: true,
        humanApproval: false,
        originalControlCommands: true,
        globalHttpMutation: false,
        crossTenantSessions: 2,
        oldSessionsRemainRevokedAfterRestore: true,
        noMembershipGrantEnrollmentOrHistoryMutation: true,
        sourceTamperExpiryAndCurrentAuthorityRefused: true,
        sessionRevocationGate: true,
        auditAndSessionRollback: true,
        concurrentMutationOnce: true,
        safeCurrentAndSupersededProof: true,
        newSqlOrAcl: false,
        real55432Or55433: false,
      },
      null,
      2,
    ) + '\n',
  );
}
