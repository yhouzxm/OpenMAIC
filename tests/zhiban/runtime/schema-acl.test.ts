import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
const sql = readFileSync('tests/zhiban/runtime/schema.sql', 'utf8');
it('fixture inventory is outside 13 applied migrations; exact public and column capabilities', () => {
  expect(
    readdirSync('lib/zhiban/infrastructure/identity/postgres/migrations').filter((n) =>
      n.endsWith('.sql'),
    ),
  ).toHaveLength(13);
  expect(sql.match(/CREATE TABLE zhiban_runtime_contract_test\./g)).toHaveLength(6);
  expect(sql).toContain('FORCE ROW LEVEL SECURITY');
  expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  expect(sql).toContain("WHERE state IN ('RESERVED','OUTCOME_UNKNOWN')");
  expect(sql).toContain(
    'runtime_parent_context(uuid,uuid,uuid,uuid,uuid) TO zhiban_bridge_runtime',
  );
  expect(sql).not.toMatch(/GRANT.*(?:UPDATE|INSERT).*resources.*TO zhiban_bridge_runtime/);
  const privileges = sql
    .split('\n')
    .filter((line) => line.startsWith('GRANT '))
    .map((line) => line.split(' ON ')[0]);
  expect(privileges.some((line) => /\b(ALL|DELETE|TRUNCATE)\b/.test(line))).toBe(false);
  expect(sql).not.toMatch(/FROM .*\bold\b|JOIN .*\bold\b/);
  expect(sql).not.toContain("'{}'::aclitem[]");
});
it('fixture SQL requires atomic audits and immutable operation history', () => {
  expect(sql).toContain("OLD.state='OUTCOME_UNKNOWN'");
  expect(sql).toContain('Runtime orphan binding rejected');
  expect(sql).toContain('Runtime audit rejected');
  expect(sql).toContain('Runtime audit immutable');
  expect(sql).toContain('9223372036854775805');
  expect(sql).toContain('event_type=(CASE WHEN');
  expect(sql).toContain('anchor.native_updated_at<>(CASE WHEN');
  expect(sql.match(/\) IS TRUE\)/g)).toHaveLength(3);
  expect(sql).toContain('result_last_seq IS NOT DISTINCT FROM (CASE WHEN');
  // A structural guard, not a PostgreSQL/PLpgSQL parser signoff.
  const structural = sql.replace(/'(?:''|[^'])*'/g, "''");
  let depth = 0;
  for (const ch of structural) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    expect(depth >= 0).toBe(true);
  }
  expect(depth).toBe(0);
});
it('workflow integration is additive, explicit and retains all signed-off loops/tooling', () => {
  const identity = readFileSync('.github/workflows/zhiban-identity-pg16-security.yml', 'utf8'),
    storage = readFileSync('.github/workflows/storage-pg-contract.yml', 'utf8');
  expect(
    identity.match(/C9_PG16_REQUIRED=1 C9_PROVIDER_RECEIPT=.*pg16-runtime-foundation\.test\.ts/g),
  ).toHaveLength(2);
  expect(
    storage.match(/C9_NATIVE_REQUIRED=1 pnpm exec vitest run.*native-pg\.test\.ts/g),
  ).toHaveLength(2);
  for (const suite of [
    'contracts',
    'records',
    'protocol',
    'native-provider',
    'admission',
    'ai',
    'schema-acl',
  ])
    expect(identity.includes(`tests/zhiban/runtime/${suite}.test.ts`)).toBe(true);
  for (const suite of ['pg16-bridge', 'pg16-sessions', 'pg16-credentials', 'pg16-manual-recovery'])
    expect(identity.includes(`${suite}.test.ts`)).toBe(true);
  for (const source of [identity, storage]) {
    expect(source.includes('for pass in 1 2')).toBe(true);
    expect(source.includes('postgres:16')).toBe(true);
    expect(source.includes('--frozen-lockfile')).toBe(true);
  }
});
