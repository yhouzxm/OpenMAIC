import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('student content navigation', () => {
  it('links a published content activity to its rendered article', () => {
    const structure = readFileSync('components/zhiban/student-course-structure.tsx', 'utf8');
    const content = readFileSync('components/zhiban/student-course-content.tsx', 'utf8');

    expect(structure).toContain("activity.activityType === 'content'");
    expect(structure).toContain('`#content-${activity.id}`');
    expect(content).toContain('id={`content-${content.activityId}`}');
  });
});
