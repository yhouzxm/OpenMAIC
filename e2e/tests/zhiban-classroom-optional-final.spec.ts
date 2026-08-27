import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const courseId = process.env.ZHIBAN_E2E_COURSE_ID ?? 'mech-mechatronics-system';
const bindingId = process.env.ZHIBAN_E2E_CLASSROOM_BINDING_ID ?? '';
const teacher = {
  login: process.env.ZHIBAN_E2E_TEACHER_LOGIN ?? '',
  password: process.env.ZHIBAN_E2E_TEACHER_PASSWORD ?? '',
};
const student = {
  login: process.env.ZHIBAN_E2E_STUDENT_LOGIN ?? '',
  password: process.env.ZHIBAN_E2E_STUDENT_PASSWORD ?? '',
};
const configured = Boolean(
  bindingId && teacher.login && teacher.password && student.login && student.password,
);

test.skip(
  !configured,
  'Set review credentials and ZHIBAN_E2E_CLASSROOM_BINDING_ID to run the optional Classroom E2E',
);

async function login(page: Page, account: { login: string; password: string }) {
  await page.goto('/zhiban/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#identifier').fill(account.login);
  await page.locator('#password').fill(account.password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/zhiban/login'), { timeout: 60_000 });
}

async function pageFor(context: BrowserContext, account: { login: string; password: string }) {
  const page = await context.newPage();
  await login(page, account);
  return page;
}

test('optional Classroom dispatch → student event → Concept Error → remediation dispatch', async ({ browser }) => {
  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const teacherPage = await pageFor(teacherContext, teacher);
  const studentPage = await pageFor(studentContext, student);
  const teacherEndpoint = `/api/zhiban/teacher/courses/${courseId}/classrooms/${bindingId}/scene-session`;

  const dispatched = await teacherPage.request.post(teacherEndpoint, {
    data: { action: 'dispatch', sceneId: 'S05-04' },
  });
  expect(dispatched.ok()).toBe(true);
  const dispatchBody = await dispatched.json();
  expect(dispatchBody.session).toMatchObject({ activeSceneId: 'S05-04', status: 'ACTIVE' });

  const current = await studentPage.request.get(`/api/zhiban/classrooms/${bindingId}/current-dispatch`);
  expect(current.ok()).toBe(true);
  const currentBody = await current.json();
  expect(currentBody.session).toMatchObject({ activeSceneId: 'S05-04', dispatchType: 'SCENE' });

  const completed = await studentPage.request.post(`/api/zhiban/classrooms/${bindingId}/scene-events`, {
    data: {
      sceneId: 'S05-04',
      classroomSceneSessionId: currentBody.session.id,
      eventType: 'COMPLETE_SCENE',
      isCorrect: false,
      firstChoice: 'Q0.1',
      durationMs: 48_000,
      conceptErrors: ['OUTPUT_EQUALS_ACTUATION_SUCCESS'],
      attempt: 1,
      payload: { selectedNode: 'Q0.1' },
      timestamp: new Date().toISOString(),
    },
  });
  expect(completed.ok()).toBe(true);

  const analytics = await teacherPage.request.get(teacherEndpoint);
  expect(analytics.ok()).toBe(true);
  const analyticsBody = await analytics.json();
  expect(analyticsBody.analytics.participants).toBeGreaterThanOrEqual(1);
  expect(analyticsBody.analytics.completed).toBeGreaterThanOrEqual(1);
  expect(analyticsBody.analytics.conceptErrors).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'OUTPUT_EQUALS_ACTUATION_SUCCESS' })]),
  );

  const remediation = await teacherPage.request.post(teacherEndpoint, {
    data: { action: 'remediate', sceneId: 'S04-03' },
  });
  expect(remediation.ok()).toBe(true);
  expect((await remediation.json()).session).toMatchObject({ activeSceneId: 'S04-03', status: 'ACTIVE' });

  await teacherContext.close();
  await studentContext.close();
});
