import { createHash } from 'node:crypto';
export function debtFingerprint(file, message, line) {
  return createHash('sha256')
    .update(JSON.stringify([file, message.ruleId, message.message, line?.trim()]))
    .digest('hex');
}
export function admitsDebt(baseline, fingerprint, count, rule) {
  return (
    [
      '@typescript-eslint/no-explicit-any',
      '@typescript-eslint/no-require-imports',
      'prefer-const',
    ].includes(rule) && count <= (baseline.entries[fingerprint] ?? 0)
  );
}
