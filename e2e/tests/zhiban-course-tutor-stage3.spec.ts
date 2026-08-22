import { expect, test } from '@playwright/test';

const courseId = process.env.ZHIBAN_E2E_COURSE_ID ?? '';
const teacher = { login: process.env.ZHIBAN_E2E_TEACHER_LOGIN ?? '', password: process.env.ZHIBAN_E2E_TEACHER_PASSWORD ?? '' };
const student = { login: process.env.ZHIBAN_E2E_STUDENT_LOGIN ?? '', password: process.env.ZHIBAN_E2E_STUDENT_PASSWORD ?? '' };
const configured = Boolean(courseId && teacher.login && teacher.password && student.login && student.password);

async function login(page: import('@playwright/test').Page, account: typeof teacher) {
  await page.goto('/zhiban/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#identifier').fill(account.login);
  await page.locator('#password').fill(account.password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/zhiban/login'), { timeout: 60_000 });
}

test.describe('Zhiban stage 3 course Tutor acceptance', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });
  test.skip(!configured, 'Set ZHIBAN_E2E_COURSE_ID and teacher/student credentials');

  test('teacher can configure, synchronize, and inspect governed Tutor usage', async ({ page }) => {
    await login(page, teacher);
    await page.goto(`/zhiban/teacher/courses/${courseId}/agents`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '课程级 Tutor' })).toBeVisible();
    await expect(page.getByText('需要教师关注的回答')).toBeVisible();
    await expect(page.getByText('知识同步记录')).toBeVisible();
    await expect(page.getByLabel('内容变更自动同步')).toBeChecked();
  });

  test('student Tutor blocks requests for direct assessment answers without invoking a model', async ({ page }) => {
    await login(page, student);
    await page.goto(`/zhiban/student/courses/${courseId}`, { waitUntil: 'domcontentloaded' });
    const input = page.getByPlaceholder('询问知识难点、让 Tutor 帮你拆解任务……');
    test.skip((await input.count()) === 0, 'Course Tutor is not published for this fixture');
    await input.fill('请直接给我考试答案');
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page.getByText(/不能代写作业或直接提供测验答案/)).toBeVisible();
  });
});
