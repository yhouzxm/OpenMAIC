import { createHmac, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalLoginAlias } from '../../domain/login-identifiers/model';
import { AcademicError, requireAcademic, academicId } from '../../domain/academic/model';
import type { createIdentityComposition } from '../identity/composition/root';
import { bearerForCookie, digestBearer } from '../identity/sessions/session-material';
import { observedTransport } from '../identity/composition/admission';
import { controlTransaction } from '../identity/postgres/transactions';
import type { AuthenticatedRequestHandle } from '../../application/identity/use-cases/authentication';
type Composition = Awaited<ReturnType<typeof createIdentityComposition>>;
export class LoginIdentifiers {
  private readonly gateKey = randomBytes(32);
  constructor(
    private readonly auth: Pool,
    private readonly identity: Composition,
    readonly enabled: boolean,
  ) {}
  async own(raw: string, handle: AuthenticatedRequestHandle) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    const user = await this.identity.security.me(handle);
    const rows = (
      await this.auth.query('SELECT * FROM zhiban_login_identifiers.own($1,$2)', [
        digestBearer(raw),
        user.userId,
      ])
    ).rows;
    return { userId: user.userId, names: rows };
  }
  async mutate(
    raw: string,
    handle: AuthenticatedRequestHandle,
    v: { alias: string; revision: string; action: 'ACCEPT' | 'RETIRE'; password: string },
    peer: string,
    id: string,
  ) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    const user = await this.identity.security.me(handle);
    const fresh = await this.identity.security.login(
      user.userId,
      v.password,
      observedTransport(peer),
      id,
    );
    if (fresh.status !== 'ISSUED') throw new AcademicError('FORBIDDEN');
    const token = bearerForCookie(fresh.bearer),
      h = await this.identity.security.authenticate(token);
    requireAcademic(!!h, 'FORBIDDEN');
    try {
      return await controlTransaction(this.auth, async (client) => {
        const r = await client.query(
          'SELECT zhiban_login_identifiers.mutate($1,$2,$3,$4,$5,$6)::text AS revision',
          [digestBearer(raw), digestBearer(token), user.userId, v.alias, v.revision, v.action],
        );
        return {
          alias: v.alias,
          revision: r.rows[0].revision,
          state: v.action === 'ACCEPT' ? 'ACTIVE' : 'RETIRED',
        };
      });
    } finally {
      await this.identity.security.logout(h!, id);
    }
  }
  async login(
    identifier: unknown,
    password: string,
    peer: string,
    id: string,
    oldCookie: string | null,
  ) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    const alias = canonicalLoginAlias(identifier),
      keys = ['global', 'peer:' + peer, 'alias:' + (alias ?? 'invalid')].map((k) =>
        createHmac('sha256', this.gateKey).update(k).digest('hex'),
      );
    const allowed = (
      await this.auth.query('SELECT zhiban_login_identifiers.reserve($1::text[]) AS allowed', [
        keys,
      ])
    ).rows[0].allowed;
    if (!allowed) return { status: 'RATE_LIMITED' as const };
    const match = alias
      ? (
          await this.auth.query(
            "SELECT user_id,revision::text FROM zhiban_login_identifiers.names WHERE alias=$1 AND state='ACTIVE'",
            [alias],
          )
        ).rows[0]
      : null;
    // Both unknown and invalid aliases traverse the existing genuine dummy verification path.
    const result = await this.identity.security.login(
      match?.user_id ?? 'invalid',
      password,
      observedTransport(peer),
      id,
    );
    if (result.status !== 'ISSUED') return result;
    const token = bearerForCookie(result.bearer),
      h = await this.identity.security.authenticate(token);
    requireAcademic(!!h, 'FORBIDDEN');
    try {
      requireAcademic(!!match, 'FORBIDDEN');
      await controlTransaction(this.auth, (c) =>
        c.query('SELECT zhiban_login_identifiers.guard_login($1,$2,$3,$4)', [
          digestBearer(token),
          result.identity.userId,
          alias,
          match.revision,
        ]),
      );
    } catch {
      await this.identity.security.logout(h!, id);
      return { status: 'REJECTED' as const };
    }
    if (oldCookie) {
      const old = await this.identity.security.authenticate(oldCookie);
      if (old) await this.identity.security.logout(old, id);
    }
    return result;
  }
}
/** Only invoke after the tenant directory has authorized its current actor/page. */
export function memberLoginIdentifierReader(auth: Pool) {
  return {
    async page(ids: readonly string[]) {
      requireAcademic(ids.length <= 50 && new Set(ids).size === ids.length, 'UNAVAILABLE');
      ids.forEach(academicId);
      const rows = ids.length
        ? (
            await auth.query(
              "SELECT user_id,alias FROM zhiban_login_identifiers.names WHERE user_id=ANY($1::uuid[]) AND state='ACTIVE'",
              [ids],
            )
          ).rows
        : [];
      return new Map<string, string>(rows.map((r) => [r.user_id, r.alias]));
    },
    async find(alias: string) {
      requireAcademic(canonicalLoginAlias(alias) === alias, 'INVALID_INPUT');
      return (
        (
          await auth.query(
            "SELECT user_id FROM zhiban_login_identifiers.names WHERE alias=$1 AND state='ACTIVE'",
            [alias],
          )
        ).rows[0]?.user_id ?? null
      );
    },
  };
}
