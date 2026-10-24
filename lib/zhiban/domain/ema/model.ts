import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { discussionText } from '../discussion/model';
import { observationText, type EvidenceRef, type ObservationText } from '../learner/model';
import { exact } from '../quiz/model';
export const dimensions = [
  {
    id: 'KNOWLEDGE',
    title: '知识理解',
    definition: '对概念、原理及其边界的解释；一次成绩仅说明对应任务表现。',
  },
  {
    id: 'APPLICATION',
    title: '技能应用',
    definition: '在具体任务中应用方法与核验结果；不推断未观测的实际操作能力。',
  },
  {
    id: 'PROBLEM_SOLVING',
    title: '问题解决',
    definition: '识别问题、提出方案并说明验证依据；需对应具体过程证据。',
  },
  {
    id: 'SELF_REGULATION',
    title: '自主调节',
    definition: '制定、执行及调整学习策略；教师安排本身不能证明学生已执行。',
  },
  {
    id: 'COLLABORATION',
    title: '沟通协作',
    definition: '解释、回应和共同协作的具体贡献；个人成绩与小组成绩均不能单独证明。',
  },
  {
    id: 'REFLECTION',
    title: '反思迁移',
    definition: '基于反馈修订理解并迁移到新情境；仅有一次结果不足以证明迁移。',
  },
] as const;
export type Dimension = (typeof dimensions)[number]['id'];
export function dimension(v: unknown): Dimension {
  requireAcademic(dimensions.some((d) => d.id === v));
  return v as Dimension;
}
export type Finding = {
  dimension: Dimension;
  state: 'INSUFFICIENT' | 'LIMITED';
  observation: string;
  evidence: number[];
};
export type EmaCommand =
  | {
      type: 'CREATE_OBSERVATION';
      enrollmentId: string;
      dimension: Dimension;
      text: ObservationText;
    }
  | {
      type: 'QUEUE';
      enrollmentId: string;
      purpose: string;
      dueAt: number | null;
      evidence: EvidenceRef[];
    }
  | { type: 'RUN' | 'CANCEL' | 'EXPIRE'; id: string; revision: string }
  | {
      type: 'ADOPT';
      id: string;
      revision: string;
      dimension: Dimension;
      text: ObservationText;
      reason: string;
    }
  | { type: 'REJECT'; id: string; revision: string; dimension: Dimension; reason: string };
export function emaCommand(input: unknown): EmaCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  const shapes: Record<string, string[]> = {
    CREATE_OBSERVATION: ['enrollmentId', 'dimension', 'text'],
    QUEUE: ['enrollmentId', 'purpose', 'dueAt', 'evidence'],
    RUN: ['id', 'revision'],
    CANCEL: ['id', 'revision'],
    EXPIRE: ['id', 'revision'],
    ADOPT: ['id', 'revision', 'dimension', 'text', 'reason'],
    REJECT: ['id', 'revision', 'dimension', 'reason'],
  };
  requireAcademic(Object.hasOwn(shapes, String(v.type)));
  exact(v, ['type', ...shapes[String(v.type)]]);
  if ('enrollmentId' in v) academicId(v.enrollmentId);
  if ('id' in v) {
    academicId(v.id);
    academicRevision(v.revision);
  }
  if ('dimension' in v) dimension(v.dimension);
  if ('text' in v) v.text = observationText(v.text);
  if ('reason' in v) v.reason = discussionText(v.reason, 1000);
  if (v.type === 'QUEUE') {
    v.purpose = discussionText(v.purpose, 1000);
    requireAcademic(v.dueAt === null || (Number.isSafeInteger(v.dueAt) && Number(v.dueAt) > 0));
    v.evidence = observationText({
      title: '范围',
      body: '固定教学证据',
      confidence: 'LIMITED',
      evidence: v.evidence,
    }).evidence;
  }
  return v as unknown as EmaCommand;
}
/** Closed output schema: model cannot select new records, confer scores or publish. */
export function parseFindings(raw: string, count: number): Finding[] {
  requireAcademic(raw.length <= 20000, 'UNAVAILABLE');
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  let v: unknown;
  try {
    v = JSON.parse(clean);
  } catch {
    requireAcademic(false, 'UNAVAILABLE');
  }
  exact(v, ['findings']);
  requireAcademic(Array.isArray(v.findings) && v.findings.length === 6, 'UNAVAILABLE');
  const found = v.findings.map((x: unknown) => {
    exact(x, ['dimension', 'state', 'observation', 'evidence']);
    const d = dimension(x.dimension);
    requireAcademic(x.state === 'INSUFFICIENT' || x.state === 'LIMITED');
    requireAcademic(
      Array.isArray(x.evidence) &&
        x.evidence.length <= count &&
        x.evidence.every(
          (i: unknown) => Number.isInteger(i) && Number(i) >= 1 && Number(i) <= count,
        ),
    );
    requireAcademic(new Set(x.evidence).size === x.evidence.length);
    requireAcademic(x.state === 'INSUFFICIENT' || x.evidence.length > 0);
    return {
      dimension: d,
      state: x.state,
      observation: discussionText(x.observation, 2000),
      evidence: x.evidence as number[],
    } as Finding;
  });
  requireAcademic(new Set(found.map((x) => x.dimension)).size === 6);
  return dimensions.map((d) => found.find((f) => f.dimension === d.id)!);
}
