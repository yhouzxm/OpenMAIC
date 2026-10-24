import JSZip from 'jszip';
import { loadClamAv } from '../../lib/zhiban/infrastructure/learning-files/scanner/clamav';
/** LOCAL atomic submit/file/teacher-review journey. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { loadSubmissionFiles } from './submission-files';
import type { prepareTrial } from './prepare-trial';
type Input = Parameters<typeof prepareTrial>[0] & {
  trusted?: boolean;
  browserOnly?: boolean;
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
type Result = {
  id: string;
  revision: string;
  submissionId: string;
  error: { code: string };
  files: { id: string; digest: string; bytes?: unknown }[];
};
type RawResponse = Awaited<ReturnType<Input['http']>> & {
  bytes: Buffer;
  headers: import('node:http').IncomingHttpHeaders;
};
export async function verifySubmissionFiles(input: Input) {
  const { admin, http, actors, tenant, trial, record, browser, origin, trusted } = input;
  const [teacher, student, outsider, foreign, manager, peer] = actors;
  const base = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const send = async (command: unknown, actor = teacher, key = randomUUID()) => {
    const r = await http(base, actor, command, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const a = await send({
    type: 'CREATE_ACTIVITY',
    title: '试讲：附件巡检报告',
    prompt: '填写文字说明并提交巡检附件。',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await send({ type: 'PUBLISH_ACTIVITY', ...a });
  const t = await send({ type: 'START_ATTEMPT', id: a.id }, student);
  const bytes = Buffer.from(
    trusted
      ? '真实扫描旅程：本次作业附件由 ClamAV 扫描。\n'
      : '本地附件巡检记录\n先断电挂牌，再验电并检查接地。\n',
  );
  const attachment = { name: '巡检记录.txt', mime: 'text/plain', base64: bytes.toString('base64') };
  const command = {
    type: 'SUBMIT',
    id: t.id,
    revision: t.revision,
    answer: '本次巡检记录见附件，已复核。',
    attachment,
  };
  const key = randomUUID(),
    submitted = await send(command, student, key);
  if (!input.browserOnly) {
    assert.deepEqual(await send(command, student, key), submitted);
    assert.equal(
      (
        await http(base, student, { ...command, answer: '不同内容' }, 'POST', {
          'x-zhiban-command': key,
        })
      ).status,
      409,
    );
    const list = await http(base + '/attachments?submission=' + submitted.submissionId, student);
    assert.equal(list.status, 200);
    const files = (list.json as Result).files;
    assert.equal(files.length, 1);
    assert.equal(files[0].digest, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(files[0].bytes, undefined);
    const path =
      base + '/attachments?submission=' + submitted.submissionId + '&file=' + files[0].id;
    for (const actor of [teacher, student]) {
      const r = (await http(path, actor)) as RawResponse;
      assert.equal(r.status, 200);
      assert.deepEqual(r.bytes, bytes);
      assert.equal(r.headers['content-type'], 'application/octet-stream');
      assert.match(String(r.headers['content-disposition']), /^attachment;/);
      assert.equal(r.headers['cache-control'], 'no-store');
    }
    const originalClearance = (
      await admin.query(
        'SELECT clearance_status,clearance_ref FROM zhiban_learning_files.files WHERE tenant_id=$1 AND id=$2',
        [tenant, files[0].id],
      )
    ).rows[0];
    if (trusted) {
      assert.equal(originalClearance.clearance_status, 'TRUSTED_SCANNER');
      assert.match(
        originalClearance.clearance_ref,
        /^clamav-sha256:[a-f0-9]{64}:[a-f0-9]{64}:[0-9]{13}$/,
      );
    }
    try {
      await admin.query(
        "UPDATE zhiban_learning_files.files SET clearance_status='UNVERIFIED',clearance_ref='' WHERE tenant_id=$1 AND id=$2",
        [tenant, files[0].id],
      );
      assert.equal((await http(path, teacher)).status, 409);
    } finally {
      await admin.query(
        'UPDATE zhiban_learning_files.files SET clearance_status=$3,clearance_ref=$4 WHERE tenant_id=$1 AND id=$2',
        [tenant, files[0].id, originalClearance.clearance_status, originalClearance.clearance_ref],
      );
    }
    for (const actor of [peer, outsider, foreign, manager])
      assert.ok([403, 404].includes((await http(path, actor)).status));
    assert.equal((await http(path)).status, 401);
    assert.equal(
      (
        await http(
          base + '/attachments?submission=' + submitted.submissionId + '&file=' + randomUUID(),
          teacher,
        )
      ).status,
      400,
    );
    const bad = await http(base, student, {
      ...command,
      revision: submitted.revision,
      attachment: { ...attachment, name: '../bad.txt' },
    });
    assert.equal(bad.status, 400);
    assert.equal(
      (
        await http(base, student, {
          ...command,
          revision: submitted.revision,
          attachment: { ...attachment, base64: Buffer.alloc(1048577, 65).toString('base64') },
        })
      ).status,
      400,
    );
    const unknown = await http(base, student, {
      ...command,
      revision: submitted.revision,
      attachment: {
        ...attachment,
        base64: Buffer.from(
          trusted
            ? 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
            : '未登记的真实文件不得跳过扫描',
        ).toString('base64'),
      },
    });
    assert.equal(unknown.status, 409);
    assert.equal((unknown.json as Result).error.code, 'ATTACHMENT_NOT_CLEARED');
    if (trusted) {
      const profilePath = process.env.ZHIBAN_SCANNER_PROFILE!;
      await assert.rejects(() => loadClamAv(profilePath, '0'.repeat(64)), /hash rejected/);
      const profile = JSON.parse(await readFile(profilePath, 'utf8'));
      const unavailable = profile.binary + '.fault-test';
      await rename(profile.binary, unavailable);
      try {
        const rejected = await http(base, student, { ...command, revision: submitted.revision });
        assert.equal(rejected.status, 409);
        assert.equal((rejected.json as Result).error.code, 'ATTACHMENT_NOT_CLEARED');
      } finally {
        await rename(unavailable, profile.binary);
      }
      await assert.rejects(() =>
        admin.query(
          "UPDATE zhiban_learning_files.files SET clearance_ref='clamav-sha256:'||repeat('a',64)||':'||repeat('b',64)||':1792218346000' WHERE tenant_id=$1 AND id=$2",
          [tenant, files[0].id],
        ),
      );
      record(
        'trusted scanner wrong profile pin, unavailable executable (including cached digest), and wrong file/proof digest fail closed; no partial submission',
      );
    }
    const count = (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE attempt_id=$1',
        [t.id],
      )
    ).rows[0].n;
    assert.equal(count, 1);
    // Resubmission without a file cannot implicitly inherit the earlier file.
    const v2 = await send(
      {
        type: 'SUBMIT',
        id: t.id,
        revision: submitted.revision,
        answer: '第二版文字说明，无附件。',
      },
      student,
    );
    assert.equal(
      ((await http(base + '/attachments?submission=' + v2.submissionId, student)).json as Result)
        .files.length,
      0,
    );
    assert.equal((await http(path, teacher)).status, 200);
    // Withdraw/reassign barriers do not delete history; current credentials do not bypass them.
    try {
      await admin.query(
        "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$3 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$4",
        [tenant, trial.offeringId, Date.now(), teacher.member],
      );
      assert.equal((await http(path, teacher)).status, 403);
    } finally {
      await admin.query(
        "UPDATE zhiban_academic.assignments SET status='ACTIVE',valid_until=NULL WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
        [tenant, trial.offeringId, teacher.member],
      );
    }
    try {
      await admin.query(
        "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=$3 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$4",
        [tenant, trial.offeringId, Date.now(), student.member],
      );
      assert.equal((await http(path, student)).status, 403);
    } finally {
      await admin.query(
        "UPDATE zhiban_academic.enrollments SET status='ACTIVE',valid_until=NULL WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
        [tenant, trial.offeringId, student.member],
      );
    }
    record(
      (trusted
        ? 'TRUSTED_SCANNER real official ClamAV clean TXT accepted; EICAR rejected without submission; '
        : 'LOCAL_SYNTHETIC_PINNED unregistered file rejected; ') +
        'atomic binding, digest/bytes, replay, malformed/oversize, role/tenant/revoked denial and version history pass',
    );
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
    const races = await Promise.all(
      ['A', 'B'].map((name) =>
        http(
          base,
          student,
          {
            type: 'SUBMIT',
            id: t.id,
            revision: v2.revision,
            answer: '并发PDF提交',
            attachment: {
              name: name + '.pdf',
              mime: 'application/pdf',
              base64: pdf.toString('base64'),
            },
          },
          'POST',
          { 'x-zhiban-command': randomUUID() },
        ),
      ),
    );
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
    const winner = races.find((r) => r.status === 200)!.json as Result;
    const pdfList = (await http(base + '/attachments?submission=' + winner.submissionId, teacher))
      .json as Result;
    const pdfResponse = (await http(
      base + '/attachments?submission=' + winner.submissionId + '&file=' + pdfList.files[0].id,
      teacher,
    )) as RawResponse;
    assert.deepEqual(pdfResponse.bytes, pdf);
    // A real cumulative quota failure must roll back the entire submission, not orphan the text.
    const quotaActivity = await send({
      type: 'CREATE_ACTIVITY',
      title: '附件配额验证（合成）',
      prompt: '本地配额边界',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 1,
    });
    await send({ type: 'PUBLISH_ACTIVITY', ...quotaActivity });
    let quotaAttempt = await send({ type: 'START_ATTEMPT', id: quotaActivity.id }, student);
    const oneMiB = {
      name: 'quota.txt',
      mime: 'text/plain',
      base64: Buffer.alloc(1048576, 65).toString('base64'),
    };
    for (let i = 0; i < 10; i++)
      quotaAttempt = await send(
        {
          type: 'SUBMIT',
          id: quotaAttempt.id,
          revision: quotaAttempt.revision,
          answer: '配额边界 ' + i,
          attachment: oneMiB,
        },
        student,
      );
    const rejected = await http(base, student, {
      type: 'SUBMIT',
      id: quotaAttempt.id,
      revision: quotaAttempt.revision,
      answer: '不应提交',
      attachment: oneMiB,
    });
    assert.equal(rejected.status, 409);
    assert.equal((rejected.json as Result).error.code, 'ATTACHMENT_LIMIT');
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE attempt_id=$1',
          [quotaAttempt.id],
        )
      ).rows[0].n,
      10,
    );
    await send({ type: 'WITHDRAW_ACTIVITY', id: quotaActivity.id, revision: '2' });
    const timed = await send({
      type: 'CREATE_ACTIVITY',
      title: '附件截止验证（合成）',
      prompt: '本地截止边界',
      deadlineAt: Date.now() + 2500,
      allowResubmit: false,
      maxAttempts: 1,
    });
    await send({ type: 'PUBLISH_ACTIVITY', ...timed });
    const timedAttempt = await send({ type: 'START_ATTEMPT', id: timed.id }, student);
    await new Promise((resolve) => setTimeout(resolve, 2600));
    assert.equal(
      (
        await http(base, student, {
          type: 'SUBMIT',
          id: timedAttempt.id,
          revision: timedAttempt.revision,
          answer: '过期不应提交',
          attachment,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE attempt_id=$1',
          [timedAttempt.id],
        )
      ).rows[0].n,
      0,
    );
    await send({ type: 'WITHDRAW_ACTIVITY', id: timed.id, revision: '2' });
    record(
      'submission files PDF bytes, concurrent revision barrier, 10 MiB attempt quota rollback and expired deadline rejection pass without partial submissions',
    );
    // Loader is tested under the restricted runtime role, not the bootstrap owner.
    const c = await admin.connect();
    try {
      await c.query('GRANT DELETE ON zhiban_learning_files.files TO zhiban_academic_runtime');
      await c.query('SET ROLE zhiban_academic_runtime');
      await assert.rejects(() => loadSubmissionFiles(c));
      await c.query('RESET ROLE');
      await c.query('REVOKE DELETE ON zhiban_learning_files.files FROM zhiban_academic_runtime');
      await c.query('SET ROLE zhiban_academic_runtime');
      assert.equal(await loadSubmissionFiles(c), true);
    } finally {
      await c.query('RESET ROLE');
      await c.query('REVOKE DELETE ON zhiban_learning_files.files FROM zhiban_academic_runtime');
      c.release();
    }
    record(
      'submission file loader checks source ledger and exact append-only RLS/ACL; excess DELETE rejected and restored',
    );
    if (trusted) {
      const zip = new JSZip();
      zip.file(
        '[Content_Types].xml',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      );
      zip.file(
        'word/document.xml',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Course assignment</w:t></w:r></w:p></w:body></w:document>',
      );
      const office = await zip.generateAsync({ type: 'nodebuffer' });
      const activity = await send({
        type: 'CREATE_ACTIVITY',
        title: 'Office附件作业',
        prompt: '上传独立DOCX附件',
        deadlineAt: null,
        allowResubmit: false,
        maxAttempts: 1,
      });
      await send({ type: 'PUBLISH_ACTIVITY', ...activity });
      const attempt = await send({ type: 'START_ATTEMPT', id: activity.id }, student);
      const result = await send(
        {
          type: 'SUBMIT',
          id: attempt.id,
          revision: attempt.revision,
          answer: '见Office附件',
          attachment: {
            name: 'assignment.docx',
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            base64: office.toString('base64'),
          },
        },
        student,
      );
      const listing = (await http(base + '/attachments?submission=' + result.submissionId, teacher))
        .json as Result;
      const downloaded = (await http(
        base + '/attachments?submission=' + result.submissionId + '&file=' + listing.files[0].id,
        teacher,
      )) as RawResponse;
      assert.equal(downloaded.status, 200);
      assert.deepEqual(downloaded.bytes, office);
      record(
        'RESOURCE BUNDLE: real ClamAV-cleared DOCX submission and teacher exact-byte download; no parser configuration required for download-only attachments',
      );
    }
  }
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'Asia/Shanghai' }),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/zhiban');
  await page.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(student.uid);
  await page.getByLabel('密码', { exact: true }).fill(student.password);
  await page.getByRole('button', { name: '登录并进入', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  const course = (
    await admin.query('SELECT course_id FROM zhiban_academic.offerings WHERE id=$1', [
      trial.offeringId,
    ])
  ).rows[0].course_id;
  await page.goto(
    `${origin}/zhiban/student/courses/${course}/coursework?space=${tenant}&offering=${trial.offeringId}#activity-${a.id}`,
  );
  const card = page
    .locator('section.learning-activity')
    .filter({ has: page.getByRole('heading', { name: '试讲：附件巡检报告', exact: true }) });
  await card.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
  await card
    .getByLabel('本次提交附件（文档／图片／音视频，最多1 MiB，可选）', { exact: true })
    .setInputFiles({ name: '页面巡检.txt', mimeType: 'text/plain', buffer: bytes });
  await expect(card.getByText(/已选择：页面巡检.txt/)).toBeVisible();
  await card
    .getByRole('textbox', { name: '尝试 1 作答', exact: true })
    .fill('页面提交：文字与附件同一版本。');
  await card.getByRole('button', { name: '保存作答草稿', exact: true }).click();
  await expect(card.getByText(/已选择：页面巡检.txt/)).toBeVisible();
  const attemptsReload = page.waitForResponse(
    (r) => r.request().method() === 'GET' && r.url().includes(base + '/attempts?'),
  );
  const submitResponse = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      r.url().endsWith(base) &&
      JSON.parse(r.request().postData() || '{}').type === 'SUBMIT',
  );
  await card.getByRole('button', { name: '提交新版本', exact: true }).click();
  assert.equal((await submitResponse).status(), 200);
  await attemptsReload;
  await expect(page.getByText('操作已完成。', { exact: true })).toBeVisible();
  await expect(card.getByRole('textbox', { name: '尝试 1 作答', exact: true })).toHaveValue(
    '页面提交：文字与附件同一版本。',
  );
  const versionsSummary = card.getByText('查看提交版本与成绩', { exact: true });
  if (!(await versionsSummary.locator('..').evaluate((node) => (node as HTMLDetailsElement).open)))
    await versionsSummary.click();
  const downloadButton = card.getByRole('button', { name: /下载附件 页面巡检.txt/ });
  await expect(downloadButton).toBeVisible({ timeout: trusted ? 75000 : 10000 });
  const waiting = page.waitForEvent('download');
  await downloadButton.click();
  const download = await waiting;
  const downloaded = await download.path();
  assert.ok(downloaded);
  assert.deepEqual(await readFile(downloaded!), bytes);
  await page.screenshot({
    path: `docs/v2/evidence/${trusted ? 'zhiban-trusted-files' : 'zhiban-submission-files'}-student-local.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await context.close();
  record(
    'submission files real browser selects file, saves text draft retaining selection, submits version, reopens historical list and downloads exact file bytes without script errors',
  );
}
