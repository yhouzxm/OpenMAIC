import { describe, expect, it } from 'vitest';
import { setup, login, request, id, mid, tid, secret } from './fixtures';
import { actions } from '@/lib/zhiban/infrastructure/identity/http/dto';
const envelope = {
  actorMembershipId: mid,
  expectedActorRevision: '1',
  expectedActorAuthorizationVersion: 1,
  expectedTenantRevision: '1',
};
const grant = { roleCode: 'STUDENT', scope: { type: 'SELF', scopeId: null }, validUntil: null };
const base = {
  ...envelope,
  expectedRevision: '1',
  expectedAuthorizationVersion: 1,
  password: secret,
};
function point(member = mid, user: string = id) {
  return {
    tenantId: tid,
    membershipId: member,
    userId: user,
    status: 'ACTIVE',
    revision: '1',
    authorizationVersion: 1,
    actorRevision: '1',
    actorAuthorizationVersion: 1,
    tenantRevision: '1',
    grants: [],
    nextGrantCursor: null,
    consent: null,
  };
}
async function prepared() {
  const e = setup();
  e.queries.member.mockImplementation(
    async (_h?: unknown, q?: { membershipId: string }) => point(q?.membershipId) as never,
  );
  return { e, h: await login(e) };
}
describe('D8 fixed member DTO and server-derived identity', () => {
  it.each(Object.keys(actions))(
    'route %s has a single fixed action and closed target',
    async (command) => {
      const { e, h } = await prepared();
      const extra =
        command === 'activate' || command === 'rejoin'
          ? { admissionId: id, consentId: id, grants: [] }
          : command === 'reactivate'
            ? {
                admissionId: id,
                consentId: id,
                mode: 'PRESERVE_EXISTING_VALID_GRANTS',
                preserveGrantIds: [],
              }
            : command === 'disable'
              ? { reason: 'ADMIN_REQUEST' }
              : command === 'grant'
                ? { grant }
                : command === 'revoke-grant'
                  ? { revokeGrantId: id }
                  : command === 'replace-grants'
                    ? { grants: [] }
                    : {};
      const r = await e.facade.handle(
        request(
          `tenants/${tid}/memberships/${mid}/${command}`,
          'POST',
          { ...base, ...extra },
          { ...h, 'Idempotency-Key': 'synthetic-command' },
        ),
      );
      expect(r.status).toBe(200);
      const saved = e.members.execute.mock.calls[0] as unknown as [
        unknown,
        { action: string; targets: { userId: string; action: string }[]; requestId: string },
      ];
      expect(saved[1].action).toBe(actions[command as keyof typeof actions]);
      expect(saved[1].targets[0].userId).toBe(id);
      expect(saved[1].targets[0].action).toBe(saved[1].action);
      expect(saved[1].requestId).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
  it.each([
    'actorUserId',
    'tenantId',
    'userId',
    'requestId',
    'approved',
    'role',
    'relationship',
    'permission',
    'sessionId',
    'securityEpoch',
  ])('forbidden browser field %s cannot be authority', async (field) => {
    const { e, h } = await prepared();
    expect(
      (
        await e.facade.handle(
          request(
            `tenants/${tid}/memberships/${mid}/leave`,
            'POST',
            { ...base, [field]: id },
            { ...h, 'Idempotency-Key': 'synthetic' },
          ),
        )
      ).status,
    ).toBe(400);
    expect(e.members.execute).not.toHaveBeenCalled();
  });
  it.each(['SYSTEM_ADMIN', 'UNKNOWN'])(
    'forbidden role %s never reaches a grant write',
    async (roleCode) => {
      const { e, h } = await prepared();
      expect(
        (
          await e.facade.handle(
            request(
              `tenants/${tid}/memberships/${mid}/grant`,
              'POST',
              { ...base, grant: { ...grant, roleCode } },
              { ...h, 'Idempotency-Key': 'synthetic' },
            ),
          )
        ).status,
      ).toBe(400);
      expect(e.members.execute).not.toHaveBeenCalled();
    },
  );
  it('foreign stale metadata stays404 before any version conflict', async () => {
    const e = setup(),
      h = await login(e);
    expect(
      (
        await e.facade.handle(
          request(
            `tenants/${tid}/memberships/${mid}/leave`,
            'POST',
            { ...base, expectedRevision: '99' },
            { ...h, 'Idempotency-Key': 'synthetic' },
          ),
        )
      ).status,
    ).toBe(404);
    expect(e.members.execute).not.toHaveBeenCalled();
  });
  it('atomic transfer binds two persisted Users and calls one atomic composition', async () => {
    const { e, h } = await prepared(),
      other = '01960000-0000-7000-8000-000000000010',
      subject = '01960000-0000-7000-8000-000000000011';
    e.queries.member.mockImplementation(
      async (_h?: unknown, q?: { membershipId: string }) =>
        point(q?.membershipId, q?.membershipId === other ? subject : id) as never,
    );
    const targets = [
      {
        membershipId: mid,
        userId: id,
        action: 'MEMBERSHIP_LEAVE_ADMIN',
        expectedRevision: '1',
        expectedAuthorizationVersion: 1,
      },
      {
        membershipId: other,
        userId: subject,
        action: 'ROLE_GRANT',
        expectedRevision: '1',
        expectedAuthorizationVersion: 1,
        grant,
      },
    ];
    const r = await e.facade.handle(
      request(
        `tenants/${tid}/admin-transfer`,
        'POST',
        { ...envelope, password: secret, targets },
        { ...h, 'Idempotency-Key': 'synthetic' },
      ),
    );
    expect(r.status).toBe(200);
    expect(e.members.execute).toHaveBeenCalledTimes(1);
    const saved = e.members.execute.mock.calls[0] as unknown as [
      unknown,
      { action: string; targets: unknown[] },
    ];
    expect(saved[1].action).toBe('MEMBERSHIP_ATOMIC_TRANSFER');
    expect(saved[1].targets).toHaveLength(2);
  });
  it('malformed cursor is client400, not guessed provider503', async () => {
    const { e, h } = await prepared();
    expect(
      (await e.facade.handle(request('spaces?afterMembershipId=invalid', 'GET', undefined, h)))
        .status,
    ).toBe(400);
    expect(e.application.spaces).not.toHaveBeenCalled();
  });
});
