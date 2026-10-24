import { randomBytes } from 'node:crypto';
import type { AcademicContext, AcademicStore } from '../academic/service';
import {
  AcademicError,
  academicAdmin,
  academicId,
  academicCommand,
  requireAcademic,
  type AcademicActor,
} from '../../domain/academic/model';
import { rosterCsv, rosterLimits, type CsvRow } from './csv';
export interface RosterInfo {
  id: string;
  name: string;
  revision: string;
  capacity: number;
  enrolled: number;
}
export interface RosterCheck {
  name: string | null;
  status: 'READY' | 'SKIP' | 'BLOCKED';
  code: string | null;
}
export interface RosterTransaction {
  info(actor: AcademicActor, offeringId: string): Promise<RosterInfo>;
  inspect(actor: AcademicActor, offeringId: string, member: string): Promise<RosterCheck>;
  enroll(
    actor: AcademicActor,
    offeringId: string,
    member: string,
    revision: string,
    key: string,
  ): Promise<void>;
}
export interface RosterRow extends CsvRow {
  name: string | null;
  status: 'READY' | 'SKIP' | 'BLOCKED';
  code: string | null;
}
export interface RosterResult {
  line: number;
  membershipId: string;
  status: 'IMPORTED' | 'SKIPPED' | 'FAILED' | 'UNKNOWN' | 'NOT_ATTEMPTED';
  code: string | null;
}
interface Plan {
  token: string;
  id: string;
  tenant: string;
  actor: string;
  offering: RosterInfo;
  rows: RosterRow[];
  expiresAt: number;
  canCommit: boolean;
  busy: boolean;
  results: Map<number, RosterResult>;
}
export const enrollmentCommand = (offeringId: string, membershipId: string) =>
  academicCommand({ type: 'ENROLL', offeringId, membershipId, revision: null });
export class RosterService {
  private readonly plans = new Map<string, Plan>();
  constructor(
    private readonly store: AcademicStore,
    private readonly clock: () => number = Date.now,
  ) {}
  private port(tx: import('../academic/service').AcademicTransaction) {
    if (!tx.roster) throw new AcademicError('UNAVAILABLE');
    return tx.roster;
  }
  info(context: AcademicContext, offering: string) {
    academicId(offering);
    return this.store.run(context, null, (actor, tx) => {
      requireAcademic(academicAdmin(actor), 'FORBIDDEN');
      return this.port(tx).info(actor, offering);
    });
  }
  async preview(context: AcademicContext, offering: string, csv: unknown, signal?: AbortSignal) {
    const info = await this.info(context, offering),
      parsed = rosterCsv(csv),
      rows: RosterRow[] = [];
    for (const row of parsed) {
      requireAcademic(!signal?.aborted, 'UNAVAILABLE');
      if (row.error) {
        rows.push({ ...row, name: null, status: 'BLOCKED', code: row.error });
        continue;
      }
      try {
        const check = await this.store.run(
          context,
          enrollmentCommand(offering, row.membershipId),
          (actor, tx) => {
            requireAcademic(academicAdmin(actor), 'FORBIDDEN');
            return this.port(tx).inspect(actor, offering, row.membershipId);
          },
        );
        rows.push({ ...row, ...check });
      } catch (e) {
        rows.push({
          ...row,
          name: null,
          status: 'BLOCKED',
          code: e instanceof AcademicError ? e.code : 'UNAVAILABLE',
        });
      }
    }
    // Preview is advisory across rows; commit rechecks every row and its capacity under normal locks.
    for (const [token, p] of this.plans)
      if (!p.busy && p.expiresAt <= this.clock()) this.plans.delete(token);
    requireAcademic(this.plans.size < rosterLimits.plans, 'UNAVAILABLE');
    const token = randomBytes(32).toString('base64url'),
      ready = rows.filter((r) => r.status === 'READY').length;
    const plan: Plan = {
      token,
      id: randomBytes(16).toString('hex'),
      tenant: context.tenantId,
      actor: context.actorMembershipId,
      offering: info,
      rows,
      expiresAt: this.clock() + rosterLimits.previewMs,
      canCommit:
        ready > 0 &&
        !rows.some((r) => r.status === 'BLOCKED') &&
        ready <= info.capacity - info.enrolled,
      busy: false,
      results: new Map(),
    };
    this.plans.set(token, plan);
    return {
      token,
      batchId: plan.id,
      expiresAt: plan.expiresAt,
      offering: info,
      rows,
      canCommit: plan.canCommit,
      ready,
      skipped: rows.filter((r) => r.status === 'SKIP').length,
      blocked: rows.filter((r) => r.status === 'BLOCKED').length,
      capacityEnough: ready <= info.capacity - info.enrolled,
    };
  }
  async commit(context: AcademicContext, offering: string, token: unknown, signal?: AbortSignal) {
    // This check precedes even cached results: tokens never replace present administrator authority.
    await this.info(context, offering);
    requireAcademic(typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token));
    const plan = this.plans.get(token);
    requireAcademic(plan, 'CONFLICT');
    requireAcademic(
      plan &&
        plan.tenant === context.tenantId &&
        plan.actor === context.actorMembershipId &&
        plan.offering.id === offering,
      'FORBIDDEN',
    );
    requireAcademic(plan.expiresAt > this.clock() && plan.canCommit && !plan.busy, 'CONFLICT');
    plan.busy = true;
    const started = this.clock();
    try {
      for (const row of plan.rows) {
        const done = plan.results.get(row.line);
        if (done?.status === 'IMPORTED' || done?.status === 'SKIPPED') continue;
        if (signal?.aborted || this.clock() >= plan.expiresAt || this.clock() - started >= 8000)
          break;
        try {
          if (row.status === 'SKIP') {
            const current = await this.store.run(
              context,
              enrollmentCommand(offering, row.membershipId),
              (actor, tx) => {
                requireAcademic(academicAdmin(actor), 'FORBIDDEN');
                return this.port(tx).inspect(actor, offering, row.membershipId);
              },
            );
            requireAcademic(current.status === 'SKIP', 'CONFLICT');
          } else
            await this.store.run(
              context,
              enrollmentCommand(offering, row.membershipId),
              (actor, tx) => {
                requireAcademic(academicAdmin(actor), 'FORBIDDEN');
                return this.port(tx).enroll(
                  actor,
                  offering,
                  row.membershipId,
                  plan.offering.revision,
                  `roster_${plan.id}_${row.line}`,
                );
              },
            );
          plan.results.set(row.line, {
            line: row.line,
            membershipId: row.membershipId,
            status: row.status === 'SKIP' ? 'SKIPPED' : 'IMPORTED',
            code: null,
          });
        } catch (e) {
          const code = e instanceof AcademicError ? e.code : 'UNAVAILABLE';
          plan.results.set(row.line, {
            line: row.line,
            membershipId: row.membershipId,
            status: code === 'UNAVAILABLE' || done?.status === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED',
            code,
          });
          break;
        }
      }
      const results = plan.rows.map(
        (row) =>
          plan.results.get(row.line) ?? {
            line: row.line,
            membershipId: row.membershipId,
            status: 'NOT_ATTEMPTED' as const,
            code: null,
          },
      );
      return {
        token,
        batchId: plan.id,
        expiresAt: plan.expiresAt,
        results,
        complete: results.every((r) => r.status === 'IMPORTED' || r.status === 'SKIPPED'),
      };
    } finally {
      plan.busy = false;
    }
  }
}
