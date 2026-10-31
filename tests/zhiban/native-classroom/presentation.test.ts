import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classroomPresentation,
  type PresentationView,
} from '../../../app/zhiban/local/classroom-player';
function view(): PresentationView {
  return {
    mode: 'STUDENT',
    sessions: [
      {
        id: 'session',
        state: 'PUBLISHED',
        revision: '3',
        tasks: [
          {
            id: 'dispatch',
            kind: 'LECTURE',
            state: 'ACTIVE',
            target_id: 'resource',
            publicationId: 'published',
            available: true,
            entered: true,
            current_page: 2,
            page_count: 3,
            presentation_revision: '4',
          },
        ],
      },
    ],
  };
}
const read = (v: PresentationView) =>
  classroomPresentation(v, 'session', 'resource', 'published', 3);
test('only the exact entered active publication may drive learner navigation', () => {
  assert.equal(read(view())?.task.current_page, 2);
  for (const change of [
    (v: PresentationView) => {
      v.sessions[0].tasks[0].entered = false;
    },
    (v: PresentationView) => {
      v.sessions[0].tasks[0].publicationId = 'replacement';
    },
    (v: PresentationView) => {
      v.sessions[0].tasks[0].target_id = 'another-resource';
    },
    (v: PresentationView) => {
      v.sessions[0].tasks[0].page_count = 4;
    },
    (v: PresentationView) => {
      v.sessions[0].tasks[0].current_page = 0;
    },
  ]) {
    const v = view();
    change(v);
    assert.equal(read(v), null);
  }
});
test('a paused flow, ended session or superseded task cannot keep playback alive', () => {
  const v = view();
  v.sessions[0].flow = { state: 'PAUSED' };
  assert.equal(read(v), null);
  v.sessions[0].flow.state = 'RUNNING';
  assert.ok(read(v));
  v.sessions[0].state = 'ENDED';
  assert.equal(read(v), null);
  v.sessions[0].state = 'PUBLISHED';
  v.sessions[0].tasks[0].state = 'ENDED';
  assert.equal(read(v), null);
});
test('teacher preview needs no learner entry but still requires an active exact classroom', () => {
  const v = view();
  v.mode = 'TEACHER';
  v.sessions[0].tasks[0].entered = false;
  assert.equal(read(v)?.teacher, true);
  assert.equal(classroomPresentation(v, 'another-session', 'resource', 'published', 3), null);
});
