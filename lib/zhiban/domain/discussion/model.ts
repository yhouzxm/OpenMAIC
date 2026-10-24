import { academicId, academicRevision, requireAcademic } from '../academic/model';

export type TopicState = 'DRAFT' | 'OPEN' | 'CLOSED' | 'ARCHIVED';
export type DiscussionCommand =
  | { type: 'CREATE_TOPIC'; title: string; description: string }
  | { type: 'EDIT_TOPIC'; id: string; revision: string; title: string; description: string }
  | { type: 'OPEN_TOPIC' | 'CLOSE_TOPIC' | 'ARCHIVE_TOPIC'; id: string; revision: string }
  | { type: 'POST_MESSAGE'; topicId: string; parentId: string | null; body: string }
  | {
      type: 'HIDE_POST' | 'RESTORE_POST';
      topicId: string;
      id: string;
      revision: string;
      reason: string;
    };

export function discussionText(value: unknown, max: number, empty = false): string {
  requireAcademic(typeof value === 'string');
  const text = value.trim();
  requireAcademic(text.isWellFormed() && text.length <= max && (empty || text.length > 0));
  requireAcademic(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text));
  return text;
}
export function discussionCommand(input: unknown): DiscussionCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    CREATE_TOPIC: ['title', 'description'],
    EDIT_TOPIC: ['id', 'revision', 'title', 'description'],
    OPEN_TOPIC: ['id', 'revision'],
    CLOSE_TOPIC: ['id', 'revision'],
    ARCHIVE_TOPIC: ['id', 'revision'],
    POST_MESSAGE: ['topicId', 'parentId', 'body'],
    HIDE_POST: ['topicId', 'id', 'revision', 'reason'],
    RESTORE_POST: ['topicId', 'id', 'revision', 'reason'],
  };
  requireAcademic(typeof v.type === 'string' && Object.hasOwn(fields, v.type));
  const keys = ['type', ...fields[v.type]];
  requireAcademic(Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k)));
  const type = v.type as DiscussionCommand['type'];
  if (type === 'CREATE_TOPIC')
    return {
      type,
      title: discussionText(v.title, 120),
      description: discussionText(v.description, 2000, true),
    };
  if (type === 'POST_MESSAGE')
    return {
      type,
      topicId: academicId(v.topicId),
      parentId: v.parentId === null ? null : academicId(v.parentId),
      body: discussionText(v.body, 4000),
    };
  if (type === 'HIDE_POST' || type === 'RESTORE_POST')
    return {
      type,
      topicId: academicId(v.topicId),
      id: academicId(v.id),
      revision: academicRevision(v.revision),
      reason: discussionText(v.reason, 1000),
    };
  const id = academicId(v.id),
    revision = academicRevision(v.revision);
  if (type === 'EDIT_TOPIC')
    return {
      type,
      id,
      revision,
      title: discussionText(v.title, 120),
      description: discussionText(v.description, 2000, true),
    };
  return { type, id, revision };
}
