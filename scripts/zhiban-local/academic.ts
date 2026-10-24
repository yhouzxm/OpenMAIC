import { loadClamAv } from '../../lib/zhiban/infrastructure/learning-files/scanner/clamav';
import { loadSubmissionFiles } from './submission-files';
import { loadClassroom } from './classroom';
import { loadCurriculum } from './curriculum';
import { WorkspaceService } from '@/lib/zhiban/application/workspace/service';
import { createWorkspaceHttp } from '@/lib/zhiban/infrastructure/workspace/http';
import { ManagementService } from '@/lib/zhiban/application/management/service';
import { createManagementHttp } from '@/lib/zhiban/infrastructure/management/http';
import { DirectoryService } from '@/lib/zhiban/application/directory/service';
import { createDirectoryHttp } from '@/lib/zhiban/infrastructure/directory/http';
import { RosterService } from '@/lib/zhiban/application/roster/service';
import { createRosterHttp } from '@/lib/zhiban/infrastructure/roster/http';
import { ProgressService } from '@/lib/zhiban/application/progress/service';
import { createProgressHttp } from '@/lib/zhiban/infrastructure/progress/http';
import { AnalyticsService } from '@/lib/zhiban/application/analytics/service';
import { createAnalyticsHttp } from '@/lib/zhiban/infrastructure/analytics/http';
import { loadAssessmentReceipt } from './assessment';
import { AssessmentService } from '@/lib/zhiban/application/assessment/service';
import { createAssessmentHttp } from '@/lib/zhiban/infrastructure/assessment/http';
import { loadLearningReceipt } from './learning';
import { LearningService } from '@/lib/zhiban/application/learning/service';
import { createLearningHttp } from '@/lib/zhiban/infrastructure/learning/http';
import { appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { directory, database, pgPort, digest, privateFile } from './config';
import { academicPolicy } from '@/lib/zhiban/domain/academic/model';
import { AcademicService } from '@/lib/zhiban/application/academic/service';
import { PostgresAcademicStore } from '@/lib/zhiban/infrastructure/academic/postgres/store';
import { createAcademicHttp } from '@/lib/zhiban/infrastructure/academic/http';
import type { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';

export async function loadAcademic(
  security: IdentityAuthentication,
  identityPool: Pool,
  origin: string,
  contentEnabled = false,
  contentRead?: (request: Request) => Promise<Response>,
) {
  let raw: Buffer;
  try {
    raw = await privateFile('academic.json');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  }
  const config = JSON.parse(raw.toString());
  const receipt = JSON.parse((await privateFile('academic-receipt.json')).toString());
  const migration = await readFile(
    resolve('lib/zhiban/infrastructure/academic/postgres/migrations/0001_academic.sql'),
    'utf8',
  );
  if (
    config.mode !== 'LOCAL_SYNTHETIC_M2' ||
    receipt.mode !== config.mode ||
    receipt.configHash !== digest(raw.toString()) ||
    config.migrationHash !== digest(migration) ||
    receipt.migrationHash !== config.migrationHash ||
    config.policyHash !== digest(JSON.stringify(academicPolicy)) ||
    receipt.policyHash !== config.policyHash
  )
    throw new Error('LOCAL M2 receipt/source/policy mismatch.');
  const pools: Pool[] = [];
  try {
    for (const [key, role] of [
      ['academic', 'zhiban_academic_runtime'],
      ['bridge', 'zhiban_bridge_runtime'],
    ]) {
      const url = new URL(config[key]);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        Number(url.port) !== pgPort ||
        url.pathname !== `/${database}` ||
        url.username !== role ||
        url.search
      )
        throw new Error('LOCAL M2 endpoint rejected.');
      const pool = new Pool({
        connectionString: config[key],
        max: 3,
        connectionTimeoutMillis: 3000,
        statement_timeout: 5000,
        idle_in_transaction_session_timeout: 10000,
      });
      pools.push(pool);
      const row = (
        await pool.query(
          `SELECT current_database() AS database,r.rolname,(NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolinherit AND NOT r.rolreplication AND r.rolcanlogin AND NOT has_database_privilege(r.oid,current_database(),'CREATE') AND NOT has_database_privilege(r.oid,current_database(),'TEMP') AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)) AS safe FROM pg_roles r WHERE rolname=session_user`,
        )
      ).rows[0];
      if (!row?.safe || row.database !== database || row.rolname !== role)
        throw new Error('LOCAL M2 runtime ACL rejected.');
    }
    const rows = (
      await pools[0].query('SELECT version,checksum FROM zhiban_academic.schema_migrations')
    ).rows;
    if (
      rows.length !== 1 ||
      rows[0].version !== '0001' ||
      rows[0].checksum !== config.migrationHash
    )
      throw new Error('Academic ledger mismatch.');
    const mutable: Record<string, string[]> = {
      courses: [
        'name',
        'description',
        'owner_membership_id',
        'status',
        'published_version',
        'revision',
        'updated_at',
      ],
      classes: ['head_teacher_id', 'revision'],
      class_members: ['active', 'revision'],
      offerings: ['name', 'capacity', 'status', 'revision'],
      assignments: ['status', 'valid_from', 'valid_until', 'revision'],
      enrollments: ['status', 'valid_from', 'valid_until', 'revision'],
    };
    const tableNames = [
      'courses',
      'course_versions',
      'terms',
      'classes',
      'class_members',
      'offerings',
      'assignments',
      'enrollments',
      'people',
      'commands',
      'audit_events',
    ];
    const tables = (
      await pools[0]
        .query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname AS owner,
      has_table_privilege(c.oid,'SELECT') AS read,has_table_privilege(c.oid,'INSERT') AS insert,
      has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE') OR has_table_privilege(c.oid,'REFERENCES') OR has_table_privilege(c.oid,'TRIGGER') AS extra,
      (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
      (SELECT pg_get_expr(p.polqual,p.polrelid) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_scope') AS using,
      (SELECT pg_get_expr(p.polwithcheck,p.polrelid) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_scope') AS check,
      (SELECT bool_and(p.polcmd='*' AND p.polpermissive AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='zhiban_academic_runtime')]) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_scope') AS policy_roles
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='zhiban_academic' AND c.relkind='r' AND c.relname<> 'schema_migrations'`)
    ).rows;
    if (
      tables.length !== tableNames.length ||
      tables.some(
        (t) =>
          !tableNames.includes(t.relname) ||
          !t.relrowsecurity ||
          !t.relforcerowsecurity ||
          t.owner !== 'zhiban_identity_owner' ||
          !t.read ||
          !t.insert ||
          t.extra ||
          Number(t.policies) !==
            (contentEnabled &&
            ['courses', 'offerings', 'assignments', 'enrollments'].includes(t.relname)
              ? 3
              : 1) ||
          !t.policy_roles ||
          t.using !== '(tenant_id = zhiban_identity.current_tenant_id())' ||
          t.check !== t.using,
      )
    )
      throw new Error('Academic live RLS/table ACL rejected.');
    const columns = (
      await pools[0].query(
        `SELECT c.relname,a.attname,has_column_privilege(c.oid,a.attname,'UPDATE') AS update,has_column_privilege(c.oid,a.attname,'REFERENCES') AS references FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='zhiban_academic' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`,
      )
    ).rows;
    if (
      columns.some(
        (c) => c.references || c.update !== (mutable[c.relname]?.includes(c.attname) ?? false),
      )
    )
      throw new Error('Academic live column ACL rejected.');
    if (
      (
        await pools[0].query(
          `SELECT has_table_privilege('zhiban_identity.memberships','SELECT') OR has_table_privilege('zhiban_identity.sessions','SELECT') OR has_schema_privilege('zhiban_academic','CREATE') AS extra`,
        )
      ).rows[0].extra
    )
      throw new Error('Academic cross-context ACL rejected.');
    const store = new PostgresAcademicStore(
      pools[0],
      pools[1],
      identityPool,
      security.bridgeSecurity(),
      (phase, code, elapsedMs) => {
        void appendFile(
          join(directory, 'academic-operations.jsonl'),
          JSON.stringify({
            mode: 'LOCAL',
            at: new Date().toISOString(),
            phase,
            code,
            elapsedMs,
          }) + '\n',
          { mode: 0o600 },
        ).catch(() => {});
      },
    );
    const handler = createAcademicHttp(new AcademicService(store), security, origin, (code) => {
      void appendFile(
        join(directory, 'academic-operations.jsonl'),
        JSON.stringify({
          mode: 'LOCAL',
          at: new Date().toISOString(),
          phase: 'HTTP_IDENTITY',
          code,
        }) + '\n',
        { mode: 0o600 },
      ).catch(() => {});
    });
    const ready = await loadLearningReceipt(pools[0]);
    const outlineReady = ready && (await loadCurriculum(pools[0]));
    const classroomReady = outlineReady && (await loadClassroom(pools[0]));
    const filesReady = ready && (await loadSubmissionFiles(pools[0]));
    const scannerPath = process.env.ZHIBAN_SCANNER_PROFILE;
    const scannerPin = process.env.ZHIBAN_SCANNER_PROFILE_SHA256;
    if (!!scannerPath !== !!scannerPin) throw Error('Scanner profile and pin required together');
    const scanner = scannerPath ? await loadClamAv(scannerPath, scannerPin!) : null;
    const attachmentsReady = !!(filesReady && scanner);
    const assessmentReady = ready && (await loadAssessmentReceipt(pools[0]));
    return Object.assign(handler, {
      classroomEnabled: classroomReady,
      submissionAttachments: attachmentsReady,
      workspace: createWorkspaceHttp(new WorkspaceService(store), security, origin),
      management: createManagementHttp(
        new AcademicService(store),
        new ManagementService(store),
        security,
        origin,
      ),
      directory: createDirectoryHttp(new DirectoryService(store), security, origin),
      roster: createRosterHttp(new RosterService(store), security, origin),
      progress: assessmentReady
        ? createProgressHttp(new ProgressService(store), security, origin)
        : null,
      analytics: assessmentReady
        ? createAnalyticsHttp(new AnalyticsService(store), security, origin)
        : null,
      assessment: assessmentReady
        ? createAssessmentHttp(
            new AssessmentService(store),
            security,
            origin,
            undefined,
            attachmentsReady,
          )
        : null,
      learning: ready
        ? createLearningHttp(
            new LearningService(store, scanner),
            security,
            origin,
            undefined,
            contentRead,
            outlineReady,
            classroomReady,
            attachmentsReady,
          )
        : null,
    });
  } catch (error) {
    await Promise.all(pools.map((pool) => pool.end()));
    throw error;
  }
}
