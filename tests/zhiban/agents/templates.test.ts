import { describe, expect, it } from 'vitest';
import { buildCourseAgentConfigs } from '@/lib/zhiban/agents/templates';
import { decideIntervention } from '@/lib/zhiban/agents/service';

const allEnabled = { tutorEnabled: true, peerEnabled: true, monitorEnabled: true, strategyEnabled: true };

describe('Zhiban multi-agent adapters', () => {
  it('adapts Tutor and Peer to OpenMAIC configs but never exposes Monitor as a chat persona', () => {
    const agents = buildCourseAgentConfigs('course-1', allEnabled, 'policy-v3');
    expect(agents.map((agent) => agent.id)).toEqual(['zhiban-tutor-course-1', 'zhiban-peer-course-1']);
    expect(agents.map((agent) => agent.role)).toEqual(['assistant', 'student']);
    expect(agents.some((agent) => agent.id.includes('monitor'))).toBe(false);
    expect(agents[0].persona).toContain('policy-v3');
    expect(agents.map((agent) => agent.avatar)).toEqual(['/avatars/assist.png', '/avatars/curious.png']);
  });

  it('routes knowledge difficulty to Tutor and low collaboration to Peer', () => {
    expect(decideIntervention({ achievement: 40, completion: 70, engagement: 70 }, allEnabled, { scoreThreshold: 60 })?.target).toBe('tutor');
    expect(decideIntervention({ achievement: 80, completion: 70, engagement: 70, collaboration: 5 }, allEnabled, { scoreThreshold: 60 })?.target).toBe('peer');
  });

  it('escalates combined low progress and engagement to a teacher and respects Monitor opt-out', () => {
    expect(decideIntervention({ completion: 10, engagement: 10 }, allEnabled, {})?.target).toBe('teacher');
    expect(decideIntervention({ completion: 10, engagement: 10 }, { ...allEnabled, monitorEnabled: false }, {})).toBeNull();
  });
});
