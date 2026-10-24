import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { discussionText } from '../discussion/model';
export type ReminderCommand =
  | { type: 'SEND_REMINDER'; caseId: string; revision: string; title: string; body: string }
  | { type: 'CONFIRM_REMINDER'; id: string };
export function reminderCommand(input: unknown): ReminderCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  const keys =
    v.type === 'SEND_REMINDER' ? ['type', 'caseId', 'revision', 'title', 'body'] : ['type', 'id'];
  requireAcademic(
    ['SEND_REMINDER', 'CONFIRM_REMINDER'].includes(String(v.type)) &&
      Object.keys(v).length === keys.length &&
      keys.every((k) => Object.hasOwn(v, k)),
  );
  return v.type === 'SEND_REMINDER'
    ? {
        type: 'SEND_REMINDER',
        caseId: academicId(v.caseId),
        revision: academicRevision(v.revision),
        title: discussionText(v.title, 120),
        body: discussionText(v.body, 2000),
      }
    : { type: 'CONFIRM_REMINDER', id: academicId(v.id) };
}
