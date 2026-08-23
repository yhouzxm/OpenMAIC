import type { CourseStructure } from '@/lib/zhiban/curriculum';
import type { MechLabActivityContext } from './types';

/** Minimal, in-code demo entry. It does not create or query a course database record. */
export const MECH_LAB_SAMPLE_COURSE_ID = 'mech-mechatronics-system';
export const MECH_LAB_ACTIVITY_ID = 'mech-lab-line-stop';

const mechLabLineStop: MechLabActivityContext = {
  activityId: MECH_LAB_ACTIVITY_ID,
  courseId: MECH_LAB_SAMPLE_COURSE_ID,
  chapterId: 'mech-chapter-comprehensive-practice',
  scenarioId: 'line-stop-001',
  title: '基于PLC与光电传感器的自动输送系统智能故障诊断虚拟实训',
  description: '通过最小交互场景，练习按“观察—测量—判断—验证”流程定位自动输送系统异常。',
  difficulty: '基础 / 综合入门',
  estimatedMinutes: 15,
  learningObjectives: [
    '理解“感知—控制—执行”系统链路；',
    '能够根据现场状态与 PLC I/O 判断异常；',
    '能够利用测量证据缩小故障范围；',
    '能够按照“观察—测量—判断—验证”流程完成故障诊断。',
  ],
  courseTitle: '机电一体化系统',
  chapterTitle: '综合实践区：自动输送系统故障诊断',
  scenarioTitle: '自动输送系统 S2 无输出故障诊断',
  relatedChapterIds: ['mech-chapter-sensing', 'mech-chapter-control'],
};

export function getMechLabActivity(
  courseId: string,
  activityId: string,
): MechLabActivityContext | null {
  return courseId === mechLabLineStop.courseId && activityId === mechLabLineStop.activityId
    ? mechLabLineStop
    : null;
}

/** A single activity card is enough for the interactive-courseware entry in this batch. */
export function getMechLabSampleCourseStructure(courseId: string): CourseStructure | null {
  if (courseId !== MECH_LAB_SAMPLE_COURSE_ID) return null;
  return {
    courseId,
    version: 1,
    publishedAt: null,
    modules: [
      {
        id: 'mech-module-practice',
        title: '综合实践区',
        description: '关联第3章传感检测与转换技术、第5章系统控制技术。',
        position: 1,
        chapters: [
          {
            id: mechLabLineStop.chapterId,
            title: '自动输送系统故障诊断',
            description: '面向第3章与第5章的综合实训活动。',
            position: 1,
            estimatedMinutes: mechLabLineStop.estimatedMinutes,
            activities: [
              {
                id: mechLabLineStop.activityId,
                chapterId: mechLabLineStop.chapterId,
                title: mechLabLineStop.title,
                description: mechLabLineStop.description,
                activityType: 'virtual_lab',
                referenceId: mechLabLineStop.scenarioId,
                position: 1,
                estimatedMinutes: mechLabLineStop.estimatedMinutes,
                required: true,
                opensAt: null,
                closesAt: null,
                openingRule: {},
                // Completion is intentionally deferred to a later learning-event batch.
                completionRule: { type: 'virtual_lab' },
                prerequisiteActivityIds: [],
                progress: { status: 'not_started', progressPercent: 0, score: null },
                available: true,
                unavailableReason: null,
              },
            ],
          },
        ],
      },
    ],
  };
}
