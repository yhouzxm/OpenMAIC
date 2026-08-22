import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { requireRequestGrantedPermission } from '@/lib/zhiban/rbac';
import { getTeachingAnalytics } from '@/lib/zhiban/teaching-analytics';
const q=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`;
export async function GET(_:Request,{params}:{params:Promise<{courseId:string}>}){const p=await requireRequestGrantedPermission('course:manage'),courseId=z.uuid().parse((await params).courseId),d=await getTeachingAnalytics(getZhibanPool(),p,courseId);const lines=[['类型','名称','指标1','指标2','指标3'].map(q).join(','),...d.modules.map((r)=>['模块',r.title,r.activity_count,r.completion_rate+'%',''].map(q).join(',')),...d.activities.map((r)=>['活动',r.title,r.started_count,r.completed_count,r.completion_rate+'%'].map(q).join(',')),...d.learners.map((r)=>['学生',r.learner_name,r.segment,r.events_30d,r.total_score].map(q).join(','))];return new Response('\uFEFF'+lines.join('\r\n'),{headers:{'content-type':'text/csv;charset=utf-8','content-disposition':`attachment; filename="teaching-analytics-${courseId}.csv"`}});}
