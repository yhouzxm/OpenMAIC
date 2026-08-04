import { randomUUID } from 'node:crypto';

import { hashOpaqueToken, parseSessionToken } from '@/lib/zhiban/auth/token';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';

import type {
  AuthorizedPrincipal,
  ManagedAccount,
  ManagedRoleAssignment,
  PermissionCode,
} from './types';

interface PrincipalRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  login_name: string;
  display_name: string;
  account_type: 'student' | 'teacher' | 'admin';
  must_change: boolean;
  roles: string[] | null;
  permissions: PermissionCode[] | null;
}

interface ManagedAccountRow extends Record<string, unknown> {
  id: string;
  login_name: string;
  display_name: string;
  account_type: string;
  status: string;
  identifier: string | null;
  mobile_last4: string | null;
  last_login_at: Date | string | null;
  created_at: Date | string;
  roles: ManagedRoleAssignment[] | null;
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 403,
  ) {
    super(message);
  }
}

async function audit(
  queryable: ZhibanQueryable,
  principal: AuthorizedPrincipal,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
) {
  await queryable.query(
    `INSERT INTO zhiban.audit_log
      (tenant_id, actor_type, actor_account_id, action, resource_type, resource_id, metadata)
     VALUES ($1, 'account', $2, $3, $4, $5, $6::jsonb)`,
    [principal.tenantId, principal.id, action, resourceType, resourceId, JSON.stringify(metadata)],
  );
}

export async function getAuthorizedPrincipal(
  pool: ZhibanDatabasePool,
  cookieValue: string,
): Promise<AuthorizedPrincipal | null> {
  const token = parseSessionToken(cookieValue);
  if (!token) return null;

  return withZhibanTenant(pool, token.tenantId, async (client) => {
    const result = await client.query<PrincipalRow>(
      `SELECT a.id, a.tenant_id, a.login_name, a.display_name, a.account_type,
              pc.must_change,
              COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
              COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM zhiban.user_sessions s
       JOIN zhiban.accounts a ON a.id = s.account_id
       JOIN zhiban.password_credentials pc ON pc.account_id = a.id
       LEFT JOIN zhiban.role_assignments ra ON ra.account_id = a.id
         AND ra.tenant_id = a.tenant_id AND ra.revoked_at IS NULL
         AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
       LEFT JOIN zhiban.roles r ON r.id = ra.role_id AND r.status = 'active'
       LEFT JOIN zhiban.role_permissions rp ON rp.role_id = r.id
       LEFT JOIN zhiban.permissions p ON p.id = rp.permission_id
       WHERE s.tenant_id = $1 AND s.access_token_hash = $2
         AND s.revoked_at IS NULL AND s.expires_at > now()
         AND a.status = 'active' AND a.deleted_at IS NULL
       GROUP BY a.id, pc.must_change`,
      [token.tenantId, hashOpaqueToken(token.secret)],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      loginName: row.login_name,
      displayName: row.display_name,
      accountType: row.account_type,
      mustChangePassword: row.must_change,
      roles: row.roles ?? [],
      permissions: row.permissions ?? [],
    };
  });
}

export async function requirePermission(
  pool: ZhibanDatabasePool,
  cookieValue: string | undefined,
  permission: PermissionCode,
): Promise<AuthorizedPrincipal> {
  if (!cookieValue) throw new AuthorizationError('Authentication required', 401);
  const principal = await getAuthorizedPrincipal(pool, cookieValue);
  if (!principal) throw new AuthorizationError('Authentication required', 401);
  if (!principal.permissions.includes(permission)) {
    throw new AuthorizationError('Permission denied', 403);
  }
  return principal;
}

export async function listManagedAccounts(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
): Promise<ManagedAccount[]> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<ManagedAccountRow>(
      `SELECT a.id, a.login_name, a.display_name, a.account_type, a.status,
              COALESCE(sp.student_no, tp.employee_no) AS identifier,
              a.mobile_last4, a.last_login_at, a.created_at,
              COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                'id', ra.id, 'roleCode', r.code, 'roleName', r.name,
                'scopeType', ra.scope_type, 'scopeId', ra.scope_id
              )) FILTER (WHERE ra.id IS NOT NULL), '[]'::jsonb) AS roles
       FROM zhiban.accounts a
       LEFT JOIN zhiban.student_profiles sp ON sp.account_id = a.id
       LEFT JOIN zhiban.teacher_profiles tp ON tp.account_id = a.id
       LEFT JOIN zhiban.role_assignments ra ON ra.account_id = a.id AND ra.revoked_at IS NULL
       LEFT JOIN zhiban.roles r ON r.id = ra.role_id
       WHERE a.tenant_id = $1 AND a.deleted_at IS NULL
       GROUP BY a.id, sp.student_no, tp.employee_no
       ORDER BY a.created_at DESC`,
      [principal.tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      loginName: row.login_name,
      displayName: row.display_name,
      accountType: row.account_type,
      status: row.status,
      identifier: row.identifier,
      mobileLast4: row.mobile_last4,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      roles: row.roles ?? [],
    }));
  });
}

export async function listAssignableRoles(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<
      Record<string, unknown> & { id: string; code: string; name: string; role_type: string }
    >(
      `SELECT id, code, name, role_type FROM zhiban.roles
       WHERE status = 'active' AND (tenant_id IS NULL OR tenant_id = $1)
       ORDER BY role_type, name`,
      [principal.tenantId],
    );
    return result.rows
      .filter((row) => row.code !== 'system_admin' || principal.roles.includes('system_admin'))
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        roleType: row.role_type,
      }));
  });
}

export async function assignRole(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: { accountId: string; roleCode: string },
) {
  if (input.roleCode === 'system_admin' && !principal.roles.includes('system_admin')) {
    throw new AuthorizationError('Only a system administrator can grant this role');
  }
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const assignmentId = randomUUID();
    const result = await client.query<{ id: string }>(
      `INSERT INTO zhiban.role_assignments
        (id, tenant_id, account_id, role_id, scope_type, granted_by)
       SELECT $1, $2, a.id, r.id, 'tenant', $3
       FROM zhiban.accounts a
       JOIN zhiban.roles r ON r.code = $4 AND (r.tenant_id IS NULL OR r.tenant_id = $2)
       WHERE a.id = $5 AND a.tenant_id = $2 AND a.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM zhiban.role_assignments existing
           WHERE existing.account_id = a.id AND existing.role_id = r.id
             AND existing.scope_type = 'tenant' AND existing.revoked_at IS NULL
         )
       RETURNING id`,
      [assignmentId, principal.tenantId, principal.id, input.roleCode, input.accountId],
    );
    if (!result.rows[0]) throw new Error('Account, role, or active assignment is invalid');
    await audit(client, principal, 'role.assigned', 'account', input.accountId, {
      roleCode: input.roleCode,
    });
    return { id: result.rows[0].id };
  });
}

export async function revokeRoleAssignment(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  assignmentId: string,
): Promise<boolean> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<{ account_id: string; role_code: string }>(
      `UPDATE zhiban.role_assignments ra SET revoked_at = now()
       FROM zhiban.roles r
       WHERE ra.id = $1 AND ra.tenant_id = $2 AND ra.revoked_at IS NULL AND r.id = ra.role_id
         AND NOT (ra.account_id = $3 AND r.code IN ('system_admin', 'institution_admin'))
       RETURNING ra.account_id, r.code AS role_code`,
      [assignmentId, principal.tenantId, principal.id],
    );
    const row = result.rows[0];
    if (!row) return false;
    await audit(client, principal, 'role.revoked', 'account', row.account_id, {
      roleCode: row.role_code,
    });
    return true;
  });
}

export async function updateManagedAccountStatus(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  accountId: string,
  status: 'active' | 'disabled',
): Promise<boolean> {
  if (accountId === principal.id && status === 'disabled') {
    throw new Error('You cannot disable your own account');
  }
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE zhiban.accounts SET status = $3, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
      [accountId, principal.tenantId, status],
    );
    if (!result.rows[0]) return false;
    if (status === 'disabled') {
      await client.query(
        `UPDATE zhiban.user_sessions
         SET revoked_at = now(), revoke_reason = 'account_disabled'
         WHERE account_id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
        [accountId, principal.tenantId],
      );
    }
    await audit(client, principal, `account.${status}`, 'account', accountId);
    return true;
  });
}
