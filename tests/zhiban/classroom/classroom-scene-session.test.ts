import { describe, expect, it } from 'vitest';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { QueryResult, ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import { classroomSceneSessionsMigration } from '@/lib/zhiban/db/migrations/051-classroom-scene-sessions';
import {
  aggregateClassroomSceneResults,
  dispatchClassroomScene,
  extractConceptErrorsFromLearningEvent,
  getStudentCurrentClassroomDispatch,
  listDispatchableScenes,
  evaluateSignalTraceChoice,
} from '@/lib/zhiban/classroom';

const tenantId = '11111111-1111-4111-8111-111111111111';
const courseId = '22222222-2222-4222-8222-222222222222';
const bindingId = '33333333-3333-4333-8333-333333333333';

function principal(overrides: Partial<AuthorizedPrincipal> = {}): AuthorizedPrincipal {
  return {
    id: '44444444-4444-4444-8444-444444444444', tenantId,
    accountType: 'teacher', loginName: 'teacher', displayName: 'Teacher', status: 'active',
    roles: ['course_teacher'], permissions: ['course:manage'],
    grants: [{ roleCode: 'course_teacher', permission: 'course:manage', scopeType: 'course', scopeId: courseId }],
    ...overrides,
  } as AuthorizedPrincipal;
}

class SceneDatabase implements ZhibanDatabasePool, ZhibanDatabaseClient {
  sessions: Record<string, unknown>[] = [];
  studentAllowed = true;
  async connect() { return this; }
  release() {}
  async query<TRow extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<TRow>> {
    if (text.includes('SELECT id,course_id FROM zhiban.course_classrooms WHERE'))
      return { rows: [{ id: bindingId, course_id: courseId }] as unknown as TRow[] };
    if (text.includes('SELECT cc.id,cc.course_id FROM zhiban.course_classrooms'))
      return { rows: (this.studentAllowed ? [{ id: bindingId, course_id: courseId }] : []) as unknown as TRow[] };
    if (text.includes('SELECT * FROM zhiban.classroom_scene_sessions'))
      return { rows: this.sessions.slice(-1) as TRow[] };
    if (text.includes('UPDATE zhiban.classroom_scene_sessions SET status=\'COMPLETED\'')) {
      const row = this.sessions.find((item) => item.id === values?.[0]);
      if (row) row.status = 'COMPLETED';
      return { rows: (text.includes('RETURNING') && row ? [row] : []) as TRow[] };
    }
    if (text.includes('INSERT INTO zhiban.classroom_scene_sessions')) {
      const now = new Date().toISOString();
      const row = {
        id: values?.[0], course_classroom_id: values?.[2], active_scene_id: values?.[3],
        dispatch_type: values?.[4], dispatch_payload: JSON.parse(String(values?.[5])),
        status: values?.[6], version: values?.[7], started_at: now, completed_at: null,
        created_at: now, updated_at: now,
      };
      this.sessions.push(row);
      return { rows: [row] as unknown as TRow[] };
    }
    return { rows: [] };
  }
}

describe('classroom scene sessions', () => {
  it('adds a tenant-isolated shared session table without changing personal sessions', () => {
    const ddl = classroomSceneSessionsMigration.up.join('\n');
    expect(ddl).toContain('CREATE TABLE zhiban.classroom_scene_sessions');
    expect(ddl).toContain("dispatch_type IN ('SCENE','VIRTUAL_LAB')");
    expect(ddl).toContain('FORCE ROW LEVEL SECURITY');
    expect(ddl).not.toContain('ALTER TABLE zhiban.classroom_learning_sessions');
  });

  it('reads all 25 logical scenes from the unified registry', () => {
    expect(listDispatchableScenes()).toHaveLength(25);
    expect(listDispatchableScenes()).toContainEqual(expect.objectContaining({ id: 'S05-04' }));
  });

  it('creates a separate run and increments version instead of overwriting a challenge', async () => {
    const db = new SceneDatabase();
    const first = await dispatchClassroomScene(db, principal(), courseId, bindingId, { dispatchType: 'SCENE', sceneId: 'S05-04' });
    const second = await dispatchClassroomScene(db, principal(), courseId, bindingId, { dispatchType: 'SCENE', sceneId: 'S05-04' });
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(db.sessions).toHaveLength(2);
    expect(db.sessions[0].status).toBe('COMPLETED');
  });

  it('rejects dispatch without course:manage', async () => {
    const db = new SceneDatabase();
    await expect(dispatchClassroomScene(db, principal({ permissions: [], grants: [] }), courseId, bindingId, { dispatchType: 'SCENE', sceneId: 'S03-02' })).rejects.toThrow('Permission denied');
  });

  it('rejects a student who is not enrolled in the classroom course', async () => {
    const db = new SceneDatabase();
    db.studentAllowed = false;
    await expect(getStudentCurrentClassroomDispatch(db, principal({ accountType: 'student', permissions: ['course:read'], grants: [] }), bindingId)).rejects.toThrow('Classroom is unavailable');
  });

  it('extracts only existing Concept Error codes from either event shape', () => {
    expect(extractConceptErrorsFromLearningEvent({ conceptErrors: ['INPUT_OUTPUT_CONFUSION', 'NEW_CODE'] })).toEqual(['INPUT_OUTPUT_CONFUSION']);
    expect(extractConceptErrorsFromLearningEvent({ payload: { conceptErrors: ['FIELD_IO_MAPPING_ERROR'] } })).toEqual(['FIELD_IO_MAPPING_ERROR']);
  });

  it('aggregates participation, completion, optional correctness, time, first choice and distinct-student misconceptions', () => {
    const result = aggregateClassroomSceneResults([
      { studentId: 'a', payload: { eventType: 'INTERACTING', firstChoice: 'I0.2', isCorrect: false, durationMs: 5000, conceptErrors: ['INPUT_OUTPUT_CONFUSION'] } },
      { studentId: 'a', payload: { eventType: 'COMPLETE_SCENE', isCorrect: true, durationMs: 3000, conceptErrors: ['INPUT_OUTPUT_CONFUSION'] } },
      { studentId: 'b', payload: { eventType: 'COMPLETE_SCENE', firstChoice: 'S2', isCorrect: true, durationMs: 4000, conceptErrors: ['FIELD_IO_MAPPING_ERROR'] } },
    ]);
    expect(result).toMatchObject({ participants: 2, completed: 2, completionRate: 100, correctRate: 66.7, averageDurationMs: 4000 });
    expect(result.conceptErrors).toEqual(expect.arrayContaining([
      { code: 'INPUT_OUTPUT_CONFUSION', count: 1, percentage: 50 },
      { code: 'FIELD_IO_MAPPING_ERROR', count: 1, percentage: 50 },
    ]));
  });

  it('does not fabricate correctness or concept percentages when no applicable result exists', () => {
    expect(aggregateClassroomSceneResults([])).toEqual({ participants: 0, completed: 0, completionRate: 0, correctRate: null, averageDurationMs: null, firstChoice: [], conceptErrors: [] });
    expect(aggregateClassroomSceneResults([{ studentId: 'a', payload: { eventType: 'ENTER_SCENE' } }]).correctRate).toBeNull();
  });

  it('evaluates the deterministic 60-second signal trace without game scores', () => {
    expect(evaluateSignalTraceChoice('Q0.1')).toMatchObject({ isCorrect: false, conceptErrors: ['EVIDENCE_SELECTION_ERROR'] });
    expect(evaluateSignalTraceChoice('cylinder')).toMatchObject({ isCorrect: true, conceptErrors: [] });
  });
});
