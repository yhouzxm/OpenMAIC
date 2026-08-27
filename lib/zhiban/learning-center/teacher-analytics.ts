import { KNOWLEDGE_STATIONS } from './registry';
import { LEARNING_CENTER_DIMENSIONS, type LearningCenterDimensionKey } from './types';

export interface TeacherKnowledgeEventRow {
  learnerId: string;
  stationId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface TeacherLearningProfileRow {
  userId: string;
  dimensions: Partial<Record<LearningCenterDimensionKey, number>>;
}

const dimensionLabels: Record<LearningCenterDimensionKey, string> = {
  systemUnderstanding: '系统机理理解',
  sensorDetection: '传感检测能力',
  plcSignalAnalysis: 'PLC信号分析',
  toolMeasurement: '工具检测能力',
  evidenceReasoning: '证据推理能力',
  faultDiagnosisVerification: '故障诊断与验证',
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

export function buildTeacherLearningCenterAnalytics(
  events: TeacherKnowledgeEventRow[],
  profiles: TeacherLearningProfileRow[],
  virtualLabLearnerIds: string[],
) {
  const learners = new Set([
    ...events.map((event) => event.learnerId),
    ...profiles.map((profile) => profile.userId),
    ...virtualLabLearnerIds,
  ]);
  const totalStudents = learners.size;
  const completedByStation = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.eventType !== 'COMPLETE_STATION') continue;
    const bucket = completedByStation.get(event.stationId) ?? new Set<string>();
    bucket.add(event.learnerId);
    completedByStation.set(event.stationId, bucket);
  }
  completedByStation.set('station-06-virtual-lab', new Set(virtualLabLearnerIds));

  const conceptCounts = new Map<string, number>();
  for (const event of events) {
    const codes = Array.isArray(event.payload?.conceptErrors) ? event.payload.conceptErrors : [];
    for (const value of codes) {
      if (typeof value !== 'string') continue;
      conceptCounts.set(value, (conceptCounts.get(value) ?? 0) + 1);
    }
  }

  const conceptErrors = [...conceptCounts.entries()]
    .map(([code, count]) => ({
      code,
      count,
      percent: totalStudents ? round((count / totalStudents) * 100) : 0,
    }))
    .sort((left, right) => right.count - left.count);

  const interventions: string[] = [];
  if (conceptCounts.get('POWER_EQUALS_SENSOR_NORMAL'))
    interventions.push(
      '建议强化传感器供电与输出信号的区别，可组织学生返回“感知探秘”完成测量推演。',
    );
  if (
    (conceptCounts.get('INPUT_OUTPUT_CONFUSION') ?? 0) +
      (conceptCounts.get('FIELD_IO_MAPPING_ERROR') ?? 0) >
    0
  )
    interventions.push('建议强化PLC输入/输出及现场地址映射，并返回“控制推演”完成I/O匹配。');
  if (conceptCounts.get('OUTPUT_EQUALS_ACTUATION_SUCCESS'))
    interventions.push('建议比较“PLC已有输出”与“执行机构真实动作”，返回“执行探索”复核执行链。');
  if (
    [...conceptCounts.keys()].some(
      (code) => code.endsWith('_LAYER_CONFUSION') || code === 'EVIDENCE_SELECTION_ERROR',
    )
  )
    interventions.push('建议使用“察—查—测—断—验”重新组织三层故障诊断证据。');

  return {
    participatingStudents: totalStudents,
    stationCompletion: KNOWLEDGE_STATIONS.map((station) => {
      const completedStudents = completedByStation.get(station.id)?.size ?? 0;
      return {
        stationId: station.id,
        title: station.title,
        completedStudents,
        totalStudents,
        rate: totalStudents ? round((completedStudents / totalStudents) * 100) : null,
      };
    }),
    dimensions: LEARNING_CENTER_DIMENSIONS.map((key) => {
      const values = profiles
        .map((profile) => profile.dimensions[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      return {
        key,
        label: dimensionLabels[key],
        average: values.length
          ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
          : null,
      };
    }),
    conceptErrors,
    interventions,
  };
}
