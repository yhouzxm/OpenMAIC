import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import type { BridgeSessionSecurity } from '@/lib/zhiban/infrastructure/openmaic/security';
import type { AuthenticatedRequestHandle } from '@/lib/zhiban/application/identity/use-cases/authentication';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { membershipId, tenantId } from '@/lib/zhiban/domain/identity';
import type {
  RuntimePersistence,
  RuntimeActor,
  RuntimeTx,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/protocol';
import type {
  RuntimeBinding,
  RuntimeOperation,
  RuntimeAudit,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/records';
import {
  validateBinding,
  validateOperation,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/records';
import { RuntimeDeadline } from '@/lib/zhiban/infrastructure/openmaic/runtime/admission';
import { runtimeTransaction } from '@/lib/zhiban/infrastructure/openmaic/runtime/transactions';
import { requireFact } from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';

const schema = 'zhiban_runtime_contract_test';
export const bindingFields = [
  'tenantId',
  'bindingId',
  'slotId',
  'generationId',
  'attemptId',
  'learnerMembershipId',
  'runtimeRef',
  'learnerHandle',
  'kind',
  'status',
  'revision',
  'outstandingOperationId',
  'lastSeq',
  'recordCount',
  'recordBytes',
  'nativeUpdatedAt',
  'createdAt',
  'updatedAt',
] as const;
export const operationFields = [
  'tenantId',
  'operationId',
  'bindingId',
  'generationId',
  'actorUserId',
  'actorMembershipId',
  'requestId',
  'command',
  'keyDigest',
  'intentDigest',
  'expectedRevision',
  'reservedRevision',
  'authorizationVersion',
  'expectedLastSeq',
  'priorStatus',
  'priorCount',
  'priorBytes',
  'recordId',
  'nativeRecordRef',
  'sceneBindingId',
  'payloadDigest',
  'payloadBytes',
  'serializedBytes',
  'targetStatus',
  'state',
  'revision',
  'dispatchStartedAt',
  'resultRevision',
  'resultLastSeq',
  'reason',
  'createdAt',
  'updatedAt',
  'completedAt',
] as const;
const overrides: Record<string, string> = {
  bindingId: 'runtime_binding_id',
  revision: 'repository_revision',
  lastSeq: 'expected_last_seq',
  expectedRevision: 'expected_binding_revision',
  reservedRevision: 'reserved_binding_revision',
  authorizationVersion: 'expected_authorization_version',
  priorCount: 'prior_record_count',
  priorBytes: 'prior_record_bytes',
  serializedBytes: 'record_serialized_bytes',
  resultRevision: 'result_binding_revision',
  eventType: 'event_type',
  before: 'binding_revision_before',
  after: 'binding_revision_after',
  operationRevision: 'operation_revision',
};
const column = (key: string) =>
  overrides[key] ?? key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const numbers = new Set([
  'lastSeq',
  'recordCount',
  'recordBytes',
  'nativeUpdatedAt',
  'createdAt',
  'updatedAt',
  'authorizationVersion',
  'expectedLastSeq',
  'priorCount',
  'priorBytes',
  'payloadBytes',
  'serializedBytes',
  'dispatchStartedAt',
  'resultLastSeq',
  'completedAt',
]);
function mapped(row: Record<string, unknown>, fields: readonly string[]) {
  requireFact(Object.keys(row).length === fields.length);
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = row[column(field)];
    requireFact(value !== undefined);
    if (numbers.has(field) && value !== null) {
      requireFact(
        (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) ||
          (typeof value === 'number' && Number.isSafeInteger(value)),
      );
      const n = Number(value);
      requireFact(Number.isSafeInteger(n));
      out[field] = n;
    } else out[field] = value;
  }
  return out;
}
export class PgRuntimeFixture implements RuntimePersistence {
  constructor(
    private readonly pool: TransactionPool,
    readonly template: RuntimeBinding,
    private readonly security: BridgeSessionSecurity,
    private readonly handle: AuthenticatedRequestHandle,
  ) {}
  async transaction<T>(
    actor: RuntimeActor,
    bindingId: string,
    deadline: RuntimeDeadline,
    work: (tx: RuntimeTx) => Promise<T>,
    mode: 'MUTATION' | 'READ' = 'MUTATION',
  ): Promise<T> {
    return runtimeTransaction(
      this.pool,
      deadline,
      async (client) => {
        const context = tenantScopeContext(tenantId(this.template.tenantId));
        const guard = this.security.guard(
          this.handle,
          context,
          membershipId(actor.membershipId),
          this.template.learnerMembershipId === actor.membershipId
            ? []
            : [membershipId(this.template.learnerMembershipId)],
          actor.authorizationVersion,
        );
        const assertCurrent = async () => {
          const facts = await guard(client);
          const current = facts.members.find((m) => m.membershipId === actor.membershipId);
          requireFact(
            facts.members.every(
              (m) => m.userStatus === 'ACTIVE' && m.membershipStatus === 'ACTIVE',
            ) &&
              current?.userId === actor.userId &&
              actor.membershipId === this.template.learnerMembershipId &&
              current.grants.some(
                (g) => g.roleCode === 'STUDENT' && g.scopeKind === 'SELF' && g.scopeId === null,
              ),
            'DENIED',
          );
          deadline.assert();
        };
        await assertCurrent();
        const parent = await client.query(
          `SELECT * FROM ${schema}.runtime_parent_context($1,$2,$3,$4,$5)`,
          [
            this.template.tenantId,
            this.template.slotId,
            this.template.generationId,
            this.template.attemptId,
            this.template.learnerMembershipId,
          ],
        );
        requireFact(
          parent.rowCount === 1 &&
            parent.rows[0].resource_state === 'ENABLED' &&
            parent.rows[0].attempt_state === 'ACTIVE',
          'DENIED',
        );
        let loaded = false;
        const load = async () => {
          const rows = await client.query(
            `SELECT ${bindingFields.map(column).join(',')} FROM ${schema}.runtime_bindings WHERE tenant_id=$1 AND runtime_binding_id=$2 FOR ${mode === 'READ' ? 'SHARE' : 'UPDATE'}`,
            [this.template.tenantId, bindingId],
          );
          requireFact(rows.rows.length <= 1 && bindingId === this.template.bindingId);
          if (!rows.rows.length) {
            requireFact(mode !== 'READ', 'DENIED');
            requireFact(!loaded);
            loaded = true;
            await insert('runtime_bindings', this.template, bindingFields);
            return structuredClone(this.template);
          }
          loaded = true;
          return validateBinding(mapped(rows.rows[0], bindingFields) as unknown as RuntimeBinding);
        };
        const insert = async (table: string, value: object, fields: readonly string[]) => {
          const data = value as Record<string, unknown>;
          const r = await client.query(
            `INSERT INTO ${schema}.${table}(${fields.map(column).join(',')}) VALUES(${fields.map((_, i) => '$' + (i + 1)).join(',')})`,
            fields.map((k) => data[k]),
          );
          requireFact(r.rowCount === 1);
        };
        const opColumns = operationFields.map(column).join(',');
        const tx: RuntimeTx = {
          stageRef: String(parent.rows[0].stage_ref),
          assertCurrent,
          load,
          byKey: async (command, key) => {
            const r = await client.query(
              `SELECT ${opColumns} FROM ${schema}.runtime_operations WHERE tenant_id=$1 AND runtime_binding_id=$2 AND actor_membership_id=$3 AND command=$4 AND key_digest=$5`,
              [this.template.tenantId, bindingId, actor.membershipId, command, key],
            );
            requireFact(r.rows.length <= 1);
            return r.rows.length
              ? validateOperation(mapped(r.rows[0], operationFields) as unknown as RuntimeOperation)
              : null;
          },
          operation: async (id) => {
            const r = await client.query(
              `SELECT ${opColumns} FROM ${schema}.runtime_operations WHERE tenant_id=$1 AND runtime_binding_id=$2 AND operation_id=$3 FOR UPDATE`,
              [this.template.tenantId, bindingId, id],
            );
            requireFact(r.rows.length === 1);
            return validateOperation(
              mapped(r.rows[0], operationFields) as unknown as RuntimeOperation,
            );
          },
          insert: (op) => insert('runtime_operations', op, operationFields),
          saveBinding: async (b) => {
            validateBinding(b);
            const fields = [
              'status',
              'revision',
              'outstandingOperationId',
              'lastSeq',
              'recordCount',
              'recordBytes',
              'nativeUpdatedAt',
              'updatedAt',
            ] as const;
            const r = await client.query(
              `UPDATE ${schema}.runtime_bindings SET ${fields.map((k, i) => column(k) + '=$' + (i + 1)).join(',')} WHERE tenant_id=$9 AND runtime_binding_id=$10 AND repository_revision=$11`,
              [
                ...fields.map((k) => b[k]),
                b.tenantId,
                b.bindingId,
                (BigInt(b.revision) - BigInt(1)).toString(),
              ],
            );
            requireFact(r.rowCount === 1, 'STALE');
          },
          saveOperation: async (op) => {
            validateOperation(op);
            const fields = [
              'state',
              'revision',
              'dispatchStartedAt',
              'resultRevision',
              'resultLastSeq',
              'reason',
              'updatedAt',
              'completedAt',
            ] as const;
            const r = await client.query(
              `UPDATE ${schema}.runtime_operations SET ${fields.map((k, i) => column(k) + '=$' + (i + 1)).join(',')} WHERE tenant_id=$9 AND operation_id=$10 AND repository_revision=$11`,
              [
                ...fields.map((k) => op[k]),
                op.tenantId,
                op.operationId,
                (BigInt(op.revision) - BigInt(1)).toString(),
              ],
            );
            requireFact(r.rowCount === 1, 'STALE');
          },
          audit: (e) => insert('runtime_audit_events', e, Object.keys(e) as (keyof RuntimeAudit)[]),
          scene: async (id) => {
            if (id === null) return null;
            const r = await client.query(
              `SELECT scene_ref FROM ${schema}.scenes WHERE tenant_id=$1 AND generation_id=$2 AND scene_binding_id=$3`,
              [this.template.tenantId, this.template.generationId, id],
            );
            requireFact(r.rows.length === 1, 'DENIED');
            return String(r.rows[0].scene_ref);
          },
        };
        const result = await work(tx);
        await assertCurrent();
        return result;
      },
      async () => {},
      this.template.tenantId,
    );
  }
}
