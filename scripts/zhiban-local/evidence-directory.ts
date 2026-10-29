/** A run owns its artifacts; subsequent PG16/PG18 verification must never overwrite prior receipt inputs. */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
export async function authoringEvidenceDirectory(major: 16 | 18) {
  const root = 'docs/v2/evidence/persistence-130/native-authoring-runs';
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, `pg${major}-`));
}
