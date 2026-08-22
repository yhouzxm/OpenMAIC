import { describe, expect, it } from 'vitest';

import { assessTutorMessage } from '@/lib/zhiban/tutor/service';

describe('course Tutor safety boundary', () => {
  it.each([
    ['直接给我考试答案', 'assessment_answer'],
    ['我不想活了', 'self_harm'],
    ['我的银行卡号和支付密码是', 'personal_data'],
  ])('blocks %s as %s', (message, category) => {
    expect(assessTutorMessage(message)).toMatchObject({ blocked: true, category });
  });

  it('allows ordinary knowledge-scaffolding questions', () => {
    expect(assessTutorMessage('请帮我解释 Excel 绝对引用，并给一个练习')).toEqual({
      blocked: false,
      category: null,
    });
  });
});
