import { requireAcademic } from '../academic/model';
export type CompletionRule = {
  kind: 'SUBMITTED' | 'PUBLISHED_GRADE';
  version: number;
  required: boolean;
  thresholdBps: number;
  requires: string[];
};
export function validateRules(
  units: { kind: string; target: string; progress?: CompletionRule }[],
) {
  requireAcademic(units.length <= 200);
  const rules = new Map<string, CompletionRule>();
  for (const u of units) {
    if (u.progress === undefined) continue;
    const r = u.progress;
    requireAcademic(u.kind === 'ACTIVITY' && !!r && typeof r === 'object');
    requireAcademic(
      Object.keys(r).sort().join(',') === 'kind,required,requires,thresholdBps,version',
    );
    requireAcademic(
      ['SUBMITTED', 'PUBLISHED_GRADE'].includes(r.kind) &&
        Number.isSafeInteger(r.version) &&
        r.version > 0 &&
        typeof r.required === 'boolean',
    );
    requireAcademic(
      Number.isInteger(r.thresholdBps) &&
        r.thresholdBps >= 0 &&
        r.thresholdBps <= 10000 &&
        (r.kind !== 'SUBMITTED' || r.thresholdBps === 0),
    );
    requireAcademic(
      Array.isArray(r.requires) &&
        r.requires.length <= 8 &&
        new Set(r.requires).size === r.requires.length,
    );
    requireAcademic(
      !rules.has(u.target) &&
        units.filter((v) => v.kind === 'ACTIVITY' && v.target === u.target).length === 1,
    );
    rules.set(u.target, r);
  }
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string) => {
    requireAcademic(rules.has(id) && !visiting.has(id));
    if (done.has(id)) return;
    visiting.add(id);
    for (const p of rules.get(id)!.requires) {
      requireAcademic(typeof p === 'string' && p !== id);
      visit(p);
    }
    visiting.delete(id);
    done.add(id);
  };
  for (const id of rules.keys()) visit(id);
  return rules;
}
export function publishedThreshold(score: number, maximum: number, thresholdBps: number) {
  requireAcademic(
    Number.isSafeInteger(score) &&
      Number.isSafeInteger(maximum) &&
      maximum > 0 &&
      score >= 0 &&
      score <= maximum &&
      Number.isInteger(thresholdBps) &&
      thresholdBps >= 0 &&
      thresholdBps <= 10000,
  );
  return BigInt(score) * BigInt(10000) >= BigInt(maximum) * BigInt(thresholdBps);
}
