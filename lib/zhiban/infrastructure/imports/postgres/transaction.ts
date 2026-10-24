import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import {
  requireAcademic,
  type AcademicActor,
  type AcademicCommand,
} from '../../../domain/academic/model';
import type { ImportCommand, ImportKind, ParsedImportRow } from '../../../application/imports/csv';
export interface ImportInspection {
  state: 'READY' | 'SKIP';
  command: ImportCommand;
  expected: string;
  remaining?: number;
}
export interface ImportPreviewRow extends ParsedImportRow {
  state: 'READY' | 'SKIP' | 'BLOCKED';
  expected: string | null;
  remaining?: number;
}
export interface ImportRow {
  line: number;
  label: string;
  command: ImportCommand | null;
  expected: string | null;
  state: 'READY' | 'SKIP' | 'BLOCKED' | 'IMPORTED' | 'SKIPPED' | 'FAILED';
  code: string | null;
  commandKey: string;
}
export interface ImportBatch {
  id: string;
  kind: ImportKind;
  actorId: string;
  createdAt: number;
  expiresAt: number;
  rows: ImportRow[];
}
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class ImportsPgTransaction {
  constructor(
    private readonly db: PoolClient,
    private readonly active: (m: string) => Promise<void>,
    private readonly student: (m: string) => Promise<void>,
  ) {}
  async inspect(
    a: AcademicActor,
    original: ImportCommand,
    write = false,
  ): Promise<ImportInspection> {
    let command = original;
    let state: 'READY' | 'SKIP' = 'READY';
    let facts: unknown = null;
    let remaining: number | undefined;
    const query = async (sql: string, values: unknown[]) => (await this.db.query(sql, values)).rows;
    const one = async (table: string, id: unknown, exclusive = write) => {
      const [r] = await query(
        `SELECT * FROM zhiban_academic.${table} WHERE tenant_id=$1 AND id=$2${table === 'terms' ? '' : exclusive ? ' FOR UPDATE' : ' FOR SHARE'}`,
        [a.tenantId, id],
      );
      requireAcademic(r, 'NOT_FOUND');
      return r;
    };
    if (command.type === 'SAVE_DIRECTORY') {
      await this.active(command.membershipId);
      if (write)
        await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `profile-target:${a.tenantId}:${command.membershipId}:directory`,
        ]);
      const [before] = await query(
        'SELECT formal_name,student_no,employee_no,revision::text FROM zhiban_profile.directory_records WHERE tenant_id=$1 AND membership_id=$2 FOR SHARE',
        [a.tenantId, command.membershipId],
      );
      facts = before ?? null;
      command = { ...command, revision: before?.revision ?? null };
      if (
        before &&
        before.formal_name === command.formalName &&
        before.student_no === command.studentNo &&
        before.employee_no === command.employeeNo
      )
        state = 'SKIP';
      const conflicts = await query(
        "SELECT membership_id FROM zhiban_profile.directory_records WHERE tenant_id=$1 AND membership_id<>$2 AND (($3<>'' AND student_no=$3) OR ($4<>'' AND employee_no=$4)) LIMIT 1",
        [a.tenantId, command.membershipId, command.studentNo, command.employeeNo],
      );
      requireAcademic(conflicts.length === 0, 'CONFLICT');
    } else if (command.type === 'ENROLL' || command.type === 'CLASS_MEMBER') {
      await this.student(String(command.membershipId));
      if (command.type === 'ENROLL') {
        // Same course -> offering resource ordering as the original enrollment transaction.
        const [hint] = await query(
          'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
          [a.tenantId, command.offeringId],
        );
        requireAcademic(hint, 'NOT_FOUND');
        const course = await one('courses', hint.course_id, false),
          offering = await one('offerings', command.offeringId);
        requireAcademic(
          course.status === 'PUBLISHED' && offering.status === 'OPEN',
          'INVALID_STATE',
        );
        const [before] = await query(
          'SELECT status,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 FOR SHARE',
          [a.tenantId, command.offeringId, command.membershipId],
        );
        requireAcademic(!before || before.status === 'ACTIVE', 'INVALID_STATE');
        state = before ? 'SKIP' : 'READY';
        facts = {
          courseRevision: String(course.revision),
          offeringRevision: String(offering.revision),
          before: before ?? null,
        };
        const [count] = await query(
          "SELECT count(*)::int AS n FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND status='ACTIVE'",
          [a.tenantId, command.offeringId],
        );
        remaining = Number(offering.capacity) - Number(count.n);
        requireAcademic(state === 'SKIP' || remaining > 0, 'CAPACITY_FULL');
      } else {
        const classId = command.classId;
        const cls = await one('classes', classId);
        const entries = await query(
          'SELECT class_id,active,revision::text FROM zhiban_academic.class_members WHERE tenant_id=$1 AND membership_id=$2 AND (active OR class_id=$3) ORDER BY class_id FOR SHARE',
          [a.tenantId, command.membershipId, command.classId],
        );
        requireAcademic(
          entries.every((r) => r.class_id === classId && r.active),
          'INVALID_STATE',
        );
        state = entries.length ? 'SKIP' : 'READY';
        facts = { classRevision: String(cls.revision), entries };
      }
    } else {
      const c = command as AcademicCommand;
      const table =
        c.type === 'CREATE_TERM'
          ? 'terms'
          : c.type === 'CREATE_COURSE'
            ? 'courses'
            : c.type === 'CREATE_CLASS'
              ? 'classes'
              : 'offerings';
      if (c.type === 'CREATE_OFFERING') {
        const course = await one('courses', c.courseId);
        requireAcademic(course.status === 'PUBLISHED', 'INVALID_STATE');
        const term = await one('terms', c.termId);
        const cls = c.classId ? await one('classes', c.classId) : null;
        facts = {
          courseRevision: String(course.revision),
          courseVersion: course.published_version,
          termId: term.id,
          classId: cls?.id ?? null,
        };
      }
      const [before] = await query(
        `SELECT ${table === 'terms' ? '*,starts_on::text AS starts_on,ends_on::text AS ends_on' : '*'} FROM zhiban_academic.${table} WHERE tenant_id=$1 AND code=$2${table === 'offerings' ? ' AND term_id=$3' : ''}${table === 'terms' ? '' : ' FOR SHARE'}`,
        table === 'offerings' ? [a.tenantId, c.code, c.termId] : [a.tenantId, c.code],
      );
      if (before) {
        const wanted =
          table === 'terms'
            ? { name: c.name, starts_on: c.startsOn, ends_on: c.endsOn }
            : table === 'courses'
              ? {
                  name: c.name,
                  description: c.description,
                  owner_membership_id: null,
                  status: 'DRAFT',
                }
              : table === 'classes'
                ? { name: c.name }
                : {
                    name: c.name,
                    course_id: c.courseId,
                    term_id: c.termId,
                    class_id: c.classId,
                    capacity: c.capacity,
                    status: 'OPEN',
                  };
        requireAcademic(
          Object.entries(wanted).every(
            ([k, v]) =>
              String(
                before[k] instanceof Date
                  ? (before[k] as Date).toISOString().slice(0, 10)
                  : before[k],
              ) === String(v),
          ),
          'CONFLICT',
        );
        state = 'SKIP';
      }
      facts = { references: facts, before: before ?? null };
    }
    return {
      state,
      command,
      expected: digest(facts),
      ...(remaining === undefined ? {} : { remaining }),
    };
  }
  async create(a: AcademicActor, kind: ImportKind, sourceDigest: string, rows: ImportPreviewRow[]) {
    await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `imports-cap:${a.tenantId}`,
    ]);
    const n = Number(
      (
        await this.db.query('SELECT count(*) AS n FROM zhiban_imports.batches WHERE tenant_id=$1', [
          a.tenantId,
        ])
      ).rows[0].n,
    );
    requireAcademic(n < 10000, 'UNAVAILABLE');
    const id = v7(),
      now = Date.now();
    await this.db.query(
      'INSERT INTO zhiban_imports.batches(tenant_id,id,actor_id,kind,source_digest,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [a.tenantId, id, a.membershipId, kind, sourceDigest, now, now + 1800000],
    );
    for (const row of rows)
      await this.db.query(
        'INSERT INTO zhiban_imports.rows(tenant_id,batch_id,line,label,command,expected,state,code,command_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          a.tenantId,
          id,
          row.line,
          row.label,
          row.command ? JSON.stringify(row.command) : null,
          row.expected,
          row.state,
          row.code,
          `import_${id.replaceAll('-', '')}_${row.line}`,
        ],
      );
    return id;
  }
  async read(a: AcademicActor, id: string, lock = false): Promise<ImportBatch> {
    if (lock)
      await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `import-batch:${a.tenantId}:${id}`,
      ]);
    const [b] = (
      await this.db.query(
        `SELECT id,kind,actor_id AS "actorId",created_at AS "createdAt",expires_at AS "expiresAt" FROM zhiban_imports.batches WHERE tenant_id=$1 AND id=$2 AND actor_id=$3`,
        [a.tenantId, id, a.membershipId],
      )
    ).rows;
    requireAcademic(b, 'NOT_FOUND');
    const rows = (
      await this.db.query(
        'SELECT line,label,command,expected,state,code,command_key AS "commandKey" FROM zhiban_imports.rows WHERE tenant_id=$1 AND batch_id=$2 ORDER BY line',
        [a.tenantId, id],
      )
    ).rows as ImportRow[];
    return { ...b, createdAt: Number(b.createdAt), expiresAt: Number(b.expiresAt), rows };
  }
  async list(a: AcademicActor, after: string | null) {
    return (
      await this.db.query(
        `SELECT b.id,b.kind,b.created_at AS "createdAt",b.expires_at AS "expiresAt",count(*)::int AS total,count(*) FILTER(WHERE r.state IN('IMPORTED','SKIPPED'))::int AS completed,count(*) FILTER(WHERE r.state IN('FAILED','BLOCKED'))::int AS blocked FROM zhiban_imports.batches b JOIN zhiban_imports.rows r ON r.tenant_id=b.tenant_id AND r.batch_id=b.id WHERE b.tenant_id=$1 AND b.actor_id=$2 AND ($3::uuid IS NULL OR b.id<$3) GROUP BY b.tenant_id,b.id ORDER BY b.id DESC LIMIT 21`,
        [a.tenantId, a.membershipId, after],
      )
    ).rows;
  }
  async state(
    a: AcademicActor,
    id: string,
    line: number,
    state: 'IMPORTED' | 'SKIPPED' | 'FAILED',
    code: string | null = null,
  ) {
    const r = await this.db.query(
      "UPDATE zhiban_imports.rows SET state=$4,code=$5 WHERE tenant_id=$1 AND batch_id=$2 AND line=$3 AND state IN('READY','SKIP')",
      [a.tenantId, id, line, state, code],
    );
    requireAcademic(r.rowCount === 1, 'CONFLICT');
  }
}
