import { describe, expect, it } from 'vitest';
import {
  LEARNING_EVENT_TYPES,
  KNOWLEDGE_POINTS,
  KNOWLEDGE_STATIONS,
  deriveLearningCenterProgress,
  emptyLearningCenterProgress,
  type LearningEvent,
} from '@/lib/zhiban/learning-center';
import { createSensingInteractiveContent } from '@/lib/zhiban/learning-center/sensing-interactive-template';

const event = (overrides: Partial<LearningEvent> = {}): LearningEvent => ({
  id: overrides.id ?? crypto.randomUUID(),
  courseId: 'mech-mechatronics-system',
  stationId: 'station-01-system',
  knowledgePointId: 'K01',
  eventType: 'VIEW_KNOWLEDGE_POINT',
  payload: {},
  timestamp: overrides.timestamp ?? '2026-08-24T10:00:00.000Z',
  ...overrides,
});

describe('automatic production line learning center', () => {
  it('registers and opens all seven frozen stations', () => {
    expect(KNOWLEDGE_STATIONS.map((item) => item.id)).toEqual([
      'station-01-system',
      'station-02-sensing',
      'station-03-control',
      'station-04-actuation',
      'station-05-diagnosis',
      'station-06-virtual-lab',
      'station-07-assessment',
    ]);
    expect(KNOWLEDGE_POINTS.map((item) => item.id)).toEqual([
      'K01',
      'K02',
      'K03',
      'K04',
      'K05',
      'K06',
      'K07',
      'K08',
      'K09',
      'K10',
      'K11',
      'K12',
      'K13',
      'K14',
      'K15',
    ]);
    expect(KNOWLEDGE_STATIONS.every((item) => item.available)).toBe(true);
  });

  it('keeps a correct checkpoint separate from explicit knowledge-point completion', () => {
    const progress = deriveLearningCenterProgress('mech-mechatronics-system', [
      event({ eventType: 'CLICK_COMPONENT', payload: { target: 's2' }, attempt: 1 }),
      event({
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: true,
        attempt: 1,
        payload: { exercise: 'M01' },
      }),
    ]);
    expect(progress.knowledgePoints.K01.correct).toBe(true);
    expect(progress.knowledgePoints.K01.completed).toBe(false);
    expect(progress.stations['station-01-system'].status).toBe('in_progress');
    expect(progress.stations['station-01-system'].progressPercent).toBe(0);
  });

  it('does not let a stale station event bypass multi-step completion', () => {
    const progress = deriveLearningCenterProgress('mech-mechatronics-system', [
      ...(['K09', 'K10', 'K11'] as const).map((knowledgePointId) =>
        event({
          stationId: 'station-03-control',
          knowledgePointId,
          eventType: 'COMPLETE_KNOWLEDGE_POINT',
        }),
      ),
      event({
        stationId: 'station-03-control',
        knowledgePointId: 'K12',
        eventType: 'SUBMIT_MICRO_EXERCISE',
        isCorrect: true,
        payload: { exercise: 'M07' },
      }),
      event({
        stationId: 'station-03-control',
        knowledgePointId: undefined,
        eventType: 'COMPLETE_STATION',
      }),
    ]);
    expect(progress.stations['station-03-control']).toMatchObject({
      status: 'in_progress',
      progressPercent: 75,
    });
  });

  it('does not complete a point after an incorrect attempt', () => {
    const progress = deriveLearningCenterProgress('mech-mechatronics-system', [
      event({ eventType: 'SUBMIT_MICRO_EXERCISE', isCorrect: false, attempt: 1 }),
    ]);
    expect(progress.knowledgePoints.K01.completed).toBe(false);
    expect(progress.knowledgePoints.K01.correct).toBe(false);
    expect(progress.knowledgePoints.K01.attempts).toBe(1);
  });

  it('marks station 01 complete only after K01, K02 and K03', () => {
    const events: LearningEvent[] = (['K01', 'K02', 'K03'] as const).map(
      (knowledgePointId, index) =>
        event({
          knowledgePointId,
          eventType: 'COMPLETE_KNOWLEDGE_POINT',
          timestamp: `2026-08-24T10:0${index}:00.000Z`,
        }),
    );
    const progress = deriveLearningCenterProgress('mech-mechatronics-system', events);
    expect(progress.stations['station-01-system'].status).toBe('completed');
    expect(progress.stations['station-01-system'].progressPercent).toBe(100);
  });

  it('keeps the event protocol finite and reset progress empty', () => {
    expect(LEARNING_EVENT_TYPES).toEqual([
      'VIEW_KNOWLEDGE_POINT',
      'CLICK_COMPONENT',
      'CLASSIFY_COMPONENT',
      'SEQUENCE_STEP',
      'MOVE_WORKPIECE',
      'PREDICT_SENSOR_STATE',
      'MEASURE_POWER',
      'MEASURE_OUTPUT',
      'MAP_IO',
      'SELECT_IO_TYPE',
      'PLC_SCAN_STEP',
      'LADDER_TOGGLE',
      'EXECUTION_SEQUENCE',
      'OUTPUT_TOGGLE',
      'VIEW_DIAGNOSIS_SCENARIO',
      'SELECT_DIAGNOSIS_LAYER',
      'SELECT_DIAGNOSIS_EVIDENCE',
      'SUBMIT_MICRO_EXERCISE',
      'REQUEST_AI_HELP',
      'ENTER_SCENE',
      'COMPLETE_SCENE',
      'REMEDIATION_SCENE_ENTERED',
      'REMEDIATION_RECOMMENDED',
      'REMEDIATION_SCENE_COMPLETED',
      'REMEDIATION_RETRY_STARTED',
      'REMEDIATION_RETRY_COMPLETED',
      'COMPLETE_KNOWLEDGE_POINT',
      'COMPLETE_STATION',
    ]);
    expect(emptyLearningCenterProgress('mech-mechatronics-system').eventCount).toBe(0);
  });

  it('aligns the sensing signal path and snaps the workpiece to the S2 zone center', () => {
    const html = createSensingInteractiveContent({
      activityId: 'mech-lab-line-stop',
      scenarioId: 'line-stop-001',
    }).html!;
    expect(html).toContain("state.position==='inside'?'52%'");
    expect(html).toContain("state.position=pct<43?'before':pct<=61?'inside':'after'");
    expect(html).toContain('function updateSignalGeometry()');
    expect(html).toContain("line.style.transform='rotate('");
    expect(html).toContain('id="modeStatus"');
    expect(html).toContain('无输出推演已启用');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });
});
