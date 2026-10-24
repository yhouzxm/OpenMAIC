/** LOCAL owned PG16 only. The existing command/Identity barriers remain the writer. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import type { AcademicStore } from '../../lib/zhiban/application/academic/service';
import type { IdentityAuthentication } from '../../lib/zhiban/infrastructure/identity/composition/authentication';
import { ImportsService } from '../../lib/zhiban/application/imports/service';
import { createImportsHttp } from '../../lib/zhiban/infrastructure/imports/http';
import { AcademicError } from '../../lib/zhiban/domain/academic/model';
import { loadImports } from './imports';
// Validated local test response projections, never an authorization source.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>> | null;
  store: AcademicStore;
  businessPool: Pool;
  security: IdentityAuthentication;
};
export async function verifyImports(input: Input) {
  const {
    admin,
    http,
    actors,
    tenant: t,
    origin,
    browser,
    record,
    store,
    businessPool,
    security,
  } = input;
  const [teacher, student, , foreign, manager, second] = actors,
    base = `/api/zhiban/imports/${t}`;
  const ok = async (path: string, payload?: unknown) => {
    const r = await http(path, manager, payload);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const preview = (kind: string, csv: string) => ok(base, { type: 'PREVIEW', kind, csv });
  const commit = (id: string) => ok(base + '/' + id, { type: 'COMMIT' });
  const find = async (table: string, code: string) =>
    (
      await admin.query(`SELECT * FROM zhiban_academic.${table} WHERE tenant_id=$1 AND code=$2`, [
        t,
        code,
      ])
    ).rows[0];
  const audit = async () =>
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1',
        [t],
      )
    ).rows[0].n;
  const count = await audit();
  for (const a of [teacher, student, foreign]) assert.equal((await http(base, a)).status, 403);
  assert.equal(
    (await http(base, manager, { type: 'PREVIEW', kind: 'USER_CREATE', csv: 'x' })).status,
    400,
  );
  assert.equal(
    (
      await http(base, manager, {
        type: 'PREVIEW',
        kind: 'CLASSES',
        csv: 'code,name\nT,Test',
        role: 'TEACHER',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await http(
        base,
        manager,
        { type: 'PREVIEW', kind: 'CLASSES', csv: 'code,name\nT,Test' },
        undefined,
        { 'x-zhiban-csrf': 'x'.repeat(43) },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await http(
        base,
        manager,
        { type: 'PREVIEW', kind: 'CLASSES', csv: 'code,name\nT,Test' },
        undefined,
        { origin: 'https://untrusted.invalid' },
      )
    ).status,
    403,
  );
  let p = await preview(
    'TERMS',
    'code,name,startsOn,endsOn\nIMP_TERM,导入学期,2026-10-01,2027-02-01',
  );
  assert.equal(await audit(), count);
  assert.equal(await find('terms', 'IMP_TERM'), undefined);
  assert.equal((await commit(p.id)).rows[0].state, 'IMPORTED');
  assert.equal((await commit(p.id)).rows[0].state, 'IMPORTED');
  assert.equal(await audit(), count + 1);
  assert.equal(
    (await preview('TERMS', 'code,name,startsOn,endsOn\nIMP_TERM,导入学期,2026-10-01,2027-02-01'))
      .rows[0].state,
    'SKIP',
  );
  assert.equal(
    (await preview('TERMS', 'code,name,startsOn,endsOn\nIMP_TERM,别的名称,2026-10-01,2027-02-01'))
      .rows[0].state,
    'BLOCKED',
  );
  p = await preview('COURSES', 'code,name,description\nIMP_COURSE,导入课程,课程说明');
  await commit(p.id);
  const course = await find('courses', 'IMP_COURSE'),
    term = await find('terms', 'IMP_TERM');
  assert.equal(course.status, 'DRAFT');
  let offeringCsv = `courseId,termId,classId,code,name,capacity\n${course.id},${term.id},,IMP_OFFERING,导入教学班,1`;
  assert.equal((await preview('OFFERINGS', offeringCsv)).canCommit, false);
  await ok(`/api/zhiban/management/${t}/commands`, {
    type: 'PUBLISH_COURSE',
    id: course.id,
    revision: String(course.revision),
  });
  p = await preview('CLASSES', 'code,name\nIMP_CLASS,导入行政班');
  await commit(p.id);
  const cls = await find('classes', 'IMP_CLASS');
  offeringCsv = `courseId,termId,classId,code,name,capacity\n${course.id},${term.id},${cls.id},IMP_OFFERING,导入教学班,1`;
  p = await preview('OFFERINGS', offeringCsv);
  await commit(p.id);
  const offering = await find('offerings', 'IMP_OFFERING');
  p = await preview(
    'DIRECTORY',
    `membershipId,formalName,studentNo,employeeNo\n${student.member},导入正式姓名,IMP_STUDENT,`,
  );
  assert.equal(p.canCommit, true);
  await commit(p.id);
  assert.equal(
    (
      await admin.query(
        'SELECT formal_name FROM zhiban_profile.directory_records WHERE tenant_id=$1 AND membership_id=$2',
        [t, student.member],
      )
    ).rows[0].formal_name,
    '导入正式姓名',
  );
  p = await preview(
    'DIRECTORY',
    `membershipId,formalName,studentNo,employeeNo\n${foreign.member},外空间,,`,
  );
  assert.equal(p.canCommit, false);
  const identityBefore = (
    await admin.query(
      'SELECT row_to_json(m) AS v FROM zhiban_identity.memberships m WHERE membership_id=$1',
      [student.member],
    )
  ).rows;
  // Current same administrative class skips; another class never silently transfers.
  const originalClass = await find('classes', 'TRY_CLASS');
  p = await preview('CLASS_MEMBERS', `classId,membershipId\n${originalClass.id},${student.member}`);
  assert.equal(p.rows[0].state, 'SKIP');
  await commit(p.id);
  assert.equal(
    (await preview('CLASS_MEMBERS', `classId,membershipId\n${cls.id},${student.member}`)).canCommit,
    false,
  );
  // Remove only a synthetic fixture relationship through the original management command, then import it afresh.
  const cm = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.class_members WHERE tenant_id=$1 AND class_id=$2 AND membership_id=$3',
      [t, originalClass.id, second.member],
    )
  ).rows[0];
  await ok(`/api/zhiban/management/${t}/commands`, {
    type: 'CLASS_MEMBER',
    classId: originalClass.id,
    membershipId: second.member,
    active: false,
    revision: cm.revision,
  });
  p = await preview('CLASS_MEMBERS', `classId,membershipId\n${cls.id},${second.member}`);
  assert.equal(p.canCommit, true);
  await commit(p.id);
  p = await preview(
    'ENROLLMENTS',
    `offeringId,membershipId\n${offering.id},${student.member}\n${offering.id},${second.member}`,
  );
  assert.equal(p.canCommit, false);
  assert.equal(p.rows[0].code, 'CAPACITY_FULL');
  p = await preview('ENROLLMENTS', `offeringId,membershipId\n${offering.id},${student.member}`);
  const race = await Promise.all([commit(p.id), commit(p.id)]);
  for (const r of race) assert.equal(r.rows[0].state, 'IMPORTED');
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2',
        [t, offering.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await preview('ENROLLMENTS', `offeringId,membershipId\n${offering.id},${second.member}`))
      .canCommit,
    false,
  );
  assert.deepEqual(
    (
      await admin.query(
        'SELECT row_to_json(m) AS v FROM zhiban_identity.memberships m WHERE membership_id=$1',
        [student.member],
      )
    ).rows,
    identityBefore,
  );
  record(
    'PASS seven import kinds through real guarded commands; preview business-read-only, exact existing skip, no course autopublish/account/role transfer, capacity and cross-tenant boundaries',
  );
  const anotherAdmin = actors[2];
  assert.equal((await http(base + '/' + p.id, anotherAdmin)).status, 404);
  const createOffering = async (code: string) => {
    await ok(`/api/zhiban/management/${t}/commands`, {
      type: 'CREATE_OFFERING',
      courseId: course.id,
      termId: term.id,
      classId: null,
      code,
      name: code,
      capacity: 1,
    });
    return find('offerings', code);
  };
  const lastSeat = await createOffering('IMP_RACE');
  const raceA = await preview(
      'ENROLLMENTS',
      `offeringId,membershipId\n${lastSeat.id},${student.member}`,
    ),
    raceB = await preview(
      'ENROLLMENTS',
      `offeringId,membershipId\n${lastSeat.id},${second.member}`,
    );
  const lastResults = await Promise.all([commit(raceA.id), commit(raceB.id)]);
  assert.deepEqual(lastResults.map((r) => r.rows[0].state).sort(), ['FAILED', 'IMPORTED']);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND status='ACTIVE'",
        [t, lastSeat.id],
      )
    ).rows[0].n,
    1,
  );
  const targetOffering = await createOffering('IMP_TARGET'),
    revokedStudent = actors[6];
  const targetPlan = await preview(
    'ENROLLMENTS',
    `offeringId,membershipId\n${targetOffering.id},${revokedStudent.member}`,
  );
  await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1', [
    revokedStudent.grant,
    Date.now(),
  ]);
  assert.equal((await commit(targetPlan.id)).rows[0].state, 'FAILED');
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2',
        [t, targetOffering.id],
      )
    ).rows[0].n,
    0,
  );
  const stale = await preview(
    'DIRECTORY',
    `membershipId,formalName,studentNo,employeeNo\n${student.member},不应覆盖,IMP_STUDENT,`,
  );
  await admin.query(
    'UPDATE zhiban_profile.directory_records SET revision=revision+1,formal_name=$3 WHERE tenant_id=$1 AND membership_id=$2',
    [t, student.member, '并发正式姓名'],
  );
  assert.equal((await commit(stale.id)).rows[0].state, 'FAILED');
  assert.equal(
    (
      await admin.query(
        'SELECT formal_name FROM zhiban_profile.directory_records WHERE tenant_id=$1 AND membership_id=$2',
        [t, student.member],
      )
    ).rows[0].formal_name,
    '并发正式姓名',
  );
  for (let i = 0; i < 3; i++) await preview('CLASSES', `code,name\nIMP_PAGE_${i},分页预览${i}`);
  const firstPage = await ok(base);
  assert.equal(firstPage.rows.length, 20);
  assert.ok(firstPage.next);
  const nextPage = await ok(base + '?after=' + firstPage.next);
  assert.ok(nextPage.rows.every((r: View) => !firstPage.rows.some((p: View) => p.id === r.id)));
  record(
    'PASS concurrent final seat, student qualification revoked after preview, directory CAS prevents overwrite, creator-only batch reads and keyset pagination',
  );
  // Durable partial success: a second row changed after preview; no third row starts.
  p = await preview('CLASSES', 'code,name\nIMP_FIRST,第一行\nIMP_CHANGED,第二行\nIMP_LATER,第三行');
  await ok(`/api/zhiban/management/${t}/commands`, {
    type: 'CREATE_CLASS',
    code: 'IMP_CHANGED',
    name: '另一次写入',
  });
  const partial = await commit(p.id);
  assert.deepEqual(
    partial.rows.map((r: View) => r.state),
    ['IMPORTED', 'FAILED', 'READY'],
  );
  assert.equal(await find('classes', 'IMP_LATER'), undefined);
  assert.deepEqual(
    (await commit(p.id)).rows.map((r: View) => r.state),
    ['IMPORTED', 'FAILED', 'READY'],
  );
  // Reconstruct the handler/service; previous batch results cannot depend on a JS Map.
  const rebuilt = createImportsHttp(
    new ImportsService(store, await loadImports(businessPool)),
    security,
    origin,
  );
  const reread = await rebuilt(
    new Request(origin + base + '/' + p.id, {
      headers: { cookie: manager.cookie!, 'x-zhiban-request': 'identity-v1' },
    }),
  );
  assert.equal(reread.status, 200);
  assert.deepEqual((await reread.json()).rows, partial.rows);
  assert.equal((await http(`/api/zhiban/imports/${foreign.tenant}/${p.id}`, foreign)).status, 404);
  // Preview expires only mutation, not durable readback.
  const expired = await preview('CLASSES', 'code,name\nIMP_EXPIRED,过期');
  await admin.query(
    'UPDATE zhiban_imports.batches SET expires_at=created_at+1 WHERE tenant_id=$1 AND id=$2',
    [t, expired.id],
  );
  assert.equal((await ok(base + '/' + expired.id)).status, 'EXPIRED');
  await commit(expired.id);
  assert.equal(await find('classes', 'IMP_EXPIRED'), undefined);
  // Receipt update failure rolls business command and audit back with it.
  p = await preview('CLASSES', 'code,name\nIMP_AUDIT,原子回滚');
  await admin.query(
    "CREATE FUNCTION zhiban_imports.local_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL receipt failure'; END $$",
  );
  await admin.query(
    'CREATE TRIGGER local_fault BEFORE UPDATE ON zhiban_imports.rows FOR EACH ROW EXECUTE FUNCTION zhiban_imports.local_fault()',
  );
  try {
    assert.equal((await http(base + '/' + p.id, manager, { type: 'COMMIT' })).status, 503);
    assert.equal(await find('classes', 'IMP_AUDIT'), undefined);
    assert.equal((await ok(base + '/' + p.id)).rows[0].state, 'READY');
  } finally {
    await admin.query('DROP TRIGGER local_fault ON zhiban_imports.rows');
    await admin.query('DROP FUNCTION zhiban_imports.local_fault()');
  }
  await commit(p.id);
  // Lose only the acknowledgment after a real durable business commit, then read and explicitly retry.
  const lost = await preview('CLASSES', 'code,name\nIMP_LOST,提交回执丢失');
  const handle = await security.authenticate(
    manager.cookie!.slice(manager.cookie!.indexOf('=') + 1),
  );
  assert.ok(handle);
  const context = { handle, tenantId: t, actorMembershipId: manager.member };
  let cut = false;
  const lostStore: AcademicStore = {
    run: async (ctx, command, work) => {
      const result = await store.run(ctx, command, async (a, tx) => {
        const port = tx.imports!,
          state = port.state.bind(port);
        port.state = async (...args) => {
          await state(...args);
          cut = true;
        };
        return work(a, tx);
      });
      if (cut) {
        cut = false;
        throw new AcademicError('UNAVAILABLE');
      }
      return result;
    },
    runForRelated: store.runForRelated?.bind(store),
  };
  await assert.rejects(new ImportsService(lostStore).commit(context, lost.id));
  assert.equal((await new ImportsService(store).read(context, lost.id)).rows[0].state, 'IMPORTED');
  await commit(lost.id);
  const key = (
    await admin.query(
      'SELECT command_key FROM zhiban_imports.rows WHERE tenant_id=$1 AND batch_id=$2',
      [t, lost.id],
    )
  ).rows[0].command_key;
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND command_key=$2',
        [t, key],
      )
    ).rows[0].n,
    1,
  );
  // Current administrator revocation applies to reads and writes, even known completed IDs.
  const revokedAdmin = actors[2];
  const ownPreview = await http(base, revokedAdmin, {
    type: 'PREVIEW',
    kind: 'CLASSES',
    csv: 'code,name\nIMP_REVOKED,撤权后不得导入',
  });
  assert.equal(ownPreview.status, 200);
  const revokedId = (ownPreview.json as View).id;
  await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1', [
    revokedAdmin.grant,
    Date.now(),
  ]);
  assert.equal((await http(base + '/' + revokedId, revokedAdmin)).status, 403);
  assert.equal((await http(base + '/' + revokedId, revokedAdmin, { type: 'COMMIT' })).status, 403);
  assert.equal(await loadImports(businessPool), true);
  await admin.query('GRANT DELETE ON zhiban_imports.rows TO zhiban_academic_runtime');
  try {
    await assert.rejects(loadImports(businessPool));
  } finally {
    await admin.query('REVOKE DELETE ON zhiban_imports.rows FROM zhiban_academic_runtime');
  }
  assert.equal(await loadImports(businessPool), true);
  const client = await businessPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [foreign.tenant]);
    assert.equal(
      (
        await client.query('SELECT count(*)::int AS n FROM zhiban_imports.batches WHERE id=$1', [
          lost.id,
        ])
      ).rows[0].n,
      0,
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  record(
    'PASS durable partial rows, same-batch concurrency/replay, reconstructed service, expiry readback, atomic receipt rollback, lost real COMMIT ACK, current admin revocation, RLS and loader ACL drift refusal',
  );
  const bc = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const [name, value] = manager.cookie!.split('=');
  await bc.addCookies([
    { name, value, url: origin, secure: true, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await bc.newPage();
  try {
    await page.goto(origin + `/zhiban/admin/import?tenant=${t}`);
    await page.getByLabel('导入类别', { exact: true }).selectOption('CLASSES');
    await page.getByLabel('CSV 内容', { exact: true }).fill('code,name\nIMP_UI,浏览器导入行政班');
    await page.getByRole('button', { name: '预览并保存批次', exact: true }).click();
    await expect(page.getByRole('heading', { name: '行政班 · 预览与结果' })).toBeVisible();
    await page.getByRole('button', { name: '确认导入／继续原批次', exact: true }).click();
    await expect(page.getByRole('heading', { name: '行政班 · 导入完成' })).toBeVisible();
    const url = page.url();
    await page.reload();
    await expect(page.getByRole('heading', { name: '行政班 · 导入完成' })).toBeVisible();
    assert.equal(page.url(), url);
    await page.screenshot({
      path: 'docs/v2/evidence/academic-imports/directed-browser.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.getByRole('button', { name: '读取原批次结果', exact: true }).isVisible());
  } catch (error) {
    await page.screenshot({
      path: 'docs/v2/evidence/academic-imports/browser-failure.png',
      fullPage: true,
    });
    await writeFile(
      'docs/v2/evidence/academic-imports/browser-failure.txt',
      await page.locator('body').innerText(),
    );
    throw error;
  } finally {
    await bc.close();
  }
  record(
    'PASS browser category/template/input/preview/confirm/result/reload journey; current-page results include persistent original batch links',
  );
  await writeFile(
    'docs/v2/evidence/academic-imports/directed-journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope: 'SEVEN_ACADEMIC_IMPORT_KINDS_AND_DURABLE_BATCH_RESULTS',
        businessPreviewNoWrite: true,
        perRowAtomicNotWholeBatch: true,
        reconstructedServiceReadback: true,
        realCommitLostAckRecovery: true,
        adminRevocation: true,
        crossTenantRls: true,
        importsDidNotChangeCredentialOrRoles: true,
        noProductionOrRealData: true,
      },
      null,
      2,
    ) + '\n',
  );
}
