import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import type { ReminderCommand } from '../../../domain/reminder/model';
import type { ReminderTransaction } from '../../../application/reminder/service';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
type Row = Record<string, unknown>;
export class ReminderPgTransaction implements ReminderTransaction {
  constructor(private readonly client: PoolClient) {}
  private async rows(sql: string, args: unknown[]) {
    return (await this.client.query<Row>(sql, args)).rows;
  }
  private async enrollment(actor: AcademicActor, offering: string, id: unknown, member: unknown) {
    const [e] = await this.rows(
      "SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4 AND status='ACTIVE' AND valid_from<=$5 AND valid_until IS NULL FOR SHARE",
      [actor.tenantId, offering, id, member, actor.now],
    );
    requireAcademic(e, 'FORBIDDEN');
  }
  async read(actor: AcademicActor, offering: string, caseId: string | null, after: string | null) {
    await new LearningPgTransaction(this.client).access(
      actor,
      offering,
      caseId ? 'TEACHER' : 'STUDENT',
    );
    if (caseId) {
      const [c] = await this.rows(
        'SELECT id FROM zhiban_followup.cases WHERE tenant_id=$1 AND offering_id=$2 AND id=$3',
        [actor.tenantId, offering, caseId],
      );
      requireAcademic(c, 'NOT_FOUND');
    }
    // Single snapshot. Student projection excludes case IDs, private notes/evidence and other recipients.
    const rows = await this.rows(
      `SELECT d.id,d.title,d.body,d.sent_at,a.confirmed_at,
    c.activity_id,c.activity_version,c.activity_title,
    coalesce(p.display_name,'任教教师') AS sender_name
    FROM zhiban_reminder.deliveries d
    JOIN zhiban_followup.cases c ON c.tenant_id=d.tenant_id AND c.id=d.case_id
    JOIN zhiban_academic.enrollments e ON e.tenant_id=d.tenant_id AND e.id=d.enrollment_id
    LEFT JOIN zhiban_reminder.confirmations a ON a.tenant_id=d.tenant_id AND a.delivery_id=d.id
    LEFT JOIN zhiban_academic.people p ON p.tenant_id=d.tenant_id AND p.membership_id=d.sent_by
    WHERE d.tenant_id=$1 AND d.offering_id=$2
    AND (($3::uuid IS NOT NULL AND d.case_id=$3) OR ($3::uuid IS NULL AND d.membership_id=$4 AND e.status='ACTIVE' AND e.valid_from<=$6 AND e.valid_until IS NULL))
    AND ($5::uuid IS NULL OR d.id<$5) ORDER BY d.id DESC LIMIT 21`,
      [actor.tenantId, offering, caseId, actor.membershipId, after, actor.now],
    );
    return { rows: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null };
  }
  async execute(actor: AcademicActor, offering: string, c: ReminderCommand, key: string) {
    const sending = c.type === 'SEND_REMINDER',
      t = actor.tenantId;
    await new LearningPgTransaction(this.client).access(
      actor,
      offering,
      sending ? 'TEACHER' : 'STUDENT',
    );
    const [record] = sending
      ? await this.rows(
          'SELECT id,revision::text,state,enrollment_id,membership_id FROM zhiban_followup.cases WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
          [t, offering, c.caseId],
        )
      : await this.rows(
          'SELECT d.*,c.state FROM zhiban_reminder.deliveries d JOIN zhiban_followup.cases c ON c.tenant_id=d.tenant_id AND c.id=d.case_id WHERE d.tenant_id=$1 AND d.offering_id=$2 AND d.id=$3 AND d.membership_id=$4 FOR SHARE OF c',
          [t, offering, c.id, actor.membershipId],
        );
    requireAcademic(record, 'NOT_FOUND');
    await this.enrollment(actor, offering, record.enrollment_id, record.membership_id);
    // Same command serializes even across cases; every replay is reauthorized above.
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `reminder-command:${t}:${key}`,
    ]);
    const digest = createHash('sha256')
      .update(JSON.stringify([offering, c]))
      .digest('hex');
    const [prior] = await this.rows(
      'SELECT actor_id,offering_id,payload_digest,result FROM zhiban_reminder.commands WHERE tenant_id=$1 AND command_key=$2',
      [t, key],
    );
    if (prior) {
      requireAcademic(
        prior.actor_id === actor.membershipId &&
          prior.offering_id === offering &&
          prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result;
    }
    const caseId = sending ? record.id : record.case_id;
    // One outstanding delivery per case. Also serializes ACK with a subsequent new send.
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `reminder-case:${t}:${caseId}`,
    ]);
    let result: Row;
    if (c.type === 'SEND_REMINDER') {
      requireAcademic(record.state === 'OPEN' && record.revision === c.revision, 'CONFLICT');
      const [pending] = await this.rows(
        'SELECT d.id FROM zhiban_reminder.deliveries d WHERE d.tenant_id=$1 AND d.case_id=$2 AND NOT EXISTS(SELECT 1 FROM zhiban_reminder.confirmations a WHERE a.tenant_id=d.tenant_id AND a.delivery_id=d.id) LIMIT 1',
        [t, caseId],
      );
      requireAcademic(!pending, 'CONFLICT');
      const [seq] = await this.rows(
        'SELECT coalesce(max(sequence),0)+1 AS n FROM zhiban_reminder.deliveries WHERE tenant_id=$1 AND case_id=$2',
        [t, caseId],
      );
      const id = v7();
      await this.client.query(
        'INSERT INTO zhiban_reminder.deliveries VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          t,
          offering,
          id,
          caseId,
          record.enrollment_id,
          record.membership_id,
          seq.n,
          c.title,
          c.body,
          actor.membershipId,
          actor.now,
        ],
      );
      result = { id, status: 'DELIVERED_IN_APP', sentAt: actor.now };
    } else {
      await this.client.query(
        'INSERT INTO zhiban_reminder.confirmations VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,delivery_id) DO NOTHING',
        [t, c.id, actor.membershipId, actor.now],
      );
      const [ack] = await this.rows(
        'SELECT confirmed_at FROM zhiban_reminder.confirmations WHERE tenant_id=$1 AND delivery_id=$2',
        [t, c.id],
      );
      result = { id: c.id, status: 'CONFIRMED', confirmedAt: Number(ack.confirmed_at) };
    }
    await this.client.query('INSERT INTO zhiban_reminder.commands VALUES($1,$2,$3,$4,$5,$6,$7)', [
      t,
      key,
      actor.membershipId,
      offering,
      digest,
      JSON.stringify(result),
      actor.now,
    ]);
    return result;
  }
}
