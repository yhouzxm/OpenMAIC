import type { AuthenticatedRequestHandle } from '../identity/use-cases/authentication';
import type { TenantContext } from '../identity/ports/tenant-context';
import type { MembershipId } from '../../domain/identity';
import type { RepositoryRevision } from '../identity/ports/repository-types';

export type RuntimeCommand =
  | 'CREATE_RUNTIME'
  | 'APPEND_USER_RECORD'
  | 'APPEND_ASSISTANT_RECORD'
  | 'COMPLETE_RUNTIME'
  | 'ARCHIVE_RUNTIME';
export type RuntimeAction = RuntimeCommand | 'READ_SESSION' | 'READ_OUTCOME' | 'READ_RECORDS';
export interface RuntimeRequest {
  readonly handle: AuthenticatedRequestHandle;
  readonly context: TenantContext;
  readonly actorMembershipId: MembershipId;
  readonly expectedAuthorizationVersion: number;
  readonly expectedRevision: RepositoryRevision;
  readonly requestId: string;
  readonly bindingId: string;
}
export type RuntimeReason =
  | 'DENIED'
  | 'STALE'
  | 'INVALID_INPUT'
  | 'BUDGET_EXCEEDED'
  | 'STORAGE_FAILURE'
  | 'INTEGRITY_FAILURE'
  | 'CANCELLED'
  | 'OUTCOME_UNKNOWN';
export type RuntimeResult =
  | Readonly<{ status: 'DENIED' }>
  | Readonly<{ status: 'FAILED'; reason: RuntimeReason }>
  | Readonly<{
      status: 'SUCCEEDED';
      bindingId: string;
      revision: RepositoryRevision;
      state: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'FAILED';
      lastSeq: number | null;
    }>;
export interface ActivityRuntimePort {
  execute(action: RuntimeAction, request: RuntimeRequest, input: unknown): Promise<RuntimeResult>;
}
