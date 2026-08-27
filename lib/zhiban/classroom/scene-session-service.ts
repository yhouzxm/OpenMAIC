import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { CONCEPT_ERROR_CODES, type ConceptErrorCode } from '@/lib/zhiban/learning-center';
import { getScene, SCENE_DEFINITIONS } from '@/lib/zhiban/scene-orchestration';
import { recordClassroomEvent, startClassroomSession } from './service';
import type {
  ClassroomSceneAnalytics,
  ClassroomSceneLearningEventPayload,
  ClassroomSceneSession,
  ClassroomSceneSessionStatus,
} from './types';

const VIRTUAL_LAB_ACTIVITY_ID = 'mech-lab-line-stop';

function canManageCourse(principal: AuthorizedPrincipal, courseId: string) {
  return principal.grants.some(
    (grant) =>
      grant.permission === 'course:manage' &&
      ((grant.scopeType === 'course' && grant.scopeId === courseId) ||
        grant.scopeType === 'tenant' ||
        grant.scopeType === 'system'),
  );
}

function mapSession(row: Record<string, unknown>): ClassroomSceneSession {
  return {
    id: String(row.id),
    courseClassroomId: String(row.course_classroom_id),
    activeSceneId: row.active_scene_id ? String(row.active_scene_id) : null,
    dispatchType: row.dispatch_type as ClassroomSceneSession['dispatchType'],
    dispatchPayload: (row.dispatch_payload as Record<string, unknown>) ?? {},
    status: row.status as ClassroomSceneSession['status'],
    version: Number(row.version),
    startedAt: row.started_at ? new Date(String(row.started_at)).toISOString() : null,
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function sceneSummary(sceneId: string | null) {
  const scene = sceneId ? getScene(sceneId) : null;
  return scene
    ? { id: scene.id, title: scene.title, stationId: scene.stationId, sceneType: scene.sceneType }
    : null;
}

async function requireManagedBinding(
  client: { query: ZhibanDatabasePool['query'] },
  principal: AuthorizedPrincipal,
  courseId: string,
  bindingId: string,
) {
  const result = await client.query<{ id: string; course_id: string }>(
    `SELECT id,course_id FROM zhiban.course_classrooms WHERE id=$1 AND course_id=$2 AND status<>'archived'`,
    [bindingId, courseId],
  );
  if (!result.rows[0] || !canManageCourse(principal, courseId)) throw new Error('Permission denied');
  return result.rows[0];
}

async function requireStudentBinding(
  client: { query: ZhibanDatabasePool['query'] },
  principal: AuthorizedPrincipal,
  bindingId: string,
) {
  const result = await client.query<{ id: string; course_id: string }>(
    `SELECT cc.id,cc.course_id FROM zhiban.course_classrooms cc
     JOIN zhiban.course_offerings o ON o.course_id=cc.course_id
     JOIN zhiban.enrollments e ON e.offering_id=o.id
     WHERE cc.id=$1 AND cc.status='published' AND e.student_id=$2 AND e.status='enrolled'
       AND (cc.opens_at IS NULL OR cc.opens_at<=now()) AND (cc.closes_at IS NULL OR cc.closes_at>=now())
     LIMIT 1`,
    [bindingId, principal.id],
  );
  if (!result.rows[0] || !principal.permissions.includes('course:read'))
    throw new Error('Classroom is unavailable');
  return result.rows[0];
}

async function latestSession(client: { query: ZhibanDatabasePool['query'] }, bindingId: string) {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM zhiban.classroom_scene_sessions WHERE course_classroom_id=$1 ORDER BY version DESC LIMIT 1`,
    [bindingId],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export function listDispatchableScenes() {
  return SCENE_DEFINITIONS.map((scene) => ({
    id: scene.id,
    title: scene.title,
    stationId: scene.stationId,
    sceneType: scene.sceneType,
  }));
}

export async function getManagedClassroomSceneSession(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  bindingId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireManagedBinding(client, principal, courseId, bindingId);
    const session = await latestSession(client, bindingId);
    return session ? { ...session, scene: sceneSummary(session.activeSceneId) } : null;
  });
}

export async function getStudentCurrentClassroomDispatch(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  bindingId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireStudentBinding(client, principal, bindingId);
    const session = await latestSession(client, bindingId);
    return session ? { ...session, scene: sceneSummary(session.activeSceneId) } : null;
  });
}

export async function dispatchClassroomScene(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  bindingId: string,
  input:
    | { dispatchType: 'SCENE'; sceneId: string; status?: Exclude<ClassroomSceneSessionStatus, 'COMPLETED'>; remediation?: boolean }
    | { dispatchType: 'VIRTUAL_LAB'; status?: Exclude<ClassroomSceneSessionStatus, 'COMPLETED'> },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireManagedBinding(client, principal, courseId, bindingId);
    await client.query(`SELECT id FROM zhiban.course_classrooms WHERE id=$1 FOR UPDATE`, [bindingId]);
    const current = await latestSession(client, bindingId);
    if (current && current.status !== 'COMPLETED')
      await client.query(
        `UPDATE zhiban.classroom_scene_sessions SET status='COMPLETED',completed_at=now(),updated_by=$2,updated_at=now() WHERE id=$1`,
        [current.id, principal.id],
      );
    const version = (current?.version ?? 0) + 1;
    const status = input.status ?? 'ACTIVE';
    const scene = input.dispatchType === 'SCENE' ? getScene(input.sceneId) : getScene('S06-02');
    if (!scene) throw new Error('Scene not found');
    const payload =
      input.dispatchType === 'SCENE'
        ? { title: scene.title, stationId: scene.stationId, remediation: Boolean(input.remediation) }
        : { activityId: VIRTUAL_LAB_ACTIVITY_ID, title: '自动输送系统智能故障诊断' };
    const id = randomUUID();
    const result = await client.query<Record<string, unknown>>(
      `INSERT INTO zhiban.classroom_scene_sessions
       (id,tenant_id,course_classroom_id,active_scene_id,dispatch_type,dispatch_payload,status,version,started_at,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,CASE WHEN $7='ACTIVE' THEN now() ELSE NULL END,$9,$9)
       RETURNING *`,
      [id, principal.tenantId, bindingId, scene.id, input.dispatchType, JSON.stringify(payload), status, version, principal.id],
    );
    const session = mapSession(result.rows[0]);
    return { ...session, scene: sceneSummary(session.activeSceneId) };
  });
}

export async function endClassroomSceneSession(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  bindingId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireManagedBinding(client, principal, courseId, bindingId);
    await client.query(`SELECT id FROM zhiban.course_classrooms WHERE id=$1 FOR UPDATE`, [bindingId]);
    const current = await latestSession(client, bindingId);
    if (!current) return null;
    const result = await client.query<Record<string, unknown>>(
      `UPDATE zhiban.classroom_scene_sessions SET status='COMPLETED',version=version+1,completed_at=COALESCE(completed_at,now()),updated_by=$2,updated_at=now() WHERE id=$1 RETURNING *`,
      [current.id, principal.id],
    );
    return mapSession(result.rows[0]);
  });
}

export function extractConceptErrorsFromLearningEvent(input: unknown): ConceptErrorCode[] {
  const object = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const nested = object.payload && typeof object.payload === 'object' ? object.payload as Record<string, unknown> : {};
  const values = Array.isArray(object.conceptErrors)
    ? object.conceptErrors
    : Array.isArray(nested.conceptErrors)
      ? nested.conceptErrors
      : [];
  return [...new Set(values.filter((value): value is ConceptErrorCode =>
    typeof value === 'string' && (CONCEPT_ERROR_CODES as readonly string[]).includes(value),
  ))];
}

export function aggregateClassroomSceneResults(
  rows: Array<{ studentId: string; payload: Record<string, unknown> }>,
): ClassroomSceneAnalytics {
  const participants = new Set(rows.map((row) => row.studentId));
  const completed = new Set(
    rows.filter((row) => row.payload.eventType === 'COMPLETE_SCENE').map((row) => row.studentId),
  );
  const correct = rows.filter((row) => typeof row.payload.isCorrect === 'boolean');
  const durations = rows
    .map((row) => row.payload.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const choices = new Map<string, number>();
  const concepts = new Map<string, Set<string>>();
  for (const row of rows) {
    if (typeof row.payload.firstChoice === 'string')
      choices.set(row.payload.firstChoice, (choices.get(row.payload.firstChoice) ?? 0) + 1);
    for (const code of extractConceptErrorsFromLearningEvent(row.payload)) {
      const students = concepts.get(code) ?? new Set<string>();
      students.add(row.studentId);
      concepts.set(code, students);
    }
  }
  const participantCount = participants.size;
  return {
    participants: participantCount,
    completed: completed.size,
    completionRate: participantCount ? Math.round((completed.size / participantCount) * 1000) / 10 : 0,
    correctRate: correct.length
      ? Math.round((correct.filter((row) => row.payload.isCorrect === true).length / correct.length) * 1000) / 10
      : null,
    averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    firstChoice: [...choices].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    conceptErrors: [...concepts].map(([code, students]) => ({
      code,
      count: students.size,
      percentage: participantCount ? Math.round((students.size / participantCount) * 1000) / 10 : 0,
    })).sort((a, b) => b.count - a.count),
  };
}

export async function getClassroomSceneAnalytics(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  bindingId: string,
  classroomSceneSessionId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireManagedBinding(client, principal, courseId, bindingId);
    const result = await client.query<{ student_id: string; payload: Record<string, unknown> }>(
      `SELECT s.student_id,e.payload FROM zhiban.classroom_learning_events e
       JOIN zhiban.classroom_learning_sessions s ON s.id=e.session_id
       WHERE s.course_classroom_id=$1 AND e.payload->>'classroomSceneSessionId'=$2`,
      [bindingId, classroomSceneSessionId],
    );
    return aggregateClassroomSceneResults(result.rows.map((row) => ({ studentId: row.student_id, payload: row.payload })));
  });
}

export async function recordClassroomSceneLearningEvent(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  bindingId: string,
  input: Omit<ClassroomSceneLearningEventPayload, 'classroomBindingId'>,
) {
  await withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireStudentBinding(client, principal, bindingId);
    const session = await client.query<{ id: string }>(
      `SELECT id FROM zhiban.classroom_scene_sessions WHERE id=$1 AND course_classroom_id=$2`,
      [input.classroomSceneSessionId, bindingId],
    );
    if (!session.rows[0]) throw new Error('Classroom task is unavailable');
  });
  await startClassroomSession(pool, principal, bindingId);
  const payload: ClassroomSceneLearningEventPayload = {
    ...input,
    classroomBindingId: bindingId,
    conceptErrors: extractConceptErrorsFromLearningEvent(input),
  };
  return recordClassroomEvent(pool, principal, bindingId, {
    eventId: randomUUID(),
    eventType: 'simulation_interacted',
    progressPercent: 0,
    payload: payload as unknown as Record<string, unknown>,
    occurredAt: input.timestamp,
  });
}
