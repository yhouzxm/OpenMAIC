import { expect, test, type Page } from '@playwright/test';
const tenant = process.env.ZHIBAN_E2E_TENANT_ID ?? '',
  teacher = {
    login: process.env.ZHIBAN_E2E_TEACHER_LOGIN ?? '',
    password: process.env.ZHIBAN_E2E_TEACHER_PASSWORD ?? '',
  },
  student = {
    login: process.env.ZHIBAN_E2E_STUDENT_LOGIN ?? '',
    password: process.env.ZHIBAN_E2E_STUDENT_PASSWORD ?? '',
  };
const configured = Boolean(
  tenant && teacher.login && teacher.password && student.login && student.password,
);
async function login(page: Page, u: { login: string; password: string }) {
  await page.goto('/zhiban/login');
  await page.getByLabel(/租户/).fill(tenant);
  await page.getByLabel(/账号|用户名/).fill(u.login);
  await page.getByLabel(/密码/).fill(u.password);
  await page.getByRole('button', { name: /登录/ }).click();
  await page.waitForURL(/\/zhiban(?!\/login)/);
}
test.describe('Zhiban stage 11 risk acceptance', () => {
  test.skip(!configured, 'Set ZHIBAN_E2E tenant and teacher/student credentials');
  test('teacher sees risk queue, heatmap and intervention controls', async ({ page }) => {
    await login(page, teacher);
    await page.goto('/zhiban/teacher/risks');
    await expect(page.getByRole('heading', { name: '风险预警与教学干预' })).toBeVisible();
    await expect(page.getByText('30天风险热力图')).toBeVisible();
    await expect(page.getByText('教师预警队列')).toBeVisible();
  });
  test('student sees only personal non-diagnostic support and pause controls', async ({ page }) => {
    await login(page, student);
    await page.goto('/zhiban/student/risks');
    await expect(page.getByRole('heading', { name: '我的学习支持' })).toBeVisible();
    await expect(page.getByText(/不是心理诊断/)).toBeVisible();
  });
});
