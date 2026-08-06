import { expect, test } from '@playwright/test';

const teacher = {
  tenant: process.env.ZHIBAN_E2E_TENANT_ID,
  login: process.env.ZHIBAN_E2E_TEACHER_LOGIN,
  password: process.env.ZHIBAN_E2E_TEACHER_PASSWORD,
};
const student = {
  tenant: process.env.ZHIBAN_E2E_TENANT_ID,
  login: process.env.ZHIBAN_E2E_STUDENT_LOGIN,
  password: process.env.ZHIBAN_E2E_STUDENT_PASSWORD,
};
const configured = Object.values(teacher).every(Boolean) && Object.values(student).every(Boolean);

async function login(page: import('@playwright/test').Page, account: typeof teacher) {
  await page.goto('/zhiban/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#tenantId').fill(account.tenant!);
  await page.locator('#loginName').fill(account.login!);
  await page.locator('#password').fill(account.password!);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/zhiban/login'), { timeout: 60_000 });
}

test.describe('Zhiban stage 8 learning profile acceptance', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });
  test.skip(!configured, 'Set ZHIBAN_E2E_TENANT_ID and teacher/student credentials to run');

  test('student can inspect evidence and control profile collection', async ({ page }) => {
    await login(page, student);
    await page.goto('/zhiban/student/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '我的学习画像' })).toBeVisible();
    const evidence = page.getByRole('button', { name: '证据与历史' }).first();
    test.skip((await evidence.count()) === 0, 'Student has no enrolled course fixture');
    await evidence.click();
    await expect(page.getByTestId('profile-detail')).toBeVisible();
    await expect(page.getByText(/数据采集：/)).toBeVisible();
    await expect(page.getByRole('link', { name: '导出我的数据' })).toBeVisible();
  });

  test('teacher can inspect scoped learner evidence and correction queue', async ({ page }) => {
    await login(page, teacher);
    await page.goto('/zhiban/teacher/profiles', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '课程学习画像' })).toBeVisible();
    const inspect = page.getByRole('button', { name: '查看证据与申请' }).first();
    test.skip((await inspect.count()) === 0, 'Course has no enrolled learner fixture');
    await inspect.click();
    await expect(page.getByTestId('teacher-profile-detail')).toBeVisible();
    await expect(page.getByText('待处理更正申请')).toBeVisible();
  });
});
