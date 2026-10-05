import { v7 } from 'uuid';
import { planCandidate, consumeCandidate, type CandidateIntention } from './candidate';
import type { BridgePgClient } from './transactions';
import {
  check,
  counter,
  digest,
  instant,
  opaque,
  principal,
  revision,
  successor,
  uuid,
} from './validation';
import {
  generationColumns,
  generationRecord,
  operationColumns,
  operationRecord,
  slotColumns,
  slotRecord,
  sceneColumns,
  sceneRecord,
  assetColumns,
  assetRecord,
} from './records';

export interface Actor {
  readonly user: string;
  readonly member: string;
  readonly authorizationVersion: number;
  readonly requestId: string;
}
export interface Reservation {
  readonly slotId: string;
  readonly expectedRevision: string;
  readonly keyDigest: string;
  readonly intentDigest: string;
  readonly operation:
    | 'PREPARE_CONTENT'
    | 'PREPARE_ASSET'
    | 'ACTIVATE_GENERATION'
    | 'SUSPEND'
    | 'RETIRE'
    | 'TRANSFER';
  readonly generationId?: string;
  readonly contentDigest?: string;
  readonly sceneIntents?: readonly { ref: string; ordinal: number; digest: string }[];
  readonly targetOwner?: string;
  readonly candidate?: CandidateIntention;
}
type Operation = ReturnType<typeof operationRecord>;
/** Same-client primitive. Its caller holds current identity/business and slot locks. */
export class BridgeRepository {
  constructor(
    readonly client: BridgePgClient,
    readonly tenant: string,
  ) {
    uuid(tenant);
  }
  private async changed(sql: string, params: unknown[], command: string) {
    const r = await this.client.query(sql, params);
    check(r.command === command && r.rowCount === 1);
  }
  async loadSlot(id: string, mode: 'SHARE' | 'UPDATE') {
    const r = await this.client.query(
      `SELECT ${slotColumns} FROM zhiban_bridge.resource_slots WHERE tenant_id=$1 AND slot_id=$2 FOR ${mode}`,
      [this.tenant, uuid(id)],
    );
    check(r.command === 'SELECT' && r.rowCount === 1);
    const slot = slotRecord(r.rows[0], this.tenant);
    const facts = await this.client.query(
      `SELECT coalesce(max(generation),0)::text AS maximum,count(*) FILTER(WHERE state='ACTIVE')::integer AS active,count(*) FILTER(WHERE state='ACTIVE' AND generation_id=$3 AND owner_membership_id=$4)::integer AS current FROM zhiban_bridge.resource_generations WHERE tenant_id=$1 AND slot_id=$2`,
      [this.tenant, id, slot.active_generation_id, slot.owner_membership_id],
    );
    check(
      facts.command === 'SELECT' &&
        facts.rowCount === 1 &&
        facts.rows[0]?.maximum === slot.generation &&
        facts.rows[0].active === (slot.active_generation_id === null ? 0 : 1) &&
        facts.rows[0].current === (slot.active_generation_id === null ? 0 : 1),
    );
    return slot;
  }
  async loadGeneration(id: string) {
    const r = await this.client.query(
      `SELECT ${generationColumns} FROM zhiban_bridge.resource_generations WHERE tenant_id=$1 AND generation_id=$2 FOR UPDATE`,
      [this.tenant, uuid(id)],
    );
    check(r.command === 'SELECT' && r.rowCount === 1);
    return generationRecord(r.rows[0], this.tenant);
  }
  async loadOperation(id: string) {
    const locator = await this.client.query(
      `SELECT slot_id,generation_id FROM zhiban_bridge.operations WHERE tenant_id=$1 AND operation_id=$2`,
      [this.tenant, uuid(id)],
    );
    check(locator.rowCount === 1 && locator.rows.length === 1);
    await this.loadSlot(String(locator.rows[0].slot_id), 'UPDATE');
    if (locator.rows[0].generation_id !== null)
      await this.loadGeneration(String(locator.rows[0].generation_id));
    const r = await this.client.query(
      `SELECT ${operationColumns} FROM zhiban_bridge.operations WHERE tenant_id=$1 AND operation_id=$2 FOR UPDATE`,
      [this.tenant, uuid(id)],
    );
    check(r.command === 'SELECT' && r.rowCount === 1);
    return operationRecord(r.rows[0], this.tenant);
  }
  /** Infrastructure material only; caller has already locked fresh identity/resource authority. */
  async candidateBindings(generationId: string) {
    const scenes = await this.client.query(
      `SELECT ${sceneColumns} FROM zhiban_bridge.scene_bindings WHERE tenant_id=$1 AND generation_id=$2 ORDER BY scene_ordinal`,
      [this.tenant, uuid(generationId)],
    );
    const assets = await this.client.query(
      `SELECT ${assetColumns} FROM zhiban_bridge.asset_bindings WHERE tenant_id=$1 AND generation_id=$2 ORDER BY asset_binding_id`,
      [this.tenant, generationId],
    );
    check(
      scenes.rowCount === scenes.rows.length && scenes.rows.length >= 1 && scenes.rows.length <= 64,
    );
    check(assets.rowCount === assets.rows.length && assets.rows.length <= 2048);
    const mappedScenes = scenes.rows.map((r, i) => {
      const scene = sceneRecord(r, this.tenant);
      check(scene.ordinal === i && scene.generation_id === generationId);
      return scene;
    });
    const mappedAssets = assets.rows.map((r) => {
      const asset = assetRecord(r, this.tenant);
      check(asset.generation_id === generationId);
      return asset;
    });
    check(
      new Set(mappedScenes.map((s) => s.scene_binding_id)).size === mappedScenes.length &&
        new Set(mappedScenes.map((s) => s.scene_ref)).size === mappedScenes.length,
    );
    check(new Set(mappedAssets.map((a) => a.asset_ref)).size === mappedAssets.length);
    check(mappedAssets.reduce((total, a) => total + a.length, 0) <= 33554432);
    for (const scene of mappedScenes)
      check(mappedAssets.filter((a) => a.scene_binding_id === scene.scene_binding_id).length <= 32);
    check(
      mappedAssets.every((a) =>
        mappedScenes.some((s) => s.scene_binding_id === a.scene_binding_id),
      ),
    );
    return Object.freeze({
      scenes: Object.freeze(mappedScenes),
      assets: Object.freeze(mappedAssets),
    });
  }
  async activeSnapshot(slotId: string, expected: string) {
    const slot = await this.loadSlot(slotId, 'SHARE');
    check(
      slot.revision === revision(expected) &&
        slot.state === 'ENABLED' &&
        slot.active_generation_id !== null,
    );
    const result = await this.client.query(
      `SELECT ${generationColumns} FROM zhiban_bridge.resource_generations WHERE tenant_id=$1 AND generation_id=$2 FOR SHARE`,
      [this.tenant, slot.active_generation_id],
    );
    check(result.rowCount === 1 && result.rows.length === 1);
    const generation = generationRecord(result.rows[0], this.tenant);
    check(
      generation.state === 'ACTIVE' &&
        generation.slot_id === slotId &&
        generation.owner_membership_id === slot.owner_membership_id &&
        generation.deployment_id === slot.deployment_id,
    );
    const bindings = await this.candidateBindings(String(generation.generation_id));
    check(
      bindings.assets.every(
        (a) =>
          a.deployment_id === generation.deployment_id &&
          a.principal_handle === generation.owner_handle,
      ),
    );
    return Object.freeze({ slot, generation, ...bindings });
  }
  async createSlot(activity: string, deployment: string, owner: string, at: number) {
    const id = uuid(v7());
    instant(at);
    await this.changed(
      "INSERT INTO zhiban_bridge.resource_slots(tenant_id,slot_id,activity_id,deployment_id,owner_membership_id,state,last_generation,active_generation_id,repository_revision,created_at,updated_at,retired_at) VALUES($1,$2,$3,$4,$5,'SUSPENDED',0,NULL,1,$6,$6,NULL)",
      [this.tenant, id, uuid(activity), uuid(deployment), uuid(owner), at.toString()],
      'INSERT',
    );
    return id;
  }
  async reserve(plan: Reservation, actor: Actor, at: number) {
    uuid(actor.user);
    uuid(actor.member);
    opaque(actor.requestId);
    counter(String(actor.authorizationVersion));
    instant(at);
    const slot = await this.loadSlot(plan.slotId, 'UPDATE');
    check(slot.revision === revision(plan.expectedRevision) && slot.state !== 'RETIRED'); // stale before replay/no-op
    const replay = await this.client.query(
      `SELECT ${operationColumns} FROM zhiban_bridge.operations WHERE tenant_id=$1 AND actor_key=$2 AND slot_id=$3 AND operation=$4 AND key_digest=$5 FOR UPDATE`,
      [this.tenant, `user:${actor.user}`, plan.slotId, plan.operation, digest(plan.keyDigest)],
    );
    check(replay.rowCount === replay.rows.length && replay.rows.length <= 1);
    if (replay.rows.length) {
      const row = operationRecord(replay.rows[0], this.tenant);
      check(
        row.intent_digest === digest(plan.intentDigest) &&
          row.expected_authorization_version === actor.authorizationVersion.toString() &&
          row.state === 'SUCCEEDED' &&
          row.result_slot_revision === slot.revision,
      );
      return Object.freeze({ operation: row, dispatched: false as const });
    }
    const next = successor(slot.revision),
      id = uuid(v7()),
      content = ['PREPARE_CONTENT', 'TRANSFER'].includes(plan.operation);
    let generationId: string | null = plan.generationId ? uuid(plan.generationId) : null,
      stage: string | null = null,
      gen = slot.generation;
    if (content) {
      check(
        plan.contentDigest !== undefined &&
          plan.sceneIntents !== undefined &&
          plan.sceneIntents.length >= 1 &&
          plan.sceneIntents.length <= 64,
      );
      gen = slot.generation === '0' ? revision('1') : successor(slot.generation);
      const candidate = consumeCandidate(plan.candidate ?? planCandidate());
      generationId = candidate.generationId;
      stage = candidate.stageRef;
      const owner =
        plan.operation === 'TRANSFER' ? uuid(plan.targetOwner) : slot.owner_membership_id;
      check(plan.operation !== 'TRANSFER' || owner !== slot.owner_membership_id);
      await this.changed(
        `INSERT INTO zhiban_bridge.resource_generations(tenant_id,generation_id,slot_id,deployment_id,owner_membership_id,generation,owner_handle,stage_ref,content_digest,dsl_version,state,repository_revision,created_at,updated_at,activated_at,terminal_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'0.11.2','PENDING',1,$10,$10,NULL,NULL)`,
        [
          this.tenant,
          generationId,
          plan.slotId,
          slot.deployment_id,
          owner,
          gen,
          candidate.ownerHandle,
          stage,
          digest(plan.contentDigest),
          at.toString(),
        ],
        'INSERT',
      );
      for (const scene of plan.sceneIntents)
        await this.changed(
          `INSERT INTO zhiban_bridge.scene_bindings(tenant_id,scene_binding_id,generation_id,scene_ref,scene_ordinal,scene_digest,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            this.tenant,
            uuid(v7()),
            generationId,
            opaque(scene.ref),
            scene.ordinal,
            digest(scene.digest),
            at.toString(),
          ],
          'INSERT',
        );
    } else if (generationId !== null) {
      const g = await this.loadGeneration(generationId);
      check(g.slot_id === plan.slotId);
      if (plan.operation === 'PREPARE_ASSET') check(g.state === 'PENDING');
    }
    await this.changed(
      'UPDATE zhiban_bridge.resource_slots SET last_generation=$1,repository_revision=$2,updated_at=$3,state=$7 WHERE tenant_id=$4 AND slot_id=$5 AND repository_revision=$6',
      [
        gen,
        next,
        at.toString(),
        this.tenant,
        plan.slotId,
        slot.revision,
        plan.operation === 'TRANSFER' ? 'TRANSFERRING' : slot.state,
      ],
      'UPDATE',
    );
    await this.changed(
      `INSERT INTO zhiban_bridge.operations(tenant_id,operation_id,slot_id,generation_id,actor_kind,actor_user_id,actor_membership_id,service_ref,operation,actor_key,key_digest,intent_digest,expected_slot_revision,reserved_slot_revision,expected_authorization_version,state,repository_revision,reserved_stage_ref,result_asset_ref,result_generation_id,result_slot_revision,created_at,updated_at,dispatch_started_at,completed_at,reason) VALUES($1,$2,$3,$4,'USER',$5,$6,NULL,$7,$8,$9,$10,$11,$12,$13,'RESERVED',1,$14,NULL,NULL,NULL,$15,$15,NULL,NULL,'NONE')`,
      [
        this.tenant,
        id,
        plan.slotId,
        generationId,
        actor.user,
        actor.member,
        plan.operation,
        `user:${actor.user}`,
        digest(plan.keyDigest),
        digest(plan.intentDigest),
        slot.revision,
        next,
        actor.authorizationVersion.toString(),
        stage,
        at.toString(),
      ],
      'INSERT',
    );
    const op = await this.loadOperation(id);
    await this.audit(
      op,
      plan.operation === 'TRANSFER' ? 'TRANSFER_STARTED' : 'GENERATION_RESERVED',
      slot.revision,
      next,
      actor.requestId,
      at,
    );
    return Object.freeze({ operation: op, dispatched: true as const });
  }
  async markDispatch(op: Operation, at: number) {
    const slot = await this.loadSlot(String(op.slot_id), 'UPDATE');
    check(
      slot.revision === op.reserved_slot_revision &&
        op.state === 'RESERVED' &&
        op.dispatch_started_at === null,
    );
    const claim = await this.client.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('zhiban-bridge-dispatch:'||$1::text,0)) AS acquired",
      [op.operation_id],
    );
    check(claim.rows[0]?.acquired === true);
    successor(op.revision);
    await this.changed(
      `UPDATE zhiban_bridge.operations SET dispatch_started_at=$1,updated_at=$1,repository_revision=repository_revision+1 WHERE tenant_id=$2 AND operation_id=$3 AND repository_revision=$4 AND state='RESERVED' AND dispatch_started_at IS NULL`,
      [instant(at).toString(), this.tenant, op.operation_id, op.revision],
      'UPDATE',
    );
    return this.loadOperation(String(op.operation_id));
  }
  async finish(
    op: Operation,
    state: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN',
    reason:
      | 'NONE'
      | 'DENIED'
      | 'STALE'
      | 'INVALID_CONTENT'
      | 'STORAGE_FAILURE'
      | 'UNKNOWN_OUTCOME'
      | 'INTEGRITY_FAILURE',
    event: string,
    requestId: string,
    at: number,
    assetRef: string | null = null,
  ) {
    const slot = await this.loadSlot(String(op.slot_id), 'UPDATE');
    const mutated = ['ACTIVATE_GENERATION', 'SUSPEND', 'RETIRE', 'TRANSFER'].includes(
      String(op.operation),
    );
    check(
      slot.revision ===
        (state === 'SUCCEEDED' && mutated
          ? successor(String(op.reserved_slot_revision))
          : op.reserved_slot_revision),
    );
    successor(op.revision);
    check(
      op.state === 'RESERVED' ||
        (op.state === 'OUTCOME_UNKNOWN' &&
          event === 'OUTCOME_RECONCILED' &&
          state !== 'OUTCOME_UNKNOWN'),
    );
    check(
      state === 'SUCCEEDED'
        ? reason === 'NONE'
        : state === 'OUTCOME_UNKNOWN'
          ? reason === 'UNKNOWN_OUTCOME'
          : reason !== 'NONE',
    );
    const successEvents: Record<string, string> = {
      PREPARE_CONTENT: 'GENERATION_PREPARED',
      PREPARE_ASSET: 'GENERATION_PREPARED',
      ACTIVATE_GENERATION: 'GENERATION_ACTIVATED',
      SUSPEND: 'MAPPING_SUSPENDED',
      RETIRE: 'MAPPING_RETIRED',
      TRANSFER: 'TRANSFER_COMPLETED',
    };
    check(
      event ===
        (op.state === 'OUTCOME_UNKNOWN'
          ? 'OUTCOME_RECONCILED'
          : state === 'SUCCEEDED'
            ? successEvents[String(op.operation)]
            : state === 'OUTCOME_UNKNOWN'
              ? 'OUTCOME_QUARANTINED'
              : 'OPERATION_FAILED'),
    );
    await this.changed(
      `UPDATE zhiban_bridge.operations SET state=$1,reason=$2,updated_at=$3,completed_at=$4,result_asset_ref=$5,result_generation_id=$6,result_slot_revision=$7,repository_revision=repository_revision+1 WHERE tenant_id=$8 AND operation_id=$9 AND repository_revision=$10 AND state=$11`,
      [
        state,
        reason,
        instant(at).toString(),
        state === 'OUTCOME_UNKNOWN' ? null : at.toString(),
        assetRef === null ? null : opaque(assetRef),
        state === 'SUCCEEDED' ? op.generation_id : null,
        state === 'SUCCEEDED' ? slot.revision : null,
        this.tenant,
        op.operation_id,
        op.revision,
        op.state,
      ],
      'UPDATE',
    );
    await this.audit(
      await this.loadOperation(String(op.operation_id)),
      event,
      slot.revision,
      slot.revision,
      requestId,
      at,
    );
  }
  async activate(slotId: string, generationId: string, expected: string, at: number) {
    const slot = await this.loadSlot(slotId, 'UPDATE');
    check(slot.revision === revision(expected) && slot.state !== 'RETIRED');
    const g = await this.loadGeneration(generationId);
    check(
      g.slot_id === slotId &&
        g.state === 'PENDING' &&
        (g.owner_membership_id === slot.owner_membership_id || slot.state === 'TRANSFERRING'),
    );
    successor(g.revision);
    const next = successor(slot.revision);
    const prepared = await this.client.query(
      `SELECT operation_id FROM zhiban_bridge.operations WHERE tenant_id=$1 AND slot_id=$2 AND generation_id=$3 AND (state='SUCCEEDED' AND operation='PREPARE_CONTENT' OR state IN ('RESERVED','SUCCEEDED') AND operation='TRANSFER') AND dispatch_started_at IS NOT NULL`,
      [this.tenant, slotId, generationId],
    );
    check(prepared.command === 'SELECT' && prepared.rows.length === 1);
    if (slot.active_generation_id !== null) {
      const old = await this.loadGeneration(String(slot.active_generation_id));
      successor(old.revision);
      await this.changed(
        `UPDATE zhiban_bridge.resource_generations SET state='RETIRED',terminal_at=$1,updated_at=$1,repository_revision=repository_revision+1 WHERE tenant_id=$2 AND generation_id=$3 AND repository_revision=$4 AND state='ACTIVE'`,
        [instant(at).toString(), this.tenant, old.generation_id, old.revision],
        'UPDATE',
      );
    }
    await this.changed(
      `UPDATE zhiban_bridge.resource_generations SET state='ACTIVE',activated_at=$1,updated_at=$1,repository_revision=repository_revision+1 WHERE tenant_id=$2 AND generation_id=$3 AND repository_revision=$4 AND state='PENDING'`,
      [instant(at).toString(), this.tenant, generationId, g.revision],
      'UPDATE',
    );
    await this.changed(
      `UPDATE zhiban_bridge.resource_slots SET state='ENABLED',active_generation_id=$1,repository_revision=$2,updated_at=$3,owner_membership_id=$7 WHERE tenant_id=$4 AND slot_id=$5 AND repository_revision=$6`,
      [
        generationId,
        next,
        at.toString(),
        this.tenant,
        slotId,
        slot.revision,
        g.owner_membership_id,
      ],
      'UPDATE',
    );
    return next;
  }
  async attachAsset(
    slotId: string,
    generationId: string,
    sceneBindingId: string,
    expected: string,
    asset: {
      ref: string;
      purpose: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'POSTER' | 'BACKGROUND';
      mime: string;
      length: number;
      digest: string;
      revision: string;
    },
    at: number,
  ) {
    const slot = await this.loadSlot(slotId, 'UPDATE');
    check(slot.revision === revision(expected));
    const generation = await this.loadGeneration(generationId);
    check(generation.slot_id === slotId && generation.state === 'PENDING');
    check(Number.isSafeInteger(asset.length) && asset.length > 0 && asset.length <= 4194304);
    check(
      asset.mime ===
        (asset.purpose === 'AUDIO'
          ? 'audio/wav'
          : asset.purpose === 'VIDEO'
            ? 'video/webm'
            : 'image/png'),
    );
    const id = uuid(v7());
    await this.changed(
      `INSERT INTO zhiban_bridge.asset_bindings(tenant_id,asset_binding_id,generation_id,scene_binding_id,deployment_id,principal_handle,asset_ref,purpose,mime,byte_length,byte_digest,provider_revision,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        this.tenant,
        id,
        generationId,
        uuid(sceneBindingId),
        generation.deployment_id,
        principal(generation.owner_handle),
        opaque(asset.ref),
        asset.purpose,
        asset.mime,
        asset.length.toString(),
        digest(asset.digest),
        revision(asset.revision),
        instant(at).toString(),
      ],
      'INSERT',
    );
    return id;
  }
  async setState(
    slotId: string,
    expected: string,
    state: 'SUSPENDED' | 'TRANSFERRING' | 'RETIRED',
    at: number,
  ) {
    const slot = await this.loadSlot(slotId, 'UPDATE');
    check(slot.revision === revision(expected) && slot.state !== 'RETIRED');
    if (slot.state === state) return slot.revision; // stale comparison precedes true no-op.
    const next = successor(slot.revision);
    if (state === 'RETIRED' && slot.active_generation_id !== null) {
      const g = await this.loadGeneration(String(slot.active_generation_id));
      successor(g.revision);
      await this.changed(
        `UPDATE zhiban_bridge.resource_generations SET state='RETIRED',terminal_at=$1,updated_at=$1,repository_revision=repository_revision+1 WHERE tenant_id=$2 AND generation_id=$3 AND repository_revision=$4 AND state='ACTIVE'`,
        [instant(at).toString(), this.tenant, g.generation_id, g.revision],
        'UPDATE',
      );
    }
    await this.changed(
      `UPDATE zhiban_bridge.resource_slots SET state=$1,active_generation_id=$2,retired_at=$3,repository_revision=$4,updated_at=$5 WHERE tenant_id=$6 AND slot_id=$7 AND repository_revision=$8`,
      [
        state,
        state === 'RETIRED' ? null : slot.active_generation_id,
        state === 'RETIRED' ? instant(at).toString() : null,
        next,
        instant(at).toString(),
        this.tenant,
        slotId,
        slot.revision,
      ],
      'UPDATE',
    );
    return next;
  }
  async audit(
    op: Operation,
    event: string,
    before: string | null,
    after: string,
    requestId: string,
    at: number,
  ) {
    const vocabulary = [
      'GENERATION_RESERVED',
      'GENERATION_PREPARED',
      'GENERATION_ACTIVATED',
      'MAPPING_SUSPENDED',
      'MAPPING_RETIRED',
      'TRANSFER_STARTED',
      'TRANSFER_COMPLETED',
      'OPERATION_FAILED',
      'OUTCOME_QUARANTINED',
      'OUTCOME_RECONCILED',
    ];
    check(vocabulary.includes(event));
    await this.changed(
      `INSERT INTO zhiban_bridge.audit_events(tenant_id,event_id,slot_id,operation_id,event_type,actor_kind,actor_user_id,actor_membership_id,service_ref,request_id,slot_revision_before,slot_revision_after,occurred_at,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        this.tenant,
        uuid(v7()),
        op.slot_id,
        op.operation_id,
        event,
        op.actor_kind,
        op.actor_user_id,
        op.actor_membership_id,
        op.service_ref,
        opaque(requestId),
        before === null ? null : revision(before),
        revision(after),
        instant(at).toString(),
        op.reason,
      ],
      'INSERT',
    );
  }
}
