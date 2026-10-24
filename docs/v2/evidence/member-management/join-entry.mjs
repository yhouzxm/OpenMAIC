/* LOCAL handoff: registered user with no active space logs in through the join page. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
(async () => {
  const meta = JSON.parse(await fs.readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'));
  assert.equal(meta.evidenceOrigin, 'LOCAL');
  assert.equal(meta.githubActions, false);
  assert.equal(meta.port, 56517);
  assert.equal(meta.origin, 'https://127.0.0.1:3461');
  const inputPath = meta.root + '/member-inputs.json';
  const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const accounts = JSON.parse(await fs.readFile(meta.accountsPath, 'utf8'));
  const manager = accounts.accounts.find(a => a.role === 'ADMIN');
  assert.ok(manager);
  const issued = process.argv.includes('--reuse-admission') ? JSON.parse(await fs.readFile('docs/v2/evidence/member-management/cli-admission.json', 'utf8')) : JSON.parse(execFileSync('pnpm', ['exec', 'tsx', 'scripts/zhiban-local/prepare-member-admission.ts', input.tenant, input.subject.userId, 'INVITE'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(issued.evidenceOrigin, 'LOCAL');
  assert.equal(issued.syntheticAuthority, true);
  await fs.writeFile('docs/v2/evidence/member-management/cli-admission.json', JSON.stringify(issued, null, 2) + '\n');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errors = [];
  let diagnosticPage;
  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    diagnosticPage = adminPage;
    adminPage.on('pageerror', e => errors.push(e.message));
    await adminPage.goto(meta.origin + '/zhiban?space=' + input.tenant);
    await adminPage.getByLabel('账号 ID', { exact: true }).fill(manager.userId);
    await adminPage.getByLabel('密码', { exact: true }).fill(manager.password);
    await adminPage.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(adminPage.getByRole('link', { name: '成员账户目录', exact: true })).toBeVisible();
    await adminPage.waitForLoadState('networkidle');
    await adminPage.goto(input.adminUrl);
    await adminPage.getByLabel('已登记入驻引用', { exact: true }).fill(issued.admissionId);
    await adminPage.getByLabel('邀请操作人当前密码', { exact: true }).fill(manager.password);
    const invitation = adminPage.waitForResponse(r => r.url().endsWith('/invitations') && r.request().method() === 'POST');
    await adminPage.getByRole('button', { name: '创建待确认邀请', exact: true }).click();
    const response = await invitation;
    assert.equal(response.status(), 200);
    const member = (await response.json()).effects[0].membershipId;
    await expect(adminPage.getByText(/状态：PENDING/)).toBeVisible();
    const targetContext = await browser.newContext();
    const target = await targetContext.newPage();
    diagnosticPage = target;
    target.on('pageerror', e => errors.push(e.message));
    await target.goto(issued.joinUrl);
    await expect(target.getByRole('heading', { name: '登录后确认加入', exact: true })).toBeVisible();
    await target.getByLabel('账号 ID', { exact: true }).fill(input.subject.userId);
    await target.getByLabel('密码', { exact: true }).fill(input.subject.password);
    await target.getByRole('button', { name: '登录并读取加入请求', exact: true }).click();
    await expect(target.getByRole('button', { name: '本人同意该加入请求', exact: true })).toBeVisible();
    await expect(target.getByText('同意只记录本人意愿；需管理员重新审批激活，不会自动获得角色。', { exact: true })).toBeVisible();
    await target.screenshot({ path: 'docs/v2/evidence/member-management/join-entry.png', fullPage: true });
    assert.deepEqual(errors, []);
    await fs.writeFile(inputPath, JSON.stringify({ ...input, admissionId: issued.admissionId, joinUrl: issued.joinUrl, pendingMembershipId: member, stage: 'INVITED_PENDING_TARGET_CONSENT', invitationCreated: true }, null, 2) + '\n', { mode: 0o600 });
    await fs.writeFile('docs/v2/evidence/member-management/join-entry.json', JSON.stringify({ evidenceOrigin: 'LOCAL', githubActions: false, status: 'PASS', origin: meta.origin, stage: 'INVITED_PENDING_TARGET_CONSENT', checks: ['standalone CLI issued admission through real ControlCommands', 'ordinary admin UI login and invitation', 'fresh unauthenticated target join page login without active space', 'target consent remains an explicit unclicked action; admin activation remains separate'], admissionId: issued.admissionId, member, at: new Date().toISOString() }, null, 2) + '\n');
    console.log('PASS standalone admission CLI and fresh join-page login; handoff left PENDING before target consent');
  } catch (error) {
    if (diagnosticPage) {
      await diagnosticPage.screenshot({ path: 'docs/v2/evidence/member-management/join-entry-failure.png', fullPage: true }).catch(() => {});
      await fs.writeFile('/tmp/zhiban-member-join-entry-failure.txt', await diagnosticPage.locator('body').innerText(), { mode: 0o600 }).catch(() => {});
    }
    throw error;
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
