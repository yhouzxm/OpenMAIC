import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import { interactiveExample } from '../../app/zhiban/local/interactive-client';
import { INTERACTIVE_FRAME_CSP } from '../../lib/zhiban/infrastructure/content/interactive';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  nativeAdmin: Pool;
};
type Resource = {
  id: string;
  revision: string;
  state: string;
  quarantined: boolean;
  interactive: boolean;
  publication?: { id: string };
};
export async function verifyInteractive(input: Input) {
  const { admin, nativeAdmin, browser, http, actors, tenant, origin, trial, record } = input;
  const [teacher, student, outsider, , manager] = actors,
    base = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const read = async () => {
    const r = await http(base, teacher);
    assert.equal(r.status, 200);
    return (r.json as { resources: Resource[] }).resources;
  };
  const send = async (cmd: unknown, key?: string) => {
    const r = await http(base, teacher, cmd, 'POST', key ? { 'x-zhiban-command': key } : undefined);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as { id: string };
  };
  for (const a of [student, manager, outsider])
    assert.equal(
      (await http(base, a, { type: 'CREATE_INTERACTIVE', title: '拒绝', html: interactiveExample }))
        .status,
      403,
    );
  const key = v7(),
    created = await send(
      { type: 'CREATE_INTERACTIVE', title: '定向互动', html: interactiveExample },
      key,
    );
  assert.deepEqual(
    await send({ type: 'CREATE_INTERACTIVE', title: '定向互动', html: interactiveExample }, key),
    created,
  );
  let r = (await read()).find((x) => x.id === created.id)!;
  assert.equal(r.interactive, true);
  const rb = base + `/resources/${r.id}`;
  assert.equal((await http(rb + '/preview?source=draft', student)).status, 403);
  assert.equal(
    (
      await http(base, teacher, {
        type: 'SAVE_CONTENT',
        id: r.id,
        revision: r.revision,
        title: '不得混入旧策略',
        slides: [{ id: v7(), elements: [] }],
      })
    ).status,
    400,
  );
  const tc = await browser.newContext(),
    sc = await browser.newContext();
  for (const [ctx, a] of [
    [tc, teacher],
    [sc, student],
  ] as const)
    await ctx.addCookies([
      {
        name: a.cookie!.split('=')[0],
        value: a.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
  const tp = await tc.newPage(),
    sp = await sc.newPage();
  const course = (
    await admin.query(
      'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
      [tenant, trial.offeringId],
    )
  ).rows[0].course_id;
  const resourceUrl = `${origin}/zhiban/teacher/courses/${course}/resources?space=${tenant}&offering=${trial.offeringId}`;
  try {
    await tp.goto(resourceUrl);
    await tp.getByRole('button', { name: '编辑互动草稿', exact: true }).click();
    await tp.getByLabel('互动标题', { exact: true }).fill('欧姆定律互动（LOCAL）');
    await tp
      .getByLabel('互动 HTML', { exact: true })
      .fill(interactiveExample.replace('固定为 6Ω', '固定为 6Ω（教师核对）'));
    tp.once('dialog', (d) => d.dismiss());
    await tp.getByRole('link', { name: '学习中心', exact: true }).click();
    await expect(tp.getByLabel('互动标题', { exact: true })).toHaveValue('欧姆定律互动（LOCAL）');
    await tp.getByRole('button', { name: '保存互动草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布互动版本', exact: true })).toBeEnabled();
    await tp.getByRole('button', { name: '发布互动版本', exact: true }).click();
    await expect(tp.getByRole('link', { name: '打开已发布互动', exact: true })).toBeVisible();
    r = (await read()).find((x) => x.id === created.id)!;
    const publication = r.publication!.id,
      path = rb + '/player?publication=' + publication,
      frame = rb + '/frame?publication=' + publication;
    for (const a of [manager, outsider]) assert.equal((await http(frame, a)).status, 403);
    assert.equal((await http(frame)).status, 401);
    assert.equal((await http(rb + '/frame?publication=' + v7(), student)).status, 409);
    const response = (await http(frame, student)) as unknown as {
      status: number;
      headers: Record<string, string>;
      bytes: Buffer;
    };
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-security-policy'], INTERACTIVE_FRAME_CSP);
    assert.ok(response.bytes.toString().includes('addEventListener'));
    const oBase = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/outline`,
      unit = v7();
    let o = (await http(oBase, teacher)).json as { revision: string };
    assert.equal(
      (
        await http(oBase, teacher, {
          type: 'SAVE_OUTLINE',
          revision: o.revision,
          chapters: [
            {
              id: v7(),
              title: '互动章',
              units: [{ id: unit, kind: 'LECTURE', target: r.id, title: '互动练习' }],
            },
          ],
        })
      ).status,
      200,
    );
    o = (await http(oBase, teacher)).json as { revision: string };
    assert.equal(
      (await http(oBase, teacher, { type: 'PUBLISH_OUTLINE', revision: o.revision })).status,
      200,
    );
    await sp.goto(
      `${origin}/zhiban/student/courses/${course}/learning-center/${unit}?space=${tenant}&offering=${trial.offeringId}`,
    );
    await expect(sp.getByRole('button', { name: '导出 PPTX', exact: true })).toHaveCount(0);
    await sp.getByRole('link', { name: '使用 OpenMAIC 互动播放器', exact: true }).click();
    await expect(sp.getByTestId('counter')).toHaveText('1 / 1');
    assert.equal(await sp.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    await sp.getByRole('button', { name: '播放课堂', exact: true }).click();
    const child = sp.frameLocator('iframe');
    await expect(child.getByText('电流 I = 2 A', { exact: true })).toBeVisible();
    await child.getByRole('slider', { name: '电压', exact: true }).fill('18');
    await expect(child.locator('#result')).toHaveText('电流 I = 3.00 A');
    await sp.screenshot({ path: 'docs/v2/evidence/interactive/student.png', fullPage: true });
    const classroom = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/classrooms`;
    const cs = async (cmd: unknown) => {
      const result = await http(classroom, teacher, cmd);
      assert.equal(result.status, 200, JSON.stringify(result.json));
      return result.json as { id: string; revision: string; dispatchId: string };
    };
    let session = await cs({
      type: 'CREATE_CLASSROOM',
      title: '互动共享课堂',
      description: '进入不计完成',
      opensAt: null,
      closesAt: null,
    });
    session = await cs({ type: 'PUBLISH_CLASSROOM', id: session.id, revision: session.revision });
    const dispatch = await cs({
      type: 'DISPATCH_TASK',
      id: session.id,
      revision: session.revision,
      kind: 'LECTURE',
      target: r.id,
      version: '1',
    });
    await sp.goto(
      `${origin}/zhiban/student/courses/${course}/coursework?space=${tenant}&offering=${trial.offeringId}`,
    );
    await sp.getByRole('button', { name: '进入课堂任务', exact: true }).click();
    await expect(sp).toHaveURL(origin + path);
    await expect(sp.getByTestId('counter')).toHaveText('1 / 1');
    await expect(
      sp.frameLocator('iframe').getByRole('slider', { name: '电压', exact: true }),
    ).toHaveCount(1);
    await cs({ type: 'END_TASK', id: session.id, revision: dispatch.revision });
    record(
      'interactive: real teacher HTML save/publish, draft leave protection, pinned Native provider generation, curriculum link and real slider in original OpenMAIC host',
    );
    let current = (await read()).find((x) => x.id === created.id)!;
    const sameRevision = current.revision;
    const concurrent = await Promise.all([
      http(base, teacher, {
        type: 'SAVE_INTERACTIVE',
        id: r.id,
        revision: sameRevision,
        title: '并发 A',
        html: interactiveExample,
      }),
      http(base, teacher, {
        type: 'SAVE_INTERACTIVE',
        id: r.id,
        revision: sameRevision,
        title: '并发 B',
        html: interactiveExample,
      }),
    ]);
    assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 409]);
    const securityHtml = `<!doctype html><html><body><output id="security"></output><script>let isolated=false,cookies=false,storage=false;try{parent.document.body}catch(e){isolated=true}try{document.cookie}catch(e){cookies=true}try{localStorage.getItem('x')}catch(e){storage=true}document.getElementById('security').textContent=[isolated,cookies,storage].join(',');parent.postMessage({type:'complete',score:100},'*');fetch('/api/zhiban/identity/csrf').catch(()=>{});</script></body></html>`;
    current = (await read()).find((x) => x.id === created.id)!;
    await send({
      type: 'SAVE_INTERACTIVE',
      id: r.id,
      revision: current.revision,
      title: '隔离反向验证',
      html: securityHtml,
    });
    current = (await read()).find((x) => x.id === created.id)!;
    await send({ type: 'PUBLISH_CONTENT', id: r.id, revision: current.revision });
    await expect(sp.getByRole('status')).toContainText('发布版本已变化', { timeout: 15000 });
    await expect(sp.locator('iframe')).toHaveCount(0);
    assert.equal((await http(path, student)).status, 409);
    assert.equal((await http(frame, student)).status, 409);
    current = (await read()).find((x) => x.id === created.id)!;
    const path2 = rb + '/player?publication=' + current.publication!.id;
    let forbiddenRequests = 0;
    sp.on('request', (req) => {
      if (req.url().endsWith('/identity/csrf') || req.method() !== 'GET') forbiddenRequests++;
    });
    await sp.goto(origin + path2);
    await expect(sp.getByTestId('counter')).toHaveText('1 / 1');
    await expect(sp.frameLocator('iframe').locator('#security')).toHaveText('true,true,true');
    assert.equal(forbiddenRequests, 0);
    const enrollment = (
      await admin.query(
        "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=(extract(epoch FROM clock_timestamp())*1000)::bigint,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 RETURNING id",
        [tenant, trial.offeringId, student.member],
      )
    ).rows[0];
    try {
      assert.equal(
        (await http(rb + '/frame?publication=' + current.publication!.id, student)).status,
        403,
      );
      await expect(sp.getByRole('status')).toContainText('课程资格或发布版本已变化', {
        timeout: 15000,
      });
      await expect(sp.locator('iframe')).toHaveCount(0);
    } finally {
      await admin.query(
        "UPDATE zhiban_academic.enrollments SET status='ACTIVE',valid_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, enrollment.id],
      );
    }
    current = (await read()).find((x) => x.id === created.id)!;
    await send({ type: 'WITHDRAW_CONTENT', id: r.id, revision: current.revision });
    assert.equal((await http(path2, student)).status, 409);
    record(
      'interactive: CAS, new draft isolation, replacement/withdrawal/revocation rejection; opaque iframe blocks parent DOM, cookies/storage and authenticated fetch; spoofed completion never writes',
    );
    const unknown = await send({
      type: 'CREATE_INTERACTIVE',
      title: 'UNKNOWN 故障切点',
      html: interactiveExample,
    });
    await nativeAdmin.query('REVOKE INSERT ON public.document_stages FROM zhiban_openmaic_runtime');
    try {
      const failed = await http(base, teacher, {
        type: 'PUBLISH_CONTENT',
        id: unknown.id,
        revision: '1',
      });
      assert.equal(failed.status, 409);
    } finally {
      await nativeAdmin.query('GRANT INSERT ON public.document_stages TO zhiban_openmaic_runtime');
    }
    const u = (await read()).find((x) => x.id === unknown.id)!;
    assert.equal(u.quarantined, true);
    assert.notEqual(
      (
        await http(base, teacher, {
          type: 'SAVE_INTERACTIVE',
          id: u.id,
          revision: u.revision,
          title: '不得越过隔离',
          html: interactiveExample,
        })
      ).status,
      200,
    );
    assert.notEqual(
      (await http(base, teacher, { type: 'PUBLISH_CONTENT', id: u.id, revision: u.revision }))
        .status,
      200,
    );
    const facts = (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2',
        [tenant, r.id],
      )
    ).rows[0].n;
    assert.equal(facts, 0);
    record(
      'interactive: real Native write failure remains OUTCOME_UNKNOWN; draft/publish fenced, no retry bypass and no Runtime/Attempt/grade facts',
    );
    await writeFile(
      'docs/v2/evidence/interactive/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          modelCalls: false,
          generationFixture: false,
          scope: 'OFFLINE_INTERACTIVE_HTML_NATIVE_HOST_BRIDGE_PUBLICATION_NO_RUNTIME_COMPLETION',
          provider: 'PgDocumentStore',
          sandbox: 'allow-scripts',
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await tc.close();
    await sc.close();
  }
}
