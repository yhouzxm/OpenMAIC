import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import type { AutoCommand } from '../../../domain/autograde/model';
import { evidenceDigest } from '../../../domain/concept/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
import { progressBarrier } from '../../curriculum/postgres/progress';
type Row = Record<string, unknown>;
export class AutoGradePgTransaction {
  constructor(
    private readonly db: PoolClient,
    private readonly identity: PoolClient,
  ) {}
  private async rows(sql: string, args: unknown[]) {
    return (await this.db.query<Row>(sql, args)).rows;
  }
  async read(
    a: AcademicActor,
    o: string,
    mode: 'TEACHER' | 'STUDENT',
    view: string,
    after: string | null,
    activity: string | null = null,
  ) {
    await progressBarrier(this.db, a, o);
    await new LearningPgTransaction(this.db).access(a, o, mode);
    const policies = await this.rows(
      `SELECT a.id,a.activity_type,a.published_version,v.title,q.mode,qv.max_points AS quiz_max_points,h.enabled,coalesce(h.revision,1)::text AS revision,p.id AS policy_id,p.activity_version,p.rubric,p.max_points,p.provider,p.model,p.teacher_id FROM zhiban_learning.activities a JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version LEFT JOIN zhiban_learning.quiz_definitions q ON q.tenant_id=a.tenant_id AND q.activity_id=a.id LEFT JOIN zhiban_learning.quiz_versions qv ON qv.tenant_id=a.tenant_id AND qv.activity_id=a.id AND qv.version=a.published_version LEFT JOIN zhiban_autograde.heads h ON h.tenant_id=a.tenant_id AND h.activity_id=a.id LEFT JOIN zhiban_autograde.policies p ON p.tenant_id=h.tenant_id AND p.id=h.current_policy WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.status='PUBLISHED' AND ($4::uuid IS NULL OR a.id=$4) AND ($3::uuid IS NULL OR a.id<$3) ORDER BY a.id DESC LIMIT 21`,
      [a.tenantId, o, view === 'POLICIES' ? after : null, activity],
    );
    if (view === 'POLICIES')
      return {
        rows: policies.slice(0, 20),
        next: policies.length > 20 ? String(policies[19].id) : null,
      };
    if (view === 'APPEALS') {
      const rows = await this.rows(
        'SELECT x.*,x.revision::text,p.score_points,p.max_points,p.version AS publication_version FROM zhiban_autograde.appeals x JOIN zhiban_assessment.publications p ON p.tenant_id=x.tenant_id AND p.id=x.publication_id WHERE x.tenant_id=$1 AND x.offering_id=$2 AND ($3::uuid IS NULL OR x.membership_id=$3) AND ($4::uuid IS NULL OR x.id<$4) ORDER BY x.id DESC LIMIT 21',
        [a.tenantId, o, mode === 'STUDENT' ? a.membershipId : null, after],
      );
      return { rows: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null };
    }
    if (mode === 'STUDENT') {
      const rows = await this.rows(
        'SELECT p.id,p.submission_id,p.version,p.score_points,p.max_points,p.feedback,p.published_at,v.title,g.published_version AS latest_version,g.score_points AS latest_score_points,EXISTS(SELECT 1 FROM zhiban_autograde.appeals x WHERE x.tenant_id=p.tenant_id AND x.publication_id=p.id) AS appealed FROM zhiban_assessment.publications p JOIN zhiban_assessment.grades g ON g.tenant_id=p.tenant_id AND g.id=p.grade_id JOIN zhiban_learning.submissions s ON s.tenant_id=p.tenant_id AND s.id=p.submission_id JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version WHERE p.tenant_id=$1 AND t.offering_id=$2 AND t.membership_id=$3 AND p.service_job_id IS NOT NULL AND ($4::uuid IS NULL OR p.id<$4) ORDER BY p.id DESC LIMIT 21',
        [a.tenantId, o, a.membershipId, after],
      );
      return { rows: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null };
    }
    const rows = await this.rows(
      "SELECT r.submission_id AS id,r.state AS request_state,r.policy_id,r.created_at,j.id AS job_id,j.state,j.revision::text,j.failure,j.expires_at,j.publication_id,j.result->'model' AS model,t.activity_id,v.title,coalesce(p.display_name,'历史成员') AS student_name FROM zhiban_autograde.requests r JOIN zhiban_learning.submissions s ON s.tenant_id=r.tenant_id AND s.id=r.submission_id JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version LEFT JOIN zhiban_autograde.jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id LEFT JOIN zhiban_academic.people p ON p.tenant_id=t.tenant_id AND p.membership_id=t.membership_id WHERE r.tenant_id=$1 AND r.offering_id=$2 AND ($3::uuid IS NULL OR r.submission_id<$3) ORDER BY r.submission_id DESC LIMIT 21",
      [a.tenantId, o, after],
    );
    return { rows: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null };
  }
  async execute(
    a: AcademicActor,
    o: string,
    c: AutoCommand,
    key: string,
    model: { provider: string; model: string } | null,
  ) {
    await progressBarrier(this.db, a, o);
    const student = c.type === 'OPEN_APPEAL';
    await new LearningPgTransaction(this.db).access(a, o, student ? 'STUDENT' : 'TEACHER');
    await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `auto-command:${a.tenantId}:${key}`,
    ]);
    const digest = evidenceDigest([o, c]),
      [old] = await this.rows(
        'SELECT * FROM zhiban_autograde.commands WHERE tenant_id=$1 AND command_key=$2',
        [a.tenantId, key],
      );
    if (old) {
      requireAcademic(old.actor_id === a.membershipId && old.payload_digest === digest, 'CONFLICT');
      return old.result as Row;
    }
    let result: Row,
      activityId: string,
      detail: Row = {};
    if (c.type === 'ENABLE' || c.type === 'DISABLE') {
      const [activity] = await this.rows(
        'SELECT a.*,v.prompt,q.mode,qv.max_points,qv.content FROM zhiban_learning.activities a LEFT JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version LEFT JOIN zhiban_learning.quiz_definitions q ON q.tenant_id=a.tenant_id AND q.activity_id=a.id LEFT JOIN zhiban_learning.quiz_versions qv ON qv.tenant_id=a.tenant_id AND qv.activity_id=a.id AND qv.version=a.published_version WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=$3 FOR SHARE OF a',
        [a.tenantId, o, c.activityId],
      );
      requireAcademic(activity, 'NOT_FOUND');
      activityId = c.activityId;
      await this.db.query(
        'INSERT INTO zhiban_autograde.heads(tenant_id,activity_id,offering_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [a.tenantId, activityId, o],
      );
      const [h] = await this.rows(
        'SELECT *,revision::text FROM zhiban_autograde.heads WHERE tenant_id=$1 AND activity_id=$2 FOR UPDATE',
        [a.tenantId, activityId],
      );
      requireAcademic(h.revision === c.revision, 'CONFLICT');
      let policy: string | null = null;
      if (c.type === 'ENABLE') {
        requireAcademic(
          model &&
            activity.status === 'PUBLISHED' &&
            Number(activity.published_version) === c.activityVersion,
          'CONFLICT',
        );
        requireAcademic(
          activity.activity_type === 'TEXT_RESPONSE' ||
            (activity.activity_type === 'QUIZ' &&
              activity.mode === 'ASSESSED' &&
              (activity.content as { questions: { type: string }[] }).questions.some(
                (q) => q.type === 'short_answer',
              )),
          'INVALID_STATE',
        );
        if (activity.activity_type === 'QUIZ')
          requireAcademic(Number(activity.max_points) === c.maxPoints);
        const g = (
          await this.identity.query(
            "SELECT grant_id FROM zhiban_identity.role_grants WHERE tenant_id=$1 AND membership_id=$2 AND role_code='TEACHER' AND revoked_at IS NULL AND valid_from<=$3 AND (valid_until IS NULL OR valid_until>$3) AND ((scope_kind='TENANT' AND scope_id IS NULL) OR(scope_kind='COURSE' AND scope_id=$4) OR(scope_kind='CLASS' AND scope_id=$5)) ORDER BY grant_id LIMIT 1 FOR SHARE",
            [
              a.tenantId,
              a.membershipId,
              a.now,
              activity.offering_id === o
                ? (
                    await this.rows(
                      'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
                      [a.tenantId, o],
                    )
                  )[0].course_id
                : null,
              o,
            ],
          )
        ).rows[0];
        requireAcademic(g, 'FORBIDDEN');
        const m = (
          await this.identity.query(
            'SELECT authorization_version FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2',
            [a.tenantId, a.membershipId],
          )
        ).rows[0];
        policy = v7();
        await this.db.query(
          'INSERT INTO zhiban_autograde.policies VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [
            a.tenantId,
            policy,
            activityId,
            o,
            c.activityVersion,
            c.rubric,
            c.maxPoints,
            model.provider,
            model.model,
            a.membershipId,
            g.grant_id,
            m.authorization_version,
            a.now,
          ],
        );
        detail = { policyId: policy, rubric: c.rubric, model };
      }
      await this.db.query(
        'UPDATE zhiban_autograde.heads SET enabled=$3,current_policy=coalesce($4,current_policy),revision=revision+1 WHERE tenant_id=$1 AND activity_id=$2',
        [a.tenantId, activityId, c.type === 'ENABLE', policy],
      );
      result = {
        activityId,
        revision: String(BigInt(c.revision) + BigInt(1)),
        enabled: c.type === 'ENABLE',
        policyId: policy,
      };
    } else if (c.type === 'RETRY') {
      const [x] = await this.rows(
        'SELECT t.activity_id,t.activity_version FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id WHERE s.tenant_id=$1 AND s.id=$2 AND t.offering_id=$3',
        [a.tenantId, c.submissionId, o],
      );
      requireAcademic(x, 'NOT_FOUND');
      activityId = String(x.activity_id);
      const [h] = await this.rows(
        'SELECT * FROM zhiban_autograde.heads WHERE tenant_id=$1 AND activity_id=$2 AND enabled FOR SHARE',
        [a.tenantId, activityId],
      );
      requireAcademic(h, 'INVALID_STATE');
      requireAcademic(
        !(
          await this.rows(
            'SELECT id FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2',
            [a.tenantId, c.submissionId],
          )
        ).length,
        'CONFLICT',
      );
      const [pending] = await this.rows(
        'SELECT state FROM zhiban_autograde.requests WHERE tenant_id=$1 AND submission_id=$2 FOR UPDATE',
        [a.tenantId, c.submissionId],
      );
      requireAcademic(!pending || pending.state === 'FAILED', 'CONFLICT');
      await this.db.query(
        "INSERT INTO zhiban_autograde.requests(tenant_id,submission_id,offering_id,policy_id,state,created_at) VALUES($1,$2,$3,$4,'PENDING',$5) ON CONFLICT(tenant_id,submission_id) DO UPDATE SET state='PENDING',policy_id=EXCLUDED.policy_id",
        [a.tenantId, c.submissionId, o, h.current_policy, a.now],
      );
      result = { submissionId: c.submissionId, state: 'PENDING' };
      detail = result;
    } else if (c.type === 'CANCEL' || c.type === 'EXPIRE') {
      const [j] = await this.rows(
        'SELECT *,revision::text FROM zhiban_autograde.jobs WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
        [a.tenantId, o, c.id],
      );
      requireAcademic(j, 'NOT_FOUND');
      requireAcademic(
        j.state === 'RUNNING' &&
          j.revision === c.revision &&
          (c.type === 'CANCEL' || Number(j.expires_at) <= a.now),
        'CONFLICT',
      );
      activityId = String((j.input as Row).activityId);
      await this.db.query(
        "UPDATE zhiban_autograde.jobs SET state='CANCELLED',revision=revision+1,finished_at=$3,failure=$4 WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, c.id, a.now, c.type === 'EXPIRE' ? 'EXPIRED' : 'CANCELLED'],
      );
      await this.db.query(
        "UPDATE zhiban_autograde.requests SET state='FAILED' WHERE tenant_id=$1 AND submission_id=$2",
        [a.tenantId, j.submission_id],
      );
      result = { id: c.id, state: 'CANCELLED' };
      detail = result;
    } else if (c.type === 'OPEN_APPEAL') {
      const [p] = await this.rows(
        'SELECT p.*,t.activity_id FROM zhiban_assessment.publications p JOIN zhiban_learning.submissions s ON s.tenant_id=p.tenant_id AND s.id=p.submission_id JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id WHERE p.tenant_id=$1 AND p.id=$2 AND t.offering_id=$3 AND t.membership_id=$4 AND p.service_job_id IS NOT NULL',
        [a.tenantId, c.publicationId, o, a.membershipId],
      );
      requireAcademic(p, 'NOT_FOUND');
      activityId = String(p.activity_id);
      const id = v7();
      await this.db.query(
        "INSERT INTO zhiban_autograde.appeals(tenant_id,id,publication_id,membership_id,offering_id,body,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7)",
        [a.tenantId, id, c.publicationId, a.membershipId, o, c.body, a.now],
      );
      result = { id, revision: '1' };
      detail = { ...result, body: c.body };
    } else {
      const [x] = await this.rows(
        'SELECT x.*,x.revision::text,p.grade_id,p.version AS publication_version,t.activity_id FROM zhiban_autograde.appeals x JOIN zhiban_assessment.publications p ON p.tenant_id=x.tenant_id AND p.id=x.publication_id JOIN zhiban_learning.submissions s ON s.tenant_id=p.tenant_id AND s.id=p.submission_id JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id WHERE x.tenant_id=$1 AND x.offering_id=$2 AND x.id=$3 FOR UPDATE OF x',
        [a.tenantId, o, c.id],
      );
      requireAcademic(x, 'NOT_FOUND');
      requireAcademic(x.state === 'OPEN' && x.revision === c.revision, 'CONFLICT');
      activityId = String(x.activity_id);
      requireAcademic(c.type === 'RESOLVE_APPEAL');
      if (c.replacementId) {
        const [p] = await this.rows(
          'SELECT id FROM zhiban_assessment.publications WHERE tenant_id=$1 AND grade_id=$2 ORDER BY version DESC LIMIT 1',
          [a.tenantId, x.grade_id],
        );
        requireAcademic(p && p.id === c.replacementId && p.id !== x.publication_id, 'CONFLICT');
      }
      await this.db.query(
        "UPDATE zhiban_autograde.appeals SET state='RESOLVED',revision=revision+1,response=$3,replacement_id=$4,resolved_at=$5,resolved_by=$6 WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, c.id, c.response, c.replacementId, a.now, a.membershipId],
      );
      result = { id: c.id, revision: String(BigInt(c.revision) + BigInt(1)), state: 'RESOLVED' };
      detail = { ...result, response: c.response, replacementId: c.replacementId };
    }
    await this.db.query(
      "INSERT INTO zhiban_autograde.events VALUES($1,$2,NULL,$3,$4,'USER',$5,NULL,$6,$7)",
      [a.tenantId, v7(), activityId, c.type, a.membershipId, JSON.stringify(detail), a.now],
    );
    await this.db.query('INSERT INTO zhiban_autograde.commands VALUES($1,$2,$3,$4,$5,$6)', [
      a.tenantId,
      key,
      a.membershipId,
      digest,
      JSON.stringify(result),
      a.now,
    ]);
    return result;
  }
}
