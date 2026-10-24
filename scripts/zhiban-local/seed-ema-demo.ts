/** Add a bounded six-dimension/EMA demonstration through real APIs to the private synthetic trial. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { chromium, expect } from '@playwright/test';
import { privateEntry, localRoot } from './persistent-snapshot';
import { trustedDevelopmentCa } from './config';
type Row = QueryResultRow;
const hash = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
async function main() {
  const m = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  assert.equal(m.evidenceOrigin, 'LOCAL');
  assert.equal(m.githubActions, false);
  assert.equal(m.status, 'RUNNING_LOCAL_PERSISTENT');
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  assert.equal(m.ema.enabled, true);
  localRoot(m.root);
  await privateEntry(m.root, true);
  await privateEntry(m.accountsPath);
  const original = await readFile(m.accountsPath),
    a = JSON.parse(original.toString());
  assert.equal(a.scope, 'LOCAL_SYNTHETIC_TRIAL');
  const ca = await trustedDevelopmentCa(),
    db = new Pool({
      host: join(m.root, 'socket'),
      port: 56517,
      user: 'postgres',
      database: m.database,
      max: 1,
    }),
    tenant = m.trial.tenantId,
    o = m.trial.offeringId;
  type Actor = { cookie: string; csrf: string; member: string };
  const call = (path: string, actor?: Actor, command?: unknown, key?: string) =>
    new Promise<{ status: number; json: Row; cookie: string }>((done, reject) => {
      const r = request(
        m.origin + path,
        {
          ca,
          method: command ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(actor ? { cookie: actor.cookie } : {}),
            ...(command
              ? {
                  origin: m.origin,
                  'content-type': 'application/json',
                  ...(key ? { 'x-zhiban-command': key } : {}),
                  ...(actor ? { 'x-zhiban-csrf': actor.csrf } : {}),
                }
              : {}),
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on('data', (b) => parts.push(b));
          res.on('end', () => {
            try {
              done({
                status: res.statusCode!,
                json: JSON.parse(Buffer.concat(parts).toString()),
                cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '',
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      r.setTimeout(15000, () => r.destroy(Error('LOCAL HTTPS timeout')));
      r.on('error', reject);
      r.end(command ? JSON.stringify(command) : undefined);
    });
  const login = async (role: string) => {
    const x = a.accounts.find((a: Row) => a.role === role);
    assert.ok(x);
    const r = await call('/api/zhiban/identity/login', undefined, {
      userId: x.userId,
      password: x.password,
    });
    assert.equal(r.status, 200);
    const [member] = (
      await db.query(
        'SELECT membership_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND user_id=$2',
        [tenant, x.userId],
      )
    ).rows;
    assert.ok(member);
    const actor = { cookie: r.cookie, csrf: '', member: member.membership_id };
    actor.csrf = (await call('/api/zhiban/identity/csrf', actor)).json.csrfToken;
    return actor;
  };
  const teachingSnapshot = async () => {
    const tables = (
      await db.query(
        "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('zhiban_academic','zhiban_learning','zhiban_assessment','zhiban_curriculum','zhiban_classroom','zhiban_flow') ORDER BY schemaname,tablename",
      )
    ).rows;
    const all: Record<string, string[]> = {};
    for (const t of tables) {
      assert.match(t.schemaname, /^[a-z_]+$/);
      assert.match(t.tablename, /^[a-z_]+$/);
      const rows = await db.query(
        `SELECT to_jsonb(r) AS row FROM ${t.schemaname}.${t.tablename} r`,
      );
      all[t.schemaname + '.' + t.tablename] = rows.rows
        .map((x) => hash(JSON.stringify(x.row)))
        .sort();
    }
    return all;
  };
  const statePath = join(m.root, 'ema-demo-inputs.json');
  let state: Row;
  try {
    await privateEntry(statePath);
    state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.kind, 'LOCAL_EMA_DEMO_V1');
    assert.equal(state.offeringId, o);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    state = { kind: 'LOCAL_EMA_DEMO_V1', offeringId: o };
  }
  const save = () => writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  try {
    assert.equal(
      (await db.query("SELECT current_setting('server_version_num')::int/10000 AS v")).rows[0].v,
      16,
    );
    const [offering] = (
      await db.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [tenant, o],
      )
    ).rows;
    assert.ok(offering);
    const before = await teachingSnapshot(),
      teacher = await login('TEACHER'),
      student = await login('STUDENT'),
      base = `/api/zhiban/ema/${tenant}/offerings/${o}`;
    const send = async (command: unknown, operation: string) => {
      const r = await call(
        base,
        teacher,
        command,
        hash([tenant, o, 'ema-demo-v1', operation].join(':')),
      );
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json;
    };
    const learner = `/api/zhiban/learner/${tenant}/offerings/${o}`;
    const get = async (path: string, actor = teacher) => {
      const r = await call(path, actor);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json;
    };
    const studentOverview = await get(learner + '?mode=STUDENT', student);
    const enrollment = studentOverview.enrollment.id;
    const evidence = await get(learner + '?mode=TEACHER&view=EVIDENCE&enrollment=' + enrollment);
    const grade = evidence.rows.find((r: Row) => r.kind === 'GRADE');
    assert.ok(grade);
    const ref = (s: Row) => ({ kind: s.kind, id: s.id, digest: s.digest });
    // A public task-specific teacher observation supplies evidence beyond a lone grade.
    const concept = `/api/zhiban/concept/${tenant}/offerings/${o}`;
    const conceptSend = async (c: unknown, operation: string) => {
      const r = await call(
        concept,
        teacher,
        c,
        hash([tenant, o, 'ema-demo-v1', operation].join(':')),
      );
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json;
    };
    if (!state.conceptId) {
      const sources = await get(concept + '?mode=TEACHER&view=SOURCES');
      const cs = sources.rows.find((s: Row) => s.publication_id === grade.id);
      assert.ok(cs);
      state.conceptId = (
        await conceptSend(
          {
            type: 'CREATE_CORRECTION',
            publicationId: cs.publication_id,
            questionId: '',
            expectedDigest: cs.digest,
            concept: '安全检查说明的本次观察',
            explanation:
              'LOCAL合成课堂演示：本次作答已能说明先断电确认安全、按检查表记录异常；复核依据仍需补充。仅限本次说明，不代表稳定操作能力。',
            guidance: '下一次区分观察与推断，补充复核依据。',
            privateNote: 'LOCAL演示的教师私有备注，不进入EMA。',
          },
          'concept-create',
        )
      ).id;
      await save();
    }
    if (!state.conceptPublished) {
      const cd = await get(concept + '?mode=TEACHER&view=DETAIL&id=' + state.conceptId);
      if (cd.record?.state === 'DRAFT' || !cd.record?.published_revision) {
        await conceptSend(
          {
            type: 'PUBLISH_CORRECTION',
            id: state.conceptId,
            revision: cd.record.revision,
            expectedDigest: cd.current.digest,
          },
          'concept-publish',
        );
      }
      state.conceptPublished = true;
      await save();
    }
    const publicSources = await get(
      learner + '?mode=TEACHER&view=EVIDENCE&enrollment=' + enrollment + '&kind=CONCEPT',
    );
    const source = publicSources.rows.find((s: Row) => s.id === state.conceptId);
    assert.ok(source);
    if (!state.jobId) {
      state.jobId = (
        await send(
          {
            type: 'QUEUE',
            enrollmentId: enrollment,
            purpose:
              'LOCAL演示：对公开的本次教师概念观察和正式任务记录进行六维证据覆盖分析；其他维度无依据时明确不判断。',
            dueAt: null,
            evidence: [ref(grade), ref(source)],
          },
          'queue',
        )
      ).id;
      await save();
    }
    const detail = () => get(base + '?mode=TEACHER&view=JOB&id=' + state.jobId);
    let job = await detail();
    if (job.job.state === 'QUEUED')
      await send({ type: 'RUN', id: state.jobId, revision: job.job.revision }, 'run');
    const deadline = Date.now() + 110000;
    do {
      job = await detail();
      if (job.job.state !== 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 700));
    } while (Date.now() < deadline);
    assert.equal(
      job.job.state,
      'READY',
      JSON.stringify({ state: job.job.state, failure: job.job.failure }),
    );
    // Do not force a model to manufacture a supported dimension. Only a cited LIMITED finding can be adopted.
    const finding = job.job.result.find((f: Row) => f.state === 'LIMITED' && f.evidence.length > 0);
    if (finding && !state.noteId) {
      const r = await send(
        {
          type: 'ADOPT',
          id: state.jobId,
          revision: job.job.revision,
          dimension: finding.dimension,
          text: {
            title: '六维演示：本次公开观察',
            body: finding.observation,
            confidence: 'LIMITED',
            evidence: finding.evidence.map((i: number) => ref(job.job.evidence[i - 1])),
          },
          reason: 'LOCAL合成课堂演示，教师核对公开观察，只采用本次任务范围。',
        },
        'adopt',
      );
      state.noteId = r.noteId;
      await save();
    }
    if (state.noteId && !state.published) {
      const n = await get(learner + '?mode=TEACHER&view=NOTE&id=' + state.noteId);
      if (n.record.state === 'DRAFT') {
        const r = await call(
          learner,
          teacher,
          {
            type: 'PUBLISH_OBSERVATION',
            id: state.noteId,
            revision: n.record.revision,
            expectedDigest: n.evidence.digest,
          },
          hash([tenant, o, 'ema-demo-v1', 'publish'].join(':')),
        );
        assert.equal(r.status, 200, JSON.stringify(r.json));
      }
      state.published = true;
      await save();
    }
    job = await detail();
    for (const f of job.job.result) {
      if (job.reviews.some((r: Row) => r.dimension === f.dimension)) continue;
      await send(
        {
          type: 'REJECT',
          id: state.jobId,
          revision: job.job.revision,
          dimension: f.dimension,
          reason: '演示仅采用有引用的本次观察；其他维度不据此形成学习判断。',
        },
        'reject-' + f.dimension,
      );
      job = await detail();
    }
    const urls = {
      teacher: `${m.origin}/zhiban/teacher/courses/${offering.course_id}/evidence-profile?space=${tenant}&offering=${o}#student-${enrollment}`,
      student: `${m.origin}/zhiban/student/courses/${offering.course_id}/evidence-profile?space=${tenant}&offering=${o}`,
    };
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
      errors: string[] = [];
    try {
      for (const [role, url] of Object.entries(urls)) {
        const actor = role === 'teacher' ? teacher : student,
          context = await browser.newContext(),
          [name, ...rest] = actor.cookie.split('=');
        await context.addCookies([
          {
            name,
            value: rest.join('='),
            url: m.origin,
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
          },
        ]);
        const page = await context.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(url);
        await expect(
          page.getByRole('heading', { name: '六维证据画像与 EMA', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { name: '沟通协作', exact: true })).toBeVisible();
        if (role === 'student')
          await expect(page.getByRole('button', { name: 'EMA 分析作业', exact: true })).toHaveCount(
            0,
          );
        await page.screenshot({ path: `docs/v2/evidence/ema/default-${role}.png`, fullPage: true });
        await context.close();
      }
    } finally {
      await browser.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await teachingSnapshot(), before);
    assert.equal(hash(await readFile(m.accountsPath)), hash(original));
    await writeFile(
      'docs/v2/evidence/ema/default-entry.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          at: new Date().toISOString(),
          scope:
            'ADDITIVE_PUBLIC_TEACHER_CONCEPT_NATIVE_EMA_AND_SIX_DIMENSION_DEMO_CORE_TEACHING_DATA_AND_ACCOUNTS_PRESERVED',
          jobId: state.jobId,
          noteId: state.noteId ?? null,
          actualModel: job.job.model,
          offeringId: o,
          urls,
          originalAccountsUnchanged: true,
          preexistingTeachingRows: Object.values(before).reduce((n, x) => n + x.length, 0),
          unattendedDispatch: false,
          numericAbilityScores: false,
          browserErrors: errors,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'PASS LOCAL EMA real native model and teacher review, optional cited adoption/publication, six-dimension/student pages; original accounts and core teaching rows preserved',
    );
  } finally {
    await db.end();
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'LOCAL EMA demo setup failed');
  process.exitCode = 1;
});
