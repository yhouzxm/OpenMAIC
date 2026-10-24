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
import { simulationModels, SIMULATION_SOURCE } from '../../lib/zhiban/domain/flow/simulation';
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
      .update('simulation-demo-v1:' + tenant + ':' + operation)
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
  await writeFile(
    'docs/v2/evidence/simulation/default-seed-preserved-before.json',
    JSON.stringify(before, null, 2) + '\n',
  );
  const accountsHash = createHash('sha256').update(accountBytes).digest('hex');
  try {
    const manager = await login('ADMIN'),
      teacher = await login('TEACHER'),
      student = await login('STUDENT');
    const inputsPath = join(meta.root, 'simulation-demo-inputs.json');
    let state: QueryResultRow;
    try {
      await privateEntry(inputsPath);
      state = JSON.parse(await readFile(inputsPath, 'utf8'));
      assert.equal(state.tenant, tenant);
      assert.equal(state.kind, 'LOCAL_SIMULATION_DEMO_V1');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      state = {
        kind: 'LOCAL_SIMULATION_DEMO_V1',
        tenant,
        chapter: v7(),
        units: Array.from({ length: 2 }, () => v7()),
        steps: Array.from({ length: 2 }, () => v7()),
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
          code: 'SIMULATION_DEMO_20261024',
          name: '自动实验：服务端模拟',
          description: '直流欧姆定律与RC充电模型；结果为服务端计算模拟，不是设备测量。',
          ownerMembershipId: teacher.member,
        },
        'course',
      );
      state.course = (await find('courses', 'SIMULATION_DEMO_20261024')).id;
      await save();
    }
    if (!state.coursePublished) {
      const c = await find('courses', 'SIMULATION_DEMO_20261024');
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
          code: 'SIMULATION_TERM_2026',
          name: '服务端模拟实验学期',
          startsOn: '2026-10-01',
          endsOn: '2027-02-01',
        },
        'term',
      );
      state.term = (await find('terms', 'SIMULATION_TERM_2026')).id;
      await save();
    }
    if (!state.offering) {
      await send(
        manage,
        manager,
        {
          type: 'CREATE_OFFERING',
          code: 'SIMULATION_20261024',
          name: '服务端模拟实验班',
          courseId: state.course,
          termId: state.term,
          classId: null,
          capacity: 30,
        },
        'offering',
      );
      state.offering = (await find('offerings', 'SIMULATION_20261024')).id;
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
    const learning = `/api/zhiban/learning/${tenant}/offerings/${o}`,
      flow = `/api/zhiban/flow/${tenant}/offerings/${o}`;
    state.activities ??= [];
    for (const [i, m] of simulationModels.entries()) {
      if (!state.activities[i]) {
        const activity = await send(
          learning,
          teacher,
          {
            type: 'CREATE_ACTIVITY',
            title: m.title + '模拟报告',
            prompt:
              '从教案进入，比较服务端模拟结果，说明理想模型的限制；非设备测量，成绩由教师发布。',
            deadlineAt: null,
            allowResubmit: true,
            maxAttempts: 3,
          },
          'activity-' + i,
        );
        state.activities[i] = activity.id;
        await save();
      }
      const activities = (await call(learning + '/activities', teacher)).json;
      const row = (activities.rows ?? activities.activities ?? []).find(
        (r: QueryResultRow) => r.id === state.activities[i],
      );
      if (!state['activityPublished' + i]) {
        await send(
          learning,
          teacher,
          { type: 'PUBLISH_ACTIVITY', id: state.activities[i], revision: row?.revision ?? '1' },
          'activity-publish-' + i,
        );
        state['activityPublished' + i] = true;
        await save();
      }
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
              title: '理想电路的服务端计算模拟',
              units: simulationModels.map((m, i) => ({
                id: state.units[i],
                kind: 'ACTIVITY',
                target: state.activities[i],
                title: m.title + '报告',
              })),
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
            title: '直流与RC自动模拟实验',
            description: '固定模型服务器计算→本人结论→提交→教师评价；不是仪器实测。',
            opensAt: null,
            closesAt: null,
          },
          'classroom',
        )
      ).id;
      await save();
    }
    if (!state.classPublished) {
      await send(
        learning + '/classrooms',
        teacher,
        { type: 'PUBLISH_CLASSROOM', id: state.classroom, revision: '1' },
        'classroom-publish',
      );
      state.classPublished = true;
      await save();
    }
    if (!state.plan) {
      const steps: FlowStep[] = simulationModels.map((m, i) => ({
        id: state.steps[i],
        title: m.title + '模拟实验',
        kind: 'LAB',
        target: state.activities[i],
        version: '1',
        interactiveId: null,
        publicationId: null,
        requires: [],
        lab: {
          instructions: m.formula,
          parameters: structuredClone(m.parameters),
          measurements: structuredClone(m.measurements),
          conclusionPrompt: '比较不同参数的计算结果，解释理想模型与真实测量的差别。',
          execution: { source: SIMULATION_SOURCE, model: m.id },
        },
      }));
      await send(
        flow,
        teacher,
        { type: 'SAVE_PLAN', classroomId: state.classroom, revision: '0', steps },
        'plan',
      );
      const plan = await send(
        flow,
        teacher,
        { type: 'PUBLISH_PLAN', classroomId: state.classroom, revision: '1' },
        'plan-publish',
      );
      state.plan = true;
      state.planVersion = plan.planVersion;
      await save();
    }
    const teacherUrl = `${meta.origin}/zhiban/teacher/courses/${state.course}/classroom-plan?space=${tenant}&offering=${o}#classroom-${state.classroom}`;
    const studentUrl = `${meta.origin}/zhiban/student/courses/${state.course}/classroom-plan?space=${tenant}&offering=${o}#classroom-${state.classroom}`;
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const context = await browser.newContext();
      await context.addCookies([
        {
          name: teacher.cookie.split('=')[0],
          value: teacher.cookie.split('=').slice(1).join('='),
          url: meta.origin,
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
        },
      ]);
      const page = await context.newPage();
      await page.goto(teacherUrl);
      await expect(page.getByRole('button', { name: '按教案开始课堂', exact: true })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /直流欧姆定律模拟实验/ }).first(),
      ).toBeVisible();
      await page.screenshot({
        path: 'docs/v2/evidence/simulation/default-teacher.png',
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
    const after = await snapshot();
    await writeFile(
      'docs/v2/evidence/simulation/default-seed-preserved-after.json',
      JSON.stringify(after, null, 2) + '\n',
    );
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
      'docs/v2/evidence/simulation/default-entry.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          at: new Date().toISOString(),
          scope:
            'ADDITIVE_FIXED_MODEL_SIMULATION_DEMO_NO_RUNS_PRECREATED_WITH_PRIOR_ROWS_AND_ACCOUNTS_PRESERVED',
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
