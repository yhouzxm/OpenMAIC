import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { discussionText } from '../discussion/model';
export type TaskReference = { activityId: string; version: number };
export type RemediationCommand =
  | {
      type: 'ASSIGN_PLAN';
      caseId: string;
      revision: string;
      title: string;
      goal: string;
      dueAt: number | null;
      tasks: TaskReference[];
    }
  | {
      type: 'REPORT_TASK';
      id: string;
      revision: string;
      taskId: string;
      status: 'READY_FOR_REVIEW' | 'NEEDS_HELP';
      body: string;
    }
  | {
      type: 'REVIEW_PLAN';
      id: string;
      revision: string;
      outcome: 'ACHIEVED' | 'NEEDS_MORE';
      body: string;
    }
  | { type: 'CANCEL_PLAN'; id: string; revision: string; body: string };
export function remediationCommand(input: unknown): RemediationCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  const shapes: Record<string, string[]> = {
    ASSIGN_PLAN: ['type', 'caseId', 'revision', 'title', 'goal', 'dueAt', 'tasks'],
    REPORT_TASK: ['type', 'id', 'revision', 'taskId', 'status', 'body'],
    REVIEW_PLAN: ['type', 'id', 'revision', 'outcome', 'body'],
    CANCEL_PLAN: ['type', 'id', 'revision', 'body'],
  };
  const keys = shapes[String(v.type)];
  requireAcademic(
    keys && keys.length === Object.keys(v).length && keys.every((k) => Object.hasOwn(v, k)),
  );
  const revision = academicRevision(v.revision);
  if (v.type === 'ASSIGN_PLAN') {
    requireAcademic(
      v.dueAt === null ||
        (typeof v.dueAt === 'number' &&
          Number.isSafeInteger(v.dueAt) &&
          v.dueAt > 0 &&
          v.dueAt <= 8640000000000000),
    );
    requireAcademic(Array.isArray(v.tasks) && v.tasks.length >= 1 && v.tasks.length <= 5);
    const tasks = v.tasks.map((t) => {
      requireAcademic(
        !!t &&
          typeof t === 'object' &&
          !Array.isArray(t) &&
          Object.keys(t).sort().join(',') === 'activityId,version',
      );
      requireAcademic(
        typeof t.version === 'number' &&
          Number.isSafeInteger(t.version) &&
          t.version > 0 &&
          t.version <= 2147483647,
      );
      return { activityId: academicId(t.activityId), version: t.version };
    });
    requireAcademic(new Set(tasks.map((t) => t.activityId)).size === tasks.length);
    return {
      type: 'ASSIGN_PLAN',
      caseId: academicId(v.caseId),
      revision,
      title: discussionText(v.title, 120),
      goal: discussionText(v.goal, 2000),
      dueAt: v.dueAt as number | null,
      tasks,
    };
  }
  const id = academicId(v.id),
    body = discussionText(v.body, 2000);
  if (v.type === 'REPORT_TASK') {
    requireAcademic(v.status === 'READY_FOR_REVIEW' || v.status === 'NEEDS_HELP');
    return {
      type: 'REPORT_TASK',
      id,
      revision,
      taskId: academicId(v.taskId),
      status: v.status,
      body,
    };
  }
  if (v.type === 'REVIEW_PLAN') {
    requireAcademic(v.outcome === 'ACHIEVED' || v.outcome === 'NEEDS_MORE');
    return { type: 'REVIEW_PLAN', id, revision, outcome: v.outcome, body };
  }
  return { type: 'CANCEL_PLAN', id, revision, body };
}
