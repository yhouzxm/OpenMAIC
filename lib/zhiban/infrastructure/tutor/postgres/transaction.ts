import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import {
  digest,
  type TutorCommand,
  type TutorMode,
  type TutorSource,
} from '../../../domain/tutor/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
export type TutorRow = Record<string, unknown>;
export interface TutorRun {
  turnId: string;
  sessionId: string;
  policyRevision: string;
  guidance: string;
  style?: 'TUTOR' | 'PEER';
  question: string;
  history: { question: string; answer: string }[];
  source: TutorSource | null;
}
export class TutorPgTransaction {
  constructor(private readonly c: PoolClient) {}
  private async rows(sql: string, p: unknown[] = []) {
    return (await this.c.query(sql, p)).rows;
  }
  async access(a: AcademicActor, o: string, mode: TutorMode) {
    const access = await new LearningPgTransaction(this.c).access(a, o, mode);
    return access;
  }
  private async policy(a: AcademicActor, o: string) {
    return (
      (
        await this.rows(
          'SELECT enabled,peer_enabled,guidance,revision::text FROM zhiban_tutor.policies WHERE tenant_id=$1 AND offering_id=$2 FOR SHARE',
          [a.tenantId, o],
        )
      )[0] ?? { enabled: false, peer_enabled: false, guidance: '', revision: '0' }
    );
  }
  private async session(
    a: AcademicActor,
    o: string,
    mode: TutorMode,
    id: string,
    enrollment: unknown,
    lock = false,
  ) {
    const [s] = await this.rows(
      "SELECT *,revision::text FROM zhiban_tutor.sessions WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4 AND mode=$5 AND ($5='TEACHER' OR EXISTS(SELECT 1 FROM zhiban_academic.enrollments e WHERE e.tenant_id=$1 AND e.id=zhiban_tutor.sessions.enrollment_id AND e.valid_from<=zhiban_tutor.sessions.created_at))" +
        (lock ? ' FOR UPDATE' : ''),
      [a.tenantId, o, id, a.membershipId, mode],
    );
    requireAcademic(s && (mode === 'TEACHER' || s.enrollment_id === enrollment), 'NOT_FOUND');
    return s;
  }
  private async event(a: AcademicActor, o: string, action: string, facts: unknown) {
    await this.c.query('INSERT INTO zhiban_tutor.events VALUES($1,$2,$3,$4,$5,$6,$7)', [
      a.tenantId,
      v7(),
      o,
      a.membershipId,
      action,
      JSON.stringify(facts),
      a.now,
    ]);
  }
  async read(
    a: AcademicActor,
    o: string,
    mode: TutorMode,
    id: string | null,
    after: string | null,
  ) {
    const access = await this.access(a, o, mode),
      policy = await this.policy(a, o);
    if (id) {
      const session = await this.session(a, o, mode, id, access.enrollmentId);
      const rows = await this.rows(
        "SELECT id,position,question,answer,CASE WHEN state='RUNNING' AND expires_at<=$3 THEN 'EXPIRED' ELSE state END AS state,error_code,model,created_at,finished_at FROM zhiban_tutor.turns WHERE tenant_id=$1 AND session_id=$2 ORDER BY position",
        [a.tenantId, id, a.now],
      );
      return { policy, session, rows, next: null };
    }
    const rows = await this.rows(
      "SELECT id,title,style,state,revision::text,source,created_at,updated_at FROM zhiban_tutor.sessions WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND mode=$4 AND ($4='TEACHER' OR (enrollment_id=$5 AND EXISTS(SELECT 1 FROM zhiban_academic.enrollments e WHERE e.tenant_id=$1 AND e.id=enrollment_id AND e.valid_from<=zhiban_tutor.sessions.created_at))) AND ($6::uuid IS NULL OR id<$6) ORDER BY id DESC LIMIT 21",
      [a.tenantId, o, a.membershipId, mode, access.enrollmentId ?? null, after],
    );
    return { policy, rows: rows.slice(0, 20), next: rows.length > 20 ? rows[19].id : null };
  }
  async execute(
    a: AcademicActor,
    o: string,
    c: TutorCommand,
    key: string,
    source: TutorSource | null = null,
    canStart = true,
  ) {
    const access = await this.access(a, o, c.mode);
    await this.c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `tutor:${a.tenantId}:${o}`,
    ]);
    const p = await this.policy(a, o);
    const s = 'id' in c ? await this.session(a, o, c.mode, c.id, access.enrollmentId, true) : null;
    const [old] = await this.rows(
      'SELECT * FROM zhiban_tutor.commands WHERE tenant_id=$1 AND command_key=$2',
      [a.tenantId, key],
    );
    if (old) {
      requireAcademic(
        old.actor_id === a.membershipId &&
          old.offering_id === o &&
          old.payload_digest === digest(c),
        'CONFLICT',
      );
      return { result: old.result, dispatch: false };
    }
    let result: TutorRow;
    if (c.type === 'SET_POLICY') {
      requireAcademic(p.revision === c.revision, 'CONFLICT');
      const [next] = await this.rows(
        'INSERT INTO zhiban_tutor.policies(tenant_id,offering_id,revision,enabled,guidance,updated_by,updated_at,peer_enabled) VALUES($1,$2,1,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,offering_id) DO UPDATE SET revision=zhiban_tutor.policies.revision+1,enabled=excluded.enabled,peer_enabled=excluded.peer_enabled,guidance=excluded.guidance,updated_by=excluded.updated_by,updated_at=excluded.updated_at RETURNING revision::text',
        [a.tenantId, o, c.enabled, c.guidance, a.membershipId, a.now, c.peerEnabled ?? false],
      );
      result = { revision: next.revision };
      await this.event(a, o, c.type, {
        revision: next.revision,
        enabled: c.enabled,
        peerEnabled: c.peerEnabled ?? false,
        guidance: c.guidance,
      });
    } else if (c.type === 'CREATE_SESSION') {
      requireAcademic(
        p.enabled && ((c.style ?? 'TUTOR') !== 'PEER' || p.peer_enabled),
        'INVALID_STATE',
      );
      const id = v7();
      await this.c.query(
        "INSERT INTO zhiban_tutor.sessions(tenant_id,offering_id,id,membership_id,mode,enrollment_id,title,source,state,revision,created_at,updated_at,style) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',1,$9,$9,$10)",
        [
          a.tenantId,
          o,
          id,
          a.membershipId,
          c.mode,
          access.enrollmentId ?? null,
          c.title,
          source ? JSON.stringify(source) : null,
          a.now,
          c.style ?? 'TUTOR',
        ],
      );
      result = { id, revision: '1' };
      await this.event(a, o, c.type, {
        id,
        resourceId: source?.resourceId ?? null,
        style: c.style ?? 'TUTOR',
      });
    } else if (c.type === 'CANCEL') {
      const [turn] = await this.rows(
        'SELECT state FROM zhiban_tutor.turns WHERE tenant_id=$1 AND session_id=$2 AND id=$3 FOR UPDATE',
        [a.tenantId, c.id, c.turnId],
      );
      requireAcademic(turn, 'NOT_FOUND');
      if (turn.state === 'RUNNING') {
        await this.c.query(
          "UPDATE zhiban_tutor.turns SET state='CANCELLED',finished_at=$3,error_code='USER_CANCELLED' WHERE tenant_id=$1 AND id=$2",
          [a.tenantId, c.turnId, a.now],
        );
        await this.event(a, o, c.type, { id: c.id, turnId: c.turnId });
      }
      result = { id: c.id, turnId: c.turnId };
    } else if (c.type === 'CLOSE_SESSION') {
      requireAcademic(s!.revision === c.revision && s!.state === 'OPEN', 'CONFLICT');
      await this.c.query(
        "UPDATE zhiban_tutor.sessions SET state='CLOSED',revision=revision+1,updated_at=$3 WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, c.id, a.now],
      );
      await this.c.query(
        "UPDATE zhiban_tutor.turns SET state='CANCELLED',finished_at=$3,error_code='SESSION_CLOSED' WHERE tenant_id=$1 AND session_id=$2 AND state='RUNNING'",
        [a.tenantId, c.id, a.now],
      );
      result = { id: c.id };
      await this.event(a, o, c.type, result);
    } else {
      requireAcademic(
        p.enabled && (s!.style !== 'PEER' || p.peer_enabled) && s!.state === 'OPEN',
        'INVALID_STATE',
      );
      requireAcademic(s!.revision === c.revision, 'CONFLICT');
      requireAcademic(canStart, 'UNAVAILABLE');
      const expired = await this.rows(
        "UPDATE zhiban_tutor.turns SET state='EXPIRED',finished_at=$4,error_code='HOST_INTERRUPTED_OR_TIMEOUT' WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND state='RUNNING' AND expires_at<=$4 RETURNING id",
        [a.tenantId, o, a.membershipId, a.now],
      );
      for (const t of expired) await this.event(a, o, 'EXPIRE', { turnId: t.id });
      requireAcademic(
        !(
          await this.rows(
            "SELECT id FROM zhiban_tutor.turns WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND state='RUNNING'",
            [a.tenantId, o, a.membershipId],
          )
        ).length,
        'CONFLICT',
      );
      const count = Number(
        (
          await this.rows(
            'SELECT count(*)::int AS n FROM zhiban_tutor.turns WHERE tenant_id=$1 AND session_id=$2',
            [a.tenantId, c.id],
          )
        )[0].n,
      );
      requireAcademic(count < 30, 'INVALID_STATE');
      const turnId = v7();
      await this.c.query(
        "INSERT INTO zhiban_tutor.turns(tenant_id,offering_id,session_id,membership_id,id,position,policy_revision,question,state,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RUNNING',$9,$10)",
        [
          a.tenantId,
          o,
          c.id,
          a.membershipId,
          turnId,
          count + 1,
          p.revision,
          c.message,
          a.now,
          a.now + 120000,
        ],
      );
      const [next] = await this.rows(
        'UPDATE zhiban_tutor.sessions SET revision=revision+1,updated_at=$3 WHERE tenant_id=$1 AND id=$2 RETURNING revision::text',
        [a.tenantId, c.id, a.now],
      );
      result = { id: c.id, turnId, revision: next.revision };
      await this.event(a, o, c.type, { id: c.id, turnId, policyRevision: p.revision });
    }
    await this.c.query('INSERT INTO zhiban_tutor.commands VALUES($1,$2,$3,$4,$5,$6,$7)', [
      a.tenantId,
      key,
      o,
      a.membershipId,
      digest(c),
      JSON.stringify(result),
      a.now,
    ]);
    return { result, dispatch: c.type === 'ASK' };
  }
  async run(
    a: AcademicActor,
    o: string,
    mode: TutorMode,
    id: string,
    turnId: string,
  ): Promise<TutorRun> {
    const access = await this.access(a, o, mode),
      p = await this.policy(a, o),
      s = await this.session(a, o, mode, id, access.enrollmentId);
    const [t] = await this.rows(
      'SELECT *,policy_revision::text FROM zhiban_tutor.turns WHERE tenant_id=$1 AND session_id=$2 AND id=$3',
      [a.tenantId, id, turnId],
    );
    requireAcademic(
      t &&
        t.state === 'RUNNING' &&
        Number(t.expires_at) > a.now &&
        p.enabled &&
        (s.style !== 'PEER' || p.peer_enabled) &&
        p.revision === t.policy_revision &&
        s.state === 'OPEN',
      'INVALID_STATE',
    );
    const history = await this.rows(
      "SELECT question,answer FROM zhiban_tutor.turns WHERE tenant_id=$1 AND session_id=$2 AND state='COMPLETED' ORDER BY position DESC LIMIT 8",
      [a.tenantId, id],
    );
    return {
      turnId,
      sessionId: id,
      policyRevision: p.revision,
      guidance: p.guidance,
      style: s.style,
      question: t.question,
      history: history.reverse(),
      source: s.source,
    };
  }
  async finish(
    a: AcademicActor,
    o: string,
    mode: TutorMode,
    id: string,
    turnId: string,
    value: {
      answer: string | null;
      state: 'COMPLETED' | 'FAILED' | 'BLOCKED';
      error: string | null;
      model: unknown;
    },
  ) {
    const access = await this.access(a, o, mode);
    await this.c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `tutor:${a.tenantId}:${o}`,
    ]);
    const p = await this.policy(a, o),
      s = await this.session(a, o, mode, id, access.enrollmentId, true);
    const [t] = await this.rows(
      'SELECT *,policy_revision::text FROM zhiban_tutor.turns WHERE tenant_id=$1 AND session_id=$2 AND id=$3 FOR UPDATE',
      [a.tenantId, id, turnId],
    );
    requireAcademic(t, 'NOT_FOUND');
    if (t.state !== 'RUNNING') return;
    const allowed =
      p.enabled &&
      (s.style !== 'PEER' || p.peer_enabled) &&
      p.revision === t.policy_revision &&
      s.state === 'OPEN' &&
      Number(t.expires_at) > a.now;
    const state = allowed ? value.state : 'BLOCKED';
    await this.c.query(
      'UPDATE zhiban_tutor.turns SET state=$3,answer=$4,error_code=$5,model=$6,finished_at=$7 WHERE tenant_id=$1 AND id=$2',
      [
        a.tenantId,
        turnId,
        state,
        state === 'COMPLETED' ? value.answer : null,
        allowed ? value.error : 'POLICY_OR_SESSION_CHANGED',
        JSON.stringify(value.model),
        a.now,
      ],
    );
    await this.event(a, o, 'FINISH', {
      id,
      turnId,
      state,
      answerDigest: state === 'COMPLETED' ? digest(value.answer) : null,
      model: value.model,
      policyRevision: t.policy_revision,
      error: allowed ? value.error : 'POLICY_OR_SESSION_CHANGED',
    });
  }
}
