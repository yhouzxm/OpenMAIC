import { expect, test } from '@playwright/test';

const student = {
  login: process.env.ZHIBAN_E2E_STUDENT_LOGIN ?? '',
  password: process.env.ZHIBAN_E2E_STUDENT_PASSWORD ?? '',
};
const teacher = { login: process.env.ZHIBAN_E2E_TEACHER_LOGIN ?? '', password: process.env.ZHIBAN_E2E_TEACHER_PASSWORD ?? '' };
const configured = Boolean(student.login && student.password);

async function login(page: import('@playwright/test').Page, account = student) {
  await page.goto('/zhiban/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#identifier').fill(student.login);
  await page.locator('#password').fill(student.password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/zhiban/login'), { timeout: 60_000 });
}

test.describe('比赛版 Virtual Lab 黄金路径', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });
  test.skip(!configured, 'Set ZHIBAN_E2E_STUDENT_LOGIN and ZHIBAN_E2E_STUDENT_PASSWORD to run');

  test('student completes deterministic S2 diagnosis without a live model dependency', async ({ page }) => {
    await login(page);
    await page.goto('/zhiban/student/courses/mech-mechatronics-system/activities/mech-lab-line-stop', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /自动输送系统智能故障诊断虚拟实训/ })).toBeVisible();
    await page.getByTestId('virtual-lab-start').click();
    const lab = page.frameLocator('iframe').last();
    await expect(lab.getByRole('button', { name: '开始实训' })).toBeVisible();
    await lab.getByRole('button', { name: '开始实训' }).click();
    await expect(lab.getByText('故障现象')).toBeVisible({ timeout: 12_000 });
    await lab.getByRole('button', { name: 'PLC' }).click();
    await lab.getByRole('button', { name: /打开 PLC I\/O 监控/ }).click();
    await expect(lab.locator('#iS2')).toHaveText('OFF');
    await lab.getByRole('button', { name: 'S2' }).click();
    await lab.getByRole('button', { name: '使用万用表测量供电' }).click();
    await expect(lab.locator('#meterValue')).toHaveText('24.0 V DC');
    await lab.getByRole('button', { name: '使用万用表测量输出' }).click();
    await expect(lab.locator('#meterValue')).toHaveText('0.0 V DC');
    await lab.getByRole('button', { name: '我要提示' }).click();
    await expect(page.getByTestId('virtual-lab-ai-coach')).toContainText(/AI 教练|教学提示模式/, { timeout: 20_000 });
    await lab.getByRole('button', { name: '进入故障判断' }).click();
    await lab.getByRole('button', { name: /S2光电传感器输出异常/ }).click();
    await lab.getByRole('button', { name: /更换\/修复 S2 传感器/ }).click();
    await expect(lab.locator('#iS2')).toHaveText('ON');
    await lab.getByRole('button', { name: '重新启动验证' }).click();
    await expect(page.getByTestId('virtual-lab-assessment-result')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('五维能力表现')).toBeVisible();
    await expect(page.getByText('建议补强')).toBeVisible();
    await expect(page.getByTestId('virtual-lab-history')).toContainText(/第\s*\d+\s*次/, { timeout: 12_000 });
  });

  test('teacher can open the persisted Virtual Lab course summary', async ({ page }) => {
    test.skip(!teacher.login || !teacher.password, 'Set teacher E2E credentials to verify the teacher summary');
    await login(page, teacher);
    await page.goto('/zhiban/teacher/virtual-lab', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '虚拟实训学情' })).toBeVisible();
    await expect(page.getByText('学生实训记录')).toBeVisible();
  });
});
