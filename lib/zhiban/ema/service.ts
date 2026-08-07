import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

export const DEFAULT_EMA_QUESTIONS = [
  { id: 'confidence', type: 'scale', label: '我有信心完成当前学习任务', min: 1, max: 5 },
  { id: 'difficulty', type: 'scale', label: '当前学习任务对我来说很困难', min: 1, max: 5 },
  { id: 'emotion', type: 'scale', label: '此刻我的学习情绪是积极的', min: 1, max: 5 },
  { id: 'note', type: 'text', label: '还有什么想告诉老师或学习伙伴？', optional: true },
] as const;

export function validateEmaAnswers(questions: unknown, answers: Record<string, unknown>) {
  if (!Array.isArray(questions)) throw new Error('EMA template questions are invalid');
  for (const raw of questions) {
    const question = raw as Record<string, unknown>;
    const id = String(question.id ?? '');
    const answer = answers[id];
    if (question.optional !== true && (answer === undefined || answer === ''))
      throw new Error(`EMA answer is required: ${id}`);
    if (answer === undefined || answer === '') continue;
    if (question.type === 'scale') {
      const value = Number(answer);
      if (
        !Number.isFinite(value) ||
        value < Number(question.min ?? 1) ||
        value > Number(question.max ?? 5)
      )
        throw new Error(`EMA scale answer is out of range: ${id}`);
    } else if (String(answer).length > 2000) throw new Error(`EMA text answer is too long: ${id}`);
  }
}

async function ensureDefaultTemplate(
  client: ZhibanDatabaseClient,
  tenantId: string,
  courseId: string,
) {
  const existing = await client.query<{
    id: string;
    questions: unknown;
    rules: Record<string, number>;
  }>(
    `SELECT id,questions,rules FROM zhiban.ema_templates WHERE course_id=$1 AND code='learning-pulse' AND status='active' ORDER BY version DESC LIMIT 1`,
    [courseId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const id = randomUUID();
  const rules = { eventInterval: 20, cooldownHours: 24, expiryHours: 48 };
  await client.query(
    `INSERT INTO zhiban.ema_templates(id,tenant_id,course_id,code,title,description,questions,rules,status) VALUES($1,$2,$3,'learning-pulse','学习状态小问卷','用于及时提供学习支持，可跳过且跳过不会增加风险。',$4::jsonb,$5::jsonb,'active')`,
    [id, tenantId, courseId, JSON.stringify(DEFAULT_EMA_QUESTIONS), JSON.stringify(rules)],
  );
  return { id, questions: DEFAULT_EMA_QUESTIONS, rules };
}

export async function evaluateEmaTrigger(
  pool: ZhibanDatabasePool,
  tenantId: string,
  input: { learnerId: string; courseId: string; eventId: string },
) {
  return withZhibanTenant(pool, tenantId, async (client) => {
    const template = await ensureDefaultTemplate(client, tenantId, input.courseId);
    const count = await client.query<{ count: number }>(
      `SELECT count(*)::int count FROM zhiban.learning_events e WHERE e.learner_id=$1 AND e.course_id=$2 AND e.occurred_at>COALESCE((SELECT max(i.triggered_at) FROM zhiban.ema_instances i WHERE i.template_id=$3 AND i.learner_id=$1),'-infinity'::timestamptz)`,
      [input.learnerId, input.courseId, template.id],
    );
    const interval = Math.max(1, Number(template.rules.eventInterval ?? 20));
    if (Number(count.rows[0]?.count ?? 0) < interval) return { triggered: false };
    const cooldownHours = Math.max(1, Number(template.rules.cooldownHours ?? 24));
    const recent = await client.query(
      `SELECT 1 FROM zhiban.ema_instances WHERE template_id=$1 AND learner_id=$2 AND triggered_at>now()-($3||' hours')::interval LIMIT 1`,
      [template.id, input.learnerId, cooldownHours],
    );
    if (recent.rows[0]) return { triggered: false };
    const id = randomUUID();
    const expiryHours = Math.max(1, Number(template.rules.expiryHours ?? 48));
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO zhiban.ema_instances(id,tenant_id,template_id,learner_id,course_id,trigger_event_id,trigger_reason,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,'学习事件达到阶段性采样节点',now()+($7||' hours')::interval)
       ON CONFLICT(tenant_id,template_id,learner_id,trigger_event_id)DO NOTHING RETURNING id`,
      [id, tenantId, template.id, input.learnerId, input.courseId, input.eventId, expiryHours],
    );
    return { triggered: Boolean(inserted.rows[0]), instanceId: inserted.rows[0]?.id };
  });
}

export async function listOwnPendingEma(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await client.query(
      `UPDATE zhiban.ema_instances SET status='expired' WHERE learner_id=$1 AND status='pending' AND expires_at<=now()`,
      [principal.id],
    );
    return (
      await client.query<Record<string, unknown>>(
        `SELECT i.id,i.course_id,c.name course_name,i.trigger_reason,i.triggered_at,i.expires_at,t.title,t.description,t.questions,t.version FROM zhiban.ema_instances i JOIN zhiban.ema_templates t ON t.id=i.template_id JOIN zhiban.courses c ON c.id=i.course_id WHERE i.learner_id=$1 AND i.status='pending' ORDER BY i.triggered_at LIMIT 5`,
        [principal.id],
      )
    ).rows;
  });
}

export async function submitOwnEma(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  instanceId: string,
  input: { answers: Record<string, unknown>; skipped: boolean; skipReason?: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const instance = await client.query<{ id: string; course_id: string; questions: unknown }>(
      `SELECT i.id,i.course_id,t.questions FROM zhiban.ema_instances i JOIN zhiban.ema_templates t ON t.id=i.template_id WHERE i.id=$1 AND i.learner_id=$2 AND i.status='pending' AND i.expires_at>now() FOR UPDATE OF i`,
      [instanceId, principal.id],
    );
    if (!instance.rows[0]) throw new Error('EMA questionnaire is unavailable or already completed');
    if (!input.skipped) validateEmaAnswers(instance.rows[0].questions, input.answers);
    await client.query(
      `INSERT INTO zhiban.ema_responses(id,tenant_id,instance_id,learner_id,answers,skipped,skip_reason) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        randomUUID(),
        principal.tenantId,
        instanceId,
        principal.id,
        JSON.stringify(input.skipped ? {} : input.answers),
        input.skipped,
        input.skipReason ?? null,
      ],
    );
    await client.query(`UPDATE zhiban.ema_instances SET status=$2,completed_at=now() WHERE id=$1`, [
      instanceId,
      input.skipped ? 'skipped' : 'answered',
    ]);
    await client.query(
      `INSERT INTO zhiban.audit_log(tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,'account',$2,$3,'ema_instance',$4,$5::jsonb)`,
      [
        principal.tenantId,
        principal.id,
        input.skipped ? 'ema.skipped' : 'ema.answered',
        instanceId,
        JSON.stringify({ courseId: instance.rows[0].course_id }),
      ],
    );
    return { id: instanceId, status: input.skipped ? 'skipped' : 'answered' };
  });
}

export async function listManagedCourseEma(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  const allowed = principal.grants.some(
    (grant) =>
      grant.permission === 'course:manage' &&
      ((grant.scopeType === 'course' && grant.scopeId === courseId) ||
        grant.scopeType === 'tenant' ||
        grant.scopeType === 'system'),
  );
  if (!allowed) throw new Error('Permission denied');
  return withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query<Record<string, unknown>>(
          `SELECT i.id,i.learner_id,a.display_name,a.login_name,i.trigger_reason,i.status,i.triggered_at,i.completed_at,r.answers,r.skipped,r.skip_reason,r.submitted_at,t.title,t.version
       FROM zhiban.ema_instances i JOIN zhiban.ema_templates t ON t.id=i.template_id JOIN zhiban.accounts a ON a.id=i.learner_id LEFT JOIN zhiban.ema_responses r ON r.instance_id=i.id
       WHERE i.course_id=$1 ORDER BY i.triggered_at DESC LIMIT 500`,
          [courseId],
        )
      ).rows,
  );
}
