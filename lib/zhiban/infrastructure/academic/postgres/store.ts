import { AttainmentPgTransaction } from '../../attainment/postgres/transaction';
import { AutoGradePgTransaction } from '../../autograde/postgres/transaction';
import { EmaPgTransaction } from '../../ema/postgres/transaction';
import { PblPgTransaction } from '../../pbl/postgres/transaction';
import { FlowPgTransaction } from '../../flow/postgres/transaction';
import { FinalgradePgTransaction } from '../../finalgrade/postgres/transaction';
import { ImportsPgTransaction } from '../../imports/postgres/transaction';
import { OnboardingPgTransaction } from '../../onboarding/postgres/transaction';
import { TutorPgTransaction } from '../../tutor/postgres/transaction';
import { LearnerPgTransaction } from '../../learner/postgres/transaction';
import { ConceptPgTransaction } from '../../concept/postgres/transaction';
import { RiskPgTransaction } from '../../risk/postgres/transaction';
import { RemediationPgTransaction } from '../../remediation/postgres/transaction';
import { ReminderPgTransaction } from '../../reminder/postgres/transaction';
import { MaterialPgTransaction } from '../../material/postgres/transaction';
import { ProfilePgTransaction } from '../../profile/postgres/transaction';
import { DiscussionPgTransaction } from '../../discussion/postgres/transaction';
import { QuizPgTransaction } from '../../quiz/postgres/transaction';
import { ClassroomPgTransaction } from '../../classroom/postgres/transaction';
import { CurriculumPgTransaction } from '../../curriculum/postgres/transaction';
import { WorkspacePgTransaction } from '@/lib/zhiban/infrastructure/workspace/postgres/transaction';
import { ManagementPgTransaction } from '@/lib/zhiban/infrastructure/management/postgres/transaction';
import { DirectoryPgTransaction } from '@/lib/zhiban/infrastructure/directory/postgres/transaction';
import {
  enrollmentCommand,
  type RosterInfo,
  type RosterCheck,
  type RosterTransaction,
} from '@/lib/zhiban/application/roster/service';
import { ProgressPgTransaction } from '@/lib/zhiban/infrastructure/progress/postgres/transaction';
import { AssessmentPgTransaction } from '@/lib/zhiban/infrastructure/assessment/postgres/transaction';
import { AnalyticsPgTransaction } from '@/lib/zhiban/infrastructure/analytics/postgres/transaction';
import { LearningPgTransaction } from '@/lib/zhiban/infrastructure/learning/postgres/transaction';
import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { Pool, PoolClient } from 'pg';
import type {
  AcademicContext,
  AcademicSnapshot,
  AcademicStore,
  AcademicTransaction,
} from '@/lib/zhiban/application/academic/service';
import {
  AcademicError,
  academicAdmin,
  academicStudent,
  academicTeacher,
  requireAcademic,
  type AcademicActor,
  type AcademicCommand,
  type AcademicGrant,
} from '@/lib/zhiban/domain/academic/model';
import { membershipId, tenantId } from '@/lib/zhiban/domain/identity';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import type { BridgeSessionSecurity } from '@/lib/zhiban/infrastructure/openmaic/security';
import { BridgeError } from '@/lib/zhiban/infrastructure/openmaic/validation';

type Row = Record<string, unknown>;
const names = [
  'courses',
  'course_versions',
  'terms',
  'classes',
  'class_members',
  'offerings',
  'assignments',
  'enrollments',
  'people',
] as const;
const string = (value: unknown) => String(value);
const equalRevision = (row: Row, revision: unknown) =>
  requireAcademic(row.revision === revision, 'CONFLICT');
class AcademicPgTransaction implements AcademicTransaction {
  readonly pbl: PblPgTransaction;
  readonly flow: FlowPgTransaction;
  readonly finalgrade: FinalgradePgTransaction;
  readonly imports: ImportsPgTransaction;
  readonly onboarding: OnboardingPgTransaction;
  readonly tutor: TutorPgTransaction;
  readonly attainment: AttainmentPgTransaction;
  readonly autograde: AutoGradePgTransaction;
  readonly ema: EmaPgTransaction;
  readonly learner: LearnerPgTransaction;
  readonly concept: ConceptPgTransaction;
  readonly risk: RiskPgTransaction;
  readonly remediation: RemediationPgTransaction;
  readonly reminder: ReminderPgTransaction;
  readonly workspace: WorkspacePgTransaction;
  readonly management: ManagementPgTransaction;
  readonly directory: DirectoryPgTransaction;
  readonly roster: RosterTransaction;
  private readonly rosterGrantDeadlines: number[] = [];
  checkRosterDeadlines(now: number) {
    requireAcademic(
      this.rosterGrantDeadlines.every((t) => now < t),
      'INACTIVE_MEMBER',
    );
  }
  readonly progress: ProgressPgTransaction;
  readonly analytics: AnalyticsPgTransaction;
  readonly material: MaterialPgTransaction;
  readonly profile: ProfilePgTransaction;
  readonly discussion: DiscussionPgTransaction;
  readonly quiz: QuizPgTransaction;
  readonly learning: LearningPgTransaction;
  readonly curriculum: CurriculumPgTransaction;
  readonly classroom: ClassroomPgTransaction;
  readonly assessment: AssessmentPgTransaction;
  constructor(
    private readonly client: PoolClient,
    private readonly identity: PoolClient,
    private readonly actor: AcademicActor,
    private readonly memberStates: Map<string, boolean>,
  ) {
    this.pbl = new PblPgTransaction(client, (m) => this.reminderRecipient(m));
    this.flow = new FlowPgTransaction(client);
    this.finalgrade = new FinalgradePgTransaction(client, (m) => this.reminderRecipient(m));
    this.imports = new ImportsPgTransaction(
      client,
      (m) => this.active(m),
      (m) => this.eligible(m, 'STUDENT'),
    );
    this.onboarding = new OnboardingPgTransaction(client);
    this.tutor = new TutorPgTransaction(client);
    this.attainment = new AttainmentPgTransaction(client, (m) => this.reminderRecipient(m));
    this.autograde = new AutoGradePgTransaction(client, identity);
    this.ema = new EmaPgTransaction(client);
    this.learner = new LearnerPgTransaction(client);
    this.concept = new ConceptPgTransaction(client);
    this.risk = new RiskPgTransaction(client);
    this.remediation = new RemediationPgTransaction(client);
    this.reminder = new ReminderPgTransaction(client);
    this.workspace = new WorkspacePgTransaction(client);
    this.management = new ManagementPgTransaction(client, identity);
    this.directory = new DirectoryPgTransaction(client, identity);
    this.roster = {
      info: (actor, id) => this.rosterInfo(actor, id),
      inspect: (actor, id, member) => this.rosterInspect(actor, id, member),
      enroll: (actor, id, member, revision, key) =>
        this.rosterEnroll(actor, id, member, revision, key),
    };
    this.material = new MaterialPgTransaction(client);
    this.profile = new ProfilePgTransaction(client, identity);
    this.discussion = new DiscussionPgTransaction(client);
    this.quiz = new QuizPgTransaction(client);
    this.learning = new LearningPgTransaction(client);
    this.curriculum = new CurriculumPgTransaction(client);
    this.classroom = new ClassroomPgTransaction(client);
    this.progress = new ProgressPgTransaction(client);
    this.analytics = new AnalyticsPgTransaction(client);
    this.assessment = new AssessmentPgTransaction(client);
  }
  async reminderRecipient(member: string) {
    await this.active(member);
    const { rows } = await this.identity.query(
      "SELECT valid_until FROM zhiban_identity.role_grants WHERE tenant_id=$1 AND membership_id=$2 AND role_code='STUDENT' AND scope_kind='SELF' AND scope_id IS NULL AND revoked_at IS NULL AND valid_from<=$3 AND (valid_until IS NULL OR valid_until>$3) ORDER BY grant_id FOR SHARE",
      [this.actor.tenantId, member, this.actor.now],
    );
    requireAcademic(rows.length > 0, 'INACTIVE_MEMBER');
    this.rosterGrantDeadlines.push(
      Math.max(...rows.map((g) => (g.valid_until === null ? Infinity : Number(g.valid_until)))),
    );
  }
  async rosterInfo(actor: AcademicActor, id: string): Promise<RosterInfo> {
    requireAcademic(academicAdmin(actor), 'FORBIDDEN');
    const offering = await this.offering(id, true);
    const [{ count }] = await this.rows(
      "SELECT count(*)::int AS count FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND status='ACTIVE'",
      [actor.tenantId, id],
    );
    return {
      id,
      name: String(offering.name),
      revision: String(offering.revision),
      capacity: Number(offering.capacity),
      enrolled: Number(count),
    };
  }
  async rosterInspect(actor: AcademicActor, id: string, member: string): Promise<RosterCheck> {
    await this.rosterInfo(actor, id);
    await this.active(member);
    const grants = await this.identity.query(
      "SELECT valid_until FROM zhiban_identity.role_grants WHERE tenant_id=$1 AND membership_id=$2 AND role_code='STUDENT' AND scope_kind='SELF' AND scope_id IS NULL AND revoked_at IS NULL AND valid_from<=$3 AND (valid_until IS NULL OR valid_until>$3) ORDER BY grant_id FOR SHARE",
      [actor.tenantId, member, actor.now],
    );
    requireAcademic(grants.rows.length > 0, 'INACTIVE_MEMBER');
    const deadlines = grants.rows.map((g) =>
      g.valid_until === null ? Infinity : Number(g.valid_until),
    );
    this.rosterGrantDeadlines.push(Math.max(...deadlines));
    const rows = await this.rows(
      'SELECT status FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 FOR SHARE',
      [actor.tenantId, id, member],
    );
    const people = await this.rows(
      'SELECT display_name FROM zhiban_academic.people WHERE tenant_id=$1 AND membership_id=$2',
      [actor.tenantId, member],
    );
    return {
      name: people.length ? String(people[0].display_name) : null,
      status: rows.length ? (rows[0].status === 'ACTIVE' ? 'SKIP' : 'BLOCKED') : 'READY',
      code: rows.length && rows[0].status === 'WITHDRAWN' ? 'REJOIN_MANUALLY' : null,
    };
  }
  async rosterEnroll(
    actor: AcademicActor,
    id: string,
    member: string,
    revision: string,
    key: string,
  ) {
    requireAcademic(academicAdmin(actor), 'FORBIDDEN');
    // Same durable command key resolves a lost COMMIT response without a second Enrollment or audit.
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `academic-command:${actor.tenantId}:${key}`,
    ]);
    const previous = await this.rows(
      'SELECT command_key FROM zhiban_academic.commands WHERE tenant_id=$1 AND command_key=$2',
      [actor.tenantId, key],
    );
    const command = enrollmentCommand(id, member);
    if (previous.length) {
      await this.execute(actor, command, key);
      return;
    }
    const current = await this.rosterInfo(actor, id);
    requireAcademic(current.revision === revision, 'CONFLICT');
    const check = await this.rosterInspect(actor, id, member);
    requireAcademic(check.status === 'READY', 'CONFLICT');
    await this.execute(actor, command, key);
  }
  async rows(sql: string, parameters: unknown[] = []) {
    return (await this.client.query(sql, parameters)).rows as Row[];
  }
  async one(table: (typeof names)[number], id: unknown, lock = false) {
    const rows = await this.rows(
      `SELECT * FROM zhiban_academic.${table} WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
      [this.actor.tenantId, id],
    );
    requireAcademic(rows.length === 1, 'NOT_FOUND');
    return rows[0];
  }
  async active(member: unknown) {
    requireAcademic(
      typeof member === 'string' && this.memberStates.get(member) === true,
      'INACTIVE_MEMBER',
    );
  }
  async eligible(
    member: unknown,
    role: 'TEACHER' | 'STUDENT',
    course: unknown = null,
    offering: unknown = null,
  ) {
    await this.active(member);
    const grants = await this.identity.query(
      `SELECT valid_until FROM zhiban_identity.role_grants WHERE tenant_id=$1 AND membership_id=$2 AND role_code=$3
      AND revoked_at IS NULL AND valid_from<=$4 AND (valid_until IS NULL OR valid_until>$4)
      AND (($3='STUDENT' AND scope_kind='SELF' AND scope_id IS NULL) OR
        ($3='TEACHER' AND ((scope_kind='TENANT' AND scope_id IS NULL) OR
          (scope_kind='COURSE' AND scope_id=$5::uuid) OR (scope_kind='CLASS' AND scope_id=$6::uuid))))`,
      [this.actor.tenantId, member, role, this.actor.now, course, offering],
    );
    requireAcademic(grants.rows.length > 0, 'INACTIVE_MEMBER');
    this.rosterGrantDeadlines.push(
      Math.max(
        ...grants.rows.map((g) => (g.valid_until === null ? Infinity : Number(g.valid_until))),
      ),
    );
  }
  async update(
    table: 'courses' | 'classes' | 'offerings' | 'assignments' | 'enrollments' | 'class_members',
    row: Row,
    fields: Row,
  ) {
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const result = await this.client.query(
      `UPDATE zhiban_academic.${table} SET ${keys.map((key, index) => `${key}=$${index + 4}`).join(',')},revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$3`,
      [this.actor.tenantId, row.id, row.revision, ...values],
    );
    requireAcademic(result.rowCount === 1, 'CONFLICT');
  }
  async offering(id: unknown, joining = false) {
    // Canonical resource locks: course before offering, as in teacher role delegation.
    if (joining) {
      const hint = await this.one('offerings', id);
      const courses = await this.rows(
        'SELECT status FROM zhiban_academic.courses WHERE tenant_id=$1 AND id=$2 FOR SHARE',
        [this.actor.tenantId, hint.course_id],
      );
      requireAcademic(courses.length === 1 && courses[0].status !== 'ARCHIVED', 'INVALID_STATE');
    }
    const row = await this.one('offerings', id, true);
    if (joining) requireAcademic(row.status === 'OPEN', 'INVALID_STATE');
    return row;
  }
  async seats(offering: Row) {
    const count = (
      await this.rows(
        "SELECT count(*)::integer AS count FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND status='ACTIVE'",
        [this.actor.tenantId, offering.id],
      )
    )[0];
    requireAcademic(Number(count.count) < Number(offering.capacity), 'CAPACITY_FULL');
  }
  async addEnrollment(offering: Row, member: unknown, expected: unknown) {
    await this.eligible(member, 'STUDENT');
    const rows = await this.rows(
      'SELECT * FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 FOR UPDATE',
      [this.actor.tenantId, offering.id, member],
    );
    if (rows.length) {
      equalRevision(rows[0], expected);
      requireAcademic(rows[0].status === 'WITHDRAWN', 'CONFLICT');
      await this.seats(offering);
      await this.update('enrollments', rows[0], {
        status: 'ACTIVE',
        valid_from: this.actor.now,
        valid_until: null,
      });
    } else {
      requireAcademic(expected === null, 'CONFLICT');
      await this.seats(offering);
      await this.client.query(
        "INSERT INTO zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id,status,valid_from) VALUES($1,$2,$3,$4,'ACTIVE',$5)",
        [this.actor.tenantId, v7(), offering.id, member, this.actor.now],
      );
    }
  }
  async snapshot(actor: AcademicActor): Promise<AcademicSnapshot> {
    const admin = academicAdmin(actor);
    // One PostgreSQL statement snapshot, including own writes; no mixed publication/roster versions.
    const parts = names.map(
      (name) =>
        `(SELECT coalesce(jsonb_agg(to_jsonb(t)${['course_versions', 'people'].includes(name) ? '' : " || jsonb_build_object('revision',t.revision::text)"}),'[]'::jsonb) FROM (SELECT * FROM zhiban_academic.${name} WHERE tenant_id=$1 ORDER BY ${name === 'people' ? 'membership_id' : 'id'} LIMIT 501) t) AS ${name}`,
    );
    const tables = (await this.rows(`SELECT ${parts.join(',')}`, [actor.tenantId]))[0] as Record<
      (typeof names)[number],
      Row[]
    >;
    for (const table of names) requireAcademic(tables[table].length <= 500, 'UNAVAILABLE');
    const allCourses = tables.courses;
    let offerings = tables.offerings;
    const assigned = tables.assignments.filter(
      (row) => row.membership_id === actor.membershipId && row.status === 'ACTIVE',
    );
    const enrolled = tables.enrollments.filter(
      (row) => row.membership_id === actor.membershipId && row.status === 'ACTIVE',
    );
    if (!admin)
      offerings = offerings.filter(
        (row) =>
          allCourses.some(
            (course) => course.id === row.course_id && course.status !== 'ARCHIVED',
          ) &&
          ((assigned.some((a) => a.offering_id === row.id) &&
            academicTeacher(actor, string(row.course_id), string(row.id))) ||
            (academicStudent(actor) && enrolled.some((e) => e.offering_id === row.id))),
      );
    const offeringIds = new Set(offerings.map((row) => row.id));
    const teacherIds = new Set(
      offerings
        .filter(
          (row) =>
            assigned.some((a) => a.offering_id === row.id) &&
            academicTeacher(actor, string(row.course_id), string(row.id)),
        )
        .map((row) => row.id),
    );
    const courses = admin
      ? allCourses
      : offerings
          .map((row) => {
            const course = allCourses.find((course) => course.id === row.course_id)!;
            const published = tables.course_versions.find(
              (version) => version.id === row.course_id && version.version === row.course_version,
            )!;
            return {
              id: course.id,
              code: course.code,
              name: published.name,
              description: published.description,
              owner_membership_id: published.owner_membership_id,
              status: 'PUBLISHED',
              published_version: row.course_version,
              revision: null,
            };
          })
          .filter(
            (row, index, rows) =>
              rows.findIndex(
                (other) => other.id === row.id && other.published_version === row.published_version,
              ) === index,
          );
    const assignments = admin
      ? tables.assignments
      : tables.assignments.filter(
          (row) => offeringIds.has(row.offering_id) && row.membership_id === actor.membershipId,
        );
    const enrollments = admin
      ? tables.enrollments
      : tables.enrollments.filter(
          (row) =>
            teacherIds.has(row.offering_id) ||
            (offeringIds.has(row.offering_id) && row.membership_id === actor.membershipId),
        );
    const visibleMembers = new Set([
      actor.membershipId,
      ...enrollments.map((row) => row.membership_id),
      ...assignments.map((row) => row.membership_id),
    ]);
    const people = tables.people.filter((row) => admin || visibleMembers.has(row.membership_id));
    if (admin) {
      const members = (
        await this.identity.query(
          `SELECT m.membership_id,m.status,g.role_code FROM zhiban_identity.memberships m LEFT JOIN zhiban_identity.role_grants g ON g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id AND g.revoked_at IS NULL AND g.valid_from<=$2 AND (g.valid_until IS NULL OR g.valid_until>$2) WHERE m.tenant_id=$1 ORDER BY m.membership_id LIMIT 1001`,
          [actor.tenantId, actor.now],
        )
      ).rows;
      requireAcademic(members.length <= 1000, 'UNAVAILABLE');
      for (const person of people) {
        const related = members.filter((member) => member.membership_id === person.membership_id);
        person.status = related[0]?.status ?? 'DISABLED';
        person.roles = [...new Set(related.map((member) => member.role_code).filter(Boolean))];
      }
    }
    const safe = (rows: Row[]) =>
      rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'tenant_id')),
      );
    const visible = (rows: Row[], field: string) =>
      admin ? rows : rows.filter((row) => offerings.some((offering) => offering[field] === row.id));
    const result: AcademicSnapshot = {
      mode: admin
        ? 'ADMIN'
        : actor.grants.some((g) => g.roleCode === 'TEACHER')
          ? 'TEACHER'
          : academicStudent(actor)
            ? 'STUDENT'
            : 'NONE',
      courses: safe(courses),
      terms: safe(visible(tables.terms, 'term_id')),
      classes: safe(visible(tables.classes, 'class_id')),
      offerings: safe(
        offerings.map((row) => ({
          ...row,
          course_name: tables.course_versions.find(
            (v) => v.id === row.course_id && v.version === row.course_version,
          )!.name,
          course_description: tables.course_versions.find(
            (v) => v.id === row.course_id && v.version === row.course_version,
          )!.description,
          enrolled_count: tables.enrollments.filter(
            (e) => e.offering_id === row.id && e.status === 'ACTIVE',
          ).length,
        })),
      ),
      assignments: safe(assignments),
      enrollments: safe(enrollments),
      classMembers: admin ? safe(tables.class_members) : [],
      people: safe(people),
    };
    return result;
  }
  async execute(actor: AcademicActor, command: AcademicCommand, key: string) {
    const payload = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `academic-command:${actor.tenantId}:${key}`,
    ]);
    const previous = await this.rows(
      'SELECT * FROM zhiban_academic.commands WHERE tenant_id=$1 AND command_key=$2',
      [actor.tenantId, key],
    );
    if (previous.length) {
      requireAcademic(
        previous[0].actor_id === actor.membershipId && previous[0].payload_digest === payload,
        'CONFLICT',
      );
      return;
    }
    let before: Row | null = null;
    switch (command.type) {
      case 'CREATE_TERM':
        await this.client.query(
          'INSERT INTO zhiban_academic.terms(tenant_id,id,code,name,starts_on,ends_on) VALUES($1,$2,$3,$4,$5,$6)',
          [actor.tenantId, v7(), command.code, command.name, command.startsOn, command.endsOn],
        );
        break;
      case 'CREATE_CLASS':
        await this.client.query(
          'INSERT INTO zhiban_academic.classes(tenant_id,id,code,name) VALUES($1,$2,$3,$4)',
          [actor.tenantId, v7(), command.code, command.name],
        );
        break;
      case 'CREATE_COURSE':
        if (command.ownerMembershipId !== null) await this.active(command.ownerMembershipId);
        await this.client.query(
          "INSERT INTO zhiban_academic.courses(tenant_id,id,code,name,description,owner_membership_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$7)",
          [
            actor.tenantId,
            v7(),
            command.code,
            command.name,
            command.description,
            command.ownerMembershipId,
            actor.now,
          ],
        );
        break;
      case 'EDIT_COURSE':
      case 'PUBLISH_COURSE':
      case 'ARCHIVE_COURSE': {
        const course = (before = await this.one('courses', command.id, true));
        equalRevision(course, command.revision);
        requireAcademic(course.status !== 'ARCHIVED', 'INVALID_STATE');
        if (command.type === 'EDIT_COURSE') {
          if (command.ownerMembershipId !== null) await this.active(command.ownerMembershipId);
          await this.update('courses', course, {
            name: command.name,
            description: command.description,
            owner_membership_id: command.ownerMembershipId,
            status: 'DRAFT',
            updated_at: actor.now,
          });
        } else if (command.type === 'PUBLISH_COURSE') {
          requireAcademic(course.status === 'DRAFT', 'INVALID_STATE');
          const version = Number(course.published_version) + 1;
          await this.client.query(
            'INSERT INTO zhiban_academic.course_versions(tenant_id,id,version,name,description,owner_membership_id,published_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              actor.tenantId,
              course.id,
              version,
              course.name,
              course.description,
              course.owner_membership_id,
              actor.now,
            ],
          );
          await this.update('courses', course, {
            status: 'PUBLISHED',
            published_version: version,
            updated_at: actor.now,
          });
        } else await this.update('courses', course, { status: 'ARCHIVED', updated_at: actor.now });
        break;
      }
      case 'CLASS_HEAD_TEACHER': {
        const row = (before = await this.one('classes', command.id, true));
        equalRevision(row, command.revision);
        if (command.membershipId !== null) await this.eligible(command.membershipId, 'TEACHER');
        await this.update('classes', row, { head_teacher_id: command.membershipId });
        break;
      }
      case 'CLASS_MEMBER': {
        await this.one('classes', command.classId, true);
        if (command.active) await this.eligible(command.membershipId, 'STUDENT');
        const rows = await this.rows(
          'SELECT * FROM zhiban_academic.class_members WHERE tenant_id=$1 AND class_id=$2 AND membership_id=$3 FOR UPDATE',
          [actor.tenantId, command.classId, command.membershipId],
        );
        before = rows[0] ?? null;
        if (rows.length) {
          equalRevision(rows[0], command.revision);
          await this.update('class_members', rows[0], { active: command.active });
        } else {
          requireAcademic(command.revision === null && command.active === true, 'CONFLICT');
          await this.client.query(
            'INSERT INTO zhiban_academic.class_members(tenant_id,id,class_id,membership_id,active) VALUES($1,$2,$3,$4,true)',
            [actor.tenantId, v7(), command.classId, command.membershipId],
          );
        }
        break;
      }
      case 'CREATE_OFFERING': {
        const course = await this.one('courses', command.courseId, true);
        requireAcademic(course.status === 'PUBLISHED', 'INVALID_STATE');
        await this.one('terms', command.termId);
        if (command.classId !== null) await this.one('classes', command.classId);
        await this.client.query(
          "INSERT INTO zhiban_academic.offerings(tenant_id,id,course_id,course_version,term_id,class_id,code,name,capacity,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN')",
          [
            actor.tenantId,
            v7(),
            course.id,
            course.published_version,
            command.termId,
            command.classId,
            command.code,
            command.name,
            command.capacity,
          ],
        );
        break;
      }
      case 'UPDATE_OFFERING': {
        const row = (before = await this.offering(command.id));
        equalRevision(row, command.revision);
        const count = (
          await this.rows(
            "SELECT count(*)::integer AS count FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND status='ACTIVE'",
            [actor.tenantId, row.id],
          )
        )[0];
        requireAcademic(Number(command.capacity) >= Number(count.count), 'CAPACITY_FULL');
        await this.update('offerings', row, {
          name: command.name,
          capacity: command.capacity,
          status: command.status,
        });
        break;
      }
      case 'ENROLL': {
        const row = await this.offering(command.offeringId, true);
        await this.addEnrollment(row, command.membershipId, command.revision);
        break;
      }
      case 'PREPARE_TEACHER':
      case 'ASSIGN_TEACHER': {
        const row = await this.offering(command.offeringId, true);
        if (command.type === 'PREPARE_TEACHER') await this.active(command.membershipId);
        else await this.eligible(command.membershipId, 'TEACHER', row.course_id, row.id);
        const rows = await this.rows(
          'SELECT * FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 FOR UPDATE',
          [actor.tenantId, row.id, command.membershipId],
        );
        before = rows[0] ?? null;
        if (rows.length) {
          equalRevision(rows[0], command.revision);
          requireAcademic(rows[0].status === 'ENDED', 'CONFLICT');
          await this.update('assignments', rows[0], {
            status: 'ACTIVE',
            valid_from: actor.now,
            valid_until: null,
          });
        } else {
          requireAcademic(command.revision === null, 'CONFLICT');
          await this.client.query(
            "INSERT INTO zhiban_academic.assignments(tenant_id,id,offering_id,membership_id,status,valid_from) VALUES($1,$2,$3,$4,'ACTIVE',$5)",
            [actor.tenantId, v7(), row.id, command.membershipId, actor.now],
          );
        }
        break;
      }
      case 'WITHDRAW':
      case 'END_TEACHER': {
        const table = command.type === 'WITHDRAW' ? 'enrollments' : 'assignments';
        const anchor = await this.one(table, command.id);
        await this.offering(anchor.offering_id);
        const row = (before = await this.one(table, command.id, true));
        equalRevision(row, command.revision);
        requireAcademic(row.status === 'ACTIVE', 'INVALID_STATE');
        await this.update(table, row, {
          status: command.type === 'WITHDRAW' ? 'WITHDRAWN' : 'ENDED',
          valid_until: actor.now,
        });
        break;
      }
      case 'TRANSFER': {
        const anchor = await this.one('enrollments', command.id);
        requireAcademic(anchor.offering_id !== command.targetOfferingId, 'INVALID_INPUT');
        for (const id of [string(anchor.offering_id), string(command.targetOfferingId)].sort())
          await this.offering(id);
        const target = await this.offering(command.targetOfferingId, true);
        const source = await this.one('offerings', anchor.offering_id);
        requireAcademic(
          source.course_id === target.course_id && source.term_id === target.term_id,
          'INVALID_INPUT',
        );
        const row = (before = await this.one('enrollments', command.id, true));
        equalRevision(row, command.revision);
        requireAcademic(row.status === 'ACTIVE', 'INVALID_STATE');
        await this.addEnrollment(target, row.membership_id, command.targetRevision);
        await this.update('enrollments', row, { status: 'WITHDRAWN', valid_until: actor.now });
        break;
      }
    }
    await this.client.query(
      'INSERT INTO zhiban_academic.commands(tenant_id,command_key,actor_id,payload_digest,completed_at) VALUES($1,$2,$3,$4,$5)',
      [actor.tenantId, key, actor.membershipId, payload, actor.now],
    );
    await this.client.query(
      'INSERT INTO zhiban_academic.audit_events(tenant_id,id,actor_id,command_key,event_type,occurred_at,facts) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        actor.tenantId,
        v7(),
        actor.membershipId,
        key,
        command.type,
        actor.now,
        JSON.stringify({ before, command }),
      ],
    );
  }
}

export class PostgresAcademicStore implements AcademicStore {
  constructor(
    private readonly academic: Pool,
    private readonly bridge: Pool,
    private readonly identity: Pool,
    private readonly security: BridgeSessionSecurity,
    private readonly observe: (phase: string, code: string, elapsedMs: number) => void = () => {},
  ) {}
  runForLearnerRecipient<T>(
    context: AcademicContext,
    offering: string,
    id: string,
    dispute: boolean,
    work: (actor: AcademicActor, tx: AcademicTransaction) => Promise<T>,
  ) {
    return this.runGuarded(context, null, work, { offering, learnerId: id, dispute });
  }
  runForConceptRecipient<T>(
    context: AcademicContext,
    offering: string,
    id: string,
    work: (actor: AcademicActor, tx: AcademicTransaction) => Promise<T>,
  ) {
    return this.runGuarded(context, null, work, { offering, conceptId: id });
  }
  runForFollowupRecipient<T>(
    context: AcademicContext,
    offering: string,
    caseId: string,
    work: (actor: AcademicActor, tx: AcademicTransaction) => Promise<T>,
  ) {
    return this.runGuarded(context, null, work, { offering, caseId });
  }
  run<T>(
    context: AcademicContext,
    command: AcademicCommand | null,
    work: (actor: AcademicActor, tx: AcademicTransaction) => Promise<T>,
  ) {
    return this.runGuarded(context, command, work);
  }
  runForRelated<T>(
    context: AcademicContext,
    member: string,
    work: (actor: AcademicActor, transaction: AcademicTransaction) => Promise<T>,
  ) {
    return this.runGuarded(context, null, work, undefined, member);
  }
  runForPbl<T>(
    context: AcademicContext,
    offering: string,
    groupId: string | null,
    proposedMembers: string[],
    work: (actor: AcademicActor, transaction: AcademicTransaction) => Promise<T>,
  ) {
    return this.runGuarded(context, null, work, undefined, undefined, {
      offering,
      groupId,
      proposedMembers,
    });
  }
  private async runGuarded<T>(
    context: AcademicContext,
    command: AcademicCommand | null,
    work: (actor: AcademicActor, transaction: AcademicTransaction) => Promise<T>,
    recipient?:
      | { offering: string; caseId: string }
      | { offering: string; conceptId: string }
      | { offering: string; learnerId: string; dispute: boolean },
    relatedMember?: string,
    pbl?: { offering: string; groupId: string | null; proposedMembers: string[] },
  ): Promise<T> {
    const started = performance.now();
    let phase = 'CONNECT';
    const connections = await Promise.allSettled([
      this.academic.connect(),
      this.bridge.connect(),
      this.identity.connect(),
    ]);
    if (connections.some((result) => result.status === 'rejected')) {
      this.observe(phase, 'CONNECTION_UNAVAILABLE', Math.round(performance.now() - started));
      for (const result of connections)
        if (result.status === 'fulfilled') result.value.release(true);
      throw new AcademicError('UNAVAILABLE');
    }
    const [business, guard, identity] = connections.map(
      (result) => (result as PromiseFulfilledResult<PoolClient>).value,
    );
    let committed = false;
    try {
      phase = 'IDENTITY';
      await business.query('BEGIN');
      await business.query("SELECT set_config('app.tenant_id',$1,true)", [context.tenantId]);
      // Discover immutable participant IDs before taking Identity locks. No business authorization is inferred here.
      let related: string[] = relatedMember ? [relatedMember] : [];
      // Discovery supplies only participant IDs to the existing Identity lock protocol.
      // The PBL transaction rechecks the locked group, exact enrollment and current role.
      if (pbl) {
        related.push(...pbl.proposedMembers);
        if (pbl.groupId) {
          const members = await business.query(
            'SELECT membership_id FROM zhiban_pbl.members WHERE tenant_id=$1 AND offering_id=$2 AND group_id=$3 AND active ORDER BY membership_id LIMIT 21',
            [context.tenantId, pbl.offering, pbl.groupId],
          );
          requireAcademic(members.rows.length <= 10, 'UNAVAILABLE');
          related.push(...members.rows.map((m) => String(m.membership_id)));
        }
      }
      let recipientMember: string | null = null;
      if (recipient) {
        const rows = (
          await business.query(
            'learnerId' in recipient
              ? recipient.dispute
                ? 'SELECT membership_id FROM zhiban_learner.disputes WHERE tenant_id=$1 AND offering_id=$2 AND id=$3'
                : 'SELECT membership_id FROM zhiban_learner.observations WHERE tenant_id=$1 AND offering_id=$2 AND id=$3'
              : 'conceptId' in recipient
                ? 'SELECT membership_id FROM zhiban_concept.corrections WHERE tenant_id=$1 AND offering_id=$2 AND id=$3'
                : 'SELECT membership_id FROM zhiban_followup.cases WHERE tenant_id=$1 AND offering_id=$2 AND id=$3',
            [
              context.tenantId,
              recipient.offering,
              'learnerId' in recipient
                ? recipient.learnerId
                : 'conceptId' in recipient
                  ? recipient.conceptId
                  : recipient.caseId,
            ],
          )
        ).rows;
        requireAcademic(rows.length === 1, 'NOT_FOUND');
        recipientMember = rows[0].membership_id;
        related.push(recipientMember!);
      }
      if (command) {
        const direct = command.membershipId ?? command.ownerMembershipId;
        if (typeof direct === 'string') related.push(direct);
        if (['WITHDRAW', 'TRANSFER', 'END_TEACHER'].includes(command.type)) {
          const table = command.type === 'END_TEACHER' ? 'assignments' : 'enrollments';
          const rows = (
            await business.query(
              `SELECT membership_id FROM zhiban_academic.${table} WHERE tenant_id=$1 AND id=$2`,
              [context.tenantId, command.id],
            )
          ).rows;
          requireAcademic(rows.length === 1, 'FORBIDDEN');
          related.push(rows[0].membership_id);
        }
      }
      related = [...new Set(related)].filter((id) => id !== context.actorMembershipId).sort();
      await guard.query('BEGIN');
      await guard.query("SELECT set_config('app.tenant_id',$1,true)", [context.tenantId]);
      const facts = await (async () => {
        const tenantContext = tenantScopeContext(tenantId(context.tenantId));
        const actorId = membershipId(context.actorMembershipId);
        if (!pbl)
          return this.security.assertCurrent(
            guard,
            context.handle,
            tenantContext,
            actorId,
            related.map(membershipId),
          );
        requireAcademic(related.length <= 20, 'UNAVAILABLE');
        // New PBL preflight acquires every participant row in canonical order. It returns
        // no authorization. Every batch still uses the frozen authenticated Bridge context.
        await guard.query('SELECT zhiban_pbl.lock_participants($1,$2::uuid[])', [
          context.tenantId,
          [context.actorMembershipId, ...related].sort(),
        ]);
        const first = await this.security.assertCurrent(
          guard,
          context.handle,
          tenantContext,
          actorId,
          [],
        );
        const members = new Map(first.members.map((m) => [m.membershipId, m]));
        let evaluatedAt = first.evaluatedAt,
          expiresAt = first.expiresAt;
        for (let i = 0; i < related.length; i += 2) {
          const batch = await this.security.assertCurrent(
            guard,
            context.handle,
            tenantContext,
            actorId,
            related.slice(i, i + 2).map(membershipId),
          );
          requireAcademic(
            batch.tenantRevision === first.tenantRevision &&
              batch.authorizationVersion === first.authorizationVersion,
            'FORBIDDEN',
          );
          for (const m of batch.members) members.set(m.membershipId, m);
          evaluatedAt = Math.max(evaluatedAt, batch.evaluatedAt);
          expiresAt = Math.min(expiresAt, batch.expiresAt);
        }
        return { ...first, evaluatedAt, expiresAt, members: [...members.values()] };
      })();
      const member = facts.members.find((row) => row.membershipId === facts.actor)!;
      const actor: AcademicActor = Object.freeze({
        tenantId: context.tenantId,
        membershipId: member.membershipId,
        userId: member.userId,
        grants: member.grants as unknown as AcademicGrant[],
        now: facts.evaluatedAt,
        expiresAt: facts.expiresAt,
      });
      await identity.query('BEGIN');
      await identity.query("SELECT set_config('app.tenant_id',$1,true)", [context.tenantId]);
      const states = new Map(
        facts.members.map((row) => [
          row.membershipId,
          row.userStatus === 'ACTIVE' && row.membershipStatus === 'ACTIVE',
        ]),
      );
      phase = 'WORK';
      const transaction = new AcademicPgTransaction(business, identity, actor, states);
      if (recipientMember) await transaction.reminderRecipient(recipientMember);
      const result = await work(actor, transaction);
      const now = Number(
        (
          await guard.query(
            'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now',
          )
        ).rows[0].now,
      );
      requireAcademic(
        now < actor.expiresAt &&
          actor.grants.every((grant) => grant.validUntil === null || now < grant.validUntil),
        'FORBIDDEN',
      );
      transaction.checkRosterDeadlines(now);
      phase = 'COMMIT';
      const commit = await business.query('COMMIT');
      requireAcademic(commit.command === 'COMMIT', 'UNAVAILABLE');
      committed = true;
      await identity.query('ROLLBACK');
      await guard.query('ROLLBACK');
      return result;
    } catch (error) {
      const rawCode = (error as { code?: string }).code;
      this.observe(
        phase,
        typeof rawCode === 'string' && /^[A-Z0-9_]{2,40}$/.test(rawCode) ? rawCode : 'UNKNOWN',
        Math.round(performance.now() - started),
      );
      await Promise.allSettled([
        business.query('ROLLBACK'),
        guard.query('ROLLBACK'),
        identity.query('ROLLBACK'),
      ]);
      if (error instanceof AcademicError) throw error;
      if (error instanceof BridgeError) throw new AcademicError('FORBIDDEN');
      const code = (error as { code?: string }).code;
      if (code === '23505' || code === '40001' || code === '40P01')
        throw new AcademicError('CONFLICT');
      if (code === '23503' || code === '23514') throw new AcademicError('INVALID_INPUT');
      throw new AcademicError('UNAVAILABLE');
    } finally {
      business.release(!committed);
      guard.release(!committed);
      identity.release(!committed);
    }
  }
}
