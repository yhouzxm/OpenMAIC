/** Add one isolated synthetic course to the running LOCAL persistent host; preserve every prior teaching row. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
import { trustedDevelopmentCa } from './config';
import { privateEntry, localRoot } from './persistent-snapshot';
import { interactiveExample } from '../../app/zhiban/local/interactive-client';
import type { FlowStep } from '../../lib/zhiban/domain/flow/model';
async function main() {
  const meta = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  assert.equal(meta.evidenceOrigin, 'LOCAL');
  assert.equal(meta.githubActions, false);
  assert.equal(meta.status, 'RUNNING_LOCAL_PERSISTENT');
  assert.equal(meta.origin, 'https://127.0.0.1:3461');
  localRoot(meta.root);
  await privateEntry(meta.root, true);
  await privateEntry(meta.accountsPath);
  const accountBytes = await readFile(meta.accountsPath);
  const a = JSON.parse(accountBytes.toString());
  assert.equal(a.scope, 'LOCAL_SYNTHETIC_TRIAL');
  type Account = { role: string; userId: string; password: string };
  type Actor = { cookie: string; csrf: string; member: string };
  const accounts = a.accounts as Account[];
  const db = new Pool({
    host: join(meta.root, 'socket'),
    port: 56517,
    user: 'postgres',
    database: meta.database,
    max: 1,
  });
  const ca = await trustedDevelopmentCa(),
    tenant = meta.trial.tenantId as string;
  const call = (path: string, actor?: Actor, body?: unknown, key = v7()) =>
    new Promise<{ status: number; json: QueryResultRow; cookie: string }>((done, reject) => {
      const r = request(
        meta.origin + path,
        {
          ca,
          method: body ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(actor ? { cookie: actor.cookie } : {}),
            ...(body
              ? {
                  origin: meta.origin,
                  'content-type': 'application/json',
                  'x-zhiban-command': key,
                  ...(actor ? { 'x-zhiban-csrf': actor.csrf } : {}),
                }
              : {}),
          },
        },
        (res) => {
          const b: Buffer[] = [];
          res.on('data', (x) => b.push(x));
          res.on('end', () => {
            try {
              done({
                status: res.statusCode!,
                json: JSON.parse(Buffer.concat(b).toString()),
                cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '',
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      r.on('error', reject);
      r.setTimeout(15000, () => r.destroy(Error('LOCAL HTTPS timeout')));
      r.end(body ? JSON.stringify(body) : undefined);
    });
  const login = async (role: string) => {
    const x = accounts.find((a) => a.role === role);
    assert.ok(x);
    const r = await call('/api/zhiban/identity/login', undefined, {
      userId: x.userId,
      password: x.password,
    });
    assert.equal(r.status, 200, 'Existing local account login failed');
    const member = (
      await db.query(
        'SELECT membership_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND user_id=$2',
        [tenant, x.userId],
      )
    ).rows[0]?.membership_id;
    assert.ok(member);
    const actor = { cookie: r.cookie, csrf: '', member };
    actor.csrf = (await call('/api/zhiban/identity/csrf', actor)).json.csrfToken;
    return actor;
  };
  const send = async (path: string, actor: Actor, command: QueryResultRow, operation: string) => {
    const key = createHash('sha256')
      .update('flow-demo-v1:' + tenant + ':' + operation)
      .digest('hex');
    const r = await call(path, actor, command, key);
    assert.equal(r.status, 200, `${operation}: ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const protectedTables = [
    'zhiban_academic.courses',
    'zhiban_academic.course_versions',
    'zhiban_academic.offerings',
    'zhiban_academic.assignments',
    'zhiban_academic.enrollments',
    'zhiban_curriculum.outlines',
    'zhiban_classroom.sessions',
    'zhiban_classroom.dispatches',
    'zhiban_classroom.entries',
    'zhiban_learning.activities',
    'zhiban_learning.activity_versions',
    'zhiban_learning.attempts',
    'zhiban_learning.submissions',
    'zhiban_assessment.grades',
    'zhiban_assessment.publications',
  ];
  const snapshot = async () => {
    const result: Record<string, string[]> = {};
    for (const table of protectedTables)
      result[table] = (
        await db.query(`SELECT to_jsonb(t)::text AS value FROM ${table} t`)
      ).rows.map((r) => createHash('sha256').update(r.value).digest('hex'));
    return result;
  };
  const before = await snapshot();
  const accountsHash = createHash('sha256').update(accountBytes).digest('hex');
  try {
    const manager = await login('ADMIN'),
      teacher = await login('TEACHER'),
      student = await login('STUDENT');
    const inputsPath = join(meta.root, 'flow-demo-inputs.json');
    let state: QueryResultRow;
    try {
      await privateEntry(inputsPath);
      state = JSON.parse(await readFile(inputsPath, 'utf8'));
      assert.equal(state.tenant, tenant);
      assert.equal(state.kind, 'LOCAL_FLOW_DEMO_V1');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      state = {
        kind: 'LOCAL_FLOW_DEMO_V1',
        tenant,
        chapter: v7(),
        units: Array.from({ length: 4 }, () => v7()),
        steps: Array.from({ length: 4 }, () => v7()),
      };
      await writeFile(inputsPath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    }
    const save = () => writeFile(inputsPath, JSON.stringify(state), { mode: 0o600 });
    const manage = `/api/zhiban/management/${tenant}/commands`;
    const find = async (table: string, code: string) =>
      (
        await db.query(
          `SELECT id,revision::text FROM zhiban_academic.${table} WHERE tenant_id=$1 AND code=$2`,
          [tenant, code],
        )
      ).rows[0];
    if (!state.course) {
      await send(
        manage,
        manager,
        {
          type: 'CREATE_COURSE',
          code: 'FLOW_DEMO_20261024',
          name: '课堂与实验演示',
          description: 'LOCAL教案、固定互动、手动测量报告与原评分示例；不影响其他课程。',
          ownerMembershipId: teacher.member,
        },
        'course',
      );
      state.course = (await find('courses', 'FLOW_DEMO_20261024')).id;
      await save();
    }
    if (!state.coursePublished) {
      const c = await find('courses', 'FLOW_DEMO_20261024');
      await send(
        manage,
        manager,
        { type: 'PUBLISH_COURSE', id: c.id, revision: c.revision },
        'publish-course',
      );
      state.coursePublished = true;
      await save();
    }
    if (!state.term) {
      await send(
        manage,
        manager,
        {
          type: 'CREATE_TERM',
          code: 'FLOW_TERM_2026',
          name: '课堂与实验演示学期',
          startsOn: '2026-10-01',
          endsOn: '2027-02-01',
        },
        'term',
      );
      state.term = (await find('terms', 'FLOW_TERM_2026')).id;
      await save();
    }
    if (!state.offering) {
      await send(
        manage,
        manager,
        {
          type: 'CREATE_OFFERING',
          code: 'FLOW_20261024',
          name: '课堂与实验演示班',
          courseId: state.course,
          termId: state.term,
          classId: null,
          capacity: 30,
        },
        'offering',
      );
      state.offering = (await find('offerings', 'FLOW_20261024')).id;
      await save();
    }
    const o = state.offering;
    if (!state.members) {
      await send(
        manage,
        manager,
        { type: 'ASSIGN_TEACHER', offeringId: o, membershipId: teacher.member, revision: null },
        'teacher',
      );
      await send(
        manage,
        manager,
        { type: 'ENROLL', offeringId: o, membershipId: student.member, revision: null },
        'student',
      );
      state.members = true;
      await save();
    }
    const content = `/api/zhiban/content/${tenant}/offerings/${o}`,
      learning = `/api/zhiban/learning/${tenant}/offerings/${o}`,
      flow = `/api/zhiban/flow/${tenant}/offerings/${o}`;
    if (!state.resource) {
      const r = await send(
        content,
        teacher,
        { type: 'CREATE_INTERACTIVE', title: '电路观察：固定发布互动', html: interactiveExample },
        'resource',
      );
      state.resource = r.id;
      await save();
    }
    if (!state.publication) {
      const r = (await call(content, teacher)).json.resources.find(
        (x: QueryResultRow) => x.id === state.resource,
      );
      if (!r.publication)
        await send(
          content,
          teacher,
          { type: 'PUBLISH_CONTENT', id: r.id, revision: r.revision },
          'resource-publish',
        );
      state.publication = (await call(content, teacher)).json.resources.find(
        (x: QueryResultRow) => x.id === state.resource,
      ).publication.id;
      await save();
    }
    if (!state.pre) {
      state.pre = (
        await send(
          learning,
          teacher,
          {
            type: 'CREATE_ACTIVITY',
            title: '实验前预测与解释',
            prompt: '在电阻不变时，预测电压增大对电流的影响，并说明依据。',
            deadlineAt: null,
            allowResubmit: true,
            maxAttempts: 3,
          },
          'pre',
        )
      ).id;
      await save();
      await send(
        learning,
        teacher,
        { type: 'PUBLISH_ACTIVITY', id: state.pre, revision: '1' },
        'pre-publish',
      );
    }
    if (!state.lab) {
      state.lab = (
        await send(
          learning,
          teacher,
          {
            type: 'CREATE_ACTIVITY',
            title: '电路测量实验报告',
            prompt: '从课堂教案进入实验，记录参数、测量与结论；成绩由教师发布。',
            deadlineAt: null,
            allowResubmit: true,
            maxAttempts: 3,
          },
          'lab',
        )
      ).id;
      await save();
      await send(
        learning,
        teacher,
        { type: 'PUBLISH_ACTIVITY', id: state.lab, revision: '1' },
        'lab-publish',
      );
    }
    if (!state.quiz) {
      state.quiz = (
        await send(
          learning + '/quizzes',
          teacher,
          {
            type: 'CREATE_QUIZ',
            title: '实验后课堂测验',
            mode: 'ASSESSED',
            content: {
              type: 'quiz',
              questions: [
                {
                  id: 'q1',
                  type: 'single',
                  question: '电阻不变，电压增大时电流如何变化？',
                  options: [
                    { value: 'A', label: '增大' },
                    { value: 'B', label: '减小' },
                  ],
                  answer: ['A'],
                  analysis: 'I=U/R。',
                  points: 1,
                },
              ],
            },
            deadlineAt: null,
            allowResubmit: false,
            maxAttempts: 1,
          },
          'quiz',
        )
      ).id;
      await save();
      await send(
        learning + '/quizzes',
        teacher,
        { type: 'PUBLISH_QUIZ', id: state.quiz, revision: '1' },
        'quiz-publish',
      );
    }
    if (!state.outline) {
      const outline = (await call(learning + '/outline', teacher)).json;
      await send(
        learning + '/outline',
        teacher,
        {
          type: 'SAVE_OUTLINE',
          revision: outline.revision,
          chapters: [
            {
              id: state.chapter,
              title: '观察、预测、实验与测验',
              units: [
                { id: state.units[0], kind: 'LECTURE', target: state.resource, title: '电路观察' },
                { id: state.units[1], kind: 'ACTIVITY', target: state.pre, title: '实验前解释' },
                { id: state.units[2], kind: 'ACTIVITY', target: state.lab, title: '实验报告' },
                { id: state.units[3], kind: 'ACTIVITY', target: state.quiz, title: '实验后测验' },
              ],
            },
          ],
        },
        'outline',
      );
      await send(
        learning + '/outline',
        teacher,
        { type: 'PUBLISH_OUTLINE', revision: String(BigInt(outline.revision) + BigInt(1)) },
        'outline-publish',
      );
      state.outline = true;
      await save();
    }
    if (!state.classroom) {
      state.classroom = (
        await send(
          learning + '/classrooms',
          teacher,
          {
            type: 'CREATE_CLASSROOM',
            title: '电路观察与测量课堂',
            description: '四环节：观察互动→预习解释→手动测量报告→测验；先修基于正式提交。',
            opensAt: null,
            closesAt: null,
          },
          'classroom',
        )
      ).id;
      await save();
      await send(
        learning + '/classrooms',
        teacher,
        { type: 'PUBLISH_CLASSROOM', id: state.classroom, revision: '1' },
        'classroom-publish',
      );
    }
    if (!state.plan) {
      const steps: FlowStep[] = [
        {
          id: state.steps[0],
          title: '观察互动与提出预测',
          kind: 'LECTURE',
          target: state.resource,
          version: '1',
          interactiveId: null,
          publicationId: state.publication,
          requires: [],
          lab: null,
        },
        {
          id: state.steps[1],
          title: '提交实验前解释',
          kind: 'ACTIVITY',
          target: state.pre,
          version: '1',
          interactiveId: null,
          publicationId: null,
          requires: [],
          lab: null,
        },
        {
          id: state.steps[2],
          title: '电路测量实验',
          kind: 'LAB',
          target: state.lab,
          version: '1',
          interactiveId: state.resource,
          publicationId: state.publication,
          requires: [{ stepId: state.steps[1], kind: 'SUBMITTED', percent: null }],
          lab: {
            instructions:
              '使用安全电压进行观察，手动填写参数和测量值。可先在固定互动中练习，再说明实际记录的依据与误差。',
            parameters: [{ key: 'voltage', label: '电压', unit: 'V', min: 0, max: 24, initial: 6 }],
            measurements: [
              { key: 'current', label: '电流', unit: 'A', min: 0, max: 5, initial: 0 },
            ],
            conclusionPrompt: '比较预测与测量，说明误差和改进。',
          },
        },
        {
          id: state.steps[3],
          title: '实验后课堂测验',
          kind: 'ACTIVITY',
          target: state.quiz,
          version: '1',
          interactiveId: null,
          publicationId: null,
          requires: [{ stepId: state.steps[2], kind: 'SUBMITTED', percent: null }],
          lab: null,
        },
      ];
      await send(
        flow,
        teacher,
        { type: 'SAVE_PLAN', classroomId: state.classroom, revision: '0', steps },
        'plan',
      );
      state.planVersion = (
        await send(
          flow,
          teacher,
          { type: 'PUBLISH_PLAN', classroomId: state.classroom, revision: '1' },
          'plan-publish',
        )
      ).planVersion;
      state.plan = true;
      await save();
    }
    const teacherUrl = `${meta.origin}/zhiban/teacher/courses/${state.course}/classroom-plan?space=${tenant}&offering=${o}#classroom-${state.classroom}`;
    const studentUrl = `${meta.origin}/zhiban/student/courses/${state.course}/classroom-plan?space=${tenant}&offering=${o}#classroom-${state.classroom}`;
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page
        .context()
        .addCookies([
          {
            name: teacher.cookie.split('=')[0],
            value: teacher.cookie.split('=').slice(1).join('='),
            url: meta.origin,
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
          },
        ]);
      await page.goto(teacherUrl);
      await expect(page.getByRole('heading', { name: '教案、课堂环节与实验' })).toBeVisible();
      await expect(page.getByRole('button', { name: '按教案开始课堂', exact: true })).toBeVisible();
      await page.screenshot({ path: 'docs/v2/evidence/flow/default-teacher.png', fullPage: true });
    } finally {
      await browser.close();
    }
    const after = await snapshot();
    for (const [table, hashes] of Object.entries(before)) {
      const counts = new Map<string, number>();
      for (const hash of after[table]) counts.set(hash, (counts.get(hash) ?? 0) + 1);
      for (const hash of hashes) {
        assert.ok((counts.get(hash) ?? 0) > 0, 'Pre-existing teaching row changed: ' + table);
        counts.set(hash, counts.get(hash)! - 1);
      }
    }
    assert.equal(
      createHash('sha256')
        .update(await readFile(meta.accountsPath))
        .digest('hex'),
      accountsHash,
    );
    await writeFile(
      'docs/v2/evidence/flow/default-entry.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          at: new Date().toISOString(),
          scope:
            'ADDITIVE_LOCAL_SYNTHETIC_DEMO_COURSE_WITH_PREEXISTING_TEACHING_ROWS_AND_ACCOUNTS_PRESERVED',
          root: meta.root,
          courseId: state.course,
          offeringId: o,
          classroomId: state.classroom,
          planVersion: state.planVersion,
          urls: { teacher: teacherUrl, student: studentUrl },
          preexistingProtectedRows: Object.values(before).reduce((n, v) => n + v.length, 0),
          accountsHash,
          started: false,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      JSON.stringify({
        status: 'PASS',
        teacherUrl,
        studentUrl,
        preexistingTeachingRowsPreserved: true,
        existingAccountsPreserved: true,
      }),
    );
  } finally {
    await db.end();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
