import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AcademicContext, AcademicStore } from '../academic/service';
import { academicId, requireAcademic, type AcademicActor } from '../../domain/academic/model';
import {
  discussionCommand,
  type DiscussionCommand,
  type TopicState,
} from '../../domain/discussion/model';
export type DiscussionQuery = {
  kind: 'topics' | 'posts' | 'events';
  topic: string | null;
  state: TopicState | 'ALL';
  limit: number;
  after: { time: string; id: string } | null;
};
export type DiscussionPage = {
  mode: string;
  writable: boolean;
  topic?: Record<string, unknown>;
  rows: Record<string, unknown>[];
  next: DiscussionQuery['after'];
};
export interface DiscussionTransaction {
  read(actor: AcademicActor, offering: string, query: DiscussionQuery): Promise<DiscussionPage>;
  execute(
    actor: AcademicActor,
    offering: string,
    command: DiscussionCommand,
    key: string,
  ): Promise<Record<string, unknown>>;
}
/** Restart invalidates cursors; the per-host key never comes from client input. */
export class DiscussionService {
  private readonly cursorKey = randomBytes(32);
  constructor(private readonly store: AcademicStore) {}
  read(
    context: AcademicContext,
    offering: string,
    kind: DiscussionQuery['kind'],
    topic: string | null,
    input: Record<string, string>,
  ) {
    academicId(offering);
    if (topic) academicId(topic);
    requireAcademic(
      ['topics', 'posts', 'events'].includes(kind) &&
        (kind === 'topics' ? topic === null : topic !== null),
    );
    requireAcademic(
      Object.keys(input).every((k) =>
        ['limit', 'cursor', ...(kind === 'topics' ? ['state'] : [])].includes(k),
      ),
    );
    requireAcademic(['10', '20', '50'].includes(input.limit ?? '20'));
    const state = input.state ?? 'ALL';
    requireAcademic(['ALL', 'DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED'].includes(state));
    const q: DiscussionQuery = {
      kind,
      topic,
      state: state as DiscussionQuery['state'],
      limit: Number(input.limit ?? '20'),
      after: null,
    };
    const binding = JSON.stringify([context.tenantId, context.actorMembershipId, offering, q]);
    const mac = (value: string) =>
      createHmac('sha256', this.cursorKey).update(binding).update(value).digest('hex');
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString('utf8');
      requireAcademic(Buffer.from(raw).toString('base64url') === input.cursor);
      const [time, id, signature, ...rest] = raw.split(':');
      requireAcademic(
        !rest.length && /^[1-9][0-9]{0,14}$/.test(time) && /^[a-f0-9]{64}$/.test(signature),
      );
      academicId(id);
      requireAcademic(timingSafeEqual(Buffer.from(signature), Buffer.from(mac(`${time}:${id}`))));
      q.after = { time, id };
    }
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(!!tx.discussion, 'UNAVAILABLE');
      const page = await tx.discussion!.read(actor, offering, q);
      const next = page.next ? `${page.next.time}:${page.next.id}` : null;
      return {
        ...page,
        next: undefined,
        nextCursor: next ? Buffer.from(`${next}:${mac(next)}`).toString('base64url') : null,
      };
    });
  }
  command(context: AcademicContext, offering: string, input: unknown, key: string) {
    academicId(offering);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const command = discussionCommand(input);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(!!tx.discussion, 'UNAVAILABLE');
      return tx.discussion!.execute(actor, offering, command, key);
    });
  }
}
