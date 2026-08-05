import { randomUUID } from 'node:crypto';

import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';

import { hashLocalPassword, verifyLocalPassword } from './password';
import { protectMobile } from './pii';
import { createSessionToken, hashOpaqueToken, parseSessionToken } from './token';
import type { AuthenticatedAccount, LocalAccountType, LocalLoginResult } from './types';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DEFAULT_SESSION_HOURS = 8;

interface AccountCredentialRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  login_name: string;
  display_name: string;
  account_type: LocalAccountType;
  status: string;
  password_hash: string;
  must_change: boolean;
  failed_attempts: number;
  locked_until: Date | string | null;
}

interface SessionAccountRow extends Record<string, unknown> {
  session_id: string;
  account_id: string;
  tenant_id: string;
  login_name: string;
  display_name: string;
  account_type: LocalAccountType;
  status: string;
  must_change: boolean;
}

export type CreateLocalAccountInput = {
  tenantId: string;
  loginName: string;
  displayName: string;
  realName: string;
  password: string;
  mobile?: string;
  initialRoleCode?: string;
  initialRoleScopeType?: 'self' | 'project_group' | 'class' | 'course' | 'tenant' | 'system';
  initialRoleScopeId?: string;
} & (
  | { accountType: 'student'; studentNo: string }
  | { accountType: 'teacher'; employeeNo: string }
  | { accountType: 'admin'; adminLevel?: 'teaching' | 'institution' | 'system' }
);

function accountFromRow(row: AccountCredentialRow | SessionAccountRow): AuthenticatedAccount {
  const id = (row as SessionAccountRow).account_id ?? (row as AccountCredentialRow).id;
  return {
    id,
    tenantId: row.tenant_id,
    loginName: row.login_name,
    displayName: row.display_name,
    accountType: row.account_type,
    mustChangePassword: row.must_change,
  };
}

function sessionHours(): number {
  const parsed = Number.parseInt(process.env.ZHIBAN_SESSION_HOURS ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(168, Math.max(1, parsed)) : DEFAULT_SESSION_HOURS;
}

async function writeAudit(
  queryable: ZhibanQueryable,
  tenantId: string,
  accountId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
) {
  await queryable.query(
    `INSERT INTO zhiban.audit_log
      (tenant_id, actor_type, actor_account_id, action, resource_type, resource_id, metadata)
     VALUES ($1, 'account', $2, $3, $4, $5, $6::jsonb)`,
    [tenantId, accountId, action, resourceType, resourceId, JSON.stringify(metadata)],
  );
}

export async function createLocalAccount(
  pool: ZhibanDatabasePool,
  input: CreateLocalAccountInput,
): Promise<AuthenticatedAccount> {
  const accountId = randomUUID();
  const roleAssignmentId = randomUUID();
  const passwordHash = await hashLocalPassword(input.password);
  const mobile = input.mobile ? protectMobile(input.mobile) : undefined;

  return withZhibanTenant(pool, input.tenantId, async (client) => {
    await client.query(
      `INSERT INTO zhiban.accounts
        (id, tenant_id, login_name, display_name, account_type, status,
         mobile_encrypted, mobile_lookup_hash, mobile_last4)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)`,
      [
        accountId,
        input.tenantId,
        input.loginName.trim(),
        input.displayName.trim(),
        input.accountType,
        mobile?.encrypted ?? null,
        mobile?.lookupHash ?? null,
        mobile?.last4 ?? null,
      ],
    );
    await client.query(
      `INSERT INTO zhiban.password_credentials (account_id, password_hash)
       VALUES ($1, $2)`,
      [accountId, passwordHash],
    );

    if (input.accountType === 'student') {
      await client.query(
        `INSERT INTO zhiban.student_profiles
          (account_id, tenant_id, student_no, real_name)
         VALUES ($1, $2, $3, $4)`,
        [accountId, input.tenantId, input.studentNo.trim(), input.realName.trim()],
      );
    } else if (input.accountType === 'teacher') {
      await client.query(
        `INSERT INTO zhiban.teacher_profiles
          (account_id, tenant_id, employee_no, real_name)
         VALUES ($1, $2, $3, $4)`,
        [accountId, input.tenantId, input.employeeNo.trim(), input.realName.trim()],
      );
    } else {
      await client.query(
        `INSERT INTO zhiban.admin_profiles
          (account_id, tenant_id, admin_level, default_data_scope)
         VALUES ($1, $2, $3, $4)`,
        [
          accountId,
          input.tenantId,
          input.adminLevel ?? 'institution',
          input.adminLevel === 'system' ? 'system' : 'tenant',
        ],
      );
    }

    if (input.initialRoleCode) {
      const scopeType =
        input.initialRoleScopeType ?? (input.initialRoleCode === 'student' ? 'self' : 'tenant');
      const assignment = await client.query<{ id: string }>(
        `INSERT INTO zhiban.role_assignments
          (id, tenant_id, account_id, role_id, scope_type, scope_id)
         SELECT $1::uuid, $2::uuid, $3::uuid, r.id, $5::varchar(32), $6::uuid
         FROM zhiban.roles r
         WHERE r.code = $4 AND (r.tenant_id IS NULL OR r.tenant_id = $2)
         ORDER BY r.tenant_id NULLS LAST
         LIMIT 1
         RETURNING id`,
        [
          roleAssignmentId,
          input.tenantId,
          accountId,
          input.initialRoleCode,
          scopeType,
          input.initialRoleScopeId ?? null,
        ],
      );
      if (!assignment.rows[0]) throw new Error(`Unknown role: ${input.initialRoleCode}`);
    }

    await writeAudit(client, input.tenantId, accountId, 'account.created', 'account', accountId, {
      accountType: input.accountType,
    });
    return {
      id: accountId,
      tenantId: input.tenantId,
      loginName: input.loginName.trim(),
      displayName: input.displayName.trim(),
      accountType: input.accountType,
      mustChangePassword: true,
    };
  });
}

export async function authenticateLocal(
  pool: ZhibanDatabasePool,
  input: {
    tenantId: string;
    loginName: string;
    password: string;
    ipHash?: string;
    userAgentHash?: string;
  },
): Promise<LocalLoginResult> {
  return withZhibanTenant(pool, input.tenantId, async (client) => {
    const result = await client.query<AccountCredentialRow>(
      `SELECT a.id, a.tenant_id, a.login_name, a.display_name, a.account_type, a.status,
              p.password_hash, p.must_change, p.failed_attempts, p.locked_until
       FROM zhiban.accounts a
       JOIN zhiban.password_credentials p ON p.account_id = a.id
       WHERE a.tenant_id = $1 AND lower(a.login_name) = lower($2) AND a.deleted_at IS NULL
       FOR UPDATE`,
      [input.tenantId, input.loginName.trim()],
    );
    const row = result.rows[0];
    const passwordValid = await verifyLocalPassword(row?.password_hash, input.password);
    if (!row) return { ok: false, reason: 'invalid_credentials' };

    const lockedUntil = row.locked_until ? new Date(row.locked_until) : null;
    if (row.status !== 'active') return { ok: false, reason: 'account_unavailable' };
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      return { ok: false, reason: 'account_locked' };
    }
    if (!passwordValid) {
      await client.query(
        `UPDATE zhiban.password_credentials
         SET failed_attempts = failed_attempts + 1,
             locked_until = CASE WHEN failed_attempts + 1 >= $2
               THEN now() + ($3 * interval '1 minute') ELSE NULL END,
             updated_at = now()
         WHERE account_id = $1`,
        [row.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
      );
      return { ok: false, reason: 'invalid_credentials' };
    }

    await client.query(
      `UPDATE zhiban.password_credentials
       SET failed_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE account_id = $1`,
      [row.id],
    );
    await client.query('UPDATE zhiban.accounts SET last_login_at = now() WHERE id = $1', [row.id]);

    const sessionId = randomUUID();
    const token = createSessionToken(input.tenantId);
    const expiresAt = new Date(Date.now() + sessionHours() * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO zhiban.user_sessions
        (id, tenant_id, account_id, access_token_hash, ip_hash, user_agent_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        input.tenantId,
        row.id,
        token.tokenHash,
        input.ipHash ?? null,
        input.userAgentHash ?? null,
        expiresAt,
      ],
    );
    await writeAudit(client, input.tenantId, row.id, 'auth.login_succeeded', 'session', sessionId);

    return {
      ok: true,
      account: accountFromRow(row),
      sessionCookie: token.cookieValue,
      expiresAt,
    };
  });
}

export async function getAccountForSession(
  pool: ZhibanDatabasePool,
  cookieValue: string,
): Promise<AuthenticatedAccount | null> {
  const token = parseSessionToken(cookieValue);
  if (!token) return null;

  return withZhibanTenant(pool, token.tenantId, async (client) => {
    const result = await client.query<SessionAccountRow>(
      `SELECT s.id AS session_id, a.id AS account_id, a.tenant_id, a.login_name,
              a.display_name, a.account_type, a.status, p.must_change
       FROM zhiban.user_sessions s
       JOIN zhiban.accounts a ON a.id = s.account_id
       JOIN zhiban.password_credentials p ON p.account_id = a.id
       WHERE s.tenant_id = $1 AND s.access_token_hash = $2
         AND s.revoked_at IS NULL AND s.expires_at > now()
         AND a.status = 'active' AND a.deleted_at IS NULL`,
      [token.tenantId, hashOpaqueToken(token.secret)],
    );
    const row = result.rows[0];
    if (!row) return null;
    await client.query(
      `UPDATE zhiban.user_sessions SET last_seen_at = now()
       WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`,
      [row.session_id],
    );
    return accountFromRow(row);
  });
}

export async function revokeLocalSession(
  pool: ZhibanDatabasePool,
  cookieValue: string,
  reason = 'logout',
): Promise<void> {
  const token = parseSessionToken(cookieValue);
  if (!token) return;
  await withZhibanTenant(pool, token.tenantId, async (client) => {
    await client.query(
      `UPDATE zhiban.user_sessions SET revoked_at = now(), revoke_reason = $3
       WHERE tenant_id = $1 AND access_token_hash = $2 AND revoked_at IS NULL`,
      [token.tenantId, hashOpaqueToken(token.secret), reason],
    );
  });
}

export async function revokeAllLocalSessions(
  pool: ZhibanDatabasePool,
  tenantId: string,
  accountId: string,
  reason = 'administrative_revoke',
): Promise<void> {
  await withZhibanTenant(pool, tenantId, async (client) => {
    await client.query(
      `UPDATE zhiban.user_sessions SET revoked_at = now(), revoke_reason = $3
       WHERE tenant_id = $1 AND account_id = $2 AND revoked_at IS NULL`,
      [tenantId, accountId, reason],
    );
  });
}

export async function changeLocalPassword(
  pool: ZhibanDatabasePool,
  cookieValue: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const token = parseSessionToken(cookieValue);
  if (!token) return false;
  const newHash = await hashLocalPassword(newPassword);

  return withZhibanTenant(pool, token.tenantId, async (client) => {
    const result = await client.query<AccountCredentialRow & { session_id: string }>(
      `SELECT a.id, a.tenant_id, a.login_name, a.display_name, a.account_type, a.status,
              p.password_hash, p.must_change, p.failed_attempts, p.locked_until,
              s.id AS session_id
       FROM zhiban.user_sessions s
       JOIN zhiban.accounts a ON a.id = s.account_id
       JOIN zhiban.password_credentials p ON p.account_id = a.id
       WHERE s.tenant_id = $1 AND s.access_token_hash = $2
         AND s.revoked_at IS NULL AND s.expires_at > now()
       FOR UPDATE`,
      [token.tenantId, hashOpaqueToken(token.secret)],
    );
    const row = result.rows[0];
    if (!row || !(await verifyLocalPassword(row.password_hash, currentPassword))) return false;

    await client.query(
      `UPDATE zhiban.password_credentials
       SET password_hash = $2, must_change = false, failed_attempts = 0,
           locked_until = NULL, password_changed_at = now(), updated_at = now()
       WHERE account_id = $1`,
      [row.id, newHash],
    );
    await client.query(
      `UPDATE zhiban.user_sessions
       SET revoked_at = now(), revoke_reason = 'password_changed'
       WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [row.id, row.session_id],
    );
    await writeAudit(client, token.tenantId, row.id, 'auth.password_changed', 'account', row.id);
    return true;
  });
}
