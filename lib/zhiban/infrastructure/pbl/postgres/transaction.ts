import { v7 } from 'uuid';
import type { PoolClient, QueryResultRow } from 'pg';
import type { PBLProject } from '@openmaic/dsl';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import {
  nativeDesign,
  groupWork,
  completeWork,
  pblDigest,
  type PblCommand,
} from '../../../domain/pbl/model';
import type { PblQuery } from '../../../application/pbl/service';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
type Row = QueryResultRow;
const revision = (r: Row, wanted: string) =>
  requireAcademic(String(r.revision) === wanted, 'CONFLICT');
const next = (v: unknown) => String(BigInt(String(v)) + BigInt(1));
const studentCommands = ['SAVE_WORK', 'CONFIRM_WORK', 'RETRACT_CONFIRMATION', 'SUBMIT_GROUP'];
export class PblPgTransaction {
  constructor(
    private readonly c: PoolClient,
    private readonly recipient: (m: string) => Promise<void>,
  ) {}
  private async rows(sql: string, args: unknown[] = []): Promise<Row[]> {
    return (await this.c.query(sql, args)).rows;
  }
  private async project(a: AcademicActor, o: string, id: string, write = false) {
    const [p] = await this.rows(
      'SELECT *,revision::text,published_version::text FROM zhiban_pbl.projects WHERE tenant_id=$1 AND offering_id=$2 AND id=$3' +
        (write ? ' FOR UPDATE' : ' FOR SHARE'),
      [a.tenantId, o, id],
    );
    requireAcademic(p, 'NOT_FOUND');
    return p;
  }
  private async group(a: AcademicActor, o: string, id: string, write = false) {
    const [base] = await this.rows(
      'SELECT project_id FROM zhiban_pbl.groups WHERE tenant_id=$1 AND offering_id=$2 AND id=$3',
      [a.tenantId, o, id],
    );
    requireAcademic(base, 'NOT_FOUND');
    const p = await this.project(a, o, base.project_id, write);
    const [g] = await this.rows(
      'SELECT *,revision::text,work_revision::text,membership_revision::text,project_version::text,submitted_work_revision::text FROM zhiban_pbl.groups WHERE tenant_id=$1 AND offering_id=$2 AND id=$3' +
        (write ? ' FOR UPDATE' : ' FOR SHARE'),
      [a.tenantId, o, id],
    );
    requireAcademic(g && g.project_id === p.id, 'NOT_FOUND');
    const [v] = await this.rows(
      'SELECT *,version::text FROM zhiban_pbl.versions WHERE tenant_id=$1 AND project_id=$2 AND version=$3',
      [a.tenantId, p.id, g.project_version],
    );
    requireAcademic(v, 'UNAVAILABLE');
    return { p, g, v };
  }
  private async members(a: AcademicActor, g: string) {
    return this.rows(
      "SELECT m.membership_id,m.enrollment_id,m.joined_at::text,coalesce(p.display_name,'历史成员') AS display_name FROM zhiban_pbl.members m LEFT JOIN zhiban_academic.people p ON p.tenant_id=m.tenant_id AND p.membership_id=m.membership_id WHERE m.tenant_id=$1 AND m.group_id=$2 AND m.active ORDER BY m.membership_id LIMIT 11",
      [a.tenantId, g],
    );
  }
  private async enrolled(a: AcademicActor, o: string, members: Row[]) {
    requireAcademic(members.length >= 1 && members.length <= 10, 'INVALID_STATE');
    for (const m of [...members].sort((a, b) =>
      String(a.membership_id).localeCompare(String(b.membership_id)),
    )) {
      await this.recipient(m.membership_id);
      const e = await this.rows(
        "SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND id=$4 AND status='ACTIVE' AND valid_from<=$5 AND valid_from<=$6 AND valid_until IS NULL FOR SHARE",
        [a.tenantId, o, m.membership_id, m.enrollment_id, a.now, m.joined_at],
      );
      requireAcademic(e.length === 1, 'INACTIVE_MEMBER');
    }
  }
  private mine(a: AcademicActor, ms: Row[], enrollment: unknown, since: number) {
    return ms.some(
      (m) =>
        m.membership_id === a.membershipId &&
        m.enrollment_id === enrollment &&
        Number(m.joined_at) >= since,
    );
  }
  private async journal(a: AcademicActor, g: Row, now: number) {
    await this.c.query('INSERT INTO zhiban_pbl.revisions VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [
      a.tenantId,
      g.id,
      g.work_revision,
      g.membership_revision,
      JSON.stringify(g.work),
      pblDigest(g.work),
      a.membershipId,
      now,
    ]);
  }
  private async since(a: AcademicActor, enrollment: unknown) {
    if (!enrollment) return 0;
    const [e] = await this.rows(
      'SELECT valid_from::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2',
      [a.tenantId, enrollment],
    );
    requireAcademic(e, 'FORBIDDEN');
    return Number(e.valid_from);
  }
  async read(a: AcademicActor, o: string, q: PblQuery) {
    const access = await new LearningPgTransaction(this.c).access(a, o),
      teacher = access.mode === 'TEACHER',
      t = a.tenantId;
    if (!q.group) {
      if (!q.project) {
        const rows = await this.rows(
          `SELECT p.id,p.state,p.revision::text,p.published_version::text,CASE WHEN $3 THEN p.design->>'title' ELSE v.design->>'title' END AS title FROM zhiban_pbl.projects p LEFT JOIN zhiban_pbl.versions v ON v.tenant_id=p.tenant_id AND v.project_id=p.id AND v.version=p.published_version WHERE p.tenant_id=$1 AND p.offering_id=$2 AND ($3 OR p.published_version IS NOT NULL) AND ($4::uuid IS NULL OR p.id<$4) ORDER BY p.id DESC LIMIT 21`,
          [t, o, teacher, q.after],
        );
        return {
          mode: access.mode,
          rows: rows.slice(0, 20),
          next: rows.length > 20 ? rows[19].id : null,
        };
      }
      const p = await this.project(a, o, q.project);
      requireAcademic(teacher || p.published_version, 'NOT_FOUND');
      const v = p.published_version
        ? (
            await this.rows(
              'SELECT *,version::text FROM zhiban_pbl.versions WHERE tenant_id=$1 AND project_id=$2 AND version=$3',
              [t, p.id, p.published_version],
            )
          )[0]
        : null;
      const rows = await this.rows(
        `SELECT g.id,g.name,g.project_version::text,g.revision::text,(SELECT count(*)::int FROM zhiban_pbl.members WHERE tenant_id=g.tenant_id AND group_id=g.id AND active) AS member_count,g.latest_submission_id FROM zhiban_pbl.groups g WHERE g.tenant_id=$1 AND g.project_id=$2 AND ($3 OR EXISTS(SELECT 1 FROM zhiban_pbl.members m WHERE m.tenant_id=g.tenant_id AND m.group_id=g.id AND m.membership_id=$4 AND m.enrollment_id=$5 AND m.joined_at>=$8 AND m.active) OR EXISTS(SELECT 1 FROM zhiban_pbl.submissions s WHERE s.tenant_id=g.tenant_id AND s.group_id=g.id AND s.members @> $6::jsonb)) AND ($7::uuid IS NULL OR g.id<$7) ORDER BY g.id DESC LIMIT 21`,
        [
          t,
          p.id,
          teacher,
          a.membershipId,
          access.enrollmentId ?? null,
          JSON.stringify([{ membershipId: a.membershipId }]),
          q.after,
          await this.since(a, access.enrollmentId),
        ],
      );
      return {
        mode: access.mode,
        project: teacher ? p : { id: p.id, state: p.state, published_version: p.published_version },
        version: v,
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? rows[19].id : null,
      };
    }
    const { p, g, v } = await this.group(a, o, q.group),
      ms = await this.members(a, g.id),
      mine = this.mine(a, ms, access.enrollmentId, await this.since(a, access.enrollmentId));
    const past = await this.rows(
      'SELECT id FROM zhiban_pbl.submissions WHERE tenant_id=$1 AND group_id=$2 AND members @> $3::jsonb LIMIT 1',
      [t, g.id, JSON.stringify([{ membershipId: a.membershipId }])],
    );
    requireAcademic(teacher || mine || past.length, 'NOT_FOUND');
    if (q.submission) {
      const [s] = await this.rows(
        'SELECT *,version::text,work_revision::text,membership_revision::text FROM zhiban_pbl.submissions WHERE tenant_id=$1 AND group_id=$2 AND id=$3 AND ($4 OR members @> $5::jsonb)',
        [t, g.id, q.submission, teacher, JSON.stringify([{ membershipId: a.membershipId }])],
      );
      requireAcademic(s, 'NOT_FOUND');
      const evals = await this.rows(
        'SELECT e.*,e.version::text FROM zhiban_pbl.evaluations e WHERE e.tenant_id=$1 AND e.submission_id=$2 AND ($3::bigint IS NULL OR e.version<$3) ORDER BY e.version DESC LIMIT 21',
        [t, s.id, q.after],
      );
      return {
        mode: access.mode,
        group: { id: g.id, name: g.name },
        version: v,
        submission: s,
        evaluations: evals.slice(0, 20),
        next: evals.length > 20 ? evals[19].version : null,
      };
    }
    if (q.kind === 'REVISIONS') {
      requireAcademic(teacher || mine, 'FORBIDDEN');
      const rows = await this.rows(
        "SELECT r.*,r.work_revision::text,r.membership_revision::text,coalesce(p.display_name,'历史成员') AS author_name FROM zhiban_pbl.revisions r LEFT JOIN zhiban_academic.people p ON p.tenant_id=r.tenant_id AND p.membership_id=r.author_id WHERE r.tenant_id=$1 AND r.group_id=$2 AND ($3::bigint IS NULL OR r.work_revision<$3) ORDER BY r.work_revision DESC LIMIT 21",
        [t, g.id, q.after],
      );
      return {
        mode: access.mode,
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? rows[19].work_revision : null,
      };
    }
    const submissions = await this.rows(
      `SELECT s.id,s.version::text,s.work_revision::text,s.membership_revision::text,s.submitted_at::text,s.members,e.version::text AS evaluation_version,e.score,e.feedback FROM zhiban_pbl.submissions s LEFT JOIN LATERAL(SELECT version,score,feedback FROM zhiban_pbl.evaluations WHERE tenant_id=s.tenant_id AND submission_id=s.id ORDER BY version DESC LIMIT 1)e ON true WHERE s.tenant_id=$1 AND s.group_id=$2 AND ($3 OR s.members @> $4::jsonb) AND ($5::uuid IS NULL OR s.id<$5) ORDER BY s.id DESC LIMIT 21`,
      [t, g.id, teacher, JSON.stringify([{ membershipId: a.membershipId }]), q.after],
    );
    const confirmations =
      teacher || mine
        ? await this.rows(
            'SELECT membership_id,enrollment_id,work_revision::text,membership_revision::text,confirmed,confirmed_at::text FROM zhiban_pbl.confirmations WHERE tenant_id=$1 AND group_id=$2',
            [t, g.id],
          )
        : [];
    return {
      mode: access.mode,
      project: { id: p.id, state: p.state },
      version: v,
      group: teacher || mine ? g : { id: g.id, name: g.name, project_id: g.project_id },
      members: teacher || mine ? ms : [],
      confirmations,
      canEdit:
        mine &&
        p.state === 'OPEN' &&
        access.offering.status === 'OPEN' &&
        (v.deadline_at === null || a.now < Number(v.deadline_at)) &&
        (!g.latest_submission_id || v.allow_resubmit),
      rows: submissions.slice(0, 20),
      next: submissions.length > 20 ? submissions[19].id : null,
    };
  }
  async execute(a: AcademicActor, o: string, c: PblCommand, key: string) {
    const access = await new LearningPgTransaction(this.c).access(
        a,
        o,
        studentCommands.includes(c.type) ? 'STUDENT' : 'TEACHER',
      ),
      t = a.tenantId;
    const digest = pblDigest([o, c]);
    await this.c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`pbl:${t}:${key}`]);
    let p: Row | null = null,
      g: Row | null = null,
      v: Row | null = null,
      ms: Row[] = [];
    if (
      ['SAVE_PROJECT', 'PUBLISH_PROJECT', 'CLOSE_PROJECT', 'REOPEN_PROJECT'].includes(c.type) &&
      'id' in c
    )
      p = await this.project(a, o, c.id, true);
    if (c.type === 'CREATE_GROUP') p = await this.project(a, o, c.projectId, true);
    if (['SET_MEMBERS', ...studentCommands].includes(c.type) && 'id' in c) {
      ({ p, g, v } = await this.group(a, o, c.id, true));
      ms = await this.members(a, g!.id);
      if (studentCommands.includes(c.type))
        requireAcademic(
          this.mine(a, ms, access.enrollmentId, await this.since(a, access.enrollmentId)),
          'FORBIDDEN',
        );
    }
    if (c.type === 'PUBLISH_EVALUATION') {
      const [s] = await this.rows(
        'SELECT group_id FROM zhiban_pbl.submissions WHERE tenant_id=$1 AND offering_id=$2 AND id=$3',
        [t, o, c.id],
      );
      requireAcademic(s, 'NOT_FOUND');
      ({ p, g, v } = await this.group(a, o, s.group_id, true));
    }
    const [prior] = await this.rows(
      'SELECT * FROM zhiban_pbl.commands WHERE tenant_id=$1 AND command_key=$2',
      [t, key],
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
    requireAcademic(access.offering.status === 'OPEN', 'INVALID_STATE');
    const now = Number(
      (await this.rows('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS n'))[0]
        .n,
    );
    let result: Row,
      projectId: string,
      groupId: string | null = g?.id ?? null;
    if (c.type === 'CREATE_PROJECT') {
      projectId = v7();
      await this.c.query(
        "INSERT INTO zhiban_pbl.projects VALUES($1,$2,$3,1,'DRAFT',$4,$5,$6,NULL,$7,$8)",
        [
          t,
          projectId,
          o,
          JSON.stringify(c.design),
          c.deadlineAt,
          c.allowResubmit,
          a.membershipId,
          now,
        ],
      );
      result = { id: projectId, revision: '1', state: 'DRAFT' };
    } else if (c.type === 'SAVE_PROJECT') {
      projectId = p!.id;
      revision(p!, c.revision);
      await this.c.query(
        'UPDATE zhiban_pbl.projects SET design=$3,deadline_at=$4,allow_resubmit=$5,revision=revision+1,updated_at=$6 WHERE tenant_id=$1 AND id=$2',
        [t, p!.id, JSON.stringify(c.design), c.deadlineAt, c.allowResubmit, now],
      );
      result = { id: p!.id, revision: next(p!.revision) };
    } else if (
      ['PUBLISH_PROJECT', 'CLOSE_PROJECT', 'REOPEN_PROJECT'].includes(c.type) &&
      'revision' in c
    ) {
      projectId = p!.id;
      revision(p!, c.revision);
      if (c.type === 'PUBLISH_PROJECT') {
        const version = p!.revision;
        const design = nativeDesign(p!.design);
        requireAcademic(!p!.deadline_at || now < Number(p!.deadline_at), 'INVALID_STATE');
        await this.c.query('INSERT INTO zhiban_pbl.versions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          t,
          p!.id,
          version,
          JSON.stringify(design),
          p!.deadline_at,
          p!.allow_resubmit,
          pblDigest([design, p!.deadline_at, p!.allow_resubmit]),
          a.membershipId,
          now,
        ]);
        await this.c.query(
          "UPDATE zhiban_pbl.projects SET published_version=$3,state='OPEN',revision=revision+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2",
          [t, p!.id, version, now],
        );
        result = { id: p!.id, revision: next(p!.revision), version };
      } else {
        requireAcademic(
          c.type === 'CLOSE_PROJECT'
            ? p!.state === 'OPEN'
            : p!.state === 'CLOSED' && p!.published_version,
          'INVALID_STATE',
        );
        const state = c.type === 'CLOSE_PROJECT' ? 'CLOSED' : 'OPEN';
        await this.c.query(
          'UPDATE zhiban_pbl.projects SET state=$3,revision=revision+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2',
          [t, p!.id, state, now],
        );
        result = { id: p!.id, revision: next(p!.revision), state };
      }
    } else if (c.type === 'CREATE_GROUP' || c.type === 'SET_MEMBERS') {
      projectId = p!.id;
      requireAcademic(p!.state === 'OPEN' && p!.published_version, 'INVALID_STATE');
      if (c.type === 'SET_MEMBERS') revision(g!, c.revision);
      const assigned: Row[] = [];
      for (const m of c.members) {
        await this.recipient(m);
        const [e] = await this.rows(
          "SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE' AND valid_from<=$4 AND valid_until IS NULL FOR SHARE",
          [t, o, m, a.now],
        );
        requireAcademic(e, 'INACTIVE_MEMBER');
        requireAcademic(
          !(
            await this.rows(
              'SELECT 1 FROM zhiban_pbl.members WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3 AND active AND ($4::uuid IS NULL OR group_id<>$4)',
              [t, p!.id, m, g?.id ?? null],
            )
          ).length,
          'CONFLICT',
        );
        assigned.push({ membership_id: m, enrollment_id: e.id });
      }
      if (c.type === 'CREATE_GROUP') {
        groupId = v7();
        g = {
          id: groupId,
          revision: '1',
          work_revision: '1',
          membership_revision: '1',
          work: { answers: {}, reflection: '' },
        };
        await this.c.query(
          'INSERT INTO zhiban_pbl.groups VALUES($1,$2,$3,$4,$5,$6,1,1,1,$7,NULL,NULL,$8)',
          [t, groupId, p!.id, o, p!.published_version, c.name, JSON.stringify(g.work), now],
        );
      } else {
        g = {
          ...g,
          name: c.name,
          revision: next(g!.revision),
          work_revision: next(g!.work_revision),
          membership_revision: next(g!.membership_revision),
        };
        await this.c.query(
          'UPDATE zhiban_pbl.groups SET name=$3,revision=revision+1,work_revision=work_revision+1,membership_revision=membership_revision+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2',
          [t, g.id, c.name, now],
        );
        await this.c.query(
          'UPDATE zhiban_pbl.members SET active=false WHERE tenant_id=$1 AND group_id=$2',
          [t, g.id],
        );
      }
      for (const m of assigned)
        await this.c.query(
          'INSERT INTO zhiban_pbl.members VALUES($1,$2,$3,$4,$5,$6,true,$7) ON CONFLICT(tenant_id,group_id,membership_id) DO UPDATE SET enrollment_id=EXCLUDED.enrollment_id,active=true,joined_at=EXCLUDED.joined_at',
          [t, g!.id, p!.id, m.membership_id, o, m.enrollment_id, now],
        );
      await this.journal(a, g!, now);
      result = {
        id: g!.id,
        revision: g!.revision,
        workRevision: g!.work_revision,
        membershipRevision: g!.membership_revision,
      };
    } else if (c.type === 'PUBLISH_EVALUATION') {
      projectId = p!.id;
      const [s] = await this.rows(
        'SELECT id FROM zhiban_pbl.submissions WHERE tenant_id=$1 AND group_id=$2 AND id=$3',
        [t, g!.id, c.id],
      );
      requireAcademic(s, 'NOT_FOUND');
      const [last] = await this.rows(
        'SELECT e.version::text FROM zhiban_pbl.evaluations e WHERE e.tenant_id=$1 AND e.submission_id=$2 ORDER BY e.version DESC LIMIT 1',
        [t, c.id],
      );
      requireAcademic((last?.version ?? '0') === c.revision, 'CONFLICT');
      requireAcademic(!last || !!c.reason.trim(), 'INVALID_INPUT');
      const version = next(c.revision);
      await this.c.query('INSERT INTO zhiban_pbl.evaluations VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [
        t,
        c.id,
        version,
        c.score,
        c.feedback,
        c.reason,
        a.membershipId,
        now,
      ]);
      result = { id: c.id, version, score: c.score };
    } else {
      requireAcademic(g && p && v && 'revision' in c, 'INVALID_INPUT');
      projectId = p.id;
      revision(g, c.revision);
      requireAcademic(p.state === 'OPEN', 'INVALID_STATE');
      requireAcademic(v.deadline_at === null || now < Number(v.deadline_at), 'INVALID_STATE');
      requireAcademic(!g.latest_submission_id || v.allow_resubmit, 'INVALID_STATE');
      await this.enrolled(a, o, ms);
      const design = v.design as PBLProject;
      if (c.type === 'SAVE_WORK') {
        const work = groupWork(c.work, design);
        g = { ...g, work, revision: next(g.revision), work_revision: next(g.work_revision) };
        await this.c.query(
          'UPDATE zhiban_pbl.groups SET work=$3,revision=revision+1,work_revision=work_revision+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2',
          [t, g.id, JSON.stringify(work), now],
        );
        await this.journal(a, g, now);
        result = { id: g.id, revision: g.revision, workRevision: g.work_revision };
      } else if (c.type === 'CONFIRM_WORK' || c.type === 'RETRACT_CONFIRMATION') {
        if (c.type === 'CONFIRM_WORK') completeWork(groupWork(g.work, design), design);
        await this.c.query(
          'INSERT INTO zhiban_pbl.confirmations VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,group_id,membership_id) DO UPDATE SET enrollment_id=EXCLUDED.enrollment_id,work_revision=EXCLUDED.work_revision,membership_revision=EXCLUDED.membership_revision,confirmed=EXCLUDED.confirmed,confirmed_at=EXCLUDED.confirmed_at',
          [
            t,
            g.id,
            a.membershipId,
            access.enrollmentId,
            g.work_revision,
            g.membership_revision,
            c.type === 'CONFIRM_WORK',
            now,
          ],
        );
        result = { id: g.id, revision: g.revision, confirmed: c.type === 'CONFIRM_WORK' };
      } else {
        requireAcademic(c.type === 'SUBMIT_GROUP');
        completeWork(groupWork(g.work, design), design);
        requireAcademic(g.submitted_work_revision !== g.work_revision, 'INVALID_STATE');
        requireAcademic(!g.latest_submission_id || v.allow_resubmit, 'INVALID_STATE');
        requireAcademic(v.deadline_at === null || now < Number(v.deadline_at), 'INVALID_STATE');
        const cons = await this.rows(
          'SELECT membership_id,enrollment_id,confirmed_at::text FROM zhiban_pbl.confirmations WHERE tenant_id=$1 AND group_id=$2 AND work_revision=$3 AND membership_revision=$4 AND confirmed',
          [t, g.id, g.work_revision, g.membership_revision],
        );
        requireAcademic(
          ms.every((m) =>
            cons.some(
              (c) => c.membership_id === m.membership_id && c.enrollment_id === m.enrollment_id,
            ),
          ),
          'INVALID_STATE',
        );
        const snapshots = ms.map((m) => ({
          membershipId: m.membership_id,
          enrollmentId: m.enrollment_id,
          displayName: m.display_name,
          confirmedAt: cons.find((c) => c.membership_id === m.membership_id)!.confirmed_at,
        }));
        const id = v7(),
          version = String(
            (
              await this.rows(
                'SELECT count(*)::int AS n FROM zhiban_pbl.submissions WHERE tenant_id=$1 AND group_id=$2',
                [t, g.id],
              )
            )[0].n + 1,
          );
        await this.c.query(
          'INSERT INTO zhiban_pbl.submissions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          [
            t,
            id,
            g.id,
            o,
            p.id,
            g.project_version,
            version,
            g.work_revision,
            g.membership_revision,
            JSON.stringify(g.work),
            JSON.stringify(snapshots),
            pblDigest({ designVersion: g.project_version, work: g.work, members: snapshots }),
            a.membershipId,
            now,
          ],
        );
        await this.c.query(
          'UPDATE zhiban_pbl.groups SET latest_submission_id=$3,submitted_work_revision=work_revision,revision=revision+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2',
          [t, g.id, id, now],
        );
        result = { id, groupId: g.id, version, revision: next(g.revision) };
      }
    }
    await this.c.query('INSERT INTO zhiban_pbl.events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      t,
      v7(),
      o,
      projectId,
      groupId,
      a.membershipId,
      c.type,
      JSON.stringify({
        result,
        reason: 'reason' in c ? c.reason : null,
        workRevision: g?.work_revision ?? null,
        membershipRevision: g?.membership_revision ?? null,
        membersBefore:
          'members' in c
            ? ms.map((m) => ({ membershipId: m.membership_id, enrollmentId: m.enrollment_id }))
            : null,
        membersAfter: 'members' in c ? await this.members(a, g!.id) : null,
        source: studentCommands.includes(c.type) ? 'GROUP_MEMBER_COMMAND' : 'TEACHER_COMMAND',
      }),
      now,
    ]);
    await this.c.query('INSERT INTO zhiban_pbl.commands VALUES($1,$2,$3,$4,$5,$6,$7)', [
      t,
      key,
      o,
      a.membershipId,
      digest,
      JSON.stringify(result),
      now,
    ]);
    if (studentCommands.includes(c.type) && v && v.deadline_at !== null) {
      const end = Number(
        (
          await this.rows('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS n')
        )[0].n,
      );
      requireAcademic(end < Number(v!.deadline_at), 'INVALID_STATE');
    }
    return result;
  }
}
