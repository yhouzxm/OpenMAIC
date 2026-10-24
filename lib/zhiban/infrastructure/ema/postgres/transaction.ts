import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import {
  dimensions,
  type EmaCommand,
  type Finding,
  type Dimension,
} from '../../../domain/ema/model';
import {
  evidenceDigest,
  type EvidenceRef,
  type ObservationText,
} from '../../../domain/learner/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
import { LearnerPgTransaction } from '../../learner/postgres/transaction';
type Row = Record<string, unknown>;
export type EmaRun = {
  id: string;
  lease: string;
  purpose: string;
  promptVersion: string;
  evidence: { kind: string; id: string; digest: string; snapshot: Row }[];
};
export type EmaQuery = {
  mode: 'TEACHER' | 'STUDENT';
  view: 'DIMENSIONS' | 'NOTES' | 'JOBS' | 'JOB';
  enrollment: string | null;
  id: string | null;
  dimension: Dimension | null;
  after: string | null;
};
export class EmaPgTransaction {
  private readonly learner: LearnerPgTransaction;
  constructor(private readonly client: PoolClient) {
    this.learner = new LearnerPgTransaction(client);
  }
  private async rows(sql: string, args: unknown[]) {
    return (await this.client.query<Row>(sql, args)).rows;
  }
  private async enrollment(
    a: AcademicActor,
    o: string,
    id: unknown,
    student = false,
    active = true,
  ) {
    const access = await new LearningPgTransaction(this.client).access(
      a,
      o,
      student ? 'STUDENT' : 'TEACHER',
    );
    const [e] = await this.rows(
      "SELECT * FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND ($5::boolean=false OR (status='ACTIVE' AND valid_from<=$4 AND valid_until IS NULL)) FOR SHARE",
      [a.tenantId, o, student ? access.enrollmentId : id, a.now, active],
    );
    requireAcademic(e && (!student || e.membership_id === a.membershipId), 'FORBIDDEN');
    return e;
  }
  private refs(j: Row) {
    return (j.evidence as EmaRun['evidence']).map((s) => ({
      kind: s.kind,
      id: s.id,
      digest: s.digest,
    })) as EvidenceRef[];
  }
  private async fresh(a: AcademicActor, o: string, j: Row, strict = false) {
    try {
      await this.learner.capture(a, o, String(j.enrollment_id), this.refs(j));
      return true;
    } catch (e) {
      if (strict) throw e;
      const code = (e as { code?: string }).code;
      if (['CONFLICT', 'NOT_FOUND', 'FORBIDDEN'].includes(code ?? '')) return false;
      throw e;
    }
  }
  async read(a: AcademicActor, o: string, q: EmaQuery) {
    const student = q.mode === 'STUDENT';
    requireAcademic(!student || !['JOBS', 'JOB'].includes(q.view), 'FORBIDDEN');
    let j: Row | undefined;
    if (q.view === 'JOB') {
      await new LearningPgTransaction(this.client).access(a, o, 'TEACHER');
      [j] = await this.rows(
        'SELECT *,revision::text FROM zhiban_ema.jobs WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
        [a.tenantId, o, q.id],
      );
      requireAcademic(j, 'NOT_FOUND');
    }
    const e = await this.enrollment(a, o, j?.enrollment_id ?? q.enrollment, student, !j);
    if (j) {
      const reviews = await this.rows(
        'SELECT dimension,decision,reason,note_id,created_at FROM zhiban_ema.reviews WHERE tenant_id=$1 AND job_id=$2 ORDER BY dimension',
        [a.tenantId, j.id],
      );
      const rows = await this.rows(
        'SELECT id,revision::text,action,detail,actor_id,created_at FROM zhiban_ema.events WHERE tenant_id=$1 AND job_id=$2 AND ($3::uuid IS NULL OR id<$3) ORDER BY id DESC LIMIT 21',
        [a.tenantId, j.id, q.after],
      );
      // Lease is an internal capability. Never disclose it to HTTP clients.
      const { lease: _lease, ...job } = j;
      void _lease;
      return {
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? String(rows[19].id) : null,
        job,
        reviews,
        fresh: await this.fresh(a, o, j),
        enrollmentId: e.id,
        dimensions,
      };
    }
    if (q.view === 'JOBS') {
      const rows = await this.rows(
        'SELECT j.id,j.purpose,j.state,j.revision::text,j.due_at,j.created_at,j.model,j.failure,(SELECT count(*)::integer FROM zhiban_ema.reviews r WHERE r.tenant_id=j.tenant_id AND r.job_id=j.id) AS reviewed FROM zhiban_ema.jobs j WHERE j.tenant_id=$1 AND j.offering_id=$2 AND j.enrollment_id=$3 AND ($4::uuid IS NULL OR j.id<$4) ORDER BY j.id DESC LIMIT 21',
        [a.tenantId, o, e.id, q.after],
      );
      return {
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? String(rows[19].id) : null,
        enrollmentId: e.id,
        dimensions,
      };
    }
    const notes = await this.rows(
      `SELECT n.id,n.title,n.body,n.confidence,n.state,n.revision::text,t.dimension FROM zhiban_ema.tags t JOIN zhiban_learner.observations n ON n.tenant_id=t.tenant_id AND n.id=t.note_id WHERE n.tenant_id=$1 AND n.offering_id=$2 AND n.enrollment_id=$3 ${student ? 'AND n.published_revision IS NOT NULL' : ''} AND ($4::text IS NULL OR t.dimension=$4) AND ($5::uuid IS NULL OR n.id<$5) ORDER BY n.id DESC LIMIT 21`,
      [a.tenantId, o, e.id, q.view === 'NOTES' ? q.dimension : null, q.after],
    );
    const rows = [];
    for (const n of notes.slice(0, 20)) {
      const detail = await this.learner.read(a, o, {
        mode: q.mode,
        view: 'NOTE',
        id: String(n.id),
        enrollmentId: null,
        q: '',
        state: 'ALL',
        kind: 'ALL',
        after: null,
      });
      requireAcademic('evidence' in detail, 'UNAVAILABLE');
      rows.push({ ...n, evidence: detail.evidence });
    }
    const counts = await this.rows(
      `SELECT t.dimension,count(*) FILTER(WHERE n.state='PUBLISHED')::integer AS published,count(*) FILTER(WHERE n.state='WITHDRAWN')::integer AS withdrawn FROM zhiban_ema.tags t JOIN zhiban_learner.observations n ON n.tenant_id=t.tenant_id AND n.id=t.note_id WHERE n.tenant_id=$1 AND n.offering_id=$2 AND n.enrollment_id=$3 ${student ? 'AND n.published_revision IS NOT NULL' : ''} GROUP BY t.dimension`,
      [a.tenantId, o, e.id],
    );
    return {
      rows,
      next: notes.length > 20 ? String(notes[19].id) : null,
      counts,
      dimensions,
      enrollmentId: e.id,
      asOf: a.now,
    };
  }
  private async create(
    a: AcademicActor,
    o: string,
    enrollmentId: string,
    d: Dimension,
    text: ObservationText,
    key: string,
  ) {
    const result = (await this.learner.execute(
      a,
      o,
      { type: 'CREATE_OBSERVATION', enrollmentId, ...text },
      key,
    )) as { id: string; revision: string };
    await this.client.query('INSERT INTO zhiban_ema.tags VALUES($1,$2,$3,$4,$5)', [
      a.tenantId,
      result.id,
      d,
      a.membershipId,
      a.now,
    ]);
    return result;
  }
  private async event(a: AcademicActor, j: Row, action: string, detail: Row = {}) {
    await this.client.query('INSERT INTO zhiban_ema.events VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [
      a.tenantId,
      v7(),
      j.id,
      j.revision,
      action,
      JSON.stringify(detail),
      a.membershipId,
      a.now,
    ]);
  }
  async execute(
    a: AcademicActor,
    o: string,
    c: EmaCommand,
    key: string,
  ): Promise<{ result: Row; dispatch?: EmaRun }> {
    await new LearningPgTransaction(this.client).access(a, o, 'TEACHER');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `ema-command:${a.tenantId}:${key}`,
    ]);
    let j: Row | undefined;
    if ('id' in c) {
      [j] = await this.rows(
        'SELECT *,revision::text FROM zhiban_ema.jobs WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
        [a.tenantId, o, c.id],
      );
      requireAcademic(j, 'NOT_FOUND');
    }
    await this.enrollment(
      a,
      o,
      j?.enrollment_id ?? ('enrollmentId' in c ? c.enrollmentId : null),
      false,
      !['CANCEL', 'EXPIRE', 'REJECT'].includes(c.type),
    );
    const digest = evidenceDigest([o, c]);
    const [prior] = await this.rows(
      'SELECT * FROM zhiban_ema.commands WHERE tenant_id=$1 AND command_key=$2',
      [a.tenantId, key],
    );
    if (prior) {
      requireAcademic(
        prior.offering_id === o &&
          prior.actor_id === a.membershipId &&
          prior.payload_digest === digest,
        'CONFLICT',
      );
      return { result: prior.result as Row };
    }
    let result: Row | undefined, dispatch: EmaRun | undefined;
    if (c.type === 'CREATE_OBSERVATION')
      result = await this.create(a, o, c.enrollmentId, c.dimension, c.text, key);
    else if (c.type === 'QUEUE') {
      const capture = await this.learner.capture(a, o, c.enrollmentId, c.evidence);
      requireAcademic(
        c.dueAt === null || (c.dueAt <= a.now + 30 * 86400000 && c.dueAt >= a.now - 60000),
      );
      const evidence = capture.samples.map(({ kind, id, digest, snapshot }) => ({
        kind,
        id,
        digest,
        snapshot,
      }));
      [j] = await this.rows(
        "INSERT INTO zhiban_ema.jobs(tenant_id,offering_id,id,enrollment_id,membership_id,purpose,due_at,evidence,source_digest,prompt_version,state,revision,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ema-six-v1','QUEUED',1,$10,$11,$11) RETURNING *,revision::text",
        [
          a.tenantId,
          o,
          v7(),
          c.enrollmentId,
          capture.membershipId,
          c.purpose,
          c.dueAt ?? a.now,
          JSON.stringify(evidence),
          evidenceDigest(evidence),
          a.membershipId,
          a.now,
        ],
      );
      await this.event(a, j, c.type, {
        sourceDigest: j.source_digest,
        promptVersion: j.prompt_version,
      });
      result = { id: j.id, revision: j.revision, state: j.state };
    } else {
      requireAcademic(j && j.revision === c.revision, 'CONFLICT');
      if (c.type === 'RUN') {
        requireAcademic(j.state === 'QUEUED' && Number(j.due_at) <= a.now, 'INVALID_STATE');
        await this.fresh(a, o, j, true);
        const lease = v7();
        [j] = await this.rows(
          "UPDATE zhiban_ema.jobs SET state='RUNNING',revision=revision+1,lease=$3,started_at=$4,updated_at=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *,revision::text",
          [a.tenantId, j.id, lease, a.now],
        );
        dispatch = {
          id: String(j.id),
          lease,
          purpose: String(j.purpose),
          promptVersion: String(j.prompt_version),
          evidence: j.evidence as EmaRun['evidence'],
        };
      } else if (c.type === 'CANCEL' || c.type === 'EXPIRE') {
        requireAcademic(
          c.type === 'CANCEL'
            ? ['QUEUED', 'RUNNING'].includes(String(j.state))
            : j.state === 'RUNNING' && Number(j.started_at) + 120000 < a.now,
          'INVALID_STATE',
        );
        [j] = await this.rows(
          'UPDATE zhiban_ema.jobs SET state=$3,revision=revision+1,lease=NULL,finished_at=$4,updated_at=$4,failure=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *,revision::text',
          [
            a.tenantId,
            j.id,
            c.type === 'CANCEL' ? 'CANCELLED' : 'FAILED',
            a.now,
            c.type === 'EXPIRE' ? 'EXPIRED' : null,
          ],
        );
      } else {
        requireAcademic(c.type === 'ADOPT' || c.type === 'REJECT');
        requireAcademic(j.state === 'READY', 'INVALID_STATE');
        const [reviewed] = await this.rows(
          'SELECT 1 FROM zhiban_ema.reviews WHERE tenant_id=$1 AND job_id=$2 AND dimension=$3',
          [a.tenantId, j.id, c.dimension],
        );
        requireAcademic(!reviewed, 'CONFLICT');
        const finding = (j.result as Finding[]).find((f) => f.dimension === c.dimension);
        requireAcademic(finding);
        let note: string | null = null;
        if (c.type === 'ADOPT') {
          requireAcademic(
            finding.state !== 'INSUFFICIENT' && finding.evidence.length > 0,
            'INVALID_STATE',
          );
          await this.fresh(a, o, j, true);
          const allowed = finding.evidence.map((i) => (j!.evidence as EmaRun['evidence'])[i - 1]);
          requireAcademic(
            c.text.evidence.every((r) =>
              allowed.some((s) => s.kind === r.kind && s.id === r.id && s.digest === r.digest),
            ),
          );
          note = (await this.create(a, o, String(j.enrollment_id), c.dimension, c.text, key)).id;
        }
        await this.client.query('INSERT INTO zhiban_ema.reviews VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [
          a.tenantId,
          j.id,
          c.dimension,
          c.type,
          c.reason,
          note,
          a.membershipId,
          a.now,
        ]);
        [j] = await this.rows(
          'UPDATE zhiban_ema.jobs SET revision=revision+1,updated_at=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *,revision::text',
          [a.tenantId, j.id, a.now],
        );
        result = {
          id: j.id,
          revision: j.revision,
          state: j.state,
          ...(note ? { noteId: note } : {}),
        };
      }
      await this.event(
        a,
        j,
        c.type,
        'dimension' in c ? { dimension: c.dimension, reason: c.reason } : {},
      );
      result ??= { id: j.id, revision: j.revision, state: j.state };
    }
    await this.client.query('INSERT INTO zhiban_ema.commands VALUES($1,$2,$3,$4,$5,$6,$7)', [
      a.tenantId,
      key,
      o,
      a.membershipId,
      digest,
      JSON.stringify(result),
      a.now,
    ]);
    return { result, dispatch };
  }
  async finish(
    a: AcademicActor,
    o: string,
    run: EmaRun,
    value: { findings: Finding[]; model: { provider: string; model: string } } | null,
  ) {
    await new LearningPgTransaction(this.client).access(a, o, 'TEACHER');
    let [j] = await this.rows(
      'SELECT *,revision::text FROM zhiban_ema.jobs WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
      [a.tenantId, o, run.id],
    );
    requireAcademic(
      j && j.state === 'RUNNING' && j.lease === run.lease && Number(j.started_at) + 120000 > a.now,
      'CONFLICT',
    );
    const fresh = await this.fresh(a, o, j);
    [j] = await this.rows(
      'UPDATE zhiban_ema.jobs SET state=$3,revision=revision+1,lease=NULL,finished_at=$4,updated_at=$4,result=$5,model=$6,failure=$7 WHERE tenant_id=$1 AND id=$2 RETURNING *,revision::text',
      [
        a.tenantId,
        j.id,
        value ? (fresh ? 'READY' : 'STALE') : 'FAILED',
        a.now,
        value ? JSON.stringify(value.findings) : null,
        value ? JSON.stringify(value.model) : null,
        value ? (fresh ? null : 'SOURCE_CHANGED') : 'MODEL_FAILED',
      ],
    );
    await this.event(a, j, 'FINISH', {
      state: j.state,
      model: j.model,
      sourceDigest: j.source_digest,
      promptVersion: j.prompt_version,
    });
    return { id: j.id, revision: j.revision, state: j.state };
  }
}
