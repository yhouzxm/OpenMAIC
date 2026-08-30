'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, Send, Sparkles } from 'lucide-react';
import { InteractiveIframeHost } from '@/components/scene-renderers/InteractiveIframeHost';
import { InteractiveRenderer } from '@/components/scene-renderers/interactive-renderer';
import { LearningStationHero } from '@/components/zhiban/learning-station-hero';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { createSensingInteractiveContent } from '@/lib/zhiban/learning-center/sensing-interactive-template';
import {
  evaluateM04,
  evaluateM05,
  type SensingOutputMode,
  type SensingPosition,
} from '@/lib/zhiban/learning-center/sensing';
import { getStation } from '@/lib/zhiban/learning-center/registry';
import { attachClassroomSceneContext } from '@/lib/zhiban/classroom/client-scene-context';
import {
  emptyLearningCenterProgress,
  type ConceptErrorCode,
  type LearningCenterProgress,
  type LearningEventInput,
} from '@/lib/zhiban/learning-center';
import { getMechLabActivity } from '@/lib/zhiban/virtual-lab/registry';
import { isMechLabMessageForContext, type MechLabMessage } from '@/lib/zhiban/virtual-lab/types';
import { SmartRemediationCard } from '@/components/zhiban/smart-remediation-card';
import { SceneGuidanceLayer } from '@/components/zhiban/scene-guidance-layer';
import {
  resolveRemediationScene,
  type RemediationRecommendation,
} from '@/lib/zhiban/scene-orchestration';
import {
  resolveGuidanceForError,
  type GuidanceHelpRequest,
  type SceneActionFeedback,
} from '@/lib/zhiban/scene-orchestration/guidance';

const stationId = 'station-02-sensing' as const;
const sceneId = 'learning-center-sensing-s2';

type SensingSnapshot = {
  position: SensingPosition;
  outputMode: SensingOutputMode;
  s2Active: boolean;
  s2Output: number;
  plcI02: boolean;
};

const initialSnapshot: SensingSnapshot = {
  position: 'before',
  outputMode: 'NORMAL_OUTPUT',
  s2Active: false,
  s2Output: 0,
  plcI02: false,
};
type SensingSceneId = 'S02-01' | 'S02-02' | 'S02-03' | 'S02-04';

export function SensingLearningStation({
  courseId,
  previewMode = false,
}: {
  courseId: string;
  previewMode?: boolean;
}) {
  const context = getMechLabActivity(courseId, 'mech-lab-line-stop');
  const content = useMemo(
    () => (context ? createSensingInteractiveContent(context) : null),
    [context],
  );
  const [progress, setProgress] = useState<LearningCenterProgress>(() =>
    emptyLearningCenterProgress(courseId),
  );
  const [snapshot, setSnapshot] = useState<SensingSnapshot>(initialSnapshot);
  const [m03Results, setM03Results] = useState<Record<string, boolean>>({});
  const [powerMeasured, setPowerMeasured] = useState(false);
  const [m04Message, setM04Message] = useState('');
  const [m05Message, setM05Message] = useState('');
  const [mappingDirections, setMappingDirections] = useState<string[]>([]);
  const [syncWarning, setSyncWarning] = useState('');
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [remediation, setRemediation] = useState<RemediationRecommendation | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<SensingSceneId>('S02-01');
  const [guidanceFeedback, setGuidanceFeedback] = useState<
    Partial<Record<SensingSceneId, SceneActionFeedback>>
  >({});
  const [predictionErrors, setPredictionErrors] = useState(0);
  const [measurementErrors, setMeasurementErrors] = useState(0);
  const [latestPredictionCorrect, setLatestPredictionCorrect] = useState<boolean>();
  const completedPoints = useRef(new Set<string>());
  const stationCompletedReported = useRef(false);
  const m03ByPosition = useRef<Record<string, boolean>>({});
  const conceptErrors = useRef<ConceptErrorCode[]>([]);
  const startedAt = useRef(Date.now());
  const predictionInProgress = useRef(false);
  const workpieceMoved = useRef(false);

  const applyLocalEvent = useCallback((event: LearningEventInput) => {
    setProgress((current) => {
      const next = JSON.parse(JSON.stringify(current)) as LearningCenterProgress;
      next.eventCount += 1;
      const point = event.knowledgePointId
        ? next.knowledgePoints[event.knowledgePointId]
        : undefined;
      if (!point) return next;
      point.attempts = Math.max(point.attempts, event.attempt ?? 1);
      point.lastEventAt = event.timestamp ?? new Date().toISOString();
      if (typeof event.isCorrect === 'boolean') point.correct = event.isCorrect;
      if (event.eventType === 'COMPLETE_KNOWLEDGE_POINT') point.completed = true;
      const station = getStation(event.stationId);
      const stationProgress = next.stations[event.stationId];
      const points = (station?.knowledgePointIds ?? [])
        .map((id) => next.knowledgePoints[id])
        .filter(Boolean);
      stationProgress.completedKnowledgePoints = points.filter((item) => item.completed).length;
      stationProgress.progressPercent = points.length
        ? Math.round((stationProgress.completedKnowledgePoints / points.length) * 100)
        : 0;
      stationProgress.status =
        stationProgress.progressPercent === 100 ? 'completed' : 'in_progress';
      stationProgress.lastEventAt = point.lastEventAt;
      return next;
    });
  }, []);

  const record = useCallback(
    async (input: LearningEventInput) => {
      const event = attachClassroomSceneContext({ ...input, timestamp: input.timestamp ?? new Date().toISOString() });
      if (previewMode) {
        applyLocalEvent(event);
        return;
      }
      try {
        const response = await fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
        });
        if (!response.ok) throw new Error('learning event persistence failed');
      } catch {
        setSyncWarning('学习记录暂未同步，不影响本次学习。');
      }
      applyLocalEvent(event);
    },
    [applyLocalEvent, courseId, previewMode],
  );

  const completePoint = useCallback(
    (knowledgePointId: string, payload: Record<string, unknown> = {}) => {
      if (completedPoints.current.has(knowledgePointId)) return;
      completedPoints.current.add(knowledgePointId);
      void record({ stationId, knowledgePointId, eventType: 'COMPLETE_KNOWLEDGE_POINT', payload });
    },
    [record],
  );

  useEffect(() => {
    void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`)
      .then(async (response) => {
        if (!response.ok) throw new Error('progress');
        const body = (await response.json()) as { progress?: LearningCenterProgress };
        if (body.progress) {
          stationCompletedReported.current =
            body.progress.stations[stationId].status === 'completed';
          setProgress(body.progress);
          setActiveSceneId(
            !body.progress.knowledgePoints.K04.completed
              ? 'S02-01'
              : !body.progress.knowledgePoints.K05.completed
                ? 'S02-02'
                : !body.progress.knowledgePoints.K06.completed ||
                    !body.progress.knowledgePoints.K07.completed
                  ? 'S02-03'
                  : 'S02-04',
          );
          ['K04', 'K05', 'K06', 'K07', 'K08'].forEach((id) => {
            if (body.progress?.knowledgePoints[id]?.completed) completedPoints.current.add(id);
          });
        }
      })
      .catch(() => setSyncWarning('学习记录暂未同步，不影响本次学习。'));
  }, [courseId]);

  useEffect(() => {
    if (!context) return;
    const receive = (event: MessageEvent) => {
      if (!isMechLabMessageForContext(event.data, context)) return;
      const message = event.data as MechLabMessage;
      if (message.type === 'MECH_READY') {
        void record({
          stationId,
          knowledgePointId: 'K04',
          eventType: 'VIEW_KNOWLEDGE_POINT',
          payload: { interaction: 's2-sensing-simulation', sceneId: 'S02-01' },
        });
        return;
      }
      if (message.type !== 'MECH_ACTION') return;
      const payload = message.payload as Record<string, unknown>;
      const detail = payload.detail;
      const nextSnapshot = (overrides: Partial<SensingSnapshot> = {}) => ({
        position:
          typeof payload.workpiecePosition === 'string'
            ? (payload.workpiecePosition as SensingPosition)
            : snapshot.position,
        outputMode:
          typeof payload.outputMode === 'string'
            ? (payload.outputMode as SensingOutputMode)
            : snapshot.outputMode,
        s2Active: typeof payload.s2Active === 'boolean' ? payload.s2Active : snapshot.s2Active,
        s2Output: typeof payload.s2Output === 'number' ? payload.s2Output : snapshot.s2Output,
        plcI02: typeof payload.plcI02 === 'boolean' ? payload.plcI02 : snapshot.plcI02,
        ...overrides,
      });
      if (detail === 'MOVE_WORKPIECE') {
        const state = nextSnapshot();
        setSnapshot(state);
        workpieceMoved.current = true;
        const positionLabel =
          state.position === 'inside' ? '检测区内' : state.position === 'before' ? '检测区前' : '检测区后';
        if (predictionInProgress.current) {
          setActiveSceneId('S02-02');
          setGuidanceFeedback((current) => ({ ...current, 'S02-02': {
            action: `已把工件移动到${positionLabel}`,
            result: '位置已经改变，真实S2与I0.2状态仍保持待验证。',
            nextFocus: '先提交预测，再揭示并比较真实状态。',
            tone: 'neutral',
            targetId: 'workpiece',
          } }));
        } else {
          setActiveSceneId('S02-01');
          setGuidanceFeedback((current) => ({ ...current, 'S02-01': {
            action: `已把工件移动到${positionLabel}`,
            result: `S2当前为${state.s2Active ? 'ON' : 'OFF'}，检测状态随工件位置更新。`,
            nextFocus: '继续让工件经过检测区，观察位置与S2状态是否始终对应。',
            tone: 'neutral',
            targetId: 'workpiece',
          } }));
        }
        void record({
          stationId,
          knowledgePointId: 'K04',
          eventType: 'MOVE_WORKPIECE',
          payload: { ...state, durationMs: Date.now() - startedAt.current, sceneId: 'S02-01' },
        });
        completePoint('K04', { learnedBy: 'workpiece-drag', sceneId: 'S02-01' });
      }
      if (detail === 'SET_OUTPUT_MODE') {
        const state = nextSnapshot();
        setActiveSceneId('S02-03');
        setSnapshot(state);
        setGuidanceFeedback((current) => ({ ...current, 'S02-03': {
          action: state.outputMode === 'NO_OUTPUT_DEMO' ? '已切换到无输出推演' : '已切换到正常输出情境',
          result:
            state.outputMode === 'NO_OUTPUT_DEMO'
              ? '供电条件保留，但输出状态需要单独测量确认。'
              : '工件到位时，输出与PLC输入将按正常关系联动。',
          nextFocus: '分别测量供电端和输出端，不要只凭一个状态下结论。',
          tone: 'neutral',
        } }));
        void record({
          stationId,
          knowledgePointId: 'K07',
          eventType: 'VIEW_KNOWLEDGE_POINT',
          payload: { outputMode: state.outputMode, sceneId: 'S02-03' },
        });
      }
      if (detail === 'START_PREDICTION') {
        predictionInProgress.current = true;
        setActiveSceneId('S02-02');
        setGuidanceFeedback((current) => ({ ...current, 'S02-02': {
          action: '已开始当前位置预测',
          result: '系统暂时隐藏真实S2输出与PLC I0.2状态。',
          nextFocus: '先根据工件位置选择S2为ON或OFF，再点击验证。',
          tone: 'neutral',
        } }));
      }
      if (detail === 'PREDICT_SENSOR_STATE') {
        setActiveSceneId('S02-02');
        setGuidanceFeedback((current) => ({ ...current, 'S02-02': {
          action: `已预测S2为${String(payload.predictedState)}`,
          result: '系统暂未揭示实际状态，预测已经记录。',
          nextFocus: '点击“验证实际状态”，比较工件位置、S2和PLC I0.2。',
          tone: 'neutral',
        } }));
        void record({
          stationId,
          knowledgePointId: 'K05',
          eventType: 'PREDICT_SENSOR_STATE',
          payload: {
            predictedState: payload.predictedState,
            workpiecePosition: payload.workpiecePosition,
            sceneId: 'S02-02',
          },
        });
      }
      if (detail === 'VERIFY_PREDICTION') {
        predictionInProgress.current = false;
        setActiveSceneId('S02-02');
        const position = String(payload.workpiecePosition ?? snapshot.position);
        const isCorrect = payload.isCorrect === true;
        setLatestPredictionCorrect(isCorrect);
        m03ByPosition.current[position] = isCorrect;
        setM03Results({ ...m03ByPosition.current });
        void record({
          stationId,
          knowledgePointId: 'K05',
          eventType: 'SUBMIT_MICRO_EXERCISE',
          isCorrect,
          attempt: Object.keys(m03ByPosition.current).length,
          payload: {
            exercise: 'M03',
            predictedState: payload.predictedState,
            actualState: payload.actualState,
            position,
            correctionCount: Object.values(m03ByPosition.current).filter((value) => !value).length,
            durationMs: Date.now() - startedAt.current,
            sceneId: 'S02-02',
          },
        });
        if (isCorrect) {
          setPredictionErrors(0);
          setGuidanceFeedback((current) => ({ ...current, 'S02-02': {
            action: `已验证${position === 'inside' ? '检测区内' : position === 'before' ? '检测区前' : '检测区后'}的预测`,
            result: `预测与实际一致：S2 ${String(payload.actualState)}，现场变化已经传递到PLC输入。`,
            nextFocus: '继续完成尚未验证的位置，比较S2输出与I0.2是否始终一致。',
            tone: 'success',
          } }));
        } else {
          setPredictionErrors((current) => {
            const next = current + 1;
            setGuidanceFeedback((feedback) => ({
              ...feedback,
              'S02-02': resolveGuidanceForError({
                errorCode: 'PREDICTION_MISMATCH',
                consecutiveErrors: next,
              }),
            }));
            return next;
          });
        }
        if (Object.keys(m03ByPosition.current).length >= 3)
          completePoint('K05', {
            exercise: 'M03',
            completedPositions: Object.keys(m03ByPosition.current),
            sceneId: 'S02-02',
          });
      }
      if (detail === 'MEASURE_POWER') {
        setActiveSceneId('S02-03');
        setPowerMeasured(true);
        setGuidanceFeedback((current) => ({ ...current, 'S02-03': {
          action: '已测量S2供电',
          result: '测量结果为24.0 V DC，说明供电回路基本正常。',
          nextFocus: '供电正常还不能证明输出正常，请继续比较输出端与PLC I0.2。',
          tone: 'neutral',
          targetId: 'measure-power',
        } }));
        void record({
          stationId,
          knowledgePointId: 'K06',
          eventType: 'MEASURE_POWER',
          payload: { value: 24, unit: 'V', measurement: 's2Power', sceneId: 'S02-03' },
        });
      }
      if (detail === 'MEASURE_OUTPUT') {
        setActiveSceneId('S02-03');
        const state = nextSnapshot({
          s2Output: typeof payload.value === 'number' ? payload.value : snapshot.s2Output,
        });
        setSnapshot(state);
        setGuidanceFeedback((current) => ({ ...current, 'S02-03': {
          action: '已测量S2输出',
          result: `当前输出测量结果为${String(payload.value ?? state.s2Output)} V。`,
          nextFocus: '把输出测量结果与PLC I0.2状态进行比较。',
          tone: 'neutral',
          targetId: 'measure-output',
        } }));
        void record({
          stationId,
          knowledgePointId: 'K07',
          eventType: 'MEASURE_OUTPUT',
          payload: {
            value: payload.value,
            unit: 'V',
            outputMode: state.outputMode,
            workpiecePosition: state.position,
            plcI02: state.plcI02,
            sceneId: 'S02-03',
          },
        });
      }
      if (detail === 'MAP_IO') {
        setActiveSceneId('S02-04');
        const direction = `${String(payload.from)}->${String(payload.to)}`;
        setMappingDirections((current) =>
          current.includes(direction) ? current : [...current, direction],
        );
        void record({
          stationId,
          knowledgePointId: 'K08',
          eventType: 'MAP_IO',
          payload: { from: payload.from, to: payload.to, sceneId: 'S02-04' },
        });
        const directions = new Set([...mappingDirections, direction]);
        setGuidanceFeedback((current) => ({ ...current, 'S02-04': {
          action:
            direction === 's2->I0.2'
              ? '已从现场S2追踪到PLC输入'
              : '已从PLC I0.2反向追踪到现场S2',
          result: '现场检测信号与PLC输入地址之间的一个方向已高亮。',
          nextFocus:
            directions.has('s2->I0.2') && directions.has('i02->S2')
              ? '双向映射已建立，可以从现场或PLC任一端追踪信号。'
              : '再从另一端点击一次，完成反向追踪。',
          tone:
            directions.has('s2->I0.2') && directions.has('i02->S2') ? 'success' : 'neutral',
        } }));
        if (
          (direction === 's2->I0.2' || direction === 'i02->S2') &&
          !completedPoints.current.has('K08')
        ) {
          if (directions.has('s2->I0.2') && directions.has('i02->S2'))
            completePoint('K08', { bidirectional: true, sceneId: 'S02-04' });
        }
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [completePoint, context, mappingDirections, record, snapshot]);

  useEffect(() => {
    if (progress.stations[stationId]?.status === 'completed' && !stationCompletedReported.current) {
      stationCompletedReported.current = true;
      void record({
        stationId,
        eventType: 'COMPLETE_STATION',
        payload: {
          knowledgePoints: ['K04', 'K05', 'K06', 'K07', 'K08'],
          exercises: ['M03', 'M04', 'M05'],
        },
      });
    }
  }, [progress.stations, record]);

  const answerM04 = (option: string) => {
    setActiveSceneId('S02-03');
    const result = evaluateM04(option);
    if (result.conceptError && !conceptErrors.current.includes(result.conceptError))
      conceptErrors.current.push(result.conceptError);
    void record({
      stationId,
      knowledgePointId: 'K06',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: result.isCorrect,
      attempt: progress.knowledgePoints.K06.attempts + 1,
      payload: {
        exercise: 'M04',
        selectedOption: option,
        measuredPower: 24,
        conceptErrors: result.conceptError ? [result.conceptError] : [],
        durationMs: Date.now() - startedAt.current,
        sceneId: 'S02-03',
      },
    });
    completePoint('K06', { exercise: 'M04', sceneId: 'S02-03' });
    setM04Message(
      result.isCorrect
        ? '24.0 V DC 说明 S2 供电回路基本正常；还需继续检查输出端是否形成有效信号。'
        : result.conceptError
          ? '24V 只能证明供电条件存在。请继续观察输出端与 PLC I0.2 是否同步变化。'
          : 'PLC程序是否正常，还需要结合输入状态和输出测量进一步判断。',
    );
    setRemediation(
      result.conceptError
        ? resolveRemediationScene({
            conceptErrors: [result.conceptError],
            currentSceneId: 'S02-03',
            stationId,
            currentCheckpoint: 'M04',
            attemptHistory: [{
              code: result.conceptError,
              count: progress.knowledgePoints.K06.attempts + 1,
            }],
            contextMode: 'SELF_LEARNING',
          })
        : null,
    );
    if (result.isCorrect) {
      setMeasurementErrors(0);
      setGuidanceFeedback((current) => ({ ...current, 'S02-03': {
        action: '已提交24V供电证据判断',
        result: '24.0 V DC只能支持“供电回路基本正常”，不能证明输出一定正常。',
        nextFocus: '继续测量S2输出，并比较PLC I0.2。',
        tone: 'success',
      } }));
    } else if (result.conceptError) {
      setMeasurementErrors((current) => {
        const next = current + 1;
        setGuidanceFeedback((feedback) => ({
          ...feedback,
          'S02-03': resolveGuidanceForError({
            errorCode: 'POWER_EQUALS_SENSOR_NORMAL',
            consecutiveErrors: next,
          }),
        }));
        return next;
      });
    } else {
      setGuidanceFeedback((current) => ({ ...current, 'S02-03': {
        action: '已提交当前判断',
        result: '单凭24V供电还不能判断PLC程序状态。',
        nextFocus: '继续获取S2输出与PLC I0.2证据。',
        tone: 'warning',
      } }));
    }
  };

  const answerM05 = (option: string) => {
    setActiveSceneId('S02-03');
    const result = evaluateM05(option);
    void record({
      stationId,
      knowledgePointId: 'K07',
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: result.isCorrect,
      attempt: progress.knowledgePoints.K07.attempts + 1,
      payload: {
        exercise: 'M05',
        selectedOption: option,
        evidenceUsed: result.evidenceUsed,
        durationMs: Date.now() - startedAt.current,
        sceneId: 'S02-03',
      },
    });
    completePoint('K07', { exercise: 'M05', sceneId: 'S02-03' });
    setM05Message(
      result.isCorrect
        ? '这是一条感知侧证据链：先确认输出链路，再决定是否需要扩大到控制侧。'
        : '请重新对照工件位置、24V供电、0V输出和 I0.2 OFF 这四项事实。',
    );
    setGuidanceFeedback((current) => ({ ...current, 'S02-03': result.isCorrect
      ? {
          action: '已提交供电、输出与PLC输入的证据判断',
          result: '当前判断同时使用了工件位置、24V供电、0V输出和I0.2状态。',
          nextFocus: '进入S2与PLC I0.2映射，继续沿信号方向追踪。',
          tone: 'success',
        }
      : {
          action: '已提交当前证据判断',
          result: '当前判断尚未完整使用现场、输出与PLC输入证据。',
          nextFocus: '重新对照工件位置、24V、输出电压和I0.2四项事实。',
          tone: 'warning',
        },
    }));
  };

  const askCompanion = async () => {
    const question = aiQuestion.trim();
    if (!question || aiBusy) return;
    setAiBusy(true);
    setAiAnswer('');
    void record({
      stationId,
      knowledgePointId: powerMeasured ? 'K06' : 'K04',
      eventType: 'REQUEST_AI_HELP',
      payload: { question, conceptErrors: conceptErrors.current, sceneId: activeSceneId },
    });
    try {
      const model = getCurrentModelConfig();
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-model': model.modelString,
        'x-api-key': model.apiKey,
      };
      if (model.baseUrl) headers['x-base-url'] = model.baseUrl;
      if (model.providerType) headers['x-provider-type'] = model.providerType;
      const response = await fetch(
        `/api/zhiban/student/courses/${courseId}/learning-center/coach`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            question,
            stationId,
            knowledgePointId:
              snapshot.outputMode === 'NO_OUTPUT_DEMO' ? 'K07' : powerMeasured ? 'K06' : 'K04',
            currentInteraction: `工件${snapshot.position}，S2 ${snapshot.s2Active ? 'ON' : 'OFF'}，输出 ${snapshot.s2Output}V，I0.2 ${snapshot.plcI02 ? 'ON' : 'OFF'}`,
            studentAttempts:
              progress.knowledgePoints[
                snapshot.outputMode === 'NO_OUTPUT_DEMO' ? 'K07' : powerMeasured ? 'K06' : 'K04'
              ].attempts,
            incorrectConcepts: conceptErrors.current,
            conceptErrors: conceptErrors.current,
            microExercise: powerMeasured ? 'M04/M05' : 'M03',
            predictionHistory: Object.entries(m03Results).map(([position, correct]) => ({
              position,
              correct,
            })),
          }),
        },
      );
      const body = (await response.json()) as { message?: string; notice?: string };
      setAiAnswer(
        `${body.message ?? '请先比较传感器供电、输出和PLC输入。'}${body.notice ? `\n${body.notice}` : ''}`,
      );
    } catch {
      setAiAnswer('AI学习伙伴暂时繁忙，请先比较传感器供电、输出和 PLC I0.2。');
    } finally {
      setAiBusy(false);
      setAiQuestion('');
    }
  };

  const requestSceneHelp = useCallback(
    async ({ requestId }: GuidanceHelpRequest) => {
      const model = getCurrentModelConfig();
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-model': model.modelString,
        'x-api-key': model.apiKey,
      };
      if (model.baseUrl) headers['x-base-url'] = model.baseUrl;
      if (model.providerType) headers['x-provider-type'] = model.providerType;
      const response = await fetch(
        `/api/zhiban/student/courses/${courseId}/learning-center/coach`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            question: '我需要当前位置预测任务的提示。',
            requestId,
            sceneId: 'S02-02',
            stationId,
            knowledgePointId: 'K05',
            currentInteraction: `工件${snapshot.position}，S2 ${snapshot.s2Active ? 'ON' : 'OFF'}，I0.2 ${snapshot.plcI02 ? 'ON' : 'OFF'}`,
            studentAttempts: progress.knowledgePoints.K05.attempts,
            incorrectConcepts: conceptErrors.current,
            conceptErrors: conceptErrors.current,
            microExercise: 'M03',
            predictionHistory: Object.entries(m03Results).map(([position, correct]) => ({
              position,
              correct,
            })),
          }),
        },
      );
      if (!response.ok) throw new Error('coach unavailable');
      const body = (await response.json()) as { message?: string; notice?: string };
      return `${body.message ?? '请先确认工件是否真正进入S2检测区。'}${body.notice ? `\n${body.notice}` : ''}`;
    },
    [courseId, m03Results, progress.knowledgePoints.K05.attempts, snapshot],
  );

  if (!context || !content)
    return <main className="rounded-xl border bg-white p-8">机电系统课件尚未注册。</main>;
  const stationProgress = progress.stations[stationId];
  // The station progress is persisted by knowledge-point id.  Keep the
  // exercise cards in sync with that source of truth after a refresh or a
  // new session; the local interaction state is intentionally ephemeral.
  const m03Completed = progress.knowledgePoints.K05?.completed === true;
  const m04Completed = progress.knowledgePoints.K06?.completed === true;
  const m05Completed = progress.knowledgePoints.K07?.completed === true;
  const k08Completed = progress.knowledgePoints.K08?.completed === true;
  const m05Ready =
    snapshot.position === 'inside' &&
    snapshot.outputMode === 'NO_OUTPUT_DEMO' &&
    snapshot.s2Output === 0 &&
    !snapshot.plcI02;

  return (
    <main className="space-y-5" data-testid="learning-station-02">
      <InteractiveIframeHost />
      <LearningStationHero
        courseId={courseId}
        stationId={stationId}
        headline="机器怎样知道工件到了？"
        description="通过拖动、预测、测量和映射，建立“工件 → 传感器 → 输出 → PLC输入”的证据链。"
        progressPercent={stationProgress.progressPercent}
        completed={stationProgress.status === 'completed'}
        previewMode={previewMode}
      />
      <SceneGuidanceLayer
        courseId={courseId}
        sceneId={activeSceneId}
        previewMode={previewMode}
        completed={
          activeSceneId === 'S02-01'
            ? progress.knowledgePoints.K04.completed
            : activeSceneId === 'S02-02'
              ? m03Completed
              : activeSceneId === 'S02-03'
                ? m04Completed && m05Completed
                : k08Completed
        }
        recentChallengeCorrect={
          activeSceneId === 'S02-02'
            ? latestPredictionCorrect ?? progress.knowledgePoints.K05.correct ?? undefined
            : activeSceneId === 'S02-03'
              ? progress.knowledgePoints.K06.correct === true &&
                progress.knowledgePoints.K07.correct === true
              : activeSceneId === 'S02-04' && k08Completed
                ? true
                : undefined
        }
        consecutiveErrors={
          activeSceneId === 'S02-02'
            ? predictionErrors
            : activeSceneId === 'S02-03'
              ? measurementErrors
              : 0
        }
        actionCount={
          activeSceneId === 'S02-01'
            ? progress.knowledgePoints.K04.attempts
            : activeSceneId === 'S02-02'
              ? Object.keys(m03Results).length
              : activeSceneId === 'S02-03'
                ? Number(powerMeasured) + Number(Boolean(m04Message)) + Number(Boolean(m05Message))
                : mappingDirections.length
        }
        progressSummary={
          activeSceneId === 'S02-01'
            ? progress.knowledgePoints.K04.completed
              ? '位置—检测联动已观察'
              : '拖动工件经过S2检测区'
            : activeSceneId === 'S02-02'
              ? m03Completed
                ? 'M03三个位置预测已完成'
                : `已完成${Object.keys(m03Results).length}/3个位置预测`
              : activeSceneId === 'S02-03'
                ? `供电判断${m04Completed ? '已完成' : '待完成'}；证据决策${m05Completed ? '已完成' : '待完成'}`
                : `双向映射已完成${k08Completed ? 2 : mappingDirections.length}/2`
        }
        feedback={guidanceFeedback[activeSceneId] ?? null}
        onRequestHelp={activeSceneId === 'S02-02' ? requestSceneHelp : undefined}
      />
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="relative h-[clamp(680px,78vh,760px)] overflow-hidden rounded-xl border bg-slate-950 shadow-sm">
            <InteractiveRenderer content={content} sceneId={sceneId} />
            {activeSceneId === 'S02-01' && !workpieceMoved.current && (
              <div className="pointer-events-none absolute left-[19%] top-[43%] rounded-lg border border-cyan-300 bg-cyan-950/90 px-3 py-2 text-xs text-cyan-50 shadow motion-safe:animate-[pulse_1.4s_ease-in-out_2]">
                拖动工件经过S2检测区
              </div>
            )}
            {activeSceneId === 'S02-03' && !powerMeasured && (
              <div className="pointer-events-none absolute right-5 top-[42%] max-w-44 rounded-lg border border-cyan-300 bg-cyan-950/90 px-3 py-2 text-xs text-cyan-50 shadow motion-safe:animate-[pulse_1.4s_ease-in-out_2]">
                先测量供电端，再测量输出端
              </div>
            )}
            {activeSceneId === 'S02-04' && mappingDirections.length === 0 && (
              <div className="pointer-events-none absolute left-1/2 top-[18%] -translate-x-1/2 rounded-lg border border-cyan-300 bg-cyan-950/90 px-3 py-2 text-xs text-cyan-50 shadow motion-safe:animate-[pulse_1.4s_ease-in-out_2]">
                点击S2或PLC I0.2开始双向追踪
              </div>
            )}
          </section>
          <section className="grid gap-4 md:grid-cols-3">
            <KnowledgeStatus
              title="M03 位置预测"
              done={m03Completed}
              text={m03Completed ? '已完成 3 / 3 个位置预测' : `已完成 ${Object.keys(m03Results).length} / 3 个位置预测`}
            />
            <KnowledgeStatus
              title="M04 供电判断"
              done={m04Completed}
              text={m04Completed ? '已完成供电状态判断' : powerMeasured ? '已测得 24.0 V DC' : '请在场景中测量 S2 供电端'}
            />
            <KnowledgeStatus
              title="M05 证据决策"
              done={m05Completed}
              text={m05Completed ? '已完成证据决策' : m05Ready ? '证据情境已就绪' : '切换无输出推演并让工件进入检测区'}
            />
          </section>
          {powerMeasured && (
            <section id="M04" className="rounded-xl border bg-white p-5">
              <Badge variant="outline">K06 · M04</Badge>
              <h2 className="mt-2 text-lg font-semibold">24.0 V DC 能说明什么？</h2>
              <p className="mt-2 text-sm text-slate-600">请基于刚才的测量结果作出判断。</p>
              <div className="mt-4 grid gap-2">
                {[
                  ['A', 'S2已经完全正常'],
                  ['B', 'S2供电回路基本正常'],
                  ['C', 'PLC程序一定正常'],
                ].map(([key, label]) => (
                  <Button
                    key={key}
                    variant="outline"
                    className="justify-start text-left"
                    onClick={() => answerM04(key)}
                  >
                    {key}. {label}
                  </Button>
                ))}
              </div>
              {m04Message && (
                <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-950">{m04Message}</p>
              )}
            </section>
          )}
          {remediation && (
            <SmartRemediationCard
              courseId={courseId}
              recommendation={remediation}
              onDismiss={() => setRemediation(null)}
            />
          )}
          {m05Ready && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <Badge variant="outline">K07 · M05</Badge>
              <h2 className="mt-2 text-lg font-semibold">
                根据证据，下一步最合理的判断或行动是什么？
              </h2>
              <p className="mt-2 text-sm text-slate-700">
                工件已到达检测区；S2供电 24.0V；S2输出 0V；PLC I0.2 OFF。
              </p>
              <div className="mt-4 grid gap-2">
                {[
                  ['A', '因为24V正常，所以S2一定正常'],
                  ['B', '继续检查S2输出链路，并优先将范围缩小到感知侧'],
                  ['C', '直接认定PLC程序故障'],
                  ['D', '立即更换气缸'],
                ].map(([key, label]) => (
                  <Button
                    key={key}
                    variant="outline"
                    className="justify-start bg-white text-left"
                    onClick={() => answerM05(key)}
                  >
                    {key}. {label}
                  </Button>
                ))}
              </div>
              {m05Message && (
                <p className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-800">{m05Message}</p>
              )}
            </section>
          )}
        </div>
        <aside className="space-y-5">
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">当前状态链</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p>
                工件：
                <b>
                  {snapshot.position === 'inside'
                    ? '检测区内'
                    : snapshot.position === 'before'
                      ? '检测区前'
                      : '检测区后'}
                </b>
              </p>
              <p>
                S2：<b>{snapshot.s2Active ? 'ON' : 'OFF'}</b>
              </p>
              <p>
                输出：<b>{snapshot.s2Output ? '24.0 V' : '0 V'}</b>
              </p>
              <p>
                PLC I0.2：<b>{snapshot.plcI02 ? 'ON' : 'OFF'}</b>
              </p>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full bg-blue-600"
                style={{ width: `${stationProgress.progressPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              本站进度 {stationProgress.progressPercent}%
            </p>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">K08 双向映射</h2>
            <p className="mt-2 text-sm text-slate-600">
              在场景中分别点击 S2 和 PLC I0.2，沿高亮信号线查看双向对应。
            </p>
            <p className="mt-3 text-sm">
              已完成：{k08Completed ? 2 : mappingDirections.length} / 2
            </p>
            {k08Completed && (
              <p className="mt-2 flex items-center gap-1 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" />
                S2 ↔ I0.2 映射已建立
              </p>
            )}
          </section>
          <section className="rounded-xl border bg-white p-5">
            <div className="flex items-center gap-2 font-semibold">
              <Bot className="size-4 text-blue-600" />
              AI学习伙伴
            </div>
            <p className="mt-2 text-sm text-slate-600">
              我会结合你当前的工件、输出和 I0.2 状态解释概念，不直接替你选答案。
            </p>
            {aiAnswer && (
              <div className="mt-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-3 text-sm leading-6 text-blue-950">
                {aiAnswer}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Input
                value={aiQuestion}
                onChange={(event) => setAiQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void askCompanion();
                }}
                placeholder="为什么有24V仍可能I0.2 OFF？"
                disabled={aiBusy}
              />
              <Button
                size="icon"
                aria-label="提问AI学习伙伴"
                onClick={() => void askCompanion()}
                disabled={aiBusy || !aiQuestion.trim()}
              >
                {aiBusy ? (
                  <Sparkles className="size-4 animate-pulse" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">连接综合实训</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              这些知识会在综合实训中用于判断 S2 供电、输出与 PLC 输入之间的关系。
            </p>
            {stationProgress.status === 'completed' && (
              <Link
                href={`/zhiban/student/courses/${courseId}/learning-center/station-06-virtual-lab`}
                className="mt-3 inline-flex text-sm text-blue-600 hover:underline"
              >
                查看相关综合实训 →
              </Link>
            )}
          </section>
          {syncWarning && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {syncWarning}
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}

function KnowledgeStatus({ title, text, done }: { title: string; text: string; done: boolean }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <b className="text-sm">{title}</b>
        {done && (
          <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
            <CheckCircle2 className="size-3.5" />
            已完成
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{text}</p>
    </section>
  );
}
