import type { MonitorAssessment, MonitorPolicy } from './types';
const score=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):0;};
export function assessMonitorRisk(dimensions:Record<string,unknown>,policy:MonitorPolicy):MonitorAssessment{
  const achievement=score(dimensions.achievement),completion=score(dimensions.completion),engagement=score(dimensions.engagement),collaboration=score(dimensions.collaboration);
  const inactivity=score(dimensions.inactivityRisk ?? 0);
  const attrition=Math.round(Math.min(100,(100-completion)*.4+(100-engagement)*.4+inactivity*.2));
  if(attrition>=policy.teacherThreshold || (completion<25&&engagement<25)) return {riskScore:attrition,riskLevel:'high',signalType:'attrition',target:'teacher',objective:'请教师核验持续低参与和低完成的原因并决定人工跟进',tone:'客观、审慎、仅陈述学习证据',reason:`完成度${completion}、参与度${engagement}，流失风险${attrition}`};
  if(achievement>0&&achievement<policy.tutorThreshold) return {riskScore:100-achievement,riskLevel:'medium',signalType:'cognitive',target:'tutor',objective:'定位知识卡点，提供分步支架并进行一次理解检查',tone:'清晰、耐心、鼓励自主完成',reason:`学业表现${achievement}低于Tutor阈值${policy.tutorThreshold}`};
  if(collaboration<policy.peerThreshold) return {riskScore:Math.round((100-collaboration)*.6+(100-engagement)*.4),riskLevel:'low',signalType:'motivation',target:'peer',objective:'通过共情陪伴帮助学习者说出一个可立即执行的下一步',tone:'平等、简短、非评判',reason:`协作度${collaboration}低于Peer阈值${policy.peerThreshold}，当前参与度${engagement}`};
  if(completion<60) return {riskScore:100-completion,riskLevel:'medium',signalType:'progress',target:'tutor',objective:'帮助学习者拆分当前任务并制定本次可完成的小目标',tone:'具体、支持性、不过度催促',reason:`课程完成度${completion}偏低`};
  return {riskScore:Math.max(0,100-Math.round((achievement+completion+engagement)/3)),riskLevel:'none',signalType:'stable',target:null,objective:'',tone:'',reason:'当前学习指标未达到干预阈值'};
}
