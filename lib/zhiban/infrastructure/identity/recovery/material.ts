import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { must, reference, uuid, revision } from './values';
export function randomLocator(prefix: 'mrec1_' | 'mpair1_' | 'mcer1_' | 'msub1_' | 'mcsrf1_') {
  return prefix + randomBytes(32).toString('base64url');
}
export function decode(value: unknown, prefix: string) {
  if (typeof value !== 'string' || value.length !== prefix.length + 43 || !value.startsWith(prefix))
    return null;
  const part = value.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{43}$(?![\s\S])/.test(part)) return null;
  const b = Buffer.from(part, 'base64url');
  return b.length === 32 && b.toString('base64url') === part ? b : null;
}
export interface TicketBinding {
  readonly environment: string;
  readonly site: string;
  readonly caseId: string;
  readonly generation: string;
}
export function ticketDigest(raw: unknown, b: TicketBinding) {
  reference(b.environment);
  reference(b.site);
  uuid(b.caseId);
  revision(b.generation);
  const secret = decode(raw, 'mrec1_');
  if (!secret) return null;
  return createHash('sha256')
    .update(
      ['zhiban-manual-recovery-ticket-v1', b.environment, b.site, b.caseId, b.generation, ''].join(
        '\0',
      ),
    )
    .update(secret)
    .digest('hex');
}
export function sameSecret(a: unknown, b: string) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function requireLocator(v: unknown, prefix: string): asserts v is string {
  must(decode(v, prefix) !== null);
}
