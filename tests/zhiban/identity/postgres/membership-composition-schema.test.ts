import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadMigrationFiles } from '@/lib/zhiban/infrastructure/identity/postgres/migrate';

const sql = readFileSync(
  'lib/zhiban/infrastructure/identity/postgres/migrations/0009_identity_membership_composition.sql',
  'utf8',
);
const body = (name: string) =>
  sql.split('CREATE FUNCTION zhiban_identity.' + name + '(')[1].split('$body$;')[0];
const callable = [
  'identity_session_step_up_guard',
  'identity_member_admission_state',
  'identity_member_consent_context',
  'identity_member_admission_register',
  'identity_tenant_restore_guard',
  'identity_first_tenant_admin_lock',
  'identity_first_tenant_admin_apply',
];
describe('C8 exact schema/ACL and FIRST terminal supplement (static, not a PG16 parser proof)', () => {
  it('appends 0009 to the existing contiguous inventory', async () => {
    expect((await loadMigrationFiles()).map((f) => f.version)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(4, '0')),
    );
  });
  it('has exactly ten tables, seven callable and one constraint definer, two invokers, 25 policies, 22 triggers and five secondary indexes', () => {
    expect(sql.match(/CREATE TABLE /g)).toHaveLength(10);
    expect(sql.match(/SECURITY DEFINER/g)).toHaveLength(8);
    expect(sql.match(/SECURITY INVOKER/g)).toHaveLength(3); // Includes replacement of the existing audit payload validator.
    expect(sql.match(/CREATE POLICY /g)).toHaveLength(25);
    expect(sql.match(/CREATE (?:CONSTRAINT )?TRIGGER /g)).toHaveLength(22);
    expect(sql.match(/CREATE INDEX /g)).toHaveLength(5);
    expect(sql).not.toMatch(
      /CREATE (ROLE|EXTENSION|SCHEMA)|ALTER ROLE|SET ROLE|BYPASSRLS|EXECUTE format/i,
    );
  });
  it.each(callable)(
    '%s fixes owner, search path, RLS and exact caller whitelist without overloads',
    (name) => {
      const f = body(name);
      expect(f).toContain('SECURITY DEFINER VOLATILE PARALLEL UNSAFE');
      expect(f).toContain('SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on');
      expect(f).toContain('session_user');
      expect(f).not.toContain('RAISE NOTICE');
      expect(sql).toContain('ALTER FUNCTION zhiban_identity.' + name + '(');
      expect(sql).toContain('REVOKE ALL ON FUNCTION zhiban_identity.' + name + '(');
    },
  );
  it('forces RLS on all six tenant-owned records; no secret table or role/security model changes', () => {
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(6);
    expect(sql).not.toMatch(
      /GRANT[^;]*(sessions|credential_slots|credentials|verifier_material|token_digest)/,
    );
    expect(sql).not.toMatch(
      /GRANT SELECT[^;]*(memberships|role_grants)[^;]*TO zhiban_control_runtime/,
    );
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*consistency/);
  });
  it('locks Tenant, complete sorted Users and anchor before branching on actual persisted state', () => {
    const f = body('identity_first_tenant_admin_lock');
    expect(f.indexOf('tenants AS t')).toBeLessThan(f.indexOf('ORDER BY x.uid'));
    expect(f.indexOf('ORDER BY x.uid')).toBeLessThan(
      f.indexOf('o.tenant_id=p_tenant_id FOR UPDATE'),
    );
    expect(f.indexOf('o.tenant_id=p_tenant_id FOR UPDATE')).toBeLessThan(
      f.indexOf('IF v_o.repository_revision=1'),
    );
    expect(f).toContain('ELSIF v_o.repository_revision=2');
    expect(f).not.toMatch(/INSERT INTO|UPDATE zhiban_identity|DELETE FROM|nextval\(/);
  });
  it('terminal confirmation checks current exact state and history, source chain and three actual audit rows', () => {
    const f = body('identity_first_tenant_admin_lock');
    for (const fragment of [
      'v_m.repository_revision=2',
      'v_m.authorization_version=1',
      "v_m.status='ACTIVE'",
      'v_g.revoked_at IS NULL',
      'v_g.valid_from<=v_at',
      'g.grant_id<>v_g.grant_id',
      'v_c.manifest_digest=v_a.manifest_digest',
      'v_a.consumed_at=v_o.completed_at',
      'v_tc.actor_user_id=v_o.user_id',
      "v_cc.outcome_kind='APPLIED'",
      'v_active.event_payload=jsonb_build_object',
      'v_consent_event.authorization_version_after IS NULL',
    ])
      expect(f).toContain(fragment);
    expect(f.match(/audit_events AS e/g)).toHaveLength(3);
    expect(f).toContain("coalesce(v_previous,'')");
    expect(f).toContain('EXCEPTION WHEN OTHERS');
  });
  it('terminal helper success cannot authorize a second apply, before any DML', () => {
    const f = body('identity_first_tenant_admin_apply');
    const dml = f.indexOf('INSERT INTO zhiban_identity.memberships');
    for (const predicate of [
      'v_a.consumed_at IS NOT NULL',
      'o.repository_revision=1 AND o.completed_at IS NULL',
      'EXISTS (SELECT 1 FROM zhiban_identity.memberships',
      'EXISTS (SELECT 1 FROM zhiban_identity.role_grants',
    ])
      expect(f.indexOf(predicate)).toBeLessThan(dml);
  });
  it('captures caller context before any throwing prerequisite in restore/first/apply helpers', () => {
    for (const name of [
      'identity_tenant_restore_guard',
      'identity_first_tenant_admin_lock',
      'identity_first_tenant_admin_apply',
    ]) {
      const f = body(name);
      expect(f.indexOf("v_previous := current_setting('app.tenant_id',true)")).toBeLessThan(
        f.indexOf('IF session_user'),
      );
    }
    const f = body('identity_first_tenant_admin_apply');
    expect(
      f.indexOf("v_previous_approval := current_setting('app.onboarding_approval_id',true)"),
    ).toBeLessThan(f.indexOf('PERFORM zhiban_identity.identity_first_tenant_admin_lock'));
  });
  it('preserve checks both completed provenance chains and excludes the approval currently being created', () => {
    const f = body('identity_membership_composition_consistency');
    expect(f).toContain("v_pg.grant_mode='PRESERVE'");
    expect(f).toContain('approval.command_id<>v_command');
    expect(f).toContain('anchor.repository_revision=2');
    expect(f).toContain('approved.created_at=v_g.created_at');
    expect(f).not.toMatch(/INSERT INTO|UPDATE zhiban_identity|DELETE FROM/);
  });
  it('first partial writes are protected by deferred triggers on both legacy parents and children', () => {
    for (const table of ['memberships', 'role_grants'])
      expect(sql).toContain(
        'CREATE CONSTRAINT TRIGGER ' + table + '_identity_onboarding_consistency',
      );
    expect(sql.match(/DEFERRABLE INITIALLY DEFERRED FOR EACH ROW/g)).toHaveLength(12);
  });
  it('reads auditable provenance by actual subject-bound FK, not generic owner audit access', () => {
    expect(sql).toContain('e.audit_event_id=audit_events.event_id');
    expect(sql).toContain('audit_events.subject_user_id IS NOT DISTINCT FROM e.target_user_id');
    expect(sql).not.toMatch(/GRANT SELECT[^;]*audit_events/);
  });
  it('keeps tenant and global provenance branches inside one enclosing USING expression', () => {
    const policy = sql
      .split('CREATE POLICY audit_identity_member_provenance_owner_read ')[1]
      .split(';')[0];
    const expression = policy.slice(policy.indexOf('USING ') + 'USING '.length).trim();
    expect(expression).toContain("OR (event_scope='GLOBAL' AND EXISTS (");
    // This checks delimiter structure only; the real PG16 suite remains the SQL parser proof.
    const delimiters = [...expression.matchAll(/'(?:''|[^'])*'|[()]/g)].filter(
      ([token]) => token === '(' || token === ')',
    );
    let depth = 0;
    for (const [index, [token]] of delimiters.entries()) {
      depth += token === '(' ? 1 : -1;
      if (index < delimiters.length - 1) expect(depth).toBeGreaterThan(0);
    }
    expect(depth).toBe(0);
  });
  it('admission capacity is bounded before INSERT and does not turn a GUC into permission proof', () => {
    const f = body('identity_member_admission_register');
    expect(f).toContain('LIMIT (v_capacity::bigint+1)');
    expect(f.indexOf('v_count+1>')).toBeLessThan(f.indexOf('INSERT INTO'));
    expect(f).toContain('g.repository_revision=v_a.expected_admin_grant_revision');
    expect(f).not.toContain("current_setting('app.approved'");
  });
  it('consumed admission approval has a strict read-only confirmation before capacity and INSERT', () => {
    const f = body('identity_member_admission_register');
    const branch = f.slice(
      f.indexOf('IF v_a.consumed_at IS NOT NULL THEN'),
      f.indexOf('v_capacity:='),
    );
    expect(branch).not.toMatch(/INSERT INTO|UPDATE zhiban_identity|DELETE FROM|nextval\(/);
    for (const fragment of [
      'v_source.repository_revision=1',
      'v_source.consumed_at IS NULL',
      'v_source.control_approval_id=v_a.approval_id',
      "v_command.outcome_kind='APPLIED'",
      'v_command.completed_at=v_a.consumed_at',
      'v_effect.admission_id=p_admission_id',
      'v_source.expected_member_revision IS NOT DISTINCT FROM',
      'v_source.subject_user_revision=v_a.expected_user_revision',
      'm.repository_revision=v_a.expected_member_revision',
      'RETURN p_admission_id',
      'IS NOT TRUE',
    ])
      expect(branch).toContain(fragment);
    expect(f.indexOf('FOR SHARE;\n PERFORM g.grant_id')).toBeLessThan(
      f.indexOf('IF v_a.consumed_at IS NOT NULL THEN'),
    );
  });
});
