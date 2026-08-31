import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  JudgmentFeedback,
  judgmentOptionClass,
} from '@/components/zhiban/judgment-feedback';
import { createSensingInteractiveContent } from '@/lib/zhiban/learning-center/sensing-interactive-template';

describe('judgment exercise feedback', () => {
  it('shows explicit correct and incorrect results without relying on color alone', () => {
    const correct = renderToStaticMarkup(
      createElement(JudgmentFeedback, { isCorrect: true, message: '证据与判断一致。' }),
    );
    const incorrect = renderToStaticMarkup(
      createElement(JudgmentFeedback, {
        isCorrect: false,
        message: '当前判断还缺少输出侧证据。',
      }),
    );

    expect(correct).toContain('回答正确');
    expect(correct).toContain('aria-live="polite"');
    expect(incorrect).toContain('回答错误');
    expect(incorrect).toContain('当前判断还缺少输出侧证据');
  });

  it('keeps a distinct selected state before validation', () => {
    expect(judgmentOptionClass({ selected: true })).toContain('border-blue-500');
    expect(judgmentOptionClass({ selected: true, result: true })).toContain('border-emerald-600');
    expect(judgmentOptionClass({ selected: true, result: false })).toContain('border-orange-600');
  });

  it('keeps M03 selection visible and announces the validation result inside the iframe', () => {
    const content = createSensingInteractiveContent({
      activityId: 'mech-lab-line-stop',
      scenarioId: 'line-stop-001',
    });

    expect(content.html).toContain('aria-live="polite"');
    expect(content.html).toContain('answer-selected');
    expect(content.html).toContain('✓ 回答正确');
    expect(content.html).toContain('✕ 回答错误');
    expect(content.html).not.toContain("predictionControls').hidden=true");
  });

  it('connects the shared result treatment to M04-M08, K14 and the signal challenge', () => {
    const sensing = readFileSync(
      resolve(process.cwd(), 'components/zhiban/sensing-learning-station.tsx'),
      'utf8',
    );
    const control = readFileSync(
      resolve(process.cwd(), 'components/zhiban/control-actuation-learning-stations.tsx'),
      'utf8',
    );
    const diagnosis = readFileSync(
      resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'),
      'utf8',
    );

    expect(sensing.match(/<JudgmentFeedback/g)).toHaveLength(2);
    expect(control.match(/<JudgmentFeedback/g)).toHaveLength(3);
    expect(control).toContain('m06-submit-requirement');
    expect(diagnosis.match(/<JudgmentFeedback/g)).toHaveLength(2);
    expect(diagnosis).toContain('aria-pressed={selectedLayers[scenarioId] === id}');
    expect(diagnosis).toContain('aria-pressed={challengeSelection === id}');
  });
});
