import type { RuntimeCommand } from '@/lib/zhiban/application/openmaic/runtime';
import {
  canonicalTime,
  digest,
  exact,
  instant,
  opaque,
  requireFact,
  rev,
  tail,
  text,
  uuid,
} from './validation';

export type BindingState = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'FAILED';
export interface RuntimeBinding {
  tenantId: string;
  bindingId: string;
  slotId: string;
  generationId: string;
  attemptId: string;
  learnerMembershipId: string;
  runtimeRef: string;
  learnerHandle: string;
  kind: 'chat';
  status: BindingState;
  revision: string;
  outstandingOperationId: string | null;
  lastSeq: number | null;
  recordCount: number;
  recordBytes: number;
  nativeUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export interface RuntimeOperation {
  tenantId: string;
  operationId: string;
  bindingId: string;
  generationId: string;
  actorUserId: string;
  actorMembershipId: string;
  requestId: string;
  command: RuntimeCommand;
  keyDigest: string;
  intentDigest: string;
  expectedRevision: string;
  reservedRevision: string;
  authorizationVersion: number;
  expectedLastSeq: number | null;
  priorStatus: BindingState;
  priorCount: number;
  priorBytes: number;
  recordId: string | null;
  nativeRecordRef: string | null;
  sceneBindingId: string | null;
  payloadDigest: string | null;
  payloadBytes: number | null;
  serializedBytes: number | null;
  targetStatus: 'COMPLETED' | 'ARCHIVED' | null;
  state: 'RESERVED' | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
  revision: string;
  dispatchStartedAt: number | null;
  resultRevision: string | null;
  resultLastSeq: number | null;
  reason:
    | 'NONE'
    | 'DENIED'
    | 'STALE'
    | 'INVALID_INPUT'
    | 'BUDGET_EXCEEDED'
    | 'STORAGE_FAILURE'
    | 'INTEGRITY_FAILURE'
    | 'CANCELLED'
    | 'UNKNOWN_OUTCOME';
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}
export interface RuntimeAudit {
  tenantId: string;
  eventId: string;
  bindingId: string;
  operationId: string;
  actorUserId: string;
  actorMembershipId: string;
  requestId: string;
  eventType:
    | 'RUNTIME_RESERVED'
    | 'DISPATCH_MARKED'
    | 'RUNTIME_SETTLED'
    | 'RUNTIME_FAILED'
    | 'OUTCOME_QUARANTINED'
    | 'OUTCOME_RECONCILED';
  before: string;
  after: string;
  operationRevision: string;
  reason: RuntimeOperation['reason'];
  occurredAt: number;
}
export function validateBinding(b: RuntimeBinding): RuntimeBinding {
  exact(b, [
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
  ]);
  for (const key of [
    'tenantId',
    'bindingId',
    'slotId',
    'generationId',
    'attemptId',
    'learnerMembershipId',
  ] as const)
    uuid(b[key]);
  opaque(b.runtimeRef);
  opaque(b.learnerHandle);
  rev(b.revision);
  tail(b.lastSeq);
  if (b.outstandingOperationId !== null) uuid(b.outstandingOperationId);
  requireFact(
    b.kind === 'chat' &&
      ['PENDING', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'FAILED'].includes(b.status),
  );
  requireFact(
    Number.isSafeInteger(b.recordCount) &&
      b.recordCount >= 0 &&
      b.recordCount <= 128 &&
      Number.isSafeInteger(b.recordBytes) &&
      b.recordBytes >= 0 &&
      b.recordBytes <= 2097152,
  );
  requireFact(
    b.lastSeq === (b.recordCount === 0 ? null : b.recordCount - 1) &&
      (b.recordBytes === 0) === (b.recordCount === 0),
  );
  instant(b.createdAt);
  instant(b.updatedAt);
  requireFact(b.updatedAt >= b.createdAt);
  if (['PENDING', 'FAILED'].includes(b.status))
    requireFact(b.recordCount === 0 && b.nativeUpdatedAt === null);
  else
    requireFact(
      b.nativeUpdatedAt !== null &&
        instant(b.nativeUpdatedAt) >= b.createdAt &&
        b.nativeUpdatedAt <= b.updatedAt,
    );
  return b;
}
export function chatPayload(value: unknown, role: 'user' | 'assistant') {
  exact(value, ['role', 'content']);
  requireFact(value.role === role, 'INVALID_INPUT');
  return Object.freeze({ role, content: text(value.content, 8192) });
}
/** JSON envelope proof only. Scalar-dependent production paths remain closed. */
export function validateNativeSession(
  value: unknown,
  b: RuntimeBinding,
  stageRef: string,
  status = b.status.toLowerCase(),
  nativeAt = b.nativeUpdatedAt ?? b.createdAt,
) {
  exact(value, [
    'id',
    'stageId',
    'learnerKey',
    'kind',
    'status',
    'createdAt',
    'updatedAt',
    'runtimeDslVersion',
  ]);
  requireFact(
    value.id === b.runtimeRef &&
      value.stageId === stageRef &&
      value.learnerKey === b.learnerHandle &&
      value.kind === 'chat' &&
      value.status === status &&
      value.runtimeDslVersion === '0.1.0',
  );
  requireFact(
    canonicalTime(value.createdAt) === new Date(b.createdAt).toISOString() &&
      canonicalTime(value.updatedAt) === new Date(nativeAt).toISOString(),
  );
}
export function validateNativeRecord(
  value: unknown,
  b: RuntimeBinding,
  op: RuntimeOperation,
  payload: unknown,
  sceneRef: string | null,
) {
  const keys = [
    'id',
    'sessionId',
    'seq',
    'createdAt',
    'payload',
    ...(sceneRef === null ? [] : ['sceneId']),
  ];
  exact(value, keys);
  requireFact(
    value.id === op.nativeRecordRef &&
      value.sessionId === b.runtimeRef &&
      value.seq === (op.expectedLastSeq === null ? 0 : op.expectedLastSeq + 1),
  );
  requireFact(
    canonicalTime(value.createdAt) === new Date(op.createdAt).toISOString() &&
      (value.sceneId ?? null) === sceneRef,
  );
  const p = chatPayload(value.payload, op.command === 'APPEND_USER_RECORD' ? 'user' : 'assistant');
  requireFact(
    JSON.stringify(p) === JSON.stringify(payload) &&
      Buffer.byteLength(JSON.stringify(value)) === op.serializedBytes,
  );
}
export function validateOperation(op: RuntimeOperation) {
  exact(op, [
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
  ]);
  for (const k of [
    'tenantId',
    'operationId',
    'bindingId',
    'generationId',
    'actorUserId',
    'actorMembershipId',
  ] as const)
    uuid(op[k]);
  digest(op.keyDigest);
  digest(op.intentDigest);
  text(op.requestId, 256, true);
  rev(op.revision);
  rev(op.expectedRevision);
  rev(op.reservedRevision);
  requireFact(BigInt(op.reservedRevision) === BigInt(op.expectedRevision) + BigInt(1));
  requireFact(Number.isSafeInteger(op.authorizationVersion) && op.authorizationVersion >= 0);
  requireFact(
    [
      'CREATE_RUNTIME',
      'APPEND_USER_RECORD',
      'APPEND_ASSISTANT_RECORD',
      'COMPLETE_RUNTIME',
      'ARCHIVE_RUNTIME',
    ].includes(op.command),
  );
  requireFact(
    ['PENDING', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'FAILED'].includes(op.priorStatus) &&
      ['RESERVED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(op.state),
  );
  requireFact(
    [
      'NONE',
      'DENIED',
      'STALE',
      'INVALID_INPUT',
      'BUDGET_EXCEEDED',
      'STORAGE_FAILURE',
      'INTEGRITY_FAILURE',
      'CANCELLED',
      'UNKNOWN_OUTCOME',
    ].includes(op.reason),
  );
  instant(op.createdAt);
  instant(op.updatedAt);
  requireFact(op.updatedAt >= op.createdAt);
  tail(op.expectedLastSeq);
  tail(op.resultLastSeq);
  requireFact(
    Number.isSafeInteger(op.priorCount) &&
      op.priorCount >= 0 &&
      op.priorCount <= 128 &&
      BigInt(op.expectedRevision) <= BigInt('9223372036854775805') &&
      op.expectedLastSeq === (op.priorCount === 0 ? null : op.priorCount - 1),
  );
  requireFact(
    Number.isSafeInteger(op.priorBytes) &&
      op.priorBytes >= 0 &&
      op.priorBytes <= 2097152 &&
      (op.priorBytes === 0) === (op.priorCount === 0),
  );
  const append = op.command.startsWith('APPEND_');
  if (append) {
    requireFact(
      op.priorStatus === 'ACTIVE' &&
        op.priorCount < 128 &&
        op.targetStatus === null &&
        op.recordId !== null &&
        op.nativeRecordRef !== null &&
        op.payloadDigest !== null,
    );
    requireFact(op.priorBytes + op.serializedBytes! <= 2097152);
    uuid(op.recordId);
    opaque(op.nativeRecordRef);
    digest(op.payloadDigest);
    requireFact(
      op.payloadBytes !== null &&
        Number.isSafeInteger(op.payloadBytes) &&
        op.payloadBytes > 0 &&
        op.payloadBytes <= 8192 &&
        op.serializedBytes !== null &&
        Number.isSafeInteger(op.serializedBytes) &&
        op.serializedBytes > 0 &&
        op.serializedBytes <= 16384,
    );
    if (op.sceneBindingId !== null) uuid(op.sceneBindingId);
  } else {
    requireFact(
      [
        op.recordId,
        op.nativeRecordRef,
        op.sceneBindingId,
        op.payloadDigest,
        op.payloadBytes,
        op.serializedBytes,
      ].every((v) => v === null),
    );
    requireFact(
      op.targetStatus ===
        (op.command === 'COMPLETE_RUNTIME'
          ? 'COMPLETED'
          : op.command === 'ARCHIVE_RUNTIME'
            ? 'ARCHIVED'
            : null),
    );
    if (op.command === 'CREATE_RUNTIME')
      requireFact(op.priorStatus === 'PENDING' && op.priorCount === 0);
    else
      requireFact(
        op.priorStatus === 'ACTIVE' ||
          (op.command === 'ARCHIVE_RUNTIME' && op.priorStatus === 'COMPLETED'),
      );
  }
  if (op.dispatchStartedAt !== null)
    requireFact(
      instant(op.dispatchStartedAt) >= op.createdAt && op.dispatchStartedAt <= op.updatedAt,
    );
  const terminal = op.state === 'SUCCEEDED' || op.state === 'FAILED';
  requireFact(
    op.state === 'RESERVED'
      ? (op.revision === '1' && op.dispatchStartedAt === null) ||
          (op.revision === '2' && op.dispatchStartedAt !== null)
      : op.state === 'OUTCOME_UNKNOWN'
        ? op.revision === '3'
        : (op.revision === '2' && op.state === 'FAILED' && op.dispatchStartedAt === null) ||
          (['3', '4'].includes(op.revision) && op.dispatchStartedAt !== null),
  );
  if (terminal) {
    requireFact(
      op.completedAt !== null &&
        instant(op.completedAt) >= (op.dispatchStartedAt ?? op.createdAt) &&
        op.completedAt <= op.updatedAt &&
        op.resultRevision !== null &&
        BigInt(rev(op.resultRevision)) === BigInt(op.reservedRevision) + BigInt(1),
    );
    requireFact(
      op.resultLastSeq ===
        (op.state === 'SUCCEEDED' && append ? op.priorCount : op.expectedLastSeq),
    );
    requireFact(
      op.state === 'SUCCEEDED'
        ? op.dispatchStartedAt !== null && op.reason === 'NONE'
        : !['NONE', 'UNKNOWN_OUTCOME'].includes(op.reason),
    );
  } else
    requireFact(
      op.completedAt === null &&
        op.resultRevision === null &&
        op.resultLastSeq === null &&
        (op.state === 'RESERVED'
          ? op.reason === 'NONE'
          : op.reason === 'UNKNOWN_OUTCOME' && op.dispatchStartedAt !== null),
    );
  return op;
}
