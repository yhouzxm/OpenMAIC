import { recoveryStates } from '@/lib/zhiban/application/identity/ports/manual-recovery';
import { must, revision, time, reference, digest, uuid } from './values';
import { checkRow } from '../postgres/mappers/checked-values';
export const registrationColumns = [
  'case_id',
  'environment_ref',
  'site_ref',
  'subject_user_id',
  'verifier_user_id',
  'actor_user_id',
  'enrollment_source_id',
  'appointment_source_id',
  'contact_source_id',
  'expected_enrollment_source_revision',
  'expected_appointment_source_revision',
  'expected_contact_source_revision',
  'registration_manifest_digest',
  'registration_key_ref',
  'approval_ref',
  'intent',
  'security_clearance_ref',
  'expected_subject_user_revision',
  'expected_verifier_user_revision',
  'expected_slot_revision',
  'expected_security_epoch',
  'expected_credential_id',
  'expected_generation',
  'expected_actor_user_revision',
  'expected_actor_slot_revision',
  'expected_actor_security_epoch',
  'actor_admin_grant_id',
  'expected_admin_grant_revision',
  'state',
  'repository_revision',
  'ticket_generation',
  'created_at',
  'registered_expires_at',
];
export const caseColumns = [
  'case_id',
  'environment_ref',
  'site_ref',
  'subject_user_id',
  'verifier_user_id',
  'actor_user_id',
  'enrollment_source_id',
  'appointment_source_id',
  'contact_source_id',
  'expected_enrollment_source_revision',
  'expected_appointment_source_revision',
  'expected_contact_source_revision',
  'registration_manifest_digest',
  'registration_key_ref',
  'approval_ref',
  'intent',
  'security_clearance_ref',
  'expected_subject_user_revision',
  'expected_verifier_user_revision',
  'expected_slot_revision',
  'expected_security_epoch',
  'expected_credential_id',
  'expected_generation',
  'expected_actor_user_revision',
  'expected_actor_slot_revision',
  'expected_actor_security_epoch',
  'actor_admin_grant_id',
  'expected_admin_grant_revision',
  'state',
  'repository_revision',
  'ticket_generation',
  'created_at',
  'registered_expires_at',
  'enrollment_kind',
  'appointment_kind',
  'contact_kind',
  'approval_manifest_digest',
  'approval_key_ref',
  'verified_at',
  'approved_at',
  'expires_at',
  'completed_at',
  'terminal_at',
  'terminal_reason',
  'pre_notice_receipt_ref',
  'delivery_receipt_ref',
];
const caseNullable = [
  'expected_credential_id',
  'security_clearance_ref',
  'approval_manifest_digest',
  'approval_key_ref',
  'verified_at',
  'approved_at',
  'expires_at',
  'completed_at',
  'terminal_at',
  'terminal_reason',
  'pre_notice_receipt_ref',
  'delivery_receipt_ref',
];
export type CaseRecord = { readonly [K in (typeof caseColumns)[number]]: string | null } & {
  readonly case_id: string;
  readonly environment_ref: string;
  readonly site_ref: string;
  readonly subject_user_id: string;
  readonly verifier_user_id: string;
  readonly actor_user_id: string;
  readonly repository_revision: string;
  readonly ticket_generation: string;
  readonly enrollment_source_id: string;
  readonly appointment_source_id: string;
  readonly contact_source_id: string;
  readonly expected_slot_revision: string;
  readonly expected_security_epoch: string;
  readonly expected_generation: string;
  readonly expected_actor_slot_revision: string;
  readonly expected_actor_security_epoch: string;
  readonly expected_actor_user_revision: string;
  readonly expected_subject_user_revision: string;
  readonly expected_verifier_user_revision: string;
  readonly expected_admin_grant_revision: string;
  readonly actor_admin_grant_id: string;
  readonly expected_enrollment_source_revision: string;
  readonly expected_appointment_source_revision: string;
  readonly expected_contact_source_revision: string;
  readonly registration_manifest_digest: string;
  readonly registration_key_ref: string;
  readonly approval_ref: string;
  readonly intent: string;
  readonly state: (typeof recoveryStates)[number];
  readonly created_at: string;
  readonly registered_expires_at: string;
};
export function caseRecord(input: unknown): CaseRecord {
  checkRow(input, caseColumns, caseNullable);
  const c = input as CaseRecord;
  must(recoveryStates.includes(c.state));
  for (const [k, v] of Object.entries(c)) {
    if (v === null) continue;
    if (k.endsWith('_revision') || k.endsWith('_epoch') || k === 'expected_generation') revision(v);
    else if (k === 'ticket_generation')
      must(/^(0|[1-9][0-9]*)$(?![\s\S])/.test(v) && BigInt(v) <= BigInt('9223372036854775807'));
    else if (k.endsWith('_at')) time(v);
    else if (k.endsWith('_ref')) reference(v);
    else if (k.endsWith('_digest')) digest(v);
    else if (k.endsWith('_id')) uuid(v);
  }
  must(
    c.subject_user_id !== c.actor_user_id &&
      c.verifier_user_id !== c.actor_user_id &&
      c.subject_user_id !== c.verifier_user_id,
  );
  must(
    c.enrollment_kind === 'ENROLLMENT' &&
      c.appointment_kind === 'APPOINTMENT' &&
      c.contact_kind === 'CONTACT',
  );
  must(time(c.registered_expires_at) > time(c.created_at));
  must((c.approval_manifest_digest === null) === (c.approval_key_ref === null));
  must((c.approved_at === null) === (c.approval_manifest_digest === null));
  must((c.approved_at === null) === (c.pre_notice_receipt_ref === null));
  must((c.ticket_generation === '0') === (c.delivery_receipt_ref === null));
  if (c.ticket_generation !== '0') must(c.approved_at !== null);
  if (c.state === 'REGISTERED')
    must(c.verified_at === null && c.approved_at === null && c.ticket_generation === '0');
  if (c.state === 'VERIFIED') must(c.approved_at === null && c.ticket_generation === '0');
  if (c.state === 'APPROVED') must(c.ticket_generation === '0');
  if (c.terminal_reason !== null)
    must(
      [
        'SOURCE_BLOCKED',
        'USER_REQUEST',
        'VERIFICATION_REJECTED',
        'DEADLINE_REACHED',
        'DELIVERY_FAILED',
        'SECURITY_POLICY',
      ].includes(c.terminal_reason),
    );
  if (c.verified_at !== null) must(time(c.expires_at) === time(c.verified_at) + 1800000);
  must((c.verified_at === null) === (c.expires_at === null));
  if (c.verified_at !== null) must(time(c.verified_at) >= time(c.created_at));
  if (c.approved_at !== null)
    must(time(c.approved_at) >= time(c.verified_at) && time(c.approved_at) < time(c.expires_at));
  const terminal = ['COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(c.state);
  must(
    terminal === (c.terminal_at !== null) &&
      (c.state === 'COMPLETED') === (c.completed_at !== null),
  );
  must(['REJECTED', 'CANCELLED', 'EXPIRED'].includes(c.state) === (c.terminal_reason !== null));
  if (c.terminal_at !== null) must(time(c.terminal_at) >= time(c.created_at));
  if (c.completed_at !== null)
    must(time(c.completed_at) >= time(c.approved_at) && time(c.completed_at) < time(c.expires_at));
  if (['VERIFIED', 'APPROVED', 'TICKET_ISSUED', 'COMPLETED'].includes(c.state))
    must(c.verified_at !== null);
  if (['APPROVED', 'TICKET_ISSUED', 'COMPLETED'].includes(c.state))
    must(
      c.approved_at !== null &&
        c.approval_manifest_digest !== null &&
        c.approval_key_ref !== null &&
        c.pre_notice_receipt_ref !== null,
    );
  if (['TICKET_ISSUED', 'COMPLETED'].includes(c.state))
    must(c.ticket_generation !== '0' && c.delivery_receipt_ref !== null);
  must(
    (c.intent === 'REPLACE_ACTIVE_PASSWORD' &&
      c.expected_credential_id !== null &&
      c.security_clearance_ref === null) ||
      (c.intent === 'REESTABLISH_REVOKED_PASSWORD' &&
        c.expected_credential_id === null &&
        c.security_clearance_ref !== null),
  );
  return Object.freeze({ ...c });
}
export const ticketColumns = [
  'ticket_id',
  'case_id',
  'ticket_generation',
  'ticket_digest',
  'state',
  'attempts',
  'created_at',
  'expires_at',
  'terminal_at',
  'repository_revision',
] as const;
export type TicketRecord = { readonly [K in (typeof ticketColumns)[number]]: string | null } & {
  ticket_id: string;
  case_id: string;
  ticket_generation: string;
  ticket_digest: string;
  state: string;
  attempts: string;
  created_at: string;
  expires_at: string;
  repository_revision: string;
};
export function ticketRecord(input: unknown): TicketRecord {
  checkRow(input, ticketColumns, ['terminal_at']);
  const t = input as TicketRecord;
  uuid(t.ticket_id);
  uuid(t.case_id);
  revision(t.repository_revision);
  revision(t.ticket_generation);
  digest(t.ticket_digest);
  must(
    ['ACTIVE', 'CANCELLED', 'CONSUMED', 'EXPIRED'].includes(t.state) &&
      /^[0-5]$(?![\s\S])/.test(t.attempts),
  );
  must(
    time(t.expires_at) > time(t.created_at) && time(t.expires_at) <= time(t.created_at) + 600000,
  );
  must((t.state === 'ACTIVE') === (t.terminal_at === null));
  if (t.terminal_at !== null) must(time(t.terminal_at) >= time(t.created_at));
  return Object.freeze({ ...t });
}
