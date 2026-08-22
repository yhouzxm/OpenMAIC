import { expect, test } from '@playwright/test';

const configured = Boolean(
  process.env.ZHIBAN_E2E_COURSE_ID &&
  process.env.ZHIBAN_E2E_TEACHER_LOGIN &&
  process.env.ZHIBAN_E2E_TEACHER_PASSWORD,
);
test.describe('Zhiban stage 3.5 OpenMAIC single activity acceptance', () => {
  test.skip(!configured, 'Set course and teacher E2E credentials');
  test('teacher activity editor exposes independent OpenMAIC activity creation', async ({
    page,
  }) => {
    await page.goto('/zhiban/login');
    await page.locator('#identifier').fill(process.env.ZHIBAN_E2E_TEACHER_LOGIN!);
    await page.locator('#password').fill(process.env.ZHIBAN_E2E_TEACHER_PASSWORD!);
    await page.getByRole('button', { name: '登录' }).click();
    await page.goto(`/zhiban/teacher/courses/${process.env.ZHIBAN_E2E_COURSE_ID}/classrooms`);
    for (const label of ['幻灯片', 'Quiz', '互动网页', 'PBL 互动', '3D 互动'])
      await expect(
        page.locator('select[name="type"] option', { hasText: label }).first(),
      ).toBeAttached();
    await expect(
      page.locator('select[name="type"] option', { hasText: 'OpenMAIC 互动' }),
    ).toHaveCount(0);
  });

  const studentConfigured = Boolean(
    process.env.ZHIBAN_E2E_STUDENT_LOGIN &&
    process.env.ZHIBAN_E2E_STUDENT_PASSWORD &&
    process.env.ZHIBAN_E2E_ACTIVITY_ID,
  );
  test('student can launch a published independent activity and return to the course', async ({
    page,
  }) => {
    test.skip(!studentConfigured, 'Set student credentials and ZHIBAN_E2E_ACTIVITY_ID');
    await page.goto('/zhiban/login');
    await page.locator('#identifier').fill(process.env.ZHIBAN_E2E_STUDENT_LOGIN!);
    await page.locator('#password').fill(process.env.ZHIBAN_E2E_STUDENT_PASSWORD!);
    await page.getByRole('button', { name: '登录' }).click();
    await page.goto(
      `/zhiban/student/courses/${process.env.ZHIBAN_E2E_COURSE_ID}/activities/${process.env.ZHIBAN_E2E_ACTIVITY_ID}`,
    );
    await expect(page.getByRole('link', { name: '返回课程工作区' })).toBeVisible();
    await expect(page.locator('[data-testid="scene-list"]')).toBeVisible();
  });
});
