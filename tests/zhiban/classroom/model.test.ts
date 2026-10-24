import { describe, it, expect } from 'vitest';
import { classroomCommand } from '@/lib/zhiban/domain/classroom/model';
import { learningCommand } from '@/lib/zhiban/domain/learning/model';
const id = '018f0000-0000-7000-8000-000000000001';
describe('basic classroom input boundary', () => {
  it('requires exact command fields and finite server-compatible opening windows', () => {
    const create = {
      type: 'CREATE_CLASSROOM',
      title: '共享课堂',
      description: '',
      opensAt: null,
      closesAt: null,
    };
    expect(classroomCommand(create)).toEqual(create);
    for (const bad of [
      { ...create, actor: id },
      { ...create, title: ' x ' },
      { ...create, opensAt: 100, closesAt: 100 },
      { ...create, opensAt: NaN },
      { ...create, closesAt: Infinity },
      { type: 'toString' },
      { ...create, opensAt: -1 },
    ])
      expect(() => classroomCommand(bad)).toThrow();
  });
  it('does not accept Runtime/URL targets or completion commands', () => {
    const dispatch = {
      type: 'DISPATCH_TASK',
      id,
      revision: '2',
      kind: 'ACTIVITY',
      target: id,
      version: '1',
    };
    expect(classroomCommand(dispatch)).toEqual(dispatch);
    for (const bad of [
      { ...dispatch, kind: 'HTML' },
      { ...dispatch, target: 'https://example.com' },
      { ...dispatch, version: 'latest' },
      { type: 'COMPLETE_CLASSROOM', id, revision: '1' },
      { type: 'ENTER_TASK', id, revision: '1', dispatchId: id, score: 100 },
    ])
      expect(() => classroomCommand(bad)).toThrow();
  });
  it('bounds presentation metadata without accepting actor or completion facts', () => {
    const command = {
      type: 'PRESENT_LECTURE_PAGE',
      id,
      revision: '2',
      dispatchId: id,
      presentationRevision: '1',
      page: 2,
    };
    expect(classroomCommand(command)).toEqual(command);
    for (const bad of [
      { ...command, page: 0 },
      { ...command, page: 33 },
      { ...command, page: 1.5 },
      { ...command, page: '2' },
      { ...command, presentationRevision: '0' },
      { ...command, actor: id },
      { ...command, complete: true },
    ])
      expect(() => classroomCommand(bad)).toThrow();
  });
  it('preserves ordinary Attempt commands and accepts only a strict optional version precondition', () => {
    expect(learningCommand({ type: 'START_ATTEMPT', id })).toEqual({ type: 'START_ATTEMPT', id });
    expect(learningCommand({ type: 'START_ATTEMPT', id, expectedVersion: '2' })).toEqual({
      type: 'START_ATTEMPT',
      id,
      expectedVersion: '2',
    });
    for (const expectedVersion of ['0', 'latest', 2, null])
      expect(() => learningCommand({ type: 'START_ATTEMPT', id, expectedVersion })).toThrow();
    expect(() =>
      learningCommand({ type: 'PUBLISH_ACTIVITY', id, revision: '1', expectedVersion: '2' }),
    ).toThrow();
  });
  it('keeps published scheduling separate from draft metadata and rejects invalid windows', () => {
    const draft = {
      type: 'EDIT_CLASSROOM',
      id,
      revision: '2',
      title: '草稿修改',
      description: '',
      opensAt: null,
      closesAt: 2000,
    };
    expect(classroomCommand(draft)).toEqual(draft);
    const schedule = {
      type: 'RESCHEDULE_CLASSROOM',
      id,
      revision: '3',
      opensAt: 1000,
      closesAt: 2000,
    };
    expect(classroomCommand(schedule)).toEqual(schedule);
    for (const bad of [
      { ...schedule, title: '不可改已发布标题' },
      { ...draft, revision: '0' },
      { ...schedule, closesAt: 1000 },
      { ...schedule, opensAt: -1 },
      { ...schedule, opensAt: 8640000000000001 },
      { ...draft, actor: id },
    ])
      expect(() => classroomCommand(bad)).toThrow();
  });
});
