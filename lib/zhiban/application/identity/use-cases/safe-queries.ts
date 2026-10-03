import type { AuthenticatedRequestHandle } from '../ports/authenticated-request';
import type {
  IdentitySafeQueriesPort,
  MemberPointQuery,
  ConsentContextQuery,
} from '../ports/safe-queries';

/** Locators are not authorization evidence; the security composition owns fresh checks. */
export class IdentitySafeQueries {
  constructor(private readonly port: IdentitySafeQueriesPort) {}
  passwordState(handle: AuthenticatedRequestHandle) {
    return this.port.passwordState(handle);
  }
  member(handle: AuthenticatedRequestHandle, query: MemberPointQuery) {
    return this.port.member(handle, query);
  }
  consentContext(handle: AuthenticatedRequestHandle, query: ConsentContextQuery) {
    return this.port.consentContext(handle, query);
  }
}
