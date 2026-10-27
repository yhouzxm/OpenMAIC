import { describe, expect, it } from 'vitest';
import {
  currentClassroomBinding,
  withClassroomBinding,
  type ClassroomBinding,
} from '@/lib/zhiban/infrastructure/classroom-ai/bindings';
const owner = 'course-learner-member';
const binding = (): ClassroomBinding => ({
  owner,
  stage: 'fixed-publication',
  guard: (work) => work(),
});
describe('classroom request authorization scope', () => {
  it('keeps an older stream attached to its own login while another login of the same member runs', async () => {
    const older = binding(),
      newer = binding();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withClassroomBinding(older, async () => {
      await wait;
      expect(currentClassroomBinding(owner)).toBe(older);
      expect(currentClassroomBinding('course-learner-other')).toBeUndefined();
    });
    await withClassroomBinding(newer, async () => {
      await Promise.resolve();
      expect(currentClassroomBinding(owner)).toBe(newer);
      release();
      await first;
      expect(currentClassroomBinding(owner)).toBe(newer);
    });
    expect(currentClassroomBinding(owner)).toBeUndefined();
  });
  it('does not inherit a classroom capability into an ordinary native owner scope', async () => {
    const original = binding();
    await withClassroomBinding(original, async () => {
      await withClassroomBinding(undefined, async () => {
        expect(currentClassroomBinding(owner)).toBeUndefined();
      });
      expect(currentClassroomBinding(owner)).toBe(original);
    });
  });
});
