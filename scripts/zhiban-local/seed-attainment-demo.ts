/** One-time LOCAL synthetic default-host demo. Existing accounts and unrelated teaching records are retained. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { Pool, type QueryResultRow } from 'pg';
import { v7 } from 'uuid';
import { chromium, expect } from '@playwright/test';
type Row = QueryResultRow;
type Actor = { cookie: string; csrf: string; member: string };
import { join } from 'node:path';
import { trustedDevelopmentCa } from './config';
import { privateEntry, localRoot } from './persistent-snapshot';
async function main() {
  const m = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  assert.equal(m.evidenceOrigin, 'LOCAL');
  assert.equal(m.status, 'RUNNING_LOCAL_PERSISTENT');
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  assert.equal(m.attainment.enabled, true);
  assert.equal(m.autograde.enabled, true);
  assert.match(m.root, /^\/tmp\/zhiban-trial-content-[A-Za-z0-9]+$/);
  localRoot(m.root);
  await privateEntry(m.root, true);
  assert.equal(m.accountsPath, join(m.root, 'accounts.json'));
  await privateEntry(m.accountsPath);
  const accountsBytes = await readFile(m.accountsPath),
    accounts = JSON.parse(accountsBytes.toString());
  assert.equal(accounts.scope, 'LOCAL_SYNTHETIC_TRIAL');
  const ca = await trustedDevelopmentCa(),
    db = new Pool({
      host: join(m.root, 'socket'),
      port: 56517,
      database: m.database,
      user: 'postgres',
      max: 1,
    }),
    t = m.trial.tenantId,
    hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
  const stateFile = join(m.root, 'attainment-demo-state.json');
  const state: Row = JSON.parse(await readFile(stateFile, 'utf8').catch(() => '{}'));
  const save = () => writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  const call = (path: string, actor?: Actor, c?: unknown, key?: string) =>
    new Promise<{ status: number | undefined; json: Row; cookie: string }>((resolve, reject) => {
      const r = request(
        m.origin + path,
        {
          ca,
          method: c ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(actor ? { cookie: actor.cookie } : {}),
            ...(c
              ? {
                  origin: m.origin,
                  'content-type': 'application/json',
                  'x-zhiban-command': key ?? v7(),
                  ...(actor ? { 'x-zhiban-csrf': actor.csrf } : {}),
                }
              : {}),
          },
        },
        (res) => {
          const p: Buffer[] = [];
          res.on('data', (b) => p.push(b));
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode,
                json: JSON.parse(Buffer.concat(p).toString()),
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
      r.end(c ? JSON.stringify(c) : undefined);
    });
  const login = async (role: string) => {
    const a = accounts.accounts.find((x: Row) => x.role === role);
    assert.ok(a);
    const r = await call('/api/zhiban/identity/login', undefined, {
      userId: a.userId,
      password: a.password,
    });
    assert.equal(r.status, 200);
    const [id] = (
      await db.query(
        'SELECT membership_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND user_id=$2',
        [t, a.userId],
      )
    ).rows;
    const actor = { cookie: r.cookie, csrf: '', member: id.membership_id };
    actor.csrf = (await call('/api/zhiban/identity/csrf', actor)).json.csrfToken;
    return actor;
  };
  const send = async (path: string, c: unknown, a: Actor, key: string) => {
    const r = await call(path, a, c, hash('ATTAINMENT_DEMO_20261024:' + key).slice(0, 48));
    assert.equal(r.status, 200, JSON.stringify({ key, response: r.json }));
    return r.json;
  };
  const read = async (path: string, a: Actor) => {
    const r = await call(path, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  try {
    const manager = await login('ADMIN'),
      teacher = await login('TEACHER'),
      student = await login('STUDENT'),
      management = `/api/zhiban/management/${t}/commands`;
    const find = async (table: string, code: string) =>
      (
        await db.query(
          `SELECT id,revision::text FROM zhiban_academic.${table} WHERE tenant_id=$1 AND code=$2`,
          [t, code],
        )
      ).rows[0];
    if (!state.course) {
      await send(
        management,
        {
          type: 'CREATE_COURSE',
          code: 'ATTAINMENT_DEMO_20261024',
          name: '校内成果与 AI 正式评分演示',
          description: '本地合成试用；教师显式启用 AI 服务正式评分，管理员受控认定跨班课程学分。',
          ownerMembershipId: teacher.member,
        },
        manager,
        'course',
      );
      const c = await find('courses', 'ATTAINMENT_DEMO_20261024');
      await send(
        management,
        { type: 'PUBLISH_COURSE', id: c.id, revision: c.revision },
        manager,
        'course-publish',
      );
      state.course = c.id;
      await save();
    }
    if (!state.term) {
      await send(
        management,
        {
          type: 'CREATE_TERM',
          code: 'ATTAINMENT_TERM',
          name: '校内成果演示学期',
          startsOn: '2026-10-01',
          endsOn: '2027-02-01',
        },
        manager,
        'term',
      );
      state.term = (await find('terms', 'ATTAINMENT_TERM')).id;
      await save();
    }
    state.classes ??= [];
    for (let i = 0; i < 2; i++) {
      const label = 'class-' + i;
      let f = state.classes[i];
      if (!f) {
        await send(
          management,
          {
            type: 'CREATE_OFFERING',
            code: 'ATTAINMENT_DEMO_' + i,
            name: i === 0 ? 'AI 正式评分与证书演示班' : '跨班学分认定演示班',
            courseId: state.course,
            termId: state.term,
            classId: null,
            capacity: 30,
          },
          manager,
          label,
        );
        f = { id: (await find('offerings', 'ATTAINMENT_DEMO_' + i)).id };
        state.classes[i] = f;
        await save();
      }
      if (!f.members) {
        await send(
          management,
          {
            type: 'ASSIGN_TEACHER',
            offeringId: f.id,
            membershipId: teacher.member,
            revision: null,
          },
          manager,
          label + '-teacher',
        );
        await send(
          management,
          { type: 'ENROLL', offeringId: f.id, membershipId: student.member, revision: null },
          manager,
          label + '-student',
        );
        f.members = true;
        await save();
      }
      const l = `/api/zhiban/learning/${t}/offerings/${f.id}`,
        a = `/api/zhiban/assessment/${t}/offerings/${f.id}`,
        auto = `/api/zhiban/autograde/${t}/offerings/${f.id}`;
      if (!f.activity) {
        f.activity = await send(
          l,
          {
            type: 'CREATE_ACTIVITY',
            title: i === 0 ? 'AI 服务正式评分：安全维护步骤' : '跨班核验：维护记录与复核',
            prompt: '说明断电、确认隔离、记录异常和复核的维护流程。',
            deadlineAt: null,
            allowResubmit: true,
            maxAttempts: 3,
          },
          teacher,
          label + '-activity',
        );
        await save();
      }
      if (!f.published) {
        await send(
          l,
          { type: 'PUBLISH_ACTIVITY', id: f.activity.id, revision: f.activity.revision },
          teacher,
          label + '-publish',
        );
        f.published = true;
        await save();
      }
      if (i === 0 && !f.policy) {
        f.policy = await send(
          auto,
          {
            type: 'ENABLE',
            activityId: f.activity.id,
            revision: '1',
            activityVersion: 1,
            rubric:
              '按本次作答固定规则评分：先断电20分，验证隔离30分，记录异常与说明依据25分，复核25分。仅依据实际作答；简短说明各项依据。',
            maxPoints: 10000,
          },
          teacher,
          label + '-policy',
        );
        await save();
      }
      if (!f.submission) {
        const at = await send(
          l,
          { type: 'START_ATTEMPT', id: f.activity.id },
          student,
          label + '-attempt',
        );
        f.submission = await send(
          l,
          {
            type: 'SUBMIT',
            id: at.id,
            revision: at.revision,
            answer:
              '先断电挂牌，验证断电并确认隔离。随后按检查表记录每项结果和异常，说明依据，处理后复核并签记。',
          },
          student,
          label + '-submit',
        );
        await save();
      }
      if (!f.grade) {
        if (i === 0) {
          let j;
          for (let n = 0; n < 110; n++) {
            j = (
              await db.query(
                'SELECT id,state,failure,publication_id,result FROM zhiban_autograde.jobs WHERE tenant_id=$1 AND submission_id=$2 ORDER BY created_at DESC LIMIT 1',
                [t, f.submission.submissionId],
              )
            ).rows[0];
            if (j && j.state !== 'RUNNING') break;
            await new Promise((r) => setTimeout(r, 1000));
          }
          assert.equal(
            j?.state,
            'APPLIED',
            JSON.stringify({ state: j?.state, failure: j?.failure }),
          );
          f.grade = j;
        } else {
          const g = await send(
            a,
            {
              type: 'SAVE_GRADE',
              submissionId: f.submission.submissionId,
              revision: null,
              score: '94',
              maxScore: '100',
              feedback: '教师复核正式发布。',
            },
            teacher,
            label + '-grade',
          );
          f.grade = await send(
            a,
            {
              type: 'PUBLISH_GRADE',
              submissionId: f.submission.submissionId,
              revision: g.revision,
            },
            teacher,
            label + '-grade-publish',
          );
        }
        await save();
      }
      if (!f.total) {
        const w = await send(
          a + '/finalgrades',
          {
            type: 'SAVE_WEIGHTS',
            revision: '1',
            items: [{ activityId: f.activity.id, version: 1, weightBps: 10000 }],
          },
          teacher,
          label + '-weights',
        );
        await send(
          a + '/finalgrades',
          { type: 'PUBLISH_WEIGHTS', revision: w.revision },
          teacher,
          label + '-weights-publish',
        );
        const e = (await read(a + '/finalgrades?member=' + student.member, teacher)).preview;
        f.total = await send(
          a + '/finalgrades',
          {
            type: 'PUBLISH_TOTAL',
            memberId: student.member,
            sourceDigest: e.sourceDigest,
            previousId: null,
            reason: '教师首次明确发布本教学班总评。',
          },
          teacher,
          label + '-total',
        );
        await save();
      }
    }
    // The original Quiz player also discloses service authorship; this verifies the final presentation delta.
    const qo = state.classes[0].id,
      ql = `/api/zhiban/learning/${t}/offerings/${qo}/quizzes`,
      qb = `/api/zhiban/autograde/${t}/offerings/${qo}`;
    if (!state.quiz) {
      state.quiz = await send(
        ql,
        {
          type: 'CREATE_QUIZ',
          title: '原生测验服务评分来源',
          mode: 'ASSESSED',
          content: {
            type: 'quiz',
            questions: [
              {
                id: 'o',
                type: 'single',
                question: '维护应先断电？',
                options: [
                  { value: 'A', label: '是' },
                  { value: 'B', label: '否' },
                ],
                answer: ['A'],
                points: 2,
              },
              {
                id: 's',
                type: 'short_answer',
                question: '说明隔离、记录与复核步骤。',
                commentPrompt: '依据实际隔离、记录与复核给分。',
                points: 8,
              },
            ],
          },
          deadlineAt: null,
          allowResubmit: true,
          maxAttempts: 3,
        },
        teacher,
        'quiz-create',
      );
      await save();
    }
    if (!state.quiz.published) {
      await send(
        ql,
        { type: 'PUBLISH_QUIZ', id: state.quiz.id, revision: state.quiz.revision },
        teacher,
        'quiz-publish',
      );
      state.quiz.published = true;
      await save();
    }
    if (!state.quiz.policy) {
      await send(
        qb,
        {
          type: 'ENABLE',
          activityId: state.quiz.id,
          revision: '1',
          activityVersion: 1,
          rubric: '简答共8分，确认隔离3分，逐项记录3分，复核2分；只依据作答，不覆盖客观题。',
          maxPoints: 1000,
        },
        teacher,
        'quiz-policy',
      );
      state.quiz.policy = true;
      await save();
    }
    if (!state.quiz.submission) {
      const at = await send(
        ql,
        { type: 'START_QUIZ_ATTEMPT', activityId: state.quiz.id, expectedVersion: '1' },
        student,
        'quiz-attempt',
      );
      state.quiz.submission = await send(
        ql,
        {
          type: 'SUBMIT_QUIZ',
          attemptId: at.id,
          revision: at.revision,
          answers: { o: 'A', s: '先断电并确认隔离，再逐项检查记录异常与依据，处理后复核结果。' },
        },
        student,
        'quiz-submit',
      );
      await save();
    }
    if (!state.quiz.job) {
      let j;
      for (let n = 0; n < 110; n++) {
        j = (
          await db.query(
            'SELECT id,state,failure,publication_id,result FROM zhiban_autograde.jobs WHERE tenant_id=$1 AND submission_id=$2 ORDER BY created_at DESC LIMIT 1',
            [t, state.quiz.submission.submissionId],
          )
        ).rows[0];
        if (j && j.state !== 'RUNNING') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.equal(j?.state, 'APPLIED', JSON.stringify({ state: j?.state, failure: j?.failure }));
      assert.equal(j.result.marks.o, 200);
      state.quiz.job = j;
      await save();
    }
    const quizResult = await read(
      ql.replace('/quizzes', '/quiz-submissions') +
        '?submission=' +
        state.quiz.submission.submissionId,
      student,
    );
    assert.equal(quizResult.publications[0].published_by, null);
    const base = `/api/zhiban/attainment/${t}`,
      evidence = async (index: number) =>
        (
          await read(
            base +
              '?' +
              new URLSearchParams({
                mode: 'ADMIN',
                view: 'TOTAL',
                offering: state.classes[index].id,
                member: student.member,
              }),
            manager,
          )
        ).evidence;
    if (!state.cert) {
      const f = state.classes[0],
        e = await evidence(0),
        rule = await send(
          base,
          {
            type: 'SET_CERT_RULE',
            offeringId: f.id,
            revision: '1',
            title: '安全维护课程校内达成证明',
            threshold: 6000,
            enabled: true,
          },
          teacher,
          'cert-rule',
        );
      assert.ok(e.current);
      state.cert = await send(
        base,
        {
          type: 'ISSUE_CERT',
          offeringId: f.id,
          memberId: student.member,
          ruleRevision: rule.revision,
          totalId: e.latest.id,
          sourceDigest: e.sourceDigest,
        },
        teacher,
        'cert',
      );
      await save();
    }
    if (!state.creditRule) {
      const id = v7();
      state.creditRule = await send(
        base,
        {
          type: 'SET_CREDIT_RULE',
          id,
          revision: '1',
          sourceCourse: state.course,
          targetCourse: state.course,
          title: '安全维护跨班课程学分互认',
          creditsTenths: 15,
          threshold: 6000,
          enabled: true,
        },
        manager,
        'credit-rule',
      );
      await save();
    }
    if (!state.credit) {
      const e = await evidence(0);
      state.credit = await send(
        base,
        {
          type: 'AWARD_CREDIT',
          ruleId: state.creditRule.id,
          ruleRevision: state.creditRule.revision,
          offeringId: state.classes[0].id,
          memberId: student.member,
          totalId: e.latest.id,
          sourceDigest: e.sourceDigest,
          reason: '管理员核对第一班已发布总评，按校内课程等价规则认定。',
        },
        manager,
        'credit-first',
      );
      await save();
    }
    if (!state.crossClassDuplicateRefused) {
      const e = await evidence(1),
        r = await call(base, manager, {
          type: 'AWARD_CREDIT',
          ruleId: state.creditRule.id,
          ruleRevision: state.creditRule.revision,
          offeringId: state.classes[1].id,
          memberId: student.member,
          totalId: e.latest.id,
          sourceDigest: e.sourceDigest,
          reason: '验证第二班相同目标课程不能重复累计。',
        });
      assert.equal(r.status, 409);
      state.crossClassDuplicateRefused = true;
      await save();
    }
    const records = await read(base + '?mode=STUDENT', student);
    assert.ok(records.rows.find((r: Row) => r.id === state.cert.id && r.source.current));
    assert.ok(records.rows.find((r: Row) => r.id === state.credit.id && r.source.current));
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
      errors: string[] = [];
    const urls = {
      teacher: `/zhiban/teacher/courses/${state.course}/auto-grading?space=${t}&offering=${state.classes[0].id}`,
      student: `/zhiban/attainment?tenant=${t}&mode=STUDENT`,
      admin: `/zhiban/attainment?tenant=${t}&mode=ADMIN`,
    };
    try {
      for (const [role, actor] of [
        ['teacher', teacher],
        ['student', student],
        ['admin', manager],
      ] as const) {
        const ctx = await browser.newContext(),
          [name, ...rest] = actor.cookie.split('=');
        await ctx.addCookies([
          {
            name,
            value: rest.join('='),
            url: m.origin,
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
          },
        ]);
        const page = await ctx.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        await page.goto(m.origin + urls[role]);
        if (role === 'teacher') {
          await expect(
            page.getByRole('heading', { name: 'AI 服务正式评分：安全维护步骤', exact: true }),
          ).toBeVisible();
          await page.getByRole('button', { name: '服务任务', exact: true }).click();
          await expect(
            page
              .locator('#auto-grading')
              .getByText(/APPLIED/)
              .first(),
          ).toBeVisible();
        }
        if (role === 'student') {
          await expect(
            page.getByRole('heading', { name: '安全维护课程校内达成证明', exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole('button', { name: '打印／保存 PDF', exact: true }).first(),
          ).toBeVisible();
        }
        if (role === 'admin') {
          await expect(
            page.getByRole('heading', { name: '跨班课程学分规则', exact: true }),
          ).toBeVisible();
          await expect(page.locator('[role=alert]')).toBeEmpty();
        }
        await page.screenshot({
          path: `docs/v2/evidence/attainment/default-${role}.png`,
          fullPage: true,
        });
        if (role === 'student') {
          await page.goto(
            m.origin +
              `/zhiban/student/courses/${state.course}/coursework?space=${t}&offering=${state.classes[0].id}`,
          );
          const quizCard = page.locator('.quiz-product').filter({
            has: page.getByRole('heading', {
              name: '原生测验服务评分来源 · 正式测验',
              exact: true,
            }),
          });
          await expect(quizCard).toBeVisible();
          const review = quizCard.getByRole('button', { name: '查看本次提交与成绩', exact: true });
          if (await review.isVisible()) await review.click();
          else {
            await quizCard.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
            await expect(review).toBeVisible();
            await review.click();
          }
          await expect(quizCard.getByText(/AI 服务正式评分 · 成绩版本/)).toBeVisible();
          await page.screenshot({
            path: 'docs/v2/evidence/attainment/default-original-quiz.png',
            fullPage: true,
          });
        }
        if (role === 'teacher') {
          await page.goto(m.origin + urls.teacher);
          const policyCard = page.locator('#auto-grading section').filter({
            has: page.getByRole('heading', {
              name: 'AI 服务正式评分：安全维护步骤',
              exact: true,
            }),
          });
          const post = page.waitForResponse(
            (r) => r.request().method() === 'POST' && r.url().includes('/api/zhiban/autograde/'),
          );
          await policyCard
            .getByRole('button', { name: '启用／更新自动正式评分', exact: true })
            .click();
          assert.equal((await post).status(), 200);
          await page.goto(
            m.origin +
              `/zhiban/teacher/courses/${state.course}/attainment?space=${t}&offering=${state.classes[1].id}`,
          );
          await expect(page.getByLabel('签发开关', { exact: true })).toHaveValue('false');
          await page.getByLabel('证书名称', { exact: true }).fill('跨班演示待启用校内证明');
          const certPost = page.waitForResponse(
            (r) => r.request().method() === 'POST' && r.url().includes('/api/zhiban/attainment/'),
          );
          await page.getByRole('button', { name: '保存证书规则', exact: true }).click();
          assert.equal((await certPost).status(), 200);
          await page.reload();
          await expect(page.getByLabel('签发开关', { exact: true })).toHaveValue('false');
          await page.getByRole('button', { name: '陈同学', exact: true }).click();
          await expect(page.locator('#total-preview')).toContainText('依据有效');
          await expect(page.getByRole('button', { name: '签发校内证书', exact: true })).toHaveCount(
            0,
          );
        }
        if (role === 'admin') {
          await page.getByRole('button', { name: 'AI 正式评分与证书演示班', exact: true }).click();
          await page.getByRole('button', { name: '陈同学', exact: true }).click();
          const creditForm = page.locator('#total-preview form');
          await creditForm.getByLabel('认定说明', { exact: true }).fill('再次认定应拒绝重复累计。');
          await creditForm
            .getByRole('button', { name: '认定学分：安全维护跨班课程学分互认', exact: true })
            .click();
          await expect(page.locator('[role=alert]')).toContainText('已有有效记录');
        }
        await ctx.close();
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
    assert.equal(hash(await readFile(m.accountsPath)), hash(accountsBytes));
    await writeFile(
      'docs/v2/evidence/attainment/default-demo.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          origin: m.origin,
          root: m.root,
          tenantId: t,
          courseId: state.course,
          offerings: state.classes.map((f: Row) => f.id),
          service: {
            jobId: state.classes[0].grade.id,
            publicationId: state.classes[0].grade.publication_id,
            model: state.classes[0].grade.result.model,
          },
          quizServiceJobId: state.quiz.job.id,
          originalQuizServicePublisherNull: true,
          certificateId: state.cert.id,
          creditId: state.credit.id,
          crossClassDuplicateRefused: true,
          browserForms: {
            teacherPolicy: true,
            certificateDisabledStateRetained: true,
            adminRosterAndDuplicateRefusal: true,
          },
          accountsSha256: hash(accountsBytes),
          urls: Object.fromEntries(Object.entries(urls).map(([k, v]) => [k, m.origin + v])),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'PASS default3461 actual model formal publication -> explicit total -> school certificate/admin credit, second class duplicate refused, actual three-role pages',
    );
  } finally {
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
