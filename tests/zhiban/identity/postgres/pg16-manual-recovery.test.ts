import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { createHmac } from 'node:crypto';
import { instant } from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import {
  ManualRecovery,
  recoveryIntent,
} from '@/lib/zhiban/infrastructure/identity/recovery/composition';
import { RecoveryRegistry } from '@/lib/zhiban/infrastructure/identity/recovery/registry';
import { RecoverySecurity } from '@/lib/zhiban/infrastructure/identity/recovery/security';
import {
  randomLocator,
  ticketDigest,
} from '@/lib/zhiban/infrastructure/identity/recovery/material';
import { budgets, ids } from '../recovery/fixtures';
import { adminRows, recoveryFixture, password, replacement } from './manual-recovery-fixtures';
import {
  adminClient,
  configured,
  expectDenied,
  prepareSchema,
  resetDisposableIdentity,
  runtimeClient,
  runtimePool,
  verifyPg16,
} from './pg16-harness';
const pools = new Set<Pool>();
type F = Awaited<ReturnType<typeof recoveryFixture>>;
let f: F;
const resultState = async () => ({
  slots: await adminRows(
    'SELECT user_id,generation,repository_revision,security_epoch,active_credential_id FROM zhiban_identity.credential_slots WHERE user_id=$1',
    [f.subject],
  ),
  cases: await adminRows(
    'SELECT state,repository_revision,ticket_generation FROM zhiban_identity.identity_recovery_cases WHERE case_id=$1',
    [f.caseId],
  ),
  tickets: await adminRows(
    'SELECT state,repository_revision,attempts FROM zhiban_identity.identity_recovery_tickets WHERE case_id=$1 ORDER BY ticket_generation',
    [f.caseId],
  ),
  outcomes: await adminRows(
    'SELECT * FROM zhiban_identity.identity_recovery_outcomes WHERE case_id=$1',
    [f.caseId],
  ),
  notices: await adminRows(
    'SELECT notice_kind,state,repository_revision FROM zhiban_identity.identity_recovery_notifications WHERE case_id=$1 ORDER BY notice_kind',
    [f.caseId],
  ),
});
const completed = async () => {
  const r = await f.ready();
  return f.service.complete(
    await f.proof('complete', '4', r.submission),
    f.caseId,
    '4',
    r.submission,
    'complete',
  );
};
function pausePool(pool: Pool, prefix: string) {
  let acknowledge!: () => void, resume!: () => void;
  const reached = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const permit = new Promise<void>((resolve) => {
    resume = resolve;
  });
  return {
    reached,
    resume,
    wrapped: {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (async (sql: string, parameters?: unknown[]) => {
            const result = await client.query(sql, parameters);
            if (sql.startsWith(prefix)) {
              acknowledge();
              await permit;
            }
            return result;
          }) as PoolClient['query'],
          release: (destroy?: boolean) => client.release(destroy),
        };
      },
    },
  };
}
async function acknowledgedBlocked(pid: number) {
  const c = adminClient();
  await c.connect();
  try {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const result = await c.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid]);
      if (result.rows[0].blocked === true) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error('Synthetic race did not acknowledge a real PostgreSQL lock');
  } finally {
    await c.end();
  }
}
async function barrier(reached: Promise<void>, work: Promise<unknown>) {
  await Promise.race([
    reached,
    work.then(
      () => {
        throw new Error('Synthetic operation completed before lock acknowledgement');
      },
      () => {
        throw new Error('Synthetic operation failed before lock acknowledgement');
      },
    ),
  ]);
}
describe
  .skipIf(!configured)
  .sequential('real PG16 attended manual recovery (restricted roles)', () => {
    beforeAll(async () => expect(await verifyPg16()).toMatch(/^16\./));
    beforeEach(async () => {
      await prepareSchema();
      f = await recoveryFixture(pools);
    });
    afterEach(async () => {
      await Promise.all([...pools].map((p) => p.end()));
      pools.clear();
    });
    afterAll(resetDisposableIdentity);
    it('E8-PG01 eight global tables, no tenant RLS and no schema owner runtime', async () => {
      const tables = await adminRows(
        "SELECT relname,relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relnamespace='zhiban_identity'::regnamespace AND relkind='r' AND relname LIKE 'identity_recovery_%'",
      );
      expect(tables).toHaveLength(8);
      expect(
        tables.every(
          (t) => !t.relrowsecurity && !t.relforcerowsecurity && t.owner === 'zhiban_identity_owner',
        ),
      ).toBe(true);
    });
    it.each(['zhiban_runtime', 'zhiban_control_runtime'] as const)(
      'E8-PG02 %s denied ticket/digest/outcome read',
      async (role) => {
        const c = runtimeClient(role);
        await c.connect();
        try {
          for (const t of ['tickets', 'cases', 'outcomes', 'notifications'])
            await expectDenied(c, 'SELECT * FROM zhiban_identity.identity_recovery_' + t);
        } finally {
          await c.end();
        }
      },
    );
    it('E8-PG03 PUBLIC table/column/function grants absent; auth cannot read SystemAdmin history', async () => {
      const entries = await adminRows(
        "SELECT c.relname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.relnamespace='zhiban_identity'::regnamespace AND c.relname LIKE 'identity_recovery_%' AND a.grantee=0",
      );
      expect(entries).toEqual([]);
      expect(
        await adminRows(
          "SELECT c.relname FROM pg_attribute x JOIN pg_class c ON c.oid=x.attrelid CROSS JOIN LATERAL aclexplode(x.attacl) a WHERE c.relnamespace='zhiban_identity'::regnamespace AND c.relname LIKE 'identity_recovery_%' AND a.grantee=0",
        ),
      ).toEqual([]);
      expect(
        await adminRows(
          "SELECT proname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.pronamespace='zhiban_identity'::regnamespace AND p.proname LIKE 'identity_recovery_%' AND a.grantee=0",
        ),
      ).toEqual([]);
      const c = runtimeClient('zhiban_auth_runtime');
      await c.connect();
      try {
        await expectDenied(c, 'SELECT * FROM zhiban_identity.system_admin_grants');
        await expectDenied(c, "UPDATE zhiban_identity.users SET status='DISABLED'");
        await expectDenied(
          c,
          "SELECT zhiban_identity.identity_recovery_source_block(NULL,1,'ref',ARRAY[]::uuid[])",
        );
      } finally {
        await c.end();
      }
    });
    it('E8-PG04 exact direct helper NULL/mode inputs reject', async () => {
      const c = runtimeClient('zhiban_auth_runtime');
      await c.connect();
      try {
        await expectDenied(c, 'SELECT * FROM zhiban_identity.identity_recovery_gate(NULL,NULL)');
        await expectDenied(
          c,
          'SELECT * FROM zhiban_identity.identity_recovery_user_locks(NULL,NULL,NULL)',
        );
        await expectDenied(
          c,
          "SELECT * FROM zhiban_identity.identity_recovery_actor_guard(NULL,NULL,'BYPASS')",
        );
      } finally {
        await c.end();
      }
    });
    it('E8-PG05 signed source-bound registration, version/provenance coverage', async () => {
      let registered;
      try {
        registered = await f.register();
      } catch {
        const failure = f.sqlFailure();
        if (failure)
          throw new Error(`Synthetic registration SQL failure: ${failure.stage}/${failure.code}`);
        throw new Error(`Synthetic registration non-SQL failure after ${f.lastStage()}`);
      }
      expect(registered).toMatchObject({ state: 'REGISTERED', revision: '1' });
      const c = (
        await adminRows('SELECT * FROM zhiban_identity.identity_recovery_cases WHERE case_id=$1', [
          f.caseId,
        ])
      )[0];
      expect(c.subject_user_id).toBe(f.subject);
      expect(c.actor_user_id).toBe(f.actor);
      expect(c.verifier_user_id).toBe(f.verifier);
      expect(
        await adminRows(
          'SELECT event_type,case_revision FROM zhiban_identity.identity_recovery_events WHERE case_id=$1',
          [f.caseId],
        ),
      ).toEqual([{ event_type: 'REGISTERED', case_revision: '1' }]);
    });
    it('E8-PG06 chronology: VERIFIED DB time +30min; approval does not renew it', async () => {
      await f.approve();
      const c = (
        await adminRows(
          'SELECT verified_at,expires_at,approved_at,registered_expires_at FROM zhiban_identity.identity_recovery_cases WHERE case_id=$1',
          [f.caseId],
        )
      )[0];
      expect(BigInt(c.expires_at) - BigInt(c.verified_at)).toBe(BigInt(1800000));
      expect(BigInt(c.approved_at)).toBeGreaterThanOrEqual(BigInt(c.verified_at));
    });
    it('E8-PG07 real ticket is digest-only, 10min cap, exactly-once subject delivery', async () => {
      const r = await f.issue(),
        t = (
          await adminRows(
            'SELECT * FROM zhiban_identity.identity_recovery_tickets WHERE case_id=$1',
            [f.caseId],
          )
        )[0];
      expect(
        t.ticket_digest ===
          ticketDigest(r.ticket, {
            environment: 'synthetic',
            site: 'site-a',
            caseId: f.caseId,
            generation: '1',
          }),
      ).toBe(true);
      expect(JSON.stringify(t).includes(r.ticket)).toBe(false);
      expect(BigInt(t.expires_at) - BigInt(t.created_at)).toBeLessThanOrEqual(BigInt(600000));
      expect(
        await f.service.subjectTicket(r.ceremony.cookie, r.ceremony.csrf, 'site-a', 'person'),
      ).toBeNull();
    });
    it('E8-PG08 wrong ticket charges durable attempt before KDF and rejects', async () => {
      const r = await f.issue();
      await expect(
        f.service.submit(
          r.ceremony.cookie,
          r.ceremony.csrf,
          'site-a',
          'person',
          randomLocator('mrec1_'),
          replacement,
        ),
      ).rejects.toThrow();
      expect((await resultState()).tickets[0]).toMatchObject({
        attempts: '1',
        state: 'ACTIVE',
        repository_revision: '2',
      });
    });
    it('E8-PG09 screening failure does not consume ticket or publish submission', async () => {
      const r = await f.issue();
      await expect(
        f.service.submit(
          r.ceremony.cookie,
          r.ceremony.csrf,
          'site-a',
          'person',
          r.ticket,
          'passwordpassword',
        ),
      ).rejects.toThrow();
      expect((await resultState()).tickets[0]).toMatchObject({ attempts: '1', state: 'ACTIVE' });
      expect(f.registry.ready(f.caseId)).toBeNull();
    });
    it('E8-PG10 complete replaces history, increments revision/epoch/generation once and creates audit/outbox', async () => {
      expect(await completed()).toMatchObject({ status: 'COMPLETED', notification: 'PENDING' });
      const s = await resultState();
      expect(s.slots[0]).toMatchObject({
        repository_revision: '2',
        security_epoch: '2',
        generation: '2',
      });
      expect(s.cases[0]).toMatchObject({ state: 'COMPLETED', repository_revision: '5' });
      expect(s.tickets[0].state).toBe('CONSUMED');
      expect(s.outcomes).toHaveLength(1);
      expect(s.notices.find((n) => n.notice_kind === 'COMPLETED')).toMatchObject({
        state: 'PENDING',
        repository_revision: '1',
      });
      const history = await adminRows(
        'SELECT status,verifier_material FROM zhiban_identity.credentials WHERE user_id=$1 ORDER BY generation',
        [f.subject],
      );
      expect(history[0]).toEqual({ status: 'REPLACED', verifier_material: null });
      expect(history[1].status).toBe('ACTIVE');
      const snap = await f.credentials.verificationSnapshot(f.subject);
      expect(snap).not.toBeNull();
      expect(await f.h.verify(replacement, snap!.verifier)).toBe(true);
      expect(await f.h.verify(password, snap!.verifier)).toBe(false);
    });
    it('E8-PG11 old Session invalidated by reset epoch, no new Session issued', async () => {
      const snap = await f.credentials.verificationSnapshot(f.subject);
      if (!snap) throw new Error('Fixture unavailable');
      const session = newApproved(snap);
      await f.sessions.create(session.record);
      const before = (await adminRows('SELECT count(*) AS n FROM zhiban_identity.sessions'))[0].n;
      await completed();
      const stored = await f.sessions.findByDigest(session.record.tokenDigest);
      expect(stored).not.toBeNull();
      expect(
        await f.sessions.validateAndTouch(bearerForCookie(session.bearer), instant(Date.now())),
      ).toBeNull();
      expect((await adminRows('SELECT count(*) AS n FROM zhiban_identity.sessions'))[0].n).toBe(
        before,
      );
    });
    it.each(['COMPLETED', 'CANCELLED'])(
      'E8-PG12 %s case cannot reopen; stale before terminal no-op',
      async (state) => {
        if (state === 'COMPLETED') await completed();
        else {
          await f.register();
          await f.service.cancel(await f.proof('cancel', '1'), f.caseId, '1', 'cancel');
        }
        await expect(
          f.service.cancel(await f.proof('cancel', '1'), f.caseId, '1', 'cancel-again'),
        ).rejects.toThrow();
        const c = runtimeClient('zhiban_auth_runtime');
        await c.connect();
        try {
          await expectDenied(
            c,
            "UPDATE zhiban_identity.identity_recovery_cases SET state='REGISTERED',repository_revision=repository_revision+1,terminal_at=NULL,terminal_reason=NULL,completed_at=NULL WHERE case_id=$1",
            [f.caseId],
          );
        } finally {
          await c.end();
        }
      },
    );
    it('E8-PG13 reissue cancels old generation, invalidates submission, no expiry renewal', async () => {
      const r = await f.ready(),
        before = (
          await adminRows(
            'SELECT expires_at FROM zhiban_identity.identity_recovery_cases WHERE case_id=$1',
            [f.caseId],
          )
        )[0];
      await f.receipt('HANDOVER', 'handover-2', { ticket_generation: '2' });
      await f.service.issue(
        await f.proof('issue', '4', 'handover-2'),
        f.caseId,
        '4',
        'handover-2',
        'staff',
        'reissue',
      );
      expect(f.registry.ready(f.caseId)).toBeNull();
      expect((await resultState()).tickets.map((t) => t.state)).toEqual(['CANCELLED', 'ACTIVE']);
      expect(
        (
          await adminRows(
            'SELECT expires_at FROM zhiban_identity.identity_recovery_cases WHERE case_id=$1',
            [f.caseId],
          )
        )[0],
      ).toEqual(before);
      await expect(
        f.service.complete(
          await f.proof('complete', '4', r.submission),
          f.caseId,
          '4',
          r.submission,
          'old-submit',
        ),
      ).rejects.toThrow();
    });
    it('E8-PG14 source blocking emits supplied UUIDv7, cancels live case/ticket atomically', async () => {
      await f.issue();
      const event = ids.nextCommandId();
      await f.control.query('SELECT zhiban_identity.identity_recovery_source_block($1,$2,$3,$4)', [
        f.src[1],
        '1',
        'source-block',
        [event],
      ]);
      const s = await resultState();
      expect(s.cases[0].state).toBe('CANCELLED');
      expect(s.tickets[0].state).toBe('CANCELLED');
      expect(
        await adminRows(
          "SELECT event_id,service_code FROM zhiban_identity.identity_recovery_events WHERE case_id=$1 AND event_type='CANCELLED'",
          [f.caseId],
        ),
      ).toEqual([{ event_id: event, service_code: 'recovery_source_block' }]);
    });
    it.each([{ events: [] }, { events: [null] }, { events: ['invalid'] }])(
      'E8-PG15 invalid/insufficient source-block event batch rolls back %#',
      async ({ events }) => {
        await f.register();
        await expect(
          f.control.query('SELECT zhiban_identity.identity_recovery_source_block($1,$2,$3,$4)', [
            f.src[1],
            '1',
            'source-block',
            events,
          ]),
        ).rejects.toThrow();
        expect((await resultState()).cases[0].state).toBe('REGISTERED');
        expect(
          (
            await adminRows(
              'SELECT state,repository_revision FROM zhiban_identity.identity_recovery_sources WHERE source_id=$1',
              [f.src[1]],
            )
          )[0],
        ).toEqual({ state: 'CURRENT', repository_revision: '1' });
      },
    );
    it('E8-PG16 source-block stale precedes already blocked no-op', async () => {
      await f.provision.block(f.src[0], '1', 'block');
      await expect(f.provision.block(f.src[0], '1', 'stale')).rejects.toThrow();
      await f.provision.block(f.src[0], '2', 'noop');
      expect(
        (
          await adminRows(
            'SELECT repository_revision FROM zhiban_identity.identity_recovery_sources WHERE source_id=$1',
            [f.src[0]],
          )
        )[0].repository_revision,
      ).toBe('2');
    });
    it.each(['revoked', 'future', 'expired'])(
      'E8-PG17 any target SystemAdmin history (%s) prevents registration',
      async (kind) => {
        const at = Date.now();
        await f.control.query(
          'INSERT INTO zhiban_identity.system_admin_grants(grant_id,user_id,created_at,valid_from,valid_until,revoked_at) VALUES($1,$2,$3,$4,$5,$6)',
          [
            ids.nextSystemAdminGrantId(),
            f.subject,
            (at - 10000).toString(),
            (kind === 'future' ? at + 10000 : at - 10000).toString(),
            kind === 'expired' ? (at - 1000).toString() : null,
            kind === 'revoked' ? at.toString() : null,
          ],
        );
        await expect(f.register()).rejects.toThrow();
        expect((await resultState()).cases).toEqual([]);
      },
    );
    it('E8-PG18 target disable/restore makes manifest stale; reset cannot restore User', async () => {
      await f.issue();
      await f.control.query(
        "UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=$1,disabled_reason='synthetic',updated_at=$1,repository_revision=repository_revision+1 WHERE user_id=$2",
        [Date.now().toString(), f.subject],
      );
      await f.control.query(
        "UPDATE zhiban_identity.users SET status='ACTIVE',disabled_at=NULL,disabled_reason=NULL,updated_at=$1,repository_revision=repository_revision+1 WHERE user_id=$2",
        [Date.now().toString(), f.subject],
      );
      await expect(
        f.service.issue(
          await f.proof('issue', '4', 'handover'),
          f.caseId,
          '4',
          'handover',
          'staff',
          'issue-again',
        ),
      ).rejects.toThrow();
      expect((await resultState()).slots[0].repository_revision).toBe('1');
    });
    it('E8-PG19 actor grant revoke prevents live completion but does not reveal history', async () => {
      const r = await f.ready();
      await f.control.query(
        'UPDATE zhiban_identity.system_admin_grants SET revoked_at=$1,repository_revision=repository_revision+1 WHERE grant_id=$2',
        [Date.now().toString(), f.grant],
      );
      await expect(
        f.service.complete(
          await f.proof('complete', '4', r.submission),
          f.caseId,
          '4',
          r.submission,
          'complete',
        ),
      ).rejects.toThrow();
      expect((await resultState()).slots[0].repository_revision).toBe('1');
    });
    it('E8-PG20 cancellation remains possible after target/source staleness', async () => {
      await f.issue();
      await f.credentials.replacePassword(
        f.subject,
        repositoryRevision('1'),
        (await f.credentials.findSlot(f.subject))!.value.activeCredentialId,
        ids.nextCredentialId(),
        await f.h.hash(replacement),
        instant(Date.now()),
        { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: 'change' },
      );
      expect(
        await f.service.cancel(await f.proof('cancel', '4'), f.caseId, '4', 'cancel'),
      ).toMatchObject({ state: 'CANCELLED' });
    });
    it('E8-PG21 safe outcome read survives later password change/revoke; notice ACK is idempotent and stale rejects', async () => {
      await completed();
      const slot = (await f.credentials.findSlot(f.subject))!;
      await f.credentials.replacePassword(
        f.subject,
        slot.revision,
        slot.value.activeCredentialId,
        ids.nextCredentialId(),
        await f.h.hash(password),
        instant(Date.now()),
        { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: 'change-again' },
      );
      expect(await f.service.outcome(await f.proof('outcome'), f.caseId)).toMatchObject({
        status: 'COMPLETED',
        notification: 'PENDING',
      });
      await f.receipt('NOTICE', 'delivered', {
        notice_kind: 'COMPLETED',
        route_source_id: f.src[2],
        route_source_revision: '1',
      });
      const ackRef = JSON.stringify(['COMPLETED', 'delivered']);
      await f.service.ack(
        await f.proof('ack', '1', ackRef),
        f.caseId,
        'COMPLETED',
        '1',
        'delivered',
      );
      await f.service.ack(
        await f.proof('ack', '2', ackRef),
        f.caseId,
        'COMPLETED',
        '2',
        'delivered',
      );
      await expect(
        f.service.ack(await f.proof('ack', '1', ackRef), f.caseId, 'COMPLETED', '1', 'delivered'),
      ).rejects.toThrow();
    });
    it('E8-PG22 safe incomplete outcome reports NOT_COMPLETED, no mutation/replay', async () => {
      await f.register();
      expect(await f.service.outcome(await f.proof('outcome'), f.caseId)).toMatchObject({
        status: 'NOT_COMPLETED',
        commandRef: null,
      });
      expect((await resultState()).slots[0].repository_revision).toBe('1');
    });
    it.each([
      'credential_slots',
      'credentials',
      'audit_events',
      'identity_recovery_cases',
      'identity_recovery_tickets',
      'identity_recovery_events',
      'identity_recovery_outcomes',
      'identity_recovery_notifications',
    ])('E8-PG23 fault at %s fully rolls back reset', async (table) => {
      const r = await f.ready(),
        before = await resultState(),
        proof = await f.proof('complete', '4', r.submission);
      let fired = false;
      // Fixed test interception, no SQL parameters included in failure diagnostics.
      const isolated = {
        connect: async () => {
          const client = await f.auth.connect();
          const real = client.query.bind(client);
          return {
            query: (async (sql: string, params?: unknown[]) => {
              if (
                !fired &&
                /^(?:UPDATE|INSERT INTO) /.test(sql) &&
                sql.includes('zhiban_identity.' + table)
              ) {
                fired = true;
                throw new Error('Synthetic write fault');
              }
              return real(sql, params);
            }) as PoolClient['query'],
            release: (destroy?: boolean) => client.release(destroy),
          };
        },
      };
      const s = new ManualRecovery(
        isolated,
        f.signed.evidence,
        f.h,
        f.security,
        f.registry,
        budgets,
        new Uint8Array(32).fill(11),
      );
      await expect(s.complete(proof, f.caseId, '4', r.submission, 'fault')).rejects.toThrow();
      expect(fired).toBe(true);
      expect(await resultState()).toEqual(before);
    });
    it('E8-PG24 independent auth connections concurrent completions have exactly one commit', async () => {
      const r = await f.ready(),
        auth2 = runtimePool('zhiban_auth_runtime');
      pools.add(auth2);
      const registry = new RecoveryRegistry(256, 600000, 300000),
        security = new RecoverySecurity(auth2, f.credentials, f.h, 256);
      const s = new ManualRecovery(
        auth2,
        f.signed.evidence,
        f.h,
        security,
        registry,
        budgets,
        new Uint8Array(32).fill(11),
      );
      const c = registry.open(
        registry.pair({
          caseId: f.caseId,
          actor: f.actor,
          subject: f.subject,
          site: 'site-a',
          operatorTerminal: 'staff',
          subjectTerminal: 'person',
          caseRevision: '4',
          deadline: Date.now() + 600000,
        }),
        'site-a',
        'person',
      );
      const t = (
        await adminRows(
          'SELECT * FROM zhiban_identity.identity_recovery_tickets WHERE case_id=$1',
          [f.caseId],
        )
      )[0];
      registry.deliver(
        c.cookie,
        { raw: r.ticket, generation: '1', id: t.ticket_id, digest: t.ticket_digest },
        '4',
      );
      registry.takeTicket(c.cookie);
      const sub = registry.submit(
        c.cookie,
        {
          caseId: f.caseId,
          caseRevision: '4',
          generation: '1',
          ticketId: t.ticket_id,
          ticketDigest: t.ticket_digest,
          approvalDigest: (
            await adminRows(
              'SELECT approval_manifest_digest FROM zhiban_identity.identity_recovery_cases WHERE case_id=$1',
              [f.caseId],
            )
          )[0].approval_manifest_digest,
          deadline: Date.now() + 300000,
          ceremony: c.cookie,
        },
        await f.h.hash(replacement),
      );
      const csrf = (await security.context(f.raw)).csrf;
      const p2 = await security.stepUp(
          f.raw,
          csrf,
          password,
          recoveryIntent('complete', f.caseId, '4', sub),
        ),
        p1 = await f.proof('complete', '4', r.submission);
      const results = await Promise.allSettled([
        f.service.complete(p1, f.caseId, '4', r.submission, 'first'),
        s.complete(p2, f.caseId, '4', sub, 'second'),
      ]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const state = await resultState();
      expect(state.outcomes).toHaveLength(1);
      expect(state.slots[0]).toMatchObject({ repository_revision: '2', security_epoch: '2' });
    });
    it.each(['User', 'slot', 'Session', 'grant', 'gate'])(
      'E8-PG25 acknowledged %s lock conflict aborts recovery without wait cycle',
      async (target) => {
        const r = await f.ready(),
          p = await f.proof('complete', '4', r.submission),
          block = adminClient();
        await block.connect();
        try {
          await block.query('BEGIN');
          const sql =
            target === 'User'
              ? 'SELECT user_id FROM zhiban_identity.users WHERE user_id=$1 FOR UPDATE'
              : target === 'slot'
                ? 'SELECT user_id FROM zhiban_identity.credential_slots WHERE user_id=$1 FOR UPDATE'
                : target === 'Session'
                  ? 'SELECT user_id FROM zhiban_identity.sessions WHERE token_digest=$1 FOR UPDATE'
                  : target === 'grant'
                    ? 'SELECT user_id FROM zhiban_identity.system_admin_grants WHERE grant_id=$1 FOR UPDATE'
                    : 'SELECT environment_ref FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=$1 FOR UPDATE';
          await block.query(sql, [
            target === 'User' || target === 'slot'
              ? f.subject
              : target === 'Session'
                ? f.digest
                : target === 'grant'
                  ? f.grant
                  : 'synthetic',
          ]);
          await expect(
            f.service.complete(p, f.caseId, '4', r.submission, 'locked'),
          ).rejects.toThrow();
          await block.query('ROLLBACK');
          expect((await resultState()).slots[0].repository_revision).toBe('1');
        } finally {
          await block.query('ROLLBACK');
          await block.end();
        }
      },
    );
    it('E8-PG26 uncommitted target-grant FK holder prevents reset; grant after strong User lock cannot slip through', async () => {
      const r = await f.ready(),
        p = await f.proof('complete', '4', r.submission),
        c = runtimeClient('zhiban_control_runtime');
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query(
          'INSERT INTO zhiban_identity.system_admin_grants(grant_id,user_id,created_at,valid_from) VALUES($1,$2,$3,$3)',
          [ids.nextSystemAdminGrantId(), f.subject, Date.now().toString()],
        );
        await expect(
          f.service.complete(p, f.caseId, '4', r.submission, 'fk-holder'),
        ).rejects.toThrow();
        await c.query('ROLLBACK');
        expect((await resultState()).slots[0].repository_revision).toBe('1');
      } finally {
        await c.query('ROLLBACK');
        await c.end();
      }
    });
    it('E8-PG28 uncertain acknowledged COMMIT permits outcome query only, never a second reset', async () => {
      const r = await f.ready(),
        proof = await f.proof('complete', '4', r.submission);
      let wrote = false;
      const pool = {
        connect: async () => {
          const client = await f.auth.connect(),
            query = client.query.bind(client);
          return {
            query: (async (sql: string, params?: unknown[]) => {
              if (sql.startsWith('UPDATE zhiban_identity.credential_slots')) wrote = true;
              const result = await query(sql, params);
              if (sql === 'COMMIT' && wrote) {
                wrote = false;
                throw new Error('Synthetic response loss after commit');
              }
              return result;
            }) as PoolClient['query'],
            release: (destroy?: boolean) => client.release(destroy),
          };
        },
      };
      const s = new ManualRecovery(
        pool,
        f.signed.evidence,
        f.h,
        f.security,
        f.registry,
        budgets,
        new Uint8Array(32).fill(11),
      );
      await expect(
        s.complete(proof, f.caseId, '4', r.submission, 'uncertain'),
      ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
      expect(await f.service.outcome(await f.proof('outcome'), f.caseId)).toMatchObject({
        status: 'COMPLETED',
      });
      await expect(
        f.service.complete(
          await f.proof('complete', '4', r.submission),
          f.caseId,
          '4',
          r.submission,
          'replay',
        ),
      ).rejects.toThrow();
      expect((await resultState()).slots[0]).toMatchObject({
        repository_revision: '2',
        security_epoch: '2',
      });
      expect((await resultState()).outcomes).toHaveLength(1);
    });
    it('E8-PG29 actor logout after step-up rejects completion', async () => {
      const r = await f.ready(),
        proof = await f.proof('complete', '4', r.submission),
        session = await f.sessions.findByDigest(f.digest);
      if (!session) throw new Error('Synthetic Session missing');
      await f.sessions.revoke(session.value.id, instant(Date.now()));
      await expect(
        f.service.complete(proof, f.caseId, '4', r.submission, 'logged-out'),
      ).rejects.toThrow();
      expect((await resultState()).slots[0].repository_revision).toBe('1');
    });
    it('E8-PG30 acknowledged actor exclusive Session barrier rejects recovery without wait cycle', async () => {
      const r = await f.ready(),
        proof = await f.proof('complete', '4', r.submission),
        c = adminClient();
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('zhiban-session-user:'||$1::text,0))",
          [f.actor],
        );
        await expect(
          f.service.complete(proof, f.caseId, '4', r.submission, 'barrier'),
        ).rejects.toThrow();
        await c.query('ROLLBACK');
        expect((await resultState()).slots[0].repository_revision).toBe('1');
      } finally {
        await c.query('ROLLBACK');
        await c.end();
      }
    });
    it('E8-PG31 credential replacement after subject submission invalidates old approval', async () => {
      const r = await f.ready(),
        proof = await f.proof('complete', '4', r.submission),
        slot = (await f.credentials.findSlot(f.subject))!;
      await f.credentials.replacePassword(
        f.subject,
        slot.revision,
        slot.value.activeCredentialId,
        ids.nextCredentialId(),
        await f.h.hash(replacement),
        instant(Date.now()),
        { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: 'normal-change' },
      );
      await expect(
        f.service.complete(proof, f.caseId, '4', r.submission, 'old-approval'),
      ).rejects.toThrow();
      const s = await resultState();
      expect(s.slots[0].repository_revision).toBe('2');
      expect(s.outcomes).toHaveLength(0);
      expect(s.tickets[0].state).toBe('ACTIVE');
    });
    it('E8-PG32 source block linearizes before reset and keeps credential unchanged', async () => {
      const r = await f.ready(),
        proof = await f.proof('complete', '4', r.submission);
      await f.provision.block(f.src[2], '1', 'source-revoked');
      await expect(
        f.service.complete(proof, f.caseId, '4', r.submission, 'blocked'),
      ).rejects.toThrow();
      const s = await resultState();
      expect(s.slots[0].repository_revision).toBe('1');
      expect(s.cases[0].state).toBe('CANCELLED');
      expect(s.outcomes).toHaveLength(0);
    });
    it('E8-PG33 disabled policy closes LIVE but permits current-actor cancellation', async () => {
      const r = await f.ready(),
        proof = await f.proof('complete', '4', r.submission);
      await f.provision.enabled('synthetic', f.service.policyDigest, '2', false);
      await expect(
        f.service.complete(proof, f.caseId, '4', r.submission, 'disabled'),
      ).rejects.toThrow();
      expect(
        await f.service.cancel(await f.proof('cancel', '4'), f.caseId, '4', 'cancel-disabled'),
      ).toMatchObject({ state: 'CANCELLED' });
    });
    it('E8-PG34 finite ticket attempts survive wrong-token failures and close before KDF', async () => {
      const r = await f.issue();
      for (let n = 0; n < 5; n++)
        await expect(
          f.service.submit(
            r.ceremony.cookie,
            r.ceremony.csrf,
            'site-a',
            'person',
            randomLocator('mrec1_'),
            replacement,
          ),
        ).rejects.toThrow();
      await expect(
        f.service.submit(
          r.ceremony.cookie,
          r.ceremony.csrf,
          'site-a',
          'person',
          r.ticket,
          replacement,
        ),
      ).rejects.toThrow();
      expect((await resultState()).tickets[0]).toMatchObject({
        attempts: '5',
        repository_revision: '6',
        state: 'ACTIVE',
      });
      expect(f.registry.ready(f.caseId)).toBeNull();
    });
    it('E8-PG35 ordinary revoked password requires explicit signed clearance and new generation; no revival', async () => {
      const slot = (await f.credentials.findSlot(f.subject))!;
      await f.credentials.revokePassword(
        f.subject,
        slot.revision,
        slot.value.activeCredentialId,
        instant(Date.now()),
        { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: 'revoke' },
      );
      const prior = f.signed.records.get('register')!,
        fields = Object.fromEntries(JSON.parse(prior.canonical));
      f.signed.put('register', 'REGISTRATION', {
        ...fields,
        intent: 'REESTABLISH_REVOKED_PASSWORD',
        security_clearance_ref: 'signed-security-clearance',
        expected_slot_revision: '2',
        expected_security_epoch: '2',
        expected_credential_id: null,
      });
      await completed();
      const s = await resultState();
      expect(s.slots[0]).toMatchObject({
        repository_revision: '3',
        security_epoch: '3',
        generation: '2',
      });
      expect(
        (
          await adminRows(
            'SELECT status FROM zhiban_identity.credentials WHERE user_id=$1 ORDER BY generation',
            [f.subject],
          )
        ).map((x) => x.status),
      ).toEqual(['REVOKED', 'ACTIVE']);
      expect(s.outcomes[0].prior_credential_id).toBeNull();
    });
    it('E8-PG36 closed audit payload carries exactly six frozen fields, no ticket/digest/password/verifier', async () => {
      const r = await f.ready();
      await f.service.complete(
        await f.proof('complete', '4', r.submission),
        f.caseId,
        '4',
        r.submission,
        'audit',
      );
      const rows = await adminRows(
        'SELECT a.event_type,a.reason,a.actor_user_id,a.event_payload FROM zhiban_identity.audit_events a JOIN zhiban_identity.identity_recovery_outcomes o ON o.credential_event_id=a.event_id WHERE o.case_id=$1',
        [f.caseId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        event_type: 'CREDENTIAL_REPLACED',
        reason: 'ACCOUNT_RECOVERY',
        actor_user_id: f.actor,
      });
      expect(Object.keys(rows[0].event_payload).sort()).toEqual(
        [
          'priorCredentialId',
          'credentialId',
          'repositoryRevisionBefore',
          'repositoryRevisionAfter',
          'securityEpochBefore',
          'securityEpochAfter',
        ].sort(),
      );
      const json = JSON.stringify(rows);
      expect(
        [r.ticket, password, replacement, 'argon2', 'ticket_digest', 'verifier_material'].some(
          (x) => json.includes(x),
        ),
      ).toBe(false);
    });
    it('E8-PG37 malformed persisted verifier fails closed before credential mutation', async () => {
      const r = await f.ready(),
        c = adminClient();
      await c.connect();
      try {
        await c.query(
          'ALTER TABLE zhiban_identity.credentials DISABLE TRIGGER credential_history_guard',
        );
        await c.query(
          "UPDATE zhiban_identity.credentials SET verifier_material='synthetic-corrupt-verifier' WHERE user_id=$1 AND status='ACTIVE'",
          [f.subject],
        );
      } finally {
        await c.query(
          'ALTER TABLE zhiban_identity.credentials ENABLE TRIGGER credential_history_guard',
        );
        await c.end();
      }
      await expect(
        f.service.complete(
          await f.proof('complete', '4', r.submission),
          f.caseId,
          '4',
          r.submission,
          'corrupt',
        ),
      ).rejects.toThrow();
      expect((await resultState()).slots[0].repository_revision).toBe('1');
    });
    it.each(['repository_revision', 'security_epoch', 'generation'] as const)(
      'E8-PG38 max %s fails before reset with all state unchanged',
      async (column) => {
        const c = adminClient();
        await c.connect();
        let slotGuardDisabled = false;
        let historyGuardDisabled = false;
        let inTransaction = false;
        try {
          await c.query(
            'ALTER TABLE zhiban_identity.credential_slots DISABLE TRIGGER credential_slot_guard',
          );
          slotGuardDisabled = true;
          await c.query(
            'ALTER TABLE zhiban_identity.credentials DISABLE TRIGGER credential_history_guard',
          );
          historyGuardDisabled = true;
          await c.query('BEGIN');
          inTransaction = true;
          await c.query(
            `UPDATE zhiban_identity.credential_slots SET ${column}=9223372036854775807 WHERE user_id=$1`,
            [f.subject],
          );
          if (column !== 'security_epoch')
            await c.query(
              `UPDATE zhiban_identity.credentials SET ${column === 'repository_revision' ? 'slot_revision' : 'generation'}=9223372036854775807 WHERE user_id=$1`,
              [f.subject],
            );
          await c.query('COMMIT');
          inTransaction = false;
        } finally {
          try {
            if (inTransaction) await c.query('ROLLBACK');
            if (historyGuardDisabled)
              await c.query(
                'ALTER TABLE zhiban_identity.credentials ENABLE TRIGGER credential_history_guard',
              );
          } finally {
            try {
              if (slotGuardDisabled)
                await c.query(
                  'ALTER TABLE zhiban_identity.credential_slots ENABLE TRIGGER credential_slot_guard',
                );
            } finally {
              await c.end();
            }
          }
        }
        const slot = (await f.credentials.findSlot(f.subject))!,
          fields = Object.fromEntries(JSON.parse(f.signed.records.get('register')!.canonical));
        f.signed.put('register', 'REGISTRATION', {
          ...fields,
          expected_slot_revision: slot.revision,
          expected_security_epoch: slot.value.securityEpoch,
          expected_generation: slot.value.generation,
        });
        const r = await f.ready(),
          before = await resultState();
        await expect(
          f.service.complete(
            await f.proof('complete', '4', r.submission),
            f.caseId,
            '4',
            r.submission,
            'maximum',
          ),
        ).rejects.toThrow();
        expect(await resultState()).toEqual(before);
      },
    );
    it('E8-PG39 target grant INSERT after recovery strong User lock waits until reset commits', async () => {
      const r = await f.ready(),
        proof = await f.proof('complete', '4', r.submission);
      const gate = pausePool(f.auth, 'SELECT * FROM zhiban_identity.identity_recovery_actor_guard');
      const service = new ManualRecovery(
        gate.wrapped,
        f.signed.evidence,
        f.h,
        f.security,
        f.registry,
        budgets,
        new Uint8Array(32).fill(11),
      );
      const c = runtimeClient('zhiban_control_runtime');
      await c.connect();
      let pending: Promise<unknown> | undefined;
      const completion = service.complete(proof, f.caseId, '4', r.submission, 'reset-before-grant');
      try {
        await barrier(gate.reached, completion);
        const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending = c.query(
          'INSERT INTO zhiban_identity.system_admin_grants(grant_id,user_id,created_at,valid_from) VALUES($1,$2,$3,$3)',
          [ids.nextSystemAdminGrantId(), f.subject, Date.now().toString()],
        );
        await acknowledgedBlocked(pid);
        gate.resume();
        expect(await completion).toMatchObject({ status: 'COMPLETED' });
        await pending;
      } finally {
        gate.resume();
        await Promise.allSettled([completion, ...(pending ? [pending] : [])]);
        await c.end();
      }
      expect((await resultState()).outcomes).toHaveLength(1);
    });
    it('E8-PG40 uncommitted Session INSERT holds User/slot locks; reset rejects immediately', async () => {
      const r = await f.ready(),
        proof = await f.proof('complete', '4', r.submission),
        snap = await f.credentials.verificationSnapshot(f.subject);
      if (!snap) throw new Error('Synthetic verification missing');
      const approved = newApproved(snap);
      const gate = pausePool(f.auth, 'INSERT INTO zhiban_identity.sessions');
      const session = new PostgresSessionRepository(gate.wrapped).create(approved.record);
      try {
        await barrier(gate.reached, session);
        await expect(
          f.service.complete(proof, f.caseId, '4', r.submission, 'session-first'),
        ).rejects.toThrow();
      } finally {
        gate.resume();
      }
      await session;
      expect((await resultState()).slots[0].repository_revision).toBe('1');
      expect(
        await f.sessions.validateAndTouch(bearerForCookie(approved.bearer), instant(Date.now())),
      ).toBe(f.subject);
    });
    it('E8-PG41 Session issuance after recovery lock waits then rejects its old epoch', async () => {
      const r = await f.ready(),
        proof = await f.proof('complete', '4', r.submission),
        snap = await f.credentials.verificationSnapshot(f.subject);
      if (!snap) throw new Error('Synthetic verification missing');
      const approved = newApproved(snap);
      const gate = pausePool(f.auth, 'SELECT * FROM zhiban_identity.identity_recovery_actor_guard');
      const service = new ManualRecovery(
        gate.wrapped,
        f.signed.evidence,
        f.h,
        f.security,
        f.registry,
        budgets,
        new Uint8Array(32).fill(11),
      );
      const other = runtimePool('zhiban_auth_runtime');
      other.options.max = 1;
      pools.add(other);
      const c = await other.connect(),
        pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      c.release();
      const completion = service.complete(
        proof,
        f.caseId,
        '4',
        r.submission,
        'reset-before-session',
      );
      let issuance: Promise<{ accepted: boolean }> | undefined;
      try {
        await barrier(gate.reached, completion);
        issuance = new PostgresSessionRepository(other).create(approved.record).then(
          () => ({ accepted: true }),
          () => ({ accepted: false }),
        );
        await acknowledgedBlocked(pid);
      } finally {
        gate.resume();
      }
      expect(await completion).toMatchObject({ status: 'COMPLETED' });
      expect(await issuance).toEqual({ accepted: false });
      expect(await f.sessions.findByDigest(approved.record.tokenDigest)).toBeNull();
    });
    it('E8-PG42 signed final approval cannot predate the actual VERIFIED DB timestamp', async () => {
      await f.register();
      await f.receipt('VERIFICATION', 'verify');
      await f.service.advance(
        'verify',
        await f.proof('verify', '1', 'verify'),
        f.caseId,
        '1',
        'verify',
        'verify',
      );
      const c = (
        await adminRows(
          'SELECT verified_at FROM zhiban_identity.identity_recovery_cases WHERE case_id=$1',
          [f.caseId],
        )
      )[0];
      await f.receipt('APPROVAL', 'premature', {
        issued_at: (BigInt(c.verified_at) - BigInt(1)).toString(),
        notice_kind: 'PRE_RESET',
        route_source_id: f.src[2],
        route_source_revision: '1',
        pre_notice_receipt_ref: 'premature',
      });
      await expect(
        f.service.advance(
          'approve',
          await f.proof('approve', '2', 'premature'),
          f.caseId,
          '2',
          'premature',
          'premature',
        ),
      ).rejects.toThrow();
      expect((await resultState()).cases[0]).toMatchObject({
        state: 'VERIFIED',
        repository_revision: '2',
      });
      expect((await resultState()).notices).toHaveLength(0);
    });
    it('E8-PG45 lost process ceremony requires fresh authorized re-pair/reissue; old ticket remains unusable', async () => {
      const prior = await f.ready();
      f.registry.invalidate(f.caseId);
      const pair = await f.service.pair(
        await f.proof('pair', '4'),
        f.caseId,
        '4',
        'site-a',
        'staff',
        'person',
      );
      const c = f.registry.open(pair.pairingCode, 'site-a', 'person');
      await f.receipt('HANDOVER', 'new-handover', { ticket_generation: '2' });
      await f.service.issue(
        await f.proof('issue', '4', 'new-handover'),
        f.caseId,
        '4',
        'new-handover',
        'staff',
        'reissue',
      );
      const ticket = await f.service.subjectTicket(c.cookie, c.csrf, 'site-a', 'person');
      if (!ticket) throw new Error('Synthetic reissued ticket missing');
      await expect(
        f.service.submit(
          prior.ceremony.cookie,
          prior.ceremony.csrf,
          'site-a',
          'person',
          prior.ticket,
          replacement,
        ),
      ).rejects.toThrow();
      await f.service.submit(c.cookie, c.csrf, 'site-a', 'person', ticket, replacement);
      const ready = await f.service.ready(await f.proof('ready'), f.caseId);
      if (!ready.submissionRef) throw new Error('Synthetic reissued submission missing');
      expect(
        await f.service.complete(
          await f.proof('complete', '5', ready.submissionRef),
          f.caseId,
          '5',
          ready.submissionRef,
          'new-completion',
        ),
      ).toMatchObject({ status: 'COMPLETED' });
      expect((await resultState()).tickets.map((x) => x.state)).toEqual(['CANCELLED', 'CONSUMED']);
      expect((await resultState()).outcomes).toHaveLength(1);
    });
    it('E8-PG27 source/case/gate state and pool/client cleanup after rejection', async () => {
      await f.register();
      await expect(f.provision.block(f.src[0], '1', 'bad', 0)).rejects.toThrow();
      const c = await f.auth.connect();
      try {
        expect(
          (await c.query("SELECT current_setting('app.tenant_id',true) AS tenant")).rows[0]
            .tenant ?? '',
        ).toBe('');
        expect((await c.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
      } finally {
        c.release();
      }
    });
    it('E8-PG43 durable all-dimension admission rejects saturation without a partial increment', async () => {
      const at = BigInt(
        (
          await adminRows('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS at')
        )[0].at,
      );
      const window = BigInt(budgets.window_ms),
        start = at - (at % window);
      const dimensions = ['GLOBAL', 'SITE', 'SUBJECT'];
      const keys = dimensions.map((d, i) =>
        createHmac('sha256', new Uint8Array(32).fill(11))
          .update(
            JSON.stringify([
              'manual-recovery-admission-v1',
              'synthetic',
              'READ',
              d,
              i === 0 ? 'global' : i === 1 ? 'site-a' : f.subject,
            ]),
          )
          .digest('hex'),
      );
      for (let i = 0; i < 3; i++)
        await adminRows(
          'INSERT INTO zhiban_identity.identity_recovery_admission_buckets(environment_ref,phase,dimension,key_hmac,window_start,used,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            'synthetic',
            'READ',
            dimensions[i],
            keys[i],
            start.toString(),
            999,
            (start + window).toString(),
          ],
        );
      await f.service.reserve('READ', 'site-a', f.subject);
      const before = await adminRows(
        'SELECT dimension,used FROM zhiban_identity.identity_recovery_admission_buckets ORDER BY dimension',
      );
      expect(before.every((x) => x.used === 1000)).toBe(true);
      await expect(f.service.reserve('READ', 'site-a', f.subject)).rejects.toThrow();
      expect(
        await adminRows(
          'SELECT dimension,used FROM zhiban_identity.identity_recovery_admission_buckets ORDER BY dimension',
        ),
      ).toEqual(before);
    });
    it('E8-PG44 restricted prune removes at most its finite limit and cannot erase live buckets', async () => {
      for (let i = 0; i < 4; i++)
        await adminRows(
          "INSERT INTO zhiban_identity.identity_recovery_admission_buckets VALUES('synthetic','READ','GLOBAL',$1,0,1,1)",
          [(i + 1).toString(16).padStart(64, '0')],
        );
      await f.service.reserve('READ', 'site-a', f.subject);
      const c = runtimeClient('zhiban_auth_runtime');
      await c.connect();
      try {
        expect(
          (
            await c.query('SELECT zhiban_identity.identity_recovery_prune($1,$2,2) AS removed', [
              'synthetic',
              f.service.policyDigest,
            ])
          ).rows[0].removed,
        ).toBe(2);
        await expectDenied(c, 'SELECT zhiban_identity.identity_recovery_prune($1,$2,501)', [
          'synthetic',
          f.service.policyDigest,
        ]);
        await expectDenied(c, 'SELECT * FROM zhiban_identity.identity_recovery_admission_buckets');
      } finally {
        await c.end();
      }
      expect(
        (
          await adminRows(
            'SELECT count(*) AS n FROM zhiban_identity.identity_recovery_admission_buckets WHERE window_start=0',
          )
        )[0].n,
      ).toBe('2');
      expect(
        (
          await adminRows(
            'SELECT count(*) AS n FROM zhiban_identity.identity_recovery_admission_buckets WHERE window_start>0',
          )
        )[0].n,
      ).toBe('3');
    });
  });
import {
  newApprovedSession,
  bearerForCookie,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
function newApproved(
  snapshot: NonNullable<Awaited<ReturnType<F['credentials']['verificationSnapshot']>>>,
) {
  return newApprovedSession(snapshot, repositoryRevision('1'), instant(Date.now()), {
    absoluteMs: 28800000,
    idleMs: 1800000,
  });
}
