import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  isStationPracticeMode,
  LearningStationHero,
} from '@/components/zhiban/learning-station-hero';
import {
  createStationPracticeProgress,
  emptyLearningCenterProgress,
} from '@/lib/zhiban/learning-center';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

describe('completed station practice mode', () => {
  it('recognizes only the explicit restart practice value', () => {
    expect(isStationPracticeMode('?practice=restart&practiceRun=123')).toBe(true);
    expect(isStationPracticeMode('?practice=review')).toBe(false);
    expect(isStationPracticeMode('?unlock=true')).toBe(false);
  });

  it('keeps historical attempts but clears current-round completion marks', () => {
    const persisted = emptyLearningCenterProgress('mech-mechatronics-system');
    persisted.knowledgePoints.K09.completed = true;
    persisted.knowledgePoints.K09.correct = true;
    persisted.knowledgePoints.K09.attempts = 3;
    persisted.stations['station-03-control'].status = 'completed';
    persisted.stations['station-03-control'].progressPercent = 100;

    const practice = createStationPracticeProgress(persisted, 'station-03-control');

    expect(practice.knowledgePoints.K09.completed).toBe(false);
    expect(practice.knowledgePoints.K09.correct).toBeNull();
    expect(practice.knowledgePoints.K09.attempts).toBe(3);
    expect(practice.stations['station-03-control'].status).toBe('not_started');
    expect(practice.stations['station-03-control'].progressPercent).toBe(0);
  });

  it('offers a restart action for completed students without exposing it in teacher preview', () => {
    const studentHtml = renderToStaticMarkup(
      createElement(LearningStationHero, {
        courseId: 'mech-mechatronics-system',
        stationId: 'station-03-control',
        headline: '控制推演',
        description: '理解PLC信号。',
        progressPercent: 100,
        completed: true,
      }),
    );
    const teacherHtml = renderToStaticMarkup(
      createElement(LearningStationHero, {
        courseId: 'mech-mechatronics-system',
        stationId: 'station-03-control',
        headline: '控制推演',
        description: '理解PLC信号。',
        progressPercent: 100,
        completed: true,
        previewMode: true,
      }),
    );

    expect(studentHtml).toContain('重新练习本站');
    expect(studentHtml).toContain('本站已完成');
    expect(teacherHtml).not.toContain('重新练习本站');
  });

  it('restarts transient station 01 and 02 scenes and does not hydrate station 05 milestones', () => {
    const system = fs.readFileSync(
      path.join(root, 'components/zhiban/learning-station.tsx'),
      'utf8',
    );
    const sensing = fs.readFileSync(
      path.join(root, 'components/zhiban/sensing-learning-station.tsx'),
      'utf8',
    );
    const diagnosis = fs.readFileSync(
      path.join(root, 'components/zhiban/diagnosis-assessment-learning-stations.tsx'),
      'utf8',
    );

    expect(system).toContain("practiceMode\n              ? 'S01-01'");
    expect(sensing).toContain("practiceMode\n              ? 'S02-01'");
    expect(system).toContain('createStationPracticeProgress(body.progress, stationId)');
    expect(sensing).toContain('createStationPracticeProgress(body.progress, stationId)');
    expect(sensing).toContain(
      'attempt: m03AttemptBase.current + Object.keys(m03ByPosition.current).length',
    );
    expect(diagnosis).toContain(
      'const practiceMode = isStationPracticeMode(window.location.search)',
    );
    expect(diagnosis).toContain('if (!practiceMode)');
    expect(diagnosis).toContain(
      'attempt: diagnosisAttemptBase.current + Object.keys(completedScenarios).length + 1',
    );
  });

  it('keeps history and profile semantics explicit instead of clearing persisted completion', () => {
    const hero = fs.readFileSync(
      path.join(root, 'components/zhiban/learning-station-hero.tsx'),
      'utf8',
    );
    const guide = fs.readFileSync(
      path.join(root, 'components/zhiban/learning-station-completion-guide.tsx'),
      'utf8',
    );

    expect(hero).toContain('历史完成记录与学习画像不会清除');
    expect(guide).toContain('不会因打开页面自动提高能力画像');
    expect(hero).not.toContain('localStorage.clear');
  });
});
