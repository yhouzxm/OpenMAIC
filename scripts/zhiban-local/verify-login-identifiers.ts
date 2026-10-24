/** Directed owned PG16/real HTTPS checks. No new credential is entered through browser automation. */
import assert from 'node:assert/strict';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import type { Authority, MemberControlConfig } from './member-authority';
import type { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { prepareLoginIdentifier, registerLoginIdentifier } from './login-identifier-authority';
import { loadLoginIdentifiers } from './login-identifiers';
import { LoginIdentifiers } from '@/lib/zhiban/infrastructure/login-identifiers/service';
import { prepareAccountStatus, executeAccountStatus } from './account-status';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  authority: Authority;
  authPool: Pool;
  tenantPool: Pool;
  control: Pool;
  composition: Awaited<ReturnType<typeof createIdentityComposition>>;
};
// Narrowed LOCAL response DTOs only; never security evidence.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
export async function verifyLoginIdentifiers(input: Input) {
  const verifierWindowStart = performance.now();
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
    composition,
  } = input;
  const [teacher, student, , foreign, manager] = actors,
    cfg = JSON.parse(
      await readFile(join(authority.root, 'member-control.json'), 'utf8'),
    ) as MemberControlConfig,
    pools = { auth: authPool, tenant: tenantPool, control };
  const base = '/api/zhiban/login-identifiers',
    own = async (a = student) => {
      const r = await http(base + '/me', a);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json as View;
    };
  const byName = async (alias: string) =>
    (await own()).names.find((n: View) => n.alias === alias) as View;
  const action = (
    n: View,
    type = 'ACCEPT',
    a = student,
    password = a.password,
    extra: Record<string, string> = {},
  ) =>
    http(
      base + '/me',
      a,
      { action: type, alias: n.alias, revision: n.revision, password },
      'POST',
      extra,
    );
  const aliasLogin = (alias: string, password = student.password) =>
    http(base + '/login', undefined, { identifier: alias, password });
  const nominate = async (alias: string, uid = student.uid) => {
    const p = await prepareLoginIdentifier(cfg, pools, uid, alias, 'LOCAL_ROSTER_BINDING');
    const r = await registerLoginIdentifier(cfg, pools, p.sourceRef);
    return { ...p, ...r };
  };
  const refreshStudent = async () => {
    const r = await http('/api/zhiban/identity/login', undefined, {
      userId: student.uid,
      password: student.password,
    });
    assert.equal(r.status, 200);
    student.cookie = (r as typeof r & { cookie: string }).cookie;
    student.csrf = ((await http('/api/zhiban/identity/csrf', student)).json as View).csrfToken;
  };
  const credentials = async () =>
    createHash('sha256')
      .update(
        JSON.stringify(
          (
            await admin.query(
              'SELECT row_to_json(s) v FROM zhiban_identity.credential_slots s WHERE user_id=$1',
              [student.uid],
            )
          ).rows,
        ),
      )
      .digest('hex');
  const beforeCredentials = await credentials();
  assert.equal((await http(base + '/me')).status, 401);
  assert.equal((await own()).names.length, 0);
  assert.equal((await http(base + '/me?userId=' + teacher.uid, student)).status, 400);
  await assert.rejects(
    prepareLoginIdentifier(
      { ...cfg, operator: { ...cfg.operator, password: 'incorrect-local-operator' } },
      pools,
      student.uid,
      '@local.denied1',
      'LOCAL',
    ),
  );
  await assert.rejects(
    prepareLoginIdentifier(
      {
        ...cfg,
        operator: { uid: manager.uid, password: manager.password, grant: cfg.operator.grant },
      },
      pools,
      student.uid,
      '@local.denied2',
      'LOCAL',
    ),
  );
  const prepared = await prepareLoginIdentifier(
    cfg,
    pools,
    student.uid,
    '@LOCAL.Student01',
    'LOCAL_ROSTER_BINDING',
  );
  const file = join(authority.root, 'login-identifier-approvals', prepared.sourceRef + '.json'),
    original = await readFile(file, 'utf8'),
    bad = JSON.parse(original);
  bad.manifest.userId = teacher.uid;
  await chmod(file, 0o600);
  await writeFile(file, JSON.stringify(bad));
  await chmod(file, 0o400);
  await assert.rejects(registerLoginIdentifier(cfg, pools, prepared.sourceRef));
  await chmod(file, 0o600);
  await writeFile(file, original);
  await chmod(file, 0o400);
  await registerLoginIdentifier(cfg, pools, prepared.sourceRef);
  const confirmation = await registerLoginIdentifier(cfg, pools, prepared.sourceRef, true);
  assert.equal(confirmation.outcome, 'REGISTERED_CURRENT');
  const n = await byName('@local.student01');
  assert.equal(n.state, 'PENDING');
  assert.equal((await aliasLogin(n.alias)).status, 401);
  assert.equal((await action(n, 'ACCEPT', teacher)).status, 403);
  assert.equal((await action(n, 'ACCEPT', student, 'wrong-current-password')).status, 403);
  assert.equal(
    (await action(n, 'ACCEPT', student, student.password, { 'x-zhiban-csrf': '' })).status,
    403,
  );
  assert.equal(
    (
      await http(base + '/me', student, {
        action: 'ACCEPT',
        alias: n.alias,
        revision: n.revision,
        password: student.password,
        userId: teacher.uid,
      })
    ).status,
    400,
  );
  const accepted = await action(n);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
  assert.equal((await byName(n.alias)).state, 'ACTIVE');
  assert.equal((await action(n)).status, 409);
  const named = await aliasLogin(' \t@LOCAL.Student01\n');
  assert.equal(named.status, 200);
  assert.equal((named.json as View).userId, student.uid);
  assert.equal(
    (
      await http('/api/zhiban/identity/login', undefined, {
        userId: n.alias,
        password: student.password,
      })
    ).status,
    401,
  );
  for (const [id, pwd] of [
    ['@local.unknown01', student.password],
    [n.alias, 'wrong-password'],
    ['student-001', student.password],
    ['chen@example.invalid', student.password],
  ]) {
    const r = await aliasLogin(id, pwd);
    assert.equal(r.status, 401);
    assert.equal((r.json as View).error.code, 'UNAUTHENTICATED');
  }
  const directory = await http(
    `/api/zhiban/profile/${t}/members?q=%40LOCAL.Student01&state=ALL`,
    manager,
  );
  assert.equal(directory.status, 200, JSON.stringify(directory.json));
  assert.equal((directory.json as View).rows.length, 1);
  assert.equal((directory.json as View).rows[0].membershipId, student.member);
  assert.equal((directory.json as View).rows[0].loginAlias, n.alias);
  const other = await http(
    `/api/zhiban/profile/${foreign.tenant}/members?q=%40local.student01&state=ALL`,
    foreign,
  );
  assert.equal(other.status, 200);
  assert.equal((other.json as View).rows.length, 0);
  assert.equal(
    (await http(`/api/zhiban/profile/${t}/members?q=%40local.student01`, teacher)).status,
    403,
  );
  await assert.rejects(nominate(n.alias, teacher.uid));
  assert.equal((await own(teacher)).names.length, 0);
  const disable = await prepareAccountStatus(
    cfg,
    pools,
    student.uid,
    'USER_DISABLE',
    'ACCESS_REVIEW',
  );
  await executeAccountStatus(cfg, pools, disable.operationRef);
  assert.equal((await aliasLogin(n.alias)).status, 401);
  const restore = await prepareAccountStatus(
    cfg,
    pools,
    student.uid,
    'USER_RESTORE',
    'ACCESS_REVIEW',
  );
  await executeAccountStatus(cfg, pools, restore.operationRef);
  assert.equal((await aliasLogin(n.alias)).status, 200);
  await refreshStudent();
  record(
    'PASS nomination, subject confirmation, alias/UUID isolation, tenant directory and global disable/restore; respecting original ten-verifications/minute budget before concurrency phase',
  );
  while (performance.now() - verifierWindowStart < 61000)
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(10000, 61000 - (performance.now() - verifierWindowStart))),
    );
  const two = await nominate('@local.student02'),
    candidate = await byName(two.alias!);
  await admin.query(
    "CREATE FUNCTION zhiban_login_identifiers.local_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ACCEPTED' THEN RAISE EXCEPTION 'LOCAL audit fault'; END IF;RETURN NEW;END $$",
  );
  await admin.query(
    'CREATE TRIGGER local_audit_fault BEFORE INSERT ON zhiban_login_identifiers.events FOR EACH ROW EXECUTE FUNCTION zhiban_login_identifiers.local_audit_fault()',
  );
  try {
    assert.equal((await action(candidate)).status, 503);
    assert.equal((await byName(candidate.alias)).state, 'PENDING');
    assert.equal((await byName(n.alias)).state, 'ACTIVE');
  } finally {
    await admin.query('DROP TRIGGER local_audit_fault ON zhiban_login_identifiers.events');
    await admin.query('DROP FUNCTION zhiban_login_identifiers.local_audit_fault()');
  }
  const race = await Promise.all([action(candidate), action(candidate)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await byName(n.alias)).state, 'RETIRED');
  assert.equal((await aliasLogin(n.alias)).status, 401);
  assert.equal((await aliasLogin(candidate.alias)).status, 200);
  assert.equal((await own()).names.filter((r: View) => r.state === 'ACTIVE').length, 1);
  // Read-only browser verification of the actual bound name; binding was submitted through real HTTPS.
  const bc = await browser.newContext();
  try {
    const page = await bc.newPage();
    await page.goto(origin + '/zhiban');
    await page.getByLabel('账号 ID', { exact: false }).fill(candidate.alias);
    await page.getByLabel('密码', { exact: true }).fill(student.password);
    await page.getByRole('button', { name: '登录并进入' }).click();
    await expect(page.getByText('我的空间', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '本人登录标识', exact: true }).click();
    await expect(page.getByRole('heading', { name: candidate.alias, exact: true })).toBeVisible();
    await page.screenshot({
      path: 'docs/v2/evidence/login-identifiers/directed-self.png',
      fullPage: true,
    });
  } finally {
    await bc.close();
  }
  record(
    'PASS controlled login identifier: two-key platform nomination -> target Session/current-password confirmation -> genuine original password/Session login; global directory mapping scoped to current tenant, UUID-only endpoint unchanged, global disable/restore enforced and credential slot unchanged',
  );
  // Real hashing/issuance finishes, then another authenticated HTTPS operation retires the alias before final delivery guard.
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (reached = r)),
    released = new Promise<void>((r) => (release = r));
  let gated = false;
  const gatedAuth = {
    query: authPool.query.bind(authPool),
    async connect() {
      const c = await authPool.connect();
      return {
        release: (destroy?: boolean) => c.release(destroy),
        query: async (...args: Parameters<typeof c.query>) => {
          if (
            !gated &&
            typeof args[0] === 'string' &&
            args[0].includes('SELECT zhiban_login_identifiers.guard_login(')
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
  const pending = new LoginIdentifiers(gatedAuth, composition, true).login(
    candidate.alias,
    student.password,
    '127.0.0.1',
    'LOCAL_ALIAS_DELIVERY_GATE',
    null,
  );
  await Promise.race([
    entered,
    pending.then(() => {
      throw Error('Expected final binding gate');
    }),
  ]);
  try {
    const latest = await byName(candidate.alias);
    assert.equal((await action(latest, 'RETIRE')).status, 200);
  } finally {
    release();
  }
  assert.equal((await pending).status, 'REJECTED');
  assert.equal((await aliasLogin(candidate.alias)).status, 401);
  await refreshStudent();
  // Names remain permanently reserved to their original subject, including after retirement.
  await assert.rejects(nominate(candidate.alias, teacher.uid));
  const exp = await nominate('@local.expired01');
  await admin.query(
    "UPDATE zhiban_login_identifiers.approvals SET manifest=jsonb_set(manifest,'{expiresAt}',to_jsonb($2::bigint)) WHERE source_ref=$1",
    [exp.sourceRef, Date.now() - 1],
  );
  assert.equal((await action(await byName(exp.alias!))).status, 403);
  assert.equal(await credentials(), beforeCredentials);
  const c = await tenantPool.connect();
  try {
    await assert.rejects(c.query('SELECT alias FROM zhiban_login_identifiers.names'), {
      code: '42501',
    });
  } finally {
    c.release();
  }
  await assert.rejects(authPool.query('SELECT manifest FROM zhiban_login_identifiers.approvals'), {
    code: '42501',
  });
  await assert.rejects(
    authPool.query('SELECT zhiban_login_identifiers.nominate($1,$2,$3)', [
      {},
      '0'.repeat(64),
      '0'.repeat(64),
    ]),
    { code: '42501' },
  );
  await admin.query(
    'GRANT EXECUTE ON FUNCTION zhiban_login_identifiers.nominate(jsonb,text,text) TO PUBLIC',
  );
  try {
    await assert.rejects(loadLoginIdentifiers(authPool));
  } finally {
    await admin.query(
      'REVOKE EXECUTE ON FUNCTION zhiban_login_identifiers.nominate(jsonb,text,text) FROM PUBLIC',
    );
  }
  assert.equal(await loadLoginIdentifiers(authPool), true);
  // Current authority is required until target acceptance; this consumes the owned operator grant last.
  const revoked = await nominate('@local.revoked01');
  await admin.query(
    'UPDATE zhiban_identity.system_admin_grants SET revoked_at=$2,repository_revision=repository_revision+1 WHERE grant_id=$1',
    [cfg.operator.grant, Date.now()],
  );
  assert.equal((await action(await byName(revoked.alias!))).status, 403);
  record(
    'PASS identifier boundaries: tenant-only/wrong-password/foreign-subject/source-tamper/expired/revoked authority refuse; same-revision consent yields once, audit failure rolls back alias switch, retired names cannot transfer, final-delivery retirement rejects login, private ACL/profile drift fail closed',
  );
  await writeFile(
    'docs/v2/evidence/login-identifiers/directed-journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope:
          'P3_CONTROLLED_LOGIN_IDENTIFIER_NOMINATION_RECIPIENT_CONFIRMATION_REAL_LOGIN_DIRECTORY',
        syntheticAuthority: true,
        humanVerification: false,
        frozenUserIdResolverChanged: false,
        originalCredentialAndSessionReused: true,
        passwordAndCredentialSlotUnchanged: true,
        tenantScopedDirectory: true,
        permanentNoReassignment: true,
        atomicAliasSwitchAndAuditRollback: true,
        concurrentAcceptOnce: true,
        postKdfBindingGuard: true,
        globalUserDisableAndRestore: true,
        expiredAndRevokedSourceRefused: true,
        privateAclProfileChecked: true,
        onlySyntheticBrowserCredentials: true,
        browserChangedCredential: false,
        real55432Or55433: false,
      },
      null,
      2,
    ) + '\n',
  );
}
