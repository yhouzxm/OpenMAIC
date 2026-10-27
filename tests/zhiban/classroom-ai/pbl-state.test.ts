import { describe, it, expect } from 'vitest';
import { autonomousProject } from './pbl-fixtures';
import {
  mergePblLearnerInput,
  preparePblTaskCompletion,
} from '@/lib/zhiban/infrastructure/classroom-ai/pbl-state';
import { currentPendingTaskCompletion } from '@/lib/pbl/v2/operations/kernel/task-completion';
describe('published native PBL input authority', () => {
  it('keeps immutable design, AI evaluation and progress server-owned', () => {
    const current = autonomousProject(),
      forged = structuredClone(current);
    forged.title = 'injected';
    forged.roles[0].name = 'attacker';
    forged.milestones[0].status = 'completed';
    forged.status = 'completed';
    forged.evaluations.push({
      id: 'forged',
      kind: 'final',
      feedback: '100',
      createdAt: new Date().toISOString(),
      score: 100,
      strengths: [],
      improvements: [],
    });
    const saved = mergePblLearnerInput(current, forged);
    expect(saved.title).toBe(current.title);
    expect(saved.roles).toEqual(current.roles);
    expect(saved.status).toBe('active');
    expect(saved.evaluations).toEqual([]);
    expect(saved.milestones[0].status).toBe('active');
  });
  it('deduplicates learner submissions and never fetches submitted links', () => {
    const current = autonomousProject(),
      input = structuredClone(current);
    input.submissions.push({
      id: 'sub-1',
      microtaskId: 'task-1',
      kind: 'link',
      content: 'https://example.invalid/work',
      createdAt: 'client-untrusted',
    });
    const once = mergePblLearnerInput(current, input),
      twice = mergePblLearnerInput(once, input);
    expect(twice.submissions).toHaveLength(1);
    expect(twice.submissions[0].createdAt).not.toBe('client-untrusted');
    input.submissions[0].fileUrl = 'https://internal.invalid/x';
    expect(() => mergePblLearnerInput(current, input)).toThrow();
  });
  it('rejects locked-task submissions and active content uploads', () => {
    const current = autonomousProject(),
      input = structuredClone(current);
    input.submissions.push({
      id: 's',
      microtaskId: 'locked',
      kind: 'text',
      content: 'work',
      createdAt: '',
    });
    expect(() => mergePblLearnerInput(current, input)).toThrow();
    input.submissions[0] = {
      ...input.submissions[0],
      microtaskId: 'task-1',
      kind: 'file',
      filename: 'x.pdf',
    };
    expect(() => mergePblLearnerInput(current, input)).toThrow();
  });
  it('only server evaluation creates a native completion confirmation', () => {
    const p = autonomousProject();
    preparePblTaskCompletion(p, 'task-1');
    expect(currentPendingTaskCompletion(p, 'task-1')).toBeUndefined();
    p.evaluations.push({
      id: 'server-eval',
      kind: 'task',
      microtaskId: 'task-1',
      milestoneId: 'milestone-1',
      score: 95,
      feedback: '满足要求',
      strengths: [],
      improvements: [],
      createdAt: new Date().toISOString(),
    });
    preparePblTaskCompletion(p, 'task-1');
    expect(currentPendingTaskCompletion(p, 'task-1')).toBeDefined();
  });
  it('resets only the next epoch while retaining the authored project', () => {
    const p = autonomousProject(),
      input = structuredClone(p);
    input.runtimeResetEpoch = 1;
    const reset = mergePblLearnerInput(p, input);
    expect(reset.runtimeResetEpoch).toBe(1);
    expect(reset.title).toBe(p.title);
    input.runtimeResetEpoch = 4;
    expect(() => mergePblLearnerInput(p, input)).toThrow();
  });
});
