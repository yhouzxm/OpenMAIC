import type { IncomingMessage, ServerResponse } from 'node:http';
import { TLSSocket } from 'node:tls';
import type { ManualRecovery } from './composition';
import { recoveryIntent } from './composition';
import { exact, must, reference, RecoveryError, safeError } from './values';
import { IdentityIds } from '../composition/ids';
export interface RecoveryTerminal {
  readonly id: string;
  readonly site: string;
  readonly lane: 'OPERATOR' | 'SUBJECT';
  readonly certificate: string;
  readonly pairedTerminal: string;
}
export interface RecoveryTransportConfig {
  readonly origin: string;
  readonly environment: string;
  readonly proxyCertificate: string;
  readonly deploymentApprovalRef: string;
  readonly terminals: readonly RecoveryTerminal[];
}
const bodies: Record<string, readonly string[]> = {
  'operator/context': [],
  'operator/register': [
    'enrollmentRef',
    'appointmentRef',
    'contactRef',
    'approvalRef',
    'currentPassword',
  ],
  'operator/verify': ['caseId', 'expectedRevision', 'evidenceReceiptRef', 'currentPassword'],
  'operator/approve': ['caseId', 'expectedRevision', 'preNoticeReceiptRef', 'currentPassword'],
  'operator/pair': ['caseId', 'expectedRevision', 'currentPassword'],
  'operator/issue': ['caseId', 'expectedRevision', 'deliveryReceiptRef', 'currentPassword'],
  'operator/ready': ['caseId', 'currentPassword'],
  'operator/complete': ['caseId', 'expectedRevision', 'submissionRef', 'currentPassword'],
  'operator/cancel': ['caseId', 'expectedRevision', 'currentPassword'],
  'operator/outcome': ['caseId', 'currentPassword'],
  'operator/ack': ['caseId', 'noticeKind', 'expectedRevision', 'receiptRef', 'currentPassword'],
  'subject/context': ['pairingCode'],
  'subject/ticket': [],
  'subject/submit': ['ticket', 'newPassword'],
};
/** Flat string-only protocol objects. Duplicate/escaped aliases cannot be silently overwritten. */
export function parsePrivateBody(text: string): Record<string, string> {
  let i = 0;
  const result: Record<string, string> = Object.create(null),
    seen = new Set<string>();
  const whitespace = () => {
    while (i < text.length && /[\t\r\n ]/.test(text[i])) i++;
  };
  const string = () => {
    must(text[i] === '"');
    const start = i++;
    let escaped = false;
    while (i < text.length) {
      const c = text[i++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === '"') {
        const v: unknown = JSON.parse(text.slice(start, i));
        must(typeof v === 'string');
        return v;
      }
    }
    throw new RecoveryError('RECOVERY_REJECTED');
  };
  whitespace();
  must(text[i++] === '{');
  whitespace();
  if (text[i] !== '}')
    while (true) {
      const key = string();
      must(!seen.has(key) && seen.size < 5);
      seen.add(key);
      whitespace();
      must(text[i++] === ':');
      whitespace();
      result[key] = string();
      whitespace();
      if (text[i] !== ',') break;
      i++;
      whitespace();
    }
  must(text[i++] === '}');
  whitespace();
  must(i === text.length);
  return result;
}
export function privateHeaders(incoming: IncomingMessage) {
  const values = new Map<string, string>();
  let size = 0;
  for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
    const name = incoming.rawHeaders[i].toLowerCase(),
      value = incoming.rawHeaders[i + 1];
    size += Buffer.byteLength(name) + Buffer.byteLength(value);
    must(size <= 8192 && !values.has(name));
    values.set(name, value);
  }
  return values;
}
function cookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  const found = header
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.startsWith(name + '='));
  must(found.length <= 1);
  return found[0]?.slice(name.length + 1);
}
export function protocol(
  config: RecoveryTransportConfig,
  path: string,
  method: string,
  headers: Map<string, string>,
) {
  must(
    method === 'POST' &&
      Object.hasOwn(bodies, path) &&
      headers.get('origin') === config.origin &&
      headers.get('x-zhiban-request') === 'manual-recovery-v1' &&
      headers.get('sec-fetch-site') === 'same-origin' &&
      headers.get('content-type') === 'application/json' &&
      !headers.has('authorization') &&
      !headers.has('content-encoding'),
  );
}
export class PrivateRecoveryTransport {
  #active = 0;
  #terminals = new Map<string, RecoveryTerminal>();
  #config: RecoveryTransportConfig;
  constructor(
    private readonly service: ManualRecovery,
    config: RecoveryTransportConfig,
    private readonly deploymentLive: () => void,
    private readonly ids = new IdentityIds(),
  ) {
    const u = new URL(config.origin);
    must(u.protocol === 'https:' && u.origin === config.origin && !u.username && !u.password);
    reference(config.environment);
    reference(config.deploymentApprovalRef);
    must(config.environment === service.policy.environment_ref);
    must(
      /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(config.proxyCertificate) &&
        config.terminals.length >= 2 &&
        config.terminals.length <= 256,
    );
    for (const t of config.terminals) {
      reference(t.id);
      reference(t.site);
      reference(t.pairedTerminal);
      must(
        !this.#terminals.has(t.certificate) &&
          ![...this.#terminals.values()].some((x) => x.id === t.id) &&
          t.id !== t.pairedTerminal &&
          ['OPERATOR', 'SUBJECT'].includes(t.lane) &&
          /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(t.certificate),
      );
      this.#terminals.set(t.certificate, Object.freeze({ ...t }));
    }
    for (const t of this.#terminals.values()) {
      const other = [...this.#terminals.values()].find((x) => x.id === t.pairedTerminal);
      must(
        other !== undefined &&
          other.pairedTerminal === t.id &&
          other.site === t.site &&
          other.lane !== t.lane,
      );
    }
    this.#config = Object.freeze({
      ...config,
      terminals: Object.freeze([...this.#terminals.values()]),
    });
  }
  private observed(req: IncomingMessage, headers: Map<string, string>) {
    must(req.socket instanceof TLSSocket && req.socket.authorized === true);
    must(req.socket.getPeerCertificate().fingerprint256 === this.#config.proxyCertificate);
    const t = this.#terminals.get(headers.get('x-zhiban-terminal-cert') ?? '');
    must(t !== undefined);
    must(
      headers.get('x-zhiban-recovery-lane') === t.lane &&
        headers.get('x-zhiban-recovery-site') === t.site &&
        headers.get('x-zhiban-recovery-environment') === this.#config.environment,
    );
    return t;
  }
  private async body(req: IncomingMessage) {
    return new Promise<unknown>((resolve, reject) => {
      let chunks: Buffer[] = [],
        size = 0,
        done = false;
      const finish = (error?: Error, value?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        req.off('data', data);
        req.off('end', end);
        req.off('error', failed);
        req.off('aborted', failed);
        chunks = [];
        if (error) reject(error);
        else resolve(value);
      };
      const failed = () => finish(new RecoveryError('RECOVERY_REJECTED'));
      const data = (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8192) {
          finish(new RecoveryError('RECOVERY_REJECTED'));
          req.resume();
        } else chunks.push(chunk);
      };
      const end = () => {
        try {
          const bytes = Buffer.concat(chunks);
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          finish(undefined, parsePrivateBody(text));
        } catch {
          failed();
        }
      };
      const timer = setTimeout(() => {
        finish(new RecoveryError('RECOVERY_UNAVAILABLE'));
        req.resume();
      }, this.service.policy.body_timeout_ms);
      timer.unref();
      req.on('data', data);
      req.once('end', end);
      req.once('error', failed);
      req.once('aborted', failed);
    });
  }
  async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json');
    if (this.#active >= this.service.policy.max_process_requests) {
      res.statusCode = 503;
      res.end('{"error":"RECOVERY_UNAVAILABLE"}');
      return;
    }
    this.#active++;
    let subjectRequest = false,
      ceremonyValidated = false;
    try {
      this.deploymentLive();
      const headers = privateHeaders(req),
        url = req.url ?? '';
      must(url.startsWith('/_zhiban_recovery/v1/') && !/[?#]/.test(url));
      const path = url.slice('/_zhiban_recovery/v1/'.length);
      protocol(this.#config, path, req.method ?? '', headers);
      const t = this.observed(req, headers);
      must(path.startsWith(t.lane.toLowerCase() + '/'));
      subjectRequest = t.lane === 'SUBJECT';
      const phase =
        path === 'operator/register'
          ? 'REGISTER'
          : path === 'subject/submit'
            ? 'SUBMIT'
            : path === 'operator/complete'
              ? 'COMPLETE'
              : path === 'operator/issue' || path === 'operator/pair'
                ? 'ISSUE'
                : path === 'operator/ack'
                  ? 'ACK'
                  : 'READ';
      // Admission before body parsing/KDF; invalid pairing uses a fixed site unknown bucket.
      await this.service.reserve(phase, t.site);
      const b = await this.body(req);
      exact(b, bodies[path]);
      for (const v of Object.values(b)) must(typeof v === 'string');
      const x = b as Record<string, string>,
        raw = cookie(headers.get('cookie'), '__Host-zhiban_session'),
        csrf = headers.get('x-zhiban-csrf'),
        ceremony = cookie(headers.get('cookie'), '__Host-zhiban_recovery'),
        requestId = this.ids.nextCommandId();
      const result = await this.service.bounded(async () => {
        if (path === 'operator/context') return this.service.security.context(raw);
        if (path === 'subject/context') {
          const c = this.service.registry.open(x.pairingCode, t.site, t.id);
          res.setHeader(
            'Set-Cookie',
            `__Host-zhiban_recovery=${c.cookie}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((c.deadline - Date.now()) / 1000))}`,
          );
          return { csrf: c.csrf };
        }
        if (path.startsWith('subject/')) {
          must(ceremony !== undefined);
          this.service.registry.ceremony(ceremony, csrf, t.site, t.id);
          ceremonyValidated = true;
          if (path === 'subject/ticket') {
            const ticket = await this.service.subjectTicket(ceremony, csrf, t.site, t.id);
            return ticket ? { ticket } : { status: 'NO_TICKET' };
          }
          return this.service.submit(ceremony, csrf, t.site, t.id, x.ticket, x.newPassword);
        }
        const op = path.slice(9),
          id = x.caseId ?? x.approvalRef;
        let targetRef =
          x.evidenceReceiptRef ??
          x.preNoticeReceiptRef ??
          x.deliveryReceiptRef ??
          x.submissionRef ??
          null;
        if (op === 'ack') targetRef = JSON.stringify([x.noticeKind, x.receiptRef]);
        const intent = recoveryIntent(op, id, x.expectedRevision ?? null, targetRef);
        must(phase !== 'SUBMIT');
        await this.service.admitOperator(phase, t.site, id);
        const proof = await this.service.security.stepUp(raw, csrf, x.currentPassword, intent);
        switch (op) {
          case 'register':
            return this.service.register(
              proof,
              {
                enrollmentRef: x.enrollmentRef,
                appointmentRef: x.appointmentRef,
                contactRef: x.contactRef,
                approvalRef: x.approvalRef,
              },
              t.site,
              requestId,
            );
          case 'verify':
            return this.service.advance(
              'verify',
              proof,
              id,
              x.expectedRevision,
              x.evidenceReceiptRef,
              requestId,
            );
          case 'approve':
            return this.service.advance(
              'approve',
              proof,
              id,
              x.expectedRevision,
              x.preNoticeReceiptRef,
              requestId,
            );
          case 'pair':
            return this.service.pair(proof, id, x.expectedRevision, t.site, t.id, t.pairedTerminal);
          case 'issue':
            return this.service.issue(
              proof,
              id,
              x.expectedRevision,
              x.deliveryReceiptRef,
              t.id,
              requestId,
            );
          case 'ready':
            return this.service.ready(proof, id);
          case 'complete':
            return this.service.complete(proof, id, x.expectedRevision, x.submissionRef, requestId);
          case 'cancel':
            return this.service.cancel(proof, id, x.expectedRevision, requestId);
          case 'outcome':
            return this.service.outcome(proof, id);
          case 'ack':
            return this.service.ack(proof, id, x.noticeKind, x.expectedRevision, x.receiptRef);
          default:
            throw new RecoveryError('RECOVERY_REJECTED');
        }
      });
      res.statusCode = 200;
      res.end(JSON.stringify(result));
    } catch (error) {
      if (subjectRequest && !ceremonyValidated)
        res.setHeader(
          'Set-Cookie',
          '__Host-zhiban_recovery=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0',
        );
      const safe = safeError(error);
      res.statusCode = safe.code === 'RECOVERY_REJECTED' ? 400 : 503;
      res.end(
        JSON.stringify({
          error: safe.code === 'OUTCOME_UNKNOWN' ? 'RECOVERY_UNAVAILABLE' : safe.code,
        }),
      );
    } finally {
      this.#active--;
    }
  }
}
