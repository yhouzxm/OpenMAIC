import { it, expect, vi, afterEach } from 'vitest';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { NativeRuntime } from '@/lib/zhiban/infrastructure/openmaic/runtime/native';
import { RuntimeProtocol } from '@/lib/zhiban/infrastructure/openmaic/runtime/protocol';
import { FakeRuntimePersistence, pendingBinding } from './fakes';
import { allocateRef } from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';
import { RuntimeFailure } from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';
import {
  runtimeTransaction,
  NativeFailure,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/transactions';
import {
  RuntimeDeadline,
  RetainedAdmission,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/admission';
afterEach(() => vi.useRealTimers());
/** SQL model drives the actual public provider; observes params/order rather than mocked result. */
export function providerFixture() {
  let session: Record<string, unknown> | null = null,
    records: Record<string, unknown>[] = [];
  const commands: string[] = [];
  let releases = 0,
    inserts = 0,
    failure: string | null = null,
    loseCommit = false;
  const pool = {
    connect: async () => {
      let snapshot: unknown;
      return {
        release: () => {
          releases++;
        },
        query: async (sql: string, params: unknown[] = []) => {
          const normalized = sql.replace(/\s+/g, ' ').trim();
          commands.push(normalized);
          if (sql.startsWith('BEGIN')) {
            snapshot = structuredClone({ session, records });
            return { rows: [], command: 'BEGIN', rowCount: null };
          }
          if (sql === 'ROLLBACK') {
            const old = snapshot as { session: typeof session; records: typeof records };
            session = old.session;
            records = old.records;
            return { rows: [], command: 'ROLLBACK', rowCount: null };
          }
          if (sql === 'COMMIT') {
            if (loseCommit)
              throw Object.assign(Error('private-commit-detail'), {
                code: '40001',
                cause: 'sentinel',
              });
            return { rows: [], command: 'COMMIT', rowCount: null };
          }
          if (/INSERT INTO runtime_sessions/.test(sql)) {
            session = JSON.parse(params[7] as string);
            return { rows: [], command: 'INSERT', rowCount: 1 };
          }
          if (/INSERT INTO runtime_records/.test(sql)) {
            inserts++;
            if (failure)
              throw Object.assign(Error('private-native-detail'), {
                code: failure,
                cause: { secret: 'sentinel-private' },
              });
            records.push(JSON.parse(params[5] as string));
            return { rows: [], command: 'INSERT', rowCount: 1 };
          }
          if (/UPDATE runtime_sessions/.test(sql)) {
            session = JSON.parse(params[7] as string);
            return { rows: [], command: 'UPDATE', rowCount: 1 };
          }
          if (/MAX\(seq\)/.test(sql))
            return {
              rows: [{ last_seq: String(records.length - 1) }],
              command: 'SELECT',
              rowCount: 1,
            };
          if (/SELECT data FROM runtime_sessions/.test(normalized))
            return {
              rows: session ? [{ data: structuredClone(session) }] : [],
              command: 'SELECT',
              rowCount: session ? 1 : 0,
            };
          return { rows: [], command: 'SET', rowCount: null };
        },
      };
    },
  } as unknown as TransactionPool;
  const b = pendingBinding(),
    store = new FakeRuntimePersistence(b),
    actor = {
      userId: store.ownerUserId,
      membershipId: b.learnerMembershipId,
      authorizationVersion: 0,
      requestId: 'synthetic-provider',
    };
  return {
    pool,
    b,
    store,
    actor,
    commands,
    get session() {
      return session;
    },
    get records() {
      return records;
    },
    get releases() {
      return releases;
    },
    get inserts() {
      return inserts;
    },
    fail: (code: string) => {
      failure = code;
    },
    loseCommit: () => {
      loseCommit = true;
    },
    protocol: new RuntimeProtocol(store, new NativeRuntime(pool)),
  };
}
it('actual public create/append/status uses fresh transactions and exact canonical parameters', async () => {
  const f = providerFixture(),
    input = { idempotencyKey: allocateRef(), expectedLastSeq: null };
  expect(
    await f.protocol.execute('CREATE_RUNTIME', f.actor, f.b.bindingId, '1', input),
  ).toMatchObject({ status: 'SUCCEEDED' });
  expect(f.session).toMatchObject({
    runtimeDslVersion: '0.1.0',
    id: f.b.runtimeRef,
    kind: 'chat',
    learnerKey: f.b.learnerHandle,
  });
  expect(
    await f.protocol.execute('APPEND_USER_RECORD', f.actor, f.b.bindingId, '3', {
      ...input,
      idempotencyKey: allocateRef(),
      content: 'Synthetic provider record',
      sceneBindingId: null,
    }),
  ).toMatchObject({ status: 'SUCCEEDED', lastSeq: 0 });
  expect(f.records).toHaveLength(1);
  expect(f.records[0]).toMatchObject({
    sessionId: f.b.runtimeRef,
    seq: 0,
    payload: { role: 'user', content: 'Synthetic provider record' },
  });
  expect(
    await f.protocol.execute('COMPLETE_RUNTIME', f.actor, f.b.bindingId, '5', {
      idempotencyKey: allocateRef(),
      expectedLastSeq: 0,
    }),
  ).toMatchObject({ status: 'SUCCEEDED', state: 'COMPLETED' });
  expect(f.session?.status).toBe('completed');
  expect(f.releases).toBe(3);
  expect(f.commands.filter((c) => c === 'COMMIT')).toHaveLength(3);
  expect(f.commands.findIndex((c) => c.includes('INSERT INTO runtime_records'))).toBeGreaterThan(
    f.commands.findIndex((c) => c.includes('FOR UPDATE')),
  );
});
it.each(['23505', '40001', '40P01'])(
  'real public append loop receives sanitized %s after ONE transaction',
  async (code) => {
    const f = providerFixture();
    await f.protocol.execute('CREATE_RUNTIME', f.actor, f.b.bindingId, '1', {
      idempotencyKey: allocateRef(),
      expectedLastSeq: null,
    });
    f.fail(code);
    expect(
      await f.protocol.execute('APPEND_USER_RECORD', f.actor, f.b.bindingId, '3', {
        idempotencyKey: allocateRef(),
        expectedLastSeq: null,
        content: 'sentinel-private',
        sceneBindingId: null,
      }),
    ).toEqual({ status: 'FAILED', reason: 'STORAGE_FAILURE' });
    expect(f.inserts).toBe(1);
    expect(f.commands.filter((c) => c === 'ROLLBACK')).toHaveLength(1);
    expect(f.records).toHaveLength(0);
    expect(f.releases).toBe(2);
    expect(f.store.binding).toMatchObject({
      status: 'ACTIVE',
      revision: '5',
      recordCount: 0,
      outstandingOperationId: null,
    });
  },
);
it('lost native COMMIT acknowledgement remains fenced even if its row actually persisted', async () => {
  const f = providerFixture();
  f.loseCommit();
  expect(
    await f.protocol.execute('CREATE_RUNTIME', f.actor, f.b.bindingId, '1', {
      idempotencyKey: allocateRef(),
      expectedLastSeq: null,
    }),
  ).toEqual({ status: 'FAILED', reason: 'OUTCOME_UNKNOWN' });
  expect(f.session !== null).toBe(true);
  expect(f.store.binding).toMatchObject({ revision: '2', status: 'PENDING' });
  expect(f.store.binding!.outstandingOperationId).not.toBeNull();
  expect(f.releases).toBe(1);
  expect(f.commands.filter((c) => c === 'ROLLBACK')).toHaveLength(0);
});
it.each(['BEGIN', 'ROLLBACK', 'COMMIT', 'release'])(
  'uncertain %s transaction tags/cleanup discard the client without leaking driver metadata',
  async (fault) => {
    const commands: string[] = [],
      discarded: boolean[] = [];
    const pool = {
      connect: async () => ({
        release: (bad?: boolean) => {
          discarded.push(Boolean(bad));
          if (fault === 'release')
            throw Object.assign(Error('private-release'), { cause: 'sentinel' });
        },
        query: async (sql: string) => {
          commands.push(sql);
          if (sql === fault || (fault === 'BEGIN' && sql.startsWith('BEGIN')))
            throw Object.assign(Error('private-driver'), { code: '40P01', cause: 'sentinel' });
          return { rows: [], rowCount: null, command: sql.startsWith('BEGIN') ? 'BEGIN' : sql };
        },
      }),
    } as unknown as TransactionPool;
    const error = await runtimeTransaction(pool, new RuntimeDeadline(), async () => {
      if (fault === 'ROLLBACK') throw Error('private-work');
    }).catch((e) => e);
    expect(error instanceof NativeFailure).toBe(true);
    expect(error.outcome).toBe(fault === 'BEGIN' ? 'NOT_DISPATCHED' : 'UNKNOWN');
    expect(Object.hasOwn(error, 'cause')).toBe(false);
    expect(Object.hasOwn(error, 'code')).toBe(false);
    expect(JSON.stringify(error).includes('private')).toBe(false);
    expect(discarded).toEqual([fault !== 'release']);
    if (fault === 'COMMIT') expect(commands).not.toContain('ROLLBACK');
  },
);
it('known rollback sanitizes retryable driver error and releases reusable client', async () => {
  let discarded: boolean | undefined;
  const pool = {
    connect: async () => ({
      release: (bad?: boolean) => {
        discarded = bad;
      },
      query: async (sql: string) => ({
        rows: [],
        rowCount: null,
        command: sql.startsWith('BEGIN') ? 'BEGIN' : sql,
      }),
    }),
  } as unknown as TransactionPool;
  const error = await runtimeTransaction(pool, new RuntimeDeadline(), async () => {
    throw Object.assign(Error('private'), { code: '23505', cause: 'sentinel' });
  }).catch((e) => e);
  expect(error).toBeInstanceOf(NativeFailure);
  expect(error.outcome).toBe('ROLLED_BACK');
  expect(discarded).toBe(false);
  expect(Object.hasOwn(error, 'code')).toBe(false);
  expect(Object.hasOwn(error, 'cause')).toBe(false);
});
it('tagged internal errors are reconstructed, stripping code/cause/custom security material', async () => {
  const pool = {
    connect: async () => ({
      release: () => {},
      query: async (sql: string) => ({
        rows: [],
        rowCount: null,
        command: sql.startsWith('BEGIN') ? 'BEGIN' : sql,
      }),
    }),
  } as unknown as TransactionPool;
  const original = Object.assign(new RuntimeFailure('DENIED'), {
    code: '40001',
    cause: 'sentinel',
    custom: 'sentinel',
  });
  const error = await runtimeTransaction(pool, new RuntimeDeadline(), async () => {
    throw original;
  }).catch((e) => e);
  expect(error === original).toBe(false);
  expect(error.reason).toBe('DENIED');
  expect(['code', 'cause', 'custom'].some((k) => Object.hasOwn(error, k))).toBe(false);
});
it('late connection after deadline is disposed before BEGIN; admission permit follows actual cleanup', async () => {
  vi.useFakeTimers();
  let connect!: (c: unknown) => void,
    discarded = false,
    calls = 0;
  const pool = {
      connect: () =>
        new Promise((r) => {
          connect = r;
        }),
    } as unknown as TransactionPool,
    a = new RetainedAdmission();
  const late = a
    .run((d) =>
      runtimeTransaction(pool, d, async () => {
        calls++;
      }),
    )
    .catch((e) => e);
  await vi.advanceTimersByTimeAsync(10001);
  expect(await late).toBeInstanceOf(Error);
  connect({
    query: async () => {
      calls++;
      return { rows: [], rowCount: null, command: 'BEGIN' };
    },
    release: (bad: boolean) => {
      discarded = bad;
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(discarded).toBe(true);
  expect(calls).toBe(0);
  expect(await a.run(async () => 1)).toBe(1);
});
