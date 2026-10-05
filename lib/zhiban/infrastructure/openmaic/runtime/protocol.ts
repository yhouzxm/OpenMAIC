import type { RuntimeCommand, RuntimeResult } from '@/lib/zhiban/application/openmaic/runtime';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { runtimeAdmission, type RuntimeDeadline } from './admission';
import { NativeFailure } from './transactions';
import {
  type RuntimeAudit,
  type RuntimeBinding,
  type RuntimeOperation,
  chatPayload,
  validateBinding,
  validateOperation,
} from './records';
import {
  allocateId,
  allocateRef,
  exact,
  hash,
  instant,
  MAX_REVISION,
  next,
  opaque,
  requireFact,
  rev,
  RuntimeFailure,
  tail,
  text,
  uuid,
} from './validation';

export interface RuntimeActor {
  readonly userId: string;
  readonly membershipId: string;
  readonly authorizationVersion: number;
  readonly requestId: string;
}
export interface RuntimeTx {
  load(): Promise<RuntimeBinding>;
  byKey(command: RuntimeCommand, keyDigest: string): Promise<RuntimeOperation | null>;
  operation(id: string): Promise<RuntimeOperation>;
  insert(op: RuntimeOperation): Promise<void>;
  saveBinding(b: RuntimeBinding): Promise<void>;
  saveOperation(op: RuntimeOperation): Promise<void>;
  audit(event: RuntimeAudit): Promise<void>;
  assertCurrent(): Promise<void>;
  readonly stageRef: string;
  scene(id: string | null): Promise<string | null>;
}
/** Positive persistence lives only in tests. Each transaction freshly locks authentic authority first. */
export interface RuntimePersistence {
  transaction<T>(
    actor: RuntimeActor,
    bindingId: string,
    deadline: RuntimeDeadline,
    work: (tx: RuntimeTx) => Promise<T>,
    mode?: 'MUTATION' | 'READ',
  ): Promise<T>;
}
export interface RuntimeDispatch {
  dispatch(
    b: RuntimeBinding,
    op: RuntimeOperation,
    stageRef: string,
    payload: unknown,
    sceneRef: string | null,
    deadline: RuntimeDeadline,
    authority: () => Promise<void>,
  ): Promise<void>;
}
type Input = {
  idempotencyKey: string;
  expectedLastSeq: number | null;
  content?: string;
  sceneBindingId?: string | null;
  producer?: object;
};
/** Exclusive diagnostic proof registry only; no production issuer/operator route. */
export interface RuntimeOutcomeProof {
  operationId: string;
  outcome: 'COMMITTED' | 'ROLLED_BACK';
}
const dispatchers = new WeakSet<object>();
function actorSnapshot(value: RuntimeActor): RuntimeActor {
  exact(value, ['userId', 'membershipId', 'authorizationVersion', 'requestId']);
  uuid(value.userId);
  uuid(value.membershipId);
  text(value.requestId, 256, true);
  requireFact(
    Number.isSafeInteger(value.authorizationVersion) && value.authorizationVersion >= 0,
    'INVALID_INPUT',
  );
  return Object.freeze({ ...value });
}
function inputFor(command: RuntimeCommand, value: unknown): Input {
  const append = command.startsWith('APPEND_');
  exact(value, [
    'idempotencyKey',
    'expectedLastSeq',
    ...(append ? ['content', 'sceneBindingId'] : []),
    ...(command === 'APPEND_ASSISTANT_RECORD' ? ['producer'] : []),
  ]);
  opaque(value.idempotencyKey);
  tail(value.expectedLastSeq);
  if (append) {
    text(value.content, 8192);
    if (value.sceneBindingId !== null) uuid(value.sceneBindingId);
  }
  return Object.freeze({ ...value }) as unknown as Input;
}
export function producerIntent(bindingId: string, key: string, content: string) {
  return hash(
    JSON.stringify(['c9-producer-v1', uuid(bindingId), hash(opaque(key)), text(content, 8192)]),
  );
}
export function intent(op: RuntimeOperation, b: RuntimeBinding, input: Input) {
  return hash(
    JSON.stringify([
      'c9-intent-v1',
      op.tenantId,
      op.actorUserId,
      op.actorMembershipId,
      op.command,
      op.keyDigest,
      b.bindingId,
      b.attemptId,
      b.generationId,
      op.expectedRevision,
      op.authorizationVersion,
      op.expectedLastSeq,
      b.runtimeRef,
      b.learnerHandle,
      op.recordId,
      op.nativeRecordRef,
      op.sceneBindingId,
      op.command.startsWith('APPEND_')
        ? hash(
            JSON.stringify({
              role: op.command === 'APPEND_USER_RECORD' ? 'user' : 'assistant',
              content: input.content,
            }),
          )
        : null,
      op.payloadBytes,
      op.serializedBytes,
      op.targetStatus,
      op.createdAt,
      b.createdAt,
    ]),
  );
}
function project(b: RuntimeBinding): RuntimeResult {
  requireFact(b.status !== 'PENDING');
  return Object.freeze({
    status: 'SUCCEEDED',
    bindingId: b.bindingId,
    revision: repositoryRevision(b.revision),
    state: b.status,
    lastSeq: b.lastSeq,
  });
}
function audit(
  b: RuntimeBinding,
  op: RuntimeOperation,
  eventType: RuntimeAudit['eventType'],
  before: string,
  now: number,
): RuntimeAudit {
  return {
    tenantId: b.tenantId,
    eventId: allocateId(),
    bindingId: b.bindingId,
    operationId: op.operationId,
    actorUserId: op.actorUserId,
    actorMembershipId: op.actorMembershipId,
    requestId: op.requestId,
    eventType,
    before,
    after: b.revision,
    operationRevision: op.revision,
    reason: op.reason,
    occurredAt: now,
  };
}
/** Internal contract runner. Production composition cannot supply a repository/dispatcher. */
export class RuntimeProtocol {
  constructor(
    private readonly persistence: RuntimePersistence,
    private readonly native: RuntimeDispatch,
    private readonly producers: WeakMap<object, string> = new WeakMap(),
    private readonly outcomeProofs: WeakMap<object, RuntimeOutcomeProof> = new WeakMap(),
  ) {}
  private async settle(
    tx: RuntimeTx,
    id: string,
    outcome: 'COMMITTED' | 'ROLLED_BACK',
    expectedOperationRevision: '1' | '2' | '3',
    reconciliation = false,
  ) {
    const b = validateBinding(await tx.load()),
      op = validateOperation(await tx.operation(id));
    requireFact(
      b.outstandingOperationId === id &&
        b.revision === op.reservedRevision &&
        op.revision === expectedOperationRevision &&
        op.state === (reconciliation ? 'OUTCOME_UNKNOWN' : 'RESERVED'),
    );
    requireFact(
      expectedOperationRevision !== '1' ||
        (outcome === 'ROLLED_BACK' && op.dispatchStartedAt === null),
    );
    const before = b.revision,
      now = instant(Date.now());
    b.revision = next(b.revision);
    b.outstandingOperationId = null;
    b.updatedAt = now;
    if (outcome === 'COMMITTED') {
      if (op.command === 'CREATE_RUNTIME') {
        b.status = 'ACTIVE';
        b.nativeUpdatedAt = b.createdAt;
      } else {
        b.status = op.targetStatus ?? b.status;
        b.nativeUpdatedAt = op.createdAt;
      }
      if (op.command.startsWith('APPEND_')) {
        b.recordCount++;
        b.lastSeq = b.recordCount - 1;
        b.recordBytes += op.serializedBytes!;
      }
    } else if (op.command === 'CREATE_RUNTIME') b.status = 'FAILED';
    op.state = outcome === 'COMMITTED' ? 'SUCCEEDED' : 'FAILED';
    op.reason =
      outcome === 'COMMITTED'
        ? 'NONE'
        : expectedOperationRevision === '1'
          ? 'CANCELLED'
          : 'STORAGE_FAILURE';
    op.revision = next(op.revision);
    op.updatedAt = now;
    op.completedAt = now;
    op.resultRevision = b.revision;
    op.resultLastSeq = b.lastSeq;
    await tx.saveOperation(validateOperation(op));
    await tx.saveBinding(validateBinding(b));
    await tx.audit(
      audit(
        b,
        op,
        reconciliation
          ? 'OUTCOME_RECONCILED'
          : outcome === 'COMMITTED'
            ? 'RUNTIME_SETTLED'
            : 'RUNTIME_FAILED',
        before,
        now,
      ),
    );
    return outcome === 'COMMITTED'
      ? project(b)
      : Object.freeze({
          status: 'FAILED' as const,
          reason:
            expectedOperationRevision === '1'
              ? ('CANCELLED' as const)
              : ('STORAGE_FAILURE' as const),
        });
  }
  /** Known unmarked reservation only. Never resolves a dispatched/uncertain fence. */
  async cancelReserved(
    actor: RuntimeActor,
    bindingId: string,
    expectedRevision: string,
    operationId: string,
  ): Promise<RuntimeResult> {
    try {
      actor = actorSnapshot(actor);
      uuid(bindingId);
      rev(expectedRevision);
      return await runtimeAdmission.run((deadline) =>
        this.persistence.transaction(actor, bindingId, deadline, async (tx) => {
          requireFact((await tx.load()).revision === rev(expectedRevision), 'STALE');
          return this.settle(tx, uuid(operationId), 'ROLLED_BACK', '1');
        }),
      );
    } catch (error) {
      return Object.freeze({
        status: 'FAILED',
        reason: error instanceof RuntimeFailure ? error.reason : 'STORAGE_FAILURE',
      });
    }
  }
  /** Explicit exclusive-fixture proof; append reconciliation remains unsupported. No replay. */
  async reconcile(
    actor: RuntimeActor,
    bindingId: string,
    expectedRevision: string,
    operationId: string,
    proof: object,
  ): Promise<RuntimeResult> {
    try {
      actor = actorSnapshot(actor);
      uuid(bindingId);
      rev(expectedRevision);
      const source = this.outcomeProofs.get(proof);
      requireFact(source !== undefined, 'DENIED');
      exact(source, ['operationId', 'outcome']);
      const sealed = Object.freeze({ ...source });
      requireFact(
        sealed.operationId === uuid(operationId) &&
          ['COMMITTED', 'ROLLED_BACK'].includes(sealed.outcome),
        'DENIED',
      );
      return await runtimeAdmission.run((deadline) =>
        this.persistence.transaction(actor, bindingId, deadline, async (tx) => {
          const b = validateBinding(await tx.load()),
            op = validateOperation(await tx.operation(operationId));
          requireFact(b.revision === rev(expectedRevision), 'STALE');
          requireFact(
            !op.command.startsWith('APPEND_') &&
              op.actorUserId === actor.userId &&
              op.actorMembershipId === actor.membershipId,
            'DENIED',
          );
          requireFact(this.outcomeProofs.delete(proof), 'DENIED');
          return this.settle(tx, operationId, sealed.outcome, '3', true);
        }),
      );
    } catch (error) {
      return Object.freeze({
        status: 'FAILED',
        reason: error instanceof RuntimeFailure ? error.reason : 'STORAGE_FAILURE',
      });
    }
  }
  async readSession(
    actor: RuntimeActor,
    bindingId: string,
    expectedRevision: string,
    currentTail: number | null,
  ): Promise<RuntimeResult> {
    try {
      actor = actorSnapshot(actor);
      uuid(bindingId);
      rev(expectedRevision);
      tail(currentTail);
      return await runtimeAdmission.run((deadline) =>
        this.persistence.transaction(
          actor,
          bindingId,
          deadline,
          async (tx) => {
            const b = validateBinding(await tx.load());
            requireFact(
              b.revision === rev(expectedRevision) && b.lastSeq === tail(currentTail),
              'STALE',
            );
            requireFact(b.outstandingOperationId === null, 'OUTCOME_UNKNOWN');
            return project(b);
          },
          'READ',
        ),
      );
    } catch (error) {
      return Object.freeze({
        status: 'FAILED',
        reason: error instanceof RuntimeFailure ? error.reason : 'STORAGE_FAILURE',
      });
    }
  }
  /** Classifies an abandoned marked reservation without issuing another dispatch capability. */
  async quarantineMarked(
    actor: RuntimeActor,
    bindingId: string,
    expectedRevision: string,
    operationId: string,
  ): Promise<RuntimeResult> {
    try {
      actor = actorSnapshot(actor);
      uuid(bindingId);
      uuid(operationId);
      rev(expectedRevision);
      await runtimeAdmission.run((deadline) =>
        this.persistence.transaction(actor, bindingId, deadline, async (tx) => {
          const b = validateBinding(await tx.load()),
            op = validateOperation(await tx.operation(operationId));
          requireFact(b.revision === expectedRevision, 'STALE');
          requireFact(
            b.outstandingOperationId === operationId &&
              b.revision === op.reservedRevision &&
              op.state === 'RESERVED' &&
              op.revision === '2',
          );
          op.state = 'OUTCOME_UNKNOWN';
          op.reason = 'UNKNOWN_OUTCOME';
          op.revision = '3';
          op.updatedAt = instant(Date.now());
          await tx.saveOperation(validateOperation(op));
          await tx.audit(audit(b, op, 'OUTCOME_QUARANTINED', b.revision, op.updatedAt));
        }),
      );
      return Object.freeze({ status: 'FAILED', reason: 'OUTCOME_UNKNOWN' });
    } catch (error) {
      return Object.freeze({
        status: 'FAILED',
        reason: error instanceof RuntimeFailure ? error.reason : 'STORAGE_FAILURE',
      });
    }
  }
  async execute(
    command: RuntimeCommand,
    actor: RuntimeActor,
    bindingId: string,
    expectedRevision: string,
    raw: unknown,
  ): Promise<RuntimeResult> {
    try {
      requireFact(
        [
          'CREATE_RUNTIME',
          'APPEND_USER_RECORD',
          'APPEND_ASSISTANT_RECORD',
          'COMPLETE_RUNTIME',
          'ARCHIVE_RUNTIME',
        ].includes(command),
        'INVALID_INPUT',
      );
      exact(actor, ['userId', 'membershipId', 'authorizationVersion', 'requestId']);
      actor = Object.freeze({ ...actor });
      const input = inputFor(command, raw);
      uuid(bindingId);
      rev(expectedRevision);
      uuid(actor.userId);
      uuid(actor.membershipId);
      text(actor.requestId, 256, true);
      requireFact(
        Number.isSafeInteger(actor.authorizationVersion) && actor.authorizationVersion >= 0,
        'INVALID_INPUT',
      );
      if (command === 'APPEND_ASSISTANT_RECORD')
        requireFact(
          input.producer !== undefined &&
            this.producers.get(input.producer) ===
              producerIntent(bindingId, input.idempotencyKey, input.content!),
          'DENIED',
        );
      return await runtimeAdmission.run(async (deadline) => {
        const reserved = await this.persistence.transaction(
          actor,
          bindingId,
          deadline,
          async (tx) => {
            const b = validateBinding(await tx.load());
            requireFact(b.revision === expectedRevision, 'STALE');
            requireFact(b.lastSeq === input.expectedLastSeq, 'STALE');
            requireFact(b.outstandingOperationId === null, 'OUTCOME_UNKNOWN');
            const prior = await tx.byKey(command, hash(input.idempotencyKey));
            if (prior) {
              requireFact(
                intent(prior, b, input) === prior.intentDigest &&
                  (input.sceneBindingId ?? null) === prior.sceneBindingId,
                'INVALID_INPUT',
              );
              throw new RuntimeFailure('STALE');
            }
            const target =
              command === 'COMPLETE_RUNTIME'
                ? 'COMPLETED'
                : command === 'ARCHIVE_RUNTIME'
                  ? 'ARCHIVED'
                  : null;
            if (target === b.status) return { noop: project(b) };
            requireFact(
              command === 'CREATE_RUNTIME'
                ? b.status === 'PENDING'
                : b.status === 'ACTIVE' ||
                    (command === 'ARCHIVE_RUNTIME' && b.status === 'COMPLETED'),
              'DENIED',
            );
            requireFact(BigInt(b.revision) <= MAX_REVISION - BigInt(2));
            const now = instant(Date.now());
            requireFact(now >= b.updatedAt && now >= (b.nativeUpdatedAt ?? b.createdAt));
            const op: RuntimeOperation = {
              tenantId: b.tenantId,
              operationId: allocateId(),
              bindingId,
              generationId: b.generationId,
              actorUserId: actor.userId,
              actorMembershipId: actor.membershipId,
              requestId: actor.requestId,
              command,
              keyDigest: hash(input.idempotencyKey),
              intentDigest: '0'.repeat(64),
              expectedRevision: b.revision,
              reservedRevision: next(b.revision),
              authorizationVersion: actor.authorizationVersion,
              expectedLastSeq: b.lastSeq,
              priorStatus: b.status,
              priorCount: b.recordCount,
              priorBytes: b.recordBytes,
              recordId: null,
              nativeRecordRef: null,
              sceneBindingId: null,
              payloadDigest: null,
              payloadBytes: null,
              serializedBytes: null,
              targetStatus: target,
              state: 'RESERVED',
              revision: '1',
              dispatchStartedAt: null,
              resultRevision: null,
              resultLastSeq: null,
              reason: 'NONE',
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            };
            if (command.startsWith('APPEND_')) {
              op.recordId = allocateId();
              op.nativeRecordRef = allocateRef();
              op.sceneBindingId = input.sceneBindingId ?? null;
              const payload = chatPayload(
                {
                  role: command === 'APPEND_USER_RECORD' ? 'user' : 'assistant',
                  content: input.content,
                },
                command === 'APPEND_USER_RECORD' ? 'user' : 'assistant',
              );
              op.payloadDigest = hash(JSON.stringify(payload));
              op.payloadBytes = Buffer.byteLength(payload.content);
              const sceneRef = await tx.scene(op.sceneBindingId);
              op.serializedBytes = Buffer.byteLength(
                JSON.stringify({
                  id: op.nativeRecordRef,
                  sessionId: b.runtimeRef,
                  createdAt: new Date(now).toISOString(),
                  payload,
                  ...(sceneRef === null ? {} : { sceneId: sceneRef }),
                  seq: b.recordCount,
                }),
              );
              requireFact(
                b.recordCount < 128 &&
                  b.recordBytes + op.serializedBytes <= 2097152 &&
                  op.serializedBytes <= 16384,
                'BUDGET_EXCEEDED',
              );
            }
            op.intentDigest = intent(op, b, input);
            validateOperation(op);
            const before = b.revision;
            b.revision = op.reservedRevision;
            b.outstandingOperationId = op.operationId;
            b.updatedAt = now;
            await tx.insert(op);
            await tx.saveBinding(b);
            await tx.audit(audit(b, op, 'RUNTIME_RESERVED', before, now));
            return { operationId: op.operationId };
          },
        );
        if ('noop' in reserved) return reserved.noop!;
        const id = reserved.operationId!;
        const capability = await this.persistence.transaction(
          actor,
          bindingId,
          deadline,
          async (tx) => {
            const b = validateBinding(await tx.load()),
              op = validateOperation(await tx.operation(id));
            requireFact(
              b.outstandingOperationId === id &&
                b.revision === op.reservedRevision &&
                op.state === 'RESERVED' &&
                op.revision === '1' &&
                op.dispatchStartedAt === null,
            );
            const now = instant(Date.now());
            op.revision = next(op.revision);
            op.dispatchStartedAt = now;
            op.updatedAt = now;
            await tx.saveOperation(op);
            await tx.audit(audit(b, op, 'DISPATCH_MARKED', b.revision, now));
            return Object.freeze({ operationId: id });
          },
        );
        // Mint only after mark COMMIT; consume before any native work. No process remint API.
        dispatchers.add(capability);
        const dispatchState: { outcome: 'COMMITTED' | 'ROLLED_BACK' | 'UNKNOWN' } = {
          outcome: 'UNKNOWN',
        };
        try {
          await this.persistence.transaction(actor, bindingId, deadline, async (tx) => {
            requireFact(dispatchers.delete(capability));
            const b = validateBinding(await tx.load()),
              op = validateOperation(await tx.operation(id));
            requireFact(
              b.outstandingOperationId === id &&
                b.revision === op.reservedRevision &&
                op.state === 'RESERVED' &&
                op.revision === '2',
            );
            const payload = command.startsWith('APPEND_')
              ? chatPayload(
                  {
                    role: command === 'APPEND_USER_RECORD' ? 'user' : 'assistant',
                    content: input.content,
                  },
                  command === 'APPEND_USER_RECORD' ? 'user' : 'assistant',
                )
              : null;
            await this.native.dispatch(
              b,
              op,
              tx.stageRef,
              payload,
              await tx.scene(op.sceneBindingId),
              deadline,
              tx.assertCurrent,
            );
            dispatchState.outcome = 'COMMITTED';
          });
        } catch (error) {
          // A local guard COMMIT failure after native success remains unknown.
          if (
            dispatchState.outcome !== 'COMMITTED' &&
            error instanceof NativeFailure &&
            ['NOT_DISPATCHED', 'ROLLED_BACK'].includes(error.outcome)
          )
            dispatchState.outcome = 'ROLLED_BACK';
          else dispatchState.outcome = 'UNKNOWN';
        }
        const outcome = dispatchState.outcome;
        if (outcome === 'UNKNOWN') {
          try {
            await this.persistence.transaction(actor, bindingId, deadline, async (tx) => {
              const b = validateBinding(await tx.load()),
                op = validateOperation(await tx.operation(id));
              requireFact(
                b.outstandingOperationId === id && op.state === 'RESERVED' && op.revision === '2',
              );
              op.state = 'OUTCOME_UNKNOWN';
              op.reason = 'UNKNOWN_OUTCOME';
              op.revision = next(op.revision);
              op.updatedAt = instant(Date.now());
              await tx.saveOperation(op);
              await tx.audit(audit(b, op, 'OUTCOME_QUARANTINED', b.revision, op.updatedAt));
            });
          } catch {
            /* Committed RESERVED remains fenced even without quarantine. */
          }
          throw new RuntimeFailure('OUTCOME_UNKNOWN');
        }
        try {
          return await this.persistence.transaction(actor, bindingId, deadline, async (tx) => {
            return this.settle(tx, id, outcome, '2');
          });
        } catch {
          throw new RuntimeFailure('OUTCOME_UNKNOWN');
        }
      });
    } catch (error) {
      return Object.freeze({
        status: 'FAILED',
        reason: error instanceof RuntimeFailure ? error.reason : 'STORAGE_FAILURE',
      });
    }
  }
  async readOutcome(
    actor: RuntimeActor,
    bindingId: string,
    expectedRevision: string,
    command: RuntimeCommand,
    input: unknown,
    currentTail: number | null,
  ): Promise<RuntimeResult> {
    try {
      actor = actorSnapshot(actor);
      uuid(bindingId);
      rev(expectedRevision);
      tail(currentTail);
      const parsed = inputFor(command, input);
      return await runtimeAdmission.run((deadline) =>
        this.persistence.transaction(
          actor,
          bindingId,
          deadline,
          async (tx) => {
            const b = validateBinding(await tx.load());
            requireFact(
              b.revision === rev(expectedRevision) && b.lastSeq === tail(currentTail),
              'STALE',
            );
            requireFact(b.outstandingOperationId === null, 'OUTCOME_UNKNOWN');
            const op = await tx.byKey(command, hash(parsed.idempotencyKey));
            requireFact(op !== null && ['SUCCEEDED', 'FAILED'].includes(op.state));
            validateOperation(op);
            requireFact(
              intent(op, b, parsed) === op.intentDigest &&
                parsed.expectedLastSeq === op.expectedLastSeq &&
                (parsed.sceneBindingId ?? null) === op.sceneBindingId,
              'INVALID_INPUT',
            );
            if (op.state === 'FAILED') {
              const reason = op.reason;
              requireFact(reason !== 'NONE' && reason !== 'UNKNOWN_OUTCOME');
              return Object.freeze({ status: 'FAILED' as const, reason });
            }
            return project(b);
          },
          'READ',
        ),
      );
    } catch (error) {
      return Object.freeze({
        status: 'FAILED',
        reason: error instanceof RuntimeFailure ? error.reason : 'STORAGE_FAILURE',
      });
    }
  }
}
