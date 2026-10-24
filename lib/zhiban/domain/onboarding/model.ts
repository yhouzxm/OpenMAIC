import { createHash } from 'node:crypto';
import { academicId, requireAcademic } from '../academic/model';
export const onboardingDigest = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, v[k]]),
            )
          : v,
      ),
    )
    .digest('hex');
export const ticketDigest = (ticket: string) =>
  createHash('sha256')
    .update('zhiban-ordinary-first-password-v1:' + ticket)
    .digest('hex');
export function ticketParts(value: unknown) {
  requireAcademic(typeof value === 'string' && /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(value));
  const [id] = value.split('.');
  academicId(id);
  return { id, digest: ticketDigest(value) };
}
export function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requireAcademic(
    !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === keys.sort().join(),
  );
}
export type AccountRequestCommand =
  | {
      type: 'REQUEST_ACCOUNT';
      name: string;
      subjectReference: string;
      requestedRole: 'STUDENT' | 'TEACHER';
    }
  | { type: 'WITHDRAW_REQUEST'; id: string; revision: string };
export function accountRequestCommand(value: unknown): AccountRequestCommand {
  requireAcademic(!!value && typeof value === 'object');
  const c = value as Record<string, unknown>;
  if (c.type === 'REQUEST_ACCOUNT') {
    exact(c, ['type', 'name', 'subjectReference', 'requestedRole']);
    for (const [key, max] of [
      ['name', 80],
      ['subjectReference', 120],
    ] as const)
      requireAcademic(
        typeof c[key] === 'string' &&
          c[key].trim().length > 0 &&
          c[key].length <= max &&
          c[key].isWellFormed() &&
          !/[\u0000-\u001f\u007f]/.test(c[key]),
      );
    requireAcademic(c.requestedRole === 'STUDENT' || c.requestedRole === 'TEACHER');
    return {
      ...c,
      name: (c.name as string).trim(),
      subjectReference: (c.subjectReference as string).trim(),
    } as AccountRequestCommand;
  }
  exact(c, ['type', 'id', 'revision']);
  requireAcademic(
    c.type === 'WITHDRAW_REQUEST' &&
      typeof c.revision === 'string' &&
      /^[1-9][0-9]{0,14}$/.test(c.revision),
  );
  academicId(c.id);
  return c as AccountRequestCommand;
}
export interface OrdinaryAccountManifest {
  kind: 'ORDINARY_FIRST_PASSWORD';
  evidenceOrigin: 'LOCAL';
  githubActions: false;
  environment: string;
  requestId: string;
  requestDigest: string;
  userId: string;
  expectedUserRevision: '1';
  claimId: string;
  controlApprovalId: string;
  controlCommandId: string;
  controlManifestDigest: string;
  sourceRef: string;
  subjectBindingRef: string;
  recipientDeliveryRef: string;
  operatorRef: 'LOCAL_SYNTHETIC_OPERATOR';
  approverRef: 'LOCAL_SYNTHETIC_APPROVER';
  operatorUserId: string;
  operatorUserRevision: string;
  systemAdminGrantId: string;
  adminGrantRevision: string;
  issuedAt: number;
  expiresAt: number;
  supersedesClaimId: string | null;
}
