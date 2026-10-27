/** User input merge only. Source prompts, progression, AI evaluations and evidence are server-owned. */
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import {
  currentMicrotask,
  normalizeProjectRuntime,
  resetProjectProgress,
} from '@/lib/pbl/v2/operations/kernel/progress';
import {
  appendRuntimeEvent,
  mintRuntimeEventId,
} from '@/lib/pbl/v2/operations/kernel/runtime-events';
import {
  recordPendingTaskCompletionEvidence,
  setPendingTaskCompletion,
  appendTaskCompletionReadyMessage,
  taskEvaluationCanComplete,
} from '@/lib/pbl/v2/operations/kernel/task-completion';
import { trackSubmissionScore } from '@/lib/pbl/v2/operations/runtime/dynamic-signals';
import { requireContent } from '../content/model';
import { TEXT_FILE_EXTENSIONS } from '@/lib/pbl/v2/operations/runtime/file-validation';

const smallId = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w:.-]{1,160}$/.test(value);
export function mergePblLearnerInput(current: PBLProjectV2, input: PBLProjectV2): PBLProjectV2 {
  requireContent(
    input &&
      typeof input === 'object' &&
      (input as PBLProjectV2 & { coursePblSceneId?: string }).coursePblSceneId ===
        (current as PBLProjectV2 & { coursePblSceneId?: string }).coursePblSceneId,
  );
  const next = structuredClone(current);
  normalizeProjectRuntime(next);
  // Reset is an explicit, revision-checked learner operation; never infer it from missing arrays.
  if ((input.runtimeResetEpoch ?? 0) !== (next.runtimeResetEpoch ?? 0)) {
    requireContent(
      (input.runtimeResetEpoch ?? 0) === (next.runtimeResetEpoch ?? 0) + 1 &&
        input.uiPhase === 'hero',
      'CONFLICT',
      409,
    );
    return resetProjectProgress(next);
  }
  if (
    input.uiPhase === 'hero' ||
    input.uiPhase === 'workspace' ||
    (input.uiPhase === 'completed' && next.status === 'completed')
  )
    next.uiPhase = input.uiPhase;
  const active = currentMicrotask(next);
  const task = active?.microtask.id;
  requireContent(
    Array.isArray(input.submissions) &&
      input.submissions.length <= 100 &&
      Array.isArray(input.threads) &&
      input.threads.length <= 12,
  );
  const existing = new Set(next.submissions.map((s) => s.id));
  for (const s of input.submissions) {
    if (existing.has(s.id)) continue;
    requireContent(
      active &&
        s.microtaskId === task &&
        (!s.milestoneId || s.milestoneId === active.milestone.id) &&
        smallId(s.id),
    );
    requireContent(
      typeof s.content === 'string' && s.content.trim().length > 0 && s.content.length <= 100000,
    );
    // Links are stored as text, never fetched by the server. Binary ingestion stays behind its scanner/parser.
    requireContent(
      !s.fileUrl &&
        (s.kind === 'text' ||
          s.kind === 'link' ||
          (s.kind === 'file' &&
            typeof s.filename === 'string' &&
            TEXT_FILE_EXTENSIONS.has(s.filename.split('.').at(-1)!.toLowerCase()))),
      'PBL_TEXT_OR_LINK_REQUIRED',
      400,
    );
    if (s.kind === 'link') {
      let u: URL | undefined;
      try {
        u = new URL(s.content);
      } catch {}
      requireContent(u?.protocol === 'https:' && !u.username && !u.password);
    }
    const saved = {
      id: s.id,
      microtaskId: task!,
      milestoneId: active!.milestone.id,
      kind: s.kind,
      content: s.content,
      createdAt: new Date().toISOString(),
      ...(s.kind === 'file' ? { filename: s.filename!.slice(0, 160), mimeType: 'text/plain' } : {}),
    };
    next.submissions.push(saved);
    existing.add(s.id);
    appendRuntimeEvent(next, {
      id: mintRuntimeEventId(),
      kind: 'submission_created',
      actorType: 'user',
      submissionId: s.id,
      microtaskId: task,
      milestoneId: active!.milestone.id,
      ts: saved.createdAt,
    });
  }
  let size = 0;
  for (const t of input.threads) {
    requireContent(Array.isArray(t.messages) && t.messages.length <= 300);
    const target = next.threads.find((x) => x.agentId === t.agentId);
    if (!target) continue;
    const known = new Set(target.messages.map((m) => m.id));
    for (const m of t.messages) {
      size += typeof m.content === 'string' ? m.content.length : 0;
      requireContent(size <= 300000, 'TOO_LARGE', 413);
      if (known.has(m.id) || m.roleType !== 'user') continue;
      requireContent(
        task &&
          m.microtaskId === task &&
          smallId(m.id) &&
          typeof m.content === 'string' &&
          m.content.length > 0 &&
          m.content.length <= 16000,
      );
      const saved = {
        id: m.id,
        roleType: 'user' as const,
        content: m.content,
        microtaskId: task,
        ts: new Date().toISOString(),
      };
      target.messages.push(saved);
      known.add(m.id);
      appendRuntimeEvent(next, {
        id: mintRuntimeEventId(),
        kind: 'message_created',
        actorType: 'user',
        messageId: m.id,
        threadId: target.agentId,
        microtaskId: task,
        milestoneId: active!.milestone.id,
        ts: saved.ts,
      });
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

/** Same package-owned pass threshold/evidence as native submission UI, derived from the server evaluation. */
export function preparePblTaskCompletion(project: PBLProjectV2, microtaskId: string) {
  const evaluation = project.evaluations
    .filter((e) => e.kind === 'task' && e.microtaskId === microtaskId)
    .at(-1);
  if (!evaluation) return;
  if (typeof evaluation.score === 'number') trackSubmissionScore(project, evaluation.score);
  if (!taskEvaluationCanComplete(evaluation)) return;
  const active = currentMicrotask(project);
  if (!active || active.microtask.id !== microtaskId) return;
  const { milestone, microtask } = active;
  const reason =
    typeof evaluation.score === 'number'
      ? `Latest task submission passed evaluation (${evaluation.score}/100).`
      : 'Latest task submission passed evaluation.';
  const evidence = {
    path: 'submission_passed' as const,
    signature: `submission_passed_${microtask.id}`,
    label: microtask.title,
    note: reason,
  };
  recordPendingTaskCompletionEvidence(project, milestone, microtask, evidence);
  setPendingTaskCompletion(project, {
    microtaskId,
    milestoneId: milestone.id,
    reason,
    assessment: {
      problems: '',
      resolution: 'submission evaluation passed',
      performance: 'submission met the task threshold',
    },
    evidence,
  });
  appendTaskCompletionReadyMessage(project, microtaskId, { afterTs: evaluation.createdAt });
}
