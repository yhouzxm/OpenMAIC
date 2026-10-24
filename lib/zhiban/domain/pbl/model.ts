/** Course collaboration adapts the native PBL design; it never accepts native AI/runtime facts from clients. */
import { createHash } from 'node:crypto';
import { isPBLProject, type PBLProject } from '@openmaic/dsl';
import { stripToDesignTemplate } from '@/lib/pbl/v2/runtime/learner-state';
import { findMicrotask } from '@/lib/pbl/v2/operations/kernel/progress';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { exact, canonical } from '../quiz/model';
import { discussionText } from '../discussion/model';
export const pblDigest = (x: unknown) => createHash('sha256').update(canonical(x)).digest('hex');
const text = (x: unknown, max: number, empty = false) =>
  empty && x === '' ? '' : discussionText(x, max);
const leafId = (x: unknown) => {
  requireAcademic(typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x));
  requireAcademic(!['__proto__', 'constructor', 'prototype'].includes(x));
  return x;
};
export function nativeDesign(value: unknown): PBLProject {
  requireAcademic(isPBLProject(value));
  // Standard knowledge projects only. Autonomous agent/scenario state is not a course group authority.
  requireAcademic(!value.scenario && value.milestones.length >= 1 && value.milestones.length <= 8);
  const used = new Set<string>();
  const id = (v: unknown) => {
    const k = leafId(v);
    requireAcademic(!used.has(k));
    used.add(k);
    return k;
  };
  const milestones = value.milestones.map((m, index) => {
    requireAcademic(
      m &&
        typeof m === 'object' &&
        Array.isArray(m.microtasks) &&
        m.microtasks.length >= 1 &&
        m.microtasks.length <= 16,
    );
    requireAcademic(
      m.documents === undefined || (Array.isArray(m.documents) && m.documents.length <= 8),
    );
    return {
      id: id(m.id),
      title: text(m.title, 120),
      description: text(m.description ?? '', 2000, true),
      status: index === 0 ? ('active' as const) : ('locked' as const),
      order: index,
      completionCriteria: text(m.completionCriteria ?? '', 1000, true),
      documents: (m.documents ?? []).map((d) => {
        requireAcademic(d && ['markdown', 'reference', 'starter_file'].includes(d.docType));
        return {
          id: id(d.id),
          title: text(d.title, 120),
          content: text(d.content, 4000),
          docType: d.docType,
        };
      }),
      microtasks: m.microtasks.map((t, order) => {
        requireAcademic(
          t && typeof t === 'object' && Array.isArray(t.hints) && t.hints.length <= 8,
        );
        return {
          id: id(t.id),
          title: text(t.title, 120),
          description: text(t.description ?? '', 2000, true),
          status: 'todo' as const,
          assignee: 'user' as const,
          order,
          hints: t.hints.map((h) => text(h, 500)),
          completionCriteria: text(t.completionCriteria ?? '', 1000, true),
        };
      }),
    };
  });
  requireAcademic(milestones.reduce((n, m) => n + m.microtasks.length, 0) <= 32);
  requireAcademic(Array.isArray(value.tags) && value.tags.length <= 10);
  const normalized: PBLProjectV2 = {
    uiPhase: 'hero',
    title: text(value.title, 120),
    description: text(value.description, 4000),
    learningObjective: text(value.learningObjective ?? '', 2000, true),
    tags: value.tags.map((t) => text(t, 60)),
    language: 'zh-CN',
    proficiency: '',
    status: 'active',
    roles: [],
    milestones,
    submissions: [],
    evaluations: [],
    threads: [],
    engagementEvents: [],
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
  };
  const result = stripToDesignTemplate(normalized);
  requireAcademic(Buffer.byteLength(canonical(result)) <= 48000);
  return result;
}
export type GroupWork = { answers: Record<string, string>; reflection: string };
export function groupWork(v: unknown, design?: PBLProject): GroupWork {
  exact(v, ['answers', 'reflection']);
  requireAcademic(v.answers !== null && typeof v.answers === 'object' && !Array.isArray(v.answers));
  const entries = Object.entries(v.answers as Record<string, unknown>);
  requireAcademic(entries.length <= 32);
  const answers: Record<string, string> = {};
  for (const [k, value] of entries) {
    leafId(k);
    requireAcademic(!['__proto__', 'constructor', 'prototype'].includes(k));
    if (design) requireAcademic(findMicrotask(design as PBLProjectV2, k));
    answers[k] = text(value, 2000, true);
  }
  const result = { answers, reflection: text(v.reflection, 3000, true) };
  requireAcademic(Buffer.byteLength(canonical(result)) <= 48000);
  return result;
}
export function completeWork(work: GroupWork, design: PBLProject) {
  for (const m of design.milestones)
    for (const t of m.microtasks) requireAcademic(!!work.answers[t.id]?.trim(), 'INVALID_STATE');
  requireAcademic(!!work.reflection.trim(), 'INVALID_STATE');
}
export type PblCommand =
  | {
      type: 'CREATE_PROJECT';
      design: PBLProject;
      deadlineAt: number | null;
      allowResubmit: boolean;
    }
  | {
      type: 'SAVE_PROJECT';
      id: string;
      revision: string;
      design: PBLProject;
      deadlineAt: number | null;
      allowResubmit: boolean;
    }
  | { type: 'PUBLISH_PROJECT' | 'CLOSE_PROJECT' | 'REOPEN_PROJECT'; id: string; revision: string }
  | { type: 'CREATE_GROUP'; projectId: string; name: string; members: string[] }
  | {
      type: 'SET_MEMBERS';
      id: string;
      revision: string;
      name: string;
      members: string[];
      reason: string;
    }
  | { type: 'SAVE_WORK'; id: string; revision: string; work: GroupWork }
  | { type: 'CONFIRM_WORK' | 'RETRACT_CONFIRMATION' | 'SUBMIT_GROUP'; id: string; revision: string }
  | {
      type: 'PUBLISH_EVALUATION';
      id: string;
      revision: string;
      score: number;
      feedback: string;
      reason: string;
    };
export function pblCommand(v: unknown): PblCommand {
  requireAcademic(v !== null && typeof v === 'object' && !Array.isArray(v));
  const x = v as Record<string, unknown>,
    type = x.type;
  requireAcademic(typeof type === 'string');
  if (type === 'CREATE_PROJECT' || type === 'SAVE_PROJECT') {
    exact(
      x,
      type === 'CREATE_PROJECT'
        ? ['type', 'design', 'deadlineAt', 'allowResubmit']
        : ['type', 'id', 'revision', 'design', 'deadlineAt', 'allowResubmit'],
    );
    requireAcademic(
      x.deadlineAt === null ||
        (typeof x.deadlineAt === 'number' &&
          Number.isSafeInteger(x.deadlineAt) &&
          x.deadlineAt > 0 &&
          x.deadlineAt <= 8640000000000000),
    );
    requireAcademic(typeof x.allowResubmit === 'boolean');
    const fields = {
      design: nativeDesign(x.design),
      deadlineAt: x.deadlineAt as number | null,
      allowResubmit: x.allowResubmit,
    };
    return type === 'CREATE_PROJECT'
      ? { type, ...fields }
      : { type, id: academicId(x.id), revision: academicRevision(x.revision), ...fields };
  }
  if (type === 'CREATE_GROUP' || type === 'SET_MEMBERS') {
    exact(
      x,
      type === 'CREATE_GROUP'
        ? ['type', 'projectId', 'name', 'members']
        : ['type', 'id', 'revision', 'name', 'members', 'reason'],
    );
    requireAcademic(
      Array.isArray(x.members) &&
        x.members.length >= (type === 'CREATE_GROUP' ? 1 : 0) &&
        x.members.length <= 10,
    );
    const members = x.members.map(academicId).sort();
    requireAcademic(new Set(members).size === members.length);
    const fields = { members, name: text(x.name, 80) };
    return type === 'CREATE_GROUP'
      ? { type, projectId: academicId(x.projectId), ...fields }
      : {
          type,
          id: academicId(x.id),
          revision: academicRevision(x.revision),
          reason: text(x.reason, 1000),
          ...fields,
        };
  }
  if (
    [
      'PUBLISH_PROJECT',
      'CLOSE_PROJECT',
      'REOPEN_PROJECT',
      'CONFIRM_WORK',
      'RETRACT_CONFIRMATION',
      'SUBMIT_GROUP',
    ].includes(type)
  ) {
    exact(x, ['type', 'id', 'revision']);
    return {
      type: type as
        | 'PUBLISH_PROJECT'
        | 'CLOSE_PROJECT'
        | 'REOPEN_PROJECT'
        | 'CONFIRM_WORK'
        | 'RETRACT_CONFIRMATION'
        | 'SUBMIT_GROUP',
      id: academicId(x.id),
      revision: academicRevision(x.revision),
    };
  }
  if (type === 'SAVE_WORK') {
    exact(x, ['type', 'id', 'revision', 'work']);
    return {
      type,
      id: academicId(x.id),
      revision: academicRevision(x.revision),
      work: groupWork(x.work),
    };
  }
  requireAcademic(type === 'PUBLISH_EVALUATION');
  exact(x, ['type', 'id', 'revision', 'score', 'feedback', 'reason']);
  requireAcademic(
    typeof x.score === 'number' && Number.isInteger(x.score) && x.score >= 0 && x.score <= 100,
  );
  requireAcademic(
    x.revision === '0' || (typeof x.revision === 'string' && /^[1-9][0-9]{0,14}$/.test(x.revision)),
  );
  return {
    type,
    id: academicId(x.id),
    revision: x.revision,
    score: x.score,
    feedback: text(x.feedback, 4000),
    reason: text(x.reason, 1000, true),
  };
}
