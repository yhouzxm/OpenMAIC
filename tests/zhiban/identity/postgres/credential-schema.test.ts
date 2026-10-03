import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMigrationFiles } from '@/lib/zhiban/infrastructure/identity/postgres/migrate';
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)],
  );
}
describe('Credential schema and security boundary STATIC (not real PostgreSQL evidence)', () => {
  it('additive 0004 owns exactly two global security tables, permanent anchor and immutable history', async () => {
    const migration = (await loadMigrationFiles())[3];
    expect(migration.version).toBe('0004');
    const sql = migration.sql;
    expect(
      [...sql.matchAll(/CREATE TABLE zhiban_identity\.([a-z_]+)/g)].map((match) => match[1]),
    ).toEqual(['credential_slots', 'credentials']);
    for (const fact of [
      'credential_active_fk',
      'DEFERRABLE INITIALLY DEFERRED',
      'credential_one_active',
      'credential_history_guard',
      'slot_revision',
      'repository_revision > 0',
      'security_epoch > 0',
    ])
      expect(sql).toContain(fact);
    expect(sql).not.toMatch(
      /SECURITY DEFINER|GRANT.*TO PUBLIC|CREATE TABLE.*tenant_id|ALTER.*(?:memberships|role_grants|sessions)/,
    );
    expect(sql).toContain(
      'FROM PUBLIC, zhiban_runtime, zhiban_control_runtime, zhiban_auth_runtime',
    );
    expect(sql).toContain('TO zhiban_auth_runtime');
    expect(sql).not.toMatch(/GRANT (?:DELETE|TRUNCATE|ALL)/);
  });
  it('keeps the slot generation CASE parenthesized inside the PL/pgSQL IF condition (static regression only)', async () => {
    const sql = (await loadMigrationFiles())[3].sql;
    const slotGuard = sql
      .split('CREATE FUNCTION zhiban_identity.credential_slot_guard()')[1]
      .split('CREATE TRIGGER credential_slot_guard')[0];
    // Protect this known parser regression; this is not a PL/pgSQL parser or real PG16 proof.
    expect(slotGuard).toMatch(
      /NEW\.generation\s*<>\s*OLD\.generation\s*\+\s*\(\s*CASE\s+WHEN\s+NEW\.active_credential_id\s+IS\s+NULL\s+THEN\s+0\s+ELSE\s+1\s+END\s*\)\s+THEN/,
    );
  });
  it('0005 replaces only the consistency function and changes only the ambiguous relation alias', async () => {
    const migrations = await loadMigrationFiles();
    const original = migrations[3].sql.match(
      /CREATE FUNCTION zhiban_identity\.credential_consistency\(\)[\s\S]*?END \$\$;/,
    )?.[0];
    expect(original).toBeDefined();
    expect(migrations[4].version).toBe('0005');
    const replacement = migrations[4].sql.replace(/^--[^\n]*(?:\n|$)/gm, '').trim();
    // Compare actual definitions, not a SQL snapshot or an assertion about all PL/pgSQL.
    const expected = original!
      .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
      .replace('credentials old JOIN', 'credentials prior_credential JOIN')
      .replace(/\bold\./g, 'prior_credential.');
    expect(replacement.replace(/\s+/g, ' ')).toBe(expected.replace(/\s+/g, ' '));
    expect(replacement).not.toMatch(/\b(?:FROM|JOIN)\s+\S+\s+(?:AS\s+)?old\b/i);
  });
  it('PUBLIC column ACL regression uses nullable catalog ACL directly, without an empty-array fallback', () => {
    const source = readFileSync(
      resolve('tests/zhiban/identity/postgres/pg16-credentials.test.ts'),
      'utf8',
    );
    const publicTest = source.split("it('CRED-PG05 ")[1].split("it('CRED-PG06 ")[0];
    expect(publicTest).not.toContain("'{}'::aclitem[]");
    expect(publicTest).toContain('aclexplode(a.attacl)');
    expect(publicTest).toContain('a.attacl IS NOT NULL AND acl.grantee=0');
    expect(publicTest).toContain("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))");
    expect(publicTest).toContain("aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))");
    // Whitespace/trailing commas do not change the three real PUBLIC ACL assertions.
    expect(publicTest.match(/\.count\s*,?\s*\)\.toBe\(0\)/g)).toHaveLength(3);
  });
  it('no business or Domain barrel exposes provider/verifier extraction', () => {
    for (const path of [
      'lib/zhiban/domain/identity/index.ts',
      'lib/zhiban/application/identity/ports/index.ts',
    ])
      expect(readFileSync(resolve(path), 'utf8')).not.toMatch(
        /password-hashing|verifier-material|credential-records|argon2/,
      );
    const approved = new Set([
      'lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher.ts',
      'lib/zhiban/infrastructure/identity/credentials/verifier-material.ts',
      'lib/zhiban/infrastructure/identity/postgres/repositories/credential.ts',
      'lib/zhiban/infrastructure/identity/postgres/repositories/credential-records.ts',
      // Appendix B narrowly authorizes these same-client security-only commands.
      // No Application/Domain barrel receives PHC extraction or hydration authority.
      'lib/zhiban/infrastructure/identity/composition/authentication.ts',
      'lib/zhiban/infrastructure/identity/composition/operator.ts',
    ]);
    const consumers = files(resolve('lib')).filter(
      (path) => path.endsWith('.ts') || path.endsWith('.tsx'),
    );
    for (const path of consumers) {
      const source = readFileSync(path, 'utf8');
      if (source.includes('verifier-material'))
        expect(
          [...approved].some((value) => path.replaceAll('\\', '/').endsWith('/' + value)),
        ).toBe(true);
      // Session authentication composition is the one new security-only consumer:
      // it captures the exact verified snapshot for issuance, never extracts PHC.
      if (/from ['"][^'"]*repositories\/credential(?:-records)?['"]/.test(source))
        expect(path.replaceAll('\\', '/')).toMatch(
          /\/infrastructure\/identity\/(credentials\/credential-verifier|postgres\/repositories\/credential|sessions\/session-authenticator|composition\/(authentication|operator|root|membership-security))\.ts$/,
        );
      if (path.includes('domain'))
        expect(source).not.toMatch(/@node-rs\/argon2|PasswordVerifierHandle|verifier_material/);
    }
  });
  it('existing PG16 two-run loop explicitly includes new Credential suite', () => {
    const workflow = readFileSync(
      resolve('.github/workflows/zhiban-identity-pg16-security.yml'),
      'utf8',
    );
    expect(workflow).toContain('for pass in 1 2');
    expect(workflow).toContain('postgres:16');
    expect(workflow).toContain('postgres/pg16-credentials.test.ts');
  });
});
