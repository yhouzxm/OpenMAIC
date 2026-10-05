import type { TransactionPool } from '../identity/postgres/transactions';
import type { TenantContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import type { BridgePgClient } from './transactions';
import { admittedOperation, bridgeTransaction, type Deadline } from './transactions';
import { BridgeRepository, type Actor, type Reservation } from './repository';
import { check, BridgeError, storedInstant, revision } from './validation';
import type { NativeStorage } from './native-storage';
import { validateDocument, type AssetPurpose } from './content';

/** Server-composed guard must lock the complete approved identity/business set, never a DTO boolean. */
export type CurrentBridgeGuard = (client: BridgePgClient, deadline: Deadline) => Promise<void>;
/** Not exposed by the closed production root. Pure infrastructure composition for the future loader. */
export class GuardedBridgeProtocol {
  readonly #capabilities = new WeakSet<object>();
  constructor(
    private readonly pool: TransactionPool,
    private readonly context: TenantContext,
    private readonly guard: CurrentBridgeGuard,
  ) {}
  private async at(client: BridgePgClient) {
    const r = await client.query(
      'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS at',
    );
    check(r.rows.length === 1);
    return storedInstant(r.rows[0].at);
  }
  private tx<T>(deadline: Deadline, work: (repo: BridgeRepository) => Promise<T>) {
    return bridgeTransaction(this.pool, this.context, deadline, async (client) => {
      await this.guard(client, deadline);
      return work(new BridgeRepository(client, this.context.tenantId));
    });
  }
  async prepare<T>(
    plan: Reservation,
    actor: Actor,
    deadline: Deadline,
    external: (
      operationId: string,
      repo: BridgeRepository,
      finalCheck: () => Promise<void>,
    ) => Promise<T>,
    complete: (repo: BridgeRepository, operationId: string, result: T, at: number) => Promise<void>,
  ) {
    return admittedOperation(() => this.dispatch(plan, actor, deadline, external, complete));
  }
  /** A current interactive actor may inspect only the recorded StageRef; no write/replay/search. */
  async reconcilePrepared(
    operationId: string,
    actor: Actor,
    deadline: Deadline,
    native: Pick<NativeStorage, 'load'>,
  ) {
    return admittedOperation(() =>
      this.tx(deadline, async (repo) => {
        const op = await repo.loadOperation(operationId);
        check(
          op.operation === 'PREPARE_CONTENT' &&
            op.state === 'OUTCOME_UNKNOWN' &&
            op.dispatch_started_at !== null &&
            op.reserved_stage_ref !== null &&
            op.generation_id !== null,
        );
        check(
          op.actor_kind === 'USER' &&
            op.actor_user_id === actor.user &&
            op.actor_membership_id === actor.member &&
            op.expected_authorization_version === actor.authorizationVersion.toString(),
        );
        const slot = await repo.loadSlot(String(op.slot_id), 'UPDATE'),
          generation = await repo.loadGeneration(String(op.generation_id));
        check(
          slot.revision === op.reserved_slot_revision &&
            generation.state === 'PENDING' &&
            generation.stage_ref === op.reserved_stage_ref,
        );
        const { scenes, assets } = await repo.candidateBindings(String(op.generation_id));
        const refs = new Map(
          assets.map((a) => {
            const scene = scenes.find((s) => s.scene_binding_id === a.scene_binding_id)!;
            check(
              a.deployment_id === generation.deployment_id &&
                a.principal_handle === generation.owner_handle,
            );
            return [
              String(a.asset_ref),
              {
                byteDigest: String(a.byte_digest),
                sceneRef: String(scene.scene_ref),
                purpose: a.purpose as AssetPurpose,
              },
            ] as const;
          }),
        );
        const finalCheck = async () => {
          await this.guard(repo.client, deadline);
          deadline.assert();
        };
        const document = await native.load(
          String(generation.owner_handle),
          String(op.reserved_stage_ref),
          refs,
          deadline,
          finalCheck,
          String(generation.content_digest),
        );
        const checked = validateDocument(document, String(op.reserved_stage_ref), refs);
        check(
          checked.digest === generation.content_digest &&
            checked.scenes.length === scenes.length &&
            checked.scenes.every(
              (s, i) => s.ref === scenes[i].scene_ref && s.digest === scenes[i].scene_digest,
            ),
        );
        await finalCheck();
        await repo.finish(
          op,
          'SUCCEEDED',
          'NONE',
          'OUTCOME_RECONCILED',
          actor.requestId,
          await this.at(repo.client),
        );
        await finalCheck();
        return Object.freeze({ status: 'SUCCEEDED' as const, revision: slot.revision });
      }),
    );
  }
  private async dispatch<T>(
    plan: Reservation,
    actor: Actor,
    deadline: Deadline,
    external: (
      operationId: string,
      repo: BridgeRepository,
      finalCheck: () => Promise<void>,
    ) => Promise<T>,
    complete: (repo: BridgeRepository, operationId: string, result: T, at: number) => Promise<void>,
  ) {
    const reserved = await this.tx(deadline, async (repo) => {
      if (plan.operation === 'SUSPEND' || plan.operation === 'RETIRE') {
        const slot = await repo.loadSlot(plan.slotId, 'UPDATE');
        check(slot.revision === revision(plan.expectedRevision));
        if (
          (plan.operation === 'SUSPEND' && slot.state === 'SUSPENDED') ||
          (plan.operation === 'RETIRE' && slot.state === 'RETIRED')
        )
          return { kind: 'NOOP' as const, revision: slot.revision };
      }
      return {
        kind: 'RESERVED' as const,
        value: await repo.reserve(plan, actor, await this.at(repo.client)),
      };
    });
    if (reserved.kind === 'NOOP')
      return Object.freeze({ status: 'SUCCEEDED' as const, revision: reserved.revision });
    const reservation = reserved.value;
    if (!reservation.dispatched)
      return Object.freeze({
        status: 'SUCCEEDED' as const,
        revision: reservation.operation.result_slot_revision,
      });
    const operationId = String(reservation.operation.operation_id);
    // Capability is minted only after a checked mark COMMIT has resolved.
    await this.tx(deadline, async (repo) => {
      const slot = await repo.loadSlot(plan.slotId, 'UPDATE');
      check(slot.revision === reservation.operation.reserved_slot_revision);
      const op = await repo.loadOperation(operationId);
      await repo.markDispatch(op, await this.at(repo.client));
    });
    const capability = Object.freeze({});
    this.#capabilities.add(capability);
    try {
      return await this.tx(deadline, async (repo) => {
        const slot = await repo.loadSlot(plan.slotId, 'UPDATE'),
          op = await repo.loadOperation(operationId);
        check(
          slot.revision === op.reserved_slot_revision &&
            op.state === 'RESERVED' &&
            op.dispatch_started_at !== null &&
            this.#capabilities.has(capability),
        );
        this.#capabilities.delete(capability);
        deadline.assert();
        const finalCheck = async () => {
          await this.guard(repo.client, deadline);
          deadline.assert();
        };
        const result = await external(operationId, repo, finalCheck);
        await finalCheck();
        await complete(repo, operationId, result, await this.at(repo.client));
        await finalCheck();
        const finished = await repo.loadOperation(operationId);
        check(finished.state === 'SUCCEEDED');
        return Object.freeze({
          status: 'SUCCEEDED' as const,
          revision: finished.result_slot_revision,
        });
      });
    } catch {
      this.#capabilities.delete(capability);
      try {
        await this.tx(deadline, async (repo) => {
          await repo.loadSlot(plan.slotId, 'UPDATE');
          const op = await repo.loadOperation(operationId);
          if (op.state === 'RESERVED')
            await repo.finish(
              op,
              'OUTCOME_UNKNOWN',
              'UNKNOWN_OUTCOME',
              'OUTCOME_QUARANTINED',
              actor.requestId,
              await this.at(repo.client),
            );
        });
      } catch {
        /* Durable dispatched RESERVED remains denied when quarantine persistence fails. */
      }
      throw new BridgeError();
    }
  }
}
