import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LearningTaskStatusBadge } from '@/components/zhiban/learning-task-status-badge';
import { createSensingInteractiveContent } from '@/lib/zhiban/learning-center/sensing-interactive-template';

describe('learning task completion visibility', () => {
  it('shows explicit red incomplete and green completed labels', () => {
    const incomplete = renderToStaticMarkup(
      createElement(LearningTaskStatusBadge, { completed: false }),
    );
    const completed = renderToStaticMarkup(
      createElement(LearningTaskStatusBadge, { completed: true }),
    );

    expect(incomplete).toContain('未完成');
    expect(incomplete).toContain('text-red-700');
    expect(completed).toContain('已完成');
    expect(completed).toContain('text-emerald-700');
  });

  it('uses the shared task status across all seven station carriers', () => {
    const files = [
      'components/zhiban/learning-station.tsx',
      'components/zhiban/sensing-learning-station.tsx',
      'components/zhiban/control-actuation-learning-stations.tsx',
      'components/zhiban/diagnosis-assessment-learning-stations.tsx',
      'components/zhiban/virtual-lab-runner.tsx',
    ].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'));

    expect(files.every((source) => source.includes('LearningTaskStatusBadge'))).toBe(true);
    expect(files[1]).toContain('<LearningTaskStatusBadge completed={k08Completed} />');
    expect(files[3]).toContain('assessmentSceneCompleted(sceneId)');
  });

  it('makes PLC I0.2 OFF or pending red and ON green in the sensing interaction', () => {
    const content = createSensingInteractiveContent({
      activityId: 'mech-lab-line-stop',
      scenarioId: 'line-stop-001',
    });

    expect(content.html).toContain('.arrow b{color:#fb7185');
    expect(content.html).toContain('.scene:has(.signal.on) .arrow b{color:#4ef29a');
  });
});
