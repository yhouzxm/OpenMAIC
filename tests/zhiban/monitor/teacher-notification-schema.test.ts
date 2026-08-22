import { describe,expect,it } from 'vitest';
import { monitorTeacherNotificationsMigration } from '@/lib/zhiban/db/migrations/046-monitor-teacher-notifications';
describe('Monitor teacher notification migration',()=>{const sql=monitorTeacherNotificationsMigration.up.join('\n');it('allows a Monitor notification without fabricating a risk case',()=>{expect(sql).toContain('case_id DROP NOT NULL');expect(sql).toContain('monitor_escalation');});});
