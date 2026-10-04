import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RecoveryOutcomeView } from '@/lib/zhiban/application/identity/ports/manual-recovery';
import type { PasswordHashingPort } from '@/lib/zhiban/application/identity/ports/password-hashing';
import type { TransactionPool } from '../postgres/transactions';
import { controlTransaction } from '../postgres/transactions';
import { IdentityIds } from '../composition/ids';
import { now, changed, type Client } from '../composition/support';
import { oneRow } from '../postgres/repositories/repository-support';
import {
  credentialColumns,
  slotColumns,
  validateAggregate,
  type SlotRow,
  type CredentialRow,
} from '../postgres/repositories/credential-records';
import { verifierMaterial } from '../credentials/verifier-material';
import { RecoveryEvidence, registrationFields, type Evidence } from './evidence';
import { RecoveryRegistry } from './registry';
import { RecoverySecurity, type RecoveryProof } from './security';
import { policy, policyDigest, type RecoveryPolicy } from './policy';
import {
  caseRecord,
  caseColumns,
  registrationColumns,
  ticketColumns,
  ticketRecord,
  type CaseRecord,
} from './records';
import { randomLocator, ticketDigest, sameSecret } from './material';
import {
  must,
  reference,
  uuid,
  revision,
  time,
  increment,
  safeError,
  RecoveryError,
} from './values';
type Proof = ReturnType<RecoverySecurity['take']>;
type RecoveryTable = 'cases' | 'tickets' | 'events' | 'outcomes' | 'notifications';
/** Fixed recovery-only INSERT; neither SQL nor clients escape this module. */
async function insert(
  client: Client,
  table: RecoveryTable,
  columns: readonly string[],
  values: unknown[],
) {
  changed(
    await client.query(
      `INSERT INTO zhiban_identity.identity_recovery_${table} (${columns.join(',')}) VALUES(${columns.map((_, i) => '$' + (i + 1)).join(',')})`,
      values,
    ),
    'INSERT',
  );
}
export function recoveryIntent(
  operation: string,
  caseId: string,
  expected: string | null,
  referenceValue: string | null,
) {
  return JSON.stringify(['manual-recovery-intent-v1', operation, caseId, expected, referenceValue]);
}
function view(c: CaseRecord) {
  return Object.freeze({ caseId: c.case_id, revision: c.repository_revision, state: c.state });
}
export class ManualRecovery {
  readonly policy: RecoveryPolicy;
  readonly policyDigest: string;
  #active = 0;
  #hmac: Buffer;
  constructor(
    private readonly pool: TransactionPool,
    private readonly evidence: RecoveryEvidence,
    private readonly hashing: PasswordHashingPort,
    readonly security: RecoverySecurity,
    readonly registry: RecoveryRegistry,
    config: RecoveryPolicy,
    hmac: Uint8Array,
    private readonly ids = new IdentityIds(),
  ) {
    this.policy = policy(config);
    this.policyDigest = policyDigest(config);
    must(hmac.length >= 32);
    this.#hmac = Buffer.from(hmac);
  }
  async bounded<T>(work: () => Promise<T>) {
    if (this.#active >= this.policy.max_process_requests)
      throw new RecoveryError('RECOVERY_UNAVAILABLE');
    this.#active++;
    try {
      await this.evidence.synchronized();
      return await work();
    } catch (e) {
      throw safeError(e);
    } finally {
      this.#active--;
    }
  }
  private tx<T>(work: (client: Client) => Promise<T>) {
    let committing = false,
      commitTag: string | undefined;
    const observed: TransactionPool = {
      connect: async () => {
        const client = await this.pool.connect();
        return {
          release: (destroy?: boolean) => client.release(destroy),
          query: (async (sql: string, params?: unknown[]) => {
            if (sql === 'COMMIT') committing = true;
            const result = await client.query(sql, params);
            if (sql === 'COMMIT') commitTag = result.command;
            return result;
          }) as PoolClient['query'],
        };
      },
    };
    return controlTransaction(observed, async (client) => {
      await client.query(
        "SELECT set_config('statement_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$1,true)",
        [this.policy.statement_timeout_ms.toString()],
      );
      return work(client);
    }).catch((error) => {
      if (committing && commitTag !== 'ROLLBACK') throw new RecoveryError('OUTCOME_UNKNOWN');
      throw safeError(error);
    });
  }
  private async gate(client: Client, live = true) {
    const r = oneRow(
      await client.query<{ policy_revision: string; enabled: boolean; checked_at: string }>(
        'SELECT * FROM zhiban_identity.identity_recovery_gate($1,$2)',
        [this.policy.environment_ref, this.policyDigest],
      ),
      'SELECT',
    );
    must(r !== null);
    revision(r.policy_revision);
    time(r.checked_at);
    if (live) must(r.enabled === true);
    return time(r.checked_at);
  }
  async reserve(
    phase: 'REGISTER' | 'ISSUE' | 'SUBMIT' | 'COMPLETE' | 'READ' | 'ACK',
    site: string,
    subject = 'unknown',
  ) {
    reference(site);
    const keys = ['GLOBAL', 'SITE', 'SUBJECT'].map((d, i) =>
      createHmac('sha256', this.#hmac)
        .update(
          JSON.stringify([
            'manual-recovery-admission-v1',
            this.policy.environment_ref,
            phase,
            d,
            i === 0 ? 'global' : i === 1 ? site : subject,
          ]),
        )
        .digest('hex'),
    );
    await this.tx(async (client) => {
      const r = oneRow(
        await client.query<{ identity_recovery_reserve: boolean }>(
          'SELECT zhiban_identity.identity_recovery_reserve($1,$2,$3,$4)',
          [this.policy.environment_ref, this.policyDigest, phase, keys],
        ),
        'SELECT',
      );
      must(r?.identity_recovery_reserve === true);
    });
  }
  /** Body admission is site/unknown first; then reserve the trusted subject BEFORE staff KDF.
   * A caller's case/approval locator is never itself used as a subject bucket identity.
   */
  async admitOperator(
    phase: 'REGISTER' | 'ISSUE' | 'COMPLETE' | 'READ' | 'ACK',
    site: string,
    locator: string,
  ) {
    if (phase === 'REGISTER') {
      const e = await this.evidence.load(locator, 'REGISTRATION');
      uuid(e.fields.subject_user_id);
      must(e.fields.site_ref === site && e.fields.approval_ref === locator);
      await this.reserve(phase, site, e.fields.subject_user_id);
    } else {
      const c = await this.hint(locator);
      must(c.environment_ref === this.policy.environment_ref && c.site_ref === site);
      await this.reserve(phase, site, c.subject_user_id);
    }
  }
  private async load(client: Client, id: string, lock = ''): Promise<CaseRecord> {
    uuid(id);
    const r = oneRow(
      await client.query(
        `SELECT ${caseColumns.join(',')} FROM zhiban_identity.identity_recovery_cases WHERE case_id=$1 ${lock}`,
        [id],
      ),
      'SELECT',
      true,
    );
    must(r !== null);
    return caseRecord(r);
  }
  private async sources(client: Client, c: CaseRecord, at: number) {
    const ids = [c.enrollment_source_id, c.appointment_source_id, c.contact_source_id].sort();
    const rows = await client.query(
      'SELECT source_id,environment_ref,source_kind,bound_user_id,repository_revision,state,valid_until,attested_at,key_ref FROM zhiban_identity.identity_recovery_sources WHERE source_id=ANY($1::uuid[]) ORDER BY source_id FOR SHARE NOWAIT',
      [ids],
    );
    must(rows.command === 'SELECT' && rows.rows.length === 3 && rows.rowCount === 3);
    for (const r of rows.rows) {
      const k =
        r.source_id === c.enrollment_source_id
          ? 'enrollment'
          : r.source_id === c.appointment_source_id
            ? 'appointment'
            : 'contact';
      must(
        r.environment_ref === c.environment_ref &&
          r.source_kind === k.toUpperCase() &&
          r.bound_user_id === (k === 'appointment' ? c.verifier_user_id : c.subject_user_id) &&
          r.repository_revision === c['expected_' + k + '_source_revision'] &&
          r.state === 'CURRENT' &&
          at >= time(r.attested_at) &&
          at < time(r.valid_until),
      );
      reference(r.key_ref);
      must(at < this.evidence.keyDeadline(r.key_ref));
    }
    return rows.rows;
  }
  private async ticket(client: Client, c: CaseRecord) {
    const r = oneRow(
      await client.query(
        `SELECT ${ticketColumns.join(',')} FROM zhiban_identity.identity_recovery_tickets WHERE case_id=$1 AND ticket_generation=$2 FOR UPDATE NOWAIT`,
        [c.case_id, c.ticket_generation],
      ),
      'SELECT',
      true,
    );
    must(r !== null);
    return ticketRecord(r);
  }
  private async locked(
    client: Client,
    id: string,
    p: Proof,
    mode: 'LIVE' | 'OUTCOME' | 'CANCEL',
    expected?: string,
  ) {
    await this.gate(client, mode === 'LIVE');
    const hint = await this.load(client, id);
    must(hint.environment_ref === this.policy.environment_ref && hint.actor_user_id === p.user);
    const row = oneRow(
      await client.query<Record<string, string | null>>(
        'SELECT * FROM zhiban_identity.identity_recovery_actor_guard($1,$2,$3)',
        [id, p.digest, mode],
      ),
      'SELECT',
    );
    must(row !== null);
    const at = await now(client);
    this.security.check(p, row, at);
    if (mode === 'LIVE') await this.sources(client, hint, at);
    const c = await this.load(
      client,
      id,
      mode === 'OUTCOME' ? 'FOR SHARE NOWAIT' : 'FOR UPDATE NOWAIT',
    );
    if (expected !== undefined) {
      revision(expected);
      must(c.repository_revision === expected);
    }
    if (mode === 'LIVE') {
      must(['REGISTERED', 'VERIFIED', 'APPROVED', 'TICKET_ISSUED'].includes(c.state));
      must(
        at >= time(c.created_at) &&
          at < time(c.state === 'REGISTERED' ? c.registered_expires_at : c.expires_at),
      );
      // Load persisted verifier/history only inside Infrastructure and validate the whole aggregate.
      for (const user of [c.actor_user_id, c.subject_user_id]) {
        const slot = oneRow(
          await client.query<SlotRow>(
            `SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id=$1`,
            [user],
          ),
          'SELECT',
        );
        must(slot !== null);
        const history = await client.query<CredentialRow>(
          `SELECT ${credentialColumns} FROM zhiban_identity.credentials WHERE user_id=$1 ORDER BY generation`,
          [user],
        );
        validateAggregate(slot, history.rows);
      }
    }
    return { c, row, at };
  }
  private async finish(
    client: Client,
    p: Proof,
    row: Record<string, string | null>,
    c: CaseRecord,
    at: number,
    deadline?: number,
  ) {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const last = await now(client);
    must(last >= at);
    this.security.check(p, row, last);
    if (deadline !== undefined) must(last < deadline);
    this.security.fresh(p);
    // Locks keep versions stable; fresh wall time checks sources without network calls.
    if (c.state !== 'CANCELLED' && deadline !== undefined) await this.sources(client, c, last);
  }
  private async event(
    client: Client,
    c: CaseRecord,
    type: string,
    at: number,
    requestId: string,
    ticketId: string | null = null,
    receipt: string | null = null,
  ) {
    reference(requestId);
    await insert(
      client,
      'events',
      [
        'case_id',
        'case_revision',
        'event_id',
        'event_type',
        'occurred_at',
        'actor_user_id',
        'request_id',
        'ticket_id',
        'receipt_ref',
      ],
      [
        c.case_id,
        c.repository_revision,
        this.ids.nextCommandId(),
        type,
        at.toString(),
        c.actor_user_id,
        requestId,
        ticketId,
        receipt,
      ],
    );
  }
  private async updateCase(
    client: Client,
    c: CaseRecord,
    fields: Record<string, string | null>,
    type: string,
    at: number,
    requestId: string,
    ticket: string | null = null,
    receipt: string | null = null,
  ) {
    const rev = increment(c.repository_revision),
      keys = Object.keys(fields);
    changed(
      await client.query(
        `UPDATE zhiban_identity.identity_recovery_cases SET ${keys.map((k, i) => k + '=$' + (i + 1)).join(',')},repository_revision=$${keys.length + 1} WHERE case_id=$${keys.length + 2} AND repository_revision=$${keys.length + 3}`,
        [...Object.values(fields), rev, c.case_id, c.repository_revision],
      ),
      'UPDATE',
    );
    const next = caseRecord({ ...c, ...fields, repository_revision: rev });
    await this.event(client, next, type, at, requestId, ticket, receipt);
    return next;
  }
  private matchReceipt(f: Evidence, c: CaseRecord, receiptRef: string) {
    const earliest =
      f.kind === 'APPROVAL'
        ? c.verified_at
        : f.kind === 'HANDOVER'
          ? c.approved_at
          : f.kind === 'NOTICE' && f.notice_kind === 'COMPLETED'
            ? c.completed_at
            : c.created_at;
    must(
      f.case_id === c.case_id &&
        f.registration_manifest_digest === c.registration_manifest_digest &&
        f.verifier_user_id === c.verifier_user_id &&
        f.appointment_source_id === c.appointment_source_id &&
        f.expected_appointment_source_revision === c.expected_appointment_source_revision &&
        f.receipt_ref === receiptRef &&
        earliest !== null &&
        time(f.issued_at) >= time(earliest),
    );
  }
  private async receipt(
    ref: string,
    kind: 'VERIFICATION' | 'APPROVAL' | 'HANDOVER' | 'NOTICE',
    c: CaseRecord,
  ) {
    const src = await this.tx(async (client) =>
      oneRow(
        await client.query<{ key_ref: string }>(
          'SELECT key_ref FROM zhiban_identity.identity_recovery_sources WHERE source_id=$1',
          [c.appointment_source_id],
        ),
        'SELECT',
      ),
    );
    must(src !== null);
    return this.evidence.load(ref, kind, src.key_ref);
  }
  private async hint(id: string) {
    return this.tx((client) => this.load(client, id));
  }
  private async liveEvidence(c: CaseRecord) {
    const registration = await this.evidence.load(
      c.approval_ref,
      'REGISTRATION',
      c.registration_key_ref,
    );
    must(
      registration.digest === c.registration_manifest_digest &&
        registration.fields.case_id === c.case_id,
    );
    let deadline = registration.deadline;
    if (c.approval_manifest_digest !== null) {
      const approval = await this.receipt(c.pre_notice_receipt_ref!, 'APPROVAL', c);
      must(
        approval.digest === c.approval_manifest_digest && approval.keyRef === c.approval_key_ref,
      );
      deadline = Math.min(deadline, approval.deadline);
    }
    return deadline;
  }
  private async subjectActor(client: Client, c: CaseRecord) {
    const session = oneRow(
      await client.query<{ token_digest: string }>(
        `SELECT token_digest FROM zhiban_identity.sessions WHERE user_id=$1 AND revoked_at IS NULL
 AND user_revision=$2 AND security_epoch=$3
 AND last_seen_at<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint
 AND absolute_expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
 AND idle_expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
 ORDER BY session_id LIMIT 1`,
        [c.actor_user_id, c.expected_actor_user_revision, c.expected_actor_security_epoch],
      ),
      'SELECT',
      true,
    );
    must(session !== null);
    const guard = oneRow(
      await client.query('SELECT * FROM zhiban_identity.identity_recovery_actor_guard($1,$2,$3)', [
        c.case_id,
        session.token_digest,
        'LIVE',
      ]),
      'SELECT',
    );
    must(guard !== null);
  }
  async register(
    proof: RecoveryProof,
    input: {
      enrollmentRef: string;
      appointmentRef: string;
      contactRef: string;
      approvalRef: string;
    },
    site: string,
    requestId: string,
  ) {
    const intent = recoveryIntent('register', input.approvalRef, null, null),
      p = this.security.take(proof, intent);
    const manifests = await Promise.all(
      ['SOURCE_ENROLLMENT', 'SOURCE_APPOINTMENT', 'SOURCE_CONTACT'].map((kind, i) =>
        this.evidence.load(
          [input.enrollmentRef, input.appointmentRef, input.contactRef][i],
          kind as 'SOURCE_ENROLLMENT',
        ),
      ),
    );
    const m = await this.evidence.load(input.approvalRef, 'REGISTRATION', manifests[0].keyRef),
      f = m.fields;
    const id = f.case_id;
    uuid(id);
    must(f.actor_user_id === p.user && f.site_ref === site && f.approval_ref === input.approvalRef);
    return this.tx(async (client) => {
      const at = await this.gate(client);
      must(at < m.deadline && manifests.every((e) => at < e.deadline));
      const sourceIds = manifests.map((x) => x.fields.source_id);
      for (const s of sourceIds) uuid(s);
      const users = await client.query(
        'SELECT * FROM zhiban_identity.identity_recovery_user_locks($1,$2,$3)',
        [id, p.digest, sourceIds],
      );
      must(users.rows.length === 3);
      for (const [k, person] of [
        ['subject', f.subject_user_id],
        ['verifier', f.verifier_user_id],
        ['actor', f.actor_user_id],
      ]) {
        const row = users.rows.find((r) => r.user_id === person);
        must(row !== undefined && row.user_revision === f['expected_' + k + '_user_revision']);
      }
      const data: Record<string, string | null> = { environment_ref: this.policy.environment_ref };
      for (const k of registrationFields) data[k] = f[k];
      data.registration_manifest_digest = m.digest;
      data.registration_key_ref = m.keyRef;
      // Manifest fields explicitly bind their source IDs; no substituted enrollment/contact.
      must(
        sourceIds[0] === f.enrollment_source_id &&
          sourceIds[1] === f.appointment_source_id &&
          sourceIds[2] === f.contact_source_id,
      );
      data.state = 'REGISTERED';
      data.repository_revision = '1';
      data.ticket_generation = '0';
      data.created_at = at.toString();
      data.registered_expires_at = (at + this.policy.registered_ttl_ms).toString();
      await insert(
        client,
        'cases',
        registrationColumns,
        registrationColumns.map((k) => data[k]),
      );
      let c = await this.load(client, id);
      await this.event(client, c, 'REGISTERED', at, requestId);
      for (let i = 0; i < 3; i++) {
        const s = oneRow(
          await client.query(
            'SELECT manifest_digest,key_ref,issuer_ref FROM zhiban_identity.identity_recovery_sources WHERE source_id=$1',
            [sourceIds[i]],
          ),
          'SELECT',
        );
        must(
          s !== null &&
            s.manifest_digest === manifests[i].digest &&
            s.key_ref === manifests[i].keyRef &&
            s.issuer_ref === manifests[i].fields.issuer_ref,
        );
      }
      const checked = await this.locked(client, id, p, 'LIVE', '1');
      c = checked.c;
      await this.finish(
        client,
        p,
        checked.row,
        c,
        at,
        Math.min(time(c.registered_expires_at), m.deadline, ...manifests.map((e) => e.deadline)),
      );
      return view(c);
    });
  }
  async advance(
    operation: 'verify' | 'approve',
    proof: RecoveryProof,
    id: string,
    expected: string,
    receiptRef: string,
    requestId: string,
  ) {
    const p = this.security.take(proof, recoveryIntent(operation, id, expected, receiptRef)),
      hint = await this.hint(id);
    const existingDeadline = await this.liveEvidence(hint);
    const evidence = await this.receipt(
      receiptRef,
      operation === 'verify' ? 'VERIFICATION' : 'APPROVAL',
      hint,
    );
    return this.tx(async (client) => {
      const { c, row, at } = await this.locked(client, id, p, 'LIVE', expected);
      must(at < evidence.deadline);
      this.matchReceipt(evidence.fields, c, receiptRef);
      let next: CaseRecord;
      if (operation === 'verify') {
        must(c.state === 'REGISTERED');
        next = await this.updateCase(
          client,
          c,
          { state: 'VERIFIED', verified_at: at.toString(), expires_at: (at + 1800000).toString() },
          'VERIFIED',
          at,
          requestId,
          null,
          receiptRef,
        );
      } else {
        must(
          c.state === 'VERIFIED' &&
            evidence.fields.verified_at === c.verified_at &&
            evidence.fields.expires_at === c.expires_at &&
            evidence.fields.pre_notice_receipt_ref === receiptRef &&
            evidence.deadline >= time(c.expires_at),
        );
        must(
          evidence.fields.route_source_id === c.contact_source_id &&
            evidence.fields.route_source_revision === c.expected_contact_source_revision &&
            evidence.fields.notice_kind === 'PRE_RESET',
        );
        await insert(
          client,
          'notifications',
          [
            'case_id',
            'notice_kind',
            'route_source_id',
            'route_source_revision',
            'verifier_user_id',
            'state',
            'created_at',
            'due_at',
            'acknowledged_at',
            'receipt_ref',
            'repository_revision',
          ],
          [
            id,
            'PRE_RESET',
            c.contact_source_id,
            c.expected_contact_source_revision,
            c.verifier_user_id,
            'ACKNOWLEDGED',
            at.toString(),
            (at + this.policy.max_notification_age_ms).toString(),
            at.toString(),
            receiptRef,
            '1',
          ],
        );
        next = await this.updateCase(
          client,
          c,
          {
            state: 'APPROVED',
            approved_at: at.toString(),
            approval_manifest_digest: evidence.digest,
            approval_key_ref: evidence.keyRef,
            pre_notice_receipt_ref: receiptRef,
          },
          'APPROVED',
          at,
          requestId,
          null,
          receiptRef,
        );
      }
      await this.finish(
        client,
        p,
        row,
        next,
        at,
        Math.min(time(next.expires_at), evidence.deadline, existingDeadline),
      );
      return view(next);
    });
  }
  async pair(
    proof: RecoveryProof,
    id: string,
    expected: string,
    site: string,
    operatorTerminal: string,
    subjectTerminal: string,
  ) {
    const p = this.security.take(proof, recoveryIntent('pair', id, expected, null));
    const evidenceDeadline = await this.liveEvidence(await this.hint(id));
    const binding = await this.tx(async (client) => {
      const { c, row, at } = await this.locked(client, id, p, 'LIVE', expected);
      must(
        ['APPROVED', 'TICKET_ISSUED'].includes(c.state) &&
          c.site_ref === site &&
          operatorTerminal !== subjectTerminal,
      );
      await this.finish(client, p, row, c, at, Math.min(time(c.expires_at), evidenceDeadline));
      return {
        caseId: id,
        actor: c.actor_user_id,
        subject: c.subject_user_id,
        site,
        operatorTerminal,
        subjectTerminal,
        caseRevision: c.repository_revision,
        deadline: time(c.expires_at),
      };
    });
    return { caseId: id, pairingCode: this.registry.pair(binding) };
  }
  async issue(
    proof: RecoveryProof,
    id: string,
    expected: string,
    receiptRef: string,
    operatorTerminal: string,
    requestId: string,
  ) {
    const p = this.security.take(proof, recoveryIntent('issue', id, expected, receiptRef)),
      hint = await this.hint(id);
    const evidenceDeadline = await this.liveEvidence(hint);
    const evidence = await this.receipt(receiptRef, 'HANDOVER', hint);
    const cookie = this.registry.findForIssue(id, operatorTerminal),
      raw = randomLocator('mrec1_'),
      ticketId = this.ids.nextCommandId();
    const result = await this.tx(async (client) => {
      const { c, row, at } = await this.locked(client, id, p, 'LIVE', expected);
      must(['APPROVED', 'TICKET_ISSUED'].includes(c.state));
      must(at < evidence.deadline);
      this.matchReceipt(evidence.fields, c, receiptRef);
      const generation = increment(c.ticket_generation === '0' ? '1' : c.ticket_generation);
      const actual = c.ticket_generation === '0' ? '1' : generation;
      must(evidence.fields.ticket_generation === actual);
      const deadline = Math.min(at + 600000, time(c.expires_at)),
        d = ticketDigest(raw, {
          environment: c.environment_ref,
          site: c.site_ref,
          caseId: id,
          generation: actual,
        });
      must(d !== null);
      if (c.state === 'TICKET_ISSUED') {
        const old = await this.ticket(client, c);
        must(old.state === 'ACTIVE');
        changed(
          await client.query(
            "UPDATE zhiban_identity.identity_recovery_tickets SET state='CANCELLED',terminal_at=$1,repository_revision=$2 WHERE ticket_id=$3 AND repository_revision=$4",
            [
              at.toString(),
              increment(old.repository_revision),
              old.ticket_id,
              old.repository_revision,
            ],
          ),
          'UPDATE',
        );
      }
      await insert(
        client,
        'tickets',
        [
          'ticket_id',
          'case_id',
          'ticket_generation',
          'ticket_digest',
          'state',
          'attempts',
          'created_at',
          'expires_at',
          'repository_revision',
        ],
        [ticketId, id, actual, d, 'ACTIVE', '0', at.toString(), deadline.toString(), '1'],
      );
      const next = await this.updateCase(
        client,
        c,
        { state: 'TICKET_ISSUED', ticket_generation: actual, delivery_receipt_ref: receiptRef },
        c.state === 'APPROVED' ? 'TICKET_ISSUED' : 'TICKET_REISSUED',
        at,
        requestId,
        ticketId,
        receiptRef,
      );
      await this.finish(
        client,
        p,
        row,
        next,
        at,
        Math.min(deadline, evidence.deadline, evidenceDeadline),
      );
      return { c: next, d, deadline };
    });
    // A lost delivery never replays the secret: invalidate and require explicit CANCEL/reissue.
    try {
      this.registry.deliver(
        cookie,
        { raw, generation: result.c.ticket_generation, id: ticketId, digest: result.d },
        result.c.repository_revision,
      );
    } catch {
      this.registry.invalidate(id);
      throw new RecoveryError('OUTCOME_UNKNOWN');
    }
    return { ...view(result.c), generation: result.c.ticket_generation };
  }
  async subjectTicket(cookie: string, csrf: unknown, site: string, terminal: string) {
    const ceremony = this.registry.ceremony(cookie, csrf, site, terminal);
    const evidenceDeadline = await this.liveEvidence(await this.hint(ceremony.caseId));
    await this.tx(async (client) => {
      await this.gate(client);
      const hint = await this.load(client, ceremony.caseId);
      await this.subjectActor(client, hint);
      const at = await now(client);
      await this.sources(client, hint, at);
      const c = await this.load(client, ceremony.caseId, 'FOR SHARE NOWAIT');
      must(
        c.state === 'TICKET_ISSUED' &&
          c.repository_revision === ceremony.caseRevision &&
          c.site_ref === site,
      );
      const t = await this.ticket(client, c);
      must(
        t.state === 'ACTIVE' &&
          at < time(t.expires_at) &&
          at < time(c.expires_at) &&
          at < evidenceDeadline,
      );
    });
    return this.registry.takeTicket(cookie);
  }
  async submit(
    cookie: string,
    csrf: unknown,
    site: string,
    terminal: string,
    raw: unknown,
    password: string,
  ) {
    const ceremony = this.registry.ceremony(cookie, csrf, site, terminal),
      id = ceremony.caseId;
    const evidenceDeadline = await this.liveEvidence(await this.hint(id));
    await this.reserve('SUBMIT', site, ceremony.subject);
    const validate = async (client: Client, reserveAttempt: boolean) => {
      await this.gate(client);
      const hint = await this.load(client, id);
      if (!reserveAttempt) {
        await this.subjectActor(client, hint);
      }
      const at = await now(client);
      await this.sources(client, hint, at);
      const c = await this.load(client, id, 'FOR SHARE NOWAIT');
      must(
        c.state === 'TICKET_ISSUED' &&
          c.site_ref === site &&
          c.repository_revision === ceremony.caseRevision,
      );
      const t = await this.ticket(client, c);
      const d = ticketDigest(raw, {
        environment: c.environment_ref,
        site,
        caseId: id,
        generation: c.ticket_generation,
      });
      must(
        t.state === 'ACTIVE' &&
          at >= time(t.created_at) &&
          at < time(t.expires_at) &&
          at < time(c.expires_at) &&
          at < evidenceDeadline,
      );
      if (reserveAttempt) {
        must(BigInt(t.attempts) < BigInt(this.policy.max_attempts_per_ticket));
        changed(
          await client.query(
            'UPDATE zhiban_identity.identity_recovery_tickets SET attempts=attempts+1,repository_revision=$1 WHERE ticket_id=$2 AND repository_revision=$3',
            [increment(t.repository_revision), t.ticket_id, t.repository_revision],
          ),
          'UPDATE',
        );
      }
      return { c, t, d, at };
    };
    // Attempts must survive wrong-ticket/screening rejection, hence check digest AFTER reservation commits.
    const first = await this.tx((client) => validate(client, true));
    must(first.d !== null && sameSecret(first.d, first.t.ticket_digest));
    const verifier = await this.hashing.hash(password);
    await this.evidence.synchronized();
    const final = await this.tx(async (client) => {
      const r = await validate(client, false);
      must(r.d !== null && sameSecret(r.d, r.t.ticket_digest));
      // Strong User/slot/grant recheck precedes sources/case/ticket after KDF.
      return r;
    });
    this.registry.submit(
      cookie,
      {
        caseId: id,
        caseRevision: final.c.repository_revision,
        generation: final.c.ticket_generation,
        ticketId: final.t.ticket_id,
        ticketDigest: final.t.ticket_digest,
        approvalDigest: final.c.approval_manifest_digest!,
        deadline: Math.min(
          time(final.c.expires_at),
          time(final.t.expires_at),
          ceremony.deadline,
          evidenceDeadline,
        ),
        ceremony: cookie,
      },
      verifier,
    );
    return { status: 'READY' as const };
  }
  async ready(proof: RecoveryProof, id: string) {
    const p = this.security.take(proof, recoveryIntent('ready', id, null, null));
    return this.tx(async (client) => {
      const { c, row, at } = await this.locked(client, id, p, 'OUTCOME');
      await this.finish(client, p, row, c, at);
      return {
        state: c.state,
        caseRevision: c.repository_revision,
        ticketGeneration: c.ticket_generation,
        submissionRef: this.registry.ready(id),
      };
    });
  }
  async complete(
    proof: RecoveryProof,
    id: string,
    expected: string,
    submissionRef: string,
    requestId: string,
  ) {
    const p = this.security.take(proof, recoveryIntent('complete', id, expected, submissionRef)),
      s = this.registry.claim(submissionRef, id);
    try {
      const evidenceDeadline = await this.liveEvidence(await this.hint(id));
      const result = await this.tx(async (client) => {
        const { c, row, at } = await this.locked(client, id, p, 'LIVE', expected),
          t = await this.ticket(client, c);
        must(
          c.state === 'TICKET_ISSUED' &&
            s.caseRevision === c.repository_revision &&
            s.generation === c.ticket_generation &&
            s.ticketId === t.ticket_id &&
            s.ticketDigest === t.ticket_digest &&
            s.approvalDigest === c.approval_manifest_digest &&
            t.state === 'ACTIVE' &&
            at < s.deadline &&
            at < time(t.expires_at),
        );
        const newId = this.ids.nextCredentialId(),
          command = this.ids.nextCommandId(),
          r = increment(c.expected_slot_revision),
          e = increment(c.expected_security_epoch),
          g = increment(c.expected_generation);
        changed(
          await client.query(
            'UPDATE zhiban_identity.credential_slots SET active_credential_id=$1,generation=$2,repository_revision=$3,security_epoch=$4,updated_at=$5 WHERE user_id=$6 AND repository_revision=$7',
            [newId, g, r, e, at.toString(), c.subject_user_id, c.expected_slot_revision],
          ),
          'UPDATE',
        );
        if (c.expected_credential_id !== null)
          changed(
            await client.query(
              "UPDATE zhiban_identity.credentials SET status='REPLACED',verifier_material=NULL,slot_revision=$1,updated_at=$2,replaced_at=$2,replaced_by_credential_id=$3 WHERE user_id=$4 AND credential_id=$5 AND status='ACTIVE'",
              [r, at.toString(), newId, c.subject_user_id, c.expected_credential_id],
            ),
            'UPDATE',
          );
        else must(c.intent === 'REESTABLISH_REVOKED_PASSWORD' && c.security_clearance_ref !== null);
        changed(
          await client.query(
            "INSERT INTO zhiban_identity.credentials (credential_id,user_id,credential_type,generation,status,slot_revision,verifier_material,created_at,updated_at) VALUES($1,$2,'PASSWORD',$3,'ACTIVE',$4,$5,$6,$6)",
            [newId, c.subject_user_id, g, r, verifierMaterial(s.verifier), at.toString()],
          ),
          'INSERT',
        );
        changed(
          await client.query(
            "UPDATE zhiban_identity.identity_recovery_tickets SET state='CONSUMED',terminal_at=$1,repository_revision=$2 WHERE ticket_id=$3 AND repository_revision=$4 AND state='ACTIVE'",
            [at.toString(), increment(t.repository_revision), t.ticket_id, t.repository_revision],
          ),
          'UPDATE',
        );
        const next = await this.updateCase(
          client,
          c,
          { state: 'COMPLETED', completed_at: at.toString(), terminal_at: at.toString() },
          'COMPLETED',
          at,
          requestId,
          t.ticket_id,
        );
        const event = oneRow(
          await client.query<{ id: string }>(
            "SELECT nextval('zhiban_identity.audit_events_event_id_seq'::regclass)::text AS id",
          ),
          'SELECT',
        );
        must(event !== null);
        revision(event.id);
        const payload = {
          priorCredentialId: c.expected_credential_id,
          credentialId: newId,
          repositoryRevisionBefore: c.expected_slot_revision,
          repositoryRevisionAfter: r,
          securityEpochBefore: c.expected_security_epoch,
          securityEpochAfter: e,
        };
        changed(
          await client.query(
            `INSERT INTO zhiban_identity.audit_events(event_id,event_shape_version,event_type,event_scope,occurred_at,actor_type,actor_user_id,request_id,reason,subject_user_id,event_payload) OVERRIDING SYSTEM VALUE
 VALUES($1,1,'CREDENTIAL_REPLACED','GLOBAL',$2,'USER',$3,$4,'ACCOUNT_RECOVERY',$5,$6::jsonb)`,
            [
              event.id,
              at.toString(),
              c.actor_user_id,
              requestId,
              c.subject_user_id,
              JSON.stringify(payload),
            ],
          ),
          'INSERT',
        );
        await insert(
          client,
          'outcomes',
          [
            'case_id',
            'command_id',
            'ticket_id',
            'completed_case_revision',
            'ticket_generation',
            'actor_user_id',
            'subject_user_id',
            'prior_credential_id',
            'credential_id',
            'generation_before',
            'generation_after',
            'slot_revision_before',
            'slot_revision_after',
            'security_epoch_before',
            'security_epoch_after',
            'credential_event_id',
            'completed_at',
          ],
          [
            id,
            command,
            t.ticket_id,
            next.repository_revision,
            c.ticket_generation,
            c.actor_user_id,
            c.subject_user_id,
            c.expected_credential_id,
            newId,
            c.expected_generation,
            g,
            c.expected_slot_revision,
            r,
            c.expected_security_epoch,
            e,
            event.id,
            at.toString(),
          ],
        );
        await insert(
          client,
          'notifications',
          [
            'case_id',
            'notice_kind',
            'route_source_id',
            'route_source_revision',
            'verifier_user_id',
            'state',
            'created_at',
            'due_at',
            'repository_revision',
          ],
          [
            id,
            'COMPLETED',
            c.contact_source_id,
            c.expected_contact_source_revision,
            c.verifier_user_id,
            'PENDING',
            at.toString(),
            (at + this.policy.max_notification_age_ms).toString(),
            '1',
          ],
        );
        const slot = oneRow(
          await client.query<SlotRow>(
            `SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id=$1`,
            [c.subject_user_id],
          ),
          'SELECT',
        );
        must(slot !== null);
        const history = await client.query<CredentialRow>(
          `SELECT ${credentialColumns} FROM zhiban_identity.credentials WHERE user_id=$1 ORDER BY generation`,
          [c.subject_user_id],
        );
        validateAggregate(slot, history.rows);
        await this.finish(
          client,
          p,
          row,
          next,
          at,
          Math.min(s.deadline, time(t.expires_at), time(c.expires_at), evidenceDeadline),
        );
        return {
          status: 'COMPLETED' as const,
          caseId: id,
          commandRef: command,
          notification: 'PENDING' as const,
        };
      });
      this.registry.invalidate(id);
      return result;
    } catch (error) {
      this.registry.invalidate(id);
      throw safeError(error);
    }
  }
  async cancel(proof: RecoveryProof, id: string, expected: string, requestId: string) {
    const p = this.security.take(proof, recoveryIntent('cancel', id, expected, null));
    const result = await this.tx(async (client) => {
      const { c, row, at } = await this.locked(client, id, p, 'CANCEL', expected);
      must(!['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(c.state));
      await client.query(
        "UPDATE zhiban_identity.identity_recovery_tickets SET state='CANCELLED',terminal_at=$1,repository_revision=repository_revision+1 WHERE case_id=$2 AND state='ACTIVE'",
        [at.toString(), id],
      );
      const next = await this.updateCase(
        client,
        c,
        { state: 'CANCELLED', terminal_at: at.toString(), terminal_reason: 'USER_REQUEST' },
        'CANCELLED',
        at,
        requestId,
      );
      await this.finish(client, p, row, next, at);
      return view(next);
    });
    this.registry.invalidate(id);
    return result;
  }
  async outcome(proof: RecoveryProof, id: string): Promise<RecoveryOutcomeView> {
    const p = this.security.take(proof, recoveryIntent('outcome', id, null, null));
    return this.tx(async (client) => {
      const { c, row, at } = await this.locked(client, id, p, 'OUTCOME');
      const o = oneRow(
        await client.query<{ command_id: string; state: string }>(
          "SELECT o.command_id,n.state FROM zhiban_identity.identity_recovery_outcomes o JOIN zhiban_identity.identity_recovery_notifications n ON n.case_id=o.case_id AND n.notice_kind='COMPLETED' WHERE o.case_id=$1",
          [id],
        ),
        'SELECT',
        true,
      );
      await this.finish(client, p, row, c, at);
      must((c.state === 'COMPLETED') === (o !== null));
      if (o) {
        uuid(o.command_id);
        must(['PENDING', 'ACKNOWLEDGED'].includes(o.state));
      }
      return {
        ...view(c),
        status: o ? 'COMPLETED' : 'NOT_COMPLETED',
        commandRef: o?.command_id ?? null,
        notification: o ? (o.state as 'PENDING' | 'ACKNOWLEDGED') : null,
      };
    });
  }
  async ack(proof: RecoveryProof, id: string, kind: string, expected: string, receiptRef: string) {
    must(kind === 'COMPLETED' || kind === 'PRE_RESET');
    const p = this.security.take(
        proof,
        recoveryIntent('ack', id, expected, JSON.stringify([kind, receiptRef])),
      ),
      hint = await this.hint(id),
      e = await this.receipt(receiptRef, 'NOTICE', hint);
    this.matchReceipt(e.fields, hint, receiptRef);
    must(
      e.fields.notice_kind === kind &&
        e.fields.route_source_id === hint.contact_source_id &&
        e.fields.route_source_revision === hint.expected_contact_source_revision,
    );
    return this.tx(async (client) => {
      const { c, row, at } = await this.locked(client, id, p, 'OUTCOME');
      const n = oneRow(
        await client.query<{
          repository_revision: string;
          state: string;
          receipt_ref: string | null;
        }>(
          'SELECT repository_revision,state,receipt_ref FROM zhiban_identity.identity_recovery_notifications WHERE case_id=$1 AND notice_kind=$2 FOR UPDATE NOWAIT',
          [id, kind],
        ),
        'SELECT',
      );
      must(n !== null && n.repository_revision === expected && at < e.deadline);
      if (n.state === 'ACKNOWLEDGED') must(n.receipt_ref === receiptRef);
      else {
        must(n.state === 'PENDING');
        changed(
          await client.query(
            "UPDATE zhiban_identity.identity_recovery_notifications SET state='ACKNOWLEDGED',acknowledged_at=$1,receipt_ref=$2,repository_revision=$3 WHERE case_id=$4 AND notice_kind=$5 AND repository_revision=$6",
            [at.toString(), receiptRef, increment(n.repository_revision), id, kind, expected],
          ),
          'UPDATE',
        );
      }
      await this.finish(client, p, row, c, at);
      const last = await now(client);
      must(last >= at && last < e.deadline);
      return { status: 'ACKNOWLEDGED' };
    });
  }
}
