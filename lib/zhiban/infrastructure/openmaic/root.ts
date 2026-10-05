import type { TransactionPool } from '../identity/postgres/transactions';
import { Pool } from 'pg';
import type { createIdentityComposition } from '../identity/composition/root';
import {
  OpenMAICBridge,
  UnavailableBridgeResourceFacts,
  type BridgeRequest,
  type BridgeAction,
} from '@/lib/zhiban/application/openmaic/bridge';
import { admittedOperation, bridgeTransaction, Deadline } from './transactions';
import { BridgeError, check, digest, opaque, uuid, revision, counter } from './validation';
import { catalogFingerprint, official } from './catalog';

export interface BridgeManifest {
  readonly approvalRef: string;
  readonly identityDatabase: string;
  readonly nativeDatabase: string;
  readonly bridgeFingerprint: string;
  readonly nativeFingerprint: string;
  readonly deploymentId: string;
  readonly sha: typeof official.sha;
  readonly storage: typeof official.storage;
  readonly dsl: typeof official.dsl;
  readonly renderer: typeof official.renderer;
}
async function inspect(
  pool: TransactionPool,
  role: string,
  database: string,
  schema: 'public' | 'zhiban_bridge',
  fingerprint: string,
) {
  await bridgeTransaction(pool, null, new Deadline(), async (client) => {
    await client.query(`SET LOCAL search_path=pg_catalog,${schema},pg_temp`);
    const r = await client.query(
      `SELECT session_user,current_user,current_database() AS db,
      (NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND r.rolcanlogin
       AND NOT has_database_privilege(r.oid,current_database(),'CREATE') AND NOT has_database_privilege(r.oid,current_database(),'TEMPORARY')
       AND NOT has_schema_privilege(r.oid,$1,'CREATE')
       AND NOT EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid)
       AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proowner=r.oid)
       AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
       AND NOT EXISTS(SELECT 1 FROM pg_type WHERE typowner=r.oid)
       AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datdba=r.oid)) AS safe,
      (SELECT count(*)::integer FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS edges,
      current_setting('server_version_num')::integer AS version FROM pg_roles AS r WHERE r.rolname=session_user`,
      [schema],
    );
    check(
      r.rows.length === 1 &&
        r.rows[0].session_user === role &&
        r.rows[0].current_user === role &&
        r.rows[0].db === database &&
        r.rows[0].safe === true &&
        r.rows[0].edges === 0 &&
        typeof r.rows[0].version === 'number' &&
        r.rows[0].version >= 160000 &&
        r.rows[0].version < 170000,
    );
    check((await catalogFingerprint(client, schema)) === fingerprint);
  });
}
/** No enabled flag, business-loader injection, startup DDL or native-store export. */
export async function createBridgeComposition(
  identity: Awaited<ReturnType<typeof createIdentityComposition>>,
  pools: { bridge: TransactionPool; native: TransactionPool },
  manifest: BridgeManifest,
) {
  try {
    check(
      typeof window === 'undefined' &&
        identity?.security !== undefined &&
        pools.bridge !== pools.native,
    );
    opaque(manifest.approvalRef);
    opaque(manifest.identityDatabase);
    opaque(manifest.nativeDatabase);
    check(manifest.identityDatabase !== manifest.nativeDatabase);
    digest(manifest.bridgeFingerprint);
    digest(manifest.nativeFingerprint);
    uuid(manifest.deploymentId);
    for (const key of ['sha', 'storage', 'dsl', 'renderer'] as const)
      check(manifest[key] === official[key]);
    // Supplied pools must be bounded pg.Pools; custom/unbounded structural pools are not admitted in production.
    for (const pool of [pools.bridge, pools.native]) {
      check(pool instanceof Pool);
      const options = (pool as { options?: { max?: number; connectionTimeoutMillis?: number } })
        .options;
      check(
        options?.max === 2 &&
          typeof options.connectionTimeoutMillis === 'number' &&
          options.connectionTimeoutMillis > 0 &&
          options.connectionTimeoutMillis <= 1000,
      );
    }
    await inspect(
      pools.bridge,
      'zhiban_bridge_runtime',
      manifest.identityDatabase,
      'zhiban_bridge',
      manifest.bridgeFingerprint,
    );
    await inspect(
      pools.native,
      'zhiban_openmaic_runtime',
      manifest.nativeDatabase,
      'public',
      manifest.nativeFingerprint,
    );
    await bridgeTransaction(pools.bridge, null, new Deadline(), async (client) => {
      const r = await client.query(
        'SELECT state,official_sha,storage_version,dsl_version,renderer_version,provisioning_digest FROM zhiban_bridge.deployment_registry WHERE deployment_id=$1',
        [manifest.deploymentId],
      );
      const row = r.rows[0];
      check(
        r.rows.length === 1 &&
          row?.state === 'VERIFIED' &&
          row.official_sha === official.sha &&
          row.storage_version === official.storage &&
          row.dsl_version === official.dsl &&
          row.renderer_version === official.renderer &&
          row.provisioning_digest === manifest.nativeFingerprint,
      );
      const gate = await client.query(
        'SELECT zhiban_bridge.business_resource_ready(NULL,NULL) AS ready',
      );
      check(gate.rows[0]?.ready === false);
    });
    const security = identity.security.bridgeSecurity();
    const resources = new UnavailableBridgeResourceFacts();
    const application = new OpenMAICBridge({
      execute: async (_action: BridgeAction, request: BridgeRequest, _input: unknown) => {
        try {
          return await admittedOperation(async (deadline) =>
            bridgeTransaction(pools.bridge, request.context, deadline, async (client) => {
              uuid(request.activityId);
              revision(request.expectedRevision);
              counter(String(request.expectedAuthorizationVersion));
              opaque(request.requestId);
              const facts = await security.assertCurrent(
                client,
                request.handle,
                request.context,
                request.actorMembershipId,
                [],
              );
              check(facts.authorizationVersion === request.expectedAuthorizationVersion);
              check((await resources.load(client, request.activityId)).status === 'UNAVAILABLE');
              // Real Activity schema, catalog and server facts are absent. Never dispatch even for an admin.
              return Object.freeze({ status: 'DENIED' as const });
            }),
          );
        } catch {
          return Object.freeze({ status: 'DENIED' as const });
        }
      },
    });
    return Object.freeze({ application });
  } catch {
    throw new BridgeError();
  }
}
