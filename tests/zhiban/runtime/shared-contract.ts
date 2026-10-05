import { describe, it, expect } from 'vitest';
import type {
  RuntimePersistence,
  RuntimeActor,
  RuntimeDispatch,
  RuntimeOutcomeProof,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/protocol';
import { RuntimeProtocol } from '@/lib/zhiban/infrastructure/openmaic/runtime/protocol';
import type { RuntimeBinding } from '@/lib/zhiban/infrastructure/openmaic/runtime/records';
import {
  allocateRef,
  RuntimeFailure,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';
import { NativeFailure } from '@/lib/zhiban/infrastructure/openmaic/runtime/transactions';
interface Fixture {
  store: RuntimePersistence;
  template: RuntimeBinding;
  actor: RuntimeActor;
  binding(): Promise<RuntimeBinding | null>;
  events(): Promise<unknown[]>;
}
export function sharedRuntimeContract(name: string, fixture: () => Promise<Fixture>) {
  describe(name, () => {
    it('create reserves/marks/settles with +2 binding/+2 operation revisions and three audits', async () => {
      const f = await fixture();
      let calls = 0;
      const protocol = new RuntimeProtocol(f.store, {
        dispatch: async () => {
          calls++;
        },
      });
      expect(
        await protocol.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ status: 'SUCCEEDED', revision: '3', state: 'ACTIVE', lastSeq: null });
      expect(calls).toBe(1);
      expect(await f.events()).toHaveLength(3);
    });
    it('concurrent initial create exactly one dispatch succeeds', async () => {
      const f = await fixture();
      let calls = 0;
      const protocol = new RuntimeProtocol(f.store, {
        dispatch: async () => {
          calls++;
        },
      });
      const out = await Promise.all(
        [0, 1].map(() =>
          protocol.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
            idempotencyKey: allocateRef(),
            expectedLastSeq: null,
          }),
        ),
      );
      expect(out.filter((r) => r.status === 'SUCCEEDED')).toHaveLength(1);
      expect(calls).toBe(1);
      expect((await f.binding())?.revision).toBe('3');
    });
    it('append advances contiguous tail/counters once and preserves new record IDs/history', async () => {
      const f = await fixture();
      const ops: string[] = [];
      const native: RuntimeDispatch = {
        dispatch: async (_b, op) => {
          if (op.recordId) ops.push(op.recordId);
        },
      };
      const p = new RuntimeProtocol(f.store, native);
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      });
      for (const [rev, seq] of [
        ['3', null],
        ['5', 0],
      ] as const)
        expect(
          await p.execute('APPEND_USER_RECORD', f.actor, f.template.bindingId, rev, {
            idempotencyKey: allocateRef(),
            expectedLastSeq: seq,
            content: 'Synthetic record',
            sceneBindingId: null,
          }),
        ).toMatchObject({ status: 'SUCCEEDED' });
      const b = await f.binding();
      expect(b).toMatchObject({ revision: '7', lastSeq: 1, recordCount: 2 });
      expect(b!.recordBytes).toBeGreaterThan(0);
      expect(new Set(ops).size).toBe(2);
    });
    it('stale-before-no-op and terminal lifecycle do not revive', async () => {
      const f = await fixture();
      const p = new RuntimeProtocol(f.store, { dispatch: async () => {} });
      const input = { idempotencyKey: allocateRef(), expectedLastSeq: null };
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', input);
      await p.execute('COMPLETE_RUNTIME', f.actor, f.template.bindingId, '3', {
        ...input,
        idempotencyKey: allocateRef(),
      });
      expect(
        await p.execute('COMPLETE_RUNTIME', f.actor, f.template.bindingId, '3', {
          ...input,
          idempotencyKey: allocateRef(),
        }),
      ).toMatchObject({ status: 'FAILED', reason: 'STALE' });
      expect(
        await p.execute('COMPLETE_RUNTIME', f.actor, f.template.bindingId, '5', {
          ...input,
          idempotencyKey: allocateRef(),
        }),
      ).toMatchObject({ status: 'SUCCEEDED', revision: '5' });
      await p.execute('ARCHIVE_RUNTIME', f.actor, f.template.bindingId, '5', {
        ...input,
        idempotencyKey: allocateRef(),
      });
      expect(
        await p.execute('APPEND_USER_RECORD', f.actor, f.template.bindingId, '7', {
          ...input,
          content: 'Synthetic record',
          sceneBindingId: null,
        }),
      ).toMatchObject({ status: 'FAILED', reason: 'DENIED' });
      expect((await f.binding())?.revision).toBe('7');
    });
    it('native unknown outcome stays fenced and cannot be redispatched', async () => {
      const f = await fixture();
      let calls = 0;
      const p = new RuntimeProtocol(f.store, {
        dispatch: async () => {
          calls++;
          throw new NativeFailure('UNKNOWN');
        },
      });
      const input = { idempotencyKey: allocateRef(), expectedLastSeq: null };
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', input),
      ).toMatchObject({ status: 'FAILED', reason: 'OUTCOME_UNKNOWN' });
      expect((await f.binding())?.outstandingOperationId).not.toBeNull();
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '2', input),
      ).toMatchObject({ status: 'FAILED', reason: 'OUTCOME_UNKNOWN' });
      expect(calls).toBe(1);
    });
    it('proved rollback terminalizes failed create atomically', async () => {
      const f = await fixture();
      const p = new RuntimeProtocol(f.store, {
        dispatch: async () => {
          throw new NativeFailure('ROLLED_BACK');
        },
      });
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ status: 'FAILED', reason: 'STORAGE_FAILURE' });
      expect(await f.binding()).toMatchObject({
        status: 'FAILED',
        revision: '3',
        outstandingOperationId: null,
      });
    });
    it('read-only outcome inspection uses current revision and original immutable input', async () => {
      const f = await fixture();
      let calls = 0;
      const p = new RuntimeProtocol(f.store, {
          dispatch: async () => {
            calls++;
          },
        }),
        input = { idempotencyKey: allocateRef(), expectedLastSeq: null };
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', input);
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', input),
      ).toMatchObject({ status: 'FAILED', reason: 'STALE' });
      expect(
        await p.readOutcome(f.actor, f.template.bindingId, '3', 'CREATE_RUNTIME', input, null),
      ).toMatchObject({ status: 'SUCCEEDED', revision: '3' });
      expect(calls).toBe(1);
      expect(await f.events()).toHaveLength(3);
    });
    it('missing read neither inserts binding nor creates an audit', async () => {
      const f = await fixture(),
        p = new RuntimeProtocol(f.store, {
          dispatch: async () => {
            throw Error('unused');
          },
        });
      expect(await p.readSession(f.actor, f.template.bindingId, '1', null)).toMatchObject({
        status: 'FAILED',
      });
      expect(await f.binding()).toBeNull();
      expect(await f.events()).toHaveLength(0);
    });
    it('completed failed outcome inspection does not misreport mutation success', async () => {
      const f = await fixture(),
        input = { idempotencyKey: allocateRef(), expectedLastSeq: null };
      let calls = 0;
      const p = new RuntimeProtocol(f.store, {
        dispatch: async () => {
          calls++;
          throw new NativeFailure('ROLLED_BACK');
        },
      });
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', input),
      ).toMatchObject({ status: 'FAILED', reason: 'STORAGE_FAILURE' });
      expect(
        await p.readOutcome(f.actor, f.template.bindingId, '3', 'CREATE_RUNTIME', input, null),
      ).toEqual({ status: 'FAILED', reason: 'STORAGE_FAILURE' });
      expect(await p.readSession(f.actor, f.template.bindingId, '3', null)).toMatchObject({
        status: 'SUCCEEDED',
        state: 'FAILED',
      });
      expect(await f.events()).toHaveLength(3);
      expect(calls).toBe(1);
    });
    it('crash after reserve is fenced; only unmarked cancellation settles with +1 operation revision', async () => {
      const f = await fixture();
      let calls = 0,
        txCount = 0;
      const broken: RuntimePersistence = {
        transaction: (...args) => {
          if (++txCount === 2) throw new RuntimeFailure();
          return f.store.transaction(...args);
        },
      };
      const p = new RuntimeProtocol(broken, {
        dispatch: async () => {
          calls++;
        },
      });
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ status: 'FAILED' });
      const b = (await f.binding())!;
      expect(b.revision).toBe('2');
      expect(b.outstandingOperationId).not.toBeNull();
      const clean = new RuntimeProtocol(f.store, {
        dispatch: async () => {
          calls++;
        },
      });
      expect(
        await clean.cancelReserved(f.actor, f.template.bindingId, '1', b.outstandingOperationId!),
      ).toMatchObject({ reason: 'STALE' });
      expect(
        await clean.cancelReserved(f.actor, f.template.bindingId, '2', b.outstandingOperationId!),
      ).toEqual({ status: 'FAILED', reason: 'CANCELLED' });
      expect(await f.binding()).toMatchObject({
        revision: '3',
        status: 'FAILED',
        outstandingOperationId: null,
      });
      expect(await f.events()).toHaveLength(2);
      expect(calls).toBe(0);
    });
    it('crash after mark cannot remint dispatch; explicit exclusive proof reconciles without native replay', async () => {
      const f = await fixture();
      let txCount = 0,
        calls = 0;
      const broken: RuntimePersistence = {
        transaction: (...args) => {
          if (++txCount === 3) throw new RuntimeFailure();
          return f.store.transaction(...args);
        },
      };
      const p = new RuntimeProtocol(broken, {
        dispatch: async () => {
          calls++;
        },
      });
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      });
      const b = (await f.binding())!,
        proof = {},
        proofs = new WeakMap<object, RuntimeOutcomeProof>(),
        clean = new RuntimeProtocol(
          f.store,
          {
            dispatch: async () => {
              calls++;
            },
          },
          undefined,
          proofs,
        );
      expect(
        await clean.cancelReserved(f.actor, f.template.bindingId, '2', b.outstandingOperationId!),
      ).toMatchObject({ status: 'FAILED' });
      await clean.quarantineMarked(f.actor, f.template.bindingId, '2', b.outstandingOperationId!);
      expect(
        await clean.reconcile(f.actor, f.template.bindingId, '2', b.outstandingOperationId!, {}),
      ).toMatchObject({ reason: 'DENIED' });
      proofs.set(proof, { operationId: b.outstandingOperationId!, outcome: 'ROLLED_BACK' });
      expect(
        await clean.reconcile(f.actor, f.template.bindingId, '2', b.outstandingOperationId!, proof),
      ).toMatchObject({ status: 'FAILED', reason: 'STORAGE_FAILURE' });
      expect(await f.binding()).toMatchObject({
        revision: '3',
        status: 'FAILED',
        outstandingOperationId: null,
      });
      expect(await f.events()).toHaveLength(4);
      expect(calls).toBe(0);
      expect(
        await clean.reconcile(f.actor, f.template.bindingId, '3', b.outstandingOperationId!, proof),
      ).toMatchObject({ reason: 'DENIED' });
    });
    it('append unknown outcome cannot be reconciled through the unsupported public getter', async () => {
      const f = await fixture(),
        proofs = new WeakMap<object, RuntimeOutcomeProof>();
      let calls = 0;
      const p = new RuntimeProtocol(
        f.store,
        {
          dispatch: async () => {
            if (++calls === 2) throw new NativeFailure('UNKNOWN');
          },
        },
        undefined,
        proofs,
      );
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      });
      await p.execute('APPEND_USER_RECORD', f.actor, f.template.bindingId, '3', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
        content: 'Synthetic unknown record',
        sceneBindingId: null,
      });
      const b = (await f.binding())!,
        proof = {};
      proofs.set(proof, { operationId: b.outstandingOperationId!, outcome: 'COMMITTED' });
      expect(
        await p.reconcile(f.actor, f.template.bindingId, '4', b.outstandingOperationId!, proof),
      ).toMatchObject({ reason: 'DENIED' });
      expect(await f.binding()).toMatchObject({ revision: '4', recordCount: 0 });
      expect(calls).toBe(2);
    });
    it('failed quarantine and unknown completion retain the dispatch fence and deny reads', async () => {
      const f = await fixture();
      let n = 0,
        calls = 0;
      const broken: RuntimePersistence = {
        transaction: (...args) => {
          if (++n === 4) throw new RuntimeFailure();
          return f.store.transaction(...args);
        },
      };
      const p = new RuntimeProtocol(broken, {
        dispatch: async () => {
          calls++;
          throw new NativeFailure('UNKNOWN');
        },
      });
      expect(
        await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
          idempotencyKey: allocateRef(),
          expectedLastSeq: null,
        }),
      ).toMatchObject({ reason: 'OUTCOME_UNKNOWN' });
      expect(
        await new RuntimeProtocol(f.store, {
          dispatch: async () => {
            calls++;
          },
        }).readSession(f.actor, f.template.bindingId, '2', null),
      ).toMatchObject({ reason: 'OUTCOME_UNKNOWN' });
      expect(await f.events()).toHaveLength(2);
      expect(calls).toBe(1);
    });
  });
}
