import { createHmac, randomBytes } from 'node:crypto';
import type { AcademicActor } from '../../domain/academic/model';
import { academicId, requireAcademic } from '../../domain/academic/model';
import { reminderCommand, type ReminderCommand } from '../../domain/reminder/model';
import type { AcademicContext, AcademicStore } from '../academic/service';
export interface ReminderTransaction {
  read(
    actor: AcademicActor,
    offering: string,
    caseId: string | null,
    after: string | null,
  ): Promise<{ rows: Record<string, unknown>[]; next: string | null }>;
  execute(
    actor: AcademicActor,
    offering: string,
    command: ReminderCommand,
    key: string,
  ): Promise<unknown>;
}
export class ReminderService {
  private readonly cursorKey = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = false,
  ) {}
  async read(context: AcademicContext, offering: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(offering);
    requireAcademic(Object.keys(input).every((k) => ['case', 'cursor'].includes(k)));
    const caseId = input.case === undefined ? null : academicId(input.case);
    const bind = JSON.stringify([context.tenantId, context.actorMembershipId, offering, caseId]);
    const mac = (id: string) =>
      createHmac('sha256', this.cursorKey).update(bind).update(id).digest('hex');
    let after: string | null = null;
    if (input.cursor !== undefined) {
      requireAcademic(/^[A-Za-z0-9_-]{1,512}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString('utf8'),
        [id, sig, ...rest] = raw.split(':');
      requireAcademic(
        !rest.length && sig === mac(id) && Buffer.from(raw).toString('base64url') === input.cursor,
      );
      after = academicId(id);
    }
    return this.store.run(context, null, async (actor, tx) => {
      requireAcademic(tx.reminder, 'UNAVAILABLE');
      const page = await tx.reminder.read(actor, offering, caseId, after);
      return {
        ...page,
        next: page.next
          ? Buffer.from(page.next + ':' + mac(page.next)).toString('base64url')
          : null,
      };
    });
  }
  execute(context: AcademicContext, offering: string, input: unknown, key: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(offering);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const command = reminderCommand(input);
    const work = (actor: AcademicActor, tx: import('../academic/service').AcademicTransaction) => {
      requireAcademic(tx.reminder, 'UNAVAILABLE');
      return tx.reminder.execute(actor, offering, command, key);
    };
    if (command.type === 'SEND_REMINDER') {
      requireAcademic(this.store.runForFollowupRecipient, 'UNAVAILABLE');
      return this.store.runForFollowupRecipient(context, offering, command.caseId, work);
    }
    return this.store.run(context, null, work);
  }
}
