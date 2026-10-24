import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import {
  academicAdmin,
  academicStudent,
  requireAcademic,
  type AcademicActor,
} from '../../../domain/academic/model';
import {
  weights,
  weightedPoints,
  type WeightedItem,
  type FinalGradeCommand,
} from '../../../domain/finalgrade/model';
import type { FinalGradeTransaction, FinalQuery } from '../../../application/finalgrade/service';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
import { progressBarrier } from '../../curriculum/postgres/progress';
type Component = WeightedItem & {
  title: string;
  status: string;
  attemptId: string | null;
  submissionId: string | null;
  gradePublicationId: string | null;
  score: number | null;
  maximum: number | null;
};
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class FinalgradePgTransaction implements FinalGradeTransaction {
  constructor(
    private readonly db: PoolClient,
    private readonly recipient: (m: string) => Promise<void>,
  ) {}
  private async config(a: AcademicActor, o: string) {
    return (
      (
        await this.db.query(
          'SELECT revision::text,draft,published_version FROM zhiban_finalgrade.configs WHERE tenant_id=$1 AND offering_id=$2',
          [a.tenantId, o],
        )
      ).rows[0] ?? { revision: '1', draft: [], published_version: 0 }
    );
  }
  private async rule(a: AcademicActor, o: string, version: number): Promise<WeightedItem[]> {
    if (!version) return [];
    const r = (
      await this.db.query(
        'SELECT items FROM zhiban_finalgrade.rules WHERE tenant_id=$1 AND offering_id=$2 AND version=$3',
        [a.tenantId, o, version],
      )
    ).rows[0];
    requireAcademic(r, 'UNAVAILABLE');
    return weights(r.items);
  }
  private async evidence(
    a: AcademicActor,
    o: string,
    member: string,
    version: number,
    items: WeightedItem[],
  ) {
    const enrollment = (
      await this.db.query(
        "SELECT id,valid_from::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE' AND valid_until IS NULL AND valid_from<=$4 FOR SHARE",
        [a.tenantId, o, member, a.now],
      )
    ).rows[0];
    const facts = (
      await this.db.query(
        `SELECT a.id,a.title,a.status,a.published_version,v.title AS fixed_title,t.id AS attempt_id,s.id AS submission_id,p.id AS publication_id,p.score_points,p.max_points
   FROM zhiban_learning.activities a LEFT JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version
   LEFT JOIN LATERAL(SELECT id FROM zhiban_learning.attempts WHERE tenant_id=a.tenant_id AND offering_id=a.offering_id AND activity_id=a.id AND activity_version=a.published_version AND membership_id=$3 AND enrollment_id=$4 AND started_at>=$5 ORDER BY attempt_no DESC LIMIT 1)t ON true
   LEFT JOIN LATERAL(SELECT id FROM zhiban_learning.submissions WHERE tenant_id=a.tenant_id AND attempt_id=t.id ORDER BY version DESC LIMIT 1)s ON true
   LEFT JOIN LATERAL(SELECT id,score_points,max_points FROM zhiban_assessment.publications WHERE tenant_id=a.tenant_id AND submission_id=s.id ORDER BY version DESC LIMIT 1)p ON true
   WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=ANY($6::uuid[])`,
        [
          a.tenantId,
          o,
          member,
          enrollment?.id ?? null,
          enrollment?.valid_from ?? null,
          items.map((i) => i.activityId),
        ],
      )
    ).rows;
    const components: Component[] = items.map((i) => {
      const f = facts.find((f) => f.id === i.activityId),
        valid = f?.status === 'PUBLISHED' && Number(f.published_version) === i.version;
      return {
        ...i,
        title: f?.fixed_title ?? '活动不可用',
        status: !enrollment
          ? 'ENROLLMENT_INACTIVE'
          : !valid
            ? 'VERSION_UNAVAILABLE'
            : !f.submission_id
              ? 'NOT_SUBMITTED'
              : !f.publication_id
                ? 'AWAITING_GRADE'
                : 'READY',
        attemptId: valid ? f.attempt_id : null,
        submissionId: valid ? f.submission_id : null,
        gradePublicationId: valid ? f.publication_id : null,
        score: valid ? f.score_points : null,
        maximum: valid ? f.max_points : null,
      };
    });
    const ready = !!enrollment && items.length > 0 && components.every((c) => c.status === 'READY');
    const sourceDigest = digest({
      offering: o,
      member,
      enrollment: enrollment ?? null,
      version,
      components,
    });
    const latest =
      (
        await this.db.query(
          'SELECT * FROM zhiban_finalgrade.publications WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 ORDER BY version DESC LIMIT 1',
          [a.tenantId, o, member],
        )
      ).rows[0] ?? null;
    return {
      enrollment,
      components,
      ready,
      sourceDigest,
      scorePoints: ready
        ? weightedPoints(
            components.map((c) => ({
              score: c.score!,
              maximum: c.maximum!,
              weightBps: c.weightBps,
            })),
          )
        : null,
      latest,
      needsRecalculation: !!latest && latest.source_digest !== sourceDigest,
    };
  }
  /** Fixed published total attestation under the existing course progress serialization. */
  async attestation(a: AcademicActor, o: string, member: string) {
    await progressBarrier(this.db, a, o);
    const admin = academicAdmin(a),
      self = academicStudent(a) && member === a.membershipId;
    if (!admin && !self) await new LearningPgTransaction(this.db).access(a, o, 'TEACHER');
    const [offering] = (
      await this.db.query(
        'SELECT o.*,v.name AS course_name FROM zhiban_academic.offerings o JOIN zhiban_academic.course_versions v ON v.tenant_id=o.tenant_id AND v.id=o.course_id AND v.version=o.course_version WHERE o.tenant_id=$1 AND o.id=$2 FOR SHARE OF o',
        [a.tenantId, o],
      )
    ).rows;
    requireAcademic(offering, 'NOT_FOUND');
    await this.db.query(
      'SELECT offering_id FROM zhiban_finalgrade.configs WHERE tenant_id=$1 AND offering_id=$2 FOR SHARE',
      [a.tenantId, o],
    );
    const config = await this.config(a, o),
      items = await this.rule(a, o, config.published_version);
    await this.db.query(
      'SELECT id FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',
      [a.tenantId, items.map((i) => i.activityId)],
    );
    const e = await this.evidence(a, o, member, config.published_version, items);
    const [person] = (
      await this.db.query(
        'SELECT display_name FROM zhiban_academic.people WHERE tenant_id=$1 AND membership_id=$2',
        [a.tenantId, member],
      )
    ).rows;
    return {
      ...e,
      current: e.ready && !!e.latest && e.latest.source_digest === e.sourceDigest,
      offering,
      studentName: person?.display_name ?? '历史成员',
    };
  }
  async read(a: AcademicActor, o: string, q: FinalQuery): Promise<Record<string, unknown>> {
    await progressBarrier(this.db, a, o);
    const { mode } = await new LearningPgTransaction(this.db).access(a, o),
      teacher = mode === 'TEACHER';
    requireAcademic(teacher || !q.member || q.member === a.membershipId, 'FORBIDDEN');
    const member = teacher ? q.member : a.membershipId,
      config = await this.config(a, o),
      items = await this.rule(a, o, config.published_version);
    const common = {
      mode,
      ruleVersion: config.published_version,
      items,
      ...(teacher ? { revision: config.revision, draft: config.draft } : {}),
    };
    if (q.view === 'APPEALS') {
      const rows = (
        await this.db.query(
          `SELECT a.id,a.membership_id,a.publication_id,a.body,a.state,a.revision::text,a.created_at,p.version AS total_version,p.score_points,r.decision,r.body AS response,r.replacement_id
    FROM zhiban_finalgrade.appeals a JOIN zhiban_finalgrade.publications p ON p.tenant_id=a.tenant_id AND p.id=a.publication_id LEFT JOIN zhiban_finalgrade.responses r ON r.tenant_id=a.tenant_id AND r.appeal_id=a.id
    WHERE a.tenant_id=$1 AND a.offering_id=$2 AND ($3::uuid IS NULL OR a.membership_id=$3) AND ($4::uuid IS NULL OR a.id<$4) ORDER BY a.id DESC LIMIT 21`,
          [a.tenantId, o, member, q.after],
        )
      ).rows;
      return { ...common, rows: rows.slice(0, 20), next: rows.length > 20 ? rows[19].id : null };
    }
    if (teacher && !member) {
      const rows = (
        await this.db.query(
          `SELECT e.membership_id,p.display_name AS name FROM zhiban_academic.enrollments e LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id WHERE e.tenant_id=$1 AND e.offering_id=$2 AND e.status='ACTIVE' AND e.valid_until IS NULL AND e.valid_from<=$3 AND ($4::uuid IS NULL OR e.membership_id<$4) ORDER BY e.membership_id DESC LIMIT 21`,
          [a.tenantId, o, a.now, q.after],
        )
      ).rows;
      const activities = (
        await this.db.query(
          `SELECT a.id,v.title,a.published_version FROM zhiban_learning.activities a JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version LEFT JOIN zhiban_learning.quiz_definitions q ON q.tenant_id=a.tenant_id AND q.activity_id=a.id WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.status='PUBLISHED' AND (q.mode IS NULL OR q.mode='ASSESSED') ORDER BY a.id LIMIT 101`,
          [a.tenantId, o],
        )
      ).rows;
      requireAcademic(activities.length <= 100, 'INVALID_STATE');
      return {
        ...common,
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? rows[19].membership_id : null,
        activities,
      };
    }
    requireAcademic(member, 'INVALID_INPUT');
    const evidence = await this.evidence(a, o, member, config.published_version, items);
    const rows = (
      await this.db.query(
        `SELECT p.*,EXISTS(SELECT 1 FROM zhiban_finalgrade.appeals a WHERE a.tenant_id=p.tenant_id AND a.publication_id=p.id) AS appealed FROM zhiban_finalgrade.publications p WHERE p.tenant_id=$1 AND p.offering_id=$2 AND p.membership_id=$3 AND ($4::uuid IS NULL OR p.id<$4) ORDER BY p.id DESC LIMIT 21`,
        [a.tenantId, o, member, q.after],
      )
    ).rows;
    if (teacher) requireAcademic(evidence.enrollment, 'FORBIDDEN');
    return {
      ...common,
      rows: rows.slice(0, 20),
      next: rows.length > 20 ? rows[19].id : null,
      needsRecalculation: evidence.needsRecalculation,
      ...(teacher ? { preview: evidence } : {}),
    };
  }
  async execute(
    a: AcademicActor,
    o: string,
    c: FinalGradeCommand,
    key: string,
  ): Promise<Record<string, unknown>> {
    await progressBarrier(this.db, a, o);
    const student = c.type === 'OPEN_APPEAL';
    const access = await new LearningPgTransaction(this.db).access(
      a,
      o,
      student ? 'STUDENT' : 'TEACHER',
    );
    requireAcademic(access.offering.status === 'OPEN', 'INVALID_STATE');
    await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `academic-command:${a.tenantId}:${key}`,
    ]);
    const payload = digest({ offering: o, command: c });
    const old = (
      await this.db.query(
        'SELECT c.actor_id,c.payload_digest,a.facts FROM zhiban_academic.commands c JOIN zhiban_academic.audit_events a ON a.tenant_id=c.tenant_id AND a.command_key=c.command_key WHERE c.tenant_id=$1 AND c.command_key=$2',
        [a.tenantId, key],
      )
    ).rows[0];
    if (old) {
      requireAcademic(
        old.actor_id === a.membershipId && old.payload_digest === payload,
        'CONFLICT',
      );
      return old.facts.result;
    }
    let result: Record<string, unknown>;
    if (c.type === 'SAVE_WEIGHTS' || c.type === 'PUBLISH_WEIGHTS') {
      await this.db.query(
        'INSERT INTO zhiban_finalgrade.configs(tenant_id,offering_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [a.tenantId, o],
      );
      const config = await this.config(a, o);
      requireAcademic(config.revision === c.revision, 'CONFLICT');
      if (c.type === 'SAVE_WEIGHTS') {
        weights(c.items);
        await this.db.query(
          'UPDATE zhiban_finalgrade.configs SET draft=$3,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2',
          [a.tenantId, o, JSON.stringify(c.items)],
        );
        result = { revision: String(BigInt(config.revision) + BigInt(1)) };
      } else {
        const items = weights(config.draft);
        for (const i of items) {
          const f = (
            await this.db.query(
              `SELECT a.status,a.published_version,q.mode FROM zhiban_learning.activities a LEFT JOIN zhiban_learning.quiz_definitions q ON q.tenant_id=a.tenant_id AND q.activity_id=a.id WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=$3`,
              [a.tenantId, o, i.activityId],
            )
          ).rows[0];
          requireAcademic(
            f?.status === 'PUBLISHED' &&
              Number(f.published_version) === i.version &&
              f.mode !== 'PRACTICE',
            'INVALID_STATE',
          );
        }
        const version = config.published_version + 1;
        await this.db.query('INSERT INTO zhiban_finalgrade.rules VALUES($1,$2,$3,$4,$5,$6)', [
          a.tenantId,
          o,
          version,
          JSON.stringify(items),
          a.membershipId,
          a.now,
        ]);
        await this.db.query(
          'UPDATE zhiban_finalgrade.configs SET published_version=$3,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2',
          [a.tenantId, o, version],
        );
        result = { version, revision: String(BigInt(config.revision) + BigInt(1)) };
      }
    } else if (c.type === 'PUBLISH_TOTAL') {
      await this.recipient(c.memberId);
      const config = await this.config(a, o),
        items = await this.rule(a, o, config.published_version),
        e = await this.evidence(a, o, c.memberId, config.published_version, items);
      requireAcademic(e.ready && e.enrollment, 'INVALID_STATE');
      requireAcademic(
        e.sourceDigest === c.sourceDigest && (e.latest?.id ?? null) === c.previousId,
        'CONFLICT',
      );
      requireAcademic(!e.latest || e.latest.source_digest !== e.sourceDigest, 'INVALID_STATE');
      const id = v7(),
        version = (e.latest?.version ?? 0) + 1;
      await this.db.query(
        'INSERT INTO zhiban_finalgrade.publications VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [
          a.tenantId,
          o,
          id,
          c.memberId,
          e.enrollment.id,
          e.enrollment.valid_from,
          version,
          config.published_version,
          e.scorePoints,
          e.sourceDigest,
          JSON.stringify(e.components),
          c.reason,
          a.membershipId,
          a.now,
        ],
      );
      result = { id, version, scorePoints: e.scorePoints, sourceDigest: e.sourceDigest };
    } else if (c.type === 'OPEN_APPEAL') {
      const p = (
        await this.db.query(
          'SELECT id FROM zhiban_finalgrade.publications WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4',
          [a.tenantId, o, c.publicationId, a.membershipId],
        )
      ).rows[0];
      requireAcademic(p, 'NOT_FOUND');
      const id = v7();
      await this.db.query(
        'INSERT INTO zhiban_finalgrade.appeals(tenant_id,offering_id,id,membership_id,publication_id,body,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [a.tenantId, o, id, a.membershipId, c.publicationId, c.body, a.now],
      );
      result = { id, revision: '1' };
    } else {
      await this.recipient(c.memberId);
      const appeal = (
        await this.db.query(
          'SELECT * FROM zhiban_finalgrade.appeals WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4 FOR UPDATE',
          [a.tenantId, o, c.id, c.memberId],
        )
      ).rows[0];
      requireAcademic(appeal, 'NOT_FOUND');
      requireAcademic(
        appeal.state === 'OPEN' && String(appeal.revision) === c.revision,
        'CONFLICT',
      );
      let replacement: string | null = null;
      if (c.decision === 'REPLACED') {
        const config = await this.config(a, o),
          e = await this.evidence(
            a,
            o,
            c.memberId,
            config.published_version,
            await this.rule(a, o, config.published_version),
          );
        requireAcademic(
          e.latest && e.latest.id !== appeal.publication_id && !e.needsRecalculation && e.ready,
          'INVALID_STATE',
        );
        replacement = e.latest.id;
      }
      await this.db.query(
        'INSERT INTO zhiban_finalgrade.responses VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [a.tenantId, c.id, c.memberId, a.membershipId, c.decision, c.body, replacement, a.now],
      );
      await this.db.query(
        "UPDATE zhiban_finalgrade.appeals SET state='RESOLVED',revision=revision+1 WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, c.id],
      );
      result = {
        id: c.id,
        revision: String(BigInt(c.revision) + BigInt(1)),
        replacementId: replacement,
      };
    }
    await this.db.query('INSERT INTO zhiban_academic.commands VALUES($1,$2,$3,$4,$5)', [
      a.tenantId,
      key,
      a.membershipId,
      payload,
      a.now,
    ]);
    await this.db.query(
      'INSERT INTO zhiban_academic.audit_events(tenant_id,id,actor_id,command_key,event_type,occurred_at,facts) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        a.tenantId,
        v7(),
        a.membershipId,
        key,
        `FINALGRADE_${c.type}`,
        a.now,
        JSON.stringify({ offeringId: o, result }),
      ],
    );
    return result;
  }
}
