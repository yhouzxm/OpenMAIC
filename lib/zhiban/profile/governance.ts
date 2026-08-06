import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

function canManage(principal: AuthorizedPrincipal, courseId: string) {
  return principal.grants.some(
    (grant) =>
      grant.permission === 'course:manage' &&
      ((grant.scopeType === 'course' && grant.scopeId === courseId) ||
        grant.scopeType === 'tenant' ||
        grant.scopeType === 'system'),
  );
}

async function audit(
  client: { query: ZhibanDatabasePool['query'] },
  principal: AuthorizedPrincipal,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO zhiban.audit_log(tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata)
     VALUES($1,'account',$2,$3,'learner_profile',$4,$5::jsonb)`,
    [principal.tenantId, principal.id, action, resourceId, JSON.stringify(metadata)],
  );
}

async function requireEnrollment(
  client: { query: ZhibanDatabasePool['query'] },
  learnerId: string,
  courseId: string,
) {
  const result = await client.query(
    `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
     WHERE e.student_id=$1 AND o.course_id=$2 AND e.status='enrolled' LIMIT 1`,
    [learnerId, courseId],
  );
  if (!result.rows[0]) throw new Error('Learner is not enrolled in this course');
}

export async function getLearnerProfileDetail(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  learnerId: string,
  courseId: string,
) {
  if (principal.id !== learnerId && !canManage(principal, courseId))
    throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, learnerId, courseId);
    await client.query(
      `DELETE FROM zhiban.learning_events WHERE learner_id=$1 AND course_id=$2 AND expires_at<=now()`,
      [learnerId, courseId],
    );
    const [profile, snapshots, events, preference, corrections] = await Promise.all([
      client.query<Record<string, unknown>>(
        `SELECT p.*,c.code course_code,c.name course_name FROM zhiban.learner_profiles p JOIN zhiban.courses c ON c.id=p.course_id WHERE p.learner_id=$1 AND p.course_id=$2`,
        [learnerId, courseId],
      ),
      client.query<Record<string, unknown>>(
        `SELECT s.profile_version,s.dimensions,s.evidence_summary,s.algorithm_version,s.event_count,s.computed_at FROM zhiban.learner_profile_snapshots s JOIN zhiban.learner_profiles p ON p.id=s.profile_id WHERE p.learner_id=$1 AND p.course_id=$2 ORDER BY s.profile_version DESC LIMIT 30`,
        [learnerId, courseId],
      ),
      client.query<Record<string, unknown>>(
        `SELECT id,source_kind,event_type,project_id,classroom_binding_id,payload,occurred_at,received_at,expires_at FROM zhiban.learning_events WHERE learner_id=$1 AND course_id=$2 ORDER BY occurred_at DESC LIMIT 200`,
        [learnerId, courseId],
      ),
      client.query<Record<string, unknown>>(
        `SELECT collection_enabled,retention_days,changed_at FROM zhiban.learner_profile_preferences WHERE learner_id=$1 AND course_id=$2`,
        [learnerId, courseId],
      ),
      client.query<Record<string, unknown>>(
        `SELECT id,reason,status,resolution,created_at,resolved_at FROM zhiban.learner_profile_corrections WHERE learner_id=$1 AND course_id=$2 ORDER BY created_at DESC LIMIT 30`,
        [learnerId, courseId],
      ),
    ]);
    const profileId = String(profile.rows[0]?.id ?? learnerId);
    await audit(client, principal, 'learner_profile.viewed', profileId, {
      learnerId,
      courseId,
      viewerRole: principal.id === learnerId ? 'self' : 'course_manager',
    });
    return {
      profile: profile.rows[0] ?? null,
      snapshots: snapshots.rows,
      events: events.rows,
      preference: preference.rows[0] ?? { collection_enabled: true, retention_days: 730 },
      corrections: corrections.rows,
    };
  });
}

export async function setOwnProfilePreference(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { collectionEnabled: boolean; retentionDays: number },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal.id, courseId);
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.learner_profile_preferences(id,tenant_id,learner_id,course_id,collection_enabled,retention_days,changed_by)
       VALUES($1,$2,$3,$4,$5,$6,$3) ON CONFLICT(tenant_id,learner_id,course_id) DO UPDATE SET collection_enabled=EXCLUDED.collection_enabled,retention_days=EXCLUDED.retention_days,changed_by=EXCLUDED.changed_by,changed_at=now()`,
      [
        id,
        principal.tenantId,
        principal.id,
        courseId,
        input.collectionEnabled,
        input.retentionDays,
      ],
    );
    await client.query(
      `UPDATE zhiban.learning_events SET expires_at=occurred_at+($3||' days')::interval WHERE learner_id=$1 AND course_id=$2`,
      [principal.id, courseId, input.retentionDays],
    );
    await audit(client, principal, 'learner_profile.preference_changed', id, {
      courseId,
      ...input,
    });
    return { id, ...input };
  });
}

export async function requestOwnProfileCorrection(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  reason: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal.id, courseId);
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.learner_profile_corrections(id,tenant_id,learner_id,course_id,reason) VALUES($1,$2,$3,$4,$5)`,
      [id, principal.tenantId, principal.id, courseId, reason],
    );
    await audit(client, principal, 'learner_profile.correction_requested', id, { courseId });
    return { id, status: 'pending' };
  });
}

export async function resolveProfileCorrection(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  correctionId: string,
  input: { status: 'accepted' | 'rejected'; resolution: string },
) {
  if (!canManage(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<{ learner_id: string }>(
      `UPDATE zhiban.learner_profile_corrections SET status=$3,resolution=$4,resolved_by=$5,resolved_at=now(),updated_at=now()
       WHERE id=$1 AND course_id=$2 AND status='pending' RETURNING learner_id`,
      [correctionId, courseId, input.status, input.resolution, principal.id],
    );
    if (!result.rows[0]) throw new Error('Pending correction request not found');
    await audit(client, principal, `learner_profile.correction_${input.status}`, correctionId, {
      courseId,
      learnerId: result.rows[0].learner_id,
    });
    return { id: correctionId, ...input };
  });
}

export async function exportLearnerProfile(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  learnerId: string,
  courseId: string,
) {
  const detail = await getLearnerProfileDetail(pool, principal, learnerId, courseId);
  return {
    exportedAt: new Date().toISOString(),
    learnerId,
    courseId,
    ...detail,
  };
}
