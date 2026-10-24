/** Directed real PG16/Identity and browser journey for course PBL collaboration. No model/native runtime completion is fabricated. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect, type Page } from '@playwright/test';
import type { Pool, QueryResultRow } from 'pg';
import type { prepareTrial } from './prepare-trial';
import { projectExample } from '../../tests/zhiban/pbl/fixtures';
import { pblDigest } from '../../lib/zhiban/domain/pbl/model';
import { loadPbl } from './pbl';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: Pool;
};
type Row = QueryResultRow;
export async function verifyPbl(input: Input) {
  const { admin, businessPool, browser, actors, http, tenant: t, origin, record, trial } = input;
  const teacher = actors[0],
    student = actors[1],
    manager = actors[4],
    peers = [actors[5], actors[6], actors[7]],
    other = actors[8],
    newcomer = actors[9];
  const o = trial.offeringId,
    base = `/api/zhiban/pbl/${t}/offerings/${o}`,
    manage = `/api/zhiban/management/${t}/commands`;
  const request = async (c: unknown, a = teacher, key = v7()) =>
    http(base, a, c, 'POST', { 'x-zhiban-command': key });
  const send = async (c: unknown, a = teacher, key = v7()) => {
    const r = await request(c, a, key);
    assert.equal(r.status, 200, JSON.stringify({ command: c, response: r.json }));
    return r.json as Row;
  };
  const read = async (query = '', a = teacher) => {
    const r = await http(base + query, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Row;
  };
  const manageSend = async (c: unknown) => {
    const r = await http(manage, manager, c, 'POST', { 'x-zhiban-command': v7() });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  for (const [a, name] of [
    [peers[0], '林同学'],
    [peers[1], '张同学'],
    [peers[2], '赵同学'],
    [other, '外组同学'],
    [newcomer, '后加入同学'],
  ] as const) {
    await admin.query(
      'INSERT INTO zhiban_academic.people VALUES($1,$2,$3) ON CONFLICT(tenant_id,membership_id) DO UPDATE SET display_name=EXCLUDED.display_name',
      [t, a.member, name],
    );
    if (a !== peers[0])
      await manageSend({ type: 'ENROLL', offeringId: o, membershipId: a.member, revision: null });
  }
  const course = (
    await admin.query(
      'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
      [t, o],
    )
  ).rows[0].course_id;
  const url = (role: string, fragment = '') =>
    `${origin}/zhiban/${role}/courses/${course}/pbl?space=${t}&offering=${o}${fragment}`;
  const settled = (page: Page) =>
    expect(page.locator('#pbl')).toHaveAttribute('aria-busy', 'false');
  const errors: string[] = [],
    contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  const pageFor = async (a: typeof student, role: string, fragment = '') => {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    assert.ok(a.cookie);
    const [name, ...rest] = a.cookie.split('=');
    await ctx.addCookies([
      {
        name,
        value: rest.join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', async (r) => {
      if (r.url().includes('/api/zhiban/pbl/') && r.status() >= 400)
        console.log(
          'PBL browser HTTP',
          r.status(),
          r.request().method(),
          JSON.stringify(await r.json()),
        );
    });
    page.on('dialog', (d) => void d.accept());
    await page.goto(url(role, fragment));
    await expect(
      page.getByRole('heading', { name: 'PBL 小组协作项目', exact: true }),
    ).toBeVisible();
    await settled(page);
    return page;
  };
  let project: Row, group: Row, firstSubmission: Row;
  try {
    const tp = await pageFor(teacher, 'teacher');
    await tp.getByText('复用原生PBL v2项目', { exact: true }).click();
    const imported = projectExample();
    imported.submissions = [{ content: 'not a group submission' }];
    imported.evaluations = [{ score: 100 }];
    await tp.getByLabel('原生PBL项目JSON（可选）', { exact: true }).fill(JSON.stringify(imported));
    await tp.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布项目版本', exact: true })).toBeVisible();
    await settled(tp);
    project = (await read()).rows[0];
    assert.deepEqual((await read('?project=' + project.id)).project.design.submissions, []);
    assert.equal((await http(base + '?project=' + project.id, student)).status, 404);
    await tp.getByRole('button', { name: '发布项目版本', exact: true }).click();
    await expect(tp.getByRole('button', { name: '建立小组', exact: true })).toBeVisible();
    await settled(tp);
    await tp.getByLabel('小组名称', { exact: true }).fill('节能协作一组');
    for (const name of ['陈同学', '林同学', '张同学', '赵同学'])
      await tp.getByLabel(name, { exact: true }).check();
    await tp.getByLabel('已核对小组名单及共享成果交接范围', { exact: true }).check();
    await tp.getByRole('button', { name: '建立小组', exact: true }).click();
    await expect(tp.getByRole('heading', { name: '共同成果', exact: true })).toBeVisible();
    group = (await read('?project=' + project.id)).rows[0];
    let detail = await read('?group=' + group.id);
    assert.equal(detail.members.length, 4);
    record(
      'PBL: teacher browser adopts native PBL v2 design, strips learner/agent state, publishes and builds a four-person course group through existing paged roster',
    );
    const otherGroup = await send({
      type: 'CREATE_GROUP',
      projectId: project.id,
      name: '独立二组',
      members: [other.member],
    });
    assert.equal((await http(base + '?group=' + group.id, other)).status, 404);
    assert.equal((await http(base + '?group=' + otherGroup.id, student)).status, 404);
    assert.equal(
      (
        await request({
          type: 'CREATE_GROUP',
          projectId: project.id,
          name: '重复成员',
          members: [student.member],
        })
      ).status,
      409,
    );
    for (const a of [student, actors[2], actors[3]])
      assert.equal(
        (await request({ type: 'CLOSE_PROJECT', id: project.id, revision: '2' }, a)).status,
        403,
      );
    const sp = await pageFor(student, 'student', '#group-' + group.id),
      bp = await pageFor(peers[0], 'student', '#group-' + group.id);
    await sp
      .getByLabel('调查问题 · 共同成果', { exact: true })
      .fill('观察了教室照明和空调用电，记录来源及不确定性。');
    await sp
      .getByLabel('改造方案 · 共同成果', { exact: true })
      .fill('先分时关闭空置区照明，再按相同条件比较。');
    await sp
      .getByLabel('小组共同反思', { exact: true })
      .fill('四人核对来源，估计不能代替仪器测量。');
    await sp.getByRole('button', { name: '保存共享成果', exact: true }).click();
    await expect(sp.getByText('共享成果版本 2 · 名单版本 1', { exact: true })).toBeVisible();
    await bp.getByRole('button', { name: '刷新当前页', exact: true }).click();
    await expect(bp.getByLabel('调查问题 · 共同成果', { exact: true })).toHaveValue(
      '观察了教室照明和空调用电，记录来源及不确定性。',
    );
    await bp
      .getByLabel('改造方案 · 共同成果', { exact: true })
      .fill('补充对照：同一时段、相同照度；分区域比较节电与舒适度。');
    await bp.getByRole('button', { name: '保存共享成果', exact: true }).click();
    await expect(bp.getByText('共享成果版本 3 · 名单版本 1', { exact: true })).toBeVisible();
    await sp.getByRole('button', { name: '刷新当前页', exact: true }).click();
    await expect(sp.getByLabel('改造方案 · 共同成果', { exact: true })).toHaveValue(
      '补充对照：同一时段、相同照度；分区域比较节电与舒适度。',
    );
    await sp.getByLabel('我已核对当前已保存成果，同意作为本组共同提交', { exact: true }).check();
    await sp.getByRole('button', { name: '确认当前成果', exact: true }).click();
    await expect(sp.getByText('陈同学 · 已确认当前成果', { exact: true })).toBeVisible();
    detail = await read('?group=' + group.id);
    assert.equal(
      (
        await request(
          { type: 'SUBMIT_GROUP', id: group.id, revision: detail.group.revision },
          student,
        )
      ).status,
      409,
    );
    const saveKey = v7(),
      work = { ...detail.group.work, reflection: '在共同编辑中核对了四人的意见。' };
    await send(
      { type: 'SAVE_WORK', id: group.id, revision: detail.group.revision, work },
      peers[0],
      saveKey,
    );
    detail = await read('?group=' + group.id);
    assert.equal(
      detail.confirmations.filter(
        (c: Row) => c.confirmed && c.work_revision === detail.group.work_revision,
      ).length,
      0,
    );
    const race = await Promise.all(
      [student, peers[0]].map((a, i) =>
        request(
          {
            type: 'SAVE_WORK',
            id: group.id,
            revision: detail.group.revision,
            work: { ...work, reflection: '并发草稿胜者 ' + i },
          },
          a,
        ),
      ),
    );
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    detail = await read('?group=' + group.id);
    for (const a of [student, ...peers])
      await send({ type: 'CONFIRM_WORK', id: group.id, revision: detail.group.revision }, a);
    // Real browser performs the final joint submission; UI explicitly confirms the saved version.
    await sp.getByRole('button', { name: '刷新当前页', exact: true }).click();
    await expect(
      sp.getByText(
        `共享成果版本 ${detail.group.work_revision} · 名单版本 ${detail.group.membership_revision}`,
        { exact: true },
      ),
    ).toBeVisible();
    await sp.getByRole('button', { name: '提交全组已确认成果', exact: true }).click();
    await expect(
      sp.getByRole('heading', { name: '节能协作一组 · 第 1 次共同提交', exact: true }),
    ).toBeVisible();
    detail = await read('?group=' + group.id);
    firstSubmission = detail.rows[0];
    const frozen = (await read(`?group=${group.id}&submission=${firstSubmission.id}`)).submission;
    assert.equal(frozen.members.length, 4);
    assert.ok(frozen.members.every((m: Row) => /^\d+$/.test(m.confirmedAt)));
    assert.equal(
      frozen.source_digest,
      pblDigest({
        designVersion: String(frozen.project_version),
        work: frozen.work,
        members: frozen.members,
      }),
    );
    record(
      'PBL: two student browsers share saved work; CAS rejects competing edits; any edit invalidates old confirmations; all four affirm the same revision before one immutable joint submission',
    );
    // Browser teacher publication and public correction use the exact immutable submission.
    await tp.goto(url('teacher', `#submission-${group.id}:${firstSubmission.id}`));
    await tp.getByLabel('项目评分（0–100）', { exact: true }).fill('86');
    await tp
      .getByLabel('公开评价', { exact: true })
      .fill('调查依据清楚，方案有对照；请进一步说明样本局限。');
    await tp.getByLabel('确认向本次共同提交成员发布评价', { exact: true }).check();
    await tp.getByRole('button', { name: '发布教师评价', exact: true }).click();
    await expect(
      tp.getByRole('heading', { name: '评价版本 1 · 86/100', exact: true }),
    ).toBeVisible();
    assert.equal(
      (
        await request({
          type: 'PUBLISH_EVALUATION',
          id: firstSubmission.id,
          revision: '1',
          score: 88,
          feedback: '补充核对后的评价',
          reason: '',
        })
      ).status,
      400,
    );
    const corrected = await send({
      type: 'PUBLISH_EVALUATION',
      id: firstSubmission.id,
      revision: '1',
      score: 88,
      feedback: '复核后将方案论证由遗漏项计入，证据完整。',
      reason: '原评价遗漏了对照方案的论证。',
    });
    assert.equal(corrected.version, '2');
    for (let version = 2; version <= 10; version++)
      await send({
        type: 'PUBLISH_EVALUATION',
        id: firstSubmission.id,
        revision: String(version),
        score: 88,
        feedback: '复核后的教师评价保持88分。',
        reason: 'LOCAL边界验证：保留历史并检查两位数版本排序。',
      });
    assert.equal(
      (await read(`?group=${group.id}&submission=${firstSubmission.id}&kind=EVALUATIONS`))
        .evaluations[0].version,
      '11',
    );
    await sp.reload();
    await expect(
      sp.getByRole('heading', { name: '评价版本 2 · 88/100', exact: true }),
    ).toBeVisible();
    await expect(
      sp.getByText('更正原因：原评价遗漏了对照方案的论证。', { exact: true }),
    ).toBeVisible();
    await sp.screenshot({ path: 'docs/v2/evidence/pbl/student-result.png', fullPage: true });
    // Fixed source design: a later teacher publication does not rewrite the existing group.
    const pstate = (await read('?project=' + project.id)).project,
      updated = projectExample();
    updated.title = '下一版节能项目';
    await send({
      type: 'SAVE_PROJECT',
      id: project.id,
      revision: pstate.revision,
      design: updated,
      deadlineAt: null,
      allowResubmit: true,
    });
    await send({
      type: 'PUBLISH_PROJECT',
      id: project.id,
      revision: String(BigInt(pstate.revision) + BigInt(1)),
    });
    assert.equal((await read('?group=' + group.id)).version.design.title, '节能教室改造项目');
    // Late SQL failure cannot leave a report or changed group pointer/command without the audit.
    detail = await read('?group=' + group.id);
    await send(
      {
        type: 'SAVE_WORK',
        id: group.id,
        revision: detail.group.revision,
        work: { ...detail.group.work, reflection: '补充样本局限，第二次共同修订。' },
      },
      student,
    );
    detail = await read('?group=' + group.id);
    for (const a of [student, ...peers])
      await send({ type: 'CONFIRM_WORK', id: group.id, revision: detail.group.revision }, a);
    const command = { type: 'SUBMIT_GROUP', id: group.id, revision: detail.group.revision },
      key = v7(),
      before = await read('?group=' + group.id);
    await admin.query('REVOKE INSERT ON zhiban_pbl.events FROM zhiban_academic_runtime');
    try {
      assert.equal((await request(command, student, key)).status, 503);
    } finally {
      await admin.query('GRANT INSERT ON zhiban_pbl.events TO zhiban_academic_runtime');
    }
    const after = await read('?group=' + group.id);
    assert.equal(after.group.latest_submission_id, before.group.latest_submission_id);
    assert.equal(after.group.revision, before.group.revision);
    assert.equal(after.rows.length, 1);
    assert.equal(
      (
        await admin.query(
          'SELECT 1 FROM zhiban_pbl.commands WHERE tenant_id=$1 AND command_key=$2',
          [t, key],
        )
      ).rowCount,
      0,
    );
    const duplicated = await Promise.all([
      send(command, student, key),
      send(command, student, key),
    ]);
    assert.equal(duplicated[0].id, duplicated[1].id);
    assert.equal((await read('?group=' + group.id)).rows.length, 2);
    assert.deepEqual(
      (await read(`?group=${group.id}&submission=${firstSubmission.id}`)).submission,
      frozen,
    );
    record(
      'PBL: teacher publishes 86/100 and corrects to 88 with a public reason; pinned native design and first submission remain unchanged; duplicate submit deduplicates and late audit failure rolls back all submission state',
    );
    // Current group authority is independent from historical submission membership.
    detail = await read('?group=' + group.id);
    assert.equal(
      (
        await request({
          type: 'SET_MEMBERS',
          id: group.id,
          revision: detail.group.revision,
          name: '冲突改组',
          members: [student.member, other.member],
          reason: '已有其他组',
        })
      ).status,
      409,
    );
    await send(
      {
        type: 'SAVE_WORK',
        id: group.id,
        revision: detail.group.revision,
        work: { ...detail.group.work, reflection: '改组竞争前的全员共同成果。' },
      },
      student,
    );
    detail = await read('?group=' + group.id);
    for (const who of [student, ...peers])
      await send({ type: 'CONFIRM_WORK', id: group.id, revision: detail.group.revision }, who);
    const adjust = {
      type: 'SET_MEMBERS',
      id: group.id,
      revision: detail.group.revision,
      name: '节能协作一组',
      members: [student.member, peers[1].member, peers[2].member, newcomer.member],
      reason: '调整协作成员，明确交接共享草稿。',
    };
    const membershipRace = await Promise.all([
      request(adjust),
      request({ type: 'SUBMIT_GROUP', id: group.id, revision: detail.group.revision }, student),
    ]);
    assert.deepEqual(membershipRace.map((r) => r.status).sort(), [200, 409]);
    if (membershipRace[1].status === 200) {
      const committed = (membershipRace[1].json as Row).id;
      const original = (await read(`?group=${group.id}&submission=${committed}`)).submission;
      assert.ok(original.members.some((m: Row) => m.membershipId === peers[0].member));
      assert.ok(!original.members.some((m: Row) => m.membershipId === newcomer.member));
      const changed = await read('?group=' + group.id);
      await send({ ...adjust, revision: changed.group.revision });
    }
    detail = await read('?group=' + group.id);
    assert.equal((await read('?group=' + group.id, peers[0])).group.work, undefined);
    assert.equal(
      (
        await request(
          {
            type: 'SAVE_WORK',
            id: group.id,
            revision: detail.group.revision,
            work: detail.group.work,
          },
          peers[0],
          saveKey,
        )
      ).status,
      403,
    );
    assert.equal(
      (await http(base + `?group=${group.id}&submission=${firstSubmission.id}`, newcomer)).status,
      404,
    );
    assert.equal(
      (await http(base + `?group=${group.id}&submission=${firstSubmission.id}`, peers[0])).status,
      200,
    );
    assert.equal(
      detail.confirmations.filter(
        (c: Row) =>
          c.confirmed &&
          c.work_revision === detail.group.work_revision &&
          c.membership_revision === detail.group.membership_revision,
      ).length,
      0,
    );
    // Administrative withdrawal blocks group writes. Restoration does not silently revive an old group join.
    let enrollment = (
      await admin.query(
        "SELECT * FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
        [t, o, peers[2].member],
      )
    ).rows[0];
    await manageSend({
      type: 'WITHDRAW',
      id: enrollment.id,
      revision: String(enrollment.revision),
    });
    assert.equal(
      (
        await request(
          {
            type: 'SAVE_WORK',
            id: group.id,
            revision: detail.group.revision,
            work: detail.group.work,
          },
          student,
        )
      ).status,
      403,
    );
    enrollment = (
      await admin.query('SELECT * FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2', [
        t,
        enrollment.id,
      ])
    ).rows[0];
    await manageSend({
      type: 'ENROLL',
      offeringId: o,
      membershipId: peers[2].member,
      revision: String(enrollment.revision),
    });
    assert.equal(
      (
        await request(
          {
            type: 'SAVE_WORK',
            id: group.id,
            revision: detail.group.revision,
            work: detail.group.work,
          },
          student,
        )
      ).status,
      403,
    );
    await send({
      type: 'SET_MEMBERS',
      id: group.id,
      revision: detail.group.revision,
      name: '节能协作一组',
      members: [student.member, peers[1].member, peers[2].member, newcomer.member],
      reason: '已核对恢复入班，重新交接当前草稿。',
    });
    detail = await read('?group=' + group.id);
    record(
      'PBL: membership change versus submit has one winner; moving members invalidates all consents; removed members retain only their immutable submissions, newcomers cannot see old submissions; withdrawal/restoration requires explicit group rejoin',
    );
    // A real Identity grant revocation waits for an already-authorized business write, then closes future writes.
    const identity = `/api/zhiban/identity/tenants/${t}`;
    const point = await http(
      identity + `/memberships/${newcomer.member}?actorMembershipId=${manager.member}`,
      manager,
    );
    assert.equal(point.status, 200, JSON.stringify(point.json));
    const p = point.json as Row;
    const revokeBody = {
      actorMembershipId: manager.member,
      expectedActorRevision: p.actorRevision,
      expectedActorAuthorizationVersion: p.actorAuthorizationVersion,
      expectedTenantRevision: p.tenantRevision,
      expectedRevision: p.revision,
      expectedAuthorizationVersion: p.authorizationVersion,
      password: manager.password,
      revokeGrantId: newcomer.grant,
    };
    const blocker = await admin.connect();
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE zhiban_pbl.events IN SHARE MODE');
    let write: ReturnType<typeof request> | null = null,
      revoke: ReturnType<typeof http> | null = null;
    try {
      write = request(
        {
          type: 'SAVE_WORK',
          id: group.id,
          revision: detail.group.revision,
          work: { ...detail.group.work, reflection: '撤权屏障前已授权的共同修订。' },
        },
        student,
      );
      let blocked = false;
      for (let i = 0; i < 120; i++) {
        const n = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename='zhiban_academic_runtime' AND wait_event_type='Lock' AND query LIKE 'INSERT INTO zhiban_pbl.events%' LIMIT 1",
        );
        if (n.rowCount) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(blocked, true, 'group write did not reach audit latch');
      let finished = false;
      revoke = http(
        identity + `/memberships/${newcomer.member}/revoke-grant`,
        manager,
        revokeBody,
        'POST',
        { 'idempotency-key': v7() },
      );
      void revoke.then(() => {
        finished = true;
      });
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(finished, false, 'revocation bypassed held participant guard');
      await blocker.query('COMMIT');
      assert.equal((await write).status, 200);
      assert.equal((await revoke).status, 200);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      if (write) await write;
      if (revoke) await revoke;
    }
    detail = await read('?group=' + group.id);
    assert.equal(
      (
        await request(
          {
            type: 'SAVE_WORK',
            id: group.id,
            revision: detail.group.revision,
            work: detail.group.work,
          },
          student,
        )
      ).status,
      403,
    );
    await send({
      type: 'SET_MEMBERS',
      id: group.id,
      revision: detail.group.revision,
      name: '节能协作一组',
      members: [student.member, peers[1].member, peers[2].member],
      reason: '撤权后移出已失去学生权限的成员。',
    });
    const oldOther = await read('?group=' + otherGroup.id);
    await send({
      type: 'SET_MEMBERS',
      id: otherGroup.id,
      revision: oldOther.group.revision,
      name: '空组保留历史',
      members: [],
      reason: '全部组员转入一组，保留旧组与历史。',
    });
    assert.equal((await read('?group=' + otherGroup.id)).members.length, 0);
    assert.equal((await http(base + '?group=' + otherGroup.id, other)).status, 404);
    const currentGroup = await read('?group=' + group.id);
    await send({
      type: 'SET_MEMBERS',
      id: group.id,
      revision: currentGroup.group.revision,
      name: '节能协作一组',
      members: [student.member, peers[1].member, peers[2].member, other.member],
      reason: '接收二组全部组员，重新核对共同成果。',
    });
    assert.equal((await read('?group=' + group.id, other)).canEdit, true);
    assert.equal(
      (await http(base + `?group=${group.id}&submission=${firstSubmission.id}`, other)).status,
      404,
    );
    const smallProject = async (
      name: string,
      allowResubmit: boolean,
      deadlineAt: number | null,
    ) => {
      const d = projectExample();
      d.title = name;
      const p = await send({ type: 'CREATE_PROJECT', design: d, deadlineAt, allowResubmit });
      await send({ type: 'PUBLISH_PROJECT', id: p.id, revision: p.revision });
      const g = await send({
        type: 'CREATE_GROUP',
        projectId: p.id,
        name: name + '组',
        members: [student.member],
      });
      await send(
        {
          type: 'SAVE_WORK',
          id: g.id,
          revision: g.revision,
          work: {
            answers: { 'task-1': '明确的观察与来源。', 'task-2': '可核对的方案。' },
            reflection: '共同成果说明。',
          },
        },
        student,
      );
      const detail = await read('?group=' + g.id);
      await send({ type: 'CONFIRM_WORK', id: g.id, revision: detail.group.revision }, student);
      return { p, g, detail };
    };
    const once = await smallProject('仅一次共同提交', false, null);
    await send(
      { type: 'SUBMIT_GROUP', id: once.g.id, revision: once.detail.group.revision },
      student,
    );
    let fixed = await read('?group=' + once.g.id, student);
    assert.equal(fixed.canEdit, false);
    assert.equal(
      (
        await request(
          {
            type: 'SAVE_WORK',
            id: once.g.id,
            revision: fixed.group.revision,
            work: fixed.group.work,
          },
          student,
        )
      ).status,
      409,
    );
    await send({ type: 'CLOSE_PROJECT', id: once.p.id, revision: '2' });
    assert.equal((await read('?group=' + once.g.id, student)).rows.length, 1);
    await send({ type: 'REOPEN_PROJECT', id: once.p.id, revision: '3' });
    assert.equal((await read('?group=' + once.g.id, student)).canEdit, false);
    const deadline = Date.now() + 3000,
      late = await smallProject('固定截止共同提交', true, deadline);
    await new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now() + 30)));
    fixed = await read('?group=' + late.g.id, student);
    assert.equal(fixed.canEdit, false);
    assert.equal(
      (
        await request(
          { type: 'SUBMIT_GROUP', id: late.g.id, revision: fixed.group.revision },
          student,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          {
            type: 'SAVE_WORK',
            id: late.g.id,
            revision: fixed.group.revision,
            work: fixed.group.work,
          },
          student,
        )
      ).status,
      409,
    );
    const historyPage = await read(`?group=${group.id}&kind=REVISIONS`);
    assert.ok(historyPage.rows.length > 1);
    assert.ok(historyPage.rows.every((r: Row) => r.source_digest === pblDigest(r.work)));
    const evaluationPage = await read(
      `?group=${group.id}&submission=${firstSubmission.id}&kind=EVALUATIONS&after=2`,
      student,
    );
    assert.equal(evaluationPage.evaluations[0].version, '1');
    record(
      'PBL: complete-group reassignment preserves an empty historical group; fixed deadline, closed project and no-resubmit rules block new writes while retaining history; collaboration and evaluation history are paged and source digests match',
    );
    // ACL drift and tenant isolation checks are specific to the new schema/helper only.
    assert.equal(await loadPbl(businessPool), true);
    await admin.query(
      'GRANT EXECUTE ON FUNCTION zhiban_pbl.lock_participants(uuid,uuid[]) TO zhiban_academic_runtime',
    );
    try {
      await assert.rejects(() => loadPbl(businessPool));
    } finally {
      await admin.query(
        'REVOKE EXECUTE ON FUNCTION zhiban_pbl.lock_participants(uuid,uuid[]) FROM zhiban_academic_runtime',
      );
    }
    assert.equal(await loadPbl(businessPool), true);
    const noTenant = await businessPool.connect();
    try {
      await noTenant.query('BEGIN');
      assert.equal((await noTenant.query('SELECT * FROM zhiban_pbl.submissions')).rowCount, 0);
      await assert.rejects(() =>
        noTenant.query('SELECT zhiban_pbl.lock_participants($1,$2)', [t, [student.member]]),
      );
    } finally {
      await noTenant.query('ROLLBACK');
      noTenant.release();
    }
    await admin.query('GRANT UPDATE ON zhiban_pbl.submissions TO zhiban_academic_runtime');
    try {
      await assert.rejects(() => loadPbl(businessPool));
    } finally {
      await admin.query('REVOKE UPDATE ON zhiban_pbl.submissions FROM zhiban_academic_runtime');
    }
    assert.equal(await loadPbl(businessPool), true);
    const badCsrf = await http(
      base,
      student,
      { type: 'CONFIRM_WORK', id: group.id, revision: '1' },
      'POST',
      { 'x-zhiban-command': v7(), 'x-zhiban-csrf': 'x'.repeat(43) },
    );
    assert.equal(badCsrf.status, 403);
    await tp.goto(url('teacher', '#group-' + group.id));
    await expect(tp.getByRole('heading', { name: '共同成果', exact: true })).toBeVisible();
    await tp.screenshot({ path: 'docs/v2/evidence/pbl/teacher-group.png', fullPage: true });
    await sp.setViewportSize({ width: 390, height: 844 });
    await sp.goto(url('student', `#submission-${group.id}:${firstSubmission.id}`));
    await expect(
      sp.getByRole('heading', { name: '评价版本 2 · 88/100', exact: true }),
    ).toBeVisible();
    assert.equal(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await sp.screenshot({ path: 'docs/v2/evidence/pbl/student-mobile.png', fullPage: true });
    const ch = await sp.context().newPage();
    await ch.goto(url('student', '#group-' + group.id));
    await expect(ch.getByLabel('小组共同反思', { exact: true })).toBeVisible();
    await ch.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(sp.getByRole('heading', { name: '共同成果', exact: true })).toHaveCount(0);
    await expect(sp.getByRole('heading', { name: '评价版本 2 · 88/100', exact: true })).toHaveCount(
      0,
    );
    await expect(sp.locator('#pbl')).toHaveCount(0);
    assert.equal((await http(base + '?group=' + group.id, student)).status, 401);
    assert.deepEqual(errors, []);
    record(
      'PBL: real Identity role revocation waits behind held four-party guard then closes new writes; separate helper/immutable-table ACL drift fails closed; tenant/role/CSRF/privacy and mobile/session clearing hold',
    );
    await writeFile(
      'docs/v2/evidence/zhiban-pbl-journey-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          at: new Date().toISOString(),
          scope:
            'NATIVE_PBL_DESIGN_REUSE_COURSE_GROUP_DRAFT_UNANIMOUS_SUBMISSION_AND_TEACHER_EVALUATION',
          projectId: project.id,
          groupId: group.id,
          submissionId: firstSubmission.id,
          nativeDesignReused: true,
          nativeAutonomousRuntimeEnabled: false,
          individualGradesAutomaticallyCreated: false,
          browserErrors: errors,
        },
        null,
        2,
      ) + '\n',
    );
  } catch (e) {
    for (let i = 0; i < contexts.length; i++) {
      for (const page of contexts[i].pages()) {
        console.log(
          'PBL browser diagnostic',
          i,
          await page.locator('[role=alert]').allTextContents(),
        );
        await page
          .screenshot({ path: `docs/v2/evidence/pbl/failure-${i}.png`, fullPage: true })
          .catch(() => {});
      }
    }
    throw e;
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
}
