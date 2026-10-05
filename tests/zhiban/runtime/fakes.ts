import type {
  RuntimePersistence,
  RuntimeTx,
  RuntimeActor,
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
import {
  allocateId,
  allocateRef,
  requireFact,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';

export function pendingBinding(): RuntimeBinding {
  const now = Date.now();
  return {
    tenantId: allocateId(),
    bindingId: allocateId(),
    slotId: allocateId(),
    generationId: allocateId(),
    attemptId: allocateId(),
    learnerMembershipId: allocateId(),
    runtimeRef: allocateRef(),
    learnerHandle: allocateRef(),
    kind: 'chat',
    status: 'PENDING',
    revision: '1',
    outstandingOperationId: null,
    lastSeq: null,
    recordCount: 0,
    recordBytes: 0,
    nativeUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
export class FakeRuntimePersistence implements RuntimePersistence {
  readonly ownerUserId = allocateId();
  binding: RuntimeBinding | null = null;
  operations = new Map<string, RuntimeOperation>();
  events: RuntimeAudit[] = [];
  active = true;
  authorizationVersion = 0;
  auditFailure = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly template: RuntimeBinding,
    readonly stageRef = allocateRef(),
  ) {}
  transaction<T>(
    actor: RuntimeActor,
    bindingId: string,
    deadline: RuntimeDeadline,
    work: (tx: RuntimeTx) => Promise<T>,
    mode: 'MUTATION' | 'READ' = 'MUTATION',
  ): Promise<T> {
    const actual = this.queue.then(async () => {
      const b = structuredClone(this.binding ?? this.template),
        ops = new Map([...this.operations].map(([k, v]) => [k, structuredClone(v)])),
        events = structuredClone(this.events);
      const assertCurrent = async () => {
        deadline.assert();
        requireFact(
          this.active &&
            actor.userId === this.ownerUserId &&
            actor.membershipId === b.learnerMembershipId &&
            actor.authorizationVersion === this.authorizationVersion &&
            bindingId === b.bindingId,
          'DENIED',
        );
      };
      await assertCurrent();
      const result = await work({
        stageRef: this.stageRef,
        assertCurrent,
        load: async () => {
          requireFact(mode !== 'READ' || this.binding !== null, 'DENIED');
          return structuredClone(b);
        },
        byKey: async (command, key) =>
          structuredClone(
            [...ops.values()].find(
              (o) =>
                o.command === command &&
                o.keyDigest === key &&
                o.actorMembershipId === actor.membershipId,
            ) ?? null,
          ),
        operation: async (id) => {
          requireFact(ops.has(id));
          return structuredClone(ops.get(id)!);
        },
        insert: async (op) => {
          requireFact(!ops.has(op.operationId));
          ops.set(op.operationId, structuredClone(op));
        },
        saveBinding: async (current) => {
          validateBinding(current);
          requireFact(BigInt(current.revision) === BigInt(b.revision) + BigInt(1));
          const mutable = [
            'status',
            'revision',
            'outstandingOperationId',
            'lastSeq',
            'recordCount',
            'recordBytes',
            'nativeUpdatedAt',
            'updatedAt',
          ];
          requireFact(
            Object.keys(b)
              .filter((k) => !mutable.includes(k))
              .every((k) => current[k as keyof RuntimeBinding] === b[k as keyof RuntimeBinding]),
          );
          requireFact(
            !['ARCHIVED', 'FAILED'].includes(b.status) && current.updatedAt >= b.updatedAt,
          );
          requireFact(
            (b.status === 'PENDING' && ['PENDING', 'ACTIVE', 'FAILED'].includes(current.status)) ||
              (b.status === 'ACTIVE' &&
                ['ACTIVE', 'COMPLETED', 'ARCHIVED'].includes(current.status)) ||
              (b.status === 'COMPLETED' && ['COMPLETED', 'ARCHIVED'].includes(current.status)),
          );
          Object.assign(b, structuredClone(current));
        },
        saveOperation: async (op) => {
          validateOperation(op);
          const old = ops.get(op.operationId);
          requireFact(
            old &&
              !['SUCCEEDED', 'FAILED'].includes(old.state) &&
              BigInt(op.revision) === BigInt(old.revision) + BigInt(1),
          );
          const mutable = [
            'state',
            'revision',
            'dispatchStartedAt',
            'resultRevision',
            'resultLastSeq',
            'reason',
            'updatedAt',
            'completedAt',
          ];
          requireFact(
            Object.keys(old)
              .filter((k) => !mutable.includes(k))
              .every((k) => op[k as keyof RuntimeOperation] === old[k as keyof RuntimeOperation]),
          );
          requireFact(
            op.updatedAt >= old.updatedAt &&
              (old.dispatchStartedAt === null || op.dispatchStartedAt === old.dispatchStartedAt),
          );
          requireFact(
            (old.state === 'RESERVED' &&
              old.revision === '1' &&
              op.revision === '2' &&
              ['RESERVED', 'FAILED'].includes(op.state)) ||
              (old.state === 'RESERVED' &&
                old.revision === '2' &&
                op.revision === '3' &&
                ['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(op.state)) ||
              (old.state === 'OUTCOME_UNKNOWN' &&
                old.revision === '3' &&
                op.revision === '4' &&
                ['SUCCEEDED', 'FAILED'].includes(op.state)),
          );
          ops.set(op.operationId, structuredClone(op));
        },
        audit: async (e) => {
          requireFact(!this.auditFailure);
          events.push(structuredClone(e));
        },
        scene: async (id) => {
          requireFact(id === null, 'DENIED');
          return null;
        },
      });
      await assertCurrent();
      for (const op of ops.values()) {
        validateOperation(op);
        requireFact(
          BigInt(events.filter((e) => e.operationId === op.operationId).length) ===
            BigInt(op.revision),
        );
      }
      if (mode === 'READ') {
        requireFact(
          JSON.stringify(b) === JSON.stringify(this.binding) &&
            events.length === this.events.length,
        );
        return result;
      }
      this.binding = b;
      this.operations = ops;
      this.events = events;
      return result;
    });
    this.queue = actual.catch(() => {});
    return actual;
  }
}
