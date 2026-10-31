import { describe, it, expect } from 'vitest';
import { discussionCommand } from '../../../lib/zhiban/domain/discussion/model';
const topicId = '01954000-0000-7000-8000-000000000001';
const postId = '01954000-0000-7000-8000-000000000002';
describe('offering discussion input boundary', () => {
  it('normalizes multiline text without interpreting HTML', () => {
    expect(
      discussionCommand({
        type: 'POST_MESSAGE',
        topicId,
        parentId: null,
        body: '  <script>text</script>\n说明\t步骤  ',
      }),
    ).toEqual({
      type: 'POST_MESSAGE',
      topicId,
      parentId: null,
      body: '<script>text</script>\n说明\t步骤',
    });
  });
  it.each([
    { type: 'CREATE_TOPIC', title: '', description: '' },
    { type: 'POST_MESSAGE', topicId, parentId: null, body: ' '.repeat(5) },
    { type: 'POST_MESSAGE', topicId, parentId: null, body: 'x'.repeat(4001) },
    { type: 'POST_MESSAGE', topicId, parentId: null, body: '\ud800' },
    { type: 'POST_MESSAGE', topicId, parentId: null, body: '禁止\u0000字符' },
    { type: 'POST_MESSAGE', topicId, parentId: 'other', body: '回复' },
    { type: 'POST_MESSAGE', topicId, parentId: null, body: '冒充', author_id: postId },
    { type: 'HIDE_POST', topicId, id: postId, revision: '1', reason: '' },
    { type: 'RESTORE_POST', topicId, id: postId, revision: '0', reason: '恢复' },
    { type: 'OPEN_TOPIC', id: topicId, revision: 1 },
    { type: '__proto__' },
    { type: 'DELETE_POST', id: postId },
  ])('rejects invalid or privilege-bearing input %#', (input) => {
    expect(() => discussionCommand(input)).toThrow();
  });
  it('requires an explicit parent and exact state-change revision', () => {
    expect(() => discussionCommand({ type: 'POST_MESSAGE', topicId, body: '发言' })).toThrow();
    expect(discussionCommand({ type: 'CLOSE_TOPIC', id: topicId, revision: '2' })).toEqual({
      type: 'CLOSE_TOPIC',
      id: topicId,
      revision: '2',
    });
  });
});
