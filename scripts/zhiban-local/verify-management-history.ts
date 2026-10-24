import {
  membershipId,
  tenantId,
  roleGrantId,
  instant,
} from '../../lib/zhiban/domain/identity/index';
import { tenantScopeContext } from '../../lib/zhiban/application/identity/ports/tenant-context';
import type { PostgresMembershipRepository } from '../../lib/zhiban/infrastructure/identity/postgres/repositories/membership';
/** LOCAL synthetic history plus real acknowledged operations; no real cluster or credentials. */
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { expect, type Browser } from '@playwright/test';
import { v7 } from 'uuid';
import type { IdentityIds } from '../../lib/zhiban/infrastructure/identity/composition/ids';
type Actor = {
  uid: ReturnType<IdentityIds['nextUserId']>;
  password: string;
  member: string;
  grant: string;
  tenant: string;
  cookie?: string;
  csrf?: string;
};
type Http = (
  path: string,
  a?: Actor,
  payload?: unknown,
  method?: string,
  extra?: Record<string, string>,
) => Promise<{ status: number; json: unknown }>;
type Row = {
  id: string;
  actor_id: string;
  actor_name: string | null;
  event_type: string;
  occurred_at: string;
  target_id: string | null;
  object_code: string | null;
  object_name: string | null;
};
type Page = { rows: Row[]; nextCursor: string | null };
export async function verifyManagementHistory(input: {
  members: PostgresMembershipRepository;
  browser: Browser;
  admin: Pool;
  actors: Actor[];
  http: Http;
  tenant: string;
  otherTenant: string;
  origin: string;
  record: (s: string) => void;
}) {
  const { browser, admin, actors, http, tenant: t, otherTenant, origin, record } = input;
  const [teacher, student, peer, foreign, manager] = actors,
    base = `/api/zhiban/management/${t}`;
  await admin.query(
    'INSERT INTO zhiban_academic.people VALUES($1,$2,$3) ON CONFLICT(tenant_id,membership_id) DO UPDATE SET display_name=excluded.display_name',
    [t, manager.member, '历史管理员甲'],
  );
  const day = Date.parse('2026-10-10T00:00:00.000Z'),
    sentinel = 'DO_NOT_EXPOSE_PRIVATE_AUDIT_FACTS',
    literal = '历史%_字面<img src=x onerror=alert(1)>';
  // Explicit synthetic historical events exercise tied timestamps and reversed ID/time ordering.
  const seed = Array.from({ length: 620 }, (_, i) => ({
    id: v7(),
    key: 'LOCAL_HISTORY_SEED_' + i,
    at: day + Math.floor((619 - i) / 3),
    code: 'HIST' + i,
    name: i === 619 ? literal : '历史课程' + String(i).padStart(4, '0'),
  }));
  for (const tid of [t, otherTenant])
    await admin.query(
      `WITH receipts AS (INSERT INTO zhiban_academic.commands(tenant_id,command_key,actor_id,payload_digest,completed_at)
    SELECT $1,r.key,$2,repeat('a',64),r.at FROM jsonb_to_recordset($3::jsonb) AS r(key text,at bigint) RETURNING command_key)
    INSERT INTO zhiban_academic.audit_events(tenant_id,id,actor_id,command_key,event_type,occurred_at,facts)
    SELECT $1,r.id,$2,r.key,'CREATE_COURSE',r.at,jsonb_build_object('before',jsonb_build_object('private',$4::text),'command',jsonb_build_object('type','CREATE_COURSE','code',r.code,'name',r.name,'description',$4::text,'ownerMembershipId',NULL)) FROM jsonb_to_recordset($3::jsonb) AS r(id uuid,key text,at bigint,code text,name text) JOIN receipts ON receipts.command_key=r.key`,
      [tid, tid === t ? manager.member : foreign.member, JSON.stringify(seed), sentinel],
    );
  const read = async (params: Record<string, string> = {}, a = manager, tenant = t) => {
    const r = await http(
      `/api/zhiban/management/${tenant}/history?` + new URLSearchParams(params),
      a,
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Page;
  };
  const count = async () =>
    Number(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1',
          [t],
        )
      ).rows[0].n,
    );
  const command = (payload: unknown, key = v7()) =>
    http(`${base}/commands`, manager, payload, 'POST', { 'x-zhiban-command': key });
  const expected = [...seed]
      .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
      .map((r) => r.id),
    seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await read({ limit: '50', ...(cursor ? { cursor } : {}) });
    assert.ok(page.rows.length <= 50);
    seen.push(...page.rows.map((r) => r.id));
    cursor = page.nextCursor;
    for (const r of page.rows)
      assert.deepEqual(
        Object.keys(r).sort(),
        [
          'id',
          'actor_id',
          'actor_name',
          'event_type',
          'occurred_at',
          'target_id',
          'object_code',
          'object_name',
          'member_id',
          'member_name',
        ].sort(),
      );
    assert.ok(!JSON.stringify(page).includes(sentinel));
    assert.ok(!JSON.stringify(page).includes('LOCAL_HISTORY_'));
  } while (cursor);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, 620);
  assert.equal(await count(), 620);
  record(
    '620 synthetic historical records traverse exact timestamp/ID descending order including ties beyond 500; bounded projection excludes facts/before/command keys and performs no audit writes',
  );
  assert.equal((await read({ from: '2026-10-10', through: '2026-10-10' })).rows.length, 20);
  assert.equal((await read({ from: '2026-10-11' })).rows.length, 0);
  assert.equal((await read({ through: '2026-10-09' })).rows.length, 0);
  assert.equal((await read({ q: literal })).rows[0].object_name, literal);
  assert.equal((await read({ q: seed[0].id.toUpperCase() })).rows[0].id, seed[0].id);
  assert.equal((await read({ q: manager.member })).rows.length, 20);
  assert.equal((await read({ q: '历史管理员甲' })).rows.length, 20);
  assert.equal((await read({ event: 'WITHDRAW' })).rows.length, 0);
  assert.equal((await read({ q: '没有匹配的历史' })).rows.length, 0);
  record(
    'UTC inclusive date bounds, current actor-name/member/event-ID and literal object search, event filters and empty results work',
  );
  for (const a of [teacher, student, foreign])
    assert.equal((await http(`${base}/history`, a)).status, 403);
  assert.equal((await http(`${base}/history`)).status, 401);
  const first = await read({ limit: '10' });
  for (const params of [
    { limit: '500' },
    { state: 'ACTIVE' },
    { event: 'LOGIN' },
    { from: '2026-02-30' },
    { through: '2026-1-1' },
    { from: '2026-10-11', through: '2026-10-10' },
    { from: '' },
    { offering: v7() },
    { q: 'x'.repeat(121) },
    { limit: '10', cursor: first.nextCursor!, event: 'EDIT_COURSE' },
    { limit: '10', cursor: first.nextCursor!, q: '其他' },
    { limit: '10', cursor: first.nextCursor!, through: '2026-10-10' },
  ] as Record<string, string>[])
    assert.equal(
      (await http(`${base}/history?` + new URLSearchParams(params), manager)).status,
      400,
    );
  assert.equal((await http(`${base}/history?q=x&q=y`, manager)).status, 400);
  assert.equal(
    (await http(`${base}/history?limit=10&cursor=${first.nextCursor}`, peer)).status,
    400,
  );
  assert.equal(
    (
      await http(
        `/api/zhiban/management/${otherTenant}/history?limit=10&cursor=${first.nextCursor}`,
        foreign,
      )
    ).status,
    400,
  );
  assert.equal((await http(`${base}/history`, manager, {}, 'POST')).status, 405);
  assert.equal((await read({}, foreign, otherTenant)).rows[0].actor_id, foreign.member);
  assert.equal(await count(), 620);
  record(
    'anonymous/non-admin/cross-space and actor/tenant/filter-bound cursors refuse; invalid UTC dates, limits, duplicate query and history POST reject without writes',
  );
  const scope = tenantScopeContext(tenantId(t)),
    loaded = await input.members.findById(scope, membershipId(peer.member));
  assert.ok(loaded);
  await input.members.save(
    scope,
    loaded.value.revokeGrant({
      grantId: roleGrantId(peer.grant),
      expectedAuthorizationVersion: loaded.value.authorizationVersion,
      now: instant(Date.now()),
    }),
    loaded.revision,
  );
  assert.equal((await http(`${base}/history`, peer)).status, 403);
  record(
    'revoking an existing administrator grant blocks subsequent history reads under the current Identity guard',
  );
  const payload = {
      type: 'CREATE_COURSE',
      code: 'HIST_REAL',
      name: '实际命令记录课程',
      description: sentinel,
      ownerMembershipId: null,
    },
    key = v7();
  assert.equal((await command(payload, key)).status, 200);
  assert.equal((await command(payload, key)).status, 200);
  assert.equal((await command(payload)).status, 409);
  assert.equal(await count(), 621);
  const course = (
    await admin.query(
      "SELECT id,revision FROM zhiban_academic.courses WHERE tenant_id=$1 AND code='HIST_REAL'",
      [t],
    )
  ).rows[0];
  assert.equal(
    (
      await command({
        type: 'EDIT_COURSE',
        id: course.id,
        revision: String(course.revision),
        name: '修改后的课程',
        description: sentinel,
        ownerMembershipId: null,
      })
    ).status,
    200,
  );
  const edits = await read({ q: course.id, event: 'EDIT_COURSE' });
  assert.equal(edits.rows.length, 1);
  assert.equal(edits.rows[0].target_id, course.id);
  assert.equal(edits.rows[0].object_name, '修改后的课程');
  assert.ok(!JSON.stringify(edits).includes(sentinel));
  const next = await read({ limit: '10', cursor: first.nextCursor! });
  assert.ok(!next.rows.some((r) => r.id === edits.rows[0].id));
  assert.equal((await read()).rows[0].id, edits.rows[0].id);
  record(
    'real CREATE/EDIT commands appear after COMMIT; same-key replay and failed duplicate create add no history; new records appear on refresh without shifting an older continuation',
  );
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: manager.cookie!.split('=')[0],
      value: manager.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage();
  await page.clock.install();
  const errors: string[] = [],
    paths: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => paths.push(new URL(r.url()).pathname));
  await page.goto(origin + `/zhiban?space=${t}`);
  await page.getByRole('button', { name: '操作历史', exact: true }).click();
  await expect(page.locator('.management-list > article')).toHaveCount(20);
  await expect(page.locator('.management-list > article').first()).toContainText('编辑课程');
  assert.equal(await page.locator('.management-list button').count(), 0);
  assert.equal(await page.getByLabel('新建课程', { exact: true }).count(), 0);
  await page
    .getByRole('navigation', { name: '操作历史分页' })
    .getByRole('button', { name: '下一页', exact: true })
    .click();
  await expect(page.getByText('第 2 页 · 本页 20 条', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '操作历史分页' })
    .getByRole('button', { name: '上一页', exact: true })
    .click();
  await expect(page.locator('.management-list > article').first()).toContainText('编辑课程');
  await page.getByLabel('每页条数', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.management-list > article')).toHaveCount(10);
  await page.getByLabel('操作类型', { exact: true }).selectOption('CREATE_COURSE');
  await page.getByLabel('开始日期（UTC）', { exact: true }).fill('2026-10-10');
  await page.getByLabel('结束日期（UTC）', { exact: true }).fill('2026-10-10');
  await page.getByLabel('搜索操作历史', { exact: true }).fill(literal);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.management-list > article')).toHaveCount(1);
  await expect(page.locator('.management-list')).toContainText(literal);
  assert.equal(await page.locator('.management-list img').count(), 0);
  assert.ok(!paths.some((p) => p.startsWith('/api/zhiban/academic/')));
  const rechecked = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/zhiban/workspace/${t}/courses`,
  );
  await page.clock.fastForward(60001);
  await rechecked;
  await expect(page.getByLabel('搜索操作历史', { exact: true })).toHaveValue(literal);
  record(
    'inline admin history paginates, filters event/date/literal text safely and survives qualified periodic refresh; no mutation controls or snapshot fallback',
  );
  await page.route(
    `**${base}/history?**`,
    (r) =>
      r.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: '刷新本页', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试操作历史', exact: true })).toBeVisible();
  await expect(page.locator('.management-list')).toHaveCount(0);
  await page.getByRole('button', { name: '重试操作历史', exact: true }).click();
  await expect(page.locator('.management-list > article')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  record(
    'failed history read removes stale records and retries with retained filters; 390px layout and scripts pass',
  );
  // Delay a read, switch the mounted root, then release; stale completion cannot refill the new view.
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  await page.route(
    `**${base}/history?**`,
    async (r) => {
      entered();
      await gate;
      await r.continue().catch(() => {});
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '刷新本页', exact: true }).click();
  await started;
  // Space switch is outside the disabled management controls and destroys the old component.
  await page.getByRole('button', { name: 'analytics analytics', exact: true }).click();
  release();
  await expect(page.getByLabel('搜索教学班', { exact: true })).toBeVisible();
  await expect(page.getByLabel('搜索操作历史', { exact: true })).toHaveCount(0);
  record(
    'destroying the management root while history is delayed discards stale results and filters',
  );
  await page.getByRole('button', { name: '操作历史', exact: true }).click();
  await expect(page.locator('.management-list > article')).toHaveCount(20);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录智伴', exact: true })).toBeVisible();
  await expect(page.locator('.management-list')).toHaveCount(0);
  assert.equal((await http(`${base}/history`, manager)).status, 401);
  assert.equal(await count(), 622);
  record(
    'logout clears history and filters, denies direct reads, and all read/negative journeys leave audit count unchanged',
  );
  await context.close();
}
