import { createHash, randomUUID } from 'node:crypto';
import { COURSE_TUTOR_PERSONA } from '@/lib/zhiban/agents/templates';
import { isZhibanCourseTutorEnabled } from '@/lib/config/feature-flags';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { CourseTutorCitation, CourseTutorConfig, CourseTutorMessage } from './types';

type Row = Record<string, unknown>;
const defaultConfig: CourseTutorConfig = {
  enabled: true,
  displayName: '课程 Tutor',
  welcomeMessage: '你好，我可以帮助你理解课程知识、拆解学习任务，并陪你检查理解情况。',
  systemPrompt: '',
  retrievalTopK: 5,
  citationRequired: true,
  answerScope: 'course_only',
  maxHistoryMessages: 12,
  status: 'draft',
  version: 1,
  autoSync: true,
  lastSyncedAt: null,
  lastSyncStatus: 'pending',
  lastSyncError: null,
};

function mapConfig(row?: Row): CourseTutorConfig {
  if (!row) return defaultConfig;
  return {
    enabled: Boolean(row.enabled), displayName: String(row.display_name), welcomeMessage: String(row.welcome_message),
    systemPrompt: String(row.system_prompt ?? ''), retrievalTopK: Number(row.retrieval_top_k),
    citationRequired: Boolean(row.citation_required), answerScope: row.answer_scope as CourseTutorConfig['answerScope'],
    maxHistoryMessages: Number(row.max_history_messages), status: row.status as CourseTutorConfig['status'], version: Number(row.version),
    autoSync: row.auto_sync === undefined ? true : Boolean(row.auto_sync),
    lastSyncedAt: row.last_synced_at ? new Date(String(row.last_synced_at)).toISOString() : null,
    lastSyncStatus: (row.last_sync_status ?? 'pending') as CourseTutorConfig['lastSyncStatus'],
    lastSyncError: row.last_sync_error ? String(row.last_sync_error) : null,
  };
}

function canManageCourse(principal: AuthorizedPrincipal, courseId: string) {
  return principal.permissions.includes('course:manage') && principal.grants.some((grant) =>
    grant.permission === 'course:manage' && (grant.scopeType === 'system' || grant.scopeType === 'tenant' || (grant.scopeType === 'course' && grant.scopeId === courseId)));
}

async function requireEnrollment(client: ZhibanDatabaseClient, principal: AuthorizedPrincipal, courseId: string) {
  const found = await client.query(`SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
    WHERE e.student_id=$1 AND e.status='enrolled' AND o.course_id=$2 LIMIT 1`, [principal.id, courseId]);
  if (!found.rows[0]) throw new Error('Course is unavailable');
}

export async function getTeacherTutorDashboard(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, courseId: string) {
  if (!canManageCourse(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const [config, documents, usage, issues, syncRuns] = await Promise.all([
      client.query<Row>(`SELECT * FROM zhiban.course_tutor_configs WHERE course_id=$1`, [courseId]),
      client.query<Row>(`SELECT id,source_type,source_id,title,status,metadata,synced_at,
        (SELECT count(*)::int FROM zhiban.course_tutor_chunks c WHERE c.document_id=d.id) chunk_count
        FROM zhiban.course_tutor_documents d WHERE course_id=$1 ORDER BY synced_at DESC`, [courseId]),
      client.query<Row>(`SELECT count(DISTINCT session_id)::int session_count,count(*) FILTER(WHERE role='assistant')::int answer_count,
        count(*) FILTER(WHERE status='failed')::int failure_count,count(*) FILTER(WHERE status='blocked')::int blocked_count,
        round(avg(latency_ms) FILTER(WHERE role='assistant'))::int average_latency_ms,
        round(100.0*count(*) FILTER(WHERE f.rating=1)/NULLIF(count(f.id),0),1) positive_feedback_percent
        FROM zhiban.course_tutor_messages m LEFT JOIN zhiban.course_tutor_feedback f ON f.message_id=m.id WHERE m.course_id=$1`, [courseId]),
      client.query<Row>(`SELECT m.id,m.content,m.status,m.safety_category,m.created_at,a.display_name student_name,f.rating,f.comment
        FROM zhiban.course_tutor_messages m JOIN zhiban.accounts a ON a.id=m.student_id
        LEFT JOIN zhiban.course_tutor_feedback f ON f.message_id=m.id
        WHERE m.course_id=$1 AND m.role='assistant' AND (m.status<>'completed' OR f.rating=-1)
        ORDER BY m.created_at DESC LIMIT 20`, [courseId]),
      client.query<Row>(`SELECT id,trigger_type,status,source_count,changed_count,error_message,started_at,finished_at
        FROM zhiban.course_tutor_sync_runs WHERE course_id=$1 ORDER BY started_at DESC LIMIT 10`, [courseId]),
    ]);
    return { config: mapConfig(config.rows[0]), documents: documents.rows, usage: usage.rows[0] ?? {}, issues: issues.rows, syncRuns: syncRuns.rows };
  });
}

type TutorConfigInput = Pick<CourseTutorConfig, 'enabled' | 'displayName' | 'welcomeMessage' | 'systemPrompt' | 'retrievalTopK' | 'citationRequired' | 'answerScope' | 'maxHistoryMessages' | 'status' | 'autoSync'>;

export async function saveCourseTutorConfig(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, courseId: string, input: TutorConfigInput) {
  if (!canManageCourse(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO zhiban.course_tutor_configs(id,tenant_id,course_id,enabled,display_name,welcome_message,system_prompt,retrieval_top_k,citation_required,answer_scope,max_history_messages,status,updated_by,auto_sync)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(tenant_id,course_id) DO UPDATE SET enabled=$4,
       display_name=$5,welcome_message=$6,system_prompt=$7,retrieval_top_k=$8,citation_required=$9,answer_scope=$10,
       max_history_messages=$11,status=$12,auto_sync=$14,version=zhiban.course_tutor_configs.version+1,updated_by=$13,updated_at=now() RETURNING version`,
      [id, principal.tenantId, courseId, input.enabled, input.displayName, input.welcomeMessage, input.systemPrompt,
        input.retrievalTopK, input.citationRequired, input.answerScope, input.maxHistoryMessages, input.status, principal.id, input.autoSync],
    );
    return result.rows[0];
  });
}

function chunks(content: string, size = 1200, overlap = 150) {
  const normalized = content.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];
  const result: string[] = [];
  for (let start = 0; start < normalized.length; start += size - overlap) {
    result.push(normalized.slice(start, start + size));
    if (start + size >= normalized.length) break;
  }
  return result;
}

async function upsertDocument(client: ZhibanDatabaseClient, tenantId: string, courseId: string, sourceType: string, sourceId: string, title: string, content: string, metadata: Row = {}) {
  const checksum = createHash('sha256').update(content).digest('hex'), id = randomUUID();
  const existing = await client.query<{ id: string; checksum: string }>(
    `SELECT id,checksum FROM zhiban.course_tutor_documents WHERE course_id=$1 AND source_type=$2 AND source_id=$3`, [courseId, sourceType, sourceId]);
  if (existing.rows[0]?.checksum === checksum) return { changed: false, id: existing.rows[0].id };
  const documentId = existing.rows[0]?.id ?? id;
  await client.query(
    `INSERT INTO zhiban.course_tutor_documents(id,tenant_id,course_id,source_type,source_id,title,content,checksum,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(tenant_id,course_id,source_type,source_id)
     DO UPDATE SET title=$6,content=$7,checksum=$8,metadata=$9::jsonb,status='active',synced_at=now(),updated_at=now()`,
    [documentId, tenantId, courseId, sourceType, sourceId, title, content, checksum, JSON.stringify(metadata)]);
  await client.query(`DELETE FROM zhiban.course_tutor_chunks WHERE document_id=$1`, [documentId]);
  for (const [index, part] of chunks(content).entries()) await client.query(
    `INSERT INTO zhiban.course_tutor_chunks(id,tenant_id,course_id,document_id,chunk_index,content,token_estimate)
     VALUES($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), tenantId, courseId, documentId, index, part, Math.ceil(part.length / 3)]);
  return { changed: true, id: documentId };
}

async function syncKnowledge(client: ZhibanDatabaseClient, tenantId: string, courseId: string, actorId: string | null, triggerType: 'manual' | 'automatic') {
    const runId = randomUUID();
    await client.query(`INSERT INTO zhiban.course_tutor_sync_runs(id,tenant_id,course_id,trigger_type,status,started_by) VALUES($1,$2,$3,$4,'running',$5)`, [runId, tenantId, courseId, triggerType, actorId]);
    await client.query(`UPDATE zhiban.course_tutor_configs SET last_sync_status='running',last_sync_error=NULL WHERE course_id=$1`, [courseId]);
    try {
    const sources = await client.query<Row>(
      `SELECT 'activity_content' source_type,c.id::text source_id,a.title,c.body content,jsonb_build_object('activityId',a.id,'format',c.content_format) metadata
       FROM zhiban.course_activity_contents c JOIN zhiban.course_activities a ON a.id=c.activity_id WHERE c.course_id=$1 AND c.status='published'
       UNION ALL SELECT 'course_resource',r.id::text,r.title,concat_ws(E'\n',r.description,CASE WHEN r.mime_type LIKE 'text/%' THEN convert_from(r.content,'UTF8') ELSE r.url END),jsonb_build_object('resourceType',r.resource_type,'fileName',r.file_name)
       FROM zhiban.course_resources_v2 r WHERE r.course_id=$1 AND r.status='published' AND r.ai_index_enabled
       UNION ALL SELECT 'assignment',x.id::text,x.title,x.instructions,jsonb_build_object('activityId',x.activity_id,'dueAt',x.due_at)
       FROM zhiban.activity_assignments x WHERE x.course_id=$1 AND x.status IN('published','closed')
       UNION ALL SELECT 'pbl',p.id::text,p.title,concat_ws(E'\n',p.description,p.learning_objective,p.deliverable,p.scenario_brief),jsonb_build_object('skills',p.target_skills)
       FROM zhiban.pbl_projects p WHERE p.course_id=$1 AND p.status='published'
       UNION ALL SELECT 'classroom',cc.id::text,cc.title,concat_ws(E'\n',cc.description,cd.stage::text,cd.scenes::text),jsonb_build_object('classroomId',cc.classroom_id)
       FROM zhiban.course_classrooms cc LEFT JOIN zhiban.openmaic_classroom_documents cd ON cd.classroom_id=cc.classroom_id WHERE cc.course_id=$1 AND cc.status='published'
       UNION ALL SELECT 'discussion',t.id::text,t.title,t.description,jsonb_build_object('activityId',t.activity_id)
       FROM zhiban.discussion_topics t WHERE t.course_id=$1 AND t.status IN('open','closed')`, [courseId]);
    let changed = 0;
    const activeKeys: string[] = [];
    for (const row of sources.rows) {
      const content = String(row.content ?? '').trim(); if (!content) continue;
      activeKeys.push(`${row.source_type}:${row.source_id}`);
      const result = await upsertDocument(client, tenantId, courseId, String(row.source_type), String(row.source_id), String(row.title), content, row.metadata as Row);
      if (result.changed) changed += 1;
    }
    await client.query(`UPDATE zhiban.course_tutor_documents SET status='archived',updated_at=now()
      WHERE course_id=$1 AND source_type<>'manual' AND NOT(source_type||':'||source_id=ANY($2::text[]))`, [courseId, activeKeys]);
    await client.query(`UPDATE zhiban.course_tutor_sync_runs SET status='succeeded',source_count=$2,changed_count=$3,finished_at=now() WHERE id=$1`, [runId, activeKeys.length, changed]);
    await client.query(`UPDATE zhiban.course_tutor_configs SET last_sync_status='succeeded',last_sync_error=NULL,last_synced_at=now() WHERE course_id=$1`, [courseId]);
    return { total: activeKeys.length, changed, runId };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown synchronization failure';
      await client.query(`UPDATE zhiban.course_tutor_sync_runs SET status='failed',error_message=$2,finished_at=now() WHERE id=$1`, [runId, message]);
      await client.query(`UPDATE zhiban.course_tutor_configs SET last_sync_status='failed',last_sync_error=$2 WHERE course_id=$1`, [courseId, message]);
      return { total: 0, changed: 0, runId, failed: true, error: message };
    }
}

export async function syncCourseTutorKnowledge(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, courseId: string) {
  if (!canManageCourse(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, (client) =>
    syncKnowledge(client, principal.tenantId, courseId, principal.id, 'manual'));
}

async function ensureFreshKnowledge(client: ZhibanDatabaseClient, principal: AuthorizedPrincipal, courseId: string, config: CourseTutorConfig) {
  if (!config.autoSync) return;
  const freshness = await client.query<{ source_updated_at: string | null }>(`SELECT max(updated_at)::text source_updated_at FROM (
    SELECT updated_at FROM zhiban.course_activity_contents WHERE course_id=$1 AND status='published'
    UNION ALL SELECT updated_at FROM zhiban.course_resources_v2 WHERE course_id=$1 AND status='published' AND ai_index_enabled
    UNION ALL SELECT updated_at FROM zhiban.activity_assignments WHERE course_id=$1 AND status IN('published','closed')
    UNION ALL SELECT updated_at FROM zhiban.pbl_projects WHERE course_id=$1 AND status='published'
    UNION ALL SELECT updated_at FROM zhiban.course_classrooms WHERE course_id=$1 AND status='published'
    UNION ALL SELECT updated_at FROM zhiban.discussion_topics WHERE course_id=$1 AND status IN('open','closed')) s`, [courseId]);
  const changedAt = freshness.rows[0]?.source_updated_at;
  if (changedAt && (!config.lastSyncedAt || new Date(changedAt) > new Date(config.lastSyncedAt))) {
    await syncKnowledge(client, principal.tenantId, courseId, principal.id, 'automatic');
  }
}
export async function addManualTutorDocument(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, courseId: string, input: { title: string; content: string }) {
  if (!canManageCourse(principal, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, (client) => upsertDocument(client, principal.tenantId, courseId, 'manual', randomUUID(), input.title, input.content));
}

function mapMessage(row: Row): CourseTutorMessage {
  return { id: String(row.id), role: row.role as CourseTutorMessage['role'], content: String(row.content),
    citations: (row.citations as CourseTutorCitation[]) ?? [], status: row.status as CourseTutorMessage['status'], createdAt: new Date(String(row.created_at)).toISOString(), safetyCategory: row.safety_category ? String(row.safety_category) : null };
}

export async function getStudentTutorState(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, courseId: string, sessionId?: string, activityId?: string) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal, courseId);
    const config = mapConfig((await client.query<Row>(`SELECT * FROM zhiban.course_tutor_configs WHERE course_id=$1`, [courseId])).rows[0]);
    let session = sessionId ? (await client.query<Row>(`SELECT * FROM zhiban.course_tutor_sessions WHERE id=$1 AND student_id=$2 AND course_id=$3`, [sessionId, principal.id, courseId])).rows[0] : undefined;
    if (!session) session = (await client.query<Row>(`SELECT * FROM zhiban.course_tutor_sessions WHERE student_id=$1 AND course_id=$2 AND status='active' ORDER BY last_message_at DESC LIMIT 1`, [principal.id, courseId])).rows[0];
    const messages = session ? (await client.query<Row>(`SELECT * FROM zhiban.course_tutor_messages WHERE session_id=$1 ORDER BY created_at`, [session.id])).rows.map(mapMessage) : [];
    const activity = activityId ? (await client.query<Row>(`SELECT id,title,description,completion_rule FROM zhiban.course_activities
      WHERE id=$1 AND course_id=$2 AND activity_type='ai_support' AND status='published'`, [activityId, courseId])).rows[0] : undefined;
    const proactiveBrief=(await client.query<Row>(`SELECT id,objective,tone,created_at FROM zhiban.intervention_briefs WHERE learner_id=$1 AND course_id=$2 AND target_role='tutor' AND status='pending' AND expires_at>now() ORDER BY created_at DESC LIMIT 1`,[principal.id,courseId])).rows[0];
    return { config, sessionId: session ? String(session.id) : null, messages, activity: activity ? {
      id: String(activity.id), title: String(activity.title), description: String(activity.description ?? ''),
      settings: ((activity.completion_rule as Row | undefined)?.aiSupport as Row | undefined) ?? {},
    } : null,proactiveBrief:proactiveBrief?{id:String(proactiveBrief.id),objective:String(proactiveBrief.objective),tone:String(proactiveBrief.tone),createdAt:new Date(String(proactiveBrief.created_at)).toISOString()}:null };
  });
}

function terms(input: string) {
  const raw = input.toLowerCase().match(/[a-z0-9_]+|[\u3400-\u9fff]+/g) ?? [];
  return [...new Set(raw.flatMap((item) => item.length > 4 && /[\u3400-\u9fff]/.test(item) ? [item, ...Array.from({ length: item.length - 1 }, (_, i) => item.slice(i, i + 2))] : [item]))].slice(0, 30);
}

export type TutorSafetyDecision = { category: 'self_harm' | 'assessment_answer' | 'personal_data' | null; blocked: boolean; response?: string };

export function assessTutorMessage(message: string): TutorSafetyDecision {
  const normalized = message.toLowerCase();
  if (/(自杀|自残|不想活|结束生命|suicide|self[- ]harm)/i.test(normalized)) return {
    category: 'self_harm', blocked: true,
    response: '我很重视你刚才表达的感受，但我不能独自处理紧急心理危机。请立即联系你信任的家人、班主任或当地紧急援助；如果你正处于危险中，请立即拨打当地急救或报警电话。系统会将本次情况作为需要人工关注的安全事件记录。',
  };
  if (/(直接.{0,4}(答案|代写)|帮我.{0,4}(完成|写完).{0,8}(作业|论文|测验)|考试答案|answer the (quiz|exam))/i.test(normalized)) return {
    category: 'assessment_answer', blocked: true,
    response: '我不能代写作业或直接提供测验答案，但可以帮你分析题目要求、回顾相关知识点，并把解题过程拆成可操作的步骤。你可以先说说自己的思路或卡住的位置。',
  };
  if (/(身份证号|银行卡号|支付密码|完整密码)/i.test(normalized)) return {
    category: 'personal_data', blocked: true,
    response: '为保护隐私，请不要在 Tutor 对话中发送身份证号、银行卡号或密码等敏感信息。你可以隐去个人信息后重新描述问题。',
  };
  return { category: null, blocked: false };
}

export async function prepareTutorTurn(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, courseId: string, input: { sessionId: string | null; message: string; requestId: string; activityId?: string | null }) {
  if (!isZhibanCourseTutorEnabled()) throw new Error('课程 Tutor 当前已关闭');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal, courseId);
    const config = mapConfig((await client.query<Row>(`SELECT * FROM zhiban.course_tutor_configs WHERE course_id=$1 AND enabled AND status='published'`, [courseId])).rows[0]);
    if (config.status !== 'published' || !config.enabled) throw new Error('课程 Tutor 尚未开放');
    await ensureFreshKnowledge(client, principal, courseId, config);
    const duplicate = await client.query<Row>(`SELECT id,session_id,content,citations,status,created_at,safety_category FROM zhiban.course_tutor_messages
      WHERE student_id=$1 AND request_id=$2 AND role='assistant' LIMIT 1`, [principal.id, input.requestId]);
    if (duplicate.rows[0]) return { duplicate: mapMessage(duplicate.rows[0]), sessionId: String(duplicate.rows[0].session_id), config };
    const recent = await client.query<{ count: number }>(`SELECT count(*)::int count FROM zhiban.course_tutor_messages
      WHERE student_id=$1 AND role='user' AND created_at>now()-interval '5 minutes'`, [principal.id]);
    if (Number(recent.rows[0]?.count ?? 0) >= 10) throw new Error('请求过于频繁，请稍后再试');
    let sessionId = input.sessionId;
    if (sessionId) {
      const owned = await client.query(`SELECT 1 FROM zhiban.course_tutor_sessions WHERE id=$1 AND student_id=$2 AND course_id=$3`, [sessionId, principal.id, courseId]);
      if (!owned.rows[0]) throw new Error('Tutor session not found');
    } else {
      sessionId = randomUUID();
      await client.query(`INSERT INTO zhiban.course_tutor_sessions(id,tenant_id,course_id,student_id,title) VALUES($1,$2,$3,$4,$5)`, [sessionId, principal.tenantId, courseId, principal.id, input.message.slice(0, 80)]);
    }
    await client.query(`INSERT INTO zhiban.course_tutor_messages(id,tenant_id,course_id,session_id,student_id,role,content,request_id) VALUES($1,$2,$3,$4,$5,'user',$6,$7)`, [randomUUID(), principal.tenantId, courseId, sessionId, principal.id, input.message, input.requestId]);
    const safety = assessTutorMessage(input.message);
    const [history, chunksResult, template, course, activity] = await Promise.all([
      client.query<Row>(`SELECT role,content FROM zhiban.course_tutor_messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT $2`, [sessionId, config.maxHistoryMessages]),
      client.query<Row>(`SELECT c.id,c.content,d.id document_id,d.title,d.source_type,d.source_id,d.metadata FROM zhiban.course_tutor_chunks c JOIN zhiban.course_tutor_documents d ON d.id=c.document_id WHERE c.course_id=$1 AND d.status='active' LIMIT 1000`, [courseId]),
      client.query<Row>(`SELECT persona,version FROM zhiban.agent_role_templates WHERE course_id=$1 AND role_type='tutor' AND status='active' ORDER BY updated_at DESC LIMIT 1`, [courseId]),
      client.query<Row>(`SELECT name,description FROM zhiban.courses WHERE id=$1`, [courseId]),
      client.query<Row>(`SELECT a.id,a.title,a.activity_type,a.description,a.reference_id,a.completion_rule,c.title chapter_title,
        ARRAY(SELECT ca.id::text FROM zhiban.course_activities ca WHERE ca.chapter_id=a.chapter_id) chapter_activity_ids,
        p.status progress_status,p.progress_percent FROM zhiban.course_activities a JOIN zhiban.course_chapters c ON c.id=a.chapter_id
        LEFT JOIN zhiban.student_activity_progress p ON p.activity_id=a.id AND p.student_id=$2
        WHERE a.course_id=$3 AND (($1::uuid IS NOT NULL AND a.id=$1::uuid) OR ($1::uuid IS NULL AND p.status IN('in_progress','completed')))
        ORDER BY CASE WHEN a.id=$1::uuid THEN 0 ELSE 1 END,p.updated_at DESC NULLS LAST LIMIT 1`, [input.activityId ?? null, principal.id, courseId]),
    ]);
    const aiSettings = ((activity.rows[0]?.completion_rule as Row | undefined)?.aiSupport as Row | undefined) ?? {};
    const queryTerms = terms(input.message);
    const sourceMode = String(aiSettings.sourceMode ?? 'current_chapter');
    const sourceBindings = Array.isArray(aiSettings.sourceBindings) ? aiSettings.sourceBindings.map(String) : [];
    const sourceKey = (row: Row) => `${row.source_type === 'activity_content' ? 'content' : row.source_type === 'course_resource' ? 'resource' : row.source_type}:${row.source_id}`;
    const sourcePriority = new Map(sourceBindings.map((key, index) => [key, sourceBindings.length - index]));
    const chapterActivityIds = new Set(Array.isArray(activity.rows[0]?.chapter_activity_ids) ? activity.rows[0].chapter_activity_ids.map(String) : []);
    const chapterBonus = (row: Row) => chapterActivityIds.has(String((row.metadata as Row | undefined)?.activityId ?? '')) ? 250 : 0;
    const candidates = sourceMode === 'selected' ? chunksResult.rows.filter((row) => sourcePriority.has(sourceKey(row))) : chunksResult.rows;
    const ranked = candidates.map((row) => ({ row, score: queryTerms.reduce((score, term) => score + (String(row.content).toLowerCase().includes(term) ? Math.max(1, term.length) : 0), 0)
      + ((sourceMode === 'selected' || sourceMode === 'selected_first') ? (sourcePriority.get(sourceKey(row)) ?? 0) * 1000 : 0)
      + ((sourceMode === 'current_chapter' || sourceMode === 'selected_first') ? chapterBonus(row) : 0) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, config.retrievalTopK);
    const citations: CourseTutorCitation[] = ranked.map(({ row }) => ({ documentId: String(row.document_id), title: String(row.title), sourceType: String(row.source_type), sourceId: String(row.source_id), excerpt: String(row.content).slice(0, 240) }));
    const persona = String(template.rows[0]?.persona ?? COURSE_TUTOR_PERSONA), promptVersion = String(template.rows[0]?.version ?? `course-tutor-v${config.version}`);
    const context = ranked.map(({ row }, index) => `[资料${index + 1}] ${row.title}\n${row.content}`).join('\n\n');
    const activityContext = activity.rows[0] ? `当前学习活动：${activity.rows[0].chapter_title} / ${activity.rows[0].title}（${activity.rows[0].activity_type}）\n活动说明：${activity.rows[0].description ?? ''}\n辅导目标：${aiSettings.learningObjective ?? ''}\n开场引导：${aiSettings.openingPrompt ?? ''}\n核心知识点：${Array.isArray(aiSettings.keyPoints) ? aiSettings.keyPoints.join('、') : ''}\n引导方式：${aiSettings.guidanceMode ?? 'socratic'}\n活动回答边界：${aiSettings.answerBoundary ?? ''}\n轮次要求：至少 ${aiSettings.minimumTurns ?? 1} 轮，最多 ${aiSettings.maximumTurns ?? 8} 轮；${aiSettings.requireReflection ? '结束前要求学生反思；' : ''}${aiSettings.generateSummary ? '结束时生成学习小结。' : ''}\n关联课堂/PBL/作业标识：${activity.rows[0].reference_id ?? '无'}\n学习进度：${activity.rows[0].progress_status ?? '未开始'} ${activity.rows[0].progress_percent ?? 0}%` : '当前未指定具体学习活动。';
    const system = `${persona}\n课程：${course.rows[0]?.name ?? ''}\n课程说明：${course.rows[0]?.description ?? ''}\n${activityContext}\n${config.systemPrompt}\n
回答规则：1. 优先根据课程资料回答并提供分步知识支架；2. 不代写作业，不虚构资料；3. ${config.answerScope === 'course_only' ? '资料不足时明确说明“当前课程资料中没有足够依据”，并向学生提出澄清问题。' : '资料不足时明确区分课程资料与通用知识。'} 4. ${config.citationRequired ? '使用资料时在句末标注[资料序号]。' : ''}\n\n课程资料：\n${context || '本次未检索到相关课程资料。'}`;
    return { sessionId, config, system, promptVersion, citations, safety, requestId: input.requestId, activityContext,
      history: history.rows.reverse().map((row) => ({ role: row.role, content: row.content })) };
  });
}

export async function saveTutorAnswer(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, courseId: string, input: { sessionId: string; content: string; citations: CourseTutorCitation[]; promptVersion: string; modelId?: string; latencyMs: number; status?: 'completed' | 'blocked' | 'failed'; requestId: string; safetyCategory?: string | null; context?: Row }) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const owned = await client.query(`SELECT 1 FROM zhiban.course_tutor_sessions WHERE id=$1 AND student_id=$2 AND course_id=$3`, [input.sessionId, principal.id, courseId]);
    if (!owned.rows[0]) throw new Error('Tutor session not found');
    const id = randomUUID();
    const inserted = await client.query<{ id: string }>(`INSERT INTO zhiban.course_tutor_messages(id,tenant_id,course_id,session_id,student_id,role,content,citations,prompt_version,model_id,latency_ms,status,request_id,safety_category,context)
      VALUES($1,$2,$3,$4,$5,'assistant',$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14::jsonb)
      ON CONFLICT(tenant_id,student_id,request_id) WHERE request_id IS NOT NULL AND role='assistant' DO UPDATE SET content=excluded.content RETURNING id`, [id, principal.tenantId, courseId, input.sessionId, principal.id, input.content, JSON.stringify(input.citations), input.promptVersion, input.modelId ?? null, input.latencyMs, input.status ?? 'completed', input.requestId, input.safetyCategory ?? null, JSON.stringify(input.context ?? {})]);
    await client.query(`UPDATE zhiban.course_tutor_sessions SET last_message_at=now(),updated_at=now() WHERE id=$1`, [input.sessionId]);
    await client.query(`INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,payload,occurred_at)
      VALUES($1,$2,$3,$4,'system',$5,$6,$7::jsonb,now()) ON CONFLICT DO NOTHING`, [randomUUID(), principal.tenantId, principal.id, courseId, id,
      input.safetyCategory ? 'course_tutor_safety_escalated' : 'course_tutor_answered', JSON.stringify({ sessionId: input.sessionId, citations: input.citations.length, latencyMs: input.latencyMs, safetyCategory: input.safetyCategory ?? null })]);
    return { id: inserted.rows[0]?.id ?? id };
  });
}

export async function rateTutorAnswer(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal, courseId: string, input: { messageId: string; rating: -1 | 1; comment: string }) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const message = await client.query(`SELECT 1 FROM zhiban.course_tutor_messages WHERE id=$1 AND student_id=$2 AND course_id=$3 AND role='assistant'`, [input.messageId, principal.id, courseId]);
    if (!message.rows[0]) throw new Error('Tutor message not found');
    await client.query(`INSERT INTO zhiban.course_tutor_feedback(id,tenant_id,course_id,message_id,student_id,rating,comment)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,message_id,student_id) DO UPDATE SET rating=$6,comment=$7`, [randomUUID(), principal.tenantId, courseId, input.messageId, principal.id, input.rating, input.comment]);
    return { messageId: input.messageId, rating: input.rating };
  });
}
