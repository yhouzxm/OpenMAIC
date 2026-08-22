import { expect, test } from '@playwright/test';

const courseId = process.env.ZHIBAN_E2E_COURSE_ID ?? '';
const teacher = {
  login: process.env.ZHIBAN_E2E_TEACHER_LOGIN ?? '',
  password: process.env.ZHIBAN_E2E_TEACHER_PASSWORD ?? '',
};
const student = {
  login: process.env.ZHIBAN_E2E_STUDENT_LOGIN ?? '',
  password: process.env.ZHIBAN_E2E_STUDENT_PASSWORD ?? '',
};
const configured = Boolean(
  courseId && teacher.login && teacher.password && student.login && student.password,
);

async function login(page: import('@playwright/test').Page, account: typeof teacher) {
  await page.goto('/zhiban/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#identifier').fill(account.login);
  await page.locator('#password').fill(account.password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/zhiban/login'), { timeout: 60_000 });
}

test.describe('Zhiban stage 2 course content, assignment and discussion acceptance', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });
  test.skip(!configured, 'Set ZHIBAN_E2E_COURSE_ID and teacher/student credentials');

  test('teacher course workspace exposes structure, content, coursework and discussions', async ({
    page,
  }) => {
    await login(page, teacher);
    await page.goto(`/zhiban/teacher/courses/${courseId}/classrooms`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: '统一课程结构' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '内容、资源与讨论' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '活动作业' })).toBeVisible();
    await page.getByRole('button', { name: '讨论区' }).click();
    await expect(page.getByRole('heading', { name: '创建讨论主题' })).toBeVisible();
  });

  test('student course workspace renders published coursework and safe course content', async ({
    page,
  }) => {
    await login(page, student);
    await page.goto(`/zhiban/student/courses/${courseId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '课程目录' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '章节学习内容' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '课程讨论' })).toBeVisible();
  });
});
