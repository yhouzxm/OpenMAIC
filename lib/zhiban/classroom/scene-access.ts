import type { SceneRuleSetting } from '@/lib/zhiban/teacher-courses';
export interface SceneAccessContext {
  visitedSceneIds: string[];
  maxScore: number | null;
  now: Date;
}
export function evaluateSceneAccess(
  rules: SceneRuleSetting[],
  sceneId: string,
  context: SceneAccessContext,
) {
  const rule = rules.find((item) => item.sceneId === sceneId);
  if (!rule || rule.condition === 'always') return { allowed: true, reason: null };
  if (rule.condition === 'date') {
    const time = Date.parse(rule.value);
    const allowed = Number.isFinite(time) && context.now.getTime() >= time;
    return { allowed, reason: allowed ? null : `该场景将在 ${rule.value} 开放` };
  }
  if (rule.condition === 'previous_completed') {
    const allowed = context.visitedSceneIds.includes(rule.value);
    return { allowed, reason: allowed ? null : '请先完成前置场景' };
  }
  const threshold = Number(rule.value);
  const allowed =
    Number.isFinite(threshold) && context.maxScore !== null && context.maxScore >= threshold;
  return { allowed, reason: allowed ? null : `需要成绩达到 ${rule.value} 分` };
}
