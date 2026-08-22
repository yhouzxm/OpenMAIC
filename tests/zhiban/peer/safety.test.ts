import { describe, expect, it } from 'vitest';
import { assessPeerEmotion, PEER_BASE_PROMPT, reviewPeerOutput } from '@/lib/zhiban/peer';
describe('Peer safety and role boundary', () => {
  it('routes ordinary difficulty to supportive Peer conversation', () =>
    expect(assessPeerEmotion('内容太难了，我完全看不懂')).toMatchObject({
      emotion: 'difficulty',
      riskLevel: 'low',
      blocked: false,
    }));
  it('blocks crisis language for deterministic human escalation', () =>
    expect(assessPeerEmotion('我不想活了')).toMatchObject({
      emotion: 'crisis',
      riskLevel: 'high',
      blocked: true,
    }));
  it('does not position Peer as a therapist or grader', () => {
    expect(PEER_BASE_PROMPT).toContain('不是教师、心理医生或评分者');
    expect(PEER_BASE_PROMPT).toContain('心理诊断');
  });
  it('replaces unsafe generated diagnosis before delivery', () =>
    expect(reviewPeerOutput('你患有抑郁症，建议停止服药')).toMatchObject({
      safe: false,
      category: 'role_boundary',
    }));
});
