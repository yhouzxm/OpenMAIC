import type { AuthenticatedRequestHandle } from '../identity/use-cases/authentication';
import type { TenantContext } from '../identity/ports/tenant-context';
import type { MembershipId } from '../../domain/identity';
import type { RepositoryRevision } from '../identity/ports/repository-types';

export type BridgeAction =
  | 'READ_PREVIEW'
  | 'READ_SCENE'
  | 'READ_ASSET'
  | 'PREPARE_CONTENT'
  | 'PREPARE_ASSET'
  | 'ACTIVATE_GENERATION'
  | 'SUSPEND'
  | 'RETIRE'
  | 'TRANSFER';
export interface BridgeRequest {
  readonly handle: AuthenticatedRequestHandle;
  readonly context: TenantContext;
  readonly actorMembershipId: MembershipId;
  readonly activityId: string;
  readonly expectedAuthorizationVersion: number;
  readonly expectedRevision: RepositoryRevision;
  readonly requestId: string;
}
export type BridgeResult =
  | Readonly<{ status: 'DENIED' }>
  | Readonly<{ status: 'SUCCEEDED'; revision: RepositoryRevision }>;
export interface OpenMAICResourceAccessPort {
  execute(action: BridgeAction, request: BridgeRequest, input: unknown): Promise<BridgeResult>;
}
/** No real Activity schema/catalog exists yet. The only current fact is unavailability. */
export interface BridgeResourceFactsPort<Client> {
  load(client: Client, activityId: string): Promise<Readonly<{ status: 'UNAVAILABLE' }>>;
}
export class UnavailableBridgeResourceFacts<Client> implements BridgeResourceFactsPort<Client> {
  async load(_client: Client, _activityId: string) {
    return Object.freeze({ status: 'UNAVAILABLE' as const });
  }
}
/** Current resource loader has no real Activity facts/catalog. Every action is closed. */
export class OpenMAICBridge {
  constructor(private readonly access: OpenMAICResourceAccessPort) {}
  execute(action: BridgeAction, request: BridgeRequest, input: unknown) {
    return this.access.execute(action, request, input);
  }
}
