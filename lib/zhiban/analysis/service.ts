import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { rebuildLearnerProfile } from '@/lib/zhiban/profile';
import { evaluateEmaTrigger } from '@/lib/zhiban/ema';
import { evaluateMonitorIntervention } from '@/lib/zhiban/agents/service';
import { evaluateLearnerRisk, sweepRiskSla } from '@/lib/zhiban/risk';
import { createAnalysisSnapshot } from '@/lib/zhiban/teaching-analytics';

export type AnalysisJobType =
  | 'profile_rebuild'
  | 'ema_evaluate'
  | 'monitor_evaluate'
  | 'risk_evaluate'
  | 'teaching_snapshot';

async function insertJob(
  client: { query: ZhibanDatabasePool['query'] },
  tenantId: string,
  jobType: AnalysisJobType,
  input: { learnerId: string; courseId: string; sourceEventId: string },
) {
  const id = randomUUID();
  const key = `${jobType}:${input.learnerId}:${input.courseId}:${input.sourceEventId}`;
  const result = await client.query<{ id: string }>(
    `INSERT INTO zhiban.analysis_jobs(id,tenant_id,job_type,idempotency_key,payload,run_after) VALUES($1,$2,$3::varchar,$4,$5::jsonb,CASE WHEN $3::varchar='risk_evaluate'::varchar THEN now()+interval '4 seconds' WHEN $3::varchar='monitor_evaluate'::varchar THEN now()+interval '2 seconds' ELSE now() END)
     ON CONFLICT(tenant_id,idempotency_key)DO UPDATE SET updated_at=now() RETURNING id`,
    [id, tenantId, jobType, key, JSON.stringify({ ...input, eventId: input.sourceEventId })],
  );
  return result.rows[0].id;
}

export async function enqueueLearningAnalysis(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  input: { learnerId: string; courseId: string; sourceEventId: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const jobs: string[] = [];
    for (const jobType of [
      'profile_rebuild',
      'ema_evaluate',
      'monitor_evaluate',
      'risk_evaluate',
    ] as const) {
      jobs.push(await insertJob(client, principal.tenantId, jobType, input));
    }
    return { jobs };
  });
}

export async function enqueueProfileRebuild(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  learnerId: string,
  courseId: string,
  sourceEventId = `manual-${randomUUID()}`,
) {
  const allowed =
    principal.id === learnerId ||
    principal.grants.some(
      (grant) =>
        grant.permission === 'course:manage' &&
        ((grant.scopeType === 'course' && grant.scopeId === courseId) ||
          grant.scopeType === 'tenant' ||
          grant.scopeType === 'system'),
    );
  if (!allowed) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const enrollment = await client.query(
      `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE e.student_id=$1 AND o.course_id=$2 AND e.status='enrolled' LIMIT 1`,
      [learnerId, courseId],
    );
    if (!enrollment.rows[0]) throw new Error('Learner is not enrolled in this course');
    return {
      jobId: await insertJob(client, principal.tenantId, 'profile_rebuild', {
        learnerId,
        courseId,
        sourceEventId,
      }),
    };
  });
}

export async function enqueueCourseProfileRebuilds(
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
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const learners = await client.query<{ learner_id: string }>(
      `SELECT DISTINCT e.student_id learner_id FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE o.course_id=$1 AND e.status='enrolled'`,
      [courseId],
    );
    const batchId = randomUUID();
    const jobs: string[] = [];
    for (const learner of learners.rows)
      jobs.push(
        await insertJob(client, principal.tenantId, 'profile_rebuild', {
          learnerId: learner.learner_id,
          courseId,
          sourceEventId: `batch-${batchId}`,
        }),
      );
    return { queued: jobs.length, jobs };
  });
}

export async function enqueueTeachingSnapshot(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  runAfter = new Date(),
) {
  if (!principal.permissions.includes('course:manage')) throw new Error('Permission denied');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const id = randomUUID(),
      period = runAfter.toISOString().slice(0, 10),
      key = `teaching_snapshot:${courseId}:${period}`;
    const r = await client.query<{ id: string }>(
      `INSERT INTO zhiban.analysis_jobs(id,tenant_id,job_type,idempotency_key,payload,run_after) VALUES($1,$2,'teaching_snapshot',$3,$4::jsonb,$5) ON CONFLICT(tenant_id,idempotency_key) DO UPDATE SET run_after=LEAST(analysis_jobs.run_after,excluded.run_after),updated_at=now() RETURNING id`,
      [id, principal.tenantId, key, JSON.stringify({ courseId, actorId: principal.id }), runAfter],
    );
    return { jobId: r.rows[0].id, runAfter: runAfter.toISOString() };
  });
}

async function teachingActorPrincipal(
  pool: ZhibanDatabasePool,
  tenantId: string,
  actorId: string,
  courseId: string,
): Promise<AuthorizedPrincipal> {
  return withZhibanTenant(pool, tenantId, async (client) => {
    const r = await client.query<{
      login_name: string;
      display_name: string;
      account_type: 'student' | 'teacher' | 'admin';
    }>(`SELECT login_name,display_name,account_type FROM zhiban.accounts WHERE id=$1`, [actorId]);
    if (!r.rows[0]) throw new Error('Teaching analysis actor not found');
    return {
      id: actorId,
      tenantId,
      loginName: r.rows[0].login_name,
      displayName: r.rows[0].display_name,
      accountType: r.rows[0].account_type,
      mustChangePassword: false,
      roles: ['teacher'],
      permissions: ['course:manage'],
      grants: [
        {
          permission: 'course:manage',
          scopeType: 'course',
          scopeId: courseId,
          roleCode: 'teacher',
        },
      ],
    };
  });
}

async function learnerPrincipal(
  pool: ZhibanDatabasePool,
  tenantId: string,
  learnerId: string,
): Promise<AuthorizedPrincipal> {
  return withZhibanTenant(pool, tenantId, async (client) => {
    const account = await client.query<{
      login_name: string;
      display_name: string;
      account_type: 'student' | 'teacher' | 'admin';
    }>(`SELECT login_name,display_name,account_type FROM zhiban.accounts WHERE id=$1`, [learnerId]);
    if (!account.rows[0]) throw new Error('Analysis learner account not found');
    return {
      id: learnerId,
      tenantId,
      loginName: account.rows[0].login_name,
      displayName: account.rows[0].display_name,
      accountType: account.rows[0].account_type,
      mustChangePassword: false,
      roles: ['student'],
      permissions: ['course:read'],
      grants: [],
    };
  });
}

async function claimJob(pool: ZhibanDatabasePool, tenantId: string, workerId: string) {
  return withZhibanTenant(pool, tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `WITH candidate AS (
         SELECT jobs.id
         FROM zhiban.analysis_jobs jobs
         WHERE jobs.status IN ('queued', 'running')
           AND jobs.run_after <= now()
           AND (jobs.status = 'queued' OR jobs.locked_at < now() - interval '10 minutes')
         ORDER BY jobs.run_after, jobs.created_at
         LIMIT 1
       )
       UPDATE zhiban.analysis_jobs j
       SET status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = $1, updated_at = now()
       FROM candidate
       WHERE j.id = candidate.id
         AND j.status IN ('queued', 'running')
         AND (j.status = 'queued' OR j.locked_at < now() - interval '10 minutes')
       RETURNING j.*`,
      [workerId],
    );
    return result.rows[0] ?? null;
  });
}

async function finishJob(pool: ZhibanDatabasePool, tenantId: string, jobId: string) {
  await withZhibanTenant(pool, tenantId, (client) =>
    client.query(
      `UPDATE zhiban.analysis_jobs SET status='succeeded',completed_at=now(),locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1`,
      [jobId],
    ),
  );
}

async function failJob(
  pool: ZhibanDatabasePool,
  tenantId: string,
  job: Record<string, unknown>,
  error: unknown,
) {
  const terminal = Number(job.attempts) >= Number(job.max_attempts);
  await withZhibanTenant(pool, tenantId, (client) =>
    client.query(
      `UPDATE zhiban.analysis_jobs SET status=$2::varchar,last_error=$3::text,run_after=CASE WHEN $2::text='queued' THEN now()+(LEAST(300,power(2,attempts))||' seconds')::interval ELSE run_after END,locked_at=NULL,locked_by=NULL,updated_at=now(),completed_at=CASE WHEN $2::text='failed' THEN now() ELSE NULL END WHERE id=$1`,
      [
        job.id,
        terminal ? 'failed' : 'queued',
        error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      ],
    ),
  );
}

export async function processAnalysisJobs(
  pool: ZhibanDatabasePool,
  tenantId: string,
  options: { limit?: number; workerId?: string } = {},
) {
  await sweepRiskSla(pool, tenantId);
  const workerId = options.workerId ?? `inline-${process.pid}`;
  let processed = 0;
  for (let index = 0; index < (options.limit ?? 10); index += 1) {
    const job = await claimJob(pool, tenantId, workerId);
    if (!job) break;
    try {
      const payload = job.payload as { learnerId: string; courseId: string; eventId: string };
      if (job.job_type === 'profile_rebuild') {
        const principal = await learnerPrincipal(pool, tenantId, payload.learnerId);
        await rebuildLearnerProfile(pool, principal, payload.learnerId, payload.courseId);
      } else if (job.job_type === 'ema_evaluate') {
        await evaluateEmaTrigger(pool, tenantId, payload);
      } else if (job.job_type === 'monitor_evaluate') {
        await evaluateMonitorIntervention(pool, tenantId, payload);
      } else if (job.job_type === 'risk_evaluate') {
        await evaluateLearnerRisk(pool, tenantId, payload);
      } else if (job.job_type === 'teaching_snapshot') {
        const teachingPayload = job.payload as { courseId: string; actorId: string };
        const actor = await teachingActorPrincipal(
          pool,
          tenantId,
          teachingPayload.actorId,
          teachingPayload.courseId,
        );
        await createAnalysisSnapshot(pool, actor, teachingPayload.courseId);
        await enqueueTeachingSnapshot(
          pool,
          actor,
          teachingPayload.courseId,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        );
      }
      await finishJob(pool, tenantId, String(job.id));
    } catch (error) {
      await failJob(pool, tenantId, job, error);
    }
    processed += 1;
  }
  return { processed };
}

export async function getOwnAnalysisJobs(pool: ZhibanDatabasePool, principal: AuthorizedPrincipal) {
  return withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query<Record<string, unknown>>(
          `SELECT id,job_type,status,attempts,max_attempts,last_error,created_at,completed_at FROM zhiban.analysis_jobs WHERE payload->>'learnerId'=$1 ORDER BY created_at DESC LIMIT 30`,
          [principal.id],
        )
      ).rows,
  );
}
