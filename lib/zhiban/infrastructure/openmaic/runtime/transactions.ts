import type { TransactionPool } from '../../identity/postgres/transactions';
import type { BridgePgClient } from '../transactions';
import { RuntimeDeadline } from './admission';
import { RuntimeFailure, requireFact } from './validation';

export type NativeOutcome = 'NOT_DISPATCHED' | 'ROLLED_BACK' | 'COMMITTED' | 'UNKNOWN';
function discardClient(outcome: NativeOutcome, committed: boolean) {
  return outcome === 'UNKNOWN' || (!committed && outcome !== 'ROLLED_BACK');
}
/** Infrastructure only. No raw driver cause/code/message survives. */
export class NativeFailure extends RuntimeFailure {
  constructor(readonly outcome: NativeOutcome) {
    super(outcome === 'UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'STORAGE_FAILURE');
  }
}
export async function runtimeTransaction<T>(
  pool: TransactionPool,
  deadline: RuntimeDeadline,
  work: (client: BridgePgClient) => Promise<T>,
  finalCheck: () => Promise<void> = async () => {},
  tenant?: string,
): Promise<T> {
  let client: Awaited<ReturnType<TransactionPool['connect']>> | undefined;
  let begun = false,
    commitSent = false,
    committed = false,
    active = false;
  let outcome: NativeOutcome = 'NOT_DISPATCHED';
  try {
    deadline.assert();
    // The caller is raced by admission. This promise follows late connection cleanup.
    client = await pool.connect();
    deadline.assert();
    requireFact((await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')).command === 'BEGIN');
    begun = true;
    active = true;
    for (const sql of [
      "SET LOCAL lock_timeout='1000ms'",
      "SET LOCAL statement_timeout='5000ms'",
      "SET LOCAL idle_in_transaction_session_timeout='10000ms'",
    ])
      await client.query(sql);
    if (tenant) await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    const raw = client;
    const guarded: BridgePgClient = {
      query: async <R extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
        requireFact(active);
        const remaining = deadline.remaining();
        await raw.query(
          "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",
          [`${Math.min(5000, remaining)}ms`, `${Math.min(1000, remaining)}ms`],
        );
        requireFact(active);
        deadline.assert();
        const result = await raw.query<R>(sql, parameters);
        deadline.assert();
        return result;
      },
      release: () => {
        throw new RuntimeFailure();
      },
    };
    const result = await work(guarded);
    await finalCheck();
    deadline.assert();
    commitSent = true;
    requireFact((await raw.query('COMMIT')).command === 'COMMIT');
    committed = true;
    outcome = 'COMMITTED';
    // A late acknowledged commit is still an unknown result to the caller.
    deadline.assert();
    return result;
  } catch (error) {
    if (commitSent) outcome = 'UNKNOWN';
    else if (begun && client) {
      try {
        outcome =
          (await client.query('ROLLBACK')).command === 'ROLLBACK' ? 'ROLLED_BACK' : 'UNKNOWN';
      } catch {
        outcome = 'UNKNOWN';
      }
    }
    if (!commitSent && outcome === 'ROLLED_BACK' && error instanceof RuntimeFailure) {
      // Reconstruct even our own tagged errors; never retain attached driver/custom metadata.
      if (error instanceof NativeFailure)
        throw new NativeFailure(
          ['NOT_DISPATCHED', 'ROLLED_BACK', 'COMMITTED', 'UNKNOWN'].includes(error.outcome)
            ? error.outcome
            : 'UNKNOWN',
        );
      throw new RuntimeFailure(error.reason);
    }
    throw new NativeFailure(outcome);
  } finally {
    active = false;
    if (client) {
      try {
        client.release(discardClient(outcome, committed));
      } catch {
        throw new NativeFailure('UNKNOWN');
      }
    }
  }
}
