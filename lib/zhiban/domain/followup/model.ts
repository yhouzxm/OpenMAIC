import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { discussionText } from '../discussion/model';
export type CaseCommand =
  | { type: 'CREATE_CASE'; activityId: string; version: number; membershipId: string; body: string }
  | { type: 'ADD_NOTE' | 'CLOSE_CASE' | 'REOPEN_CASE'; id: string; revision: string; body: string };
export function caseCommand(input: unknown): CaseCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  requireAcademic(
    ['CREATE_CASE', 'ADD_NOTE', 'CLOSE_CASE', 'REOPEN_CASE'].includes(String(v.type)),
  );
  const keys =
    v.type === 'CREATE_CASE'
      ? ['type', 'activityId', 'version', 'membershipId', 'body']
      : ['type', 'id', 'revision', 'body'];
  requireAcademic(Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k)));
  const body = discussionText(v.body, 2000);
  if (v.type === 'CREATE_CASE') {
    requireAcademic(
      typeof v.version === 'number' &&
        Number.isSafeInteger(v.version) &&
        v.version > 0 &&
        v.version <= 2147483647,
    );
    return {
      type: 'CREATE_CASE',
      activityId: academicId(v.activityId),
      version: v.version,
      membershipId: academicId(v.membershipId),
      body,
    };
  }
  return {
    type: v.type as 'ADD_NOTE' | 'CLOSE_CASE' | 'REOPEN_CASE',
    id: academicId(v.id),
    revision: academicRevision(v.revision),
    body,
  };
}
