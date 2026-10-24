import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { learningText } from '../learning/model';
export type WeightedItem = { activityId: string; version: number; weightBps: number };
export type FinalGradeCommand =
  | { type: 'SAVE_WEIGHTS'; revision: string; items: WeightedItem[] }
  | { type: 'PUBLISH_WEIGHTS'; revision: string }
  | {
      type: 'PUBLISH_TOTAL';
      memberId: string;
      sourceDigest: string;
      previousId: string | null;
      reason: string;
    }
  | { type: 'OPEN_APPEAL'; publicationId: string; body: string }
  | {
      type: 'RESOLVE_APPEAL';
      id: string;
      memberId: string;
      revision: string;
      decision: 'EXPLAINED' | 'REPLACED';
      body: string;
    };
export function weights(input: unknown): WeightedItem[] {
  requireAcademic(Array.isArray(input) && input.length > 0 && input.length <= 20);
  const seen = new Set<string>();
  for (const r of input) {
    requireAcademic(
      r &&
        typeof r === 'object' &&
        Object.keys(r).sort().join(',') === 'activityId,version,weightBps',
    );
    academicId(r.activityId);
    requireAcademic(!seen.has(r.activityId));
    seen.add(r.activityId);
    requireAcademic(
      Number.isSafeInteger(r.version) &&
        r.version > 0 &&
        Number.isInteger(r.weightBps) &&
        r.weightBps > 0 &&
        r.weightBps <= 10000,
    );
  }
  requireAcademic(input.reduce((sum, r) => sum + r.weightBps, 0) === 10000);
  return input as WeightedItem[];
}
export function weightedPoints(parts: { score: number; maximum: number; weightBps: number }[]) {
  requireAcademic(
    parts.length > 0 && parts.length <= 20 && parts.reduce((n, p) => n + p.weightBps, 0) === 10000,
  );
  let numerator = BigInt(0),
    denominator = BigInt(1);
  for (const p of parts) {
    requireAcademic(
      Number.isSafeInteger(p.score) &&
        Number.isSafeInteger(p.maximum) &&
        p.maximum > 0 &&
        p.score >= 0 &&
        p.score <= p.maximum &&
        Number.isInteger(p.weightBps) &&
        p.weightBps > 0,
    );
    numerator = numerator * BigInt(p.maximum) + BigInt(p.score) * BigInt(p.weightBps) * denominator;
    denominator *= BigInt(p.maximum);
  }
  // Exact rational accumulation; round half up once to 0.01 out of 100.
  return Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
}
export function finalGradeCommand(input: unknown): FinalGradeCommand {
  requireAcademic(input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  const fields: Record<string, string> = {
    SAVE_WEIGHTS: 'items,revision,type',
    PUBLISH_WEIGHTS: 'revision,type',
    PUBLISH_TOTAL: 'memberId,previousId,reason,sourceDigest,type',
    OPEN_APPEAL: 'body,publicationId,type',
    RESOLVE_APPEAL: 'body,decision,id,memberId,revision,type',
  };
  requireAcademic(
    typeof v.type === 'string' &&
      Object.hasOwn(fields, v.type) &&
      Object.keys(v).sort().join(',') === fields[v.type],
  );
  if ('revision' in v) academicRevision(v.revision);
  if ('memberId' in v) academicId(v.memberId);
  if ('publicationId' in v) academicId(v.publicationId);
  if ('id' in v) academicId(v.id);
  if (v.type === 'SAVE_WEIGHTS') weights(v.items);
  if (v.type === 'PUBLISH_TOTAL') {
    requireAcademic(typeof v.sourceDigest === 'string' && /^[a-f0-9]{64}$/.test(v.sourceDigest));
    if (v.previousId !== null) academicId(v.previousId);
    learningText(v.reason, 1000);
  }
  if ('body' in v) learningText(v.body, 2000);
  if (v.type === 'RESOLVE_APPEAL')
    requireAcademic(['EXPLAINED', 'REPLACED'].includes(String(v.decision)));
  if (v.type === 'SAVE_WEIGHTS')
    v.items = weights(v.items).map((i) => ({
      activityId: i.activityId,
      version: i.version,
      weightBps: i.weightBps,
    }));
  return Object.fromEntries(
    Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
  ) as FinalGradeCommand;
}
