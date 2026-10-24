import type { QuizService } from '@/lib/zhiban/application/quiz/service';
/** LOCAL disposable generation owns a third database; no old Bridge/Native privilege is widened. */
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { ContentService } from '@/lib/zhiban/infrastructure/content/service';
import { LessonService } from '@/lib/zhiban/infrastructure/lesson/service';
export async function installLesson(input: {
  master: Pool;
  resume?: boolean;
  owned: string;
  socket: string;
  port: number;
  pool(user: string, database: string): Pool;
  content: ContentService;
  quizzes?: QuizService;
}) {
  if (
    !input.owned.startsWith('/tmp/zhiban-trial-content-') ||
    input.socket !== `${input.owned}/socket` ||
    input.port !== 56517
  )
    throw Error('Owned lesson target rejected');
  const role = 'zhiban_lesson_runtime',
    db = 'zhiban_trial_lesson_native';
  if (input.resume) {
    const state = await input.master.query(
      `SELECT r.rolsuper,r.rolinherit,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,r.rolreplication,r.rolcanlogin,d.datname FROM pg_roles r JOIN pg_database d ON d.datdba=r.oid WHERE r.rolname=$1 AND d.datname=$2`,
      [role, db],
    );
    const r = state.rows[0];
    if (
      !r ||
      !r.rolcanlogin ||
      r.rolsuper ||
      r.rolinherit ||
      r.rolcreatedb ||
      r.rolcreaterole ||
      r.rolbypassrls ||
      r.rolreplication
    )
      throw Error('Restored lesson role rejected');
  } else {
    await input.master.query(
      `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`,
    );
    await input.master.query(`CREATE DATABASE ${db} OWNER ${role}`);
    await input.master.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
  }
  // Owned private Unix socket is the only accepted endpoint; no credentials are emitted.
  const url = `postgresql:///${db}?host=${encodeURIComponent(input.socket)}&port=${input.port}&user=${role}`;
  const service = new LessonService(input.content, input.quizzes);
  try {
    await service.initialize(url, input.resume, join(input.owned, 'native-materials'));
  } catch (e) {
    await service.close();
    throw e;
  }
  return service;
}
