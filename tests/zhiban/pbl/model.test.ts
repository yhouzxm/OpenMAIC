import { describe, it, expect } from 'vitest';
import { v7 } from 'uuid';
import {
  nativeDesign,
  pblCommand,
  groupWork,
  completeWork,
  pblDigest,
} from '../../../lib/zhiban/domain/pbl/model';
import { projectExample } from './fixtures';
describe('course PBL native design and jointly authored evidence boundary', () => {
  it('reuses and strips a native project into an immutable design, excluding learner/agent facts', () => {
    const raw = projectExample();
    raw.uiPhase = 'completed';
    raw.status = 'completed';
    raw.submissions = [{ content: 'private' }];
    raw.evaluations = [{ score: 100 }];
    raw.threads = [{ agentId: 'a', messages: ['private'] }];
    raw.milestones[0].microtasks[0].status = 'completed';
    const design = nativeDesign(raw);
    expect(design.submissions).toEqual([]);
    expect(design.evaluations).toEqual([]);
    expect(design.threads).toEqual([]);
    expect(design.milestones[0].microtasks[0].status).toBe('todo');
    expect(design.milestones[0].documents?.[0].content).toContain('观察来源');
  });
  it('does not accept a native runtime/event state as group work or a forged task', () => {
    const d = nativeDesign(projectExample());
    expect(() => groupWork({ answers: { unknown: 'x' }, reflection: '' }, d)).toThrow();
    expect(() =>
      groupWork({ answers: {}, reflection: '', runtimeEvents: [{ kind: 'completed' }] }, d),
    ).toThrow();
    expect(() =>
      groupWork(JSON.parse('{"answers":{"__proto__":"x"},"reflection":""}'), d),
    ).toThrow();
    expect(() => completeWork({ answers: { 'task-1': '调查' }, reflection: '反思' }, d)).toThrow();
    expect(() =>
      completeWork({ answers: { 'task-1': '调查', 'task-2': '方案' }, reflection: '共同反思' }, d),
    ).not.toThrow();
  });
  it('enforces unique bounded group membership, server-selected actor and closed commands', () => {
    const a = v7();
    expect(
      pblCommand({
        type: 'SET_MEMBERS',
        id: v7(),
        revision: '1',
        name: '保留历史的空组',
        members: [],
        reason: '整组转移',
      }),
    ).toMatchObject({ members: [] });
    expect(() =>
      pblCommand({ type: 'CREATE_GROUP', projectId: v7(), name: '空组', members: [] }),
    ).toThrow();
    expect(() =>
      pblCommand({
        type: 'CREATE_PROJECT',
        design: projectExample(),
        deadlineAt: 9000000000000000,
        allowResubmit: true,
      }),
    ).toThrow();
    expect(() =>
      pblCommand({ type: 'CREATE_GROUP', projectId: v7(), name: '组', members: [a, a] }),
    ).toThrow();
    expect(() =>
      pblCommand({ type: 'CONFIRM_WORK', id: v7(), revision: '1', membershipId: a }),
    ).toThrow();
    expect(() =>
      pblCommand({
        type: 'PUBLISH_EVALUATION',
        id: v7(),
        revision: '0',
        score: 101,
        feedback: '评价',
        reason: '',
      }),
    ).toThrow();
  });
  it('canonicalizes property ordering while retaining exact task/design changes', () => {
    expect(pblDigest({ answers: { b: '2', a: '1' }, reflection: '' })).toBe(
      pblDigest({ reflection: '', answers: { a: '1', b: '2' } }),
    );
    const d = projectExample();
    d.milestones[0].microtasks.push({ ...d.milestones[0].microtasks[0] });
    expect(() => nativeDesign(d)).toThrow();
  });
});
