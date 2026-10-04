import { createHash } from 'node:crypto';
import { must, reference, exact } from './values';
export const budgetCeilings = Object.freeze({
  window_ms: 3600000,
  global_limit: 1000000,
  site_limit: 1000000,
  subject_limit: 1000000,
  max_buckets: 1000000,
  max_live_cases: 256,
  max_registered_per_subject: 4,
  max_total_cases: 1000000,
  max_pending_notifications: 256,
  max_notification_age_ms: 86400000,
  registered_ttl_ms: 86400000,
  submission_ttl_ms: 300000,
  ceremony_ttl_ms: 600000,
  max_submissions: 256,
  max_attempts_per_ticket: 5,
  max_process_requests: 64,
  body_timeout_ms: 30000,
  statement_timeout_ms: 30000,
});
export type RecoveryBudgets = { readonly [K in keyof typeof budgetCeilings]: number };
export interface RecoveryPolicy extends RecoveryBudgets {
  readonly environment_ref: string;
  readonly approval_ref: string;
}
export function policy(input: RecoveryPolicy) {
  exact(input, ['environment_ref', 'approval_ref', ...Object.keys(budgetCeilings)]);
  reference(input.environment_ref);
  reference(input.approval_ref);
  for (const k of Object.keys(budgetCeilings) as (keyof RecoveryBudgets)[])
    must(Number.isSafeInteger(input[k]) && input[k] > 0 && input[k] <= budgetCeilings[k]);
  must(
    input.subject_limit <= input.site_limit &&
      input.site_limit <= input.global_limit &&
      input.max_live_cases <= input.max_total_cases &&
      input.max_buckets >= 3 &&
      input.submission_ttl_ms <= input.ceremony_ttl_ms,
  );
  return Object.freeze({ ...input });
}
export function policyDigest(input: RecoveryPolicy) {
  const p = policy(input);
  return createHash('sha256')
    .update(
      JSON.stringify([
        'manual-recovery-policy-v1',
        ...['environment_ref', 'approval_ref', ...Object.keys(budgetCeilings)].map((k) => [
          k,
          p[k as keyof RecoveryPolicy],
        ]),
      ]),
    )
    .digest('hex');
}
