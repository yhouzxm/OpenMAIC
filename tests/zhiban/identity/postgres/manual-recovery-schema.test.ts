import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadMigrationFiles } from '@/lib/zhiban/infrastructure/identity/postgres/migrate';
const root = 'lib/zhiban/infrastructure/identity/postgres/migrations/',
  sql = readFileSync(root + '0010_identity_manual_recovery.sql', 'utf8');
// Exact frozen Git-byte SHA256 values at fcdf7872. This works in Actions' shallow
// candidate checkout without fetching history or treating current bytes as their own oracle.
const frozenChecksums = [
  'bd81a6bef9241e3173eea297e276d97787446d757c5b2b79bf4e6b8a4a1cb235',
  '6289d7bc1a53a63d4d66a8a79f6d9c0d96f5d59643911a4a395a5fc0be9f4703',
  'cd2480d062d55c4999cf71ca6670b17b006f4146e514ef7a576812c2829880bf',
  'd2ca67e1f274876ded48e8965d46bd9347795fac488c6d7e27ac0ceeb8677b1a',
  'dcb7d50a123b816def8f9374bfbd1f68e3d66e091a170278906783d0305ee0f9',
  'd0204f6d5e1894ffdc62df16e07700f31fb0ce968571e77f711af23b096e1bc0',
  '20d6ad486cd4c2afc8f3ab75591dfd7895b62118a07a3a086b469c77b3f5ef27',
  '0ace96db7b9fa5747219c47f42bdfd2cbc1a60bebf2f54b7fbe9afb8a19fe992',
  '91d064abb0238b57e1f2afe7a50f441befb947568789ca31b9a1e6277449753a',
] as const;
describe('E8 exact migration/ACL (static, not PG16 parser proof)', () => {
  it('adds only 0010 and preserves old Git bytes/checksums', async () => {
    const files = await loadMigrationFiles();
    expect(files.map((f) => f.version)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i + 1).toString().padStart(4, '0')),
    );
    for (const [i, file] of files.slice(0, 9).entries()) {
      expect(
        createHash('sha256')
          .update(readFileSync(root + file.name))
          .digest('hex'),
      ).toBe(frozenChecksums[i]);
      expect(file.checksum).toBe(frozenChecksums[i]);
    }
  });
  it('eight global closed tables, six callable helpers and two internal functions', () => {
    expect(
      [...sql.matchAll(/CREATE TABLE zhiban_identity\.([a-z_]+)/g)].map((m) => m[1]),
    ).toHaveLength(8);
    expect(sql.match(/CREATE FUNCTION /g)).toHaveLength(8);
    expect(sql.match(/SECURITY DEFINER/g)).toHaveLength(8);
    expect(sql.match(/SET row_security=on/g)).toHaveLength(8);
    expect(sql).not.toMatch(
      /ALTER ROLE|CREATE ROLE|ENABLE ROW LEVEL SECURITY|tenant_id|CREATE EXTENSION|gen_random_uuid|\bmd5\(/i,
    );
  });
  it('source-block accepts bounded server-issued distinct UUIDv7 batch and uses sorted fresh case reread', () => {
    const b = sql
      .split('CREATE FUNCTION zhiban_identity.identity_recovery_source_block')[1]
      .split('END $$;')[0];
    expect(b).toContain('p_event_ids uuid[]');
    expect(b).toContain('cardinality(p_event_ids)>256');
    expect(b).toContain('count(DISTINCT e)');
    expect(b).toContain('is_uuid_v7(e)');
    expect(b).toContain('ORDER BY case_id FOR UPDATE NOWAIT');
    expect(b).toContain('p_event_ids[event_index]');
    expect(b.indexOf('identity_recovery_gate')).toBeLessThan(b.indexOf("state='BLOCKED'"));
  });
  it('lock helpers protect FK phantom without whole User/grant privilege', () => {
    expect(sql).toContain('WHERE users.user_id=u FOR UPDATE NOWAIT');
    expect(sql).toContain('pg_try_advisory_xact_lock_shared');
    expect(sql).toContain("p_mode NOT IN ('LIVE','OUTCOME','CANCEL')");
    expect(sql).not.toMatch(
      /GRANT\s+(?:SELECT|UPDATE)[^;]*ON zhiban_identity\.(users|system_admin_grants)/,
    );
  });
  it('PUBLIC/tenant/control have no ticket capability; owner audit-read exception is outcome-linked', () => {
    expect(sql).toContain('FROM PUBLIC,zhiban_runtime,zhiban_control_runtime,zhiban_auth_runtime');
    expect(sql).toContain('CREATE POLICY audit_recovery_owner_read');
    expect(sql).toContain("event_type='CREDENTIAL_REPLACED' AND reason='ACCOUNT_RECOVERY'");
    expect(sql).toContain('o.credential_event_id=audit_events.event_id');
    expect(sql).not.toMatch(/GRANT[^;]*(?:credentials|sessions|audit_events)/);
  });
  it('immutable historical outcome allows legal later credential changes and notice ACK', () => {
    expect(sql).toContain('cr.slot_revision<o.slot_revision_after');
    expect(sql).toContain("newly_completed:=OLD.state<>'COMPLETED'");
    expect(sql).toContain('Immutable recovery history');
    expect(sql).toContain('NEW.repository_revision<>OLD.repository_revision+1');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });
  it('scope uses exact composite source ownership and closed event/receipt vocabulary', () => {
    expect(sql).toContain('source_id,environment_ref,source_kind,bound_user_id');
    expect(sql).toContain('FOREIGN KEY (subject_user_id,credential_id)');
    expect(sql).toContain('CHECK ((actor_user_id IS NULL)<>(service_code IS NULL))');
    expect(sql).not.toMatch(
      /\b(raw_token|new_password|password|verifier_material|arbitrary_json)\s+(?:text|jsonb)/,
    );
  });
});
