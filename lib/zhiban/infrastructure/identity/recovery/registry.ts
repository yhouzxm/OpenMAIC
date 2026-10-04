import type { PasswordVerifierHandle } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { randomLocator, sameSecret, requireLocator } from './material';
import { must, RecoveryError } from './values';
export interface CeremonyBinding {
  readonly caseId: string;
  readonly actor: string;
  readonly subject: string;
  readonly site: string;
  readonly operatorTerminal: string;
  readonly subjectTerminal: string;
  readonly caseRevision: string;
  readonly deadline: number;
}
export interface SubmissionBinding {
  readonly caseId: string;
  readonly caseRevision: string;
  readonly generation: string;
  readonly ticketId: string;
  readonly ticketDigest: string;
  readonly approvalDigest: string;
  readonly deadline: number;
  readonly ceremony: string;
}
type Timed = { deadline: number; wall: number; mono: number };
type Ceremony = Timed &
  CeremonyBinding & {
    csrf: string;
    ticket?: { raw: string; generation: string; id: string; digest: string };
    delivered: boolean;
  };
type Submission = Timed & SubmissionBinding & { verifier: PasswordVerifierHandle };
function live(t: Timed) {
  const wall = Date.now(),
    elapsed = performance.now() - t.mono;
  must(wall >= t.wall && elapsed >= 0 && wall < t.deadline && elapsed < t.deadline - t.wall);
}
export class RecoveryRegistry {
  #pairs = new Map<string, Timed & CeremonyBinding>();
  #ceremonies = new Map<string, Ceremony>();
  #submissions = new Map<string, Submission>();
  constructor(
    private readonly maximum: number,
    private readonly ceremonyTtl: number,
    private readonly submissionTtl: number,
  ) {
    must(
      Number.isInteger(maximum) &&
        maximum > 0 &&
        maximum <= 256 &&
        ceremonyTtl > 0 &&
        ceremonyTtl <= 600000 &&
        submissionTtl > 0 &&
        submissionTtl <= 300000,
    );
  }
  private stamp(deadline: number, ttl: number): Timed {
    return {
      wall: Date.now(),
      mono: performance.now(),
      deadline: Math.min(deadline, Date.now() + ttl),
    };
  }
  private prune() {
    for (const map of [this.#pairs, this.#ceremonies, this.#submissions])
      for (const [k, v] of map) {
        try {
          live(v);
        } catch {
          map.delete(k);
        }
      }
  }
  pair(binding: CeremonyBinding) {
    this.prune();
    const others = [...this.#pairs.values(), ...this.#ceremonies.values()].filter(
      (v) => v.caseId !== binding.caseId,
    ).length;
    must(others < this.maximum);
    const code = randomLocator('mpair1_');
    this.invalidate(binding.caseId);
    this.#pairs.set(code, { ...binding, ...this.stamp(binding.deadline, this.ceremonyTtl) });
    return code;
  }
  open(code: unknown, site: string, terminal: string) {
    requireLocator(code, 'mpair1_');
    const b = this.#pairs.get(code);
    must(b !== undefined);
    live(b);
    must(b.site === site && b.subjectTerminal === terminal);
    this.#pairs.delete(code);
    const cookie = randomLocator('mcer1_'),
      csrf = randomLocator('mcsrf1_');
    this.#ceremonies.set(cookie, {
      ...b,
      ...this.stamp(b.deadline, this.ceremonyTtl),
      csrf,
      delivered: false,
    });
    return Object.freeze({ cookie, csrf, deadline: b.deadline });
  }
  ceremony(cookie: unknown, csrf: unknown, site: string, terminal: string) {
    requireLocator(cookie, 'mcer1_');
    const b = this.#ceremonies.get(cookie);
    must(b !== undefined);
    live(b);
    must(b.site === site && b.subjectTerminal === terminal && sameSecret(csrf, b.csrf));
    return b;
  }
  findForIssue(caseId: string, operatorTerminal: string) {
    this.prune();
    const found = [...this.#ceremonies.entries()].filter(
      ([, b]) => b.caseId === caseId && b.operatorTerminal === operatorTerminal,
    );
    must(found.length === 1);
    live(found[0][1]);
    return found[0][0];
  }
  deliver(
    cookie: string,
    ticket: { raw: string; generation: string; id: string; digest: string },
    revision: string,
  ) {
    const b = this.#ceremonies.get(cookie);
    must(b !== undefined);
    live(b);
    for (const [k, s] of this.#submissions) if (s.caseId === b.caseId) this.#submissions.delete(k);
    b.ticket = ticket;
    b.delivered = false;
    this.#ceremonies.set(cookie, { ...b, caseRevision: revision });
  }
  takeTicket(cookie: string) {
    const b = this.#ceremonies.get(cookie);
    must(b !== undefined);
    live(b);
    if (!b.ticket || b.delivered) return null;
    const raw = b.ticket.raw;
    b.delivered = true;
    b.ticket = { ...b.ticket, raw: '' };
    return raw;
  }
  submit(cookie: string, binding: SubmissionBinding, verifier: PasswordVerifierHandle) {
    this.prune();
    const b = this.#ceremonies.get(cookie);
    must(b !== undefined);
    live(b);
    must(
      b.delivered &&
        b.ticket?.id === binding.ticketId &&
        b.caseRevision === binding.caseRevision &&
        b.caseId === binding.caseId &&
        binding.ceremony === cookie &&
        b.ticket.generation === binding.generation &&
        b.ticket.digest === binding.ticketDigest &&
        binding.deadline <= b.deadline,
    );
    for (const [k, s] of this.#submissions)
      if (s.caseId === binding.caseId) this.#submissions.delete(k);
    if (this.#submissions.size >= this.maximum) throw new RecoveryError('RECOVERY_UNAVAILABLE');
    const ref = randomLocator('msub1_');
    this.#submissions.set(ref, {
      ...binding,
      verifier,
      ...this.stamp(binding.deadline, this.submissionTtl),
    });
    return ref;
  }
  ready(caseId: string) {
    this.prune();
    return [...this.#submissions.entries()].find(([, s]) => s.caseId === caseId)?.[0] ?? null;
  }
  claim(ref: unknown, caseId: string) {
    requireLocator(ref, 'msub1_');
    const s = this.#submissions.get(ref);
    must(s !== undefined);
    live(s);
    must(s.caseId === caseId);
    this.#submissions.delete(ref);
    return s;
  }
  invalidate(caseId: string) {
    for (const map of [this.#pairs, this.#ceremonies, this.#submissions])
      for (const [k, v] of map) if (v.caseId === caseId) map.delete(k);
  }
}
