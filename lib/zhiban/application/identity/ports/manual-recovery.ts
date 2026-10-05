/** Recovery metadata only. Secret material belongs to the private Infrastructure receiver. */
export const recoveryStates = [
  'REGISTERED',
  'VERIFIED',
  'APPROVED',
  'TICKET_ISSUED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type RecoveryState = (typeof recoveryStates)[number];
export interface RecoveryCaseView {
  readonly caseId: string;
  readonly revision: string;
  readonly state: RecoveryState;
}
export interface RecoveryOutcomeView extends RecoveryCaseView {
  readonly status: 'COMPLETED' | 'NOT_COMPLETED' | 'OUTCOME_UNKNOWN';
  readonly commandRef: string | null;
  readonly notification: 'PENDING' | 'ACKNOWLEDGED' | null;
}
/** Explicit server backchannel; never instantiated from request/argv data. */
export interface RecoveryEvidenceStore {
  read(reference: string): Promise<{
    readonly canonical: string;
    readonly keyRef: string;
    readonly signature: string;
  } | null>;
  synchronized(): Promise<boolean>;
}
