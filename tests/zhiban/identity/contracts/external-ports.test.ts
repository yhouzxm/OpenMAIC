import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  sessionId,
  tokenDigest,
  roleCatalogSnapshot,
  type CredentialVerificationResult,
  type IdGeneratorPort,
  type IdentityAuditEvent,
  type RoleCatalogSnapshot,
  type SessionRecord,
} from '@/lib/zhiban/application/identity/ports';
import {
  Role,
  instant,
  permission,
  roleId,
  userId,
  type RoleCode,
  type UserId,
} from '@/lib/zhiban/domain/identity';
import {
  FakeClock,
  FakeCredentialVerifier,
  FakeIdGenerator,
  FakeRoleCatalog,
  FakeSessionRepository,
} from './fakes';

const NOW = instant(Date.parse('2026-09-22T12:00:00.000Z'));
const LATER = instant(NOW + 1_000);
const USER = userId('01996e82-5800-7000-8000-000000000003');
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

describe('external identity ports', () => {
  it('catalog contains only controlled tenant roles and version is separate metadata', async () => {
    const codes: readonly RoleCode[] = ['STUDENT', 'TEACHER', 'TENANT_ADMIN'];
    const roles = codes.map((code, index) =>
      Role.create(
        roleId(`01996e82-5800-7000-8000-${(index + 10).toString().padStart(12, '0')}`),
        code,
        [permission('tenant:manage')],
      ),
    );
    const catalog = new FakeRoleCatalog(roleCatalogSnapshot('catalog-1', roles));
    const snapshot = await catalog.snapshot();
    expect(snapshot.version).toBe('catalog-1');
    expect(snapshot.roles.map((role) => role.code)).toEqual(codes);
    expect(snapshot.roles.some((role) => String(role.code) === 'SYSTEM_ADMIN')).toBe(false);
    expect((await catalog.findByCode('TEACHER'))?.code).toBe('TEACHER');
    expectTypeOf<'SYSTEM_ADMIN' extends RoleCode ? true : false>().toEqualTypeOf<false>();
    expect(() => roleCatalogSnapshot(' ', roles)).toThrow();
    expect(() => roleCatalogSnapshot('v1', [])).toThrow();
    for (const code of codes) {
      expect(() =>
        roleCatalogSnapshot(
          'v1',
          roles.filter((role) => role.code !== code),
        ),
      ).toThrow();
    }
    expect(() => roleCatalogSnapshot('v1', [roles[0], roles[0], roles[1]])).toThrow();
    expect(
      roleCatalogSnapshot('v1', [roles[2], roles[0], roles[1]]).roles.map((r) => r.code),
    ).toEqual(codes);
    for (const malformed of [
      { version: '', roles },
      { version: 'v1', roles: roles.slice(0, 2) },
      { version: 'v1', roles: [roles[0], roles[0], roles[1]] },
    ]) {
      expect(() => new FakeRoleCatalog(malformed as unknown as RoleCatalogSnapshot)).toThrow();
    }
  });

  it('credential failure has one result shape for unknown user and wrong secret', async () => {
    const verifier = new FakeCredentialVerifier(USER, 'synthetic-secret');
    expect(
      await verifier.verifyCredential({ identifier: 'absent', secret: 'synthetic-secret' }),
    ).toEqual({ status: 'REJECTED' });
    expect(await verifier.verifyCredential({ identifier: 'known', secret: 'wrong' })).toEqual({
      status: 'REJECTED',
    });
    const success: CredentialVerificationResult = await verifier.verifyCredential({
      identifier: 'known',
      secret: 'synthetic-secret',
    });
    expect(success).toEqual({ status: 'VERIFIED', userId: USER });
    expect(Object.keys(success).sort()).toEqual(['status', 'userId']);
    expectTypeOf<
      Extract<CredentialVerificationResult, { status: 'VERIFIED' }>['userId']
    >().toEqualTypeOf<UserId>();
  });

  it('session binds only global User, supports touch and one/all revocation', async () => {
    const repo = new FakeSessionRepository();
    const record: SessionRecord = {
      id: sessionId('session-1'),
      userId: USER,
      tokenDigest: tokenDigest('digest-1'),
      createdAt: NOW,
      lastSeenAt: NOW,
      absoluteExpiresAt: instant(NOW + 8 * 3_600_000),
      idleExpiresAt: instant(NOW + 30 * 60_000),
      revokedAt: null,
    };
    const second: SessionRecord = {
      ...record,
      id: sessionId('session-2'),
      tokenDigest: tokenDigest('digest-2'),
    };
    const firstLoaded = await repo.create(record);
    await repo.create(second);
    expect((await repo.findByDigest(record.tokenDigest))?.value.userId).toBe(USER);
    expect(Object.keys(record).sort()).toEqual([
      'absoluteExpiresAt',
      'createdAt',
      'id',
      'idleExpiresAt',
      'lastSeenAt',
      'revokedAt',
      'tokenDigest',
      'userId',
    ]);
    expectTypeOf<HasKey<SessionRecord, 'roles'>>().toEqualTypeOf<false>();
    expectTypeOf<HasKey<SessionRecord, 'permissions'>>().toEqualTypeOf<false>();
    expectTypeOf<HasKey<SessionRecord, 'activeTenant'>>().toEqualTypeOf<false>();
    expectTypeOf<HasKey<SessionRecord, 'rawToken'>>().toEqualTypeOf<false>();
    const touched = await repo.touch(
      record.id,
      LATER,
      instant(LATER + 30 * 60_000),
      firstLoaded.revision,
    );
    expect(touched?.value.lastSeenAt).toBe(LATER);
    await repo.revoke(record.id, LATER);
    expect((await repo.findByDigest(record.tokenDigest))?.value.revokedAt).toBe(LATER);
    await repo.revokeAllForUser(USER, LATER);
    expect((await repo.findByDigest(second.tokenDigest))?.value.revokedAt).toBe(LATER);
  });

  it('stale touch never revives a revoked session and revoke wins both orderings', async () => {
    const repo = new FakeSessionRepository();
    const record: SessionRecord = {
      id: sessionId('session-race'),
      userId: USER,
      tokenDigest: tokenDigest('digest-race'),
      createdAt: NOW,
      lastSeenAt: NOW,
      absoluteExpiresAt: instant(NOW + 8 * 3_600_000),
      idleExpiresAt: instant(NOW + 30 * 60_000),
      revokedAt: null,
    };
    const first = await repo.create(record);
    await repo.revoke(record.id, LATER);
    await expect(
      repo.touch(record.id, LATER, instant(LATER + 30 * 60_000), first.revision),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });
    const revoked = await repo.findByDigest(record.tokenDigest);
    expect(revoked?.value.revokedAt).toBe(LATER);
    expect(
      await repo.touch(record.id, LATER, instant(LATER + 30 * 60_000), revoked!.revision),
    ).toBeNull();
    expect((await repo.findByDigest(record.tokenDigest))?.value.lastSeenAt).toBe(NOW);
    await repo.revoke(record.id, instant(LATER + 1));
    expect((await repo.findByDigest(record.tokenDigest))?.value.revokedAt).toBe(LATER);

    const second: SessionRecord = {
      ...record,
      id: sessionId('session-touch-first'),
      tokenDigest: tokenDigest('digest-touch-first'),
    };
    const created = await repo.create(second);
    const touched = await repo.touch(
      second.id,
      LATER,
      instant(LATER + 30 * 60_000),
      created.revision,
    );
    expect(touched?.value.lastSeenAt).toBe(LATER);
    await repo.revoke(second.id, instant(LATER + 1));
    expect((await repo.findByDigest(second.tokenDigest))?.value.revokedAt).toBe(LATER + 1);
    await repo.revokeAllForUser(USER, instant(LATER + 2));
    await expect(
      repo.touch(second.id, LATER, instant(LATER + 30 * 60_000), touched!.revision),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect((await repo.findByDigest(second.tokenDigest))?.value.revokedAt).toBe(LATER + 1);
  });

  it('revokeAllForUser invalidates an active session before a stale touch', async () => {
    const repo = new FakeSessionRepository();
    const record: SessionRecord = {
      id: sessionId('session-batch-revoke'),
      userId: USER,
      tokenDigest: tokenDigest('digest-batch-revoke'),
      createdAt: NOW,
      lastSeenAt: NOW,
      absoluteExpiresAt: instant(NOW + 8 * 3_600_000),
      idleExpiresAt: instant(NOW + 30 * 60_000),
      revokedAt: null,
    };
    const loaded = await repo.create(record);
    expect(loaded.value.revokedAt).toBeNull();

    await repo.revokeAllForUser(USER, LATER);
    const revoked = await repo.findByDigest(record.tokenDigest);
    expect(revoked?.value.revokedAt).toBe(LATER);
    expect(revoked?.revision).not.toBe(loaded.revision);

    await expect(
      repo.touch(record.id, LATER, instant(LATER + 30 * 60_000), loaded.revision),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });
    const afterStaleTouch = await repo.findByDigest(record.tokenDigest);
    expect(afterStaleTouch?.value.revokedAt).toBe(LATER);
    expect(afterStaleTouch?.value.lastSeenAt).toBe(NOW);
    expect(afterStaleTouch?.revision).toBe(revoked?.revision);
  });

  it('fixed clock and typed identity-only IDs', () => {
    expect(new FakeClock(NOW).now()).toBe(NOW);
    const ids: IdGeneratorPort = new FakeIdGenerator();
    expect(ids.nextUserId()).toMatch(/-7/);
    expect(ids.nextTenantId()).toMatch(/-7/);
    expect(ids.nextMembershipId()).toMatch(/-7/);
    expect(ids.nextRoleId()).toMatch(/-7/);
    expect(ids.nextRoleGrantId()).toMatch(/-7/);
    expect(ids.nextSystemAdminGrantId()).toMatch(/-7/);
    expectTypeOf<HasKey<IdGeneratorPort, 'nextClassId'>>().toEqualTypeOf<false>();
    expectTypeOf<HasKey<IdGeneratorPort, 'nextCourseId'>>().toEqualTypeOf<false>();
    expectTypeOf<HasKey<IdentityAuditEvent, 'secret'>>().toEqualTypeOf<false>();
    expectTypeOf<HasKey<IdentityAuditEvent, 'tokenDigest'>>().toEqualTypeOf<false>();
  });
});
