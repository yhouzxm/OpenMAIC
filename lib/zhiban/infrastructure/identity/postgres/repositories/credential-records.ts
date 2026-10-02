import { instant, userId } from '@/lib/zhiban/domain/identity';
import { credentialId, securityEpoch, type CredentialHistoryMetadata, type CredentialSlotMetadata } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision, type Loaded } from '@/lib/zhiban/application/identity/ports/repository-types';
import { checkRow, checkedInteger, instantMaximum, int8Maximum } from '../mappers/checked-values';
import { validateVerifier } from '../../credentials/verifier-material';
import { integrity } from './repository-support';

export interface SlotRow { user_id: string; credential_type: string; active_credential_id: string | null; generation: string; repository_revision: string; security_epoch: string; created_at: string; updated_at: string }
export interface CredentialRow { credential_id: string; user_id: string; credential_type: string; generation: string; status: string; slot_revision: string; verifier_material: string | null; created_at: string; updated_at: string; replaced_at: string | null; revoked_at: string | null; replaced_by_credential_id: string | null }
export const slotColumns = 'user_id, credential_type, active_credential_id, generation, repository_revision, security_epoch, created_at, updated_at';
export const credentialColumns = 'credential_id, user_id, credential_type, generation, status, slot_revision, verifier_material, created_at, updated_at, replaced_at, revoked_at, replaced_by_credential_id';
function time(value: string) { return instant(Number(checkedInteger(value, instantMaximum))); }
function positive(value: string) { integrity(checkedInteger(value, int8Maximum) > BigInt(0)); return value; }
export function slotMetadata(row: SlotRow): Loaded<CredentialSlotMetadata> {
  checkRow(row, slotColumns.split(', '), ['active_credential_id']);
  integrity(row.credential_type === 'PASSWORD');
  const createdAt = time(row.created_at), updatedAt = time(row.updated_at);
  integrity(updatedAt >= createdAt && row.security_epoch !== '0');
  return Object.freeze({ revision: repositoryRevision(row.repository_revision), value: Object.freeze({ userId: userId(row.user_id), type: 'PASSWORD', activeCredentialId: row.active_credential_id === null ? null : credentialId(row.active_credential_id), generation: positive(row.generation), securityEpoch: securityEpoch(row.security_epoch), createdAt, updatedAt }) });
}
export function historyMetadata(row: CredentialRow): CredentialHistoryMetadata {
  checkRow(row, credentialColumns.split(', '), ['verifier_material', 'replaced_at', 'revoked_at', 'replaced_by_credential_id']);
  integrity(row.credential_type === 'PASSWORD'); positive(row.slot_revision);
  const createdAt = time(row.created_at), updatedAt = time(row.updated_at);
  integrity(updatedAt >= createdAt);
  const replacedAt = row.replaced_at === null ? null : time(row.replaced_at);
  const revokedAt = row.revoked_at === null ? null : time(row.revoked_at);
  const successor = row.replaced_by_credential_id === null ? null : credentialId(row.replaced_by_credential_id);
  integrity((row.status === 'ACTIVE' && row.verifier_material !== null && replacedAt === null && revokedAt === null && successor === null) ||
    (row.status === 'REPLACED' && row.verifier_material === null && replacedAt === updatedAt && revokedAt === null && successor !== null && successor !== row.credential_id) ||
    (row.status === 'REVOKED' && row.verifier_material === null && revokedAt === updatedAt && replacedAt === null && successor === null));
  if (row.verifier_material !== null) validateVerifier(row.verifier_material);
  return Object.freeze({ credentialId: credentialId(row.credential_id), userId: userId(row.user_id), type: 'PASSWORD', generation: positive(row.generation), status: row.status as CredentialHistoryMetadata['status'], createdAt, updatedAt, replacedAt, revokedAt, replacedByCredentialId: successor });
}
export function validateAggregate(slot: SlotRow, rows: CredentialRow[]) {
  const loaded = slotMetadata(slot), history = rows.map(historyMetadata);
  integrity(rows.length > 0);
  let previous = BigInt(0);
  for (const row of rows) {
    integrity(row.user_id === slot.user_id && BigInt(row.generation) === previous + BigInt(1) && BigInt(row.slot_revision) <= BigInt(slot.repository_revision));
    integrity(BigInt(row.created_at) >= BigInt(slot.created_at) && BigInt(row.updated_at) <= BigInt(slot.updated_at));
    previous = BigInt(row.generation);
    if (row.replaced_by_credential_id !== null) {
      const successor = rows.find((item) => item.credential_id === row.replaced_by_credential_id);
      integrity(successor !== undefined && BigInt(successor.generation) > previous && row.replaced_at !== null && BigInt(successor.created_at) >= BigInt(row.replaced_at));
    }
  }
  const active = rows.filter((row) => row.status === 'ACTIVE');
  integrity(previous.toString() === slot.generation && active.length === (slot.active_credential_id === null ? 0 : 1) &&
    (active[0]?.credential_id ?? null) === slot.active_credential_id && rows.some((row) => row.slot_revision === slot.repository_revision));
  integrity(active.length === 0 || active[0].generation === slot.generation);
  return { loaded, history };
}
