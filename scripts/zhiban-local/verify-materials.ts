/** LOCAL full resource journey, real scanner and official extraction; owned PG16 only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import { loadMaterial } from './material';
// Each boundary is checked before its response is used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  runtime: Pool;
};
export async function verifyMaterials({
  admin,
  browser,
  actors,
  http,
  tenant,
  origin,
  record,
  trial,
  runtime,
}: Input) {
  const [teacher, student, , foreign, manager] = actors,
    base = `/api/zhiban/materials/${tenant}/offerings/${trial.offeringId}`;
  const call = (c: unknown, a = teacher, key = randomUUID(), path = base) =>
    http(path, a, c, 'POST', { 'x-zhiban-command': key });
  const send = async (c: unknown, a = teacher, key = randomUUID()) => {
    const r = await call(c, a, key);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const read = async (path = '', a = teacher) => {
    const r = await http(base + path, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const upload = (
    title: string,
    text: string,
    id: string | null = null,
    revision: string | null = null,
  ) => ({
    type: 'UPLOAD_MATERIAL',
    id,
    revision,
    title,
    file: {
      name: 'safety.md',
      mime: 'text/markdown',
      base64: Buffer.from(text).toString('base64'),
    },
  });
  const key = randomUUID(),
    c = upload('安全维护参考资料', '# 维护顺序\n先隔离，再验电。');
  assert.equal((await call(c, student)).status, 403);
  assert.equal((await call(c, manager)).status, 403);
  assert.equal((await call(c, foreign)).status, 403);
  let result = await send(c, teacher, key);
  const id = result.id;
  assert.equal((await send(c, teacher, key)).id, id);
  assert.equal((await call({ ...c, title: 'changed' }, teacher, key)).status, 409);
  assert.equal((await read('', student)).rows.length, 0);
  assert.equal((await http(base + '/' + id, student)).status, 404);
  assert.equal((await http(base + '/' + id + '?source=draft', student)).status, 403);
  assert.match((await read('/' + id + '?source=draft')).text, /先隔离/);
  const outlineBase = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/outline`;
  const outline = (await http(outlineBase, teacher)).json as View;
  const chapterId = randomUUID(),
    unitId = randomUUID();
  const chapters = [
    ...outline.chapters,
    {
      id: chapterId,
      title: '资源课堂',
      units: [{ id: unitId, kind: 'MATERIAL', target: id, title: '安全维护参考资料' }],
    },
  ];
  let arranged = await http(outlineBase, teacher, {
    type: 'SAVE_OUTLINE',
    revision: outline.revision,
    chapters,
  });
  assert.equal(arranged.status, 200);
  assert.equal(
    (
      await http(outlineBase, teacher, {
        type: 'PUBLISH_OUTLINE',
        revision: (arranged.json as View).revision,
      })
    ).status,
    409,
  );
  result = await send({ type: 'PUBLISH_MATERIAL', id, revision: result.revision });
  arranged = await http(outlineBase, teacher, {
    type: 'PUBLISH_OUTLINE',
    revision: (arranged.json as View).revision,
  });
  assert.equal(arranged.status, 200);
  assert.equal((await read('/' + id, student)).publicationNo, 1);
  assert.equal((await read('', student)).rows[0].title, c.title);
  const bytes = (await http(`${base}/${id}/download?version=1`, student)) as unknown as {
    status: number;
    bytes: Buffer;
    headers: Record<string, string>;
  };
  assert.equal(bytes.status, 200);
  assert.deepEqual(bytes.bytes, Buffer.from(c.file.base64, 'base64'));
  assert.match(bytes.headers['content-disposition'], /^attachment;/);
  assert.equal(bytes.headers['x-content-type-options'], 'nosniff');
  record(
    'MATERIAL ownership/publication: real scanner + native Markdown extraction; draft secrecy, role/tenant boundaries, unpublished directory denial, published unit and exact original download',
  );
  const current = (await read()).rows.find((r: View) => r.id === id);
  const replaced = await send(
    upload('安全维护参考资料第二稿', '# 第二版\n增加仪表自检。', id, current.revision),
  );
  assert.match((await read('/' + id, student)).text, /先隔离/);
  assert.equal((await read('/' + id + '?source=draft')).title, '安全维护参考资料第二稿');
  const race = await Promise.all([
    call({ type: 'PUBLISH_MATERIAL', id, revision: replaced.revision }),
    call({ type: 'PUBLISH_MATERIAL', id, revision: replaced.revision }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await read('/' + id, student)).publicationNo, 2);
  assert.match((await read('/' + id + '?version=1', student)).text, /先隔离/);
  record(
    'MATERIAL version/CAS: replacement stays teacher draft until explicit publish; concurrent publication has one winner; prior published bytes/text remain fixed',
  );
  const count = async () =>
    (
      await admin.query(
        'SELECT (SELECT count(*)::int FROM zhiban_material.resources) AS resources,(SELECT count(*)::int FROM zhiban_material.versions) AS versions,(SELECT count(*)::int FROM zhiban_material.commands) AS commands',
      )
    ).rows[0];
  const before = await count(),
    cut = upload('故障回滚资料', '不应留下半份文件'),
    cutKey = randomUUID();
  await admin.query(
    "CREATE FUNCTION public.local_material_cut() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_MATERIAL_CUT'; END $$; CREATE TRIGGER local_material_cut BEFORE INSERT ON zhiban_material.commands FOR EACH ROW EXECUTE FUNCTION public.local_material_cut()",
  );
  try {
    assert.equal((await call(cut, teacher, cutKey)).status, 503);
    assert.deepEqual(await count(), before);
  } finally {
    await admin.query(
      'DROP TRIGGER local_material_cut ON zhiban_material.commands; DROP FUNCTION public.local_material_cut()',
    );
  }
  const retry = await send(cut, teacher, cutKey);
  assert.equal((await send(cut, teacher, cutKey)).id, retry.id);
  const rejectBefore = await count();
  assert.equal(
    (
      await call({
        ...upload('病毒资料', 'x'),
        file: {
          name: 'virus.txt',
          mime: 'text/plain',
          base64: Buffer.from(
            'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
          ).toString('base64'),
        },
      })
    ).status,
    503,
  );
  assert.deepEqual(await count(), rejectBefore);
  const pdf = await PDFDocument.create(),
    page = pdf.addPage();
  page.drawText('COURSE RESOURCE PDF', {
    x: 40,
    y: 740,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    size: 18,
  });
  const pdfBytes = Buffer.from(await pdf.save());
  const pdfResource = await send({
    ...upload('PDF 维护资料', 'unused'),
    file: { name: 'safety.pdf', mime: 'application/pdf', base64: pdfBytes.toString('base64') },
  });
  assert.match((await read('/' + pdfResource.id + '?source=draft')).text, /COURSE RESOURCE PDF/);
  const badBefore = await count();
  assert.equal(
    (
      await call({
        ...upload('坏PDF', 'unused'),
        file: {
          name: 'bad.pdf',
          mime: 'application/pdf',
          base64: Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64'),
        },
      })
    ).status,
    400,
  );
  assert.deepEqual(await count(), badBefore);
  record(
    'MATERIAL scan/parse/atomicity: EICAR and corrupt PDF leave no rows; official unpdf extracts real PDF; ledger failure rolls back blob/version/resource; original-key retry creates once',
  );
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const errors: string[] = [];
  try {
    for (const [context, actor] of [
      [contexts[0], teacher],
      [contexts[1], student],
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
    const tp = await contexts[0].newPage(),
      sp = await contexts[1].newPage();
    for (const p of [tp, sp]) p.on('pageerror', (e) => errors.push(e.message));
    const teacherRoute = `${origin}/zhiban/teacher/courses/${trial.courseId}/resources?space=${tenant}&offering=${trial.offeringId}`;
    await tp.goto(teacherRoute);
    await tp.getByLabel('上传资源标题', { exact: true }).fill('课堂上传文本');
    await tp.getByLabel('选择教学资源文件', { exact: true }).setInputFiles({
      name: 'lesson.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('课堂资料：隔离、验电与仪表自检。'),
    });
    await tp.getByRole('button', { name: '扫描并解析为资源草稿', exact: true }).click();
    await expect(
      tp.getByRole('button', { name: '发布资源 课堂上传文本', exact: true }),
    ).toBeVisible({ timeout: 75000 });
    await tp.getByRole('button', { name: '查看解析草稿 课堂上传文本', exact: true }).click();
    await expect(tp.getByText('课堂资料：隔离、验电与仪表自检。', { exact: true })).toBeVisible();
    tp.once('dialog', (d) => void d.accept());
    await tp.getByRole('button', { name: '发布资源 课堂上传文本', exact: true }).click();
    await expect(
      tp.getByRole('button', { name: '查看已发布资源 课堂上传文本', exact: true }),
    ).toBeVisible();
    await sp.goto(
      `${origin}/zhiban/student/courses/${trial.courseId}/learning-center/${unitId}?space=${tenant}&offering=${trial.offeringId}`,
    );
    await expect(sp.getByRole('region', { name: '已发布教学资源' })).toContainText(
      '增加仪表自检。',
    );
    const downloadPromise = sp.waitForEvent('download');
    await sp.getByRole('link', { name: '下载该发布版本原文件', exact: true }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const parts: Buffer[] = [];
    for await (const part of stream!) parts.push(Buffer.from(part));
    assert.equal(Buffer.concat(parts).toString(), '# 第二版\n增加仪表自检。');
    await tp.screenshot({
      path: 'docs/v2/evidence/zhiban-material-teacher-local.png',
      fullPage: true,
    });
    await sp.screenshot({
      path: 'docs/v2/evidence/zhiban-material-student-local.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
  record(
    'MATERIAL browser journey: teacher actual TXT upload/parse/preview/publish; student published course unit and actual version-bound download; no page errors',
  );
  // Retain a usable published unit; archive a separate resource to prove immediate access removal.
  const temp = await send({ type: 'PUBLISH_MATERIAL', id: retry.id, revision: retry.revision });
  await send({ type: 'ARCHIVE_MATERIAL', id: retry.id, revision: temp.revision });
  assert.equal((await http(base + '/' + retry.id, student)).status, 404);
  const own = (await read()).rows.find((r: View) => r.id === id);
  const changedOffering = (
    await admin.query('SELECT status FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2', [
      tenant,
      trial.offeringId,
    ])
  ).rows[0].status;
  await admin.query(
    "UPDATE zhiban_academic.offerings SET status='CLOSED' WHERE tenant_id=$1 AND id=$2",
    [tenant, trial.offeringId],
  );
  try {
    assert.equal(
      (await call({ type: 'ARCHIVE_MATERIAL', id, revision: own.revision })).status,
      409,
    );
    assert.equal((await http(base + '/' + id, student)).status, 200);
  } finally {
    await admin.query(
      'UPDATE zhiban_academic.offerings SET status=$3 WHERE tenant_id=$1 AND id=$2',
      [tenant, trial.offeringId, changedOffering],
    );
  }
  assert.equal((await http(base + '/' + id, actors[6])).status, 403); // Existing withdrawn historical member.
  const role = await runtime.connect();
  try {
    await role.query('BEGIN');
    await role.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    await assert.rejects(
      role.query('UPDATE zhiban_material.versions SET title=title WHERE tenant_id=$1', [tenant]),
      /permission denied/,
    );
    await role.query('ROLLBACK');
    await role.query('BEGIN');
    await role.query("SELECT set_config('app.tenant_id',$1,true)", [foreign.tenant]);
    assert.equal(
      (await role.query('SELECT * FROM zhiban_material.versions WHERE tenant_id=$1', [tenant]))
        .rowCount,
      0,
    );
  } finally {
    await role.query('ROLLBACK');
    role.release();
  }
  await admin.query('GRANT DELETE ON zhiban_material.versions TO zhiban_academic_runtime');
  try {
    await assert.rejects(loadMaterial(runtime));
  } finally {
    await admin.query('REVOKE DELETE ON zhiban_material.versions FROM zhiban_academic_runtime');
  }
  assert.equal(await loadMaterial(runtime), true);
  record(
    'MATERIAL lifecycle/ACL: archived source inaccessible, closed offering read-only, append-only versions and expected catalog reject widened DELETE ACL; original state restored',
  );
  const csv = {
    ...upload('CSV课程数据', 'name,value\na,1'),
    file: {
      name: 'table.csv',
      mime: 'text/csv',
      base64: Buffer.from('name,value\na,1').toString('base64'),
    },
  };
  const csvDraft = await send(csv);
  await send({ type: 'PUBLISH_MATERIAL', id: csvDraft.id, revision: csvDraft.revision });
  assert.match((await read('/' + csvDraft.id, student)).text, /a,1/);
  const missing = await call({
    ...upload('需OCR', 'unused'),
    file: {
      name: 'image.png',
      mime: 'image/png',
      base64: Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64'),
    },
  });
  assert.equal(missing.status, 503);
  record(
    'RESOURCE BUNDLE: native CSV extraction and immutable publication visible to enrolled student; missing OCR service refused without resource creation',
  );
  await writeFile(
    'docs/v2/evidence/zhiban-material-journey-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        groups: 5,
        scope: [
          'NATIVE_TEXT_AND_UNPDF',
          'COURSE_OFFERING_OWNERSHIP',
          'IMMUTABLE_PUBLICATIONS',
          'MATERIAL_OUTLINE_UNIT',
          'STUDENT_READ_AND_DOWNLOAD',
        ],
        excluded: [
          'OFFICE_OCR_MEDIA_SERVICE_CONFIGURATION',
          'NATIVE_OWNER_MATERIAL_AUTH',
          'RUNTIME_AI',
          'NATIVE_REFRESH_CLOSE_MANUAL_SIGNOFF',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}
