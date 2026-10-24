import type { PoolClient } from 'pg';
import { academicAdmin, requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import type {
  DirectoryQuery,
  DirectoryStudent,
  DirectoryPage,
  DirectoryTransaction,
} from '../../../application/directory/service';
export class DirectoryPgTransaction implements DirectoryTransaction {
  constructor(
    private readonly business: PoolClient,
    private readonly identity: PoolClient,
  ) {}
  async read(actor: AcademicActor, query: DirectoryQuery): Promise<DirectoryPage> {
    requireAcademic(academicAdmin(actor), 'FORBIDDEN');
    const exact = /^[0-9a-f-]{36}$/.test(query.q);
    const nameSearch = query.q !== '' && !exact;
    // Separate existing restricted roles. No cross-schema grant, user table access, or all-tenant DTO.
    const profiles = nameSearch
      ? (
          await this.business.query<{ membership_id: string; display_name: string }>(
            `
      SELECT membership_id,display_name FROM zhiban_academic.people
      WHERE tenant_id=$1 AND ($2::uuid IS NULL OR membership_id>$2)
        AND strpos(lower(display_name),lower($3))>0 ORDER BY membership_id LIMIT 201`,
            [actor.tenantId, query.after, query.q],
          )
        ).rows
      : null;
    if (profiles?.length === 0) return { students: [], next: null };
    const candidates = profiles?.slice(0, 200) ?? null;
    const result = await this.identity.query<Omit<DirectoryStudent, 'name'>>(
      `
      WITH students AS (
        SELECT m.membership_id AS "membershipId",m.status AS "membershipStatus",
          EXISTS(SELECT 1 FROM zhiban_identity.role_grants g
            WHERE g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id
              AND g.role_code='STUDENT' AND g.scope_kind='SELF' AND g.scope_id IS NULL
              AND g.revoked_at IS NULL AND g.valid_from<=$3 AND (g.valid_until IS NULL OR g.valid_until>$3)) AS "studentGrantActive"
        FROM zhiban_identity.memberships m
        WHERE m.tenant_id=$1 AND ($2::uuid IS NULL OR m.membership_id>$2)
          AND ($4::uuid[] IS NULL OR m.membership_id=ANY($4))
          AND ($5::uuid IS NULL OR m.membership_id=$5)
          AND EXISTS(SELECT 1 FROM zhiban_identity.role_grants h
            WHERE h.tenant_id=m.tenant_id AND h.membership_id=m.membership_id
              AND h.role_code='STUDENT' AND h.scope_kind='SELF' AND h.scope_id IS NULL)
      ) SELECT * FROM students WHERE $6::boolean OR ("membershipStatus"='ACTIVE' AND "studentGrantActive")
      ORDER BY "membershipId" LIMIT $7`,
      [
        actor.tenantId,
        query.after,
        actor.now,
        candidates?.map((p) => p.membership_id) ?? null,
        exact ? query.q : null,
        query.state === 'ALL',
        query.limit + 1,
      ],
    );
    const page = result.rows.slice(0, query.limit);
    const names =
      profiles ??
      (page.length
        ? (
            await this.business.query<{ membership_id: string; display_name: string }>(
              'SELECT membership_id,display_name FROM zhiban_academic.people WHERE tenant_id=$1 AND membership_id=ANY($2::uuid[])',
              [actor.tenantId, page.map((s) => s.membershipId)],
            )
          ).rows
        : []);
    const nameMap = new Map(names.map((p) => [p.membership_id, p.display_name]));
    const next =
      result.rows.length > query.limit
        ? page.at(-1)!.membershipId
        : profiles && profiles.length > 200
          ? candidates!.at(-1)!.membership_id
          : null;
    return {
      students: page.map((s) => ({ ...s, name: nameMap.get(s.membershipId) ?? null })),
      next,
    };
  }
}
