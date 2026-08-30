import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SceneGuidanceLayer } from '@/components/zhiban/scene-guidance-layer';
import {
  deriveSceneGuidanceState,
  getScene,
  isCurrentGuidanceHelpResponse,
  reduceSceneBriefingVisibility,
  resolveGuidanceForError,
  resolveSceneEntryDecision,
  resolveSceneGuidanceMode,
  shouldAutoOpenSceneBriefing,
  type SceneActionFeedback,
  type SceneDefinition,
  type SceneGuidanceState,
} from '@/lib/zhiban/scene-orchestration';
import type { LearningEvent } from '@/lib/zhiban/learning-center';

function event(overrides: Partial<LearningEvent>): LearningEvent {
  return {
    id: crypto.randomUUID(),
    courseId: 'mech-mechatronics-system',
    stationId: 'station-01-system',
    eventType: 'ENTER_SCENE',
    payload: { sceneId: 'S01-02' },
    attempt: 1,
    timestamp: '2026-08-29T08:00:00.000Z',
    ...overrides,
  };
}

const fullState: SceneGuidanceState = {
  sceneId: 'S01-02',
  visitCount: 0,
  actionCount: 0,
  consecutiveErrors: 0,
  completed: false,
  mastered: false,
  hintLevel: 0,
  mode: 'FULL',
};

describe('shared scene teaching guidance layer', () => {
  it('keeps guidance optional while allowing all registered Scenes to opt in', () => {
    const compatibleDefinition = {
      ...getScene('S07-01')!,
      guidance: undefined,
    } satisfies SceneDefinition;
    expect(compatibleDefinition.guidance).toBeUndefined();
    expect(getScene('S07-01')?.title).toBe('过程评价与诊断路径回放');
  });

  it('selects FULL, COMPACT and MINIMAL deterministically', () => {
    expect(resolveSceneGuidanceMode({ visitCount: 0, consecutiveErrors: 0, completed: false }).mode)
      .toBe('FULL');
    expect(resolveSceneGuidanceMode({ visitCount: 2, consecutiveErrors: 0, completed: true }).mode)
      .toBe('COMPACT');
    expect(resolveSceneGuidanceMode({ visitCount: 2, consecutiveErrors: 0, completed: true, latestChallengeCorrect: true }).mode)
      .toBe('MINIMAL');
  });

  it('does not treat completed as mastered without a recent correct challenge', () => {
    expect(resolveSceneGuidanceMode({ visitCount: 2, consecutiveErrors: 0, completed: true }))
      .toMatchObject({ mode: 'COMPACT', mastered: false });
  });

  it('automatically opens a first FULL task briefing', () => {
    expect(shouldAutoOpenSceneBriefing(fullState)).toBe(true);
    expect(reduceSceneBriefingVisibility(false, 'AUTO_OPEN', fullState)).toBe(true);
  });

  it('does not force a completed Scene briefing to reopen', () => {
    expect(shouldAutoOpenSceneBriefing({ ...fullState, completed: true, mode: 'COMPACT' })).toBe(false);
  });

  it('allows a closed briefing to be opened manually again', () => {
    const closed = reduceSceneBriefingVisibility(true, 'CLOSE', fullState);
    expect(closed).toBe(false);
    expect(reduceSceneBriefingVisibility(closed, 'OPEN', fullState)).toBe(true);
  });

  it('toggles the task briefing from the same task description control', () => {
    const opened = reduceSceneBriefingVisibility(false, 'TOGGLE', fullState);
    expect(opened).toBe(true);
    expect(reduceSceneBriefingVisibility(opened, 'TOGGLE', fullState)).toBe(false);
  });

  it('renders updated inline action feedback with aria-live', () => {
    const first: SceneActionFeedback = {
      action: '已选择预测', result: '预测已记录', nextFocus: '点击验证', tone: 'neutral',
    };
    const second: SceneActionFeedback = {
      action: '已完成验证', result: '预测与实际一致', nextFocus: '继续下一个位置', tone: 'success',
    };
    const firstHtml = renderToStaticMarkup(createElement(SceneGuidanceLayer, {
      courseId: 'mech-mechatronics-system', sceneId: 'S02-02', feedback: first,
    }));
    const secondHtml = renderToStaticMarkup(createElement(SceneGuidanceLayer, {
      courseId: 'mech-mechatronics-system', sceneId: 'S02-02', feedback: second,
    }));
    expect(firstHtml).toContain('aria-live="polite"');
    expect(firstHtml).toContain('预测已记录');
    expect(secondHtml).toContain('预测与实际一致');
    expect(secondHtml).not.toContain('预测已记录');
  });

  it('escalates the deterministic error scaffold at attempts one, two and three', () => {
    expect(resolveGuidanceForError({ errorCode: 'PREDICTION_MISMATCH', consecutiveErrors: 1 }).result)
      .toContain('缺少');
    expect(resolveGuidanceForError({ errorCode: 'PREDICTION_MISMATCH', consecutiveErrors: 2 }).result)
      .toContain('比较');
    expect(resolveGuidanceForError({ errorCode: 'PREDICTION_MISMATCH', consecutiveErrors: 3 }).nextFocus)
      .toContain('重新选择一个位置');
  });

  it('never exposes an internal Concept Error code in student feedback', () => {
    const feedback = resolveGuidanceForError({
      errorCode: 'LADDER_LOGIC_CONFUSION', consecutiveErrors: 2,
    });
    const html = renderToStaticMarkup(createElement(SceneGuidanceLayer, {
      courseId: 'mech-mechatronics-system', sceneId: 'S03-04', feedback,
    }));
    expect(html).not.toContain('LADDER_LOGIC_CONFUSION');
    expect(html).toContain('I0.2');
  });

  it('deduplicates ENTER_SCENE for the same mounted course and Scene', () => {
    const first = resolveSceneEntryDecision({
      lastRecordedKey: null, courseId: 'course-a', sceneId: 'S01-02',
    });
    expect(first.shouldRecord).toBe(true);
    expect(resolveSceneEntryDecision({
      lastRecordedKey: first.key, courseId: 'course-a', sceneId: 'S01-02',
    }).shouldRecord).toBe(false);
  });

  it('drops an AI response from an old Scene or obsolete request', () => {
    expect(isCurrentGuidanceHelpResponse({
      currentSceneId: 'S03-04', latestRequestId: 'new', responseSceneId: 'S02-02', responseRequestId: 'old',
    })).toBe(false);
    expect(isCurrentGuidanceHelpResponse({
      currentSceneId: 'S03-04', latestRequestId: 'new', responseSceneId: 'S03-04', responseRequestId: 'new',
    })).toBe(true);
  });

  it('registers complete guidance for the three proof-of-concept Scenes', () => {
    for (const sceneId of ['S01-02', 'S02-02', 'S03-04'] as const) {
      const guidance = getScene(sceneId)?.guidance;
      expect(guidance?.task).toBeTruthy();
      expect(guidance?.operableTargets?.length).toBeGreaterThan(0);
      expect(guidance?.completionCriteria.length).toBeGreaterThan(0);
      expect(guidance?.firstActionPrompt).toBeTruthy();
    }
  });

  it('registers complete guidance for all eight Station 01 and 02 Scenes', () => {
    const sceneIds = [
      'S01-01', 'S01-02', 'S01-03', 'S01-04',
      'S02-01', 'S02-02', 'S02-03', 'S02-04',
    ] as const;
    for (const sceneId of sceneIds) {
      const guidance = getScene(sceneId)?.guidance;
      expect(guidance?.task.trim()).toBeTruthy();
      expect(guidance?.objective?.trim()).toBeTruthy();
      expect(guidance?.observeItems?.length).toBeGreaterThan(0);
      expect(guidance?.operableTargets?.length).toBeGreaterThan(0);
      expect(guidance?.firstActionPrompt?.trim()).toBeTruthy();
      expect(guidance?.completionCriteria.length).toBeGreaterThan(0);
      expect(guidance?.estimatedMinutes).toBeGreaterThan(0);
      expect(guidance?.completionFeedback?.trim()).toBeTruthy();
    }
  });

  it('keeps S01-02 classification guidance from revealing a layer answer', () => {
    const first = resolveGuidanceForError({
      errorCode: 'CLASSIFICATION_ROLE_MISMATCH', consecutiveErrors: 1,
    });
    const second = resolveGuidanceForError({
      errorCode: 'CLASSIFICATION_ROLE_MISMATCH', consecutiveErrors: 2,
    });
    expect(`${first.result}${first.nextFocus}${second.result}${second.nextFocus}`)
      .not.toMatch(/S2.*感知层|PLC.*控制层|气缸.*执行层/);
  });

  it('delays the S01-02 layer label until the K02 classification is completed', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/learning-station.tsx'),
      'utf8',
    );
    expect(source).toContain("k02Done ? selected.layer : '待完成K02分类后揭示'");
  });

  it('does not reset the S01-04 ordering when an answer is incorrect', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/learning-station.tsx'),
      'utf8',
    );
    const submit = source.slice(source.indexOf('const submitSequence'), source.indexOf('const askCompanion'));
    expect(submit).not.toContain('setOrder(defaultOrder)');
    expect(submit).toContain("errorCode: 'SEQUENCE_CAUSALITY_ERROR'");
  });

  it('shows the S02-01 drag cue only before the first movement', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/sensing-learning-station.tsx'),
      'utf8',
    );
    expect(source).toContain("activeSceneId === 'S02-01' && !workpieceMoved.current");
    expect(source).toContain('workpieceMoved.current = true');
  });

  it('preserves the S02-02 predict-before-verify interaction order', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'lib/zhiban/learning-center/sensing-interactive-template.ts'),
      'utf8',
    );
    expect(source.indexOf("post('PREDICT_SENSOR_STATE'")).toBeLessThan(
      source.indexOf("post('VERIFY_PREDICTION'"),
    );
    expect(source).toContain("document.getElementById('verify').disabled=true");
  });

  it('records the first S02-02 prediction with its Scene context', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/sensing-learning-station.tsx'),
      'utf8',
    );
    const prediction = source.slice(
      source.indexOf("detail === 'PREDICT_SENSOR_STATE'"),
      source.indexOf("detail === 'VERIFY_PREDICTION'"),
    );
    expect(prediction).toContain("eventType: 'PREDICT_SENSOR_STATE'");
    expect(prediction).toContain("sceneId: 'S02-02'");
  });

  it('explains 24V as supply evidence without declaring the sensor normal', () => {
    const guidance = getScene('S02-03')!.guidance!;
    expect(guidance.objective).toContain('区分');
    expect(guidance.completionFeedback).toContain('供电正常只是条件');
    expect(guidance.completionFeedback).not.toContain('传感器完全正常');
  });

  it('does not expose the POWER_EQUALS_SENSOR_NORMAL code in S02-03 feedback', () => {
    const feedback = resolveGuidanceForError({
      errorCode: 'POWER_EQUALS_SENSOR_NORMAL', consecutiveErrors: 3,
    });
    const html = renderToStaticMarkup(createElement(SceneGuidanceLayer, {
      courseId: 'mech-mechatronics-system', sceneId: 'S02-03', feedback,
    }));
    expect(html).not.toContain('POWER_EQUALS_SENSOR_NORMAL');
    expect(html).toContain('S2输出端');
  });

  it('does not directly reveal I0.2 in S02-04 mapping error guidance', () => {
    for (const consecutiveErrors of [1, 2, 3]) {
      const feedback = resolveGuidanceForError({
        errorCode: 'FIELD_IO_MAPPING_ERROR', consecutiveErrors,
      });
      expect(`${feedback.result}${feedback.nextFocus}`).not.toContain('I0.2');
    }
  });

  it('returns a mastered completed Scene to MINIMAL and a reopened misconception to FULL', () => {
    const definition = getScene('S02-03')!;
    const completedEvents = [
      event({ stationId: 'station-02-sensing', knowledgePointId: 'K06', eventType: 'COMPLETE_KNOWLEDGE_POINT', isCorrect: true, payload: { sceneId: 'S02-03' } }),
      event({ stationId: 'station-02-sensing', knowledgePointId: 'K07', eventType: 'COMPLETE_KNOWLEDGE_POINT', isCorrect: true, payload: { sceneId: 'S02-03' } }),
    ];
    expect(deriveSceneGuidanceState(definition, completedEvents).mode).toBe('MINIMAL');
    expect(deriveSceneGuidanceState(definition, completedEvents, [
      { code: 'POWER_EQUALS_SENSOR_NORMAL', status: 'REOPENED' },
    ]).mode).toBe('FULL');
  });

  it('allows a real Scene re-entry while deduplicating the same mounted entry', () => {
    const first = resolveSceneEntryDecision({
      lastRecordedKey: null, courseId: 'course-a', sceneId: 'S01-02',
    });
    const duplicate = resolveSceneEntryDecision({
      lastRecordedKey: first.key, courseId: 'course-a', sceneId: 'S01-02',
    });
    const leave = resolveSceneEntryDecision({
      lastRecordedKey: first.key, courseId: 'course-a', sceneId: 'S01-03',
    });
    const reenter = resolveSceneEntryDecision({
      lastRecordedKey: leave.key, courseId: 'course-a', sceneId: 'S01-02',
    });
    expect(duplicate.shouldRecord).toBe(false);
    expect(leave.shouldRecord).toBe(true);
    expect(reenter.shouldRecord).toBe(true);
  });

  it('derives per-Scene attempts instead of using the course event count', () => {
    const definition = getScene('S01-02')!;
    const state = deriveSceneGuidanceState(definition, [
      event({ payload: { sceneId: 'S01-02' } }),
      event({ stationId: 'station-02-sensing', knowledgePointId: 'K05', eventType: 'SUBMIT_MICRO_EXERCISE', isCorrect: false, payload: { sceneId: 'S02-02', exercise: 'M03' } }),
      event({ knowledgePointId: 'K01', eventType: 'SUBMIT_MICRO_EXERCISE', isCorrect: true, payload: { sceneId: 'S01-02', exercise: 'M01' } }),
    ]);
    expect(state.visitCount).toBe(1);
    expect(state.actionCount).toBe(1);
    expect(state.consecutiveErrors).toBe(0);
  });

  it('preserves the original completion rules while adding guidance', () => {
    expect(getScene('S01-02')?.completionRule).toMatchObject({ knowledgePointIds: ['K01'], exerciseIds: ['M01'] });
    expect(getScene('S02-02')?.completionRule).toMatchObject({ knowledgePointIds: ['K05'], exerciseIds: ['M03'] });
    expect(getScene('S03-04')?.completionRule).toMatchObject({ knowledgePointIds: ['K12'], exerciseIds: ['M07'] });
  });

  it('never records ENTER_SCENE in teacher preview mode', () => {
    expect(resolveSceneEntryDecision({
      lastRecordedKey: null,
      courseId: 'course-a',
      sceneId: 'S01-02',
      previewMode: true,
    }).shouldRecord).toBe(false);
  });

  it('registers complete guidance for all eleven Station 03 to 05 Scenes', () => {
    const sceneIds = [
      'S03-01', 'S03-02', 'S03-03', 'S03-04',
      'S04-01', 'S04-02', 'S04-03',
      'S05-01', 'S05-02', 'S05-03', 'S05-04',
    ] as const;
    for (const sceneId of sceneIds) {
      const guidance = getScene(sceneId)?.guidance;
      expect(guidance?.task.trim()).toBeTruthy();
      expect(guidance?.objective?.trim()).toBeTruthy();
      expect(guidance?.observeItems?.length).toBeGreaterThan(0);
      expect(guidance?.operableTargets?.length).toBeGreaterThan(0);
      expect(guidance?.firstActionPrompt?.trim()).toBeTruthy();
      expect(guidance?.completionCriteria.length).toBeGreaterThan(0);
      expect(guidance?.estimatedMinutes).toBeGreaterThan(0);
      expect(guidance?.completionFeedback?.trim()).toBeTruthy();
      expect(JSON.stringify({
        task: guidance?.task,
        objective: guidance?.objective,
        observeItems: guidance?.observeItems,
        operableTargets: guidance?.operableTargets,
        firstActionPrompt: guidance?.firstActionPrompt,
        completionCriteria: guidance?.completionCriteria,
        completionFeedback: guidance?.completionFeedback,
      })).not.toMatch(
        /INPUT_OUTPUT_CONFUSION|FIELD_IO_MAPPING_ERROR|PLC_SCAN_SEQUENCE_ERROR|LADDER_LOGIC_CONFUSION|OUTPUT_EQUALS_ACTUATION_SUCCESS|SENSING_LAYER_CONFUSION|CONTROL_LAYER_CONFUSION|ACTUATION_LAYER_CONFUSION/,
      );
    }
  });

  it('guides S03 input/output confusion without exposing a concrete address answer', () => {
    for (const consecutiveErrors of [1, 2, 3]) {
      const feedback = resolveGuidanceForError({
        errorCode: 'INPUT_OUTPUT_CONFUSION', consecutiveErrors,
      });
      expect(`${feedback.result}${feedback.nextFocus}`).not.toMatch(/正确答案|I0\.2|Q0\.1/);
    }
  });

  it('keeps S03 mapping scaffolds directional without directly revealing I0.2', () => {
    for (const consecutiveErrors of [1, 2, 3]) {
      const feedback = resolveGuidanceForError({
        errorCode: 'FIELD_IO_MAPPING_ERROR', consecutiveErrors,
      });
      expect(`${feedback.result}${feedback.nextFocus}`).not.toContain('I0.2');
      expect(`${feedback.result}${feedback.nextFocus}`).not.toContain('正确答案');
    }
  });

  it('explains the PLC scan sequence progressively without mutating its business state', () => {
    const first = resolveGuidanceForError({ errorCode: 'PLC_SCAN_SEQUENCE_ERROR', consecutiveErrors: 1 });
    const second = resolveGuidanceForError({ errorCode: 'PLC_SCAN_SEQUENCE_ERROR', consecutiveErrors: 2 });
    const third = resolveGuidanceForError({ errorCode: 'PLC_SCAN_SEQUENCE_ERROR', consecutiveErrors: 3 });
    expect(first.result).toContain('扫描阶段');
    expect(second.result).toContain('读取输入');
    expect(third.nextFocus).toContain('读取输入');
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/control-actuation-learning-stations.tsx'),
      'utf8',
    );
    expect(source).toContain("setScanSteps((current) => (current.includes(step) ? current : [...current, step]))");
    expect(source).toContain("if (correct && step === 'output')");
  });

  it('keeps S03-04 prediction neutral until the PLC scan reveals the actual output', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/control-actuation-learning-stations.tsx'),
      'utf8',
    );
    const submit = source.slice(source.indexOf('const submitM07'), source.indexOf('export function ActuationLearningStation'));
    expect(submit).toContain('真实输出将在完成PLC扫描后揭示');
    expect(submit).not.toContain("result.isCorrect\n        ? `预测已记录");
    const scanHandler = source.slice(source.indexOf("if (p.detail === 'PLC_SCAN_STEP')"), source.indexOf('const submitM06'));
    expect(scanHandler).toContain('梯形图信号传递完成，Q0.1为');
  });

  it('provides node-by-node S04 execution feedback and the output-versus-action distinction', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/control-actuation-learning-stations.tsx'),
      'utf8',
    );
    expect(source).toContain('继续观察该输出驱动的电磁阀');
    expect(source).toContain('继续观察气路是否把动作传递到气缸');
    expect(getScene('S04-03')?.guidance?.objective).toContain('PLC有输出不等于执行成功');
  });

  it('does not identify a concrete failed actuator in S04-03 guidance', () => {
    for (const consecutiveErrors of [1, 2, 3]) {
      const feedback = resolveGuidanceForError({
        errorCode: 'OUTPUT_EQUALS_ACTUATION_SUCCESS', consecutiveErrors,
      });
      expect(`${feedback.result}${feedback.nextFocus}`).not.toMatch(/电磁阀故障|气路故障|气缸故障|正确答案/);
    }
  });

  it('makes guarded S04 and S05 controls explain their disabled state visibly', () => {
    const actuation = readFileSync(
      resolve(process.cwd(), 'components/zhiban/control-actuation-learning-stations.tsx'),
      'utf8',
    );
    const diagnosis = readFileSync(
      resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'),
      'utf8',
    );
    expect(actuation).toContain('aria-describedby="execution-checkpoint-status"');
    expect(actuation).toContain('请在场景中切换“执行失败推演”');
    expect(diagnosis).toContain('aria-describedby="diagnosis-submit-requirement"');
    expect(diagnosis).toContain('请先点击“开始挑战”，节点选择才会启用。');
  });

  it('uses evidence-oriented S05 scaffolds without leaking a diagnosis answer', () => {
    const cases = [
      ['SENSING_LAYER_CONFUSION', /S2故障|传感器故障/],
      ['CONTROL_LAYER_CONFUSION', /PLC程序故障|控制层是正确答案/],
      ['ACTUATION_LAYER_CONFUSION', /气缸故障|执行层是正确答案/],
    ] as const;
    for (const [errorCode, forbidden] of cases) {
      const feedback = resolveGuidanceForError({ errorCode, consecutiveErrors: 3 });
      expect(`${feedback.result}${feedback.nextFocus}`).not.toMatch(forbidden);
    }
  });

  it('keeps the compact five-step navigation and explicit evidence summary in Station 05', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'),
      'utf8',
    );
    expect(source).toContain('aria-label="五步循证诊断导航"');
    expect(source).toContain('已有证据');
    expect(source).toContain('仍需关注');
    expect(source).toContain('aria-label="控制层输入逻辑输出证据链"');
  });

  it('keeps the original 60-second challenge timer independent from guidance', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/zhiban/diagnosis-assessment-learning-stations.tsx'),
      'utf8',
    );
    expect(source).toContain('Math.max(0, 60 - Math.floor((Date.now() - challengeStartedAt.current) / 1000))');
    expect(source).toContain('}, 250)');
    const guidanceSlice = source.slice(source.indexOf('<SceneGuidanceLayer'), source.indexOf('<section className="rounded-xl border bg-white p-5">'));
    expect(guidanceSlice).not.toContain('setChallengeRemaining');
    expect(guidanceSlice).not.toContain('setChallengeRunning');
  });

  it('keeps ordinary guidance errors read-only with respect to Concept Error state', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'lib/zhiban/scene-orchestration/guidance.ts'),
      'utf8',
    );
    expect(source).not.toContain('setConceptErrors');
    expect(source).not.toContain('postLearningEvent');
    expect(source).not.toContain('updateConceptError');
  });

  it('keeps RESOLVED mastery quiet and restores FULL guidance when an error reopens', () => {
    const definition = getScene('S04-03')!;
    const completedEvents = [
      event({ stationId: 'station-04-actuation', knowledgePointId: 'K14', eventType: 'COMPLETE_KNOWLEDGE_POINT', isCorrect: true, payload: { sceneId: 'S04-03' } }),
    ];
    expect(deriveSceneGuidanceState(definition, completedEvents, [
      { code: 'OUTPUT_EQUALS_ACTUATION_SUCCESS', status: 'RESOLVED' },
    ]).mode).toBe('MINIMAL');
    expect(deriveSceneGuidanceState(definition, completedEvents, [
      { code: 'OUTPUT_EQUALS_ACTUATION_SUCCESS', status: 'REOPENED' },
    ]).mode).toBe('FULL');
  });

  it('renders all ActionFeedback inline through the shared polite live region', () => {
    const html = renderToStaticMarkup(createElement(SceneGuidanceLayer, {
      courseId: 'mech-mechatronics-system',
      sceneId: 'S05-03',
      feedback: resolveGuidanceForError({ errorCode: 'CONTROL_LAYER_CONFUSION', consecutiveErrors: 2 }),
    }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('你做了什么');
    expect(html).not.toContain('CONTROL_LAYER_CONFUSION');
  });

  it('preserves all Station 03 to 05 Scene completion rules while adding guidance', () => {
    const expected = {
      'S03-01': { knowledgePointIds: ['K09'], exerciseIds: [] },
      'S03-02': { knowledgePointIds: ['K10'], exerciseIds: ['M06'] },
      'S03-03': { knowledgePointIds: ['K11'], exerciseIds: [] },
      'S03-04': { knowledgePointIds: ['K12'], exerciseIds: ['M07'] },
      'S04-01': { knowledgePointIds: ['K13'], exerciseIds: [] },
      'S04-02': { knowledgePointIds: ['K13'], exerciseIds: [] },
      'S04-03': { knowledgePointIds: ['K14'], exerciseIds: [] },
      'S05-01': { knowledgePointIds: ['K15'], exerciseIds: [] },
      'S05-02': { knowledgePointIds: ['K15'], exerciseIds: ['M08-sensing'] },
      'S05-03': { knowledgePointIds: ['K15'], exerciseIds: ['M08-control'] },
      'S05-04': { knowledgePointIds: ['K15'], exerciseIds: ['M08-actuation'] },
    } as const;
    for (const [sceneId, completionRule] of Object.entries(expected)) {
      expect(getScene(sceneId as keyof typeof expected)?.completionRule).toMatchObject(completionRule);
    }
  });
});
