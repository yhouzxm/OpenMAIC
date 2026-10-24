import { createHash } from 'node:crypto';
import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { discussionText } from '../discussion/model';
export const riskCodes = ['OVERDUE', 'LOW_SCORE', 'PLAN_OVERDUE'] as const;
export type RiskCode = (typeof riskCodes)[number];
export type Decision = 'SUPPORT' | 'NO_ACTION' | 'RESOLVED';
export interface RiskRef {
  ruleCode: RiskCode;
  ruleRevision: string;
  enrollmentId: string;
  anchorId: string;
  anchorVersion: number;
  sourceKey: string;
}
export interface Observation extends RiskRef {
  threshold: number;
  currentRuleRevision: string;
  currentRuleEnabled: boolean;
  membershipId: string;
  displayName: string | null;
  title: string;
  caseId: string | null;
  facts: Record<string, unknown>;
  eligible: boolean;
  matched: boolean;
  digest: string;
}
export type RiskCommand =
  | { type: 'SAVE_RULE'; ruleCode: RiskCode; revision: string; enabled: boolean; threshold: number }
  | ({
      type: 'REVIEW_SIGNAL';
      decision: 'SUPPORT' | 'NO_ACTION';
      expectedDigest: string;
      body: string;
    } & RiskRef)
  | {
      type: 'AMEND_REVIEW';
      id: string;
      revision: string;
      decision: Decision;
      expectedDigest: string;
      body: string;
    }
  | { type: 'LINK_FOLLOWUP'; id: string; revision: string; expectedDigest: string; body: string };
export function riskCode(v: unknown): RiskCode {
  requireAcademic(riskCodes.includes(v as RiskCode));
  return v as RiskCode;
}
export function ref(v: Record<string, unknown>): RiskRef {
  const ruleCode = riskCode(v.ruleCode);
  requireAcademic(
    typeof v.anchorVersion === 'number' &&
      Number.isSafeInteger(v.anchorVersion) &&
      v.anchorVersion < 2147483648 &&
      (ruleCode === 'PLAN_OVERDUE' ? v.anchorVersion === 0 : v.anchorVersion > 0),
  );
  requireAcademic(typeof v.sourceKey === 'string' && /^[agp]:[a-z0-9-]{1,80}$/.test(v.sourceKey));
  return {
    ruleCode,
    ruleRevision: academicRevision(v.ruleRevision),
    enrollmentId: academicId(v.enrollmentId),
    anchorId: academicId(v.anchorId),
    anchorVersion: v.anchorVersion,
    sourceKey: v.sourceKey,
  };
}
export function riskCommand(input: unknown): RiskCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  const shapes: Record<string, string[]> = {
    SAVE_RULE: ['type', 'ruleCode', 'revision', 'enabled', 'threshold'],
    REVIEW_SIGNAL: [
      'type',
      'ruleCode',
      'ruleRevision',
      'enrollmentId',
      'anchorId',
      'anchorVersion',
      'sourceKey',
      'expectedDigest',
      'decision',
      'body',
    ],
    AMEND_REVIEW: ['type', 'id', 'revision', 'decision', 'expectedDigest', 'body'],
    LINK_FOLLOWUP: ['type', 'id', 'revision', 'expectedDigest', 'body'],
  };
  const keys = shapes[String(v.type)];
  requireAcademic(
    keys && keys.length === Object.keys(v).length && keys.every((k) => Object.hasOwn(v, k)),
  );
  if (v.type === 'SAVE_RULE') {
    const code = riskCode(v.ruleCode);
    requireAcademic(
      typeof v.revision === 'string' &&
        /^(0|[1-9][0-9]{0,14})$/.test(v.revision) &&
        typeof v.enabled === 'boolean' &&
        typeof v.threshold === 'number' &&
        Number.isInteger(v.threshold) &&
        v.threshold >= (code === 'LOW_SCORE' ? 1 : 0) &&
        v.threshold <= (code === 'LOW_SCORE' ? 100 : 720),
    );
    return {
      type: 'SAVE_RULE',
      ruleCode: code,
      revision: v.revision,
      enabled: v.enabled,
      threshold: v.threshold,
    };
  }
  requireAcademic(typeof v.expectedDigest === 'string' && /^[a-f0-9]{64}$/.test(v.expectedDigest));
  const body = discussionText(v.body, 2000);
  if (v.type === 'REVIEW_SIGNAL') {
    requireAcademic(v.decision === 'SUPPORT' || v.decision === 'NO_ACTION');
    return {
      type: 'REVIEW_SIGNAL',
      ...ref(v),
      decision: v.decision,
      expectedDigest: v.expectedDigest,
      body,
    };
  }
  const id = academicId(v.id),
    revision = academicRevision(v.revision);
  if (v.type === 'AMEND_REVIEW') {
    requireAcademic(['SUPPORT', 'NO_ACTION', 'RESOLVED'].includes(String(v.decision)));
    return {
      type: 'AMEND_REVIEW',
      id,
      revision,
      decision: v.decision as Decision,
      expectedDigest: v.expectedDigest,
      body,
    };
  }
  return { type: 'LINK_FOLLOWUP', id, revision, expectedDigest: v.expectedDigest, body };
}
export function observation(
  input: Omit<Observation, 'matched' | 'digest'>,
  now: number,
): Observation {
  const f = input.facts;
  const matched =
    input.eligible &&
    (input.ruleCode === 'LOW_SCORE'
      ? f.publicationId !== null &&
        Number(f.scorePoints) * 100 < input.threshold * Number(f.maxPoints)
      : input.ruleCode === 'OVERDUE'
        ? f.submissionId === null &&
          f.deadlineAt !== null &&
          now - Number(f.deadlineAt) >= input.threshold * 3600000
        : f.planState === 'ACTIVE' &&
          f.dueAt !== null &&
          now - Number(f.dueAt) >= input.threshold * 3600000);
  // Observation time/duration and display names are deliberately excluded from dedup/freshness.
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        input.ruleCode,
        input.ruleRevision,
        input.threshold,
        input.currentRuleRevision,
        input.currentRuleEnabled,
        input.enrollmentId,
        input.anchorId,
        input.anchorVersion,
        input.sourceKey,
        input.eligible,
        matched,
        input.facts,
      ]),
    )
    .digest('hex');
  return { ...input, matched, digest };
}
