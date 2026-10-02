import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMigrationFiles } from '@/lib/zhiban/infrastructure/identity/postgres/migrate';
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)]); }
describe('Credential schema and security boundary STATIC (not real PostgreSQL evidence)', () => {
  it('additive 0004 owns exactly two global security tables, permanent anchor and immutable history', async () => {
    const migration = (await loadMigrationFiles())[3]; expect(migration.version).toBe('0004');
    const sql = migration.sql;
    expect([...sql.matchAll(/CREATE TABLE zhiban_identity\.([a-z_]+)/g)].map(match => match[1])).toEqual(['credential_slots','credentials']);
    for (const fact of ['credential_active_fk','DEFERRABLE INITIALLY DEFERRED','credential_one_active','credential_history_guard','slot_revision','repository_revision > 0','security_epoch > 0']) expect(sql).toContain(fact);
    expect(sql).not.toMatch(/SECURITY DEFINER|GRANT.*TO PUBLIC|CREATE TABLE.*tenant_id|ALTER.*(?:memberships|role_grants|sessions)/);
    expect(sql).toContain('FROM PUBLIC, zhiban_runtime, zhiban_control_runtime, zhiban_auth_runtime');
    expect(sql).toContain('TO zhiban_auth_runtime');
    expect(sql).not.toMatch(/GRANT (?:DELETE|TRUNCATE|ALL)/);
  });
  it('no business or Domain barrel exposes provider/verifier extraction', () => {
    for (const path of ['lib/zhiban/domain/identity/index.ts','lib/zhiban/application/identity/ports/index.ts'])
      expect(readFileSync(resolve(path),'utf8')).not.toMatch(/password-hashing|verifier-material|credential-records|argon2/);
    const approved = new Set(['lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher.ts','lib/zhiban/infrastructure/identity/credentials/verifier-material.ts','lib/zhiban/infrastructure/identity/postgres/repositories/credential.ts','lib/zhiban/infrastructure/identity/postgres/repositories/credential-records.ts']);
    const consumers = files(resolve('lib')).filter(path => path.endsWith('.ts') || path.endsWith('.tsx'));
    for (const path of consumers) {
      const source = readFileSync(path,'utf8');
      if (source.includes('verifier-material')) expect([...approved].some(value => path.replaceAll('\\','/').endsWith('/'+value))).toBe(true);
      if (/from ['"][^'"]*repositories\/credential(?:-records)?['"]/.test(source)) expect(path.replaceAll('\\','/')).toMatch(/\/infrastructure\/identity\/(credentials\/credential-verifier|postgres\/repositories\/credential)\.ts$/);
      if (path.includes('domain')) expect(source).not.toMatch(/@node-rs\/argon2|PasswordVerifierHandle|verifier_material/);
    }
  });
  it('existing PG16 two-run loop explicitly includes new Credential suite', () => {
    const workflow = readFileSync(resolve('.github/workflows/zhiban-identity-pg16-security.yml'),'utf8');
    expect(workflow).toContain('for pass in 1 2'); expect(workflow).toContain('postgres:16'); expect(workflow).toContain('postgres/pg16-credentials.test.ts');
  });
});
