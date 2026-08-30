import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeAiStudentAttempts } from '@/lib/zhiban/learning-center';

describe('learning center AI attempt context', () => {
  it('bounds legacy cumulative counts without rejecting the request', () => {
    expect(normalizeAiStudentAttempts(0)).toBe(0);
    expect(normalizeAiStudentAttempts(3)).toBe(3);
    expect(normalizeAiStudentAttempts(2_212)).toBe(100);
  });

  it('uses knowledge-point attempts instead of the full course event count', () => {
    const sources = [
      'components/zhiban/learning-station.tsx',
      'components/zhiban/sensing-learning-station.tsx',
      'components/zhiban/control-actuation-learning-stations.tsx',
    ].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'));

    for (const source of sources) {
      expect(source).not.toMatch(/studentAttempts:\s*progress\.eventCount/);
      expect(source).not.toContain('attempts={progress.eventCount}');
    }
  });

  it('logs a sanitized fallback reason instead of silently swallowing it', () => {
    const route = readFileSync(
      resolve(
        process.cwd(),
        'app/api/zhiban/student/courses/[courseId]/learning-center/coach/route.ts',
      ),
      'utf8',
    );

    expect(route).toContain("createLogger('ZhibanLearningCenterCoach')");
    expect(route).toContain('Knowledge companion switched to deterministic fallback.');
    expect(route).not.toContain("catch {\n    return NextResponse.json({");
  });
});
