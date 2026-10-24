import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { discussionText } from '../discussion/model';
import { exact } from '../quiz/model';
export type AttainmentCommand =
  | {
      type: 'SET_CERT_RULE';
      offeringId: string;
      revision: string;
      title: string;
      threshold: number;
      enabled: boolean;
    }
  | {
      type: 'ISSUE_CERT';
      offeringId: string;
      memberId: string;
      ruleRevision: string;
      totalId: string;
      sourceDigest: string;
    }
  | { type: 'REVOKE_CERT' | 'REVOKE_CREDIT'; id: string; revision: string; reason: string }
  | {
      type: 'SET_CREDIT_RULE';
      id: string;
      revision: string;
      sourceCourse: string;
      targetCourse: string;
      title: string;
      creditsTenths: number;
      threshold: number;
      enabled: boolean;
    }
  | {
      type: 'AWARD_CREDIT';
      ruleId: string;
      ruleRevision: string;
      offeringId: string;
      memberId: string;
      totalId: string;
      sourceDigest: string;
      reason: string;
    };
export function attainmentCommand(input: unknown): AttainmentCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  const shapes: Record<string, string[]> = {
    SET_CERT_RULE: ['offeringId', 'revision', 'title', 'threshold', 'enabled'],
    ISSUE_CERT: ['offeringId', 'memberId', 'ruleRevision', 'totalId', 'sourceDigest'],
    REVOKE_CERT: ['id', 'revision', 'reason'],
    REVOKE_CREDIT: ['id', 'revision', 'reason'],
    SET_CREDIT_RULE: [
      'id',
      'revision',
      'sourceCourse',
      'targetCourse',
      'title',
      'creditsTenths',
      'threshold',
      'enabled',
    ],
    AWARD_CREDIT: [
      'ruleId',
      'ruleRevision',
      'offeringId',
      'memberId',
      'totalId',
      'sourceDigest',
      'reason',
    ],
  };
  requireAcademic(Object.hasOwn(shapes, String(v.type)));
  exact(v, ['type', ...shapes[String(v.type)]]);
  for (const k of [
    'offeringId',
    'memberId',
    'totalId',
    'id',
    'ruleId',
    'sourceCourse',
    'targetCourse',
  ])
    if (k in v) academicId(v[k]);
  for (const k of ['revision', 'ruleRevision']) if (k in v) academicRevision(v[k]);
  if ('threshold' in v)
    requireAcademic(
      Number.isInteger(v.threshold) && Number(v.threshold) >= 0 && Number(v.threshold) <= 10000,
    );
  if ('creditsTenths' in v)
    requireAcademic(
      Number.isInteger(v.creditsTenths) &&
        Number(v.creditsTenths) >= 1 &&
        Number(v.creditsTenths) <= 300,
    );
  if ('enabled' in v) requireAcademic(typeof v.enabled === 'boolean');
  if ('sourceDigest' in v)
    requireAcademic(typeof v.sourceDigest === 'string' && /^[a-f0-9]{64}$/.test(v.sourceDigest));
  if ('title' in v) v.title = discussionText(v.title, 120);
  if ('reason' in v) v.reason = discussionText(v.reason, 1000);
  return v as unknown as AttainmentCommand;
}
