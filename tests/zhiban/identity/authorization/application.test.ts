import { describe, expect, it } from 'vitest';
import { IdentityAuthorizer } from '@/lib/zhiban/application/identity/authorize';
import {
  AuthorizationRejected,
  isAuthorizationRejected,
} from '@/lib/zhiban/application/identity/authorization-error';
import type {
  AuthorizationRead,
  AuthorizationRequest,
} from '@/lib/zhiban/application/identity/ports/authorization';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { userId, tenantId, instant } from '@/lib/zhiban/domain/identity';
import { member, id, tenant, time, catalogPort } from './fixtures';

export function readFixture(): AuthorizationRead {
  const a = member(10),
    b = member(20),
    revision = repositoryRevision('1');
  return {
    actor: { value: a, revision },
    target: { value: b, revision },
    globals: {
      tenantId: tenant,
      tenantStatus: 'ACTIVE',
      tenantRevision: revision,
      users: new Map(
        [a, b].map((m) => [m.id, { userId: m.userId, status: 'ACTIVE' as const, revision }]),
      ),
    },
  };
}
export function requestFixture(): AuthorizationRequest {
  return {
    actorUserId: member(10).userId,
    actorMembershipId: member(10).id,
    targetMembershipId: member(20).id,
    context: tenantScopeContext(tenant),
    action: 'ROLE_REVOKE',
    requestId: 'authorization-contract',
  };
}
describe('Application trusted authorization composition', () => {
  it('error reason vocabulary is runtime closed and forged error prototypes carry no provenance', () => {
    const invalid = new AuthorizationRejected('private-driver-material' as never);
    expect(invalid.reason).toBe('INVALID_FACTS');
    expect(JSON.stringify(invalid)).not.toContain('private-driver-material');
    expect(
      isAuthorizationRejected(
        Object.assign(Object.create(AuthorizationRejected.prototype), {
          reason: 'secret',
          cause: new Error('secret'),
        }),
      ),
    ).toBe(false);
    expect(isAuthorizationRejected(invalid)).toBe(true);
  });
  it('loads fresh state for every decision, revoke is immediately visible', async () => {
    let read = readFixture();
    let calls = 0;
    const app = new IdentityAuthorizer(
      {
        read: async () => {
          calls++;
          return read;
        },
      },
      catalogPort(),
      { now: () => time },
    );
    const before = await app.authorize(requestFixture());
    expect(before.decision).toBe('ALLOW');
    read = {
      ...read,
      actor: {
        value: read.actor.value.revokeGrant({
          now: time,
          expectedAuthorizationVersion: 1,
          grantId: read.actor.value.roleGrants[0].id,
        }),
        revision: repositoryRevision('2'),
      },
    };
    expect((await app.authorize(requestFixture())).decision).toBe('DENY');
    expect(calls).toBe(2);
  });
  it.each(['actor', 'tenant', 'association', 'disabled-user', 'disabled-tenant'] as const)(
    '%s cannot forge permission proof',
    async (kind) => {
      const read = readFixture(),
        request = requestFixture();
      if (kind === 'actor')
        (request as { actorUserId: typeof request.actorUserId }).actorUserId = userId(id(999));
      if (kind === 'tenant')
        (request as { context: typeof request.context }).context = tenantScopeContext(
          tenantId(id(2)),
        );
      const users = new Map(read.globals.users);
      if (kind === 'association')
        users.set(read.actor.value.id, {
          userId: userId(id(999)),
          status: 'ACTIVE',
          revision: repositoryRevision('1'),
        });
      if (kind === 'disabled-user')
        users.set(read.actor.value.id, {
          userId: read.actor.value.userId,
          status: 'DISABLED',
          revision: repositoryRevision('1'),
        });
      const app = new IdentityAuthorizer(
        {
          read: async () => ({
            ...read,
            globals: {
              ...read.globals,
              users,
              tenantStatus: kind === 'disabled-tenant' ? 'DISABLED' : 'ACTIVE',
            },
          }),
        },
        catalogPort(),
        { now: () => time },
      );
      expect((await app.authorize(request)).decision).toBe('DENY');
    },
  );
  it('storage/catalog exceptions return only closed denial, never driver diagnostics', async () => {
    for (const failed of ['state', 'catalog']) {
      const app = new IdentityAuthorizer(
        {
          read: async () => {
            if (failed === 'state')
              throw Object.assign(new Error('sensitive SQL'), { code: 'secret' });
            return readFixture();
          },
        },
        {
          load: async () => {
            if (failed === 'catalog') throw new Error('secret');
            return catalogPort().load();
          },
        },
        { now: () => time },
      );
      expect(await app.authorize(requestFixture())).toEqual({
        decision: 'DENY',
        reason: 'STORAGE_UNAVAILABLE',
      });
    }
  });
  it('copies the request before asynchronous reads and freezes minimal receipt', async () => {
    const input = requestFixture();
    const app = new IdentityAuthorizer(
      {
        read: async () => {
          (input as { actorUserId: typeof input.actorUserId }).actorUserId = userId(id(999));
          return readFixture();
        },
      },
      catalogPort(),
      { now: () => time },
    );
    const result = await app.authorize(input);
    expect(result.decision).toBe('ALLOW');
    if (result.decision === 'ALLOW') {
      expect(result.receipt.request.actorUserId).toBe(member(10).userId);
      expect(Object.isFrozen(result.receipt)).toBe(true);
      expect(Object.isFrozen(result.receipt.request)).toBe(true);
      expect(result.receipt.decision.evaluatedAt).toBe(time);
    }
  });
  it('uses trusted current time after storage awaits; grant may expire while reading', async () => {
    const read = readFixture(),
      app = new IdentityAuthorizer({ read: async () => read }, catalogPort(), {
        now: () => instant(0),
      });
    expect((await app.authorize(requestFixture())).decision).toBe('DENY');
  });
  it('unknown action and incomplete catalog deny without fallback', async () => {
    const bad = await catalogPort().load();
    const app = new IdentityAuthorizer(
      { read: async () => readFixture() },
      {
        load: async () => ({
          ...bad,
          snapshot: { ...bad.snapshot, roles: bad.snapshot.roles.slice(1) },
        }),
      },
      { now: () => time },
    );
    expect((await app.authorize(requestFixture())).decision).toBe('DENY');
    expect(await app.authorize({ ...requestFixture(), action: 'SYSTEM_ADMIN' as never })).toEqual({
      decision: 'DENY',
      reason: 'UNSUPPORTED_ACTION',
    });
  });
});
