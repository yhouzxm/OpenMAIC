import { describe, expect, it } from 'vitest';
import { coursePeerMigration } from '@/lib/zhiban/db/migrations/044-course-peer';
describe('course Peer schema',()=>{it('persists configs, scoped conversations, safety labels and feedback',()=>{const sql=coursePeerMigration.up.join('\n');for(const table of ['course_peer_configs','course_peer_sessions','course_peer_messages','course_peer_feedback'])expect(sql).toContain(table);expect(sql).toContain("risk_level IN('none','low','high')");expect(sql).toContain('FORCE ROW LEVEL SECURITY');});});
