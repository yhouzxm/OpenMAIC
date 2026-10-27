import { readProfileReference, referenceScope } from './pg-version';
import { readFile } from 'node:fs/promises';
import { referenceSourceHash } from './reference-source';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { PostgresTeacherRelationships } from '@/lib/zhiban/infrastructure/teaching/postgres/relationships';
export const teachingMigration =
  'lib/zhiban/infrastructure/teaching/postgres/migrations/0001_teacher_relationships.sql';
export const teachingReference = 'docs/v2/evidence/m5-png-profile-reference-teacher-local.json';
export async function loadTeacherRelationships(pool: Pool) {
  const r = await readProfileReference(teachingReference);
  const hash = createHash('sha256')
    .update(await readFile(teachingMigration))
    .digest('hex');
  if (
    r.evidenceOrigin !== 'LOCAL' ||
    r.scope !== referenceScope('ISOLATED_PG16_PNG_TEACHER_REFERENCE') ||
    referenceSourceHash(r.sourceHashes, teachingMigration) !== hash
  )
    throw Error('Teacher relationship source reference rejected');
  return {
    loader: await PostgresTeacherRelationships.create(pool, r.teacherRelationshipFingerprint),
    fingerprint: r.teacherRelationshipFingerprint as string,
  };
}
