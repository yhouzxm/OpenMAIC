import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMigrationFiles } from '@/lib/zhiban/infrastructure/identity/postgres/migrate';
describe('Session migration static contracts (NOT parser/runtime evidence)', () => {
  it('Session migration remains 0006 in additive inventory; security binding cannot be overwritten and global ACL not broadened', async () => {
    const files = await loadMigrationFiles();
    expect(files.map((file) => file.version)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
    ]);
    const sql = files[5].sql;
    expect(sql).toContain('ADD COLUMN security_epoch bigint');
    expect(sql).toContain('ADD COLUMN user_revision bigint');
    expect(sql).toContain('NEW.security_epoch IS DISTINCT FROM OLD.security_epoch');
    expect(sql).toContain('NEW.user_revision IS DISTINCT FROM OLD.user_revision');
    expect(sql).toContain("TG_OP = 'INSERT' AND NEW.token_digest !~ '^[0-9a-f]{64}$'");
    expect(sql).not.toMatch(
      /SECURITY DEFINER|ENABLE ROW LEVEL SECURITY|GRANT.*token_digest|GRANT.*ON zhiban_identity.users/i,
    );
    expect(sql.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(3);
  });
  it('User mutation barrier plus disable trigger atomically revoke/audit; no restore revival', async () => {
    const sql = (await loadMigrationFiles())[5].sql;
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('zhiban-session-user:'");
    expect(sql).toContain("IF NEW.status = 'DISABLED' AND OLD.status <> 'DISABLED'");
    expect(sql).toContain('WHERE user_id = NEW.user_id AND revoked_at IS NULL');
    expect(sql).toContain("jsonb_build_object('sessionId',revoked_session.session_id)");
    expect(sql).not.toContain('revoked_at = NULL');
  });
  it('same existing PG16 workflow runs sessions twice and retains all old suites', () => {
    const sql = readFileSync('.github/workflows/zhiban-identity-pg16-security.yml', 'utf8');
    expect(sql).toContain('image: postgres:16');
    expect(sql).toContain('for pass in 1 2');
    for (const suite of [
      'role-bootstrap',
      'migration-runner',
      'schema-security',
      'rls',
      'transactions',
      'repository-signoff',
      'credentials',
      'sessions',
    ])
      expect(sql).toContain(`pg16-${suite}.test.ts`);
  });
  it('bearer and issuance capabilities have only explicit infrastructure consumers; not generic barrels', () => {
    const approved = new Set(['session-authenticator.ts', 'session.ts']);
    function walk(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(resolve(directory, entry.name))
          : [resolve(directory, entry.name)],
      );
    }
    for (const path of walk(resolve('lib/zhiban'))) {
      if (!/\.tsx?$/.test(path)) continue;
      const source = readFileSync(path, 'utf8');
      if (
        /import[\s\S]*?newApprovedSession[\s\S]*?from ['"][^'"]*session-material['"]/.test(source)
      ) {
        expect(path.replaceAll('\\', '/').includes('/infrastructure/identity/')).toBe(true);
        expect(approved.has(path.split(/[\\/]/).at(-1)!)).toBe(true);
      }
      if (path.endsWith('index.ts'))
        expect(source).not.toMatch(/session-material|session-authenticator|SessionBearer/);
      if (path.replaceAll('\\', '/').includes('/domain/'))
        expect(source).not.toMatch(/SessionBearer|token_digest|security_epoch|session-material/);
    }
  });
});
