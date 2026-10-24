/** LOCAL fault provider exercises authorization and persistence only; never claims real AI success. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import type { AcademicContext, AcademicStore } from '../../lib/zhiban/application/academic/service';
import type { IdentityAuthentication } from '../../lib/zhiban/infrastructure/identity/composition/authentication';
import { TutorService, type TutorContent } from '../../lib/zhiban/application/tutor/service';
import type { TutorEngine } from '../../lib/zhiban/infrastructure/tutor/native';
import type { TutorRun } from '../../lib/zhiban/infrastructure/tutor/postgres/transaction';
import { loadTutor } from './tutor';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: import('pg').Pool;
  store: AcademicStore;
  security: IdentityAuthentication;
  content: TutorContent;
};
export async function verifyTutor(input: Input) {
  const {
      admin,
      businessPool,
      store,
      security,
      content,
      browser,
      http,
      tenant: t,
      origin,
      trial,
      record,
      actors: [teacher, student, outsider, foreign, manager, peer],
    } = input,
    o = trial.offeringId,
    base = `/api/zhiban/tutor/${t}/offerings/${o}`,
    contentBase = `/api/zhiban/content/${t}/offerings/${o}`;
  const decode = (x: unknown) =>
    x as {
      id: string;
      revision: string;
      turnId: string;
      policy: { enabled: boolean };
      session: { revision: string };
      rows: { state: string }[];
      resources: { id: string; revision: string; draft: { slides: Record<string, unknown>[] } }[];
    }; // Synthetic HTTP fixture DTO; never authorization facts.
  const read = async (a = student, id?: string) => {
    const r = await http(
      base +
        '?' +
        new URLSearchParams({ mode: a === teacher ? 'TEACHER' : 'STUDENT', ...(id ? { id } : {}) }),
      a,
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return decode(r.json);
  };
  const send = async (path: string, a: typeof teacher, c: unknown, key = v7()) => {
    const r = await http(path, a, c, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return decode(r.json);
  };
  const context = async (a: typeof teacher): Promise<AcademicContext> => {
    const handle = await security.authenticate(a.cookie!.split('=').slice(1).join('='));
    assert.ok(handle);
    return { handle, tenantId: t, actorMembershipId: a.member };
  };
  const tc = await context(teacher),
    sc = await context(student),
    pc = await context(peer);
  let calls = 0;
  const runs: {
    run: TutorRun;
    signal: AbortSignal;
    resolve: (x: { text: string; model: { provider: string; model: string } }) => void;
  }[] = [];
  const engine: TutorEngine = {
    capability: async () => ({
      ready: true,
      provider: 'CONTROLLED_FAULT_PROVIDER',
      model: 'NO_REAL_MODEL',
    }),
    generate: async (_owner, run, signal) => {
      calls++;
      return new Promise((resolve) => runs.push({ run, signal, resolve }));
    },
  };
  const host = new TutorService(store, content, engine, true);
  const execute = (x: AcademicContext, c: unknown, key = v7()) => host.execute(x, o, c, key);
  const wait = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 150; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error('Tutor directed state timeout');
  };
  const row = async (turn: string) =>
    (await admin.query('SELECT * FROM zhiban_tutor.turns WHERE id=$1', [turn])).rows[0];
  const settle = async (index: number, text = 'CONTROLLED PROVIDER OUTPUT — 仅边界测试') => {
    runs[index].resolve({
      text,
      model: { provider: 'CONTROLLED_FAULT_PROVIDER', model: 'NO_REAL_MODEL' },
    });
  };
  const awaitState = async (id: string, state: string) =>
    wait(async () => (await row(id)).state === state);
  const fail = async (fn: () => Promise<unknown>, code?: string) =>
    code
      ? assert.rejects(fn, (e: unknown) => (e as { code: string }).code === code)
      : assert.rejects(fn);
  const create = async (x = sc, resourceId: string | null = null) =>
    decode(
      await execute(x, {
        type: 'CREATE_SESSION',
        mode: x === tc ? 'TEACHER' : 'STUDENT',
        title: 'LOCAL 课程辅导边界',
        resourceId,
      }),
    );
  const ask = async (id: string, message = '请逐步提示如何复习电路。', x = sc, key = v7()) => {
    const page = decode(await host.read(x, o, { mode: x === tc ? 'TEACHER' : 'STUDENT', id }));
    const r = decode(
      await execute(
        x,
        {
          type: 'ASK',
          mode: x === tc ? 'TEACHER' : 'STUDENT',
          id,
          revision: page.session.revision,
          message,
        },
        key,
      ),
    );
    await wait(async () => runs.some((run) => run.run.turnId === r.turnId));
    return r;
  };
  const policy = async (enabled: boolean, guidance = '先了解思路，再给分步提示。') => {
    const p = await host.read(tc, o, { mode: 'TEACHER' });
    return execute(tc, {
      type: 'SET_POLICY',
      mode: 'TEACHER',
      revision: p.policy.revision,
      enabled,
      guidance,
    });
  };
  const bc = await browser.newContext();
  try {
    assert.equal((await read()).policy.enabled, false);
    assert.equal((await http(base + '?mode=STUDENT')).status, 401);
    for (const a of [outsider, foreign, manager])
      assert.equal((await http(base + '?mode=STUDENT', a)).status, 403);
    assert.equal((await http(base + '?mode=TEACHER', student)).status, 403);
    assert.equal(
      (
        await http(base, student, {
          type: 'SET_POLICY',
          mode: 'TEACHER',
          revision: '0',
          enabled: true,
          guidance: '',
        })
      ).status,
      403,
    );
    await fail(() => create(), 'INVALID_STATE');
    for (const extra of [
      { ownerId: teacher.member },
      { history: [] },
      { model: 'client-model' },
      { dimensions: {} },
    ])
      assert.equal(
        (
          await http(base, student, {
            type: 'CREATE_SESSION',
            mode: 'STUDENT',
            title: '拒绝伪造',
            resourceId: null,
            ...extra,
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await http(
          base,
          teacher,
          { type: 'SET_POLICY', mode: 'TEACHER', revision: '0', enabled: true, guidance: '' },
          'POST',
          { 'x-zhiban-csrf': 'invalid' },
        )
      ).status,
      403,
    );
    await bc.addCookies([
      {
        name: teacher.cookie!.split('=')[0],
        value: teacher.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await bc.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${origin}/zhiban/teacher/courses/${trial.courseId}?space=${t}&offering=${o}`);
    await page.getByRole('link', { name: 'AI 学习辅导', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI 学习辅导', exact: true })).toBeVisible();
    await page.getByText('教师设置', { exact: true }).click();
    await page.getByRole('checkbox').check();
    await page
      .getByLabel('教师学习提示', { exact: true })
      .fill('先帮助学生解释思路，不提供正式评价。');
    await page.getByRole('button', { name: '保存辅导设置', exact: true }).click();
    await expect(page.locator('#tutor')).toContainText('教师已启用本班 AI 辅导。');
    await page.screenshot({ path: 'docs/v2/evidence/tutor/directed-teacher.png' });
    assert.deepEqual(errors, []);
    await page.getByLabel('教师学习提示', { exact: true }).fill('不得静默覆盖其他操作');
    await policy(true, '另一操作已经保存的新提示');
    const conflictResponse = page.waitForResponse(
      (r) => new URL(r.url()).pathname === base && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '保存辅导设置', exact: true }).click();
    assert.equal((await conflictResponse).status(), 409);
    assert.equal(
      (await host.read(tc, o, { mode: 'TEACHER' })).policy.guidance,
      '另一操作已经保存的新提示',
    );
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: '重新载入辅导设置', exact: true }).click();
    await expect(page.getByLabel('教师学习提示', { exact: true })).toHaveValue(
      '另一操作已经保存的新提示',
    );
    const first = await create(),
      key = v7(),
      askBody = {
        type: 'ASK',
        mode: 'STUDENT',
        id: first.id,
        revision: first.revision,
        message: '如何检查测量依据？',
      };
    const r = decode(await execute(sc, askBody, key));
    await wait(async () => calls === 1);
    assert.deepEqual(
      await execute(
        sc,
        {
          message: askBody.message,
          id: first.id,
          revision: first.revision,
          mode: 'STUDENT',
          type: 'ASK',
        },
        key,
      ),
      r,
    );
    await fail(() => execute(sc, { ...askBody, message: '不同问题' }, key), 'CONFLICT');
    assert.equal(calls, 1);
    await fail(() => host.read(pc, o, { mode: 'STUDENT', id: first.id }), 'NOT_FOUND');
    assert.equal((await http(base + '?mode=TEACHER&id=' + first.id, teacher)).status, 404);
    assert.equal((await http(base + '?mode=STUDENT&id=' + first.id, peer)).status, 404);
    await settle(0);
    await awaitState(r.turnId, 'COMPLETED');
    const second = await ask(first.id, '请继续给我自检问题。');
    assert.equal(runs[1].run.history.length, 1);
    assert.equal(runs[1].run.history[0].question, askBody.message);
    await execute(sc, { type: 'CANCEL', mode: 'STUDENT', id: first.id, turnId: second.turnId });
    await settle(1, 'MUST_NOT_DELIVER_CANCELLED');
    await awaitState(second.turnId, 'CANCELLED');
    assert.equal((await row(second.turnId)).answer, null);
    const p2 = await create(),
      race = {
        type: 'ASK',
        mode: 'STUDENT',
        id: p2.id,
        revision: p2.revision,
        message: '并发提问',
      };
    const raced = await Promise.allSettled([execute(sc, race), execute(sc, race)]);
    assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
    const rid = String(
      decode((raced.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<unknown>).value)
        .turnId,
    );
    await wait(async () => runs.some((r) => r.run.turnId === rid));
    const ri = runs.findIndex((r) => r.run.turnId === rid);
    await policy(false);
    await settle(ri, 'MUST_NOT_DELIVER_DISABLED');
    await awaitState(rid, 'BLOCKED');
    assert.equal((await row(rid)).answer, null);
    await fail(() => ask(first.id), 'INVALID_STATE');
    await policy(true);
    const again = await ask(first.id);
    const ai = runs.findIndex((r) => r.run.turnId === again.turnId);
    await policy(true, '更新教学提示，旧生成必须失效。');
    await settle(ai);
    await awaitState(again.turnId, 'BLOCKED');
    const closed = await ask(first.id);
    const ci = runs.findIndex((r) => r.run.turnId === closed.turnId);
    const current = decode(await host.read(sc, o, { mode: 'STUDENT', id: first.id }));
    await execute(sc, {
      type: 'CLOSE_SESSION',
      mode: 'STUDENT',
      id: first.id,
      revision: current.session.revision,
    });
    await settle(ci);
    await awaitState(closed.turnId, 'CANCELLED');
    record(
      'Tutor LOCAL controlled-provider: default-off, current course access, private transcripts, DTO/CSRF refusal, canonical replay, one running turn, cancel/close and policy revision barriers',
    );
    const resource = await send(contentBase, teacher, {
      type: 'CREATE_CONTENT',
      title: 'Tutor 固定讲义',
    });
    const resources = decode((await http(contentBase, teacher)).json).resources,
      sourceDraft = resources.find((r: Record<string, unknown>) => r.id === resource.id);
    await send(contentBase, teacher, {
      type: 'SAVE_CONTENT',
      id: resource.id,
      revision: sourceDraft!.revision,
      title: 'Tutor 固定讲义',
      slides: [
        {
          ...sourceDraft!.draft.slides[0],
          elements: [
            {
              id: v7(),
              text: '测量前断电确认安全；电压单位是伏特，电流单位是安培。',
              x: 20,
              y: 20,
              width: 600,
              height: 100,
            },
          ],
        },
      ],
    });
    let fresh = decode((await http(contentBase, teacher)).json).resources.find(
      (r: Record<string, unknown>) => r.id === resource.id,
    );
    await send(contentBase, teacher, {
      type: 'PUBLISH_CONTENT',
      id: resource.id,
      revision: fresh!.revision,
    });
    const sourced = await create(sc, resource.id);
    const sr = await ask(sourced.id);
    const si = runs.findIndex((r) => r.run.turnId === sr.turnId);
    assert.ok(runs[si].run.source?.text.includes('伏特'));
    assert.equal(runs[si].run.source?.resourceId, resource.id);
    assert.deepEqual(
      Object.keys(runs[si].run).sort(),
      ['turnId', 'sessionId', 'policyRevision', 'guidance', 'question', 'history', 'source'].sort(),
    );
    fresh = decode((await http(contentBase, teacher)).json).resources.find(
      (r: Record<string, unknown>) => r.id === resource.id,
    );
    await send(contentBase, teacher, {
      type: 'WITHDRAW_CONTENT',
      id: resource.id,
      revision: fresh!.revision,
    });
    await settle(si, 'MUST_NOT_DELIVER_WITHDRAWN_SOURCE');
    await awaitState(sr.turnId, 'BLOCKED');
    await fail(() => ask(sourced.id));
    record(
      'Tutor fixed published text only; withdrawal during generation blocks delivery; draft/interactive/raw assessment context never supplied',
    );
    const fault = await create();
    await admin.query(
      "CREATE FUNCTION public.tutor_fault_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='ASK' THEN RAISE EXCEPTION 'LOCAL fault'; END IF;RETURN NEW;END$$;CREATE TRIGGER tutor_fault_audit BEFORE INSERT ON zhiban_tutor.events FOR EACH ROW EXECUTE FUNCTION public.tutor_fault_audit()",
    );
    const before = calls;
    await fail(() =>
      execute(sc, {
        type: 'ASK',
        mode: 'STUDENT',
        id: fault.id,
        revision: '1',
        message: '审计失败不得调模型',
      }),
    );
    assert.equal(calls, before);
    assert.equal(
      Number(
        (
          await admin.query('SELECT count(*) AS n FROM zhiban_tutor.turns WHERE session_id=$1', [
            fault.id,
          ])
        ).rows[0].n,
      ),
      0,
    );
    await admin.query(
      'DROP TRIGGER tutor_fault_audit ON zhiban_tutor.events;DROP FUNCTION public.tutor_fault_audit()',
    );
    const audit = await ask(fault.id);
    const fi = runs.findIndex((r) => r.run.turnId === audit.turnId);
    await admin.query(
      "CREATE FUNCTION public.tutor_fault_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='FINISH' THEN RAISE EXCEPTION 'LOCAL fault'; END IF;RETURN NEW;END$$;CREATE TRIGGER tutor_fault_audit BEFORE INSERT ON zhiban_tutor.events FOR EACH ROW EXECUTE FUNCTION public.tutor_fault_audit()",
    );
    await settle(fi);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await row(audit.turnId)).answer, null);
    assert.equal((await row(audit.turnId)).state, 'RUNNING');
    await admin.query(
      'DROP TRIGGER tutor_fault_audit ON zhiban_tutor.events;DROP FUNCTION public.tutor_fault_audit()',
    );
    await admin.query('UPDATE zhiban_tutor.turns SET expires_at=created_at+1 WHERE id=$1', [
      audit.turnId,
    ]);
    assert.equal(
      decode(await host.read(sc, o, { mode: 'STUDENT', id: fault.id })).rows[0].state,
      'EXPIRED',
    );
    const replacement = await ask(fault.id);
    const replaceIndex = runs.findIndex((r) => r.run.turnId === replacement.turnId);
    await settle(replaceIndex);
    await awaitState(replacement.turnId, 'COMPLETED');
    assert.equal((await row(audit.turnId)).state, 'EXPIRED');
    record(
      'Tutor reservation and completion audit failures rollback; expired orphan is visible and never auto redispatched',
    );
    for (let i = 0; i < 21; i++) await create(tc);
    const firstPage = await host.read(tc, o, { mode: 'TEACHER' });
    assert.equal(firstPage.rows.length, 20);
    assert.ok(firstPage.next);
    const nextPage = await host.read(tc, o, { mode: 'TEACHER', cursor: firstPage.next! });
    assert.ok(nextPage.rows.length > 0);
    await fail(() => host.read(sc, o, { mode: 'STUDENT', cursor: firstPage.next! }));
    assert.equal(await loadTutor(businessPool), true);
    const acl = await businessPool.connect();
    try {
      await acl.query('BEGIN');
      await acl.query("SELECT set_config('app.tenant_id',$1,true)", [foreign.tenant]);
      assert.equal(
        Number((await acl.query('SELECT count(*) AS n FROM zhiban_tutor.sessions')).rows[0].n),
        0,
      );
      await assert.rejects(() =>
        acl.query('UPDATE zhiban_tutor.sessions SET membership_id=$1', [peer.member]),
      );
    } finally {
      await acl.query('ROLLBACK');
      acl.release();
    }
    const revoke = await create(),
      inflight = await ask(revoke.id);
    const revokeIndex = runs.findIndex((r) => r.run.turnId === inflight.turnId);
    const e = (
      await admin.query(
        "SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
        [t, o, student.member],
      )
    ).rows[0];
    await send(`/api/zhiban/management/${t}/commands`, manager, {
      type: 'WITHDRAW',
      id: e.id,
      revision: e.revision,
    });
    await settle(revokeIndex, 'MUST_NOT_DELIVER_AFTER_WITHDRAW');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await row(inflight.turnId)).answer, null);
    assert.equal((await http(base + '?mode=STUDENT&id=' + revoke.id, student)).status, 403);
    const withdrawn = (
      await admin.query('SELECT revision::text FROM zhiban_academic.enrollments WHERE id=$1', [
        e.id,
      ])
    ).rows[0];
    await send(`/api/zhiban/management/${t}/commands`, manager, {
      type: 'ENROLL',
      offeringId: o,
      membershipId: student.member,
      revision: withdrawn.revision,
    });
    assert.equal((await http(base + '?mode=STUDENT&id=' + revoke.id, student)).status, 404);
    assert.equal((await read()).rows.length, 0);
    const teacherSession = await create(tc),
      teacherRun = await ask(teacherSession.id, '教师私人预演', tc),
      teacherIndex = runs.findIndex((r) => r.run.turnId === teacherRun.turnId);
    const assignment = (
      await admin.query(
        "SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
        [t, o, teacher.member],
      )
    ).rows[0];
    await send(`/api/zhiban/management/${t}/commands`, manager, {
      type: 'END_TEACHER',
      id: assignment.id,
      revision: assignment.revision,
    });
    await settle(teacherIndex);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await row(teacherRun.turnId)).answer, null);
    assert.equal((await http(base + '?mode=TEACHER', teacher)).status, 403);
    record(
      'Tutor teacher revocation, student withdrawal/rejoin original relationship, tenant RLS, immutable owner and actor-bound paging enforced; dimensions remain REVIEW',
    );
    await writeFile(
      'docs/v2/evidence/tutor/directed-journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          scope: 'COURSE_TUTOR_AUTHORIZATION_AND_GOVERNANCE_WITH_CONTROLLED_PROVIDER_ONLY',
          realModelGeneration: false,
          nativeRuntimeEnabled: false,
          dimensions: 'REVIEW',
          privateConversationIsolation: true,
          canonicalReplayAndRace: true,
          teacherPolicyAndSourceDeliveryBarriers: true,
          auditAtomicity: true,
          orphanNoAutoRetry: true,
          currentIdentityAndOriginalEnrollment: true,
          tenantRlsAndAcl: true,
          providerCalls: calls,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    for (const r of runs)
      r.resolve({
        text: 'CONTROLLED CLEANUP',
        model: { provider: 'CONTROLLED_FAULT_PROVIDER', model: 'NO_REAL_MODEL' },
      });
    await host.close();
    await bc.close();
  }
}
