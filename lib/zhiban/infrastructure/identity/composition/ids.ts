import { v7 } from 'uuid';
import {
  userId,
  tenantId,
  membershipId,
  roleId,
  roleGrantId,
  systemAdminGrantId,
} from '@/lib/zhiban/domain/identity';
import type { IdGeneratorPort } from '@/lib/zhiban/application/identity/ports/id-generator';
import { credentialId } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';

/** Provider default CSPRNG only: no caller random/msecs/seq/options. Clock rollback fails closed. */
export class IdentityIds implements IdGeneratorPort {
  #last = -1;
  private next() {
    const before = Date.now();
    if (
      !Number.isSafeInteger(before) ||
      before < this.#last ||
      before < 0 ||
      before > 281474976710655
    )
      throw new IdentityPortError('INTEGRITY_FAILURE');
    const id = v7();
    const timestamp = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    if (timestamp < this.#last || timestamp < before || timestamp > 281474976710655)
      throw new IdentityPortError('INTEGRITY_FAILURE');
    this.#last = timestamp;
    return userId(id);
  }
  nextUserId() {
    return userId(this.next());
  }
  nextTenantId() {
    return tenantId(this.next());
  }
  nextMembershipId() {
    return membershipId(this.next());
  }
  nextRoleId() {
    return roleId(this.next());
  }
  nextRoleGrantId() {
    return roleGrantId(this.next());
  }
  nextSystemAdminGrantId() {
    return systemAdminGrantId(this.next());
  }
  nextCredentialId() {
    return credentialId(this.next());
  }
  nextCommandId() {
    return this.next();
  }
}
