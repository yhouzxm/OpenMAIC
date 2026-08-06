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
  await page.waitForLoadState('domcontentloaded');
}

test.describe('Zhiban stage 7 classroom acceptance', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });
  test.skip(!configured, 'Set ZHIBAN_E2E_TENANT_ID and teacher/student credentials to run');
  test('teacher can open classroom creation and inspect progress/audit', async ({ page }) => {
    await login(page, teacher);
    await page.goto('/zhiban/teacher/classrooms', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '课程课堂绑定' })).toBeVisible();
    await expect(page.getByRole('link', { name: /创建 OpenMAIC 课堂/ })).toHaveAttribute(
      'href',
      /zhibanCourseId=/,
    );
    await expect(page.getByText('学生课堂学习进度')).toBeVisible();
    await expect(page.getByText(/课堂互动审计/)).toBeVisible();
  });
  test('student classroom entry restores server session and exposes scene locks', async ({
    page,
  }) => {
    await login(page, student);
    await page.goto('/zhiban/student/classrooms', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '我的课程课堂' })).toBeVisible();
    const entry = page.getByRole('link', { name: /进入课堂|继续课堂/ }).first();
    test.skip((await entry.count()) === 0, 'Student has no published classroom fixture');
    await entry.click();
    await expect(page.locator('[data-testid="scene-list"]')).toBeVisible();
    const locked = page.locator('[data-testid="scene-item"][aria-disabled="true"]');
    if (await locked.count()) await expect(locked.first().locator('[aria-label]')).toBeVisible();
  });
});
