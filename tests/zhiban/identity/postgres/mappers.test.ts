import { describe, expect, it } from 'vitest';
import { User, Tenant, Membership, SystemAdminGrant, instant, userId, tenantId, membershipId, systemAdminGrantId } from '@/lib/zhiban/domain/identity';
import { userFromRow, userToRow, type UserRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/user';
import { tenantFromRow, tenantToRow, type TenantRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/tenant';
import { systemAdminGrantFromRow, systemAdminGrantToRow, type SystemAdminGrantRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/system-admin-grant';
import { membershipFromRows, membershipToRows, type MembershipRow, type RoleGrantRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/membership';

const uid = '018f0000-0000-7000-8000-000000000001';
const tid = '018f0000-0000-7000-8000-000000000002';
const mid = '018f0000-0000-7000-8000-000000000003';
const gid = '018f0000-0000-7000-8000-000000000004';
function user(): UserRow {
  return { user_id: uid, status: 'ACTIVE', created_at: '1000', updated_at: '1000', disabled_at: null, disabled_reason: null, repository_revision: '1' };
}
function tenant(): TenantRow {
  return { tenant_id: tid, code: 'test-tenant', display_name: ' Test Tenant ', status: 'ACTIVE', created_at: '1000', updated_at: '1000', disabled_at: null, disabled_reason: null, repository_revision: '1' };
}
function admin(): SystemAdminGrantRow {
  return { grant_id: gid, user_id: uid, created_at: '1000', valid_from: '1000', valid_until: null, revoked_at: null, repository_revision: '1' };
}
function parent(): MembershipRow {
  return { membership_id: mid, user_id: uid, tenant_id: tid, status: 'ACTIVE', authorization_version: '0', created_at: '1000', updated_at: '10000', disabled_at: null, disabled_reason: null, repository_revision: '1' };
}
function child(index = 0): RoleGrantRow {
  return { grant_id: `018f0000-0000-7000-8000-${(index + 10).toString().padStart(12, '0')}`, tenant_id: tid, membership_id: mid, grant_ordinal: BigInt(index).toString(), role_code: 'STUDENT', scope_kind: 'SELF', scope_id: null, created_at: '1000', valid_from: '1000', valid_until: null, revoked_at: null };
}

describe('PostgreSQL identity mapper runtime boundary', () => {
  it('MAP01 authentic User roundtrip and immutable metadata separation', () => {
    const original = User.create(userId(uid), instant(1000));
    const loaded = userFromRow({ ...userToRow(original), repository_revision: '1' });
    expect(loaded.value).toEqual(original);
    expect(loaded.value.disable(instant(2000), 'review').status).toBe('DISABLED');
    expect(Object.isFrozen(loaded.value)).toBe(true);
    expect(Object.keys(loaded.value)).not.toContain('repositoryRevision');
  });
  it('MAP02 Tenant roundtrip preserves exact text and authentic commands', () => {
    const loaded = tenantFromRow(tenant());
    expect(loaded.value.displayName).toBe(' Test Tenant ');
    expect(tenantFromRow({ ...tenantToRow(loaded.value), repository_revision: '1' }).value).toEqual(loaded.value);
    expect(loaded.value.archive(instant(2000)).status).toBe('ARCHIVED');
    const fresh = Tenant.create(tenantId(tid), 'test-tenant', 'Test Tenant', instant(1000));
    expect(tenantFromRow({ ...tenantToRow(fresh), repository_revision: '1' }).value).toEqual(fresh);
  });
  it('MAP03 SystemAdminGrant active/revoked roundtrip remains global', () => {
    const fresh = SystemAdminGrant.create({ id: systemAdminGrantId(gid), userId: userId(uid), createdAt: instant(1000), validFrom: instant(1000), validUntil: null });
    const loaded = systemAdminGrantFromRow({ ...systemAdminGrantToRow(fresh), repository_revision: '1' });
    expect(loaded.value).toEqual(fresh);
    const revoked = loaded.value.revoke(instant(2000));
    expect(systemAdminGrantFromRow({ ...systemAdminGrantToRow(revoked), repository_revision: '2' }).value).toEqual(revoked);
    for (const field of ['tenantId', 'membershipId', 'scope']) expect(Object.keys(loaded.value)).not.toContain(field);
  });
  it('MAP04 Membership zero child', () => {
    expect(membershipFromRows(parent(), []).value.roleGrants).toEqual([]);
  });
  it('MAP05 Membership one authentic child', () => {
    const grant = membershipFromRows(parent(), [child()]).value.roleGrants[0];
    expect(grant.revoke(instant(2000)).revokedAt).toBe(2000);
    expect(Object.keys(grant)).not.toContain('grantOrdinal');
  });
  it('MAP06/MAP07 unsorted multiple rows preserve active/future/expired/revoked history', () => {
    const rows = [child(0), { ...child(1), valid_from: '20000' }, { ...child(2), valid_until: '2000' }, { ...child(3), revoked_at: '3000' }];
    const aggregate = membershipFromRows(parent(), [rows[3], rows[1], rows[0], rows[2]]).value;
    expect(aggregate.roleGrants.map(grant => grant.id)).toEqual(rows.map(row => row.grant_id));
    expect(aggregate.roleGrants).toHaveLength(4);
    expect(aggregate.roleGrants.map(grant => grant.isEffectiveAt(instant(10000)))).toEqual([true, false, false, false]);
    expect(Object.isFrozen(aggregate.roleGrants)).toBe(true);
    const write = membershipToRows(aggregate);
    expect(write.roleGrants).toEqual(rows);
    expect(membershipFromRows({ ...write.membership, repository_revision: '1' }, write.roleGrants).value).toEqual(aggregate);
  });
  it.each(['PENDING', 'ACTIVE', 'DISABLED', 'LEFT'])('historical Membership %s', status => {
    const row = { ...parent(), status, disabled_at: status === 'DISABLED' ? '5000' : null, disabled_reason: status === 'DISABLED' ? ' preserved reason ' : null };
    const loaded = membershipFromRows(row, [child()]);
    expect(loaded.value.status).toBe(status);
    const { repository_revision: _revision, ...state } = row;
    expect(membershipToRows(loaded.value).membership).toEqual(state);
  });
  it.each(['membership_id', 'tenant_id'] as const)('MAP08 wrong child %s', field => {
    expect(() => membershipFromRows(parent(), [{ ...child(), [field]: gid }])).toThrow();
  });
  it.each(['-1', '01', '1.0', '9223372036854775808', '1', '9007199254740992'])('ordinal %s fails closed (noncanonical, overflow or non-contiguous)', grant_ordinal => {
    expect(() => membershipFromRows(parent(), [{ ...child(), grant_ordinal }])).toThrow();
  });
  it('duplicate ordinal and duplicate grant identity fail closed; input not mutated', () => {
    const input = [child(), child()];
    const before = structuredClone(input);
    expect(() => membershipFromRows(parent(), input)).toThrow();
    expect(input).toEqual(before);
    expect(() => membershipFromRows(parent(), [child(), { ...child(1), grant_id: child().grant_id }])).toThrow();
  });
  it.each(['invalid', '018f0000-0000-4000-8000-000000000001', uid.toUpperCase()])('MAP09 invalid/case UUID %s', user_id => {
    expect(() => userFromRow({ ...user(), user_id })).toThrow();
  });
  it('MAP09 invalid status/role/scope and disabled shape fail closed', () => {
    expect(() => userFromRow({ ...user(), status: 'UNKNOWN' })).toThrow();
    expect(() => tenantFromRow({ ...tenant(), status: 'UNKNOWN' })).toThrow();
    expect(() => membershipFromRows({ ...parent(), status: 'UNKNOWN' }, [])).toThrow();
    expect(() => membershipFromRows(parent(), [{ ...child(), role_code: 'SYSTEM_ADMIN' }])).toThrow();
    expect(() => membershipFromRows(parent(), [{ ...child(), scope_kind: 'UNKNOWN' }])).toThrow();
    expect(() => membershipFromRows(parent(), [{ ...child(), scope_id: gid }])).toThrow();
    expect(() => userFromRow({ ...user(), disabled_reason: '' })).toThrow();
  });
  it.each(['1', '9223372036854775807'])('MAP10 revision %s preserved as string across all aggregates', repository_revision => {
    expect(userFromRow({ ...user(), repository_revision }).revision).toBe(repository_revision);
    expect(tenantFromRow({ ...tenant(), repository_revision }).revision).toBe(repository_revision);
    expect(systemAdminGrantFromRow({ ...admin(), repository_revision }).revision).toBe(repository_revision);
    expect(membershipFromRows({ ...parent(), repository_revision }, []).revision).toBe(repository_revision);
  });
  it.each(['0', '-1', '+1', '01', '1.0', ' 1', '1 ', '1\n', '', 'fake-1', '1e3', '9223372036854775808'])('MAP11 malformed revision %j', repository_revision => {
    expect(() => userFromRow({ ...user(), repository_revision })).toThrow();
    expect(() => membershipFromRows({ ...parent(), repository_revision }, [])).toThrow();
  });
  it.each(['0', '9007199254740991'])('MAP12 authVersion %s safely mapped', authorization_version => {
    expect(membershipFromRows({ ...parent(), authorization_version }, []).value.authorizationVersion).toBe(Number(authorization_version));
  });
  it.each(['-1', '+1', '01', '1.0', '1e3', ' 1', '1\n', '9007199254740992'])('MAP13 authVersion %j rejected', authorization_version => {
    expect(() => membershipFromRows({ ...parent(), authorization_version }, [])).toThrow();
  });
  it.each(['0', '8640000000000000'])('MAP14 Instant boundary %s', time => {
    expect(userFromRow({ ...user(), created_at: time, updated_at: time }).value.createdAt).toBe(Number(time));
  });
  it.each(['-1', '01', '1.1', '1e3', '8640000000000001'])('MAP14 invalid Instant %s', created_at => {
    expect(() => userFromRow({ ...user(), created_at })).toThrow();
  });
  it('MAP14 NULL, missing, undefined, number and accessor are never silently normalized', () => {
    expect(userFromRow(user()).value.disabledAt).toBeNull();
    for (const value of [undefined, '', 0, false]) {
      expect(() => userFromRow({ ...user(), disabled_at: value } as unknown as UserRow)).toThrow();
    }
    const { disabled_at: _disabled, ...missing } = user();
    expect(() => userFromRow(missing as UserRow)).toThrow();
    let reads = 0;
    const accessor = Object.defineProperty(user(), 'created_at', { get() { reads++; return '1000'; } });
    expect(() => userFromRow(accessor)).toThrow();
    expect(reads).toBe(0);
    expect(() => userFromRow({ ...user(), repository_revision: 1 } as unknown as UserRow)).toThrow();
    expect(() => userFromRow({ ...user(), extra: true } as UserRow)).toThrow();
  });
  it('MAP15 complete explicit write projections omit revisions and preserve lifecycle facts', () => {
    const disabled = userFromRow({ ...user(), status: 'DISABLED', updated_at: '2000', disabled_at: '2000', disabled_reason: ' reason ' }).value;
    expect(userToRow(disabled)).toEqual({ user_id: uid, status: 'DISABLED', created_at: '1000', updated_at: '2000', disabled_at: '2000', disabled_reason: ' reason ' });
    const archived = tenantFromRow({ ...tenant(), status: 'ARCHIVED', updated_at: '2000' }).value;
    expect(tenantToRow(archived)).toMatchObject({ status: 'ARCHIVED', disabled_at: null, disabled_reason: null });
    expect(Object.keys(userToRow(disabled))).not.toContain('repository_revision');
    expect(Object.keys(membershipToRows(membershipFromRows(parent(), []).value).membership)).not.toContain('repository_revision');
  });
  it('tenant disabled and archived-with-disabled-history roundtrips preserve exact facts', () => {
    for (const status of ['DISABLED', 'ARCHIVED']) {
      const row = { ...tenant(), status, updated_at: '3000', disabled_at: '2000', disabled_reason: ' exact reason ' };
      const { repository_revision: _revision, ...expected } = row;
      expect(tenantToRow(tenantFromRow(row).value)).toEqual(expected);
    }
  });
  it.each(['SELF', 'TENANT', 'CLASS', 'COURSE'])('complete scope %s is retained, not normalized', scope_kind => {
    const row = { ...child(), scope_kind, scope_id: scope_kind === 'SELF' || scope_kind === 'TENANT' ? null : gid };
    const write = membershipToRows(membershipFromRows(parent(), [row]).value);
    expect(write.roleGrants).toEqual([row]);
  });
  it('revoked future history is preserved, and malformed grant invariants reject', () => {
    const row = { ...child(), valid_from: '20000', revoked_at: '3000' };
    expect(membershipToRows(membershipFromRows(parent(), [row]).value).roleGrants).toEqual([row]);
    expect(() => membershipFromRows(parent(), [{ ...child(), created_at: '11000', valid_from: '11000' }])).toThrow();
    expect(() => membershipFromRows(parent(), [{ ...child(), revoked_at: '11000' }])).toThrow();
    expect(() => membershipFromRows(parent(), [{ ...child(), valid_until: '1000' }])).toThrow();
    expect(() => systemAdminGrantFromRow({ ...admin(), revoked_at: '999' })).toThrow();
  });
  it('numeric driver overrides and damaged child collection fail closed', () => {
    expect(() => membershipFromRows({ ...parent(), authorization_version: 0 } as unknown as MembershipRow, [])).toThrow();
    expect(() => membershipFromRows(parent(), undefined as unknown as RoleGrantRow[])).toThrow();
    expect(() => membershipFromRows(parent(), [undefined] as unknown as RoleGrantRow[])).toThrow();
    expect(() => userFromRow({ ...user(), created_at: 1000 } as unknown as UserRow)).toThrow();
    expect(() => membershipFromRows(parent(), [{ ...child(), scope_id: undefined } as unknown as RoleGrantRow])).toThrow();
  });
  it.each(['text\uD800', 'text\uDC00', 'text\u0000'])('unrepresentable PostgreSQL text %j is rejected on read', text => {
    expect(() => tenantFromRow({ ...tenant(), display_name: text })).toThrow();
    expect(() => userFromRow({ ...user(), status: 'DISABLED', disabled_at: '1000', disabled_reason: text })).toThrow();
    expect(() => membershipFromRows({ ...parent(), status: 'DISABLED', disabled_at: '1000', disabled_reason: text }, [])).toThrow();
  });
  it.each(['text\uD800', 'text\uDC00', 'text\u0000'])('write projection rejects text %j rather than allowing driver replacement', text => {
    const tenantValue = Tenant.create(tenantId(tid), 'test', text, instant(1000));
    const userValue = User.create(userId(uid), instant(1000)).disable(instant(2000), text);
    const memberValue = Membership.create({ id: membershipId(mid), userId: userId(uid), tenantId: tenantId(tid), now: instant(1000) })
      .disable({ now: instant(2000), expectedAuthorizationVersion: 0, reason: text });
    expect(() => tenantToRow(tenantValue)).toThrow();
    expect(() => userToRow(userValue)).toThrow();
    expect(() => membershipToRows(memberValue)).toThrow();
  });
  it('well-formed multilingual text and surrogate pairs roundtrip without normalization', () => {
    const text = ' 中文 é e\u0301 😀 ';
    const value = tenantFromRow({ ...tenant(), display_name: text }).value;
    const row = tenantToRow(value);
    expect(row.display_name).toBe(text);
    expect(tenantFromRow({ ...row, repository_revision: '1' }).value.displayName).toBe(text);
  });
});
