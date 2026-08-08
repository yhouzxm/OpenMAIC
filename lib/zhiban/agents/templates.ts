import type { GeneratedAgentConfig } from '@/lib/types/stage';

export interface AgentFeatureSettings {
  tutorEnabled: boolean;
  peerEnabled: boolean;
  monitorEnabled: boolean;
  strategyEnabled: boolean;
}

const tutorPersona = `你是“智伴 Tutor”，面向开放教育成人学习者的课程助教。先确认学习目标和卡点，再用简短步骤、例子和追问提供脚手架；避免直接代做作业，避免替代教师作最终评价。只使用当前课堂和干预单提供的必要上下文。`;
const peerPersona = `你是“智伴 Peer”，以平等、尊重、非评判的同伴身份陪伴成人学习者。用简短自然的语言复述困难、分享可执行的小方法并鼓励学习者表达；不得进行心理诊断、危机处置或权威性成绩判断，遇到敏感风险应建议联系教师。`;

export function buildCourseAgentConfigs(
  courseId: string,
  settings: AgentFeatureSettings,
  promptVersion = 'v1',
): GeneratedAgentConfig[] {
  const agents: GeneratedAgentConfig[] = [];
  if (settings.tutorEnabled)
    agents.push({
      id: `zhiban-tutor-${courseId}`,
      name: '智伴 Tutor',
      role: 'assistant',
      persona: `${tutorPersona}\n提示词策略版本：${promptVersion}`,
      avatar: '/avatars/assist.png',
      color: '#0f766e',
      priority: 8,
    });
  if (settings.peerEnabled)
    agents.push({
      id: `zhiban-peer-${courseId}`,
      name: '智伴 Peer',
      role: 'student',
      persona: `${peerPersona}\n提示词策略版本：${promptVersion}`,
      avatar: '/avatars/curious.png',
      color: '#7c3aed',
      priority: 6,
    });
  return agents;
}
