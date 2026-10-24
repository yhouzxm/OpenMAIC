import { createHash } from 'node:crypto';
import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { exact, canonical } from '../quiz/model';
import { discussionText } from '../discussion/model';
import { validateSimulationSpec, type SimulationModel } from './simulation';
export interface LabField {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  initial: number;
}
export interface LabSpec {
  execution?: { source: 'SERVER_CALCULATED_SIMULATION'; model: SimulationModel };
  instructions: string;
  parameters: LabField[];
  measurements: LabField[];
  conclusionPrompt: string;
}
export interface FlowRequirement {
  stepId: string;
  kind: 'SUBMITTED' | 'GRADE_AT_LEAST';
  percent: number | null;
}
export interface FlowStep {
  id: string;
  title: string;
  kind: 'LECTURE' | 'ACTIVITY' | 'JOINT' | 'LAB';
  target: string;
  version: string;
  interactiveId: string | null;
  publicationId: string | null;
  requires: FlowRequirement[];
  lab: LabSpec | null;
}
export interface LabValues {
  parameters: Record<string, number>;
  rows: { values: Record<string, number>; note: string }[];
  conclusion: string;
}
export type FlowCommand =
  | { type: 'SAVE_PLAN'; classroomId: string; revision: string; steps: FlowStep[] }
  | { type: 'PUBLISH_PLAN'; classroomId: string; revision: string }
  | { type: 'START_FLOW'; classroomId: string; planVersion: string; classroomRevision: string }
  | {
      type: 'NEXT_STEP' | 'PAUSE_FLOW' | 'RESUME_FLOW' | 'FINISH_FLOW' | 'CANCEL_FLOW';
      classroomId: string;
      revision: string;
      reason: string;
    }
  | { type: 'OPEN_LAB'; classroomId: string; dispatchId: string }
  | {
      type: 'RUN_SIMULATION';
      id: string;
      revision: string;
      attemptRevision: string;
      parameters: Record<string, number>;
      conclusion: string;
    }
  | ({
      type: 'SAVE_LAB' | 'SUBMIT_LAB';
      id: string;
      revision: string;
      attemptRevision: string;
    } & LabValues);
export const flowDigest = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const text = (v: unknown, max: number, empty = false) =>
  empty && v === '' ? '' : discussionText(v, max);
function number(v: unknown) {
  requireAcademic(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12);
  return v;
}
function field(v: unknown): LabField {
  exact(v, ['key', 'label', 'unit', 'min', 'max', 'initial']);
  requireAcademic(typeof v.key === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(v.key));
  const min = number(v.min),
    max = number(v.max),
    initial = number(v.initial);
  requireAcademic(min <= max && min <= initial && initial <= max);
  return { key: v.key, label: text(v.label, 80), unit: text(v.unit, 24, true), min, max, initial };
}
function fields(v: unknown, minimum: number) {
  requireAcademic(Array.isArray(v) && v.length >= minimum && v.length <= 10);
  const result = v.map(field);
  requireAcademic(new Set(result.map((f) => f.key)).size === result.length);
  return result;
}
export function labSpec(v: unknown): LabSpec {
  exact(v, [
    'instructions',
    'parameters',
    'measurements',
    'conclusionPrompt',
    ...(v && typeof v === 'object' && 'execution' in v ? ['execution'] : []),
  ]);
  const spec: LabSpec = {
    instructions: text(v.instructions, 4000),
    parameters: fields(v.parameters, 0),
    measurements: fields(v.measurements, 1),
    conclusionPrompt: text(v.conclusionPrompt, 1000),
    ...('execution' in v ? { execution: v.execution as LabSpec['execution'] } : {}),
  };
  if ('execution' in v) requireAcademic(!!v.execution);
  validateSimulationSpec(spec);
  return spec;
}
function stepId(v: unknown): string {
  requireAcademic(
    typeof v === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
  return v.toLowerCase();
}
export function flowSteps(v: unknown): FlowStep[] {
  requireAcademic(Array.isArray(v) && v.length >= 1 && v.length <= 32);
  const result: FlowStep[] = [];
  for (const raw of v) {
    exact(raw, [
      'id',
      'title',
      'kind',
      'target',
      'version',
      'interactiveId',
      'publicationId',
      'requires',
      'lab',
    ]);
    requireAcademic(['LECTURE', 'ACTIVITY', 'JOINT', 'LAB'].includes(String(raw.kind)));
    const kind = raw.kind as FlowStep['kind'];
    const id = stepId(raw.id);
    requireAcademic(!result.some((s) => s.id === id));
    if (kind !== 'LECTURE')
      requireAcademic(!result.some((s) => s.kind !== 'LECTURE' && s.target === raw.target));
    requireAcademic(Array.isArray(raw.requires) && raw.requires.length <= 8);
    const requires = raw.requires.map((r) => {
      exact(r, ['stepId', 'kind', 'percent']);
      const before = result.find((s) => s.id === r.stepId);
      requireAcademic(
        !!before &&
          before.kind !== 'LECTURE' &&
          ['SUBMITTED', 'GRADE_AT_LEAST'].includes(String(r.kind)),
      );
      requireAcademic(
        r.kind === 'SUBMITTED'
          ? r.percent === null
          : typeof r.percent === 'number' &&
              Number.isFinite(r.percent) &&
              r.percent >= 0 &&
              r.percent <= 100,
      );
      return {
        stepId: stepId(r.stepId),
        kind: r.kind as FlowRequirement['kind'],
        percent: r.percent as number | null,
      };
    });
    requireAcademic(new Set(requires.map((r) => r.stepId)).size === requires.length);
    const interactiveId = raw.interactiveId === null ? null : academicId(raw.interactiveId),
      publicationId = raw.publicationId === null ? null : academicId(raw.publicationId);
    requireAcademic(
      kind === 'JOINT'
        ? !!interactiveId && !!publicationId
        : kind === 'LAB'
          ? !!interactiveId === !!publicationId
          : kind === 'LECTURE'
            ? interactiveId === null && !!publicationId
            : interactiveId === null && publicationId === null,
    );
    requireAcademic(kind === 'LAB' ? raw.lab !== null : raw.lab === null);
    result.push({
      id,
      title: text(raw.title, 120),
      kind,
      target: academicId(raw.target),
      version: academicRevision(raw.version),
      interactiveId,
      publicationId,
      requires,
      lab: raw.lab === null ? null : labSpec(raw.lab),
    });
  }
  return result;
}
export function labValues(v: unknown, spec?: LabSpec, submitting = false): LabValues {
  requireAcademic(!!v && typeof v === 'object' && !Array.isArray(v));
  const x = v as Record<string, unknown>;
  requireAcademic(
    !!x.parameters && typeof x.parameters === 'object' && !Array.isArray(x.parameters),
  );
  const parameters = Object.fromEntries(
    Object.entries(x.parameters).map(([k, v]) => {
      requireAcademic(/^[a-z][a-z0-9_]{0,31}$/.test(k));
      return [k, number(v)];
    }),
  );
  requireAcademic(
    Object.keys(parameters).length <= 10 &&
      Array.isArray(x.rows) &&
      x.rows.length <= (submitting ? 50 : 50) &&
      (!submitting || x.rows.length >= 1),
  );
  const rows = x.rows.map((r) => {
    exact(r, ['values', 'note']);
    requireAcademic(!!r.values && typeof r.values === 'object' && !Array.isArray(r.values));
    const values = Object.fromEntries(
      Object.entries(r.values).map(([k, v]) => {
        requireAcademic(/^[a-z][a-z0-9_]{0,31}$/.test(k));
        return [k, number(v)];
      }),
    );
    requireAcademic(Object.keys(values).length <= 10);
    return { values, note: text(r.note, 300, true) };
  });
  const conclusion = text(x.conclusion, 3000, !submitting);
  if (spec) {
    const validate = (values: Record<string, number>, defs: LabField[]) => {
      requireAcademic(
        Object.keys(values).sort().join() ===
          defs
            .map((f) => f.key)
            .sort()
            .join(),
      );
      for (const f of defs) requireAcademic(values[f.key] >= f.min && values[f.key] <= f.max);
    };
    validate(parameters, spec.parameters);
    for (const r of rows) validate(r.values, spec.measurements);
  }
  return { parameters, rows, conclusion };
}
export function flowCommand(v: unknown): FlowCommand {
  requireAcademic(!!v && typeof v === 'object' && !Array.isArray(v));
  const c = v as Record<string, unknown>;
  const shapes: Record<string, string[]> = {
    SAVE_PLAN: ['classroomId', 'revision', 'steps'],
    PUBLISH_PLAN: ['classroomId', 'revision'],
    START_FLOW: ['classroomId', 'planVersion', 'classroomRevision'],
    NEXT_STEP: ['classroomId', 'revision', 'reason'],
    PAUSE_FLOW: ['classroomId', 'revision', 'reason'],
    RESUME_FLOW: ['classroomId', 'revision', 'reason'],
    FINISH_FLOW: ['classroomId', 'revision', 'reason'],
    CANCEL_FLOW: ['classroomId', 'revision', 'reason'],
    OPEN_LAB: ['classroomId', 'dispatchId'],
    RUN_SIMULATION: ['id', 'revision', 'attemptRevision', 'parameters', 'conclusion'],
    SAVE_LAB: ['id', 'revision', 'attemptRevision', 'parameters', 'rows', 'conclusion'],
    SUBMIT_LAB: ['id', 'revision', 'attemptRevision', 'parameters', 'rows', 'conclusion'],
  };
  requireAcademic(Object.hasOwn(shapes, String(c.type)));
  exact(c, ['type', ...shapes[String(c.type)]]);
  for (const k of ['classroomId', 'dispatchId', 'id']) if (k in c) academicId(c[k]);
  for (const k of ['revision', 'planVersion', 'classroomRevision', 'attemptRevision'])
    if (k in c && !(k === 'revision' && c.type === 'SAVE_PLAN' && c[k] === '0'))
      academicRevision(c[k]);
  if (c.type === 'SAVE_PLAN') c.steps = flowSteps(c.steps);
  if ('reason' in c) c.reason = text(c.reason, 1000, true);
  if (c.type === 'CANCEL_FLOW')
    requireAcademic(typeof c.reason === 'string' && c.reason.trim().length > 0);
  if (c.type === 'RUN_SIMULATION') {
    const values = labValues({ parameters: c.parameters, rows: [], conclusion: c.conclusion });
    c.parameters = values.parameters;
    c.conclusion = values.conclusion;
  }
  if (c.type === 'SAVE_LAB' || c.type === 'SUBMIT_LAB')
    Object.assign(c, labValues(c, undefined, c.type === 'SUBMIT_LAB'));
  return c as unknown as FlowCommand;
}
export function labReportText(step: FlowStep, values: LabValues, notebookId: string) {
  const summary = step
    .lab!.measurements.map((f) => `${f.label}（${f.unit}）`)
    .join('、')
    .slice(0, 500);
  const answer = [
    `实验报告：${step.title}`,
    step.lab?.execution
      ? `来源：服务端计算模拟；模型 ${step.lab.execution.model}；非真实设备测量`
      : '来源：学生手动记录；非 Native 自动测量或完成证明',
    `实验记录编号：${notebookId}`,
    `实验定义摘要：${flowDigest(step.lab)}`,
    `参数与测量摘要：${flowDigest(values)}`,
    `测量：${values.rows.length} 行；${summary}`,
    '完整参数与逐行测量见本次实验记录。',
    `实验结论：${values.conclusion}`,
  ].join('\n');
  requireAcademic(answer.length <= 4000);
  return answer;
}
