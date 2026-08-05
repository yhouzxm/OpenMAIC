import { describe, expect, it } from 'vitest';

import { assignRole } from '@/lib/zhiban/rbac/service';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac/types';
import type { QueryResult, ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';

class RecordingPool implements ZhibanDatabasePool, ZhibanDatabaseClient {
  statements: string[] = [];
  async connect() {
    return this;
  }
  release() {}
  async query<TRow extends Record<string, unknown>>(text: string): Promise<QueryResult<TRow>> {
    this.statements.push(text);
    if (text.includes('RETURNING id'))
      return { rows: [{ id: 'assignment-id' }] as unknown as TRow[] };
    return { rows: [] };
  }
}

const principal: AuthorizedPrincipal = {
  id: '10000000-0000-4000-8000-000000000001',
  tenantId: '20000000-0000-4000-8000-000000000001',
  loginName: 'admin',
  displayName: 'Admin',
  accountType: 'admin',
  mustChangePassword: false,
  roles: ['institution_admin'],
  permissions: ['account:manage'],
  grants: [
    {
      roleCode: 'institution_admin',
      permission: 'account:manage',
      scopeType: 'tenant',
      scopeId: null,
    },
  ],
};

describe('role assignment SQL parameter typing', () => {
  it('casts the empty student scope id and scope type explicitly', async () => {
    const pool = new RecordingPool();
    await expect(
      assignRole(pool, principal, {
        accountId: '30000000-0000-4000-8000-000000000001',
        roleCode: 'student',
        scopeType: 'self',
      }),
    ).resolves.toEqual({ id: 'assignment-id' });
    const sql =
      pool.statements.find((statement) =>
        statement.includes('INSERT INTO zhiban.role_assignments'),
      ) ?? '';
    expect(sql).toContain('$6::varchar(32)');
    expect(sql).toContain('$7::uuid');
  });
});
