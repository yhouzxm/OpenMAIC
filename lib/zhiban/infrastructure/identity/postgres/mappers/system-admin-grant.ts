import type { SystemAdminGrant } from '@/lib/zhiban/domain/identity/system-admin-grant';
import { systemAdminGrantId, userId } from '@/lib/zhiban/domain/identity/ids';
import { instant } from '@/lib/zhiban/domain/identity/time';
import { rehydrateSystemAdminGrantForPersistence } from '@/lib/zhiban/domain/identity/persistence-rehydration';
import { repositoryRevision, type Loaded } from '@/lib/zhiban/application/identity/ports/repository-types';
import { checkRow, checkedInteger, instantMaximum } from './checked-values';

export interface SystemAdminGrantRow {
  readonly grant_id: string;
  readonly user_id: string;
  readonly created_at: string;
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly revoked_at: string | null;
  readonly repository_revision: string;
}

function epoch(value: unknown) {
  return instant(Number(checkedInteger(value, instantMaximum)));
}

export function systemAdminGrantFromRow(row: SystemAdminGrantRow): Loaded<SystemAdminGrant> {
  const _checked = checkRow(row,
    ['grant_id', 'user_id', 'created_at', 'valid_from', 'valid_until', 'revoked_at', 'repository_revision'],
    ['valid_until', 'revoked_at']);
  const snapshot = {
    id: systemAdminGrantId(row.grant_id), userId: userId(row.user_id),
    createdAt: epoch(row.created_at), validFrom: epoch(row.valid_from),
    validUntil: row.valid_until === null ? null : epoch(row.valid_until),
    revokedAt: row.revoked_at === null ? null : epoch(row.revoked_at),
  };
  const value = rehydrateSystemAdminGrantForPersistence(snapshot);
  const revision = repositoryRevision(row.repository_revision);
  return { value, revision };
}

export function systemAdminGrantToRow(value: SystemAdminGrant): Omit<SystemAdminGrantRow, 'repository_revision'> {
  return {
    grant_id: value.id, user_id: value.userId, created_at: value.createdAt.toString(),
    valid_from: value.validFrom.toString(),
    valid_until: value.validUntil === null ? null : value.validUntil.toString(),
    revoked_at: value.revokedAt === null ? null : value.revokedAt.toString(),
  };
}
