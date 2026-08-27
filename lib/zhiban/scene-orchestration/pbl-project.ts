import type { ZhibanPblDefinitionInput } from '@/lib/zhiban/pbl/types';
import type { SceneId } from './types';

export const MECHATRONICS_PROJECT_ID = 'pbl-mech-line-recovery' as const;

export const MECHATRONICS_PROJECT_STAGES = [
  {
    stationId: 'station-01-system',
    label: '识系统',
    objective: '认识自动生产线及三层系统结构',
    sceneIds: ['S01-01', 'S01-02', 'S01-03', 'S01-04'],
  },
  {
    stationId: 'station-02-sensing',
    label: '探感知',
    objective: '理解位置、传感器输出与PLC输入',
    sceneIds: ['S02-01', 'S02-02', 'S02-03', 'S02-04'],
  },
  {
    stationId: 'station-03-control',
    label: '析控制',
    objective: '推演PLC输入、逻辑和输出',
    sceneIds: ['S03-01', 'S03-02', 'S03-03', 'S03-04'],
  },
  {
    stationId: 'station-04-actuation',
    label: '追执行',
    objective: '追踪控制信号到机械动作',
    sceneIds: ['S04-01', 'S04-02', 'S04-03'],
  },
  {
    stationId: 'station-05-diagnosis',
    label: '学诊断',
    objective: '运用察—查—测—断—验循证诊断',
    sceneIds: ['S05-01', 'S05-02', 'S05-03', 'S05-04'],
  },
  {
    stationId: 'station-06-virtual-lab',
    label: '战故障',
    objective: '完成自动输送系统故障诊断与恢复',
    sceneIds: ['S06-01', 'S06-02', 'S06-03'],
  },
  {
    stationId: 'station-07-assessment',
    label: '评提升',
    objective: '查看画像、精准补救并再次实训',
    sceneIds: ['S07-01', 'S07-02', 'S07-03'],
  },
] as const satisfies readonly {
  stationId: string;
  label: string;
  objective: string;
  sceneIds: readonly SceneId[];
}[];

export function createMechatronicsPblDefinition(courseId: string): ZhibanPblDefinitionInput {
  return {
    id: MECHATRONICS_PROJECT_ID,
    courseId,
    code: 'MECH-LINE-RECOVERY',
    title: '抢修停摆的自动生产线',
    description:
      '自动生产线出现异常停机。学习者需要通过系统认知、信号分析、控制推演、故障诊断和维修验证，最终恢复生产。',
    learningObjective: '沿信号链理解系统机理，循证据链完成故障诊断与维修验证。',
    targetSkills: ['系统认知', '传感检测', 'PLC信号分析', '工具测量', '循证诊断', '维修验证'],
    deliverable: '完成自动生产线故障诊断记录、修复验证结果与个人学习改进建议。',
    scenarioRoleplay: true,
    scenarioBrief: '你是生产线抢修小组成员，需要依据现场、PLC和测量证据恢复生产。',
  };
}
