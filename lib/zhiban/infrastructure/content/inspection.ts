import type { Pool, PoolClient } from 'pg';
import { PgDocumentStore } from '@openmaic/storage/document/pg';
import { Deadline } from '../openmaic/transactions';
import { canonical, document, draft, hash, id, requireContent } from './model';

export type InspectionScope = {
  tenant: string;
  offering: string;
  resource: string;
  operation: string;
};
export type InspectionAuthority = Readonly<{
  kind: 'LOCAL_SERVICE_INSPECTION';
  purpose: 'CONTENT_PENDING_READ_ONLY';
  serviceRef: string;
  uid: number;
  implementationBindingHash: string;
  installationReceiptSha256: string;
  deploymentId: string;
}>;
/** Infrastructure-only. The local factory owns this authority; no browser route accepts it. */
export function checkScope(scope: InspectionScope) {
  requireContent(Object.keys(scope).sort().join(',') === 'offering,operation,resource,tenant');
  for (const value of Object.values(scope)) id(value);
}
/** A fresh PG-enforced read-only snapshot. No Identity touch, row locks, DDL or mutations. */
export async function readSnapshot<T>(
  pool: Pool,
  tenant: string | null,
  deadline: Deadline,
  body: (client: Pick<PoolClient, 'query'>) => Promise<T>,
): Promise<T> {
  let client: PoolClient | undefined,
    finished = false,
    active = true;
  const connecting = pool.connect();
  try {
    try {
      client = await deadline.wait(connecting);
    } catch (error) {
      void connecting.then(
        (c) => c.release(true),
        () => {},
      );
      throw error;
    }
    const raw = client;
    await deadline.wait(raw.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
    await deadline.wait(raw.query('SET LOCAL search_path=pg_catalog,public,pg_temp'));
    await deadline.wait(raw.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'"));
    const query = async (sql: string, params?: unknown[]) => {
      requireContent(active, 'UNAVAILABLE', 503);
      const left = deadline.remaining();
      await deadline.wait(
        raw.query(
          "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",
          [`${Math.min(5000, left)}ms`, `${Math.min(1000, left)}ms`],
        ),
      );
      requireContent(active, 'UNAVAILABLE', 503);
      return deadline.wait(raw.query(sql, params));
    };
    if (tenant !== null) await query("SELECT set_config('app.tenant_id',$1,true)", [id(tenant)]);
    const result = await deadline.wait(body({ query } as Pick<PoolClient, 'query'>));
    deadline.assert();
    const tag = await query('COMMIT');
    requireContent(tag.command === 'COMMIT', 'UNAVAILABLE', 503);
    finished = true;
    return result;
  } finally {
    active = false;
    if (client) {
      // Destroy failed/expired connections; server rollback cannot stall the caller.
      client.release(!finished);
    }
  }
}
const fingerprint = (value: unknown) => hash(canonical(value));
export class ContentInspector {
  constructor(
    private bridge: Pool,
    private native: Pool,
    private authority: InspectionAuthority,
  ) {
    requireContent(
      authority.kind === 'LOCAL_SERVICE_INSPECTION' &&
        authority.purpose === 'CONTENT_PENDING_READ_ONLY',
    );
    id(authority.deploymentId);
    requireContent(/^[0-9a-f]{64}$/.test(authority.implementationBindingHash));
    requireContent(/^[0-9a-f]{64}$/.test(authority.installationReceiptSha256));
  }
  async list(tenant: string, offering: string, after: string | null = null, limit = 10) {
    id(tenant);
    id(offering);
    if (after !== null) id(after);
    requireContent(Number.isInteger(limit) && limit >= 1 && limit <= 20);
    return readSnapshot(this.bridge, tenant, new Deadline(), async (c) => {
      const rows = (
        await c.query(
          `SELECT o.id AS operation,r.id AS resource,o.state,o.source_revision,o.created_at
        FROM zhiban_content.operations o JOIN zhiban_content.resources r ON r.tenant_id=o.tenant_id AND r.id=o.resource_id
        WHERE o.tenant_id=$1 AND r.offering_id=$2 AND o.action='PUBLISH_CONTENT' AND o.state IN ('RESERVED','OUTCOME_UNKNOWN')
        AND ($3::uuid IS NULL OR o.id>$3::uuid) ORDER BY o.id LIMIT $4`,
          [tenant, offering, after, limit + 1],
        )
      ).rows;
      return {
        rows: rows.slice(0, limit),
        next: rows.length > limit ? rows[limit - 1].operation : null,
      };
    });
  }
  private snapshot(scope: InspectionScope, deadline: Deadline) {
    return readSnapshot(this.bridge, scope.tenant, deadline, async (c) => {
      const row = (
        await c.query(
          `SELECT to_jsonb(r) AS resource,to_jsonb(o) AS operation,
          zhiban_content.draft_digest(r.draft) AS source_digest
        FROM zhiban_content.operations o JOIN zhiban_content.resources r ON r.tenant_id=o.tenant_id AND r.id=o.resource_id
        WHERE o.tenant_id=$1 AND o.id=$2 AND r.id=$3 AND r.offering_id=$4 AND o.action='PUBLISH_CONTENT'`,
          [scope.tenant, scope.operation, scope.resource, scope.offering],
        )
      ).rows[0];
      if (!row) return null;
      // jsonb numbers may exceed JS's exact range. Fetch int8 values again as text.
      const versions = (
        await c.query(
          'SELECT source_revision::text,created_at::text FROM zhiban_content.operations WHERE tenant_id=$1 AND id=$2',
          [scope.tenant, scope.operation],
        )
      ).rows[0];
      const resourceVersion = (
        await c.query(
          'SELECT revision::text FROM zhiban_content.resources WHERE tenant_id=$1 AND id=$2',
          [scope.tenant, scope.resource],
        )
      ).rows[0];
      row.operation.source_revision = versions.source_revision;
      row.operation.created_at = versions.created_at;
      row.resource.revision = resourceVersion.revision;
      const prepare =
        (
          await c.query(
            'SELECT * FROM zhiban_bridge.operations WHERE tenant_id=$1 AND operation_id=$2',
            [scope.tenant, row.operation.prepare_operation_id],
          )
        ).rows[0] ?? null;
      const slot = prepare
        ? ((
            await c.query(
              'SELECT * FROM zhiban_bridge.resource_slots WHERE tenant_id=$1 AND slot_id=$2',
              [scope.tenant, prepare.slot_id],
            )
          ).rows[0] ?? null)
        : null;
      const generation = prepare
        ? ((
            await c.query(
              'SELECT * FROM zhiban_bridge.resource_generations WHERE tenant_id=$1 AND generation_id=$2',
              [scope.tenant, prepare.generation_id],
            )
          ).rows[0] ?? null)
        : null;
      const scenes = generation
        ? (
            await c.query(
              'SELECT * FROM zhiban_bridge.scene_bindings WHERE tenant_id=$1 AND generation_id=$2 ORDER BY scene_ordinal LIMIT 33',
              [scope.tenant, generation.generation_id],
            )
          ).rows
        : [];
      const assets = generation
        ? (
            await c.query(
              'SELECT asset_binding_id FROM zhiban_bridge.asset_bindings WHERE tenant_id=$1 AND generation_id=$2 LIMIT 1',
              [scope.tenant, generation.generation_id],
            )
          ).rows
        : [];
      const activation = row.operation.bridge_operation_id
        ? ((
            await c.query(
              'SELECT * FROM zhiban_bridge.operations WHERE tenant_id=$1 AND operation_id=$2',
              [scope.tenant, row.operation.bridge_operation_id],
            )
          ).rows[0] ?? null)
        : null;
      const deployment =
        (
          await c.query('SELECT * FROM zhiban_bridge.deployment_registry WHERE deployment_id=$1', [
            this.authority.deploymentId,
          ])
        ).rows[0] ?? null;
      return { ...row, prepare, slot, generation, scenes, assets, activation, deployment };
    });
  }
  private expected(s: any) {
    const {
      resource: r,
      operation: o,
      prepare: p,
      slot,
      generation: g,
      scenes,
      assets,
      activation,
      deployment,
    } = s;
    requireContent(p && slot && g && deployment && deployment.state === 'VERIFIED');
    requireContent(
      o.source_revision === r.revision &&
        o.source_digest === s.source_digest &&
        o.expected_native_digest === g.content_digest,
    );
    requireContent(
      p.operation === 'PREPARE_CONTENT' &&
        ['RESERVED', 'OUTCOME_UNKNOWN', 'SUCCEEDED'].includes(p.state),
    );
    requireContent(
      p.actor_kind === 'USER' &&
        p.actor_membership_id === o.actor_id &&
        p.key_digest === o.key_digest &&
        p.intent_digest === o.intent_digest &&
        p.reserved_stage_ref === g.stage_ref,
    );
    requireContent(
      p.slot_id === slot.slot_id &&
        g.slot_id === slot.slot_id &&
        p.generation_id === g.generation_id &&
        g.state === 'PENDING',
    );
    requireContent(
      slot.activity_id === r.id &&
        slot.owner_membership_id === r.created_by &&
        g.owner_membership_id === r.created_by,
    );
    requireContent(
      g.deployment_id === this.authority.deploymentId &&
        slot.deployment_id === this.authority.deploymentId,
    );
    requireContent(
      p.reserved_slot_revision === slot.repository_revision &&
        !activation &&
        o.bridge_operation_id === null,
    );
    requireContent(assets.length === 0 && scenes.length >= 1 && scenes.length <= 32);
    const d = draft(r.draft),
      t = Number(o.created_at);
    requireContent(Number.isSafeInteger(t) && t >= 0 && scenes.length === d.slides.length);
    const expected = document(
      d,
      g.stage_ref,
      scenes.map((scene: any) => scene.scene_ref),
      t,
    );
    requireContent(fingerprint(expected) === o.expected_native_digest);
    requireContent(
      scenes.every(
        (scene: any, i: number) =>
          Number(scene.scene_ordinal) === i &&
          scene.scene_digest === fingerprint(expected.scenes[i]) &&
          scene.generation_id === g.generation_id &&
          scene.tenant_id === g.tenant_id,
      ),
    );
    return expected;
  }
  private nativeObservation(s: any, deadline: Deadline) {
    return readSnapshot(this.native, null, deadline, async (c) => {
      const q = {
        query: async (sql: string, params?: any[]) => ({ rows: (await c.query(sql, params)).rows }),
      };
      const store = new PgDocumentStore(q, {
        ownerId: s.generation.owner_handle,
        trackAssetReferences: true,
        withTransaction: async (work) => work(q),
      });
      const manifest = await store.readFreshnessManifest(s.generation.stage_ref);
      if (manifest === null)
        return { classification: 'NATIVE_NOT_OBSERVED', nativeManifestSha256: null };
      // Public loadDocument takes FOR SHARE and is not valid in READ ONLY.
      // Do not strip its lock, read private Native tables or claim content equality.
      const matched =
        Number.isSafeInteger(manifest.rev) &&
        manifest.rev >= 1 &&
        manifest.scenes.length === s.scenes.length &&
        manifest.scenes.length <= 32 &&
        manifest.scenes.every(
          (scene, i) =>
            scene.id === s.scenes[i].scene_ref &&
            scene.order === i &&
            Number.isSafeInteger(scene.rev) &&
            scene.rev >= 1,
        );
      return {
        classification: matched
          ? 'NATIVE_MANIFEST_MATCHED_CONTENT_UNPROVEN'
          : 'NATIVE_MANIFEST_MISMATCH',
        nativeManifestSha256: fingerprint(manifest),
      };
    });
  }
  async inspect(scope: InspectionScope) {
    checkScope(scope);
    const deadline = new Deadline(),
      startedAt = new Date().toISOString();
    const initial = await this.snapshot(scope, deadline);
    requireContent(initial, 'TARGET_NOT_FOUND', 404);
    let classification = 'NOT_PENDING',
      nativeManifestSha256: string | null = null;
    const before = fingerprint(initial);
    if (['RESERVED', 'OUTCOME_UNKNOWN'].includes(initial.operation.state)) {
      try {
        this.expected(initial);
        classification = 'LOCAL_BINDING_VERIFIED';
      } catch {
        classification = 'LOCAL_BINDING_MISMATCH';
      }
      if (classification === 'LOCAL_BINDING_VERIFIED') {
        try {
          ({ classification, nativeManifestSha256 } = await this.nativeObservation(
            initial,
            deadline,
          ));
        } catch {
          classification = 'NATIVE_UNPROVEN';
        }
      }
    }
    let after: string | null = null;
    try {
      const latest = await this.snapshot(scope, deadline);
      after = latest ? fingerprint(latest) : null;
      if (after !== before) classification = 'LOCAL_STATE_CHANGED';
    } catch {
      classification = 'LOCAL_RECHECK_UNAVAILABLE';
    }
    return {
      formatVersion: 1,
      evidenceOrigin: 'LOCAL',
      kind: 'M5_READ_ONLY_RECONCILIATION_REPORT',
      authority: this.authority,
      scope,
      startedAt,
      finishedAt: new Date().toISOString(),
      classification,
      recorded: {
        state: initial.operation.state,
        sourceRevision: initial.operation.source_revision,
        dispatchRecorded:
          initial.prepare?.dispatch_started_at !== null &&
          initial.prepare?.dispatch_started_at !== undefined,
      },
      localSnapshotBefore: before,
      localSnapshotAfter: after,
      nativeManifestSha256,
      meaning:
        classification === 'NATIVE_MANIFEST_MATCHED_CONTENT_UNPROVEN'
          ? 'Recorded scene IDs/order matched an owner-scoped Native manifest; document content/digest and terminal outcome remain unproven'
          : 'No terminal outcome established',
      fenceAction: 'KEEP',
      settlementAllowed: false,
      replayAllowed: false,
      publicationChanged: false,
      limitations: [
        'Separate database snapshots are not cross-database ACID',
        'Public loadDocument requires a row lock; it is not used and document digest is unproven',
        'Null owner-scoped lookup does not prove absence or failure',
        'No lease, timeout, actor restoration or report clears RESERVED/UNKNOWN',
        'No native refs, content, credentials or raw database errors in this report',
      ],
    };
  }
}
