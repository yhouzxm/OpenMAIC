import {
  check,
  counter,
  digest,
  exact,
  opaque,
  principal,
  revision,
  storedInstant,
  uuid,
} from './validation';

export const slotColumns =
  'tenant_id,slot_id,activity_id,deployment_id,owner_membership_id,state,last_generation,active_generation_id,repository_revision,created_at,updated_at,retired_at';
export const generationColumns =
  'tenant_id,generation_id,slot_id,deployment_id,owner_membership_id,generation,owner_handle,stage_ref,content_digest,dsl_version,state,repository_revision,created_at,updated_at,activated_at,terminal_at';
export const operationColumns =
  'tenant_id,operation_id,slot_id,generation_id,actor_kind,actor_user_id,actor_membership_id,service_ref,operation,actor_key,key_digest,intent_digest,expected_slot_revision,reserved_slot_revision,expected_authorization_version,state,repository_revision,reserved_stage_ref,result_asset_ref,result_generation_id,result_slot_revision,created_at,updated_at,dispatch_started_at,completed_at,reason';
export const sceneColumns =
  'tenant_id,scene_binding_id,generation_id,scene_ref,scene_ordinal,scene_digest,created_at';
export const assetColumns =
  'tenant_id,asset_binding_id,generation_id,scene_binding_id,deployment_id,principal_handle,asset_ref,purpose,mime,byte_length,byte_digest,provider_revision,created_at';
export type BridgeRow = Record<string, unknown>;
function times(row: BridgeRow, terminal: readonly string[]) {
  const created = storedInstant(row.created_at),
    updated = storedInstant(row.updated_at);
  check(created <= updated);
  for (const key of terminal)
    if (row[key] !== null) {
      const t = storedInstant(row[key]);
      check(t >= created && t <= updated);
    }
  revision(row.repository_revision);
}
export function slotRecord(row: unknown, tenant: string) {
  exact(row, slotColumns.split(','));
  check(row.tenant_id === tenant);
  for (const k of ['tenant_id', 'slot_id', 'activity_id', 'deployment_id', 'owner_membership_id'])
    uuid(row[k]);
  check(['ENABLED', 'SUSPENDED', 'TRANSFERRING', 'RETIRED'].includes(String(row.state)));
  check(
    typeof row.last_generation === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(row.last_generation) &&
      BigInt(row.last_generation) <= BigInt('9223372036854775807'),
  );
  if (row.active_generation_id !== null) uuid(row.active_generation_id);
  times(row, ['retired_at']);
  check((row.state === 'RETIRED') === (row.retired_at !== null));
  check(row.state !== 'RETIRED' || row.active_generation_id === null);
  check(row.state !== 'ENABLED' || row.active_generation_id !== null);
  return Object.freeze({
    ...row,
    revision: revision(row.repository_revision),
    generation: row.last_generation as string,
  }) as Readonly<BridgeRow & { revision: ReturnType<typeof revision>; generation: string }>;
}
export function generationRecord(row: unknown, tenant: string) {
  exact(row, generationColumns.split(','));
  check(row.tenant_id === tenant);
  for (const k of ['tenant_id', 'generation_id', 'slot_id', 'deployment_id', 'owner_membership_id'])
    uuid(row[k]);
  revision(row.generation);
  principal(row.owner_handle);
  opaque(row.stage_ref);
  digest(row.content_digest);
  check(row.dsl_version === '0.11.2');
  check(['PENDING', 'ACTIVE', 'ORPHAN', 'RETIRED'].includes(String(row.state)));
  times(row, ['activated_at', 'terminal_at']);
  if (row.state === 'PENDING') check(row.activated_at === null && row.terminal_at === null);
  if (row.state === 'ACTIVE') check(row.activated_at !== null && row.terminal_at === null);
  if (row.state === 'RETIRED') check(row.activated_at !== null && row.terminal_at !== null);
  if (row.state === 'ORPHAN') check(row.terminal_at !== null);
  if (row.activated_at !== null && row.terminal_at !== null)
    check(storedInstant(row.activated_at) <= storedInstant(row.terminal_at));
  return Object.freeze({ ...row, revision: revision(row.repository_revision) }) as Readonly<
    BridgeRow & { revision: ReturnType<typeof revision> }
  >;
}
export function operationRecord(row: unknown, tenant: string) {
  exact(row, operationColumns.split(','));
  check(row.tenant_id === tenant);
  for (const k of ['tenant_id', 'operation_id', 'slot_id']) uuid(row[k]);
  for (const k of ['generation_id', 'actor_user_id', 'actor_membership_id', 'result_generation_id'])
    if (row[k] !== null) uuid(row[k]);
  digest(row.key_digest);
  digest(row.intent_digest);
  opaque(row.actor_key);
  check(
    [
      'PREPARE_CONTENT',
      'PREPARE_ASSET',
      'ACTIVATE_GENERATION',
      'SUSPEND',
      'RETIRE',
      'TRANSFER',
      'RECONCILE',
    ].includes(String(row.operation)),
  );
  check(['RESERVED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(String(row.state)));
  check(
    [
      'NONE',
      'DENIED',
      'STALE',
      'INVALID_CONTENT',
      'STORAGE_FAILURE',
      'UNKNOWN_OUTCOME',
      'INTEGRITY_FAILURE',
    ].includes(String(row.reason)),
  );
  check(
    BigInt(revision(row.reserved_slot_revision)) ===
      BigInt(revision(row.expected_slot_revision)) + BigInt(1),
  );
  if (row.actor_kind === 'USER') {
    uuid(row.actor_user_id);
    uuid(row.actor_membership_id);
    check(row.service_ref === null && row.actor_key === `user:${row.actor_user_id}`);
    counter(row.expected_authorization_version);
  } else {
    check(
      row.actor_kind === 'SERVICE_RECONCILE' &&
        row.operation === 'RECONCILE' &&
        row.actor_user_id === null &&
        row.actor_membership_id === null &&
        row.expected_authorization_version === null,
    );
    opaque(row.service_ref);
    check(row.actor_key === `service:${row.service_ref}`);
  }
  times(row, ['dispatch_started_at', 'completed_at']);
  check(
    ['RESERVED', 'OUTCOME_UNKNOWN'].includes(String(row.state)) === (row.completed_at === null),
  );
  check(
    (row.reserved_stage_ref !== null) ===
      ['PREPARE_CONTENT', 'TRANSFER'].includes(String(row.operation)),
  );
  if (row.reserved_stage_ref !== null) opaque(row.reserved_stage_ref);
  if (row.result_asset_ref !== null) opaque(row.result_asset_ref);
  if (row.result_slot_revision !== null)
    check(
      BigInt(revision(row.result_slot_revision)) >= BigInt(revision(row.reserved_slot_revision)),
    );
  check(row.state !== 'SUCCEEDED' || (row.reason === 'NONE' && row.result_slot_revision !== null));
  check(row.state !== 'OUTCOME_UNKNOWN' || row.reason === 'UNKNOWN_OUTCOME');
  check(row.state !== 'FAILED' || row.reason !== 'NONE');
  check(
    row.state === 'SUCCEEDED' ||
      (row.result_asset_ref === null &&
        row.result_generation_id === null &&
        row.result_slot_revision === null),
  );
  check(
    row.result_asset_ref === null ||
      (row.state === 'SUCCEEDED' && row.operation === 'PREPARE_ASSET'),
  );
  check(
    row.operation !== 'PREPARE_ASSET' || row.state !== 'SUCCEEDED' || row.result_asset_ref !== null,
  );
  check(
    !['PREPARE_CONTENT', 'PREPARE_ASSET', 'TRANSFER'].includes(String(row.operation)) ||
      !['SUCCEEDED', 'OUTCOME_UNKNOWN'].includes(String(row.state)) ||
      row.dispatch_started_at !== null,
  );
  return Object.freeze({ ...row, revision: revision(row.repository_revision) }) as Readonly<
    BridgeRow & { revision: ReturnType<typeof revision> }
  >;
}
export function sceneRecord(row: unknown, tenant: string) {
  exact(row, sceneColumns.split(','));
  check(row.tenant_id === tenant);
  for (const key of ['tenant_id', 'scene_binding_id', 'generation_id']) uuid(row[key]);
  opaque(row.scene_ref);
  digest(row.scene_digest);
  storedInstant(row.created_at);
  const ordinal = counter(row.scene_ordinal);
  check(ordinal <= 63);
  return Object.freeze({ ...row, ordinal }) as Readonly<BridgeRow & { ordinal: number }>;
}
export function assetRecord(row: unknown, tenant: string) {
  exact(row, assetColumns.split(','));
  check(row.tenant_id === tenant);
  for (const key of [
    'tenant_id',
    'asset_binding_id',
    'generation_id',
    'scene_binding_id',
    'deployment_id',
  ])
    uuid(row[key]);
  principal(row.principal_handle);
  opaque(row.asset_ref);
  digest(row.byte_digest);
  storedInstant(row.created_at);
  revision(row.provider_revision);
  check(['IMAGE', 'AUDIO', 'VIDEO', 'POSTER', 'BACKGROUND'].includes(String(row.purpose)));
  check(
    row.mime ===
      (row.purpose === 'AUDIO'
        ? 'audio/wav'
        : row.purpose === 'VIDEO'
          ? 'video/webm'
          : 'image/png'),
  );
  const length = counter(row.byte_length);
  check(length >= 1 && length <= 4194304);
  return Object.freeze({ ...row, length }) as Readonly<BridgeRow & { length: number }>;
}
