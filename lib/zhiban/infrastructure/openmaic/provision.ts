import { ensureAssetSchema } from '@openmaic/storage/asset/pg';
import { ensureDocumentSchema } from '@openmaic/storage/document/pg';
import type { TransactionPool } from '../identity/postgres/transactions';
import { bridgeTransaction, Deadline } from './transactions';
import { check, opaque } from './validation';
import { catalogFingerprint, official } from './catalog';
import { digest } from './validation';

/** Explicit maintenance operation; never imported/called by the production root. */
export async function provisionNative(
  pool: TransactionPool,
  expectedDatabase: string,
  approvalRef: string,
) {
  opaque(approvalRef);
  opaque(expectedDatabase);
  return bridgeTransaction(pool, null, new Deadline(), async (client) => {
    const identity = await client.query('SELECT session_user,current_database() AS db');
    check(
      identity.rows[0]?.session_user === 'zhiban_openmaic_migrator' &&
        identity.rows[0]?.db === expectedDatabase,
    );
    const count = await client.query(
      "SELECT count(*)::integer AS n FROM pg_class AS c JOIN pg_namespace AS n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')",
    );
    check(count.rows[0]?.n === 0); // Subsequent maintenance verifies receipt; ensure* is not an upgrade strategy.
    await client.query('SET LOCAL ROLE zhiban_openmaic_owner');
    await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
    const queryable = {
      query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => ({
        rows: (await client.query<R>(sql, params)).rows,
      }),
    };
    await ensureAssetSchema(queryable);
    await ensureDocumentSchema(queryable);
    await client.query(
      'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,zhiban_openmaic_runtime',
    );
    await client.query(
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,zhiban_openmaic_runtime',
    );
    await client.query(
      `GRANT SELECT,INSERT ON document_stages,document_scenes,document_outlines,document_stage_revision,document_scene_revision,asset_blobs,asset_entries,document_asset_refs,asset_reference_tracking TO zhiban_openmaic_runtime`,
    );
    for (const [table, columns] of [
      [
        'document_stages',
        'name,description,interactive_mode,task_engine_mode,created_at,updated_at,data',
      ],
      ['document_scenes', 'scene_order,data'],
      ['document_outlines', 'data'],
      ['document_stage_revision', 'rev'],
      ['document_scene_revision', 'rev'],
      ['asset_blobs', 'byte_size,bytes,unreferenced_at'],
      ['asset_entries', 'committed_at,expires_at,unreferenced_at'],
    ])
      await client.query(`GRANT UPDATE(${columns}) ON ${table} TO zhiban_openmaic_runtime`);
    await client.query(
      'GRANT DELETE ON document_scenes,document_outlines,document_asset_refs,document_asset_withdrawals TO zhiban_openmaic_runtime',
    );
    await client.query(
      'GRANT SELECT(stage_id) ON document_asset_withdrawals TO zhiban_openmaic_runtime',
    );
    return Object.freeze({
      database: expectedDatabase,
      approvalRef,
      ...official,
      fingerprint: await catalogFingerprint(client, 'public'),
    });
  });
}
/** Explicit subsequent maintenance command; it verifies, never runs ensure* on an existing DB. */
export async function verifyNativeProvisioning(
  pool: TransactionPool,
  receipt: Awaited<ReturnType<typeof provisionNative>>,
) {
  opaque(receipt.database);
  opaque(receipt.approvalRef);
  digest(receipt.fingerprint);
  for (const key of ['sha', 'storage', 'dsl', 'renderer'] as const)
    check(receipt[key] === official[key]);
  return bridgeTransaction(pool, null, new Deadline(), async (client) => {
    const r = await client.query('SELECT session_user,current_database() AS db');
    check(
      r.rows[0]?.session_user === 'zhiban_openmaic_migrator' && r.rows[0]?.db === receipt.database,
    );
    await client.query('SET LOCAL ROLE zhiban_openmaic_owner');
    await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
    check((await catalogFingerprint(client, 'public')) === receipt.fingerprint);
    return Object.freeze({ status: 'VERIFIED' as const });
  });
}
