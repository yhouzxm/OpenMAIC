import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SmartRemediationCard } from '@/components/zhiban/smart-remediation-card';
import { LEARNING_CENTER_DIMENSIONS } from '@/lib/zhiban/learning-center';
import {
  conceptErrorStatusLabel,
  conceptErrorStudentLabel,
  getScene,
  REMEDIATION_SCENE_MAPPING,
  resolveRemediationScene,
  SCENE_DEFINITIONS,
} from '@/lib/zhiban/scene-orchestration';

const allSceneIds = [
  'S01-01', 'S01-02', 'S01-03', 'S01-04',
  'S02-01', 'S02-02', 'S02-03', 'S02-04',
  'S03-01', 'S03-02', 'S03-03', 'S03-04',
  'S04-01', 'S04-02', 'S04-03',
  'S05-01', 'S05-02', 'S05-03', 'S05-04',
  'S06-01', 'S06-02', 'S06-03',
  'S07-01', 'S07-02', 'S07-03',
] as const;

const conceptCodes = [
  'POWER_EQUALS_SENSOR_NORMAL',
  'INPUT_OUTPUT_CONFUSION',
  'FIELD_IO_MAPPING_ERROR',
  'PLC_SCAN_SEQUENCE_ERROR',
  'LADDER_LOGIC_CONFUSION',
  'CONTROL_EXECUTION_CONFUSION',
  'OUTPUT_EQUALS_ACTUATION_SUCCESS',
  'SENSING_LAYER_CONFUSION',
  'CONTROL_LAYER_CONFUSION',
  'ACTUATION_LAYER_CONFUSION',
  'EVIDENCE_SELECTION_ERROR',
] as const;

describe('Station 07 guidance and full-course feature freeze', () => {
  it('registers complete guidance for S07-01 through S07-03', () => {
    for (const sceneId of ['S07-01', 'S07-02', 'S07-03'] as const) {
      const guidance = getScene(sceneId)?.guidance;
      expect(guidance?.task.trim()).toBeTruthy();
      expect(guidance?.objective?.trim()).toBeTruthy();
      expect(guidance?.observeItems?.length).toBeGreaterThan(0);
      expect(guidance?.operableTargets?.length).toBeGreaterThan(0);
      expect(guidance?.firstActionPrompt?.trim()).toBeTruthy();
      expect(guidance?.completionCriteria.length).toBeGreaterThan(0);
      expect(guidance?.completionFeedback?.trim()).toBeTruthy();
    }
  });

  it('covers exactly all 25 frozen Scene IDs with guidance', () => {
    expect(SCENE_DEFINITIONS.map((scene) => scene.id)).toEqual(allSceneIds);
    expect(SCENE_DEFINITIONS.filter((scene) => scene.guidance)).toHaveLength(25);
  });

  it('passes the five-question guidance consistency matrix for every Scene', () => {
    const matrix = SCENE_DEFINITIONS.map((scene) => ({
      sceneId: scene.id,
      knowsTask: Boolean(scene.guidance?.task.trim()),
      knowsOperableTargets: Boolean(scene.guidance?.operableTargets?.length),
      knowsResult: Boolean(scene.guidance?.completionFeedback?.trim() || scene.guidance?.successFeedback?.trim()),
      knowsWhyWrong: Boolean(scene.guidance?.firstActionPrompt?.trim()),
      knowsNextStep: Boolean(scene.guidance?.completionCriteria.length),
    }));
    expect(matrix).toHaveLength(25);
    expect(matrix.every((row) => Object.values(row).slice(1).every(Boolean))).toBe(true);
  });

  it('keeps the five Assessment dimensions distinct from the six profile dimensions', () => {
    const assessmentSource = readFileSync(
      resolve(process.cwd(), 'lib/zhiban/virtual-lab/assessment/calculate.ts'),
      'utf8',
    );
    expect(assessmentSource).toContain('diagnosisAccuracy: 30');
    expect(assessmentSource).toContain('procedureQuality: 25');
    expect(assessmentSource).toContain('evidenceReasoning: 20');
    expect(assessmentSource).toContain('independence: 15');
    expect(assessmentSource).toContain('verification: 10');
    expect(LEARNING_CENTER_DIMENSIONS).toHaveLength(6);
    expect(LEARNING_CENTER_DIMENSIONS).toContain('systemUnderstanding');
    expect(LEARNING_CENTER_DIMENSIONS).toContain('faultDiagnosisVerification');
  });

  it('keeps the Station 07 path summary read-only', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'),
      'utf8',
    );
    const start = source.indexOf('data-testid="station-07-path-summary"');
    const pathSection = source.slice(
      start,
      source.indexOf("activeSceneId === 'S07-02'", start),
    );
    expect(pathSection).toContain('setGuidanceFeedback');
    expect(pathSection).not.toMatch(/MECH_ACTION|postMessage|RESTART_MACHINE|REPLACE_COMPONENT|sendAction/);
  });

  it('explains saved Assessment reasons without invoking a new score calculation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'),
      'utf8',
    );
    const station07 = source.slice(source.indexOf('export function AssessmentLearningStation'));
    expect(station07).toContain('item.reason');
    expect(station07).not.toContain('calculateAssessment(');
  });

  it.each([
    ['ACTIVE', '需要重点巩固'],
    ['IMPROVING', '正在改善'],
    ['RESOLVED', '本轮已验证掌握'],
    ['REOPENED', '再次出现，需要重新巩固'],
  ] as const)('renders %s as friendly learner language', (status, label) => {
    expect(conceptErrorStatusLabel(status)).toBe(label);
  });

  it('converts every Concept Error code to a student-facing concept label', () => {
    for (const code of conceptCodes) {
      const label = conceptErrorStudentLabel(code);
      expect(label.length).toBeGreaterThan(6);
      expect(label).not.toContain(code);
    }
  });

  it('preserves the frozen deterministic remediation mapping', () => {
    expect(Object.fromEntries(Object.entries(REMEDIATION_SCENE_MAPPING).map(([code, rule]) => [code, rule.sceneId]))).toEqual({
      POWER_EQUALS_SENSOR_NORMAL: 'S02-03',
      INPUT_OUTPUT_CONFUSION: 'S03-01',
      FIELD_IO_MAPPING_ERROR: 'S03-02',
      PLC_SCAN_SEQUENCE_ERROR: 'S03-03',
      LADDER_LOGIC_CONFUSION: 'S03-04',
      CONTROL_EXECUTION_CONFUSION: 'S04-01',
      OUTPUT_EQUALS_ACTUATION_SUCCESS: 'S04-03',
      SENSING_LAYER_CONFUSION: 'S05-02',
      CONTROL_LAYER_CONFUSION: 'S05-03',
      ACTUATION_LAYER_CONFUSION: 'S05-04',
      EVIDENCE_SELECTION_ERROR: 'S05-01',
    });
  });

  it('renders why, objective and retry destination on SmartRemediationCard', () => {
    const recommendation = resolveRemediationScene({
      conceptErrors: ['INPUT_OUTPUT_CONFUSION'],
      currentSceneId: 'S06-02',
      stationId: 'station-07-assessment',
      currentCheckpoint: 'mech-lab-line-stop',
      contextMode: 'POST_ASSESSMENT',
    })!;
    const html = renderToStaticMarkup(createElement(SmartRemediationCard, {
      courseId: 'mech-mechatronics-system',
      recommendation,
    }));
    expect(html).toContain('为什么推荐');
    expect(html).toContain('补练目标');
    expect(html).toContain('完成以后');
    expect(html).toContain('再次验证');
    expect(html.replace(/<[^>]+>/g, '')).not.toContain('INPUT_OUTPUT_CONFUSION');
  });

  it('uses assessment_mentor for post-assessment explanations without changing the path', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/zhiban/smart-remediation-card.tsx'), 'utf8');
    expect(source).toContain("recommendation.contextMode === 'POST_ASSESSMENT'");
    expect(source).toContain("? 'assessment_mentor'");
    expect(source).toContain('targetSceneId: recommendation.sceneId');
  });

  it('states that viewing or completing remediation cannot increase mastery by itself', () => {
    const assessment = readFileSync(resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'), 'utf8');
    const remediation = readFileSync(resolve(process.cwd(), 'components/zhiban/smart-remediation-card.tsx'), 'utf8');
    expect(assessment).toContain('只有新的答题、实训或再挑战表现才会更新');
    expect(assessment).toContain('补练完成不等于问题已解决');
    expect(remediation).toContain('仅浏览补练页面不会提高能力分数');
  });

  it('keeps the AI boundary explicit and provides a local Station 07 fallback', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'), 'utf8');
    expect(source).toContain('不修改分数、画像、误区状态或补练路径');
    expect(source).toContain('AI学习伙伴暂时繁忙');
    expect(source).toContain("mode: 'assessment_mentor'");
  });

  it('does not expose internal Concept Error codes in any Scene guidance copy', () => {
    const copy = JSON.stringify(SCENE_DEFINITIONS.map((scene) => {
      const guidance = scene.guidance;
      return guidance && {
        task: guidance.task,
        objective: guidance.objective,
        observeItems: guidance.observeItems,
        operableTargets: guidance.operableTargets,
        firstActionPrompt: guidance.firstActionPrompt,
        completionCriteria: guidance.completionCriteria,
        successFeedback: guidance.successFeedback,
        completionFeedback: guidance.completionFeedback,
        errorFeedback: Object.values(guidance.errorFeedback ?? {}),
      };
    }));
    for (const code of conceptCodes) expect(copy).not.toContain(code);
  });

  it('does not leak final answers through automatic guidance copy', () => {
    const copy = JSON.stringify(SCENE_DEFINITIONS.map((scene) => scene.guidance));
    expect(copy).not.toMatch(/S2就是故障元件|S2坏了|直接更换S2|正确答案是|PLC程序故障|气缸故障/);
  });

  it('does not log ordinary hover or collect unrelated interaction data', () => {
    const guidance = readFileSync(resolve(process.cwd(), 'components/zhiban/scene-guidance-layer.tsx'), 'utf8');
    expect(guidance).not.toMatch(/onMouseMove|mousemove|keystroke|fingerprint|deviceId/);
    expect(guidance).not.toContain("eventType: 'HOVER'");
  });

  it('keeps teacher preview free of Station 07 student completion and help events', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'), 'utf8');
    expect(source).toContain('if (!previewMode && !completionSent.current)');
    expect(source).toContain('if (previewMode || viewedEventSent.current.has(sceneId)) return');
    expect(source).toContain('previewMode={previewMode}');
  });

  it('keeps Learning Event writes idempotent per viewed Station 07 Scene', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'), 'utf8');
    expect(source).toContain('viewedEventSent.current.has(sceneId)');
    expect(source).toContain('viewedEventSent.current.add(sceneId)');
    expect(source).toContain("payload: { sceneId, area: 'station-07-review' }");
  });
});
