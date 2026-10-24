import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import {
  academicAdmin,
  academicStudent,
  requireAcademic,
  type AcademicActor,
} from '../../../domain/academic/model';
import type { AttainmentCommand } from '../../../domain/attainment/model';
import { evidenceDigest } from '../../../domain/concept/model';
import { FinalgradePgTransaction } from '../../finalgrade/postgres/transaction';
import { progressBarrier } from '../../curriculum/postgres/progress';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
type Row = Record<string, unknown>;
export type AttainmentQuery = {
  mode: 'ADMIN' | 'TEACHER' | 'STUDENT';
  view: 'RECORDS' | 'RULES' | 'TOTAL' | 'DETAIL' | 'COURSES' | 'OFFERINGS';
  offering: string | null;
  member: string | null;
  id: string | null;
  q: string;
  after: string | null;
};
export class AttainmentPgTransaction {
  private readonly final: FinalgradePgTransaction;
  constructor(
    private readonly db: PoolClient,
    private readonly recipient: (m: string) => Promise<void>,
  ) {
    this.final = new FinalgradePgTransaction(db, recipient);
  }
  private async rows(sql: string, args: unknown[]) {
    return (await this.db.query<Row>(sql, args)).rows;
  }
  private async access(a: AcademicActor, q: AttainmentQuery) {
    if (q.mode === 'ADMIN') requireAcademic(academicAdmin(a), 'FORBIDDEN');
    else if (q.mode === 'STUDENT') requireAcademic(academicStudent(a), 'FORBIDDEN');
    else {
      requireAcademic(q.offering);
      await progressBarrier(this.db, a, q.offering);
      await new LearningPgTransaction(this.db).access(a, q.offering, 'TEACHER');
    }
  }
  private async checkSource(a: AcademicActor, p: Row) {
    const e = await this.final.attestation(
      a,
      String(p.source_offering ?? p.offering_id),
      String(p.membership_id),
    );
    return {
      current: e.current && e.latest?.id === p.total_id && e.sourceDigest === p.source_digest,
      latestTotalId: e.latest?.id ?? null,
    };
  }
  async read(a: AcademicActor, q: AttainmentQuery) {
    await this.access(a, q);
    const self = q.mode === 'STUDENT',
      admin = q.mode === 'ADMIN';
    if (q.view === 'COURSES' || q.view === 'OFFERINGS') {
      requireAcademic(admin, 'FORBIDDEN');
      const rows = await this.rows(
        q.view === 'COURSES'
          ? "SELECT id,name FROM zhiban_academic.courses WHERE tenant_id=$1 AND status='PUBLISHED' AND ($2='' OR strpos(lower(name),lower($2))>0) AND ($3::uuid IS NULL OR id<$3) ORDER BY id DESC LIMIT 21"
          : "SELECT id,name,course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND ($2='' OR strpos(lower(name),lower($2))>0) AND ($3::uuid IS NULL OR id<$3) ORDER BY id DESC LIMIT 21",
        [a.tenantId, q.q, q.after],
      );
      return { rows: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null };
    }
    if (q.view === 'RULES') {
      const cert = q.offering
        ? ((
            await this.rows(
              'SELECT *,revision::text FROM zhiban_attainment.cert_rules WHERE tenant_id=$1 AND offering_id=$2',
              [a.tenantId, q.offering],
            )
          )[0] ?? null)
        : null;
      const rows = admin
        ? await this.rows(
            'SELECT r.*,r.revision::text,s.name AS source_name,t.name AS target_name FROM zhiban_attainment.credit_rules r JOIN zhiban_academic.courses s ON s.tenant_id=r.tenant_id AND s.id=r.source_course JOIN zhiban_academic.courses t ON t.tenant_id=r.tenant_id AND t.id=r.target_course WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR r.id<$2) ORDER BY r.id DESC LIMIT 21',
            [a.tenantId, q.after],
          )
        : [];
      return {
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? String(rows[19].id) : null,
        certificateRule: cert,
      };
    }
    if (q.view === 'TOTAL') {
      requireAcademic(!self && q.offering && q.member, 'FORBIDDEN');
      const evidence = await this.final.attestation(a, q.offering, q.member);
      const cert =
        (
          await this.rows(
            'SELECT *,revision::text FROM zhiban_attainment.cert_rules WHERE tenant_id=$1 AND offering_id=$2',
            [a.tenantId, q.offering],
          )
        )[0] ?? null;
      return { rows: [], next: null, evidence, certificateRule: cert };
    }
    let certificates: Row[], credits: Row[];
    if (q.view === 'DETAIL') {
      requireAcademic(q.id);
      certificates = await this.rows(
        'SELECT *,revision::text FROM zhiban_attainment.certificates WHERE tenant_id=$1 AND id=$2 AND ($3::uuid IS NULL OR membership_id=$3) AND ($4::uuid IS NULL OR offering_id=$4)',
        [
          a.tenantId,
          q.id,
          self ? a.membershipId : q.member,
          q.mode === 'TEACHER' ? q.offering : null,
        ],
      );
      credits =
        admin || self
          ? await this.rows(
              'SELECT *,revision::text FROM zhiban_attainment.credits WHERE tenant_id=$1 AND id=$2 AND ($3::uuid IS NULL OR membership_id=$3)',
              [a.tenantId, q.id, self ? a.membershipId : q.member],
            )
          : [];
      requireAcademic(certificates.length + credits.length === 1, 'NOT_FOUND');
    } else {
      certificates = await this.rows(
        'SELECT *,revision::text FROM zhiban_attainment.certificates WHERE tenant_id=$1 AND ($2::uuid IS NULL OR membership_id=$2) AND ($3::uuid IS NULL OR offering_id=$3) AND ($4::uuid IS NULL OR id<$4) ORDER BY id DESC LIMIT 21',
        [a.tenantId, self ? a.membershipId : q.member, q.offering, q.after],
      );
      credits =
        admin || self
          ? await this.rows(
              'SELECT *,revision::text FROM zhiban_attainment.credits WHERE tenant_id=$1 AND ($2::uuid IS NULL OR membership_id=$2) AND ($3::uuid IS NULL OR id<$3) ORDER BY id DESC LIMIT 21',
              [a.tenantId, self ? a.membershipId : q.member, q.after],
            )
          : [];
    }
    const merged: Row[] = [
        ...certificates.map<Row>((r) => ({ ...r, kind: 'CERTIFICATE' })),
        ...credits.map<Row>((r) => ({ ...r, kind: 'CREDIT' })),
      ].sort((x, y) => String(y.id).localeCompare(String(x.id))),
      rows = [];
    for (const o of [
      ...new Set(merged.slice(0, 20).map((p) => String(p.source_offering ?? p.offering_id))),
    ].sort())
      await progressBarrier(this.db, a, o);
    for (const p of merged.slice(0, 20)) {
      const history = await this.rows(
        `SELECT e.action,e.reason,e.created_at,coalesce(n.display_name,'历史成员') AS actor_name FROM zhiban_attainment.events e LEFT JOIN zhiban_academic.people n ON n.tenant_id=e.tenant_id AND n.membership_id=e.actor_id WHERE e.tenant_id=$1 AND e.target_id=$2 ORDER BY e.id DESC LIMIT 20`,
        [a.tenantId, p.id],
      );
      rows.push({ ...p, history, source: await this.checkSource(a, p) });
    }
    return { rows, next: merged.length > 20 ? String(merged[19].id) : null };
  }
  async execute(a: AcademicActor, c: AttainmentCommand, key: string) {
    const admin = academicAdmin(a);
    if (['SET_CREDIT_RULE', 'AWARD_CREDIT', 'REVOKE_CREDIT'].includes(c.type))
      requireAcademic(admin, 'FORBIDDEN');
    if ('offeringId' in c) {
      await progressBarrier(this.db, a, c.offeringId);
      if (!admin) await new LearningPgTransaction(this.db).access(a, c.offeringId, 'TEACHER');
    }
    if (c.type === 'REVOKE_CERT' && !admin) {
      const [p] = await this.rows(
        'SELECT offering_id FROM zhiban_attainment.certificates WHERE tenant_id=$1 AND id=$2',
        [a.tenantId, c.id],
      );
      requireAcademic(p, 'NOT_FOUND');
      await progressBarrier(this.db, a, String(p.offering_id));
      await new LearningPgTransaction(this.db).access(a, String(p.offering_id), 'TEACHER');
    }
    await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `attainment:${a.tenantId}:${key}`,
    ]);
    const digest = evidenceDigest(c),
      [prior] = await this.rows(
        'SELECT * FROM zhiban_attainment.commands WHERE tenant_id=$1 AND command_key=$2',
        [a.tenantId, key],
      );
    if (prior) {
      requireAcademic(
        prior.actor_id === a.membershipId && prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result as Row;
    }
    let result: Row, revision: string, target: string, snapshot: unknown;
    if (c.type === 'SET_CERT_RULE') {
      await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `cert-rule:${a.tenantId}:${c.offeringId}`,
      ]);
      const [old] = await this.rows(
        'SELECT *,revision::text FROM zhiban_attainment.cert_rules WHERE tenant_id=$1 AND offering_id=$2 FOR UPDATE',
        [a.tenantId, c.offeringId],
      );
      requireAcademic((old?.revision ?? '1') === c.revision, 'CONFLICT');
      revision = String(BigInt(c.revision) + BigInt(1));
      target = c.offeringId;
      if (old)
        await this.db.query(
          'UPDATE zhiban_attainment.cert_rules SET revision=$3,title=$4,threshold=$5,enabled=$6,updated_by=$7,updated_at=$8 WHERE tenant_id=$1 AND offering_id=$2',
          [
            a.tenantId,
            c.offeringId,
            revision,
            c.title,
            c.threshold,
            c.enabled,
            a.membershipId,
            a.now,
          ],
        );
      else
        await this.db.query(
          'INSERT INTO zhiban_attainment.cert_rules VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            a.tenantId,
            c.offeringId,
            revision,
            c.title,
            c.threshold,
            c.enabled,
            a.membershipId,
            a.now,
          ],
        );
      result = { offeringId: target, revision };
      snapshot = c;
    } else if (c.type === 'SET_CREDIT_RULE') {
      await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `credit-rule:${a.tenantId}:${c.id}`,
      ]);
      const courses = await this.rows(
        "SELECT id FROM zhiban_academic.courses WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='PUBLISHED' ORDER BY id FOR SHARE",
        [a.tenantId, [...new Set([c.sourceCourse, c.targetCourse])]],
      );
      requireAcademic(
        courses.length === new Set([c.sourceCourse, c.targetCourse]).size,
        'NOT_FOUND',
      );
      const [old] = await this.rows(
        'SELECT *,revision::text FROM zhiban_attainment.credit_rules WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [a.tenantId, c.id],
      );
      requireAcademic((old?.revision ?? '1') === c.revision, 'CONFLICT');
      if (old)
        requireAcademic(
          old.source_course === c.sourceCourse && old.target_course === c.targetCourse,
          'CONFLICT',
        );
      revision = String(BigInt(c.revision) + BigInt(1));
      target = c.id;
      if (old)
        await this.db.query(
          'UPDATE zhiban_attainment.credit_rules SET revision=$3,title=$4,credits_tenths=$5,threshold=$6,enabled=$7,updated_by=$8,updated_at=$9 WHERE tenant_id=$1 AND id=$2',
          [
            a.tenantId,
            c.id,
            revision,
            c.title,
            c.creditsTenths,
            c.threshold,
            c.enabled,
            a.membershipId,
            a.now,
          ],
        );
      else
        await this.db.query(
          'INSERT INTO zhiban_attainment.credit_rules VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            a.tenantId,
            c.id,
            revision,
            c.sourceCourse,
            c.targetCourse,
            c.title,
            c.creditsTenths,
            c.threshold,
            c.enabled,
            a.membershipId,
            a.now,
          ],
        );
      result = { id: target, revision };
      snapshot = c;
    } else if (c.type === 'REVOKE_CERT' || c.type === 'REVOKE_CREDIT') {
      const table = c.type === 'REVOKE_CERT' ? 'certificates' : 'credits';
      const [p] = await this.rows(
        `SELECT *,revision::text FROM zhiban_attainment.${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [a.tenantId, c.id],
      );
      requireAcademic(p, 'NOT_FOUND');
      requireAcademic(p.state === 'ACTIVE' && p.revision === c.revision, 'CONFLICT');
      revision = String(BigInt(c.revision) + BigInt(1));
      target = c.id;
      await this.db.query(
        `UPDATE zhiban_attainment.${table} SET state='REVOKED',revision=$3 WHERE tenant_id=$1 AND id=$2`,
        [a.tenantId, c.id, revision],
      );
      result = { id: target, revision, state: 'REVOKED' };
      snapshot = p;
    } else {
      requireAcademic(c.type === 'ISSUE_CERT' || c.type === 'AWARD_CREDIT');
      await this.recipient(c.memberId);
      const e = await this.final.attestation(a, c.offeringId, c.memberId);
      requireAcademic(
        e.current && e.latest?.id === c.totalId && e.sourceDigest === c.sourceDigest,
        'CONFLICT',
      );
      await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `attainment-member:${a.tenantId}:${c.memberId}`,
      ]);
      const [rule] = await this.rows(
        c.type === 'ISSUE_CERT'
          ? 'SELECT *,revision::text FROM zhiban_attainment.cert_rules WHERE tenant_id=$1 AND offering_id=$2 FOR SHARE'
          : 'SELECT *,revision::text FROM zhiban_attainment.credit_rules WHERE tenant_id=$1 AND id=$2 FOR SHARE',
        [a.tenantId, c.type === 'ISSUE_CERT' ? c.offeringId : c.ruleId],
      );
      requireAcademic(
        rule &&
          rule.enabled &&
          rule.revision === c.ruleRevision &&
          Number(e.latest.score_points) >= Number(rule.threshold),
        'CONFLICT',
      );
      target = v7();
      revision = '1';
      snapshot = {
        rule,
        total: e.latest,
        studentName: e.studentName,
        courseName: e.offering.course_name,
        offeringName: e.offering.name,
        courseId: e.offering.course_id,
      };
      if (c.type === 'ISSUE_CERT')
        await this.db.query(
          "INSERT INTO zhiban_attainment.certificates(tenant_id,id,offering_id,membership_id,course_id,total_id,rule_revision,snapshot,source_digest,state,issued_by,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,$11)",
          [
            a.tenantId,
            target,
            c.offeringId,
            c.memberId,
            e.offering.course_id,
            c.totalId,
            c.ruleRevision,
            JSON.stringify(snapshot),
            c.sourceDigest,
            a.membershipId,
            a.now,
          ],
        );
      else {
        requireAcademic(rule.source_course === e.offering.course_id, 'CONFLICT');
        await this.db.query(
          "INSERT INTO zhiban_attainment.credits(tenant_id,id,membership_id,source_offering,source_course,target_course,rule_id,rule_revision,total_id,credits_tenths,source_digest,snapshot,state,issued_by,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACTIVE',$13,$14)",
          [
            a.tenantId,
            target,
            c.memberId,
            c.offeringId,
            e.offering.course_id,
            rule.target_course,
            c.ruleId,
            c.ruleRevision,
            c.totalId,
            rule.credits_tenths,
            c.sourceDigest,
            JSON.stringify(snapshot),
            a.membershipId,
            a.now,
          ],
        );
      }
      result = { id: target, revision, state: 'ACTIVE' };
    }
    await this.db.query('INSERT INTO zhiban_attainment.events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      a.tenantId,
      v7(),
      a.membershipId,
      c.type,
      target,
      revision,
      'reason' in c ? c.reason : '',
      JSON.stringify(snapshot),
      a.now,
    ]);
    await this.db.query('INSERT INTO zhiban_attainment.commands VALUES($1,$2,$3,$4,$5,$6)', [
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
