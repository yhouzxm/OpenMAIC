import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
it('provider receipt preserves provenance and hashes the ESM-resolved artifact', () => {
  const script = readFileSync('tests/zhiban/runtime/prepare-provider.mjs', 'utf8');
  expect(script).not.toMatch(/createRequire|require\.resolve/);
  for (const guard of [
    "process.env.GITHUB_ACTIONS !== 'true'",
    'head !== process.env.GITHUB_SHA',
    "!process.version.startsWith('v22.')",
    "process.platform !== 'linux'",
    "process.arch !== 'x64'",
    "RUNTIME_DSL_VERSION !== '0.1.0'",
    "typeof PgRuntimeStore !== 'function'",
    "['diff', '--exit-code', official, 'HEAD', '--', 'packages/@openmaic']",
    'sourceDigest: hash(source)',
    "lockDigest: hash(readFileSync('pnpm-lock.yaml'))",
    'artifactDigest: hash(readFileSync(artifact))',
  ])
    expect(script).toContain(guard);
});
it('real Node resolves the import-only provider and hashes the exact loaded artifact', () => {
  const script = readFileSync('tests/zhiban/runtime/prepare-provider.mjs', 'utf8'),
    declaration = script.match(/^const artifact = .*;$/m)?.[0];
  expect(declaration).toBeDefined();
  // Execute the receipt script's actual resolver, not Vitest's transformed import resolver.
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
${declaration}
const provider = await import(artifact.href);
let commonJsError;
try { createRequire(import.meta.url).resolve('@openmaic/storage/runtime/pg'); }
catch (error) { commonJsError = error.code; }
console.log(JSON.stringify({
  artifact: artifact.href,
  provider: typeof provider.PgRuntimeStore,
  digest: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
  commonJsError,
}));`,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 },
    ),
  );
  const expected = resolve('packages/@openmaic/storage/dist/runtime/pg.js');
  expect(result.artifact).toBe(pathToFileURL(expected).href);
  expect(result.provider).toBe('function');
  expect(result.digest).toBe(createHash('sha256').update(readFileSync(expected)).digest('hex'));
  expect(result.commonJsError).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
});
