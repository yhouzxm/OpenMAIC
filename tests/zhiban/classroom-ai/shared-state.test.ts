import { describe, it, expect } from 'vitest';
import { liveCommand } from '@/lib/zhiban/infrastructure/classroom-live/model';
describe('teacher-controlled public presentation', () => {
  const value = {
    kind: 'START',
    revision: '0',
    controller: 'e4c82126-6b9d-4e86-8184-1d1a5fb56eca',
    state: {
      sceneId: 'fixed-slide',
      actionIndex: 0,
      mode: 'paused',
      board: '公开板书',
      summary: '课堂小结',
    },
  };
  it('does not admit private AI or authoritative learning state', () => {
    expect(liveCommand.safeParse(value).success).toBe(true);
    for (const key of [
      'chat',
      'messages',
      'answers',
      'pbl',
      'score',
      'completed',
      'tools',
      'owner',
    ]) {
      expect(liveCommand.safeParse({ ...value, [key]: { value: 'private' } }).success).toBe(false);
      expect(
        liveCommand.safeParse({ ...value, state: { ...value.state, [key]: 'private' } }).success,
      ).toBe(false);
    }
  });
  it('bounds concurrency tokens, positions, public text, and playback modes', () => {
    for (const revision of ['-1', '01', '1.5', '99999999999999999'])
      expect(liveCommand.safeParse({ ...value, revision }).success).toBe(false);
    for (const actionIndex of [-1, 0.1, 10001])
      expect(
        liveCommand.safeParse({ ...value, state: { ...value.state, actionIndex } }).success,
      ).toBe(false);
    expect(
      liveCommand.safeParse({ ...value, state: { ...value.state, mode: 'live' } }).success,
    ).toBe(false);
    expect(
      liveCommand.safeParse({ ...value, state: { ...value.state, board: 'x'.repeat(8001) } })
        .success,
    ).toBe(false);
  });
});
