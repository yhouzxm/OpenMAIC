import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import {
  evidenceDigest,
  type EvidenceRef,
  type LearnerCommand,
  type ObservationText,
} from '../../../domain/learner/model';
import type { LearnerQuery, LearnerTransaction } from '../../../application/learner/service';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
import { learnerSources } from './sources';
type Row = Record<string, unknown>;
type Sample = { kind: string; id: string; snapshot: Row; eligible: boolean; digest: string };
export class LearnerPgTransaction implements LearnerTransaction {
  constructor(private readonly client: PoolClient) {}
  private async rows(sql: string, args: unknown[]) {
    return (await this.client.query<Row>(sql, args)).rows;
  }
  private args(a: AcademicActor, o: string, enrollment: unknown) {
    return [a.tenantId, o, enrollment, a.now];
  }
  private sample(r: Row): Sample {
    const data = {
      kind: String(r.kind),
      id: String(r.id),
      snapshot: r.snapshot as Row,
      eligible: r.eligible === true,
    };
    return { ...data, digest: evidenceDigest(data) };
  }
  private async enrollment(
    a: AcademicActor,
    o: string,
    id: unknown,
    student = false,
    active = true,
  ) {
    const [e] = await this.rows(
      `SELECT e.*,coalesce(p.display_name,'历史成员') AS student_name FROM zhiban_academic.enrollments e LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id WHERE e.tenant_id=$1 AND e.offering_id=$2 AND e.id=$3 AND ($4::uuid IS NULL OR e.membership_id=$4) ${active ? "AND e.status='ACTIVE' AND e.valid_from<=$5 AND e.valid_until IS NULL" : 'AND $5::bigint IS NOT NULL'} FOR SHARE OF e`,
      [a.tenantId, o, id, student ? a.membershipId : null, a.now],
    );
    requireAcademic(e, 'FORBIDDEN');
    return e;
  }
  private async source(
    a: AcademicActor,
    o: string,
    enrollment: unknown,
    ref: Pick<EvidenceRef, 'kind' | 'id'>,
    lock = false,
  ): Promise<Sample> {
    if (lock) {
      if (ref.kind === 'GRADE' || ref.kind === 'CONCEPT') {
        const [anchor] = await this.rows(
          ref.kind === 'CONCEPT'
            ? 'SELECT activity_id,activity_version,attempt_id FROM zhiban_concept.corrections WHERE tenant_id=$1 AND offering_id=$2 AND enrollment_id=$3 AND id=$4 FOR SHARE'
            : 'SELECT t.activity_id,t.activity_version,t.id AS attempt_id FROM zhiban_assessment.publications p JOIN zhiban_learning.submissions s ON s.tenant_id=p.tenant_id AND s.id=p.submission_id JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id WHERE p.tenant_id=$1 AND t.offering_id=$2 AND t.enrollment_id=$3 AND p.id=$4',
          [a.tenantId, o, enrollment, ref.id],
        );
        requireAcademic(anchor, 'NOT_FOUND');
        await this.rows(
          'SELECT id FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2 FOR SHARE',
          [a.tenantId, anchor.activity_id],
        );
        await this.rows(
          'SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND (id=$2 OR id=(SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND enrollment_id=$3 AND activity_id=$4 AND activity_version=$5 ORDER BY attempt_no DESC LIMIT 1)) ORDER BY id FOR SHARE',
          [a.tenantId, anchor.attempt_id, enrollment, anchor.activity_id, anchor.activity_version],
        );
      } else
        await this.rows(
          'SELECT id FROM zhiban_remediation.plans WHERE tenant_id=$1 AND offering_id=$2 AND enrollment_id=$3 AND id=$4 FOR SHARE',
          [a.tenantId, o, enrollment, ref.id],
        );
    }
    const [r] = await this.rows(learnerSources + 'SELECT * FROM sources WHERE kind=$5 AND id=$6', [
      ...this.args(a, o, enrollment),
      ref.kind,
      ref.id,
    ]);
    requireAcademic(r, 'NOT_FOUND');
    return this.sample(r);
  }
  /** Shared whitelist and source locks for EMA; no answers/private notes leave this boundary. */
  async capture(a: AcademicActor, o: string, enrollmentId: string, refs: EvidenceRef[]) {
    await new LearningPgTransaction(this.client).access(a, o, 'TEACHER');
    const enrollment = await this.enrollment(a, o, enrollmentId);
    return {
      enrollmentId,
      membershipId: String(enrollment.membership_id),
      samples: await this.validated(a, o, enrollmentId, refs),
    };
  }
  private async citations(a: AcademicActor, p: Row) {
    return this.rows(
      'SELECT kind,source_id AS id,digest,snapshot,position FROM zhiban_learner.citations WHERE tenant_id=$1 AND note_id=$2 AND revision=$3 ORDER BY position',
      [a.tenantId, p.id, p.content_revision],
    );
  }
  private async current(a: AcademicActor, o: string, p: Row, lock = false) {
    const refs = await this.citations(a, p),
      current: Record<string, unknown>[] = [];
    for (const r of refs) {
      const now = await this.source(
        a,
        o,
        p.enrollment_id,
        { kind: r.kind as EvidenceRef['kind'], id: String(r.id) },
        lock,
      );
      current.push({
        kind: r.kind,
        id: r.id,
        original: r.snapshot,
        originalDigest: r.digest,
        current: now.snapshot,
        digest: now.digest,
        eligible: now.eligible,
        unchanged: r.digest === now.digest,
      });
    }
    return {
      citations: current,
      digest: evidenceDigest(current),
      fresh: current.length > 0 && current.every((r) => r.eligible && r.unchanged),
    };
  }
  private async validated(a: AcademicActor, o: string, enrollment: unknown, refs: EvidenceRef[]) {
    const samples: Sample[] = [];
    for (const r of [...refs].sort((x, y) =>
      (x.kind + ':' + x.id).localeCompare(y.kind + ':' + y.id),
    )) {
      const sample = await this.source(a, o, enrollment, r, true);
      requireAcademic(sample.eligible && sample.digest === r.digest, 'CONFLICT');
      samples.push(sample);
    }
    return refs.map((r) => samples.find((s) => s.kind === r.kind && s.id === r.id)!);
  }
  private async snapshot(a: AcademicActor, p: Row) {
    return {
      id: p.id,
      revision: String(p.revision),
      contentRevision: String(p.content_revision),
      state: p.state,
      title: p.title,
      body: p.body,
      confidence: p.confidence,
      citations: (await this.citations(a, p)).map((r) => ({
        kind: r.kind,
        id: r.id,
        digest: r.digest,
        snapshot: r.snapshot,
      })),
    };
  }
  private async event(a: AcademicActor, p: Row, action: string, body: string) {
    await this.client.query(
      'INSERT INTO zhiban_learner.events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        a.tenantId,
        p.id,
        v7(),
        p.revision,
        action,
        p.state,
        body,
        JSON.stringify(await this.snapshot(a, p)),
        a.membershipId,
        a.now,
      ],
    );
  }
  private async saveCitations(a: AcademicActor, p: Row, sources: Sample[]) {
    for (const [i, s] of sources.entries())
      await this.client.query(
        'INSERT INTO zhiban_learner.citations(tenant_id,note_id,revision,position,kind,publication_id,concept_id,plan_id,digest,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          a.tenantId,
          p.id,
          p.content_revision,
          i + 1,
          s.kind,
          s.kind === 'GRADE' ? s.id : null,
          s.kind === 'CONCEPT' ? s.id : null,
          s.kind === 'REMEDIATION' ? s.id : null,
          s.digest,
          JSON.stringify(s.snapshot),
        ],
      );
  }
  private async revise(
    a: AcademicActor,
    o: string,
    p: Row,
    text: ObservationText,
    action: string,
    reason: string,
  ) {
    await this.enrollment(a, o, p.enrollment_id);
    const sources = await this.validated(a, o, p.enrollment_id, text.evidence);
    const [next] = await this.rows(
      "UPDATE zhiban_learner.observations SET title=$3,body=$4,confidence=$5,revision=revision+1,content_revision=revision+1,published_revision=CASE WHEN state='DRAFT' THEN NULL ELSE revision+1 END,updated_at=$6 WHERE tenant_id=$1 AND id=$2 RETURNING *,revision::text,content_revision::text,published_revision::text",
      [a.tenantId, p.id, text.title, text.body, text.confidence, a.now],
    );
    await this.saveCitations(a, next, sources);
    await this.event(a, next, action, reason);
    return next;
  }
  private async withdraw(a: AcademicActor, p: Row, action: string, body: string) {
    requireAcademic(p.state === 'PUBLISHED', 'INVALID_STATE');
    const [next] = await this.rows(
      "UPDATE zhiban_learner.observations SET state='WITHDRAWN',revision=revision+1,updated_at=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *,revision::text,content_revision::text,published_revision::text",
      [a.tenantId, p.id, a.now],
    );
    await this.event(a, next, action, body);
    return next;
  }
  async read(a: AcademicActor, o: string, q: LearnerQuery) {
    const access = await new LearningPgTransaction(this.client).access(a, o, q.mode),
      student = q.mode === 'STUDENT';
    if (q.view === 'ROSTER') {
      const rows = await this.rows(
        "SELECT e.id,e.membership_id,coalesce(p.display_name,'未命名学生') AS student_name FROM zhiban_academic.enrollments e LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id WHERE e.tenant_id=$1 AND e.offering_id=$2 AND e.status='ACTIVE' AND e.valid_from<=$3 AND e.valid_until IS NULL AND ($4='' OR strpos(lower(coalesce(p.display_name,'')),lower($4))>0 OR e.membership_id::text=$4) AND ($5::uuid IS NULL OR e.id<$5) ORDER BY e.id DESC LIMIT 21",
        [a.tenantId, o, a.now, q.q, q.after],
      );
      return { rows: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null };
    }
    let note: Row | undefined, dispute: Row | undefined;
    if (q.view === 'NOTE' || q.view === 'DISPUTE') {
      if (q.view === 'DISPUTE') {
        [dispute] = await this.rows(
          'SELECT *,revision::text,target_revision::text FROM zhiban_learner.disputes WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND ($4::uuid IS NULL OR membership_id=$4) FOR SHARE',
          [a.tenantId, o, q.id, student ? a.membershipId : null],
        );
        requireAcademic(dispute, 'NOT_FOUND');
      }
      [note] = await this.rows(
        'SELECT *,revision::text,content_revision::text,published_revision::text FROM zhiban_learner.observations WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND ($4::uuid IS NULL OR (membership_id=$4 AND published_revision IS NOT NULL)) FOR SHARE',
        [a.tenantId, o, dispute?.note_id ?? q.id, student ? a.membershipId : null],
      );
      requireAcademic(note, 'NOT_FOUND');
    }
    const e = await this.enrollment(
      a,
      o,
      note?.enrollment_id ?? (student ? access.enrollmentId : q.enrollmentId),
      student,
      student || !note,
    );
    const common = {
      enrollment: { id: e.id, studentName: e.student_name },
      dimensionStatus: 'DESCRIPTIVE_EVIDENCE',
      asOf: a.now,
    };
    if (q.view === 'OVERVIEW') {
      const rows = await this.rows(
        learnerSources +
          'SELECT kind,count(*)::integer AS count FROM sources WHERE eligible GROUP BY kind ORDER BY kind',
        this.args(a, o, e.id),
      );
      const [counts] = await this.rows(
        "SELECT count(*) FILTER(WHERE state='PUBLISHED')::integer AS published,count(*) FILTER(WHERE state='WITHDRAWN')::integer AS withdrawn FROM zhiban_learner.observations WHERE tenant_id=$1 AND offering_id=$2 AND enrollment_id=$3",
        [a.tenantId, o, e.id],
      );
      return { ...common, rows, next: null, observations: counts };
    }
    if (q.view === 'EVIDENCE') {
      const after = q.after ? JSON.parse(Buffer.from(q.after, 'base64url').toString('utf8')) : null;
      const rows = await this.rows(
        learnerSources +
          `SELECT * FROM sources WHERE eligible AND ($5='ALL' OR kind=$5) AND ($6='' OR strpos(lower(snapshot->>'title'),lower($6))>0) AND ($7::jsonb IS NULL OR (kind,id::text)>(($7::jsonb->>0),($7::jsonb->>1))) ORDER BY kind,id LIMIT 21`,
        [...this.args(a, o, e.id), q.kind, q.q, after ? JSON.stringify(after) : null],
      );
      return {
        ...common,
        rows: rows.slice(0, 20).map((r) => this.sample(r)),
        next:
          rows.length > 20
            ? Buffer.from(JSON.stringify([rows[19].kind, rows[19].id])).toString('base64url')
            : null,
      };
    }
    if (q.view === 'NOTES') {
      const rows = await this.rows(
        `SELECT *,revision::text,content_revision::text,published_revision::text FROM zhiban_learner.observations WHERE tenant_id=$1 AND offering_id=$2 AND enrollment_id=$3 ${student ? 'AND published_revision IS NOT NULL' : ''} AND ($4='ALL' OR state=$4) AND ($5='' OR strpos(lower(title),lower($5))>0) AND ($6::uuid IS NULL OR id<$6) ORDER BY id DESC LIMIT 21`,
        [a.tenantId, o, e.id, q.state, q.q, q.after],
      );
      const page = [];
      for (const p of rows.slice(0, 20)) page.push({ ...p, evidence: await this.current(a, o, p) });
      return { ...common, rows: page, next: rows.length > 20 ? String(rows[19].id) : null };
    }
    if (q.view === 'DISPUTES') {
      const rows = await this.rows(
        "SELECT d.id,d.note_id,d.target_revision::text,d.revision::text,d.state,d.created_at,d.updated_at,n.title FROM zhiban_learner.disputes d JOIN zhiban_learner.observations n ON n.tenant_id=d.tenant_id AND n.id=d.note_id WHERE d.tenant_id=$1 AND d.offering_id=$2 AND d.enrollment_id=$3 AND ($4='ALL' OR d.state=$4) AND ($5::uuid IS NULL OR d.id<$5) ORDER BY d.id DESC LIMIT 21",
        [a.tenantId, o, e.id, q.state, q.after],
      );
      return {
        ...common,
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? String(rows[19].id) : null,
      };
    }
    requireAcademic(note, 'NOT_FOUND');
    const evidence = await this.current(a, o, note, true);
    if (dispute) {
      const rows = await this.rows(
        "SELECT d.id,d.action,d.outcome,d.body,d.desired,d.note_snapshot,d.revision::text,d.created_at,coalesce(p.display_name,'历史成员') AS actor_name FROM zhiban_learner.dispute_events d LEFT JOIN zhiban_academic.people p ON p.tenant_id=d.tenant_id AND p.membership_id=d.actor_id WHERE d.tenant_id=$1 AND d.dispute_id=$2 AND ($3::uuid IS NULL OR d.id<$3) ORDER BY d.id DESC LIMIT 21",
        [a.tenantId, dispute.id, q.after],
      );
      return {
        ...common,
        record: dispute,
        note,
        evidence,
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? String(rows[19].id) : null,
      };
    }
    const rows = await this.rows(
      `SELECT n.id,n.action,n.body,n.state,n.snapshot,n.revision::text,n.created_at,coalesce(p.display_name,'历史成员') AS actor_name FROM zhiban_learner.events n LEFT JOIN zhiban_academic.people p ON p.tenant_id=n.tenant_id AND p.membership_id=n.actor_id WHERE n.tenant_id=$1 AND n.note_id=$2 ${student ? "AND n.action NOT IN('CREATE_OBSERVATION','EDIT_DRAFT')" : ''} AND ($3::uuid IS NULL OR n.id<$3) ORDER BY n.id DESC LIMIT 21`,
      [a.tenantId, note.id, q.after],
    );
    const [open] = await this.rows(
      "SELECT id,revision::text FROM zhiban_learner.disputes WHERE tenant_id=$1 AND note_id=$2 AND state='OPEN'",
      [a.tenantId, note.id],
    );
    return {
      ...common,
      record: note,
      evidence,
      openDispute: open ?? null,
      rows: rows.slice(0, 20),
      next: rows.length > 20 ? String(rows[19].id) : null,
    };
  }
  async execute(a: AcademicActor, o: string, c: LearnerCommand, key: string) {
    const student = c.type === 'OPEN_DISPUTE' || c.type === 'APPEND_DISPUTE';
    const access = await new LearningPgTransaction(this.client).access(
      a,
      o,
      student ? 'STUDENT' : 'TEACHER',
    );
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `learner-command:${a.tenantId}:${key}`,
    ]);
    let note: Row | undefined, dispute: Row | undefined;
    if (c.type !== 'CREATE_OBSERVATION') {
      if (c.type === 'APPEND_DISPUTE' || c.type === 'RESOLVE_DISPUTE') {
        [dispute] = await this.rows(
          'SELECT *,revision::text FROM zhiban_learner.disputes WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND ($4::uuid IS NULL OR membership_id=$4) FOR UPDATE',
          [a.tenantId, o, c.id, student ? a.membershipId : null],
        );
        requireAcademic(dispute, 'NOT_FOUND');
      }
      [note] = await this.rows(
        'SELECT *,revision::text,content_revision::text,published_revision::text FROM zhiban_learner.observations WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND ($4::uuid IS NULL OR (membership_id=$4 AND published_revision IS NOT NULL)) FOR UPDATE',
        [a.tenantId, o, dispute?.note_id ?? c.id, student ? a.membershipId : null],
      );
      requireAcademic(note, 'NOT_FOUND');
      if (
        student ||
        c.type === 'PUBLISH_OBSERVATION' ||
        c.type === 'REVISE_PUBLIC' ||
        (c.type === 'RESOLVE_DISPUTE' && c.outcome !== 'WITHDRAW')
      )
        await this.enrollment(a, o, note.enrollment_id, student);
      if (student) requireAcademic(note.enrollment_id === access.enrollmentId, 'FORBIDDEN');
    }
    const digest = evidenceDigest([o, c]);
    const [prior] = await this.rows(
      'SELECT offering_id,actor_id,payload_digest,result FROM zhiban_learner.commands WHERE tenant_id=$1 AND command_key=$2',
      [a.tenantId, key],
    );
    if (prior) {
      requireAcademic(
        prior.offering_id === o &&
          prior.actor_id === a.membershipId &&
          prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result;
    }
    let result: Row;
    if (c.type === 'CREATE_OBSERVATION') {
      const e = await this.enrollment(a, o, c.enrollmentId),
        sources = await this.validated(a, o, e.id, c.evidence);
      [note] = await this.rows(
        "INSERT INTO zhiban_learner.observations VALUES($1,$2,$3,$4,$5,'DRAFT',1,1,NULL,$6,$7,$8,$9,$10,$10) RETURNING *,revision::text,content_revision::text,published_revision::text",
        [
          a.tenantId,
          o,
          v7(),
          e.id,
          e.membership_id,
          c.title,
          c.body,
          c.confidence,
          a.membershipId,
          a.now,
        ],
      );
      await this.saveCitations(a, note, sources);
      await this.event(a, note, c.type, '');
      result = { id: note.id, revision: note.revision, state: note.state };
    } else {
      requireAcademic(note, 'NOT_FOUND');
      if (dispute) {
        requireAcademic(dispute.revision === c.revision, 'CONFLICT');
        requireAcademic(dispute.state === 'OPEN', 'INVALID_STATE');
        let outcome: string | null = null,
          body: string,
          desired: string | null = null;
        if (c.type === 'APPEND_DISPUTE') {
          body = c.body;
          desired = c.desired;
        } else {
          requireAcademic(c.type === 'RESOLVE_DISPUTE');
          requireAcademic(note.revision === c.noteRevision, 'CONFLICT');
          outcome = c.outcome;
          body = c.response;
          if (c.outcome === 'KEEP') {
            requireAcademic(note.state === 'PUBLISHED', 'INVALID_STATE');
            const current = await this.current(a, o, note, true);
            requireAcademic(current.fresh && current.digest === c.expectedDigest, 'CONFLICT');
          } else if (c.outcome === 'REVISE') {
            requireAcademic(note.state === 'PUBLISHED', 'INVALID_STATE');
            note = await this.revise(a, o, note, c.replacement, 'DISPUTE_REVISE', c.response);
          } else if (note.state !== 'WITHDRAWN')
            note = await this.withdraw(a, note, 'DISPUTE_WITHDRAW', c.response);
        }
        const [next] = await this.rows(
          'UPDATE zhiban_learner.disputes SET state=$3,revision=revision+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2 RETURNING id,state,revision::text',
          [a.tenantId, dispute.id, c.type === 'RESOLVE_DISPUTE' ? 'RESOLVED' : 'OPEN', a.now],
        );
        await this.client.query(
          'INSERT INTO zhiban_learner.dispute_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            a.tenantId,
            next.id,
            v7(),
            next.revision,
            c.type,
            outcome,
            body,
            desired,
            JSON.stringify(await this.snapshot(a, note)),
            a.membershipId,
            a.now,
          ],
        );
        result = { ...next, noteId: note.id, noteRevision: note.revision };
      } else {
        requireAcademic(note.revision === c.revision, 'CONFLICT');
        if (c.type === 'OPEN_DISPUTE') {
          requireAcademic(note.state === 'PUBLISHED', 'INVALID_STATE');
          const snap = await this.snapshot(a, note);
          const [d] = await this.rows(
            "INSERT INTO zhiban_learner.disputes VALUES($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',1,$9,$9) RETURNING id,state,revision::text",
            [
              a.tenantId,
              o,
              v7(),
              note.id,
              note.enrollment_id,
              note.membership_id,
              note.revision,
              JSON.stringify(snap),
              a.now,
            ],
          );
          await this.client.query(
            "INSERT INTO zhiban_learner.dispute_events VALUES($1,$2,$3,1,'OPEN_DISPUTE',NULL,$4,$5,$6,$7,$8)",
            [
              a.tenantId,
              d.id,
              v7(),
              c.body,
              c.desired,
              JSON.stringify(snap),
              a.membershipId,
              a.now,
            ],
          );
          result = { ...d, noteId: note.id, noteRevision: note.revision };
        } else {
          if (c.type === 'EDIT_DRAFT' || c.type === 'REVISE_PUBLIC') {
            requireAcademic(
              note.state === (c.type === 'EDIT_DRAFT' ? 'DRAFT' : 'PUBLISHED'),
              'INVALID_STATE',
            );
            note = await this.revise(a, o, note, c, c.type, c.reason);
          } else if (c.type === 'PUBLISH_OBSERVATION') {
            requireAcademic(note.state === 'DRAFT', 'INVALID_STATE');
            const current = await this.current(a, o, note, true);
            requireAcademic(current.fresh && current.digest === c.expectedDigest, 'CONFLICT');
            [note] = await this.rows(
              "UPDATE zhiban_learner.observations SET state='PUBLISHED',revision=revision+1,published_revision=revision+1,updated_at=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *,revision::text,content_revision::text,published_revision::text",
              [a.tenantId, note.id, a.now],
            );
            await this.event(a, note, c.type, '');
          } else if (c.type === 'WITHDRAW_OBSERVATION')
            note = await this.withdraw(a, note, c.type, c.body);
          else requireAcademic(false);
          result = { id: note.id, revision: note.revision, state: note.state };
        }
      }
    }
    await this.client.query('INSERT INTO zhiban_learner.commands VALUES($1,$2,$3,$4,$5,$6,$7)', [
      a.tenantId,
      key,
      o,
      a.membershipId,
      digest,
      JSON.stringify(result),
      a.now,
    ]);
    return result;
  }
}
