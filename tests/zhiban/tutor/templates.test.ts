import { describe, expect, it } from 'vitest';

import { buildCourseAgentConfigs, COURSE_TUTOR_PERSONA } from '@/lib/zhiban/agents/templates';

describe('course Tutor template reuse', () => {
  it('uses the shared OpenMAIC Tutor persona and a stable course-scoped agent id', () => {
    const [tutor] = buildCourseAgentConfigs(
      'course-1',
      { tutorEnabled: true, peerEnabled: false, monitorEnabled: false, strategyEnabled: false },
      'v3',
    );

    expect(tutor.id).toBe('zhiban-tutor-course-1');
    expect(tutor.persona).toContain(COURSE_TUTOR_PERSONA);
    expect(tutor.persona).toContain('提示词策略版本：v3');
  });
});
