import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const dir = 'lib/zhiban/infrastructure/identity/postgres/migrations';
const sql = readFileSync(`${dir}/0007_identity_authorization_state.sql`, 'utf8');
const workflow = readFileSync('.github/workflows/zhiban-identity-pg16-security.yml', 'utf8');
describe('A7-03 exact authorization helper exception', () => {
  it('adds only 0007 to complete inventory and creates no business table', () => {
    expect(
      readdirSync(dir)
        .filter((x) => x.endsWith('.sql'))
        .map((x) => x.slice(0, 4))
        .sort(),
    ).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009']);
    expect(sql.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(sql.match(/CREATE POLICY/g)).toHaveLength(2);
    expect(sql).not.toMatch(
      /CREATE (?:TABLE|ROLE)|ALTER ROLE|BYPASSRLS|DISABLE ROW LEVEL|NO FORCE ROW/,
    );
  });
  it('pins exact definer owner, path, RLS, volatility and ACL', () => {
    expect(sql).toContain('LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER');
    expect(sql).toContain('SET search_path = pg_catalog, zhiban_identity, pg_temp');
    expect(sql).toContain('SET row_security = on');
    expect(sql).toContain('OWNER TO zhiban_identity_owner');
    expect(sql).toContain('FROM PUBLIC, zhiban_auth_runtime, zhiban_control_runtime');
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION zhiban_identity.authorization_state\(uuid,uuid,uuid\[\],text\)\s+TO zhiban_runtime/,
    );
    expect(sql).not.toMatch(/GRANT\s+(SELECT|UPDATE|ALL)\s+(?:ON\s+)?(?:TABLE|zhiban_identity)/i);
  });
  it('derives User IDs only from scoped memberships and never touches security secrets', () => {
    expect(sql).toContain("session_user <> 'zhiban_runtime'");
    expect(sql).toContain('p_tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id()');
    expect(sql).not.toMatch(
      /zhiban_identity\.(credentials|credential_slots|sessions|audit_events|system_admin_grants)/,
    );
    expect(sql).not.toMatch(/INSERT INTO|UPDATE zhiban_identity|DELETE FROM|EXECUTE\s+format/i);
    expect(sql).toContain('FOR SELECT TO zhiban_identity_owner');
    expect(sql).toContain('USING (tenant_id = zhiban_identity.current_tenant_id())');
  });
  it('uses tenant serialization then sorted SHARE locks and bounded complete roster', () => {
    expect(sql.indexOf('FOR UPDATE')).toBeLessThan(sql.indexOf('FOR SHARE'));
    expect(sql).toContain('array_agg(DISTINCT m.user_id ORDER BY m.user_id)');
    expect(sql).toContain('cardinality(v_users) > 256');
    expect(sql).toContain('cardinality(p_target_membership_ids) > 2');
    expect(sql).toContain("g.role_code = 'TENANT_ADMIN' AND g.revoked_at IS NULL");
    expect(sql).not.toMatch(/g.valid_from\s*<=|g.valid_until\s*>/); // roster includes future/expired candidates, policy checks fresh time
  });
  it('keeps all nine real suites in the existing two-run workflow and new unit tests', () => {
    expect(workflow).toContain('for pass in 1 2');
    for (const suite of [
      'role-bootstrap',
      'migration-runner',
      'schema-security',
      'rls',
      'transactions',
      'repository-signoff',
      'credentials',
      'sessions',
      'authorization',
    ])
      expect(workflow).toContain(`pg16-${suite}.test.ts`);
    for (const suite of [
      'global-repositories',
      'membership-repository',
      'mappers',
      'transactions',
      'persistence-authenticity',
      'authorization-repository',
      'authorization-schema',
    ])
      expect(workflow).toContain(`${suite}.test.ts`);
    expect(workflow).toContain('tests/zhiban/identity/authorization');
    expect(workflow).toContain('pnpm lint');
    expect(workflow).toContain('pnpm exec tsc --noEmit');
  });
});
