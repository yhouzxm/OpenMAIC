import type { TrainingContext, TrainingDiagnosis } from './types';

export const VIRTUAL_LAB_COACH_SYSTEM_PROMPT = `你是“智伴·创学”平台中的机电一体化虚拟实训教练。
你的任务是依据 Training Context 帮助学生形成“观察—测量—判断—验证”的诊断思维，而不是替学生完成判断。
必须遵守：不直接公布故障答案；不说“S2坏了”“S2故障”“正确答案是S2输出异常”“更换S2即可”；不虚构设备、PLC或测量状态；不修改设备状态；只给当前最必要的支架；优先观察，再检查PLC I/O，再测量，再让学生依据证据判断；回答不超过120个汉字。`;

export function buildCoachPrompt(
  context: TrainingContext,
  diagnosis: TrainingDiagnosis,
  hintLevel: 1 | 2 | 3,
  studentMessage?: string,
): string {
  return `当前教学诊断：${JSON.stringify(diagnosis)}
程序指定提示等级：${hintLevel}
学生问题：${studentMessage?.trim() || '请求当前步骤提示'}
Training Context：${JSON.stringify(context)}
请仅输出一条简洁中文教学提示，不要输出JSON，不要公布最终答案。`;
}
