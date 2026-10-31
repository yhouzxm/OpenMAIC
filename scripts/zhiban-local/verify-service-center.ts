/** LOCAL real PG16 / Identity / HTTPS / browser; never calls an external AI provider. */
/* eslint-disable @typescript-eslint/no-explicit-any -- original native wire DTO */
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { trustedDevelopmentCa } from './config';
import type { verifyClassroomAi } from './verify-classroom-ai';
export async function verifyServiceCenter(input: Parameters<typeof verifyClassroomAi>[0]) {
  const { actors, http, tenant, origin, browser, native, record } = input,
    [teacher, student, otherManager, foreign, manager] = actors;
  const base = `/api/zhiban/service-center/${tenant}`,
    ca = await trustedDevelopmentCa();
  const wire = (
    path: string,
    data: unknown,
    command = randomUUID(),
    actor = manager,
    csrf = actor.csrf!,
    method = 'PUT',
  ) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const bytes = Buffer.from(JSON.stringify(data));
      const r = request(
        origin + path,
        {
          ca,
          method,
          headers: {
            'x-zhiban-request': 'identity-v1',
            Cookie: actor.cookie!,
            Origin: origin,
            'x-zhiban-csrf': csrf,
            'x-zhiban-command': command,
            'content-type': 'application/json',
            'content-length': bytes.length,
          },
        },
        (s) => {
          const parts: Buffer[] = [];
          s.on('data', (p) => parts.push(p));
          s.on('end', () =>
            resolve({ status: s.statusCode!, json: JSON.parse(Buffer.concat(parts).toString()) }),
          );
        },
      );
      r.on('error', reject);
      r.setTimeout(15000, () => r.destroy(Error('LOCAL center timeout')));
      r.end(bytes);
    });
  for (const actor of [teacher, student, foreign])
    assert.equal((await http(base + '/config', actor)).status, 403);
  assert.equal((await http(base + '/config', otherManager)).status, 200);
  const initial = await http(base + '/config', manager);
  assert.equal(initial.status, 200);
  let revision = (initial.json as any).revision;
  const secret = 'LOCAL-SYNTHETIC-NEVER-SENT-TO-PROVIDER',
    command = randomUUID(),
    body = {
      revision,
      change: {
        kind: 'provider',
        id: 'local-center-proof',
        preset: 'openai',
        apiKey: secret,
        models: ['gpt-4o-mini'],
      },
    };
  const saved = await wire(base + '/config', body, command);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  revision = saved.json.revision;
  assert.ok(!JSON.stringify(saved.json).includes(secret));
  assert.equal((await wire(base + '/config', body, command)).status, 200);
  assert.equal(
    (
      await wire(
        base + '/config',
        { ...body, change: { ...body.change, apiKey: 'different' } },
        command,
      )
    ).status,
    409,
  );
  const encrypted = (
    await native.query(
      'SELECT config::text,secrets::text FROM workspace_model_config WHERE owner_id=$1',
      ['zhiban-services:' + tenant],
    )
  ).rows[0];
  assert.ok(!JSON.stringify(encrypted).includes(secret));
  assert.equal(
    (
      await wire(
        base + '/config',
        { revision, change: { kind: 'slots', set: { image: null } } },
        randomUUID(),
        manager,
        'wrong',
      )
    ).status,
    403,
  );
  // Audit failure must roll back the configuration in the same native transaction.
  await native.query(
    `CREATE FUNCTION local_service_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_AUDIT_FAULT'; END $$`,
  );
  await native.query(
    'CREATE TRIGGER local_service_audit_fault BEFORE INSERT ON zhiban_service_events FOR EACH ROW EXECUTE FUNCTION local_service_audit_failure()',
  );
  try {
    assert.equal(
      (await wire(base + '/config', { revision, change: { kind: 'slots', set: { image: null } } }))
        .status,
      503,
    );
    assert.equal(((await http(base + '/config', manager)).json as any).revision, revision);
  } finally {
    await native.query('DROP TRIGGER local_service_audit_fault ON zhiban_service_events');
    await native.query('DROP FUNCTION local_service_audit_failure()');
  }
  const race = await Promise.all([
    wire(base + '/config', { revision, change: { kind: 'slots', set: { image: null } } }),
    wire(base + '/config', { revision, change: { kind: 'slots', set: { video: null } } }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  revision = race.find((r) => r.status === 200)!.json.revision;
  const bad = await wire(
    base + '/check',
    { provider: 'local-center-proof', kind: 'llm', revision, baseUrl: 'http://127.0.0.1' },
    randomUUID(),
    manager,
    manager.csrf!,
    'POST',
  );
  assert.equal(bad.status, 400);
  const missing = await wire(
    base + '/check',
    { provider: 'absent', kind: 'image', revision },
    randomUUID(),
    manager,
    manager.csrf!,
    'POST',
  );
  assert.equal(missing.status, 404);
  // Tenant-filtered accounting: own and foreign/unattributed rows are distinguished by trusted scope.
  const month = new Date().toISOString().slice(0, 7);
  const usage = await http(base + '/usage?month=' + month, manager);
  assert.equal(usage.status, 200);
  assert.equal((usage.json as any).scope, 'CURRENT_SPACE_ONLY');
  assert.equal((usage.json as any).totals.requests, 0);
  const events = await http(base + '/events', manager);
  assert.equal(events.status, 200);
  assert.ok((events.json as any).items.length >= 2);
  assert.ok(!JSON.stringify(events.json).includes(secret));
  const imagePreset =
    saved.json.presets.find((p: any) => p.id.includes('openai') && p.capabilities.image) ??
    saved.json.presets.find((p: any) => p.capabilities.image);
  assert.ok(imagePreset, 'Native image preset is available');
  const imageModel = imagePreset.capabilities.image.models[0]?.id;
  let update = await wire(base + '/config', {
    revision,
    change: {
      kind: 'provider',
      id: 'local-space-image',
      preset: imagePreset.id,
      apiKey: secret,
      ...(imageModel ? { models: [imageModel] } : {}),
    },
  });
  assert.equal(update.status, 200, JSON.stringify(update.json));
  revision = update.json.revision;
  update = await wire(base + '/config', {
    revision,
    change: {
      kind: 'slots',
      set: { image: 'local-space-image' + (imageModel ? ':' + imageModel : '') },
    },
  });
  assert.equal(update.status, 200, JSON.stringify(update.json));
  revision = update.json.revision;
  const inherited = await http(
    `/api/zhiban/authoring/${tenant}/offerings/${input.trial.offeringId}/media/status`,
    teacher,
  );
  assert.equal(inherited.status, 200);
  assert.equal((inherited.json as any).kinds.image.state, 'CONFIGURED_NOT_VERIFIED');
  assert.equal((inherited.json as any).kinds.image.verified, false);
  const remove = await wire(base + '/config', {
    revision,
    change: { kind: 'remove-provider', id: 'local-center-proof' },
  });
  assert.equal(remove.status, 200);

  const context = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 1440, height: 960 },
  });
  const cookie = manager.cookie!.split(';')[0],
    eq = cookie.indexOf('=');
  await context.addCookies([
    {
      name: cookie.slice(0, eq),
      value: cookie.slice(eq + 1),
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + `/zhiban/admin/services?tenant=${tenant}`);
  await expect(page.getByRole('heading', { name: '服务与运行中心', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '配置状态', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '服务配置', exact: true }).click();
  await expect(page.getByText('正在核对管理员权限…')).not.toBeVisible();
  await page.getByRole('button', { name: '教学模型分配', exact: true }).click();
  await page.getByRole('button', { name: 'AI 用量', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本空间 AI 用量' })).toBeVisible();
  await page.getByRole('button', { name: '变更记录', exact: true }).click();
  await expect(page.getByText('配置变更', { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: 'docs/v2/evidence/zhiban-service-center-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'docs/v2/evidence/zhiban-service-center-mobile.png',
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await context.close();
  // Disposable fixture only: revoke the genuine admin grant while leaving the login alive.
  await input.admin.query('BEGIN');
  try {
    await input.admin.query(
      'SELECT membership_id FROM zhiban_identity.memberships WHERE membership_id=$1 FOR UPDATE',
      [manager.member],
    );
    await input.admin.query(
      'UPDATE zhiban_identity.role_grants SET revoked_at=$1 WHERE grant_id=$2',
      [Date.now(), manager.grant],
    );
    await input.admin.query(
      'UPDATE zhiban_identity.memberships SET authorization_version=authorization_version+1,repository_revision=repository_revision+1 WHERE membership_id=$1',
      [manager.member],
    );
    await input.admin.query('COMMIT');
  } catch (e) {
    await input.admin.query('ROLLBACK');
    throw e;
  }
  assert.equal((await http(base + '/config', manager)).status, 403);
  assert.equal((await http(base + '/events', manager)).status, 403);

  await writeFile(
    'docs/v2/evidence/zhiban-service-center-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS_AVAILABLE_SCOPE',
        at: new Date().toISOString(),
        externalCalls: 0,
        checks: [
          'current space admin only',
          'encrypted write-only key and sanitized audit',
          'exact retry/conflict',
          'concurrent stale revision rejected',
          'CSRF and arbitrary probe target denied',
          'missing provider rejected before dispatch',
          'current-space usage excludes unattributed records',
          'native configuration/model-map/usage UI reused; desktop and mobile',
        ],
        pending: [
          'real external connectivity',
          'real TTS/ASR minimal connection calls and teacher generation acceptance',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'LOCAL admin service center config, concurrency, audit, scoped usage and responsive native UI PASS; external calls 0',
  );
}
