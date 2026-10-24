/** Add an untouched single-learner demonstration group to the existing private synthetic course. Multi-user acceptance is separate. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { chromium, expect } from '@playwright/test';
import { privateEntry, localRoot } from './persistent-snapshot';
import { trustedDevelopmentCa } from './config';
import { projectExample } from '../../tests/zhiban/pbl/fixtures';
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
  assert.equal(m.pbl.enabled, true);
  localRoot(m.root);
  await privateEntry(m.root, true);
  await privateEntry(m.accountsPath);
  const original = await readFile(m.accountsPath),
    a = JSON.parse(original.toString());
  assert.equal(a.scope, 'LOCAL_SYNTHETIC_TRIAL');
  const flow = JSON.parse(await readFile('docs/v2/evidence/flow/default-entry.json', 'utf8'));
  assert.equal(flow.root, m.root);
  assert.equal(flow.evidenceOrigin, 'LOCAL');
  const ca = await trustedDevelopmentCa(),
    db = new Pool({
      host: join(m.root, 'socket'),
      port: 56517,
      user: 'postgres',
      database: m.database,
      max: 1,
    }),
    tenant = m.trial.tenantId,
    o = flow.offeringId;
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
  const statePath = join(m.root, 'pbl-demo-inputs.json');
  let state: Row;
  try {
    await privateEntry(statePath);
    state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.kind, 'LOCAL_PBL_DEMO_V1');
    assert.equal(state.offeringId, o);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    state = { kind: 'LOCAL_PBL_DEMO_V1', offeringId: o };
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
      base = `/api/zhiban/pbl/${tenant}/offerings/${o}`;
    const send = async (command: unknown, operation: string) => {
      const r = await call(
        base,
        teacher,
        command,
        hash([tenant, o, 'pbl-demo-v1', operation].join(':')),
      );
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json;
    };
    if (!state.projectId) {
      const design = projectExample();
      design.title = '小组协作演示：节能教室';
      state.projectId = (
        await send(
          { type: 'CREATE_PROJECT', design, deadlineAt: null, allowResubmit: true },
          'create',
        )
      ).id;
      await save();
    }
    if (!state.published) {
      await send({ type: 'PUBLISH_PROJECT', id: state.projectId, revision: '1' }, 'publish');
      state.published = true;
      await save();
    }
    if (!state.groupId) {
      state.groupId = (
        await send(
          {
            type: 'CREATE_GROUP',
            projectId: state.projectId,
            name: '陈同学演示组',
            members: [student.member],
          },
          'group',
        )
      ).id;
      await save();
    }
    const urls = {
      teacher: `${m.origin}/zhiban/teacher/courses/${offering.course_id}/pbl?space=${tenant}&offering=${o}#group-${state.groupId}`,
      student: `${m.origin}/zhiban/student/courses/${offering.course_id}/pbl?space=${tenant}&offering=${o}#group-${state.groupId}`,
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
        await expect(page.getByRole('heading', { name: '共同成果', exact: true })).toBeVisible();
        await expect(page.getByText('共享成果版本 1 · 名单版本 1', { exact: true })).toBeVisible();
        if (role === 'student')
          await expect(page.getByLabel('小组共同反思', { exact: true })).toBeEditable();
        await page.screenshot({ path: `docs/v2/evidence/pbl/default-${role}.png`, fullPage: true });
        await context.close();
      }
    } finally {
      await browser.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await teachingSnapshot(), before);
    assert.equal(hash(await readFile(m.accountsPath)), hash(original));
    await writeFile(
      'docs/v2/evidence/pbl/default-entry.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          at: new Date().toISOString(),
          scope:
            'ADDITIVE_PBL_PROJECT_AND_SINGLE_LEARNER_DEMO_ORIGINAL_TEACHING_DATA_AND_ACCOUNTS_PRESERVED',
          projectId: state.projectId,
          groupId: state.groupId,
          offeringId: o,
          urls,
          originalAccountsUnchanged: true,
          preexistingTeachingRows: Object.values(before).reduce((n, x) => n + x.length, 0),
          submitted: false,
          groupMembers: 1,
          multiUserAcceptance:
            'Separate actual four-student PG16/browser journey; this default demo uses the existing three-role account set',
          browserErrors: errors,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'PASS LOCAL PBL default teacher/student pages; original account file and teaching rows preserved; no group submission made',
    );
  } finally {
    await db.end();
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'LOCAL PBL demo setup failed');
  process.exitCode = 1;
});
