import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { academicAdmin, requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import { onboardingDigest, type AccountRequestCommand } from '../../../domain/onboarding/model';
export class OnboardingPgTransaction {
  constructor(private readonly c: PoolClient) {}
  private async rows(sql: string, args: unknown[]) {
    return (await this.c.query(sql, args)).rows;
  }
  async read(a: AcademicActor, after: string | null, id: string | null) {
    requireAcademic(academicAdmin(a), 'FORBIDDEN');
    const rows = await this.rows(
      "SELECT id,name,subject_reference,requested_role,CASE WHEN state='READY' AND expires_at<=$4 THEN 'EXPIRED' ELSE state END AS state,revision::text,planned_user_id,claim_id,expires_at,created_at,updated_at,request_digest FROM zhiban_onboarding.requests WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id<$2) AND ($3::uuid IS NULL OR id=$3) ORDER BY id DESC LIMIT 21",
      [a.tenantId, after, id, a.now],
    );
    return { rows: rows.slice(0, 20), next: rows.length > 20 ? rows[19].id : null };
  }
  async execute(a: AcademicActor, c: AccountRequestCommand, key: string) {
    requireAcademic(academicAdmin(a), 'FORBIDDEN');
    await this.c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `onboarding-request:${a.tenantId}:${key}`,
    ]);
    const [old] = await this.rows(
      'SELECT * FROM zhiban_onboarding.commands WHERE tenant_id=$1 AND command_key=$2',
      [a.tenantId, key],
    );
    if (old) {
      requireAcademic(
        old.actor_id === a.membershipId && old.payload_digest === onboardingDigest(c),
        'CONFLICT',
      );
      return old.result;
    }
    let result;
    if (c.type === 'REQUEST_ACCOUNT') {
      const id = v7(),
        requestDigest = onboardingDigest({
          id,
          tenant: a.tenantId,
          requester: a.membershipId,
          name: c.name,
          subjectReference: c.subjectReference,
          requestedRole: c.requestedRole,
        });
      await this.c.query(
        "INSERT INTO zhiban_onboarding.requests(tenant_id,id,requester_member_id,name,subject_reference,requested_role,request_digest,state,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'REQUESTED',1,$8,$8)",
        [
          a.tenantId,
          id,
          a.membershipId,
          c.name,
          c.subjectReference,
          c.requestedRole,
          requestDigest,
          a.now,
        ],
      );
      result = { id, revision: '1' };
    } else {
      const r = await this.rows(
        'SELECT * FROM zhiban_onboarding.requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [a.tenantId, c.id],
      );
      requireAcademic(r.length === 1, 'NOT_FOUND');
      requireAcademic(
        String(r[0].revision) === c.revision && r[0].state === 'REQUESTED',
        'CONFLICT',
      );
      await this.c.query(
        "UPDATE zhiban_onboarding.requests SET state='WITHDRAWN',revision=revision+1,updated_at=$3 WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, c.id, a.now],
      );
      result = { id: c.id, revision: String(BigInt(c.revision) + BigInt(1)) };
    }
    await this.c.query(
      'INSERT INTO zhiban_onboarding.events(tenant_id,id,request_id,action,actor_ref,facts,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        a.tenantId,
        v7(),
        result.id,
        c.type,
        a.membershipId,
        JSON.stringify({ revision: result.revision }),
        a.now,
      ],
    );
    await this.c.query('INSERT INTO zhiban_onboarding.commands VALUES($1,$2,$3,$4,$5,$6)', [
      a.tenantId,
      key,
      a.membershipId,
      onboardingDigest(c),
      JSON.stringify(result),
      a.now,
    ]);
    return result;
  }
}
