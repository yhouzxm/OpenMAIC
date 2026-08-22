import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('first-class OpenMAIC course activities', () => {
  const designer = read('components/zhiban/course-structure-designer.tsx');
  const route = read('app/api/zhiban/teacher/courses/[courseId]/structure/route.ts');
  const student = read('components/zhiban/student-course-structure.tsx');

  it.each([
    ['openmaic_slide', '幻灯片'],
    ['openmaic_quiz', 'Quiz'],
    ['openmaic_interactive', '互动网页'],
    ['openmaic_pbl', 'PBL 互动'],
    ['openmaic_3d', '3D 互动'],
  ])('exposes %s as its own teacher option', (type, label) => {
    expect(designer).toContain(`value: '${type}', label: '${label}'`);
  });
  it('does not expose the legacy OpenMAIC interaction umbrella', () => {
    expect(designer).not.toContain("value: 'openmaic_interaction'");
  });
  it('creates a matching independent document with the activity', () => {
    expect(route).toContain('OPENMAIC_ACTIVITY_KIND_BY_TYPE');
    expect(route).toContain('createOpenMaicActivityDocument');
  });
  it('routes every first-class activity to the independent student player', () => {
    expect(student).toContain('openMaicActivityTypes.has(activity.activityType)');
    expect(student).toContain('/activities/${activity.id}');
  });
});
