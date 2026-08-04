import { beforeAll, describe, expect, it } from 'vitest';

import { hashLocalPassword } from '@/lib/zhiban/auth/password';
import {
  authenticateLocal,
  createLocalAccount,
  getAccountForSession,
} from '@/lib/zhiban/auth/service';
import type { QueryResult, ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';

class AuthDatabase implements ZhibanDatabasePool, ZhibanDatabaseClient {
  readonly statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  credentialRow?: Record<string, unknown>;
  sessionRow?: Record<string, unknown>;

  async connect() {
    return this;
  }

  release() {}

  async query<TRow extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<TRow>> {
    this.statements.push({ text, values });
    if (text.includes('FROM zhiban.accounts a') && text.includes('FOR UPDATE')) {
      return { rows: (this.credentialRow ? [this.credentialRow] : []) as unknown as TRow[] };
    }
    if (text.includes('FROM zhiban.user_sessions s') && !text.includes('FOR UPDATE')) {
      return { rows: (this.sessionRow ? [this.sessionRow] : []) as unknown as TRow[] };
    }
    return { rows: [] };
  }
}

describe('local authentication service', () => {
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashLocalPassword('AdultLearning2026!');
  });

  function activeCredential() {
    return {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenant_id: tenantId,
      login_name: 'student01',
      display_name: '测试学生',
      account_type: 'student',
      status: 'active',
      password_hash: passwordHash,
      must_change: true,
      failed_attempts: 0,
      locked_until: null,
    };
  }

  it('creates a hashed database session after valid credentials', async () => {
    const db = new AuthDatabase();
    db.credentialRow = activeCredential();

    const result = await authenticateLocal(db, {
      tenantId,
      loginName: 'student01',
      password: 'AdultLearning2026!',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionCookie).toMatch(new RegExp(`^${tenantId}\\.`));
    const sessionInsert = db.statements.find(({ text }) =>
      text.includes('INSERT INTO zhiban.user_sessions'),
    );
    expect(sessionInsert?.values?.[3]).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionInsert?.values).not.toContain(result.sessionCookie);
    expect(sessionInsert?.values).not.toContain('AdultLearning2026!');
  });

  it('increments failed attempts without creating a session for a bad password', async () => {
    const db = new AuthDatabase();
    db.credentialRow = activeCredential();

    await expect(
      authenticateLocal(db, { tenantId, loginName: 'student01', password: 'WrongPassword2026' }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(
      db.statements.some(({ text }) => text.includes('failed_attempts = failed_attempts + 1')),
    ).toBe(true);
    expect(
      db.statements.some(({ text }) => text.includes('INSERT INTO zhiban.user_sessions')),
    ).toBe(false);
  });

  it('creates the account, credential, typed profile, and audit row in one transaction', async () => {
    const db = new AuthDatabase();
    const account = await createLocalAccount(db, {
      tenantId,
      loginName: 'T001',
      displayName: '王老师',
      realName: '王老师',
      password: 'TeacherPassword2026',
      accountType: 'teacher',
      employeeNo: 'T001',
    });

    expect(account.accountType).toBe('teacher');
    expect(db.statements.some(({ text }) => text.includes('INSERT INTO zhiban.accounts'))).toBe(
      true,
    );
    expect(
      db.statements.some(({ text }) => text.includes('INSERT INTO zhiban.password_credentials')),
    ).toBe(true);
    expect(
      db.statements.some(({ text }) => text.includes('INSERT INTO zhiban.teacher_profiles')),
    ).toBe(true);
    expect(db.statements.some(({ text }) => text.includes('INSERT INTO zhiban.audit_log'))).toBe(
      true,
    );
  });

  it('resolves an active account from a tenant-bound opaque session cookie', async () => {
    const db = new AuthDatabase();
    db.credentialRow = activeCredential();
    const login = await authenticateLocal(db, {
      tenantId,
      loginName: 'student01',
      password: 'AdultLearning2026!',
    });
    if (!login.ok) throw new Error('test login failed');
    db.sessionRow = {
      session_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      account_id: login.account.id,
      tenant_id: tenantId,
      login_name: login.account.loginName,
      display_name: login.account.displayName,
      account_type: login.account.accountType,
      status: 'active',
      must_change: true,
    };

    await expect(getAccountForSession(db, login.sessionCookie)).resolves.toEqual(login.account);
    expect(db.statements.some(({ text }) => text.includes('SET last_seen_at = now()'))).toBe(true);
  });
});
