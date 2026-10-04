import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadMigrationFiles } from '@/lib/zhiban/infrastructure/identity/postgres/migrate';
const sql = readFileSync(
  'lib/zhiban/infrastructure/identity/postgres/migrations/0008_identity_authentication_composition.sql',
  'utf8',
);
const functionBody = (name: string) =>
  sql.split('CREATE FUNCTION zhiban_identity.' + name + '(')[1].split('$$;')[0];
describe('B8-S01–S06 exact schema/ACL contract (static, NOT a PG16 parser proof)', () => {
  it('appends only 0008 and pins five global tables, eight definers, three invokers, two policies/indexes', async () => {
    expect((await loadMigrationFiles()).map((m) => m.version)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
    ]);
    expect(
      [...sql.matchAll(/CREATE TABLE zhiban_identity\.([a-z_]+)/g)].map((m) => m[1]).sort(),
    ).toEqual(
      [
        'admission_policies',
        'admission_gate',
        'admission_buckets',
        'identity_platform_bootstrap',
        'identity_credential_provisions',
      ].sort(),
    );
    expect(sql.match(/SECURITY DEFINER/g)).toHaveLength(8);
    expect(sql.match(/SECURITY INVOKER/g)).toHaveLength(3);
    expect(sql.match(/CREATE POLICY/g)).toHaveLength(2);
    expect(sql.match(/CREATE INDEX/g)).toHaveLength(2);
    expect(sql).not.toMatch(
      /CREATE (ROLE|EXTENSION|SCHEMA)|ALTER ROLE|BYPASSRLS|GRANT .*users|ENABLE ROW LEVEL SECURITY|DEFAULT.*password/i,
    );
  });
  it('does not add generic DML/secret capability to anchor, guard, spaces or lock helper', () => {
    for (const name of [
      'identity_auth_user_anchor',
      'identity_session_guard',
      'identity_session_spaces',
      'identity_platform_bootstrap_lock',
    ]) {
      const body = functionBody(name);
      expect(body).not.toMatch(/INSERT INTO|UPDATE zhiban_identity|DELETE FROM|verifier_material/);
      expect(body).toContain('SET row_security=on');
      expect(body).toContain('SET search_path=pg_catalog,zhiban_identity,pg_temp');
      expect(body).toContain('session_user');
    }
    expect(functionBody('identity_platform_bootstrap_lock')).toContain(
      'LOCK TABLE zhiban_identity.system_admin_grants IN SHARE ROW EXCLUSIVE MODE',
    );
    expect(functionBody('identity_session_guard').split('LANGUAGE')[0]).not.toMatch(
      /token_digest|session_id|slot_revision/,
    );
  });
  it('pins lock order and lock-after-clock/strict expiry; missing/legacy data never authenticates', () => {
    const guard = functionBody('identity_session_guard');
    expect(guard.indexOf('users AS u')).toBeLessThan(guard.indexOf('pg_advisory_xact_lock_shared'));
    expect(guard.indexOf('pg_advisory_xact_lock_shared')).toBeLessThan(
      guard.indexOf('credential_slots AS c'),
    );
    const sessionLock = guard.indexOf(
      'FROM zhiban_identity.sessions AS s WHERE s.token_digest=p_digest FOR SHARE',
    );
    expect(guard.indexOf('credential_slots AS c')).toBeLessThan(sessionLock);
    expect(sessionLock).toBeLessThan(guard.indexOf('clock_timestamp()'));
    expect(guard).toContain('clock_timestamp()');
    expect(guard).toContain('IS DISTINCT FROM TRUE');
    expect(guard).toContain('v_now<v_session.idle_expires_at');
    expect(guard).not.toMatch(/CURRENT_TIMESTAMP|p_now/);
  });
  it('discovery is bounded across all statuses, subject-filtered, context restored and not authorization', () => {
    const body = functionBody('identity_session_spaces');
    expect(body).toContain('LIMIT 1001');
    expect(body).toContain('v_count>1000');
    expect(body.match(/m.user_id=v_user.user_id/g)).toHaveLength(2);
    expect(body).toContain("coalesce(v_prior,'')");
    expect(body).not.toContain('role_grants');
    expect(sql).toContain('user_id=CASE');
  });
  it('reserves all dimensions before writes, bounds capacity, cleanup and max revision', () => {
    const reserve = functionBody('identity_admission_reserve');
    expect(reserve.indexOf('v_count>=v_limits')).toBeLessThan(reserve.indexOf('INSERT INTO'));
    expect(reserve.indexOf('bucket_count+v_new>')).toBeLessThan(reserve.indexOf('INSERT INTO'));
    expect(reserve).toContain('array_ndims(p_keys) IS DISTINCT FROM 1');
    expect(reserve).toContain('array_lower(p_keys,1) IS DISTINCT FROM 1');
    expect(reserve).toContain('9223372036854775807');
    const prune = functionBody('identity_admission_prune');
    expect(prune).toContain('p_limit NOT BETWEEN 1 AND 500');
    expect(prune).toContain('b.expires_at<=v_now');
    expect(prune).toContain('GET DIAGNOSTICS v_deleted=ROW_COUNT');
  });
  it('approval lifecycle/audit consistency is deferred, terminal and never grants audit SELECT', () => {
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql.indexOf('INSERT INTO zhiban_identity.identity_platform_bootstrap')).toBeLessThan(
      sql.indexOf('CREATE CONSTRAINT TRIGGER'),
    );
    for (const name of ['identity_bootstrap_consistency', 'identity_provision_consistency']) {
      const body = functionBody(name);
      expect(body).not.toMatch(/INSERT INTO|UPDATE zhiban_identity|DELETE FROM/);
      expect(body).toContain('audit_events');
      expect(sql).toContain(
        'REVOKE ALL ON FUNCTION zhiban_identity.' +
          name +
          '() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime',
      );
    }
    expect(sql).toContain(
      'GRANT INSERT(event_id) ON zhiban_identity.audit_events TO zhiban_auth_runtime,zhiban_control_runtime',
    );
    expect(sql).not.toMatch(/GRANT SELECT[^;]*audit_events/);
    expect(sql).not.toMatch(/GRANT.*EXECUTE[^;]*consistency/);
    expect(sql).toContain('OLD.consumed_at IS NOT NULL');
    expect(sql).not.toMatch(/ALTER TABLE zhiban_identity\.(users|credentials|sessions)/);
  });
});
