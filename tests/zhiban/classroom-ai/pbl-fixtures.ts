import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
export function autonomousProject(scenario = false): PBLProjectV2 {
  const project: PBLProjectV2 = {
    uiPhase: 'hero',
    title: scenario ? '设备维修沟通演练' : '教室节能方案',
    description: '记录可靠依据，解释方案与局限。',
    learningObjective: '区分观察与估算，给出可验证方案',
    gains: ['证据表达', '方案评价'],
    language: 'zh-CN',
    proficiency: 'beginner',
    tags: ['自主PBL'],
    status: 'active',
    roles: [{ id: 'instructor', type: 'instructor', name: '项目导师' }],
    milestones: [
      {
        id: 'milestone-1',
        title: '节能方案',
        status: 'active',
        order: 0,
        documents: [],
        briefing: '提出节能措施并计算节省用电。',
        completionCriteria: '有计算、有观察来源、有局限。',
        microtasks: [
          {
            id: 'task-1',
            title: '提交节能建议',
            description: '假设教室有10盏20W灯，每天少开2小时，请计算节约电量并明确估算来源。',
            status: 'todo',
            assignee: 'user',
            hints: ['能量=功率×时间，区分kWh与Wh'],
            order: 0,
            completionCriteria: '写出0.4kWh的计算、这是题设估算而非真实测量，并给出验证方法。',
          },
        ],
      },
    ],
    submissions: [],
    evaluations: [],
    threads: [{ agentId: 'instructor', messages: [] }],
    engagementEvents: [],
    runtimeEvents: [],
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
  };
  if (scenario) {
    project.scenario = {
      setting: '学校设备维修接待台',
      goal: '澄清故障现象，说明安全处置边界',
      rules: '不拆带电设备，不编造测量结果。',
      learnerRole: '值班技术员',
      characters: [
        {
          id: 'customer',
          name: '王老师',
          persona: '希望快速恢复教学，表达清楚',
          situation: '投影仪无法启动',
          boundaries: '只说明观察到的现象，不提供危险操作建议。',
        },
      ],
    };
    project.milestones = [
      {
        ...project.milestones[0],
        title: '维修接待准备',
        scenarioStage: 'prep',
        microtasks: [{ ...project.milestones[0].microtasks[0], title: '了解接待要求' }],
      },
      {
        id: 'roleplay',
        title: '澄清故障',
        status: 'locked',
        order: 1,
        scenarioStage: 'roleplay',
        documents: [],
        briefing: '询问投影仪指示灯与近期变化，不要求拆机。',
        microtasks: [
          {
            id: 'roleplay-task',
            title: '核对现象',
            description: '向王老师核对设备状态和安全处置。',
            completionCriteria: '澄清设备状态并告知先断电联系专业维修。',
            status: 'todo',
            assignee: 'user',
            order: 0,
            hints: [],
          },
        ],
      },
      {
        id: 'wrapup',
        title: '反思与总结',
        status: 'locked',
        order: 2,
        scenarioStage: 'wrapup',
        documents: [],
        microtasks: [
          {
            id: 'wrap-task',
            title: '记录处置',
            description: '回顾接待和安全边界。',
            status: 'todo',
            assignee: 'user',
            order: 0,
            hints: [],
          },
        ],
      },
    ];
  }
  return project;
}
