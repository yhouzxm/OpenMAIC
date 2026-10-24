import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import { evidenceDigest, type ConceptCommand } from '../../../domain/concept/model';
import type { ConceptQuery, ConceptTransaction } from '../../../application/concept/service';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
import { conceptSources } from './sources';
type Row = Record<string, unknown>;
export class ConceptPgTransaction implements ConceptTransaction {
  constructor(private readonly client: PoolClient) {}
  private async rows(sql: string, args: unknown[]) {
    return (await this.client.query<Row>(sql, args)).rows;
  }
  private sample(r: Row) {
    const { student_name: _name, ...facts } = r;
    return { ...facts, digest: evidenceDigest(facts) };
  }
  private async source(a: AcademicActor, o: string, publication: unknown, question: unknown) {
    const [anchor] = await this.rows(
      `SELECT t.activity_id,t.activity_version,t.id AS attempt_id,t.enrollment_id FROM zhiban_assessment.publications p JOIN zhiban_learning.submissions s ON s.tenant_id=p.tenant_id AND s.id=p.submission_id JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id WHERE p.tenant_id=$1 AND t.offering_id=$2 AND p.id=$3`,
      [a.tenantId, o, publication],
    );
    requireAcademic(anchor, 'NOT_FOUND');
    await this.rows(
      'SELECT id FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2 FOR SHARE',
      [a.tenantId, anchor.activity_id],
    );
    await this.rows(
      'SELECT activity_id FROM zhiban_learning.quiz_definitions WHERE tenant_id=$1 AND activity_id=$2 FOR SHARE',
      [a.tenantId, anchor.activity_id],
    );
    await this.rows(
      'SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2 FOR SHARE',
      [a.tenantId, anchor.enrollment_id],
    );
    // Lock original and newest attempts in stable order; grade/submission writers take UPDATE.
    await this.rows(
      `SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND (id=$2 OR id=(SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND enrollment_id=$3 AND activity_id=$4 AND activity_version=$5 ORDER BY attempt_no DESC LIMIT 1)) ORDER BY id FOR SHARE`,
      [
        a.tenantId,
        anchor.attempt_id,
        anchor.enrollment_id,
        anchor.activity_id,
        anchor.activity_version,
      ],
    );
    const [r] = await this.rows(conceptSources + 'SELECT * FROM samples WHERE question_id=$5', [
      a.tenantId,
      o,
      a.now,
      publication,
      question,
    ]);
    requireAcademic(r, 'NOT_FOUND');
    return this.sample(r);
  }
  private async activeEnrollment(a: AcademicActor, o: string, p: Row) {
    const [e] = await this.rows(
      "SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4 AND status='ACTIVE' AND valid_from<=$5 AND valid_until IS NULL FOR SHARE",
      [a.tenantId, o, p.enrollment_id, p.membership_id, a.now],
    );
    requireAcademic(e, 'FORBIDDEN');
  }
  async read(a: AcademicActor, o: string, q: ConceptQuery) {
    await new LearningPgTransaction(this.client).access(a, o, q.mode);
    const teacher = q.mode === 'TEACHER';
    if (q.view === 'SOURCES') {
      const after = q.after ? JSON.parse(Buffer.from(q.after, 'base64url').toString('utf8')) : null;
      const rows = await this.rows(
        conceptSources +
          `SELECT s.*,c.id AS correction_id FROM samples s LEFT JOIN zhiban_concept.corrections c ON c.tenant_id=$1 AND c.publication_id=s.publication_id AND c.question_id=s.question_id
   WHERE s.fresh AND s.item_points IS NOT NULL AND s.item_points<s.item_max AND ($5='' OR strpos(lower(s.title),lower($5))>0 OR strpos(lower(s.student_name),lower($5))>0 OR strpos(lower(coalesce(s.question->>'question','')),lower($5))>0)
   AND ($6::jsonb IS NULL OR (s.publication_id::text,s.question_id)>(($6::jsonb->>0),($6::jsonb->>1))) ORDER BY s.publication_id,s.question_id LIMIT 21`,
        [a.tenantId, o, a.now, null, q.q, after ? JSON.stringify(after) : null],
      );
      return {
        rows: rows.slice(0, 20).map((r) => {
          const { correction_id, ...source } = r;
          return { ...this.sample(source), student_name: r.student_name, correction_id };
        }),
        next:
          rows.length > 20
            ? Buffer.from(JSON.stringify([rows[19].publication_id, rows[19].question_id])).toString(
                'base64url',
              )
            : null,
      };
    }
    const rows = await this.rows(
      `SELECT c.*,c.revision::text,c.published_revision::text,coalesce(n.display_name,'历史成员') AS student_name FROM zhiban_concept.corrections c JOIN zhiban_academic.enrollments e ON e.tenant_id=c.tenant_id AND e.id=c.enrollment_id LEFT JOIN zhiban_academic.people n ON n.tenant_id=c.tenant_id AND n.membership_id=c.membership_id
   WHERE c.tenant_id=$1 AND c.offering_id=$2 AND ($3::uuid IS NULL OR (c.membership_id=$3 AND c.published_revision IS NOT NULL AND e.status='ACTIVE' AND e.valid_from<=$8 AND e.valid_until IS NULL))
   AND ($4::uuid IS NULL OR c.id=$4) AND ($5='ALL' OR c.state=$5) AND ($6='' OR strpos(lower(c.concept),lower($6))>0 ${teacher ? "OR strpos(lower(coalesce(n.display_name,'')),lower($6))>0" : ''})
   AND ($7::uuid IS NULL OR c.id<$7) ORDER BY c.id DESC LIMIT 21 ${q.id ? 'FOR SHARE OF c' : ''}`,
      [
        a.tenantId,
        o,
        teacher ? null : a.membershipId,
        q.id,
        q.state,
        q.q,
        q.id ? null : q.after,
        a.now,
      ],
    );
    const project = (r: Row) =>
      teacher
        ? r
        : {
            id: r.id,
            concept: r.concept,
            explanation: r.explanation,
            guidance: r.guidance,
            state: r.state,
            revision: r.revision,
            published_revision: r.published_revision,
            evidence: r.evidence,
            updated_at: r.updated_at,
          };
    if (q.view === 'LIST')
      return {
        rows: rows.slice(0, 20).map(project),
        next: rows.length > 20 ? String(rows[19].id) : null,
      };
    requireAcademic(rows.length === 1, 'NOT_FOUND');
    const p = rows[0];
    const current = await this.source(a, o, p.publication_id, p.question_id);
    const events = await this.rows(
      `SELECT e.id,e.revision::text,e.action,e.state,e.body,e.public_text,e.snapshot,e.created_at,coalesce(n.display_name,'历史成员') AS actor_name ${teacher ? ',e.private_note' : ''} FROM zhiban_concept.events e LEFT JOIN zhiban_academic.people n ON n.tenant_id=e.tenant_id AND n.membership_id=e.actor_id WHERE e.tenant_id=$1 AND e.correction_id=$2 ${teacher ? '' : "AND e.action NOT IN('CREATE_CORRECTION','EDIT_DRAFT')"} AND ($3::uuid IS NULL OR e.id<$3) ORDER BY e.id DESC LIMIT 21`,
      [a.tenantId, p.id, q.after],
    );
    const [response] = await this.rows(
      "SELECT revision::text FROM zhiban_concept.events WHERE tenant_id=$1 AND correction_id=$2 AND action='RESPOND' ORDER BY revision DESC LIMIT 1",
      [a.tenantId, p.id],
    );
    return {
      record: project(p),
      current,
      latestResponseRevision: response?.revision ?? null,
      rows: events.slice(0, 20),
      next: events.length > 20 ? String(events[19].id) : null,
    };
  }
  async execute(a: AcademicActor, o: string, c: ConceptCommand, key: string) {
    const student = c.type === 'RESPOND';
    await new LearningPgTransaction(this.client).access(a, o, student ? 'STUDENT' : 'TEACHER');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `concept-command:${a.tenantId}:${key}`,
    ]);
    let p: Row | undefined;
    if (c.type !== 'CREATE_CORRECTION') {
      [p] = await this.rows(
        'SELECT *,revision::text FROM zhiban_concept.corrections WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND ($4::uuid IS NULL OR (membership_id=$4 AND published_revision IS NOT NULL)) FOR UPDATE',
        [a.tenantId, o, c.id, student ? a.membershipId : null],
      );
      requireAcademic(p, 'NOT_FOUND');
      if (student || c.type === 'PUBLISH_CORRECTION' || c.type === 'REVISE_FEEDBACK')
        await this.activeEnrollment(a, o, p);
    }
    const digest = evidenceDigest([o, c]);
    const [prior] = await this.rows(
      'SELECT actor_id,offering_id,payload_digest,result FROM zhiban_concept.commands WHERE tenant_id=$1 AND command_key=$2',
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
    let snapshot: Row = {},
      body = '';
    const privateNote = 'privateNote' in c ? c.privateNote : null;
    if (c.type === 'CREATE_CORRECTION') {
      snapshot = await this.source(a, o, c.publicationId, c.questionId);
      requireAcademic(
        snapshot.fresh &&
          snapshot.item_points !== null &&
          Number(snapshot.item_points) < Number(snapshot.item_max) &&
          snapshot.digest === c.expectedDigest,
        'CONFLICT',
      );
      const id = v7();
      [p] = await this.rows(
        `INSERT INTO zhiban_concept.corrections VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DRAFT',1,NULL,$13,$14,$15,$16,$17,$17) RETURNING *,revision::text`,
        [
          a.tenantId,
          o,
          id,
          snapshot.enrollment_id,
          snapshot.membership_id,
          snapshot.activity_id,
          snapshot.activity_version,
          snapshot.attempt_id,
          snapshot.submission_id,
          c.publicationId,
          c.questionId,
          JSON.stringify(snapshot),
          c.concept,
          c.explanation,
          c.guidance,
          a.membershipId,
          a.now,
        ],
      );
    } else {
      requireAcademic(p && p.revision === c.revision, 'CONFLICT');
      let state = p.state,
        published = p.published_revision,
        concept = p.concept,
        explanation = p.explanation,
        guidance = p.guidance;
      if ('expectedDigest' in c) {
        snapshot = await this.source(a, o, p.publication_id, p.question_id);
        requireAcademic(snapshot.digest === c.expectedDigest, 'CONFLICT');
      }
      const next = String(BigInt(c.revision) + BigInt(1));
      if (c.type === 'EDIT_DRAFT' || c.type === 'REVISE_FEEDBACK') {
        requireAcademic(p.state === (c.type === 'EDIT_DRAFT' ? 'DRAFT' : 'OPEN'), 'INVALID_STATE');
        requireAcademic(snapshot.fresh, 'CONFLICT');
        if (c.type === 'REVISE_FEEDBACK') {
          await this.activeEnrollment(a, o, p);
          requireAcademic(
            snapshot.activity_type !== 'QUIZ' || snapshot.review_closed_at !== null,
            'INVALID_STATE',
          );
          published = next;
        }
        concept = c.concept;
        explanation = c.explanation;
        guidance = c.guidance;
        body = c.reason;
      } else if (c.type === 'PUBLISH_CORRECTION') {
        requireAcademic(p.state === 'DRAFT', 'INVALID_STATE');
        await this.activeEnrollment(a, o, p);
        requireAcademic(snapshot.fresh, 'CONFLICT');
        requireAcademic(
          snapshot.activity_type !== 'QUIZ' || snapshot.review_closed_at !== null,
          'INVALID_STATE',
        );
        state = 'OPEN';
        published = next;
      } else if (c.type === 'RESPOND') {
        requireAcademic(p.state === 'OPEN', 'INVALID_STATE');
        body = c.body;
      } else if (c.type === 'ASSESS') {
        requireAcademic(p.state === 'OPEN', 'INVALID_STATE');
        const [r] = await this.rows(
          "SELECT revision::text FROM zhiban_concept.events WHERE tenant_id=$1 AND correction_id=$2 AND action='RESPOND' ORDER BY revision DESC LIMIT 1",
          [a.tenantId, p.id],
        );
        requireAcademic(r && r.revision === c.responseRevision, 'CONFLICT');
        // Explicit human evaluation of the response. No score/completion changes, even if original grade changed.
        state = c.outcome === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
        body = c.body;
      } else if (c.type === 'RETRACT') {
        requireAcademic(p.state === 'OPEN' || p.state === 'RESOLVED', 'INVALID_STATE');
        state = 'RETRACTED';
        body = c.body;
      }
      [p] = await this.rows(
        'UPDATE zhiban_concept.corrections SET state=$3,revision=$4,published_revision=$5,concept=$6,explanation=$7,guidance=$8,updated_at=$9 WHERE tenant_id=$1 AND id=$2 RETURNING *,revision::text',
        [a.tenantId, p.id, state, next, published, concept, explanation, guidance, a.now],
      );
    }
    requireAcademic(p, 'UNAVAILABLE');
    await this.client.query(
      'INSERT INTO zhiban_concept.events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        a.tenantId,
        p.id,
        v7(),
        p.revision,
        c.type,
        p.state,
        body,
        JSON.stringify({ concept: p.concept, explanation: p.explanation, guidance: p.guidance }),
        JSON.stringify(snapshot),
        privateNote,
        a.membershipId,
        a.now,
      ],
    );
    const result = { id: p.id, state: p.state, revision: p.revision };
    await this.client.query('INSERT INTO zhiban_concept.commands VALUES($1,$2,$3,$4,$5,$6,$7)', [
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
