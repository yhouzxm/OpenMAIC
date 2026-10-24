import { createHash } from 'node:crypto';
import type { AcademicContext, AcademicStore, AcademicTransaction } from '../academic/service';
import {
  AcademicError,
  academicAdmin,
  academicId,
  requireAcademic,
  type AcademicActor,
  type AcademicCommand,
} from '../../domain/academic/model';
import { importCsv, importKind, importColumns, type ImportCommand } from './csv';
import type {
  ImportBatch,
  ImportPreviewRow,
} from '../../infrastructure/imports/postgres/transaction';
export class ImportsService {
  constructor(
    private readonly store: AcademicStore,
    private readonly enabled = true,
  ) {}
  private port(a: AcademicActor, tx: AcademicTransaction) {
    requireAcademic(academicAdmin(a), 'FORBIDDEN');
    requireAcademic(this.enabled && tx.imports, 'UNAVAILABLE');
    return tx.imports;
  }
  private run<T>(
    ctx: AcademicContext,
    c: ImportCommand | null,
    work: (a: AcademicActor, tx: AcademicTransaction) => Promise<T>,
  ) {
    if (c?.type === 'SAVE_DIRECTORY') {
      requireAcademic(this.store.runForRelated, 'UNAVAILABLE');
      return this.store.runForRelated(ctx, c.membershipId, work);
    }
    return this.store.run(ctx, c as AcademicCommand | null, work);
  }
  async preview(ctx: AcademicContext, type: unknown, csv: unknown, signal?: AbortSignal) {
    const kind = importKind(type);
    await this.store.run(ctx, null, async (a, tx) => {
      this.port(a, tx);
    });
    const parsed = importCsv(kind, csv),
      rows: ImportPreviewRow[] = [];
    for (const p of parsed) {
      requireAcademic(!signal?.aborted, 'UNAVAILABLE');
      if (!p.command) {
        rows.push({ ...p, state: 'BLOCKED', expected: null });
        continue;
      }
      try {
        const check = await this.run(ctx, p.command, (a, tx) =>
          this.port(a, tx).inspect(a, p.command!),
        );
        rows.push({ ...p, ...check });
      } catch (e) {
        rows.push({
          ...p,
          state: 'BLOCKED',
          expected: null,
          code: e instanceof AcademicError ? e.code : 'UNAVAILABLE',
        });
      }
    }
    if (kind === 'ENROLLMENTS') {
      const counts = new Map<string, number>();
      for (const r of rows)
        if (r.state === 'READY' && r.command?.type === 'ENROLL') {
          const id = String(r.command!.offeringId);
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      for (const r of rows)
        if (
          r.state === 'READY' &&
          r.command?.type === 'ENROLL' &&
          (counts.get(String(r.command.offeringId)) ?? 0) > (r.remaining ?? 0)
        ) {
          r.state = 'BLOCKED';
          r.code = 'CAPACITY_FULL';
        }
    }
    const id = await this.store.run(ctx, null, (a, tx) =>
      this.port(a, tx).create(
        a,
        kind,
        createHash('sha256').update(String(csv)).digest('hex'),
        rows,
      ),
    );
    return this.read(ctx, id);
  }
  async read(ctx: AcademicContext, id: string) {
    academicId(id);
    const b = await this.store.run(ctx, null, (a, tx) => this.port(a, tx).read(a, id));
    return this.view(b);
  }
  private view(b: ImportBatch) {
    const completed = b.rows.every((r) => r.state === 'IMPORTED' || r.state === 'SKIPPED');
    const blocked = b.rows.some((r) => r.state === 'BLOCKED' || r.state === 'FAILED');
    return {
      ...b,
      rows: b.rows.map(({ expected, commandKey, ...r }) => {
        void expected;
        void commandKey;
        return r;
      }),
      complete: completed,
      canCommit: !completed && !blocked && Date.now() < b.expiresAt,
      status: completed
        ? 'COMPLETED'
        : blocked
          ? 'BLOCKED'
          : Date.now() >= b.expiresAt
            ? 'EXPIRED'
            : b.rows.some((r) => r.state === 'IMPORTED' || r.state === 'SKIPPED')
              ? 'PARTIAL'
              : 'PREVIEW',
    };
  }
  async list(ctx: AcademicContext, after: string | null) {
    if (after) academicId(after);
    return this.store.run(ctx, null, async (a, tx) => {
      const rows = await this.port(a, tx).list(a, after);
      return {
        kinds: importColumns,
        rows: rows.slice(0, 20),
        next: rows.length > 20 ? String(rows[19].id) : null,
      };
    });
  }
  async commit(ctx: AcademicContext, id: string, signal?: AbortSignal) {
    academicId(id);
    const initial = await this.store.run(ctx, null, (a, tx) => this.port(a, tx).read(a, id));
    const started = Date.now();
    for (const r of initial.rows) {
      if (r.state === 'IMPORTED' || r.state === 'SKIPPED') continue;
      if (signal?.aborted || Date.now() - started >= 8000) break;
      try {
        await this.run(ctx, r.command, async (a, tx) => {
          const port = this.port(a, tx),
            batch = await port.read(a, id, true),
            row = batch.rows.find((x) => x.line === r.line)!;
          if (row.state === 'IMPORTED' || row.state === 'SKIPPED') return;
          requireAcademic(
            batch.expiresAt > Date.now() &&
              !batch.rows.some((x) => x.state === 'BLOCKED' || x.state === 'FAILED'),
            'CONFLICT',
          );
          requireAcademic(row.command, 'CONFLICT');
          const checked = await port.inspect(a, row.command, true);
          requireAcademic(
            checked.expected === row.expected && checked.state === row.state,
            'CONFLICT',
          );
          if (row.state === 'READY') {
            if (row.command.type === 'SAVE_DIRECTORY') {
              requireAcademic(tx.profile, 'UNAVAILABLE');
              await tx.profile.execute(a, row.command, row.commandKey);
            } else await tx.execute(a, row.command as AcademicCommand, row.commandKey);
          }
          await port.state(a, id, row.line, row.state === 'SKIP' ? 'SKIPPED' : 'IMPORTED');
        });
      } catch (e) {
        // A lost COMMIT ACK never becomes a guessed failure. GET re-reads the durable result.
        if (!(e instanceof AcademicError) || e.code === 'UNAVAILABLE')
          throw new AcademicError('UNAVAILABLE');
        await this.store.run(ctx, null, async (a, tx) => {
          const p = this.port(a, tx),
            b = await p.read(a, id, true),
            row = b.rows.find((x) => x.line === r.line)!;
          if (row.state === 'READY' || row.state === 'SKIP')
            await p.state(a, id, r.line, 'FAILED', e.code);
        });
        break;
      }
    }
    return this.read(ctx, id);
  }
}
