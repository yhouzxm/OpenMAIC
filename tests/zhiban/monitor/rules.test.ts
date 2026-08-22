import { describe,expect,it } from 'vitest';
import { assessMonitorRisk,type MonitorPolicy } from '@/lib/zhiban/monitor';
const policy:MonitorPolicy={enabled:true,mode:'active',tutorThreshold:60,peerThreshold:35,teacherThreshold:75,cooldownMinutes:30,dailyLimit:3,followupHours:24,policyVersion:'test-v1'};
describe('Monitor deterministic coordination rules',()=>{
  it('escalates sustained low completion and engagement to a teacher',()=>{const result=assessMonitorRisk({completion:10,engagement:10,achievement:70,collaboration:60},policy);expect(result.target).toBe('teacher');expect(result.signalType).toBe('attrition');expect(result.riskLevel).toBe('high');});
  it('routes a knowledge barrier to Tutor',()=>{const result=assessMonitorRisk({completion:75,engagement:75,achievement:42,collaboration:70},policy);expect(result.target).toBe('tutor');expect(result.signalType).toBe('cognitive');});
  it('routes low collaboration and engagement to Peer',()=>{const result=assessMonitorRisk({completion:80,engagement:50,achievement:80,collaboration:10},policy);expect(result.target).toBe('peer');expect(result.signalType).toBe('motivation');});
  it('records a no-action assessment for stable learning',()=>{const result=assessMonitorRisk({completion:90,engagement:90,achievement:85,collaboration:80},policy);expect(result.target).toBeNull();expect(result.riskLevel).toBe('none');});
});
