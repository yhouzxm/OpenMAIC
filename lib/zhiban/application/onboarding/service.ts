import { createHmac, randomBytes } from 'node:crypto';
import type { AcademicContext, AcademicStore } from '../academic/service';
import { academicId, requireAcademic } from '../../domain/academic/model';
import { accountRequestCommand } from '../../domain/onboarding/model';
export class AccountRequestService {
  private readonly key = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = false,
  ) {}
  async read(x: AcademicContext, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    requireAcademic(
      Object.keys(input).every((k) => ['cursor', 'id'].includes(k)) && !(input.id && input.cursor),
    );
    const id = input.id ? academicId(input.id) : null;
    const mac = (s: string) =>
      createHmac('sha256', this.key)
        .update(JSON.stringify([x.tenantId, x.actorMembershipId]))
        .update(s)
        .digest('hex');
    let after: string | null = null;
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,256}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString(),
        [a, sig, ...rest] = raw.split(':');
      requireAcademic(
        !rest.length && sig === mac(a) && Buffer.from(raw).toString('base64url') === input.cursor,
      );
      after = academicId(a);
    }
    return this.store.run(x, null, async (a, t) => {
      requireAcademic(t.onboarding, 'UNAVAILABLE');
      const r = await t.onboarding.read(a, after, id);
      return {
        ...r,
        next: r.next ? Buffer.from(r.next + ':' + mac(r.next)).toString('base64url') : null,
      };
    });
  }
  execute(x: AcademicContext, value: unknown, key: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = accountRequestCommand(value);
    return this.store.run(x, null, (a, t) => {
      requireAcademic(t.onboarding, 'UNAVAILABLE');
      return t.onboarding.execute(a, c, key);
    });
  }
}
