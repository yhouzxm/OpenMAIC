import { describe, expect, it } from 'vitest';
import { privilegedCapabilityViolations, type ModuleSources } from './privileged-capability-guard';


const membershipMapper = 'lib/zhiban/infrastructure/identity/postgres/mappers/fixture-membership.ts';
// In-memory source only: no production mapper file or runtime import allowlist.
const membershipFixture = String.raw`import { instant } from '@/lib/zhiban/domain/identity/time';
import { userId, tenantId, systemAdminGrantId, membershipId, roleGrantId } from '@/lib/zhiban/domain/identity/ids';
import { repositoryRevision, type Loaded } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { User, Tenant, SystemAdminGrant, Membership } from '@/lib/zhiban/domain/identity';
function epoch(value: unknown) {
 if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$(?![\s\S])/.test(value)) throw new Error('invalid epoch');
 const parsed = BigInt(value);
 if (parsed > 8640000000000000n) throw new Error('out-of-range epoch');
 return instant(Number(parsed));
}
import { rehydrateMembershipForPersistence, rehydrateRoleGrantForPersistence } from '@/lib/zhiban/domain/identity/persistence-rehydration';
import { roleCode } from '@/lib/zhiban/domain/identity/role';
import { parseScope } from '@/lib/zhiban/domain/identity/scope';
const membershipFields = ['membership_id','user_id','tenant_id','status','authorization_version','created_at','updated_at','disabled_at','disabled_reason','repository_revision'];
const childFields = ['grant_id','tenant_id','membership_id','grant_ordinal','role_code','scope_kind','scope_id','created_at','valid_from','valid_until','revoked_at'];
function rowRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
 if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid row');
 const prototype = Object.getPrototypeOf(value);
 if (prototype !== Object.prototype && prototype !== null) throw new Error('invalid row prototype');
 const keys = Reflect.ownKeys(value);
 if (keys.length !== fields.length || !fields.every(field => keys.includes(field))) throw new Error('row projection drift');
 const result: Record<string, unknown> = {};
 for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(value, field); if (!descriptor || !('value' in descriptor)) throw new Error('accessor row'); result[field] = descriptor.value; }
 return Object.freeze(result);
}
function nonnegative(value: unknown, maximum: bigint): bigint {
 if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$(?![\s\S])/.test(value)) throw new Error('invalid bigint');
 const parsed = BigInt(value); if (parsed > maximum) throw new Error('bigint overflow'); return parsed;
}
function authVersion(value: unknown): number { return Number(nonnegative(value, 9007199254740991n)); }
function nullableEpoch(value: unknown) { return value === null ? null : epoch(value); }
function roleGrantFromRow(row: Record<string, unknown>) {
 const snapshot = { id: roleGrantId(row.grant_id), roleCode: roleCode(row.role_code), scope: parseScope(row.scope_kind, row.scope_id), createdAt: epoch(row.created_at), validFrom: epoch(row.valid_from), validUntil: nullableEpoch(row.valid_until), revokedAt: nullableEpoch(row.revoked_at) };
 return rehydrateRoleGrantForPersistence(snapshot);
}
export function membershipFromRows(membershipInput: unknown, childInput: unknown): Loaded<Membership> {
 const row = rowRecord(membershipInput, membershipFields);
 if (!Array.isArray(childInput)) throw new Error('child collection required');
 const children = Array.from(childInput).map(child => rowRecord(child, childFields));
 const ordered = children.map(child => ({ row: child, ordinal: nonnegative(child.grant_ordinal, 9223372036854775807n) })).sort((a,b) => a.ordinal < b.ordinal ? -1 : a.ordinal > b.ordinal ? 1 : 0);
 const parentId = membershipId(row.membership_id); const tenant = tenantId(row.tenant_id);
 for (let index = 0; index < ordered.length; index++) { const entry = ordered[index]; if (entry.ordinal !== BigInt(index) || membershipId(entry.row.membership_id) !== parentId || tenantId(entry.row.tenant_id) !== tenant) throw new Error('child order or parent drift'); }
 const roleGrants = ordered.map(entry => roleGrantFromRow(entry.row));
 const snapshot = { id: parentId, userId: userId(row.user_id), tenantId: tenant, status: row.status, roleGrants, authorizationVersion: authVersion(row.authorization_version), createdAt: epoch(row.created_at), updatedAt: epoch(row.updated_at), disabledAt: nullableEpoch(row.disabled_at), disabledReason: row.disabled_reason };
 const value = rehydrateMembershipForPersistence(snapshot);
 const rawRevision = row.repository_revision;
 if (typeof rawRevision !== 'string') throw new Error('invalid revision');
 const revision = repositoryRevision(rawRevision);
 return { value, revision };
}`;

function membershipFindings(code = membershipFixture, file = membershipMapper, extra: ModuleSources = new Map()) {
  return privilegedCapabilityViolations(new Map([[file, code], ...extra]));
}
const historyLoop = membershipFixture.replace(
  'const roleGrants = ordered.map(entry => roleGrantFromRow(entry.row));',
  'const roleGrants = []; for (const entry of ordered) { roleGrants.push(roleGrantFromRow(entry.row)); }',
);

describe('Membership-only multi-row terminal contract', () => {
  it('MP-P01 zero-child path uses the same explicit full-state projection', () => {
    expect(membershipFindings()).toEqual([]);
  });
  it('MP-P02 one-child path uses a non-exported authentic-child helper', () => {
    expect(membershipFindings(membershipFixture.replace(
      'const roleGrants = ordered.map(entry => roleGrantFromRow(entry.row));',
      'const roleGrants = children.map(roleGrantFromRow);',
    ))).toEqual([]);
  });
  it('MP-P03 supports variable-length for/of child-result assembly', () => {
    expect(membershipFindings(historyLoop)).toEqual([]);
  });
  it('MP-P04 complete history is projected without effective-grant filtering', () => {
    expect(membershipFixture).toContain('revokedAt: nullableEpoch(row.revoked_at)');
    expect(membershipFixture).toContain('validUntil: nullableEpoch(row.valid_until)');
    expect(membershipFindings()).toEqual([]);
  });
  it('MP-P05 supports exact BigInt ordering and parent-association checks', () => {
    expect(membershipFixture).toContain('entry.ordinal !== BigInt(index)');
    expect(membershipFixture).toContain('membershipId(entry.row.membership_id) !== parentId');
    expect(membershipFindings()).toEqual([]);
  });
  it('MP-P06 supports additional ordinary local row/scalar helpers', () => {
    const helper = 'function checkedChild(input: unknown) { return rowRecord(input, childFields); }';
    expect(membershipFindings(helper + membershipFixture.replace(
      'Array.from(childInput).map(child => rowRecord(child, childFields))',
      'Array.from(childInput).map(checkedChild)',
    ))).toEqual([]);
  });
  it('MP-P07 does not depend on terminal/helper names or child cardinality', () => {
    expect(membershipFindings(membershipFixture
      .replaceAll('membershipFromRows', 'readAggregate')
      .replaceAll('roleGrantFromRow', 'projectChild'))).toEqual([]);
  });
  const negativeMembership = [
    ['MP-N01 generic Membership state wrapper',
      `export function reconstruct(state: unknown) { return rehydrateMembershipForPersistence(state); }`],
    ['MP-N02 external ready-made child persistence states',
      membershipFixture.replace('const roleGrants = ordered.map(entry => roleGrantFromRow(entry.row));',
        'const roleGrants = childInput.map(state => rehydrateRoleGrantForPersistence(state));')],
    ['MP-N03 caller preconstructed grants plus ready-made parent state',
      membershipFixture.replace('const value = rehydrateMembershipForPersistence(snapshot);',
        'const value = rehydrateMembershipForPersistence({ ...membershipInput, roleGrants: childInput });')],
    ['MP-N04 exported child reconstruction helper',
      membershipFixture.replace('function roleGrantFromRow(', 'export function roleGrantFromRow(')],
    ['MP-N05 child helper returns raw capability',
      membershipFixture.replace('return rehydrateRoleGrantForPersistence(snapshot);', 'return rehydrateRoleGrantForPersistence;')],
    ['MP-N06 terminal returns raw Membership capability',
      membershipFixture.replace('return { value, revision };', 'return rehydrateMembershipForPersistence;')],
    ['MP-N07 raw parent spread',
      membershipFixture.replace('rehydrateMembershipForPersistence(snapshot)', 'rehydrateMembershipForPersistence({ ...row })')],
    ['MP-N08 raw child spread',
      membershipFixture.replace('rehydrateRoleGrantForPersistence(snapshot)', 'rehydrateRoleGrantForPersistence({ ...row })')],
    ['MP-N09 caller-supplied reconstruction function',
      membershipFixture.replace('membershipInput: unknown, childInput: unknown',
        'membershipInput: unknown, childInput: unknown, reconstruct: (state: unknown) => Membership')
        .replace('const value = rehydrateMembershipForPersistence(snapshot);',
          'const value = reconstruct(rehydrateMembershipForPersistence(snapshot));')],
    ['MP-N10 caller-supplied capability',
      membershipFixture.replace('membershipInput: unknown, childInput: unknown',
        'membershipInput: unknown, childInput: unknown, capability: typeof rehydrateMembershipForPersistence')
        .replace('const value = rehydrateMembershipForPersistence(snapshot);',
          'const value = capability(snapshot);')],
    ['MP-N14 child-helper alias escapes',
      membershipFixture + 'const raw = rehydrateRoleGrantForPersistence; export { raw as childLoader };'],
    ['MP-N16 certified private helper alias escapes',
      membershipFixture + 'export const childLoader = roleGrantFromRow;'],
    ['MP-N17 certified private helper re-export escapes',
      membershipFixture + 'export { roleGrantFromRow };'],
    ['MP-N18 certified private helper object/class/closure escape',
      membershipFixture + 'export const api = { load: roleGrantFromRow }; export class API { static load = roleGrantFromRow; } export function factory() { return roleGrantFromRow; }'],
    ['MP-N19 certified private helper generic wrapper',
      membershipFixture + 'export function childLoader(row: unknown) { return roleGrantFromRow(row); }'],
    ['MP-N20 certified private helper bind/call/apply',
      membershipFixture + 'export const load = roleGrantFromRow.bind(null); export function childLoader(row: unknown) { return roleGrantFromRow.call(null, row); }'],
    ['MP-N21 higher-order closure beside an otherwise safe terminal',
      membershipFixture.replace('const snapshot = { id: parentId', 'const escape = () => rehydrateMembershipForPersistence; const snapshot = { id: parentId')],
    ['MP-N22 incomplete child history projection',
      membershipFixture.replace('revokedAt: nullableEpoch(row.revoked_at)', '')],
    ['MP-N23 camelCase child state disguised as DB input',
      membershipFixture.replace('roleGrantId(row.grant_id)', 'roleGrantId(row.id)')],
    ['MP-N24 caller grants forwarded without child reconstruction',
      membershipFixture.replace('const roleGrants = ordered.map(entry => roleGrantFromRow(entry.row));', 'const roleGrants = childInput;')],
  ] as const;
  for (const [name, body] of negativeMembership) {
    it(name + ' is blocked', () => {
      const code = body === membershipFixture || body.includes('import {') ? body :
        membershipFixture.slice(0, membershipFixture.indexOf('export function membershipFromRows')) + body;
      expect(membershipFindings(code)).toContain(membershipMapper + ': forbidden privileged capability export');
    });
  }
  it('MP-N11 identical terminal is blocked outside the exact mapper boundary', () => {
    for (const file of ['lib/zhiban/application/identity/fixture.ts', 'lib/zhiban/domain/consumer.ts',
      'lib/zhiban/openmaic/adapter.ts', 'lib/zhiban/infrastructure/other/fixture.ts'])
      expect(membershipFindings(membershipFixture, file)).not.toEqual([]);
  });
  it('MP-N12 terminal cannot propagate through forbidden barrels', () => {
    for (const file of ['lib/zhiban/application/identity/barrel.ts', 'lib/zhiban/domain/identity/barrel.ts',
      'lib/zhiban/openmaic/barrel.ts', 'lib/zhiban/infrastructure/other/barrel.ts']) {
      expect(membershipFindings(membershipFixture, membershipMapper, new Map([[file,
        "export { membershipFromRows } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/fixture-membership';",
      ]]))).toContain(file + ': forbidden privileged capability export');
    }
  });
  it('MP-N13 unresolved local child helper remains fail closed', () => {
    for (const path of ['./missing-child-helper', '@/lib/zhiban/infrastructure/identity/postgres/mappers/missing-child-helper']) {
      expect(membershipFindings("import { helper } from '" + path + "';" + membershipFixture)).toContain(
        membershipMapper + ': UNRESOLVED_PROJECT_LOCAL_MODULE ' + path,
      );
    }
  });
  it('MP-N15 multihop generic Membership/RoleGrant wrapper is blocked', () => {
    const child = 'lib/zhiban/infrastructure/identity/postgres/mappers/unsafe-child.ts';
    const parent = 'lib/zhiban/infrastructure/identity/postgres/mappers/unsafe-parent.ts';
    expect(privilegedCapabilityViolations(new Map([
      [child, `import { rehydrateRoleGrantForPersistence } from '${root}'; export function child(state: unknown) { return rehydrateRoleGrantForPersistence(state); }`],
      [parent, `import { rehydrateMembershipForPersistence } from '${root}'; import { child } from './unsafe-child'; export function reconstruct(state, children) { return rehydrateMembershipForPersistence({ ...state, roleGrants: children.map(child) }); }`],
    ]))).toContain(parent + ': forbidden privileged capability export');
  });
});

const mapper = 'lib/zhiban/infrastructure/identity/postgres/mappers/fixture-user.ts';
const root = '@/lib/zhiban/domain/identity/persistence-rehydration';
const imports = `
import { rehydrateUserForPersistence as reconstruct } from '${root}';
import { instant } from '@/lib/zhiban/domain/identity/time';
import { userId } from '@/lib/zhiban/domain/identity/ids';
import { repositoryRevision, type Loaded } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { User } from '@/lib/zhiban/domain/identity';
interface Row {
  user_id: string; status: string; created_at: string; updated_at: string;
  disabled_at: string | null; disabled_reason: string | null; repository_revision: string;
}
function epoch(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$(?![\\s\\S])/.test(value)) throw new Error('invalid epoch');
  const parsed = BigInt(value);
  if (parsed > BigInt('8640000000000000')) throw new Error('invalid epoch');
  return instant(Number(parsed));
}
`;
const projected = `{
  id: userId(row.user_id), status: row.status,
  createdAt: epoch(row.created_at), updatedAt: epoch(row.updated_at),
  disabledAt: row.disabled_at === null ? null : epoch(row.disabled_at),
  disabledReason: row.disabled_reason
}`;
const terminal = `export function fromRow(row: Row): Loaded<User> {
  const snapshot = ${projected};
  const value = reconstruct(snapshot);
  const revision = repositoryRevision(row.repository_revision);
  return { value, revision };
}`;
function findings(body: string, file = mapper, extra: ModuleSources = new Map()): string[] {
  return privilegedCapabilityViolations(new Map([[file, imports + body], ...extra]));
}

describe('precise terminal PostgreSQL mapper boundary', () => {
  it('MB-P01 permits explicit DB projection, checked scalars, reconstruction result and Loaded', () => {
    expect(findings(terminal)).toEqual([]);
  });
  it('MB-P02 permits a non-exported local explicit projection helper', () => {
    const helper = `function project(row: Row) { return ${projected}; }`;
    expect(findings(helper + terminal.replace(projected, 'project(row)'))).toEqual([]);
  });
  it('MB-P03 permits ordinary local helpers without capability escapes', () => {
    const helpers = `function parseId(raw: unknown) { return userId(raw); }
      function unrelated() { return 'ordinary data'; }`;
    expect(findings(helpers + terminal.replace('userId(row.user_id)', 'parseId(row.user_id)'))).toEqual([]);
  });
  const negatives = [
    ['MB-N01 raw re-export', `export { reconstruct };`],
    ['MB-N02 alias export', `export const loader = reconstruct;`],
    ['MB-N03 object export', `export const api = { loader: reconstruct };`],
    ['MB-N04 class export', `export class API { static loader = reconstruct; }`],
    ['MB-N05 returned capability', `export function factory() { return reconstruct; }`],
    ['MB-N06 returned bound capability', `export function factory() { return reconstruct.bind(null); }`],
    ['MB-N07 arbitrary persistence state wrapper', `export function fromRow(state: unknown) { return reconstruct(state); }`],
    ['MB-N08 wrapper through local helper', `function internal(state: unknown) { return reconstruct(state); }
      export function fromRow(state: unknown) { return internal(state); }`],
    ['MB-N13 namespace forwarding', `import * as persistence from '${root}'; export const api = persistence;`],
    ['MB-N14 destructuring forwarding', `const box = { loader: reconstruct }; const { loader } = box; export { loader };`],
    ['MB-N15 call/apply/bind forwarding', `export const loader = reconstruct.bind(null);
      export function invoke(x: unknown) { return reconstruct.call(null, x); }
      export function apply(x: unknown) { return reconstruct.apply(null, [x]); }`],
    ['MB-N16 higher-order closure', `export function factory() { return (state: unknown) => reconstruct(state); }`],
    ['MB-N17 spread state bypass', terminal.replace(projected, '{ ...row }')],
    ['MB-N18 camelCase persistence argument', terminal.replaceAll('created_at', 'createdAt').replaceAll('updated_at', 'updatedAt')],
    ['MB-N19 renamed safe-looking type and function', `interface UserRow { anything: unknown; }
      export function userFromRow(row: UserRow) { return reconstruct(row); }`],
    ['MB-N20 captured capability beside otherwise terminal result', terminal.replace('const snapshot', 'const leak = reconstruct; const snapshot')],
    ['MB-N21 higher-order capability argument', terminal.replace('const snapshot', 'const callback = () => reconstruct; const snapshot')],
    ['MB-N22 default mapper alias', terminal + 'export default fromRow;'],
    ['MB-N23 named mapper alias', terminal + 'export { fromRow as loader };'],
    ['MB-N24 wrapped mapper alias', terminal + 'export function forward(row: Row) { return fromRow(row); }'],
    ['MB-N25 object mapper alias', terminal + 'export const api = { fromRow };'],
    ['MB-N26 arbitrary state helper posing as validation', terminal.replace(projected, 'project(row)') +
      'function project(row: Row) { return row; }'],
    ['MB-N27 computed snapshot field', terminal.replace('id: userId', "['id']: userId")],
    ['MB-N28 mutable captured snapshot', terminal.replace('const snapshot', 'let snapshot')],
    ['MB-N29 incomplete projection', terminal.replace('status: row.status,', '')],
    ['MB-N30 duplicate snapshot field', terminal.replace('status: row.status,', 'status: row.status, status: row.status,')],
    ['MB-N31 raw revision', terminal.replace('repositoryRevision(row.repository_revision)', 'row.repository_revision')],
    ['MB-N32 capability carried in returned value', terminal.replace('return { value, revision };', 'return { value, revision, loader: reconstruct };')],
  ] as const;
  for (const [name, body] of negatives) {
    it(`${name} is blocked inside the exact mapper directory`, () => {
      expect(findings(body)).not.toEqual([]);
    });
  }
  it('MB-N09 blocks a generic wrapper through a second module', () => {
    const second = 'lib/zhiban/infrastructure/identity/postgres/mappers/fixture-second.ts';
    expect(privilegedCapabilityViolations(new Map([
      [mapper, `import { reconstruct } from './fixture-second'; export function fromRow(x: unknown) { return reconstruct(x); }`],
      [second, `export { rehydrateUserForPersistence as reconstruct } from '${root}';`],
    ]))).not.toEqual([]);
  });
  it('MB-N10 forbids mapper barrels in every forbidden layer', () => {
    for (const barrel of [
      'lib/zhiban/application/identity/mapper-barrel.ts',
      'lib/zhiban/domain/identity/mapper-barrel.ts',
      'lib/zhiban/infrastructure/other/mapper-barrel.ts',
      'lib/zhiban/openmaic/mapper-barrel.ts',
      'lib/zhiban/infrastructure/identity/postgres/mappers/index.ts',
    ]) {
      const result = findings(terminal, mapper, new Map([[barrel, `export { fromRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/fixture-user';`]]));
      expect(result).toContain(`${barrel}: forbidden privileged capability export`);
    }
  });
  it('MB-N11 forbids the identical terminal implementation outside the precise directory', () => {
    for (const file of [
      'lib/zhiban/infrastructure/identity/fixture-user.ts',
      'lib/zhiban/infrastructure/identity/postgres/fixture-user.ts',
      'lib/zhiban/infrastructure/identity/postgres/mappers-extra/fixture-user.ts',
      'lib/zhiban/application/identity/fixture-user.ts',
    ]) expect(findings(terminal, file)).not.toEqual([]);
  });
  it('MB-N12 keeps unresolved project-local dependencies fail closed', () => {
    for (const missing of ['./does-not-exist', '@/lib/zhiban/domain/identity/does-not-exist'])
      expect(findings(`import { dependency } from '${missing}';` + terminal)).toContain(
        `${mapper}: UNRESOLVED_PROJECT_LOCAL_MODULE ${missing}`,
      );
  });
  it('MB-N33 forbids even direct mapper imports into non-repository consumers', () => {
    for (const consumer of [
      'app/fixture.ts', 'lib/zhiban/application/identity/fixture.ts',
      'lib/zhiban/infrastructure/other/fixture.ts', 'tests/helper-fixture.ts',
    ]) expect(findings(terminal, mapper, new Map([[consumer,
      `import { fromRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/fixture-user';`,
    ]]))).toContain(`${consumer}: forbidden terminal mapper import`);
  });
  it('MB-P04 permits repository-owned direct consumption, not a raw root import', () => {
    const repository = 'lib/zhiban/infrastructure/identity/postgres/repositories/fixture.ts';
    expect(findings(terminal, mapper, new Map([[repository,
      `import { fromRow } from '../mappers/fixture-user'; export function readRow(row: unknown) { return fromRow(row); }`,
    ]]))).toEqual([]);
    expect(findings(`export const name = 'safe';`, repository)).not.toEqual([]);
  });
  it('MB-N34 detects multi-hop mapper re-exports and cycles', () => {
    const a = 'lib/zhiban/infrastructure/identity/postgres/mappers/barrel-a.ts';
    const b = 'lib/zhiban/infrastructure/identity/postgres/mappers/barrel-b.ts';
    const result = findings(terminal, mapper, new Map([
      [a, `export * from './fixture-user'; export * from './barrel-b';`],
      [b, `export * from './barrel-a';`],
    ]));
    expect(result).toContain(`${a}: forbidden privileged capability export`);
    expect(result).toContain(`${b}: forbidden privileged capability export`);
  });
  it('MB-N35 scans mapper consumers before the large-graph optimization', () => {
    const extra = new Map(Array.from({ length: 101 }, (_, i) =>
      [`tests/mapper-fixture-${i}.ts`, 'export const info = 1;']));
    extra.set('app/fixture.ts', `import { fromRow } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/fixture-user';`);
    expect(findings(terminal, mapper, extra)).toContain('app/fixture.ts: forbidden terminal mapper import');
  });
});
