import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Pool } from 'pg';

import { createLocalAccount } from '../lib/zhiban/auth/service';
import { hashLoginIdentifier, maskLoginIdentifier } from '../lib/zhiban/auth/identifiers';
import { migrateZhibanDatabase } from '../lib/zhiban/db/migrate';
import { withZhibanTenant } from '../lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '../lib/zhiban/db/types';

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env') as typeof import('@next/env');
loadEnvConfig(process.cwd());

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const connectionString = required('DATABASE_URL');
const tenantId = process.env.ZHIBAN_BOOTSTRAP_TENANT_ID?.trim() || randomUUID();
const tenantCode = required('ZHIBAN_BOOTSTRAP_TENANT_CODE');
const tenantName = required('ZHIBAN_BOOTSTRAP_TENANT_NAME');
const adminLogin = required('ZHIBAN_BOOTSTRAP_ADMIN_LOGIN');
const adminName = required('ZHIBAN_BOOTSTRAP_ADMIN_NAME');
const adminPassword = required('ZHIBAN_BOOTSTRAP_ADMIN_PASSWORD');

const nativePool = new Pool({
  connectionString,
  max: 2,
  application_name: 'openmaic-zhiban-bootstrap',
});
const pool = nativePool as unknown as ZhibanDatabasePool;

try {
  await migrateZhibanDatabase(pool);
  await withZhibanTenant(pool, tenantId, async (client) => {
    await client.query(
      `INSERT INTO zhiban.tenants (id, code, name, tenant_type, status)
       VALUES ($1, $2, $3, 'institution', 'active')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [tenantId, tenantCode, tenantName],
    );
  });

  const existing = await withZhibanTenant(pool, tenantId, async (client) =>
    client.query<{ id: string }>(
      `SELECT id FROM zhiban.accounts
       WHERE tenant_id = $1 AND login_name = $2 AND deleted_at IS NULL`,
      [tenantId, adminLogin],
    ),
  );
  let accountId = existing.rows[0]?.id;
  if (!accountId) {
    const account = await createLocalAccount(pool, {
      tenantId,
      loginName: adminLogin,
      displayName: adminName,
      realName: adminName,
      password: adminPassword,
      mobile: process.env.ZHIBAN_BOOTSTRAP_ADMIN_MOBILE?.trim() || undefined,
      accountType: 'admin',
      adminLevel: 'institution',
      initialRoleCode: 'institution_admin',
    });
    accountId = account.id;
  } else {
    await withZhibanTenant(pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO zhiban.role_assignments
          (id, tenant_id, account_id, role_id, scope_type, granted_by)
         SELECT $1, $2, $3, r.id, 'tenant', $3
         FROM zhiban.roles r
         WHERE r.code = 'institution_admin' AND r.tenant_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM zhiban.role_assignments ra
             WHERE ra.account_id = $3 AND ra.role_id = r.id
               AND ra.scope_type = 'tenant' AND ra.revoked_at IS NULL
           )`,
        [randomUUID(), tenantId, accountId],
      );
    });
  }
  await withZhibanTenant(pool, tenantId, async (client) => {
    await client.query(
      `INSERT INTO zhiban.account_login_identifiers
        (id,account_id,tenant_id,identifier_type,lookup_hash,display_mask,verified,source_system)
       VALUES($1,$2,$3,'admin_account',$4,$5,true,'bootstrap')
       ON CONFLICT(lookup_hash) DO UPDATE SET account_id=EXCLUDED.account_id,tenant_id=EXCLUDED.tenant_id,status='active',verified=true,updated_at=now()`,
      [
        randomUUID(),
        accountId,
        tenantId,
        hashLoginIdentifier(adminLogin),
        maskLoginIdentifier('admin_account', adminLogin),
      ],
    );
  });
  console.log(`Zhiban tenant ${tenantId} and administrator ${accountId} are ready`);
} finally {
  await nativePool.end();
}
