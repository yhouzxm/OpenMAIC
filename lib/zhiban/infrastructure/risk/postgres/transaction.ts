import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import {
  observation,
  riskCodes,
  type RiskCommand,
  type RiskRef,
  type Observation,
} from '../../../domain/risk/model';
import type { RiskQuery, RiskTransaction } from '../../../application/risk/service';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
import { riskSources, hitSql } from './sources';
type Row = Record<string, unknown>;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class RiskPgTransaction implements RiskTransaction {
  constructor(private readonly client: PoolClient) {}
  private async rows(sql: string, args: unknown[]) {
    return (await this.client.query<Row>(sql, args)).rows;
  }
  private async configuration(a: AcademicActor, o: string, write = false) {
    await this.client.query(
      `SELECT ${write ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'}(hashtextextended($1,0))`,
      [`risk-config:${a.tenantId}:${o}`],
    );
    const stored = await this.rows(
      'SELECT rule_code AS code,revision::text,enabled,threshold FROM zhiban_risk.rules WHERE tenant_id=$1 AND offering_id=$2 ORDER BY rule_code FOR SHARE',
      [a.tenantId, o],
    );
    const rows = riskCodes.map(
      (code) =>
        stored.find((r) => r.code === code) ?? {
          code,
          revision: '0',
          enabled: false,
          threshold: code === 'LOW_SCORE' ? 60 : 24,
        },
    );
    return { rows, stamp: hash(rows) };
  }
  private sample(r: Row, now: number): Observation {
    return observation(
      {
        ruleCode: r.rule_code as Observation['ruleCode'],
        ruleRevision: String(r.rule_revision),
        threshold: Number(r.threshold),
        currentRuleRevision: String(r.current_revision),
        currentRuleEnabled: Boolean(r.current_enabled),
        enrollmentId: String(r.enrollment_id),
        membershipId: String(r.membership_id),
        displayName: r.display_name === null ? null : String(r.display_name),
        anchorId: String(r.anchor_id),
        anchorVersion: Number(r.anchor_version),
        title: String(r.title),
        caseId: r.case_id === null ? null : String(r.case_id),
        sourceKey: String(r.source_key),
        eligible: Boolean(r.eligible),
        facts: r.facts as Record<string, unknown>,
      },
      now,
    );
  }
  private args(a: AcademicActor, o: string, ref?: RiskRef) {
    return [
      a.tenantId,
      o,
      a.now,
      ref?.ruleCode ?? null,
      ref?.ruleRevision ?? null,
      ref?.enrollmentId ?? null,
      ref?.anchorId ?? null,
      ref?.anchorVersion ?? null,
    ];
  }
  private async observe(a: AcademicActor, o: string, ref: RiskRef) {
    if (ref.ruleCode === 'PLAN_OVERDUE')
      await this.rows(
        'SELECT id FROM zhiban_remediation.plans WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
        [a.tenantId, o, ref.anchorId],
      );
    else
      await this.rows(
        'SELECT id FROM zhiban_learning.activities WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
        [a.tenantId, o, ref.anchorId],
      );
    const [e] = await this.rows(
      'SELECT membership_id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
      [a.tenantId, o, ref.enrollmentId],
    );
    requireAcademic(e, 'NOT_FOUND');
    if (ref.ruleCode !== 'PLAN_OVERDUE')
      await this.rows(
        'SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND enrollment_id=$2 AND membership_id=$3 AND activity_id=$4 AND activity_version=$5 ORDER BY attempt_no DESC LIMIT 1 FOR SHARE',
        [a.tenantId, ref.enrollmentId, e.membership_id, ref.anchorId, ref.anchorVersion],
      );
    const [r] = await this.rows(riskSources + ' SELECT * FROM observations', this.args(a, o, ref));
    requireAcademic(r, 'NOT_FOUND');
    return this.sample(r, a.now);
  }
  private ref(r: Row): RiskRef {
    return {
      ruleCode: r.rule_code as RiskRef['ruleCode'],
      ruleRevision: String(r.rule_revision),
      enrollmentId: String(r.enrollment_id),
      anchorId: String(r.anchor_id),
      anchorVersion: Number(r.anchor_version),
      sourceKey: String(r.source_key),
    };
  }
  async read(a: AcademicActor, o: string, q: RiskQuery) {
    await new LearningPgTransaction(this.client).access(a, o, 'TEACHER');
    const config = await this.configuration(a, o);
    const common = { configStamp: config.stamp, asOf: a.now };
    if (q.view === 'RULES') return { ...common, rows: config.rows, next: null };
    if (q.view === 'QUEUE') {
      requireAcademic(!q.configStamp || q.configStamp === config.stamp, 'CONFLICT');
      const args = this.args(a, o);
      args[3] = q.code === 'ALL' ? null : q.code;
      const rows = await this.rows(
        riskSources +
          ` SELECT s.*,r.id AS review_id,r.decision AS review_decision,r.revision::text AS review_revision
    FROM observations s LEFT JOIN zhiban_risk.reviews r ON r.tenant_id=$1 AND r.offering_id=$2 AND r.rule_code=s.rule_code AND r.rule_revision=s.rule_revision::bigint AND r.enrollment_id=s.enrollment_id AND r.anchor_id=s.anchor_id AND r.anchor_version=s.anchor_version AND r.source_key=s.source_key
    WHERE ${hitSql} AND ($9='ALL' OR ($9='PENDING' AND r.id IS NULL) OR r.decision=$9)
    AND ($10='' OR strpos(lower(s.title),lower($10))>0 OR strpos(lower(coalesce(s.display_name,'')),lower($10))>0 OR s.membership_id::text=$10)
    AND ($11::jsonb IS NULL OR (s.rule_code,s.enrollment_id::text,s.anchor_id::text,s.anchor_version,s.source_key)>(($11::jsonb->>0),($11::jsonb->>1),($11::jsonb->>2),($11::jsonb->>3)::int,($11::jsonb->>4)))
    ORDER BY s.rule_code,s.enrollment_id,s.anchor_id,s.anchor_version,s.source_key LIMIT 21`,
        [...args, q.decision, q.q, q.after ? JSON.stringify(q.after) : null],
      );
      const page = rows.slice(0, 20),
        last = page.at(-1);
      return {
        ...common,
        rules: config.rows,
        rows: page.map((r) => ({
          ...this.sample(r, a.now),
          reviewId: r.review_id,
          reviewDecision: r.review_decision,
          reviewRevision: r.review_revision,
        })),
        next:
          rows.length > 20 && last
            ? [
                String(last.rule_code),
                String(last.enrollment_id),
                String(last.anchor_id),
                String(last.anchor_version),
                String(last.source_key),
              ]
            : null,
      };
    }
    const rows = await this.rows(
      `SELECT r.*,r.revision::text,r.rule_revision::text,coalesce(p.display_name,'历史成员') AS student_name FROM zhiban_risk.reviews r LEFT JOIN zhiban_academic.people p ON p.tenant_id=r.tenant_id AND p.membership_id=r.membership_id
   WHERE r.tenant_id=$1 AND r.offering_id=$2 AND ($3::uuid IS NULL OR r.id=$3) AND ($4='ALL' OR r.rule_code=$4) AND ($5='ALL' OR r.decision=$5)
   AND ($6='' OR strpos(lower(r.evidence->>'title'),lower($6))>0 OR strpos(lower(coalesce(p.display_name,'')),lower($6))>0 OR r.membership_id::text=$6)
   AND ($7::uuid IS NULL OR r.id<$7) ORDER BY r.id DESC LIMIT 21 ${q.id ? 'FOR SHARE OF r' : ''}`,
      [a.tenantId, o, q.id, q.code, q.decision, q.q, q.id ? null : (q.after?.[0] ?? null)],
    );
    if (q.view !== 'DETAIL')
      return {
        ...common,
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? [String(rows[19].id)] : null,
      };
    requireAcademic(rows.length === 1, 'NOT_FOUND');
    const current = await this.observe(a, o, this.ref(rows[0]));
    const events = await this.rows(
      `SELECT e.id,e.action,e.decision,e.revision::text,e.body,e.snapshot,e.created_at,coalesce(p.display_name,'历史教师') AS actor_name FROM zhiban_risk.events e LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.actor_id WHERE e.tenant_id=$1 AND e.review_id=$2 AND ($3::uuid IS NULL OR e.id<$3) ORDER BY e.id DESC LIMIT 21`,
      [a.tenantId, q.id, q.after?.[0] ?? null],
    );
    return {
      ...common,
      record: rows[0],
      current,
      rows: events.slice(0, 20),
      next: events.length > 20 ? [String(events[19].id)] : null,
    };
  }
  private async link(
    a: AcademicActor,
    o: string,
    current: Observation,
    reviewId: unknown,
    body: string,
  ) {
    if (current.caseId) {
      const [c] = await this.rows(
        'SELECT id,state FROM zhiban_followup.cases WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
        [a.tenantId, o, current.caseId],
      );
      requireAcademic(c, 'NOT_FOUND');
      return c;
    }
    requireAcademic(current.ruleCode !== 'PLAN_OVERDUE', 'CONFLICT');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `followup-anchor:${a.tenantId}:${current.enrollmentId}:${current.anchorId}:${current.anchorVersion}`,
    ]);
    const [prior] = await this.rows(
      'SELECT id,state FROM zhiban_followup.cases WHERE tenant_id=$1 AND enrollment_id=$2 AND activity_id=$3 AND activity_version=$4 FOR SHARE',
      [a.tenantId, current.enrollmentId, current.anchorId, current.anchorVersion],
    );
    if (prior) return prior;
    const id = v7(),
      snapshot = {
        reason: 'RISK_SUPPORT',
        asOf: a.now,
        riskReviewId: reviewId,
        ruleCode: current.ruleCode,
        ruleRevision: current.ruleRevision,
        facts: current.facts,
      };
    // Explicit human-reviewed support entry. Existing CREATE_CASE pending-only command is unchanged.
    await this.client.query(
      "INSERT INTO zhiban_followup.cases VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',1,$10,$10,$11,$11)",
      [
        a.tenantId,
        o,
        id,
        current.enrollmentId,
        current.membershipId,
        current.anchorId,
        current.anchorVersion,
        current.title,
        JSON.stringify(snapshot),
        a.membershipId,
        a.now,
      ],
    );
    await this.client.query(
      "INSERT INTO zhiban_followup.events VALUES($1,$2,$3,$4,$5,'CREATE_CASE',$6,1,NULL,'OPEN',$7)",
      [a.tenantId, o, id, v7(), a.membershipId, body, a.now],
    );
    return { id, state: 'OPEN' };
  }
  async execute(a: AcademicActor, o: string, c: RiskCommand, key: string) {
    await new LearningPgTransaction(this.client).access(a, o, 'TEACHER');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `risk-command:${a.tenantId}:${key}`,
    ]);
    await this.configuration(a, o, c.type === 'SAVE_RULE');
    const digest = hash([o, c]);
    const [prior] = await this.rows(
      'SELECT actor_id,offering_id,payload_digest,result FROM zhiban_risk.commands WHERE tenant_id=$1 AND command_key=$2',
      [a.tenantId, key],
    );
    if (prior) {
      requireAcademic(
        prior.actor_id === a.membershipId &&
          prior.offering_id === o &&
          prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result;
    }
    let result: Row;
    if (c.type === 'SAVE_RULE') {
      const [r] = await this.rows(
        'SELECT revision::text FROM zhiban_risk.rules WHERE tenant_id=$1 AND offering_id=$2 AND rule_code=$3 FOR UPDATE',
        [a.tenantId, o, c.ruleCode],
      );
      requireAcademic((r?.revision ?? '0') === c.revision, 'CONFLICT');
      const revision = String(BigInt(c.revision) + BigInt(1));
      if (r)
        await this.client.query(
          'UPDATE zhiban_risk.rules SET enabled=$4,threshold=$5,revision=$6 WHERE tenant_id=$1 AND offering_id=$2 AND rule_code=$3',
          [a.tenantId, o, c.ruleCode, c.enabled, c.threshold, revision],
        );
      else
        await this.client.query('INSERT INTO zhiban_risk.rules VALUES($1,$2,$3,$4,$5,$6)', [
          a.tenantId,
          o,
          c.ruleCode,
          c.enabled,
          c.threshold,
          revision,
        ]);
      await this.client.query(
        'INSERT INTO zhiban_risk.rule_versions VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [a.tenantId, o, c.ruleCode, revision, c.enabled, c.threshold, a.membershipId, a.now],
      );
      result = { ruleCode: c.ruleCode, revision };
    } else {
      let r: Row, current: Observation;
      if (c.type === 'REVIEW_SIGNAL') {
        current = await this.observe(a, o, c);
        requireAcademic(
          current.matched &&
            current.sourceKey === c.sourceKey &&
            current.digest === c.expectedDigest,
          'CONFLICT',
        );
        await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `risk-source:${a.tenantId}:${o}:${current.ruleCode}:${current.ruleRevision}:${current.enrollmentId}:${current.anchorId}:${current.anchorVersion}:${current.sourceKey}`,
        ]);
        const [duplicate] = await this.rows(
          'SELECT id FROM zhiban_risk.reviews WHERE tenant_id=$1 AND offering_id=$2 AND rule_code=$3 AND rule_revision=$4 AND enrollment_id=$5 AND anchor_id=$6 AND anchor_version=$7 AND source_key=$8',
          [
            a.tenantId,
            o,
            current.ruleCode,
            current.ruleRevision,
            current.enrollmentId,
            current.anchorId,
            current.anchorVersion,
            current.sourceKey,
          ],
        );
        requireAcademic(!duplicate, 'CONFLICT');
        [r] = await this.rows(
          `INSERT INTO zhiban_risk.reviews(tenant_id,offering_id,id,rule_code,rule_revision,enrollment_id,membership_id,activity_id,activity_version,plan_id,source_key,evidence_digest,evidence,decision,revision,case_id,created_by,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,$16,$17,$17) RETURNING id,decision,revision::text,case_id`,
          [
            a.tenantId,
            o,
            v7(),
            current.ruleCode,
            current.ruleRevision,
            current.enrollmentId,
            current.membershipId,
            current.ruleCode === 'PLAN_OVERDUE' ? null : current.anchorId,
            current.ruleCode === 'PLAN_OVERDUE' ? null : current.anchorVersion,
            current.ruleCode === 'PLAN_OVERDUE' ? current.anchorId : null,
            current.sourceKey,
            current.digest,
            JSON.stringify(current),
            c.decision,
            current.caseId,
            a.membershipId,
            a.now,
          ],
        );
      } else {
        const [stored] = await this.rows(
          'SELECT *,revision::text,rule_revision::text FROM zhiban_risk.reviews WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
          [a.tenantId, o, c.id],
        );
        requireAcademic(stored, 'NOT_FOUND');
        requireAcademic(stored.revision === c.revision, 'CONFLICT');
        current = await this.observe(a, o, this.ref(stored));
        requireAcademic(current.digest === c.expectedDigest, 'CONFLICT');
        let caseId = stored.case_id,
          decision = stored.decision;
        if (c.type === 'AMEND_REVIEW') {
          if (c.decision === 'SUPPORT')
            requireAcademic(current.matched && current.sourceKey === stored.source_key, 'CONFLICT');
          decision = c.decision;
        } else {
          requireAcademic(
            stored.decision === 'SUPPORT' &&
              current.matched &&
              current.sourceKey === stored.source_key,
            'CONFLICT',
          );
          const linked = await this.link(a, o, current, stored.id, c.body);
          caseId = linked.id;
        }
        [r] = await this.rows(
          'UPDATE zhiban_risk.reviews SET decision=$3,case_id=$4,revision=revision+1,updated_at=$5 WHERE tenant_id=$1 AND id=$2 RETURNING id,decision,revision::text,case_id',
          [a.tenantId, stored.id, decision, caseId, a.now],
        );
      }
      await this.client.query(
        'INSERT INTO zhiban_risk.events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          a.tenantId,
          r.id,
          v7(),
          c.type,
          r.decision,
          r.revision,
          c.body,
          JSON.stringify({ ...current, asOf: a.now }),
          a.membershipId,
          a.now,
        ],
      );
      result = { id: r.id, decision: r.decision, revision: r.revision, caseId: r.case_id };
    }
    await this.client.query('INSERT INTO zhiban_risk.commands VALUES($1,$2,$3,$4,$5,$6,$7)', [
      a.tenantId,
      key,
      a.membershipId,
      o,
      digest,
      JSON.stringify(result),
      a.now,
    ]);
    return result;
  }
}
