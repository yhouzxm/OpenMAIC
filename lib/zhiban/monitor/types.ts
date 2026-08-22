export type MonitorTarget = 'peer' | 'tutor' | 'teacher';
export type MonitorRiskLevel = 'none' | 'low' | 'medium' | 'high';
export interface MonitorPolicy { enabled:boolean; mode:'shadow'|'active'|'paused'; tutorThreshold:number; peerThreshold:number; teacherThreshold:number; cooldownMinutes:number; dailyLimit:number; followupHours:number; policyVersion:string; }
export interface MonitorAssessment { riskScore:number; riskLevel:MonitorRiskLevel; signalType:string; target:MonitorTarget|null; objective:string; tone:string; reason:string; }
