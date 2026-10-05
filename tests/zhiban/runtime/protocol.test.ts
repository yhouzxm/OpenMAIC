import { it, expect } from 'vitest';
import { FakeRuntimePersistence, pendingBinding } from './fakes';
import { sharedRuntimeContract } from './shared-contract';
import {
  RuntimeProtocol,
  producerIntent,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/protocol';
import { allocateRef, MAX_REVISION } from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';
function fixture() {
  const b = pendingBinding(),
    store = new FakeRuntimePersistence(b),
    actor = {
      userId: store.ownerUserId,
      membershipId: b.learnerMembershipId,
      authorizationVersion: 0,
      requestId: 'synthetic-c9',
    };
  return {
    store,
    actor,
    template: b,
    binding: async () => store.binding,
    events: async () => store.events,
  };
}
sharedRuntimeContract('C9 Fake shared persistence', async () => fixture());
it('audit failure rolls back reservation and does not dispatch', async () => {
  const f = fixture();
  f.store.auditFailure = true;
  let called = false;
  const p = new RuntimeProtocol(f.store, {
    dispatch: async () => {
      called = true;
    },
  });
  expect(
    await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
      idempotencyKey: allocateRef(),
      expectedLastSeq: null,
    }),
  ).toMatchObject({ status: 'FAILED' });
  expect(f.store.binding).toBeNull();
  expect(f.store.operations.size).toBe(0);
  expect(called).toBe(false);
});
it('stale authorization and inactive participant fail before reservation', async () => {
  const f = fixture();
  f.store.authorizationVersion = 1;
  const p = new RuntimeProtocol(f.store, {
    dispatch: async () => {
      throw Error('must not execute');
    },
  });
  expect(
    await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
      idempotencyKey: allocateRef(),
      expectedLastSeq: null,
    }),
  ).toMatchObject({ status: 'FAILED', reason: 'DENIED' });
  expect(f.store.events).toHaveLength(0);
});
it('settlement failure after native commit retains committed fence', async () => {
  const f = fixture();
  const p = new RuntimeProtocol(f.store, {
    dispatch: async () => {
      f.store.active = false;
    },
  });
  expect(
    await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
      idempotencyKey: allocateRef(),
      expectedLastSeq: null,
    }),
  ).toMatchObject({ status: 'FAILED', reason: 'OUTCOME_UNKNOWN' });
  expect(f.store.binding).toMatchObject({ revision: '2', status: 'PENDING' });
  expect(f.store.binding!.outstandingOperationId).not.toBeNull();
});
it.each([MAX_REVISION, MAX_REVISION - BigInt(1)])(
  'max revision reserves no side effect',
  async (value) => {
    const f = fixture();
    f.template.revision = value.toString();
    const p = new RuntimeProtocol(f.store, {
      dispatch: async () => {
        throw Error('must not execute');
      },
    });
    expect(
      await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, value.toString(), {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
      }),
    ).toMatchObject({ status: 'FAILED' });
    expect(f.store.operations.size).toBe(0);
  },
);
it('assistant requires an exact server-issued capability, not a structural flag', async () => {
  const f = fixture(),
    registry = new WeakMap<object, string>(),
    p = new RuntimeProtocol(f.store, { dispatch: async () => {} }, registry);
  await p.execute('CREATE_RUNTIME', f.actor, f.template.bindingId, '1', {
    idempotencyKey: allocateRef(),
    expectedLastSeq: null,
  });
  const input = {
    idempotencyKey: allocateRef(),
    expectedLastSeq: null,
    content: 'Synthetic assistant',
    sceneBindingId: null,
    producer: {},
  };
  expect(
    await p.execute('APPEND_ASSISTANT_RECORD', f.actor, f.template.bindingId, '3', input),
  ).toMatchObject({ status: 'FAILED', reason: 'DENIED' });
  registry.set(
    input.producer,
    producerIntent(f.template.bindingId, input.idempotencyKey, input.content),
  );
  expect(
    await p.execute('APPEND_ASSISTANT_RECORD', f.actor, f.template.bindingId, '3', input),
  ).toMatchObject({ status: 'SUCCEEDED', lastSeq: 0 });
});
