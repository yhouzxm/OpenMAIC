/** Server-only scope. No DTO can manufacture a formal provenance reference. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';
import type { AcademicActor } from '../../domain/academic/model';
import { requireAcademic } from '../../domain/academic/model';
type Row = Record<string, unknown>;
export type TrustedProof = {
  id: string;
  tenant: string;
  offering: string;
  member: string;
  attempt: string;
  activityVersion: number;
  digest: string;
};
const scope = new AsyncLocalStorage<{ proof: TrustedProof; leases: PoolClient[] }>();
let native: Pool | undefined;
export function configureCourseEvidenceGate(pool: Pool) {
  if (native) throw Error('Evidence gate already configured');
  native = pool;
}
export async function withCourseProof<T>(proof: TrustedProof, work: () => Promise<T>) {
  const state = { proof, leases: [] as PoolClient[] };
  return scope.run(state, async () => {
    try {
      return await work();
    } finally {
      for (const c of state.leases) {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
    }
  });
}
/** Invoked after the original Learning activity lock; leases live until its enclosing business commit. */
export async function courseEvidenceBarrier(
  a: AcademicActor,
  o: string,
  activity: Row,
  attempt: Row,
) {
  if (!native) return;
  const c = await native.connect();
  let retained = false;
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='2500ms'");
    const task = (
      await c.query(
        'SELECT enabled,created_at FROM zhiban_course_result_tasks WHERE tenant_id=$1 AND activity_id=$2 AND activity_version=$3 FOR SHARE',
        [a.tenantId, activity.id, attempt.activity_version],
      )
    ).rows[0];
    const anchor = (
      await c.query(
        'SELECT 1 FROM zhiban_course_result_anchors WHERE attempt_id=$1 AND tenant_id=$2 AND member_id=$3',
        [attempt.id, a.tenantId, a.membershipId],
      )
    ).rows[0];
    const required =
      !!anchor ||
      (!!task?.enabled && new Date(task.created_at).valueOf() <= Number(attempt.started_at));
    if (!required) return;
    const state = scope.getStore(),
      p = state?.proof;
    requireAcademic(
      p &&
        p.tenant === a.tenantId &&
        p.offering === o &&
        p.member === a.membershipId &&
        p.attempt === attempt.id &&
        p.activityVersion === Number(attempt.activity_version),
      'COURSE_RESULT_REQUIRED',
    );
    const found = (
      await c.query(
        'SELECT digest FROM zhiban_course_result_proofs WHERE id=$1 AND tenant_id=$2 AND member_id=$3 AND attempt_id=$4',
        [p.id, a.tenantId, a.membershipId, attempt.id],
      )
    ).rows[0];
    requireAcademic(found?.digest === p.digest, 'INVALID_STATE');
    state!.leases.push(c);
    retained = true;
  } finally {
    if (!retained) {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  }
}
