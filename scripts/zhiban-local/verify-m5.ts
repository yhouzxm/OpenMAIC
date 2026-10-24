import assert from 'node:assert/strict';
import { request } from 'node:https';
import { randomUUID, X509Certificate, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import { directory, origin, privateFile, trustedDevelopmentCa, digest } from './config';
type Row = any;
type Account = {
  userId: string;
  password: string;
  label: string;
  tenantId: string;
  membershipId: string;
};
type Session = { account: Account; cookie: string; csrf: string };
async function main() {
  const ca = await trustedDevelopmentCa();
  const { accounts } = JSON.parse((await privateFile('accounts.json')).toString()) as {
    accounts: Account[];
  };
  const passed: string[] = [];
  const record = (name: string) => {
    passed.push(name);
    console.log(`PASS ${name}`);
  };
  const http = (
    path: string,
    session?: Session,
    command?: unknown,
    key = randomUUID().replaceAll('-', ''),
    extra: Record<string, string> = {},
  ) =>
    new Promise<{ status: number; data: Row; cookie?: string }>((done, reject) => {
      const r = request(
        origin + path,
        {
          ca,
          servername: '',
          method: command ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(session ? { Cookie: session.cookie } : {}),
            ...(command
              ? {
                  Origin: origin,
                  'Content-Type': 'application/json',
                  'x-zhiban-command': key,
                  ...(session ? { 'x-zhiban-csrf': session.csrf } : {}),
                }
              : {}),
            ...extra,
          },
        },
        (response) => {
          const parts: Buffer[] = [];
          response.on('data', (b) => parts.push(b));
          response.on('end', () => {
            try {
              const raw = Buffer.concat(parts).toString();
              done({
                status: response.statusCode!,
                data: raw ? JSON.parse(raw) : null,
                cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      r.on('error', reject);
      r.setTimeout(10000, () => r.destroy(new Error('HTTPS timeout')));
      r.end(command ? JSON.stringify(command) : undefined);
    });
  const login = async (label: string) => {
    const account = accounts.find((a) => a.label === label)!;
    assert.ok(account);
    const result = await http('/api/zhiban/identity/login', undefined, {
      userId: account.userId,
      password: account.password,
    });
    assert.equal(result.status, 200);
    const s = { account, cookie: result.cookie!, csrf: '' };
    s.csrf = (await http('/api/zhiban/identity/csrf', s)).data.csrfToken;
    return s;
  };
  const teacher = await login('任教教师'),
    student = await login('学生甲'),
    admin = await login('本地教务管理员'),
    unassigned = await login('非任教教师'),
    other = await login('其他空间管理员');
  const academicPath = `/api/zhiban/academic/${admin.account.tenantId}`;
  const academic = async (cmd: any) => {
    const r = await http(academicPath, admin, cmd);
    assert.equal(r.status, 200, r.data?.error?.code);
    return r.data;
  };
  const suffix = Date.now().toString(36);
  let state = await academic({
    type: 'CREATE_TERM',
    code: `M5T-${suffix}`,
    name: 'M5 本地验证学期',
    startsOn: '2026-10-01',
    endsOn: '2027-07-01',
  });
  const term = state.terms.find((r: any) => r.code === `M5T-${suffix}`);
  state = await academic({
    type: 'CREATE_COURSE',
    code: `M5C-${suffix}`,
    name: 'M5 文本内容验证',
    description: 'LOCAL 合成教学内容',
    ownerMembershipId: teacher.account.membershipId,
  });
  let course = state.courses.find((r: any) => r.code === `M5C-${suffix}`);
  state = await academic({ type: 'PUBLISH_COURSE', id: course.id, revision: course.revision });
  course = state.courses.find((r: any) => r.id === course.id);
  state = await academic({
    type: 'CREATE_OFFERING',
    courseId: course.id,
    termId: term.id,
    classId: null,
    code: `M5O-${suffix}`,
    name: `M5 文本教学班 ${suffix}`,
    capacity: 10,
  });
  const offering = state.offerings.find((r: any) => r.code === `M5O-${suffix}`);
  state = await academic({
    type: 'ASSIGN_TEACHER',
    offeringId: offering.id,
    membershipId: teacher.account.membershipId,
    revision: null,
  });
  state = await academic({
    type: 'ENROLL',
    offeringId: offering.id,
    membershipId: student.account.membershipId,
    revision: null,
  });
  const path = `/api/zhiban/content/${teacher.account.tenantId}/offerings/${offering.id}`;
  const cmd = async (value: any, key?: string) => {
    const r = await http(path, teacher, value, key);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const list = async () => {
    const r = await http(path, teacher);
    assert.equal(r.status, 200);
    return r.data;
  };
  record('M1/M2 real authentication and admin-managed fixture on enabled Academic profile');
  assert.equal((await http(path)).status, 401);
  record('anonymous content request rejected');
  const createKey = randomUUID().replaceAll('-', '');
  const created = await cmd({ type: 'CREATE_CONTENT', title: 'M5 公开文本' }, createKey);
  assert.equal(
    (await cmd({ type: 'CREATE_CONTENT', title: 'M5 公开文本' }, createKey)).id,
    created.id,
  );
  record('durable CREATE idempotency');
  let r = (await list()).resources.find((r: any) => r.id === created.id);
  assert.equal(r.revision, '1');
  assert.equal((await http(path, student)).data.resources.length, 0);
  record('student list hides DRAFT and title');
  const snapshot = {
    ...r.draft,
    slides: [
      {
        ...r.draft.slides[0],
        elements: [
          { id: v7(), text: '机电课程：第一版\n第二行', x: 30, y: 30, width: 800, height: 100 },
        ],
      },
    ],
  };
  const save = { type: 'SAVE_CONTENT', id: r.id, revision: r.revision, ...snapshot };
  assert.equal((await http(path, student, save)).status, 403);
  assert.equal((await http(path, unassigned, save)).status, 403);
  assert.equal((await http(path, other, save)).status, 403);
  record('student/unassigned/foreign tenant writes rejected');
  assert.equal(
    (
      await http(path, teacher, {
        ...save,
        slides: [
          {
            ...snapshot.slides[0],
            elements: [{ ...snapshot.slides[0].elements[0], text: '<img src=x>' }],
          },
        ],
      })
    ).status,
    400,
  );
  assert.equal((await http(path, teacher, { ...save, provider: 'caller' })).status, 400);
  assert.equal((await http(path, teacher, save, undefined, { 'x-zhiban-csrf': '' })).status, 403);
  record('closed DTO, HTML and invalid CSRF rejected');
  await cmd(save);
  assert.equal((await http(path, teacher, save)).status, 409);
  r = (await list()).resources.find((x: any) => x.id === r.id);
  assert.equal(r.revision, '2');
  record('saved draft and stale CAS rejection');
  const nativeConfig = JSON.parse((await privateFile('content.json')).toString()),
    native = new Pool({ connectionString: nativeConfig.native, max: 1 });
  const countBefore = Number(
    (await native.query('SELECT count(*) FROM public.document_stages')).rows[0].count,
  );
  await cmd({ type: 'PUBLISH_CONTENT', id: r.id, revision: r.revision });
  r = (await list()).resources.find((x: any) => x.id === r.id);
  assert.equal(r.state, 'PUBLISHED');
  assert.equal(r.revision, '3');
  assert.equal(
    Number((await native.query('SELECT count(*) FROM public.document_stages')).rows[0].count),
    countBefore + 1,
  );
  record('real public DocumentStore Native commit and atomic Bridge/content publication');
  const published = () => http(`${path}/resources/${r.id}/preview?source=published`, student);
  const pub = await published();
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.equal(pub.data.slides[0].elements[0].text, snapshot.slides[0].elements[0].text);
  assert.ok(!JSON.stringify(pub.data).includes('owner_handle'));
  assert.equal((await http(`${path}/resources/${r.id}/preview?source=draft`, student)).status, 403);
  record('student preview reads Native published text only, including newline');
  await cmd({
    type: 'SAVE_CONTENT',
    id: r.id,
    revision: r.revision,
    title: '未发布修改',
    slides: [
      {
        ...snapshot.slides[0],
        elements: [{ ...snapshot.slides[0].elements[0], text: '第二版草稿' }],
      },
    ],
  });
  r = (await list()).resources.find((x: any) => x.id === r.id);
  assert.equal(
    (await published()).data.slides[0].elements[0].text,
    snapshot.slides[0].elements[0].text,
  );
  assert.equal((await http(path, student)).data.resources[0].title, 'M5 公开文本');
  record('editing published draft preserves old Native generation and published title');
  await cmd({ type: 'PUBLISH_CONTENT', id: r.id, revision: r.revision });
  r = (await list()).resources.find((x: any) => x.id === r.id);
  assert.equal((await published()).data.slides[0].elements[0].text, '第二版草稿');
  record('second publication retires old generation and exposes exact saved version');
  const certificate = new X509Certificate(await privateFile('localhost.crt')),
    spki = createHash('sha256')
      .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
      .digest('base64');
  const browser = await chromium.launch({
    args: [`--ignore-certificate-errors-spki-list=${spki}`],
  });
  try {
    for (const session of [teacher, student]) {
      const context = await browser.newContext(),
        page = await context.newPage();
      const pageErrors: string[] = [],
        csp: string[] = [],
        external: string[] = [];
      await page.addInitScript(() => {
        (window as any).__csp = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          (window as any).__csp.push((e as SecurityPolicyViolationEvent).violatedDirective);
        });
      });
      page.on('pageerror', (e) => pageErrors.push(e.message));
      page.on('request', (req) => {
        if (!req.url().startsWith(origin)) external.push(req.url().split('?')[0]);
      });
      await page.goto(`${origin}/zhiban`);
      await page.getByLabel('账号 ID').fill(session.account.userId);
      await page.getByLabel('密码', { exact: true }).fill(session.account.password);
      await page.getByRole('button', { name: '登录并进入' }).click();
      await page.getByRole('button').filter({ hasText: '本地学习空间' }).click();
      await page.goto(
        `${origin}/zhiban/content?tenant=${teacher.account.tenantId}&offering=${offering.id}`,
      );
      if (session === teacher) {
        await page.getByRole('button', { name: '编辑草稿', exact: true }).click();
        await page.getByLabel('正文 1', { exact: true }).fill('页面文本闭环');
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        await expect(page.getByLabel('正文 1', { exact: true })).toHaveValue('第二版草稿');
        await page.getByRole('button', { name: '重做', exact: true }).click();
        await expect(page.getByLabel('正文 1', { exact: true })).toHaveValue('页面文本闭环');
        const saved = page.waitForResponse(
          (res) => res.url() === origin + path && res.request().method() === 'POST',
        );
        await page.getByRole('button', { name: '保存草稿', exact: true }).click();
        assert.equal((await saved).status(), 200);
        await expect(page.getByRole('button', { name: '发布保存版本' })).toBeEnabled();
        const publishedResponse = page.waitForResponse(
          (res) => res.url() === origin + path && res.request().method() === 'POST',
        );
        await page.getByRole('button', { name: '发布保存版本' }).click();
        assert.equal((await publishedResponse).status(), 200);
        await expect(page.getByRole('button', { name: '查看已发布' })).toBeVisible();
        record('HTTPS public core text edit undo/redo save publish');
      } else {
        await page.getByRole('button', { name: '查看已发布' }).click();
        await expect(page.getByRole('heading', { name: '已发布预览' })).toBeVisible();
        await expect(page.locator('.content-preview')).toContainText('页面文本闭环');
        assert.equal(await page.getByRole('button', { name: '保存草稿' }).count(), 0);
        record('HTTPS student renderer preview has no editing controls');
      }
      csp.push(...(await page.evaluate(() => (window as any).__csp)));
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(csp, []);
      assert.deepEqual(external, []);
      record(`HTTPS ${session === teacher ? 'teacher' : 'student'} CSP and no external requests`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  r = (await list()).resources.find((x: any) => x.id === r.id);
  await cmd({ type: 'WITHDRAW_CONTENT', id: r.id, revision: r.revision });
  assert.equal((await published()).status, 409);
  assert.equal((await http(path, student)).data.resources.length, 0);
  record('withdraw denies student preview and hides list entry');
  r = (await list()).resources.find((x: any) => x.id === r.id);
  await cmd({ type: 'WITHDRAW_CONTENT', id: r.id, revision: r.revision });
  assert.equal((await list()).resources.find((x: any) => x.id === r.id).revision, r.revision);
  record('withdraw no-op preserves revision');
  await cmd({ type: 'PUBLISH_CONTENT', id: r.id, revision: r.revision });
  r = (await list()).resources.find((x: any) => x.id === r.id);
  assert.equal((await published()).status, 200);
  record('republish after withdrawal succeeds');
  const enrollment = state.enrollments.find(
    (x: any) => x.offering_id === offering.id && x.membership_id === student.account.membershipId,
  );
  await academic({ type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision });
  assert.equal((await published()).status, 403);
  record('current Enrollment revocation blocks Native published read');
  await native.end();
  await writeFile(
    join(directory, 'm5-last-fixture.json'),
    JSON.stringify(
      { tenant: teacher.account.tenantId, offering: offering.id, resource: r.id, suffix },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  await writeFile(
    'docs/v2/evidence/m5-ab-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        at: new Date().toISOString(),
        scope: 'OWNED_PG16_HTTPS_CONTENT_TEXT_V1',
        checks: passed,
        status: 'PASS',
        fixture: { tenant: teacher.account.tenantId, offering: offering.id, resource: r.id },
        nativeDocumentStoreCalls: 'ACTUAL',
        tlsVerification: 'CA verified Node HTTPS and Chromium leaf SPKI pin; no blanket TLS bypass',
        remaining: [
          'Native unknown outcome reconciliation operator',
          'M5-C PNG',
          'M5-D Runtime',
          'M5-E AI',
        ],
        revocationEvidence: 'm5-revocation-barriers-local.json',
        commitPushCiDispatch: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`LOCAL M5 ${passed.length}/${passed.length} PASS`);
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'M5 verification failed');
  process.exitCode = 1;
});
