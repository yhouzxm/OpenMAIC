import type {
  MembershipCompositionPort,
  MembershipAdmissionPort,
  MembershipCommandRequest,
  PendingMembershipRequest,
  MembershipConsentRequest,
} from '../ports/membership-composition';
import type { AuthenticatedRequestHandle, AuthenticationTransport } from './authentication';

/** Protocol-neutral closed use cases; no PG client, approval boolean or secret DTO. */
export class MembershipCommands {
  constructor(
    private readonly mutations: MembershipCompositionPort,
    private readonly admissions: MembershipAdmissionPort,
  ) {}
  execute(
    handle: AuthenticatedRequestHandle,
    request: MembershipCommandRequest,
    password: string,
    transport: AuthenticationTransport,
  ) {
    return this.mutations.execute(handle, request, password, transport);
  }
  invite(
    handle: AuthenticatedRequestHandle,
    request: PendingMembershipRequest,
    password: string,
    transport: AuthenticationTransport,
  ) {
    return this.admissions.invite(handle, request, password, transport);
  }
  consent(handle: AuthenticatedRequestHandle, request: MembershipConsentRequest) {
    return this.admissions.consent(handle, request);
  }
}
