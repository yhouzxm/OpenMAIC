import type { QueryResultRow } from 'pg';
import {
  membershipToRows,
  type MembershipRow,
  type RoleGrantRow,
} from '@/lib/zhiban/infrastructure/identity/postgres/mappers/membership';
import type { Membership } from '@/lib/zhiban/domain/identity';
import { tenant, member } from '../authorization/fixtures';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';

/** Stateful SQL model: effects derive from bound CAS parameters, not canned mutation responses. */
export class AuthorizationSqlHarness {
  parents = new Map<string, MembershipRow>();
  grants = new Map<string, RoleGrantRow[]>();
  users = new Map<string, { status: 'ACTIVE' | 'DISABLED'; revision: string }>();
  audits: unknown[][] = [];
  calls: { sql: string; params: unknown[] }[] = [];
  released = 0;
  tenantStatus = 'ACTIVE';
  tenantRevision = '1';
  failAudit = false;
  failCommit = false;
  malformed = false;
  constructor(members: readonly Membership[] = [member(10), member(20)]) {
    for (const m of members) {
      const rows = membershipToRows(m);
      this.parents.set(m.id, { ...rows.membership, repository_revision: '1' });
      this.grants.set(m.id, [...rows.roleGrants]);
      this.users.set(m.userId, { status: 'ACTIVE', revision: '1' });
    }
  }
  pool: TransactionPool = {
    connect: async () =>
      ({
        query: this.query,
        release: () => {
          this.released++;
        },
      }) as unknown as Awaited<ReturnType<TransactionPool['connect']>>,
  };
  private snapshot: {
    parents: Map<string, MembershipRow>;
    grants: Map<string, RoleGrantRow[]>;
    audits: unknown[][];
  } | null = null;
  query = async <R extends QueryResultRow>(sql: string, params?: unknown[]) => {
    const p = params ?? [];
    this.calls.push({ sql, params: [...p] });
    let rows: QueryResultRow[] = [];
    let command = 'SELECT';
    if (sql.startsWith('BEGIN')) {
      command = 'BEGIN';
      this.snapshot = {
        parents: structuredClone(this.parents),
        grants: structuredClone(this.grants),
        audits: structuredClone(this.audits),
      };
    } else if (sql === 'ROLLBACK') {
      command = 'ROLLBACK';
      if (this.snapshot) {
        this.parents = this.snapshot.parents;
        this.grants = this.snapshot.grants;
        this.audits = this.snapshot.audits;
      }
      this.snapshot = null;
    } else if (sql === 'COMMIT') {
      if (this.failCommit) throw new Error('private driver failure');
      command = 'COMMIT';
      this.snapshot = null;
    } else if (sql.includes('set_config')) rows = [{ set_config: p[0] }];
    else if (sql.includes('authorization_state(')) {
      const [t, actor, targets, mode] = p as [string, string, string[], string];
      if (
        t !== tenant ||
        this.tenantStatus !== 'ACTIVE' ||
        this.parents.get(actor)?.tenant_id !== t ||
        this.parents.get(actor)?.status !== 'ACTIVE' ||
        targets.some((x) => this.parents.get(x)?.tenant_id !== t)
      )
        throw Object.assign(new Error('private context'), { code: '42501' });
      const ids = new Set([actor, ...targets]);
      if (mode === 'GUARD_MEMBERSHIP')
        for (const [key, m] of this.parents)
          if (
            m.status === 'ACTIVE' &&
            this.grants
              .get(key)
              ?.some((g) => g.role_code === 'TENANT_ADMIN' && g.revoked_at === null)
          )
            ids.add(key);
      rows = [
        {
          fact_kind: 'TENANT',
          tenant_id: t,
          tenant_status: this.tenantStatus,
          tenant_revision: this.tenantRevision,
          membership_id: null,
          user_id: null,
          user_status: null,
          user_revision: null,
        },
        ...[...ids].sort().map((key) => {
          const m = this.parents.get(key)!,
            u = this.users.get(m.user_id)!;
          return {
            fact_kind: 'USER',
            tenant_id: t,
            tenant_status: null,
            tenant_revision: null,
            membership_id: key,
            user_id: m.user_id,
            user_status: u.status,
            user_revision: u.revision,
          };
        }),
      ];
      if (this.malformed) rows[0].tenant_revision = '01';
    } else if (sql.startsWith('SELECT DISTINCT m.membership_id'))
      rows = [...this.parents]
        .filter(
          ([key, m]) =>
            m.tenant_id === p[0] &&
            m.status === 'ACTIVE' &&
            this.grants
              .get(key)
              ?.some((g) => g.role_code === 'TENANT_ADMIN' && g.revoked_at === null),
        )
        .map(([key]) => ({ membership_id: key }))
        .sort((a, b) => a.membership_id.localeCompare(b.membership_id));
    else if (sql.startsWith('SELECT COALESCE(MAX'))
      rows = [{ next_ordinal: String(this.grants.get(String(p[1]))?.length ?? 0) }];
    else if (sql.startsWith('SELECT') && sql.includes('FROM zhiban_identity.memberships')) {
      const m = this.parents.get(String(p[1]));
      rows = m && m.tenant_id === p[0] ? [{ ...m }] : [];
    } else if (sql.startsWith('SELECT') && sql.includes('FROM zhiban_identity.role_grants'))
      rows = (this.grants.get(String(p[1])) ?? [])
        .filter((g) => g.tenant_id === p[0])
        .map((g) => ({ ...g }));
    else if (sql.startsWith('UPDATE zhiban_identity.memberships')) {
      command = 'UPDATE';
      const m = this.parents.get(String(p[6]));
      if (m && m.tenant_id === p[5] && m.repository_revision === p[7]) {
        const n = {
          ...m,
          status: String(p[0]) as MembershipRow['status'],
          authorization_version: String(p[1]),
          updated_at: String(p[2]),
          disabled_at: p[3] as string | null,
          disabled_reason: p[4] as string | null,
          repository_revision: (BigInt(m.repository_revision) + BigInt(1)).toString(),
        };
        this.parents.set(m.membership_id, n);
        rows = [{ ...n }];
      }
    } else if (sql.startsWith('UPDATE zhiban_identity.role_grants')) {
      command = 'UPDATE';
      const gs = this.grants.get(String(p[2])) ?? [];
      const g = gs.find(
        (g) => g.tenant_id === p[1] && g.grant_id === p[3] && g.revoked_at === null,
      );
      if (g) {
        const changed = { ...g, revoked_at: String(p[0]) };
        gs[gs.indexOf(g)] = changed;
        rows = [{ ...changed }];
      }
    } else if (sql.startsWith('INSERT INTO zhiban_identity.role_grants')) {
      command = 'INSERT';
      const g: RoleGrantRow = {
        grant_id: String(p[0]),
        tenant_id: String(p[1]),
        membership_id: String(p[2]),
        grant_ordinal: String(p[3]),
        role_code: String(p[4]) as RoleGrantRow['role_code'],
        scope_kind: String(p[5]) as RoleGrantRow['scope_kind'],
        scope_id: p[6] as string | null,
        created_at: String(p[7]),
        valid_from: String(p[8]),
        valid_until: p[9] as string | null,
        revoked_at: p[10] as string | null,
      };
      const gs = this.grants.get(g.membership_id)!;
      if (
        [...this.grants.values()].some((existing) =>
          existing.some((x) => x.grant_id === g.grant_id),
        )
      )
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      gs.push(g);
      rows = [{ ...g }];
    } else if (sql.startsWith('INSERT INTO zhiban_identity.audit_events')) {
      if (this.failAudit)
        throw Object.assign(new Error('sensitive driver detail'), { code: 'XX000' });
      command = 'INSERT';
      this.audits.push([...p]);
      rows = [{}];
    } else throw new Error('Unexpected SQL in authorization test model.');
    return {
      command,
      rows: rows as R[],
      rowCount:
        command === 'SELECT' || command === 'INSERT' || command === 'UPDATE' ? rows.length : null,
      oid: 0,
      fields: [],
    };
  };
}
