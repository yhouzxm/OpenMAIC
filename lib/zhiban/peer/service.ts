import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { CoursePeerConfig, CoursePeerMessage, PeerEmotion } from './types';

type Row = Record<string, unknown>;
const DEFAULT_CONFIG: CoursePeerConfig = {
  enabled: false,
  displayName: '智伴 Peer',
  welcomeMessage: '最近学习感觉怎么样？如果遇到困难，可以和我聊聊。',
  systemPrompt: '',
  proactiveEnabled: true,
  emotionCheckEnabled: true,
  cooldownMinutes: 120,
  maxTurns: 8,
  status: 'draft',
  version: 1,
};
export const PEER_BASE_PROMPT = `你是面向开放教育成人学习者的“智伴 Peer”。你是平等、尊重、非评判的学习同伴，不是教师、心理医生或评分者。先用一句话复述感受，再肯定已经付出的努力，最后只给一个很小、可立即执行的下一步并用问题结束。避免说教、虚假保证、心理诊断、代写答案或成绩判断。若上下文出现危机风险，不继续自由生成。`;

function canManage(p: AuthorizedPrincipal, courseId: string) {
  return p.grants.some(
    (g) =>
      g.permission === 'course:manage' &&
      (g.scopeType === 'system' ||
        g.scopeType === 'tenant' ||
        (g.scopeType === 'course' && g.scopeId === courseId)),
  );
}
async function requireEnrollment(
  client: { query: ZhibanDatabasePool['query'] },
  p: AuthorizedPrincipal,
  courseId: string,
) {
  const found = await client.query(
    `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE e.student_id=$1 AND o.course_id=$2 AND e.status='enrolled' LIMIT 1`,
    [p.id, courseId],
  );
  if (!found.rows[0]) throw new Error('Course is unavailable');
}
function mapConfig(row?: Row): CoursePeerConfig {
  if (!row) return DEFAULT_CONFIG;
  return {
    enabled: Boolean(row.enabled),
    displayName: String(row.display_name),
    welcomeMessage: String(row.welcome_message),
    systemPrompt: String(row.system_prompt),
    proactiveEnabled: Boolean(row.proactive_enabled),
    emotionCheckEnabled: Boolean(row.emotion_check_enabled),
    cooldownMinutes: Number(row.cooldown_minutes),
    maxTurns: Number(row.max_turns),
    status: row.status as CoursePeerConfig['status'],
    version: Number(row.version),
  };
}
function mapMessage(row: Row): CoursePeerMessage {
  return {
    id: String(row.id),
    role: row.role as CoursePeerMessage['role'],
    content: String(row.content),
    emotion: row.emotion_label as PeerEmotion,
    riskLevel: row.risk_level as CoursePeerMessage['riskLevel'],
    status: row.status as CoursePeerMessage['status'],
    safetyCategory: row.safety_category ? String(row.safety_category) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
export function assessPeerEmotion(message: string): {
  emotion: PeerEmotion;
  riskLevel: 'none' | 'low' | 'high';
  blocked: boolean;
  response?: string;
} {
  const text = message.toLowerCase();
  if (/(自杀|自残|不想活|结束生命|活不下去|suicide|self[- ]harm)/i.test(text))
    return {
      emotion: 'crisis',
      riskLevel: 'high',
      blocked: true,
      response:
        '谢谢你愿意说出来。你的安全比课程更重要，我不能独自处理这种紧急情况。请现在联系你信任的家人、班主任或当地紧急援助；如果你正处于危险中，请立即拨打当地急救或报警电话。我也会把“需要人工关注”通知给教师，但不会向同学公开你的内容。',
    };
  if (/(孤独|没人理解|一个人|没人陪|lonely|alone)/i.test(text))
    return { emotion: 'lonely', riskLevel: 'low', blocked: false };
  if (/(难过|低落|沮丧|想放弃|没信心|焦虑|害怕|撑不住|sad|depressed|anxious)/i.test(text))
    return { emotion: 'low_mood', riskLevel: 'low', blocked: false };
  if (/(不会|太难|看不懂|做不出来|不知道怎么|卡住|困难|hard|stuck)/i.test(text))
    return { emotion: 'difficulty', riskLevel: 'low', blocked: false };
  return { emotion: 'neutral', riskLevel: 'none', blocked: false };
}

export function reviewPeerOutput(content: string): {
  safe: boolean;
  content: string;
  category: string | null;
} {
  if (
    /(你患有|你得了|诊断为|抑郁症|焦虑症|停止服药|调整药物|保证.{0,6}(及格|通过)|最终成绩)/i.test(
      content,
    )
  ) {
    return {
      safe: false,
      category: 'role_boundary',
      content:
        '我不适合做心理诊断、医疗建议或成绩判断。我们可以只聊此刻的学习感受，并一起找一个很小的下一步；如果你需要专业或课程方面的判断，请联系教师或专业人员。',
    };
  }
  return { safe: true, category: null, content };
}

export async function getTeacherPeerDashboard(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
) {
  if (!canManage(p, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    const config = mapConfig(
      (
        await client.query<Row>(`SELECT * FROM zhiban.course_peer_configs WHERE course_id=$1`, [
          courseId,
        ])
      ).rows[0],
    );
    const usage =
      (
        await client.query<Row>(
          `SELECT count(DISTINCT session_id)::int session_count,count(*) FILTER(WHERE role='assistant')::int reply_count,count(*) FILTER(WHERE risk_level='high')::int escalated_count,count(*) FILTER(WHERE status='failed')::int failure_count FROM zhiban.course_peer_messages WHERE course_id=$1`,
          [courseId],
        )
      ).rows[0] ?? {};
    const issues = (
      await client.query<Row>(
        `SELECT m.id,m.content,m.emotion_label,m.risk_level,m.safety_category,m.status,m.created_at,a.display_name student_name,f.rating,f.comment FROM zhiban.course_peer_messages m JOIN zhiban.accounts a ON a.id=m.student_id LEFT JOIN zhiban.course_peer_feedback f ON f.message_id=m.id WHERE m.course_id=$1 AND (m.risk_level='high' OR m.status IN('blocked','failed') OR f.rating=-1) ORDER BY m.created_at DESC LIMIT 100`,
        [courseId],
      )
    ).rows;
    return { config, usage, issues };
  });
}
export async function savePeerConfig(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
  input: Omit<CoursePeerConfig, 'version'>,
) {
  if (!canManage(p, courseId)) throw new Error('Permission denied');
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    await client.query(
      `INSERT INTO zhiban.course_peer_configs(id,tenant_id,course_id,enabled,display_name,welcome_message,system_prompt,proactive_enabled,emotion_check_enabled,cooldown_minutes,max_turns,status,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(tenant_id,course_id) DO UPDATE SET enabled=excluded.enabled,display_name=excluded.display_name,welcome_message=excluded.welcome_message,system_prompt=excluded.system_prompt,proactive_enabled=excluded.proactive_enabled,emotion_check_enabled=excluded.emotion_check_enabled,cooldown_minutes=excluded.cooldown_minutes,max_turns=excluded.max_turns,status=excluded.status,version=course_peer_configs.version+1,updated_by=excluded.updated_by,updated_at=now()`,
      [
        randomUUID(),
        p.tenantId,
        courseId,
        input.enabled,
        input.displayName,
        input.welcomeMessage,
        input.systemPrompt,
        input.proactiveEnabled,
        input.emotionCheckEnabled,
        input.cooldownMinutes,
        input.maxTurns,
        input.status,
        p.id,
      ],
    );
    await client.query(
      `UPDATE zhiban.course_settings SET agent_settings=jsonb_set(COALESCE(agent_settings,'{}'::jsonb),'{peerEnabled}',to_jsonb($2::boolean),true),updated_by=$3,updated_at=now() WHERE course_id=$1`,
      [courseId, input.enabled && input.status === 'published', p.id],
    );
    return { saved: true };
  });
}

export async function archivePeerSession(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
  sessionId: string,
) {
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE zhiban.course_peer_sessions SET status='archived',updated_at=now() WHERE id=$1 AND course_id=$2 AND student_id=$3 AND status='active' RETURNING id`,
      [sessionId, courseId, p.id],
    );
    if (!result.rows[0]) throw new Error('Peer session not found');
    return { archived: true };
  });
}
export async function getStudentPeerState(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
) {
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    await requireEnrollment(client, p, courseId);
    const config = mapConfig(
      (
        await client.query<Row>(`SELECT * FROM zhiban.course_peer_configs WHERE course_id=$1`, [
          courseId,
        ])
      ).rows[0],
    );
    const session = (
      await client.query<Row>(
        `SELECT * FROM zhiban.course_peer_sessions WHERE course_id=$1 AND student_id=$2 AND status='active' ORDER BY last_message_at DESC LIMIT 1`,
        [courseId, p.id],
      )
    ).rows[0];
    const messages = session
      ? (
          await client.query<Row>(
            `SELECT * FROM zhiban.course_peer_messages WHERE session_id=$1 ORDER BY created_at`,
            [session.id],
          )
        ).rows.map(mapMessage)
      : [];
    const proactiveBrief =
      config.enabled && config.status === 'published' && config.proactiveEnabled
        ? (
            await client.query<Row>(
              `SELECT id,objective,tone,created_at FROM zhiban.intervention_briefs WHERE learner_id=$1 AND course_id=$2 AND target_role='peer' AND status='pending' AND expires_at>now() ORDER BY created_at DESC LIMIT 1`,
              [p.id, courseId],
            )
          ).rows[0]
        : undefined;
    return {
      config,
      sessionId: session ? String(session.id) : null,
      messages,
      proactiveBrief: proactiveBrief
        ? {
            id: String(proactiveBrief.id),
            objective: String(proactiveBrief.objective),
            tone: String(proactiveBrief.tone),
            createdAt: new Date(String(proactiveBrief.created_at)).toISOString(),
          }
        : null,
    };
  });
}
export async function preparePeerTurn(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
  input: { sessionId: string | null; message: string; requestId: string },
) {
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    await requireEnrollment(client, p, courseId);
    const config = mapConfig(
      (
        await client.query<Row>(
          `SELECT * FROM zhiban.course_peer_configs WHERE course_id=$1 AND enabled AND status='published'`,
          [courseId],
        )
      ).rows[0],
    );
    if (!config.enabled || config.status !== 'published') throw new Error('Peer 陪伴尚未开放');
    let sessionId = input.sessionId;
    if (
      sessionId &&
      !(
        await client.query(
          `SELECT 1 FROM zhiban.course_peer_sessions WHERE id=$1 AND student_id=$2 AND course_id=$3 AND status='active'`,
          [sessionId, p.id],
        )
      ).rows[0]
    )
      throw new Error('Peer session not found');
    if (!sessionId) {
      sessionId = randomUUID();
      await client.query(
        `INSERT INTO zhiban.course_peer_sessions(id,tenant_id,course_id,student_id) VALUES($1,$2,$3,$4)`,
        [sessionId, p.tenantId, courseId, p.id],
      );
    }
    const duplicate = (
      await client.query<Row>(
        `SELECT * FROM zhiban.course_peer_messages WHERE student_id=$1 AND request_id=$2 AND role='assistant'`,
        [p.id, input.requestId],
      )
    ).rows[0];
    if (duplicate) return { duplicate: mapMessage(duplicate), sessionId, config };
    const turnCount = Number(
      (
        await client.query<Row>(`SELECT turn_count FROM zhiban.course_peer_sessions WHERE id=$1`, [
          sessionId,
        ])
      ).rows[0]?.turn_count ?? 0,
    );
    if (turnCount >= config.maxTurns)
      throw new Error(`本次陪伴交流已达到 ${config.maxTurns} 轮，可以稍作休息后再继续`);
    const assessment = config.emotionCheckEnabled
      ? assessPeerEmotion(input.message)
      : { emotion: 'neutral' as PeerEmotion, riskLevel: 'none' as const, blocked: false };
    await client.query(
      `INSERT INTO zhiban.course_peer_messages(id,tenant_id,course_id,session_id,student_id,role,content,emotion_label,risk_level,request_id) VALUES($1,$2,$3,$4,$5,'user',$6,$7,$8,$9)`,
      [
        randomUUID(),
        p.tenantId,
        courseId,
        sessionId,
        p.id,
        input.message,
        assessment.emotion,
        assessment.riskLevel,
        input.requestId,
      ],
    );
    await client.query(
      `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,payload,occurred_at) VALUES($1,$2,$3,$4,'system',$5,'peer_message_sent',$6::jsonb,now()) ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        p.tenantId,
        p.id,
        courseId,
        `peer-user:${input.requestId}`,
        JSON.stringify({ sessionId, emotion: assessment.emotion, riskLevel: assessment.riskLevel }),
      ],
    );
    await client.query(
      `UPDATE zhiban.course_peer_sessions SET turn_count=turn_count+1,last_emotion=$2,last_message_at=now(),updated_at=now() WHERE id=$1`,
      [sessionId, assessment.emotion],
    );
    if (assessment.blocked) {
      const id = randomUUID(),
        response = assessment.response ?? '请立即联系教师或当地紧急援助。';
      await client.query(
        `INSERT INTO zhiban.course_peer_messages(id,tenant_id,course_id,session_id,student_id,role,content,emotion_label,risk_level,safety_category,status,request_id) VALUES($1,$2,$3,$4,$5,'assistant',$6,'crisis','high','crisis','blocked',$7)`,
        [id, p.tenantId, courseId, sessionId, p.id, response, input.requestId],
      );
      await client.query(
        `UPDATE zhiban.course_peer_sessions SET status='escalated',last_message_at=now() WHERE id=$1`,
        [sessionId],
      );
      const briefId = randomUUID(),
        commandId = `peer-crisis:${sessionId}:${input.requestId}`;
      await client.query(
        `INSERT INTO zhiban.intervention_briefs(id,tenant_id,learner_id,course_id,source_event_id,target_role,level,objective,tone,evidence_summary,prohibited_content,max_turns,policy_version,prompt_version,status,command_id) VALUES($1,$2,$3,$4,$5,'teacher','teacher','请人工确认学习者安全并提供支持','审慎、私密',$6::jsonb,'["自动心理诊断","向同学披露"]'::jsonb,1,'peer-safety-v1','peer-v1','pending',$7) ON CONFLICT(tenant_id,command_id) DO NOTHING`,
        [
          briefId,
          p.tenantId,
          p.id,
          courseId,
          String(input.requestId),
          JSON.stringify({ category: 'crisis', messageId: id }),
          commandId,
        ],
      );
      return {
        sessionId,
        immediate: mapMessage({
          id,
          role: 'assistant',
          content: response,
          emotion_label: 'crisis',
          risk_level: 'high',
          safety_category: 'crisis',
          status: 'blocked',
          created_at: new Date(),
        }),
        config,
      };
    }
    const history = (
      await client.query<Row>(
        `SELECT role,content FROM zhiban.course_peer_messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 12`,
        [sessionId],
      )
    ).rows.reverse();
    return {
      sessionId,
      config,
      assessment,
      history,
      system: `${PEER_BASE_PROMPT}\n课程补充要求：${config.systemPrompt || '无'}\n当前信号：${assessment.emotion}。不要提及风险分数或监测算法。`,
    };
  });
}
export async function savePeerAnswer(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
  input: {
    sessionId: string;
    requestId: string;
    content: string;
    emotion: PeerEmotion;
    status?: 'completed' | 'blocked' | 'failed';
    safetyCategory?: string | null;
    modelId?: string;
    latencyMs?: number;
  },
) {
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    const owned = await client.query(
      `SELECT 1 FROM zhiban.course_peer_sessions WHERE id=$1 AND student_id=$2 AND course_id=$3`,
      [input.sessionId, p.id],
    );
    if (!owned.rows[0]) throw new Error('Peer session not found');
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_peer_messages(id,tenant_id,course_id,session_id,student_id,role,content,emotion_label,risk_level,safety_category,status,request_id,model_id,latency_ms) VALUES($1,$2,$3,$4,$5,'assistant',$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(tenant_id,student_id,request_id,role) DO NOTHING`,
      [
        id,
        p.tenantId,
        courseId,
        input.sessionId,
        p.id,
        input.content,
        input.emotion,
        input.emotion === 'neutral' ? 'none' : 'low',
        input.safetyCategory ?? null,
        input.status ?? 'completed',
        input.requestId,
        input.modelId ?? null,
        input.latencyMs ?? null,
      ],
    );
    await client.query(
      `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,payload,occurred_at) VALUES($1,$2,$3,$4,'system',$5,'peer_response_delivered',$6::jsonb,now()) ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        p.tenantId,
        p.id,
        courseId,
        `peer-assistant:${input.requestId}`,
        JSON.stringify({
          sessionId: input.sessionId,
          emotion: input.emotion,
          status: input.status ?? 'completed',
          safetyCategory: input.safetyCategory ?? null,
        }),
      ],
    );
    return { id };
  });
}
export async function ratePeerAnswer(
  pool: ZhibanDatabasePool,
  p: AuthorizedPrincipal,
  courseId: string,
  input: { messageId: string; rating: -1 | 1; comment: string },
) {
  return withZhibanTenant(pool, p.tenantId, async (client) => {
    const found = await client.query(
      `SELECT 1 FROM zhiban.course_peer_messages WHERE id=$1 AND course_id=$2 AND student_id=$3 AND role='assistant'`,
      [input.messageId, courseId, p.id],
    );
    if (!found.rows[0]) throw new Error('Peer message not found');
    await client.query(
      `INSERT INTO zhiban.course_peer_feedback(id,tenant_id,course_id,message_id,student_id,rating,comment) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,message_id,student_id) DO UPDATE SET rating=excluded.rating,comment=excluded.comment`,
      [randomUUID(), p.tenantId, courseId, input.messageId, p.id, input.rating, input.comment],
    );
    return { saved: true };
  });
}
