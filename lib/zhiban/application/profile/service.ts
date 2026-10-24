import { validatePng } from '../../infrastructure/content/png';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import type { AcademicStore, AcademicContext } from '../academic/service';
import {
  academicId,
  academicText,
  requireAcademic,
  type AcademicActor,
  academicAdmin,
} from '../../domain/academic/model';
import { canonicalLoginAlias } from '../../domain/login-identifiers/model';
import { profileCommand, type ProfileCommand } from '../../domain/profile/model';
export type MemberQuery = {
  q: string;
  state: string;
  role: string;
  limit: number;
  after: string | null;
  loginUserId?: string;
};
export interface ProfileTransaction {
  own(actor: AcademicActor): Promise<Record<string, unknown>>;
  members(
    actor: AcademicActor,
    query: MemberQuery,
  ): Promise<{ rows: Record<string, unknown>[]; next: string | null }>;
  execute(
    actor: AcademicActor,
    command: ProfileCommand,
    key: string,
  ): Promise<Record<string, unknown>>;
}
/** Display projection only, invoked with the current authorized tenant page's exact UserIds. */
export type MemberGlobalStatusReader = (
  ids: readonly string[],
) => Promise<{ states: ReadonlyMap<string, 'ACTIVE' | 'DISABLED'>; asOf: number }>;
export interface MemberLoginIdentifierReader {
  page(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  find(alias: string): Promise<string | null>;
}
export class ProfileService {
  private readonly key = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly globalStatus?: MemberGlobalStatusReader,
    private readonly loginIdentifiers?: MemberLoginIdentifierReader,
  ) {}
  own(context: AcademicContext) {
    return this.store.run(context, null, (a, tx) => {
      requireAcademic(!!tx.profile, 'UNAVAILABLE');
      return tx.profile!.own(a);
    });
  }
  members(context: AcademicContext, input: Record<string, string>) {
    requireAcademic(
      Object.keys(input).every((k) => ['q', 'state', 'role', 'limit', 'cursor'].includes(k)),
    );
    const q = academicText((input.q ?? '').trim(), 120, true),
      state = input.state ?? 'ACTIVE',
      role = input.role ?? 'ALL',
      limit = input.limit ?? '20';
    if (/^[0-9a-f-]{36}$/i.test(q)) academicId(q);
    requireAcademic(q.isWellFormed() && ['10', '20', '50'].includes(limit));
    requireAcademic(
      ['ALL', 'PENDING', 'ACTIVE', 'DISABLED', 'LEFT'].includes(state) &&
        ['ALL', 'STUDENT', 'TEACHER', 'TENANT_ADMIN', 'MEMBER'].includes(role),
    );
    const query: MemberQuery = { q, state, role, limit: Number(limit), after: null };
    const binding = JSON.stringify([context.tenantId, context.actorMembershipId, query]);
    const sign = (id: string) =>
      createHmac('sha256', this.key).update(binding).update(id).digest('hex');
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString();
      requireAcademic(Buffer.from(raw).toString('base64url') === input.cursor);
      const [id, mac, ...rest] = raw.split(':');
      academicId(id);
      requireAcademic(
        !rest.length &&
          /^[a-f0-9]{64}$/.test(mac) &&
          timingSafeEqual(Buffer.from(mac), Buffer.from(sign(id))),
      );
      query.after = id;
    }
    return this.store.run(context, null, async (a, tx) => {
      requireAcademic(!!tx.profile, 'UNAVAILABLE');
      requireAcademic(academicAdmin(a), 'FORBIDDEN');
      const alias = canonicalLoginAlias(q);
      let noAliasTarget = false;
      if (q.startsWith('@')) {
        requireAcademic(!!this.loginIdentifiers, 'UNAVAILABLE');
        const uid = alias ? await this.loginIdentifiers!.find(alias) : null;
        noAliasTarget = !uid;
        if (uid) query.loginUserId = uid;
      }
      const page = noAliasTarget ? { rows: [], next: null } : await tx.profile!.members(a, query);
      // Never accept caller-supplied UserIds or treat a displayed state as an authorization fact.
      const ids = [...new Set(page.rows.map((row) => academicId(row.userId)))];
      const global = ids.length && this.globalStatus ? await this.globalStatus(ids) : null;
      const aliases = this.loginIdentifiers ? await this.loginIdentifiers.page(ids) : null;
      return {
        rows: page.rows.map((row) => ({
          ...row,
          globalStatus: global?.states.get(String(row.userId)) ?? 'UNKNOWN',
          loginAlias: aliases?.get(String(row.userId)) ?? null,
        })),
        loginIdentifiersAvailable: aliases !== null,
        globalStatusAsOf: global?.asOf ?? null,
        nextCursor: page.next
          ? Buffer.from(`${page.next}:${sign(page.next)}`).toString('base64url')
          : null,
        asOf: a.now,
      };
    });
  }
  command(context: AcademicContext, scope: 'me' | 'members', input: unknown, key: string) {
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = profileCommand(input);
    requireAcademic((scope === 'me') === (c.type === 'SAVE_PROFILE' || c.type === 'SAVE_AVATAR'));
    if (c.type === 'SAVE_AVATAR' && c.png !== null) {
      try {
        const bytes = Buffer.from(c.png, 'base64');
        requireAcademic(bytes.toString('base64') === c.png && bytes.length <= 12288);
        const validated = validatePng(bytes);
        requireAcademic(validated.width <= 96 && validated.height <= 96);
        c.png = validated.bytes.toString('base64');
      } catch {
        requireAcademic(false);
      }
    }
    return this.store.run(context, null, (a, tx) => {
      requireAcademic(!!tx.profile, 'UNAVAILABLE');
      return tx.profile!.execute(a, c, key);
    });
  }
}
