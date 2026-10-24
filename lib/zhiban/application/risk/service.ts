import { createHmac, randomBytes } from 'node:crypto';
import { academicId, requireAcademic, type AcademicActor } from '../../domain/academic/model';
import { riskCode, riskCommand, type RiskCommand, type RiskRef } from '../../domain/risk/model';
import type { AcademicContext, AcademicStore } from '../academic/service';
export interface RiskQuery {
  view: 'RULES' | 'QUEUE' | 'HISTORY' | 'DETAIL';
  id: string | null;
  code: string;
  decision: string;
  q: string;
  after: string[] | null;
  configStamp: string | null;
}
export interface RiskTransaction {
  read(
    a: AcademicActor,
    o: string,
    q: RiskQuery,
  ): Promise<{
    rows: Record<string, unknown>[];
    next: string[] | null;
    configStamp: string;
    record?: Record<string, unknown>;
    current?: unknown;
    rules?: unknown;
    asOf: number;
  }>;
  execute(a: AcademicActor, o: string, c: RiskCommand, key: string): Promise<unknown>;
}
export class RiskService {
  private readonly cursorKey = randomBytes(32);
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = false,
  ) {}
  async read(context: AcademicContext, o: string, input: Record<string, string>) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(
      Object.keys(input).every((k) =>
        ['view', 'id', 'code', 'decision', 'q', 'cursor'].includes(k),
      ),
    );
    const view = input.view ?? 'QUEUE',
      code = input.code ?? 'ALL',
      decision = input.decision ?? (view === 'QUEUE' ? 'PENDING' : 'ALL'),
      q = (input.q ?? '').trim();
    requireAcademic(['RULES', 'QUEUE', 'HISTORY', 'DETAIL'].includes(view));
    if (code !== 'ALL') riskCode(code);
    requireAcademic(
      (view === 'QUEUE'
        ? ['PENDING', 'SUPPORT', 'ALL']
        : ['SUPPORT', 'NO_ACTION', 'RESOLVED', 'ALL']
      ).includes(decision),
    );
    requireAcademic(q.length <= 120 && q.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(q));
    const query: RiskQuery = {
      view: view as RiskQuery['view'],
      id: input.id === undefined ? null : academicId(input.id),
      code,
      decision,
      q,
      after: null,
      configStamp: null,
    };
    requireAcademic(
      (view === 'DETAIL') === !!query.id &&
        (view !== 'RULES' || (!input.cursor && !input.q && !input.code && !input.decision)),
    );
    const binding = JSON.stringify([
      context.tenantId,
      context.actorMembershipId,
      o,
      view,
      query.id,
      code,
      decision,
      q,
    ]);
    const mac = (raw: string) =>
      createHmac('sha256', this.cursorKey).update(binding).update(raw).digest('hex');
    if (input.cursor) {
      requireAcademic(/^[A-Za-z0-9_-]{1,2048}$/.test(input.cursor));
      const raw = Buffer.from(input.cursor, 'base64url').toString(),
        payload = raw.slice(0, -65),
        sig = raw.slice(-64);
      requireAcademic(
        raw.at(-65) === ':' &&
          sig === mac(payload) &&
          Buffer.from(raw).toString('base64url') === input.cursor,
      );
      const p = JSON.parse(payload) as { after: string[]; configStamp: string };
      requireAcademic(
        Array.isArray(p.after) &&
          p.after.length === (view === 'QUEUE' ? 5 : 1) &&
          p.after.every((v) => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,150}$/.test(v)) &&
          /^[a-f0-9]{64}$/.test(p.configStamp),
      );
      query.after = p.after;
      query.configStamp = p.configStamp;
    }
    return this.store.run(context, null, async (a, tx) => {
      requireAcademic(tx.risk, 'UNAVAILABLE');
      const p = await tx.risk.read(a, o, query);
      const raw = p.next ? JSON.stringify({ after: p.next, configStamp: p.configStamp }) : null;
      return { ...p, next: raw ? Buffer.from(raw + ':' + mac(raw)).toString('base64url') : null };
    });
  }
  execute(context: AcademicContext, o: string, input: unknown, key: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    academicId(o);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = riskCommand(input);
    return this.store.run(context, null, (a, tx) => {
      requireAcademic(tx.risk, 'UNAVAILABLE');
      return tx.risk.execute(a, o, c, key);
    });
  }
}
export type { RiskRef };
