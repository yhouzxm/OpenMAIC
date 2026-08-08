import { promises as fs } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';
import { getZhibanPool } from '@/lib/zhiban/db/connection';

export const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');
export const CLASSROOM_JOBS_DIR = path.join(process.cwd(), 'data', 'classroom-jobs');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureClassroomsDir() {
  await ensureDir(CLASSROOMS_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDir(CLASSROOM_JOBS_DIR);
}

export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempFilePath, content, 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

export function buildRequestOrigin(req: NextRequest): string {
  return req.headers.get('x-forwarded-host')
    ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin;
}

export interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  createdAt: string;
  documentState?: Record<string, unknown>;
  revision?: number;
}

export function isValidClassroomId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export async function readClassroom(id: string): Promise<PersistedClassroomData | null> {
  if (!isValidClassroomId(id)) throw new Error('Invalid classroom id');
  const result = await getZhibanPool().query<Record<string, unknown>>(
    `SELECT classroom_id,stage,scenes,document_state,revision,created_at FROM zhiban.openmaic_classroom_documents WHERE classroom_id=$1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    // One-time compatibility import for classrooms created before migration
    // 019. The PostgreSQL row becomes authoritative immediately; the legacy
    // file remains only so media cleanup and rollback stay recoverable.
    const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
    try {
      const legacy = JSON.parse(await fs.readFile(filePath, 'utf-8')) as PersistedClassroomData;
      const binding = await getZhibanPool().query<{ tenant_id: string }>(
        `SELECT tenant_id FROM zhiban.course_classrooms WHERE classroom_id=$1 ORDER BY created_at LIMIT 1`, [id],
      );
      const imported = await persistClassroom({ id, stage: legacy.stage, scenes: legacy.scenes, tenantId: binding.rows[0]?.tenant_id }, '');
      const { url: _url, ...classroom } = imported;
      return classroom;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  return { id: String(row.classroom_id), stage: row.stage as Stage, scenes: row.scenes as Scene[],
    documentState: row.document_state as Record<string, unknown>, revision: Number(row.revision),
    createdAt: new Date(row.created_at as string).toISOString() };
}

export async function deletePersistedClassroom(id: string): Promise<boolean> {
  if (!isValidClassroomId(id)) throw new Error('Invalid classroom id');
  const root = path.resolve(CLASSROOMS_DIR);
  const jsonPath = path.resolve(root, `${id}.json`);
  const mediaPath = path.resolve(root, id);
  if (path.dirname(jsonPath) !== root || path.dirname(mediaPath) !== root)
    throw new Error('Classroom path escaped storage root');
  let deleted = false;
  const removed = await getZhibanPool().query<{ classroom_id: string }>(
    `DELETE FROM zhiban.openmaic_classroom_documents WHERE classroom_id=$1 RETURNING classroom_id`, [id],
  );
  deleted = Boolean(removed.rows[0]);
  try {
    await fs.unlink(jsonPath);
    deleted = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await fs.rm(mediaPath, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return deleted;
}

export async function persistClassroom(
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
    tenantId?: string;
    actorId?: string;
    documentState?: Record<string, unknown>;
  },
  baseUrl: string,
): Promise<PersistedClassroomData & { url: string }> {
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
  };

  const stored = await getZhibanPool().query<{ revision: string; created_at: string }>(
    `INSERT INTO zhiban.openmaic_classroom_documents(classroom_id,tenant_id,stage,scenes,document_state,created_by,updated_by)
     VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$6)
     ON CONFLICT(classroom_id) DO UPDATE SET tenant_id=COALESCE(EXCLUDED.tenant_id,zhiban.openmaic_classroom_documents.tenant_id),
       stage=EXCLUDED.stage,scenes=EXCLUDED.scenes,document_state=EXCLUDED.document_state,
       revision=zhiban.openmaic_classroom_documents.revision+1,updated_by=COALESCE(EXCLUDED.updated_by,zhiban.openmaic_classroom_documents.updated_by),updated_at=now()
     RETURNING revision::text,created_at`,
    [data.id, data.tenantId ?? null, JSON.stringify(data.stage), JSON.stringify(data.scenes), JSON.stringify(data.documentState ?? {}), data.actorId ?? null],
  );
  classroomData.documentState = data.documentState ?? {};
  classroomData.revision = Number(stored.rows[0].revision);
  classroomData.createdAt = new Date(stored.rows[0].created_at).toISOString();

  return {
    ...classroomData,
    url: `${baseUrl}/classroom/${data.id}`,
  };
}
