import { applyHostSchemaMigrations as applySchemaMigrations } from '@/lib/persistence/installed-schema';
import type { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { configureHostWorkspaceLayer } from '@/lib/server/model-config/runtime';
import { currentServiceTenant } from '@/lib/server/service-scope';
import {
  readWorkspaceModelConfig,
  ensureWorkspaceModelConfigSchema,
} from '@/lib/persistence/workspace-model-config';
let nativePool: Pool | undefined;
export async function registerServiceOwner(owner: string, tenant: string) {
  if (!nativePool) return;
  const r = await nativePool.query(
    `INSERT INTO zhiban_service_owners(owner_id,tenant_id) VALUES($1,$2)
    ON CONFLICT(owner_id) DO UPDATE SET owner_id=excluded.owner_id WHERE zhiban_service_owners.tenant_id=excluded.tenant_id RETURNING owner_id`,
    [owner, tenant],
  );
  if (r.rowCount !== 1) throw Error('Native service tenant binding rejected');
}
export const serviceOwner = (tenant: string) => `zhiban-services:${tenant}`;
export async function initializeServiceCenter(pool: Pool) {
  await ensureWorkspaceModelConfigSchema(pool);
  const sql = await readFile('lib/zhiban/infrastructure/service-center/schema.sql', 'utf8');
  await applySchemaMigrations(pool, {
    store: 'zhiban-service-center',
    migrations: [{ version: 1, name: 'service-audit', up: sql }],
  });
  nativePool = pool;
  configureHostWorkspaceLayer(async (owner) => {
    const tenant =
      currentServiceTenant() ??
      (await pool.query('SELECT tenant_id FROM zhiban_service_owners WHERE owner_id=$1', [owner]))
        .rows[0]?.tenant_id;
    if (!tenant) return undefined;
    const shared = await readWorkspaceModelConfig(pool, serviceOwner(tenant));
    const personal =
      owner === serviceOwner(tenant) ? null : await readWorkspaceModelConfig(pool, owner);
    if (shared?.unreadableSecrets.length || personal?.unreadableSecrets.length)
      throw Error('Service configuration secrets unreadable');
    if (!shared && !personal) return null;
    // Space providers are authoritative for their ids. Existing personal slot choices remain choices.
    return {
      source: 'workspace',
      config: {
        providers: { ...personal?.config.providers, ...shared?.config.providers },
        slots: { ...shared?.config.slots, ...personal?.config.slots },
      },
    };
  });
  return createHash('sha256').update(sql).digest('hex');
}
