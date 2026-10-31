/** Installation-only authoring schema. Never imported by the HTTP runtime root. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';
import { APP_SCHEMA_STORES } from '@/lib/persistence/schema-stores';
import { expectedSchemaState } from '../openmaic/schema-state';
import { catalogFingerprint } from '../openmaic/catalog';
import { authoringSecurityFingerprint } from '@/lib/persistence/installed-schema';
import type { InstalledSchemaPolicy } from '@/lib/persistence/installed-schema';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const receipts = {
  zhiban_authoring_schema_receipt: 'lib/zhiban/infrastructure/authoring/schema.sql',
  zhiban_classroom_ai_schema_receipt: 'lib/zhiban/infrastructure/classroom-ai/schema.sql',
  zhiban_published_pbl_receipt: 'lib/zhiban/infrastructure/classroom-ai/pbl-schema.sql',
};
export async function authoringStores() {
  const sets: SchemaMigrationSet[] = [...APP_SCHEMA_STORES];
  for (const [store, name, path] of [
    ['zhiban-course-results', 'trusted-course-evidence', 'course-results'],
    ['zhiban-classroom-live', 'public-presentation-and-course-video', 'classroom-live'],
    ['zhiban-service-center', 'service-audit', 'service-center'],
  ])
    sets.push({
      store,
      migrations: [
        {
          version: 1,
          name,
          up: await readFile(`lib/zhiban/infrastructure/${path}/schema.sql`, 'utf8'),
        },
      ],
    });
  return sets;
}
export async function installAuthoringSchema(c: PoolClient) {
  const identity = (await c.query('SELECT session_user,current_user,current_database() AS db'))
    .rows[0];
  if (
    identity.session_user !== 'zhiban_authoring_migrator' ||
    identity.current_user !== 'zhiban_authoring_owner'
  )
    throw Error('Explicit authoring installation role required');
  if (
    (
      await c.query(
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' LIMIT 1",
      )
    ).rowCount
  )
    throw Error('Fresh authoring installation requires an empty schema; partial target retained');
  const sets = await authoringStores();
  for (const set of sets) await applySchemaMigrations(c, set);
  const receiptDigests: Record<string, string> = {};
  for (const [table, file] of Object.entries(receipts)) {
    const sql = await readFile(file, 'utf8');
    await c.query(sql);
    receiptDigests[table] = hash(sql);
    await c.query(`INSERT INTO public.${table} VALUES(true,$1)`, [hash(sql)]);
  }
  await c.query(`CREATE TABLE zhiban_lesson_runs (
 owner_id text NOT NULL, command_key text NOT NULL, intent_digest text NOT NULL,
 run_id text NOT NULL UNIQUE, tenant_id uuid NOT NULL, offering_id uuid NOT NULL, member_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,command_key)
)`);
  await c.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,zhiban_authoring_runtime');
  await c.query(
    'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,zhiban_authoring_runtime',
  );
  await c.query(
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO zhiban_authoring_runtime',
  );
  // Immutable evidence is append-only, regardless of trigger enforcement.
  for (const table of [
    'zhiban_authoring_snapshots',
    'zhiban_authoring_snapshot_bytes',
    'zhiban_classroom_ai_policy_events',
    'zhiban_published_pbl_events',
    'zhiban_course_result_anchors',
    'zhiban_course_result_proofs',
    'zhiban_course_shared_results',
    'zhiban_course_result_events',
    'zhiban_live_events',
  ])
    await c.query(`REVOKE UPDATE,DELETE ON public.${table} FROM zhiban_authoring_runtime`);
  for (const table of ['openmaic_schema_migrations', ...Object.keys(receipts)])
    await c.query(`REVOKE INSERT,UPDATE,DELETE ON public.${table} FROM zhiban_authoring_runtime`);
  await c.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO zhiban_authoring_runtime');
  const policy: InstalledSchemaPolicy = {
    database: identity.db,
    runtime: 'zhiban_authoring_runtime',
    owner: 'zhiban_authoring_owner',
    fingerprint: await catalogFingerprint(c, 'public'),
    securityFingerprint: await authoringSecurityFingerprint(c),
    ledger: await expectedSchemaState(sets),
    receipts: receiptDigests,
  };
  // This is an observation, not an approval. The installer must compare it with
  // the independently source-built reference before it may publish a receipt.
  return policy;
}
