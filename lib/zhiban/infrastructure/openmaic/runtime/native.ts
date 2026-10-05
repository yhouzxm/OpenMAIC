import { PgRuntimeStore, type Queryable } from '@openmaic/storage/runtime/pg';
import type { TransactionPool } from '../../identity/postgres/transactions';
import type { RuntimeBinding, RuntimeOperation } from './records';
import { chatPayload, validateNativeRecord, validateNativeSession } from './records';
import { RuntimeDeadline } from './admission';
import { NativeFailure, runtimeTransaction } from './transactions';
import { requireFact, RuntimeFailure } from './validation';

/** Internal diagnostic adapter. It is never reachable from the production facade. */
export class NativeRuntime {
  constructor(private readonly pool: TransactionPool) {}
  async dispatch(
    b: RuntimeBinding,
    op: RuntimeOperation,
    stageRef: string,
    payload: unknown,
    sceneRef: string | null,
    deadline: RuntimeDeadline,
    authority: () => Promise<void>,
  ) {
    const iso = new Date(
      op.command === 'CREATE_RUNTIME' ? b.createdAt : op.createdAt,
    ).toISOString();
    try {
      if (op.command === 'CREATE_RUNTIME')
        return await runtimeTransaction(
          this.pool,
          deadline,
          async (client) => {
            const store = new PgRuntimeStore(this.checked(client), {
              withTransaction: async () => {
                throw new RuntimeFailure();
              },
            });
            const session = await store.createSession({
              id: b.runtimeRef,
              stageId: stageRef,
              learnerKey: b.learnerHandle,
              kind: 'chat',
              status: 'active',
              createdAt: iso,
              updatedAt: iso,
            });
            validateNativeSession(session, b, stageRef, 'active', b.createdAt);
          },
          authority,
        );
      const withTransaction = async <T>(body: (q: Queryable) => Promise<T>) =>
        runtimeTransaction(
          this.pool,
          deadline,
          async (client) => {
            const reader = new PgRuntimeStore(this.checked(client), {
              withTransaction: async () => {
                throw new RuntimeFailure();
              },
            });
            validateNativeSession(await reader.getSession(b.runtimeRef), b, stageRef);
            requireFact(
              b.status === 'ACTIVE' ||
                (b.status === 'COMPLETED' && op.command === 'ARCHIVE_RUNTIME'),
            );
            const result = await body(this.checked(client));
            if (op.command.startsWith('APPEND_'))
              validateNativeRecord(result, b, op, payload, sceneRef);
            validateNativeSession(
              await reader.getSession(b.runtimeRef),
              b,
              stageRef,
              op.targetStatus?.toLowerCase() ?? 'active',
              op.createdAt,
            );
            return result;
          },
          authority,
        );
      const store = new PgRuntimeStore(
        {
          query: async () => {
            throw new RuntimeFailure();
          },
        },
        {
          withTransaction,
          payloadValidators: {
            chat: (value) => {
              chatPayload(value, op.command === 'APPEND_USER_RECORD' ? 'user' : 'assistant');
              return { valid: true, errors: [] };
            },
          },
        },
      );
      if (op.command.startsWith('APPEND_')) {
        requireFact(op.nativeRecordRef !== null);
        await store.appendRecord(
          {
            id: op.nativeRecordRef,
            sessionId: b.runtimeRef,
            createdAt: iso,
            payload: chatPayload(
              payload,
              op.command === 'APPEND_USER_RECORD' ? 'user' : 'assistant',
            ),
            ...(sceneRef === null ? {} : { sceneId: sceneRef }),
          },
          {
            expectedLastSeq: op.expectedLastSeq,
            sessionTransition: { status: 'active', updatedAt: iso },
          },
        );
      } else {
        requireFact(op.targetStatus === 'COMPLETED' || op.targetStatus === 'ARCHIVED');
        await store.setSessionStatus(
          b.runtimeRef,
          op.targetStatus === 'COMPLETED' ? 'completed' : 'archived',
          iso,
          { expectedLastSeq: op.expectedLastSeq },
        );
      }
    } catch (error) {
      if (error instanceof NativeFailure) throw error;
      // No provider cause, IDs, validation diagnostics or retryable code escapes.
      throw new NativeFailure('NOT_DISPATCHED');
    }
  }
  private checked(queryable: Queryable): Queryable {
    return {
      query: async <R extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
        const result = await queryable.query<R>(sql, parameters);
        // Validate provider-returned JSON before its public migration machinery runs.
        // Uses the public Queryable; no private SQL or duplicated scalar inspection.
        for (const row of result.rows)
          if (Object.hasOwn(row, 'data')) {
            const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
            requireFact(
              data !== null &&
                typeof data === 'object' &&
                data.runtimeDslVersion === '0.1.0' &&
                data.kind === 'chat',
            );
          }
        return result;
      },
    };
  }
}
