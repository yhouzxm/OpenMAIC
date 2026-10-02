import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  privilegedCapabilityViolations,
  resolvedModuleIdentity,
  type ModuleSources,
} from './privileged-capability-guard';

const root = '@/lib/zhiban/domain/identity/persistence-rehydration';
const importCapability = `import { rehydrateMembershipForPersistence as privileged } from '${root}';`;
// Exercise ALL old attack shapes inside the new, most sensitive import-allowed
// boundary. Only relocation changes; their bodies and assertions remain intact.
const infrastructure = 'lib/zhiban/infrastructure/identity/postgres/mappers/fixture-a.ts';
const secondHop = 'lib/zhiban/infrastructure/identity/postgres/mappers/fixture-b.ts';
const application = 'lib/zhiban/application/identity/fixture.ts';
const source = (body: string, file = infrastructure): ModuleSources => new Map([[file, body]]);
const violations = (entries: ModuleSources): string[] => privilegedCapabilityViolations(entries);
const blocked = (body: string, file = infrastructure): void => {
  expect(violations(source(body, file))).not.toEqual([]);
};

function expectedCanonicalPath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

describe('semantic privileged capability guard', () => {
  it('SG01 blocks a direct forbidden import', () => {
    blocked(importCapability, application);
  });
  it('SG02 resolves the original alias-dotdot P0 to the privileged SourceFile', () => {
    const specifier = '@/lib/zhiban/domain/identity/../identity/persistence-rehydration';
    expect(resolvedModuleIdentity(application, specifier)).toBe(
      resolvedModuleIdentity(application, root),
    );
    blocked(`import { rehydrateMembershipForPersistence } from '${specifier}';`, application);
  });
  it('SG03 blocks direct re-export', () => {
    blocked(`export { rehydrateMembershipForPersistence } from '${root}';`);
  });
  it('SG04 blocks renamed re-export', () => {
    blocked(`export { rehydrateMembershipForPersistence as loader } from '${root}';`);
  });
  it('SG05 blocks an imported binding re-export', () => {
    blocked(`${importCapability} export { privileged as loader };`);
  });
  it('SG06 blocks a const alias', () => {
    blocked(`${importCapability} export const loader = privileged;`);
  });
  it('SG07 blocks multiple const aliases', () => {
    blocked(`${importCapability} const a = privileged; const b = a; export const loader = b;`);
  });
  it('SG08 blocks default export', () => {
    blocked(`${importCapability} export default privileged;`);
  });
  it('SG09 blocks an exported arrow wrapper', () => {
    blocked(`${importCapability} export const loader = (input: unknown) => privileged(input);`);
  });
  it('SG10 blocks an exported function wrapper', () => {
    blocked(`${importCapability} export function loader(input: unknown) { return privileged(input); }`);
  });
  it('SG11 blocks local declaration and assignment wrappers', () => {
    blocked(`${importCapability} export function loader(input: unknown) { const f = privileged; return f(input); }`);
    blocked(`${importCapability} export const loader = (input: unknown) => { let f; f = privileged; return f(input); };`);
  });
  it('SG12 blocks destructuring and renamed destructuring', () => {
    blocked(`${importCapability} const obj = { loader: privileged }; const { loader } = obj; export { loader };`);
    blocked(`${importCapability} const obj = { loader: privileged }; const { loader: forwarded } = obj; export { forwarded };`);
  });
  it('SG13 blocks namespace member aliases and wrappers', () => {
    const namespace = `import * as persistence from '${root}';`;
    blocked(`${namespace} export const loader = persistence.rehydrateMembershipForPersistence;`);
    blocked(`${namespace} export function loader(x: unknown) { return persistence.rehydrateMembershipForPersistence(x); }`);
  });
  it('SG14 blocks export-star', () => {
    blocked(`export * from '${root}';`);
  });
  it('SG15 blocks multi-hop export-star and alias forwarding', () => {
    expect(
      violations(
        new Map([
          [infrastructure, `${importCapability} export const loader = privileged;`],
          [secondHop, "export { loader as forwarded } from './fixture-a';"],
          [application, "import { forwarded } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/fixture-b';"],
        ]),
      ),
    ).toHaveLength(3);
    expect(
      violations(new Map([[infrastructure, `export * from '${root}';`], [secondHop, "export * from './fixture-a';"]])),
    ).toHaveLength(2);
  });
  it('SG16 does not taint a shadowing parameter', () => {
    expect(violations(source(`${importCapability} export function safe(privileged: (x: unknown) => unknown) { return privileged('safe'); }`))).toEqual([]);
  });
  it('SG17 does not taint a shadowing block local', () => {
    expect(violations(source(`${importCapability} export function safe() { const privileged = () => 'safe'; return privileged(); }`))).toEqual([]);
  });
  it('SG18 permits internal Infrastructure use with an unrelated export', () => {
    expect(violations(source(`${importCapability} const restore = (x: unknown) => privileged(x); export const adapterName = 'identity';`))).toEqual([]);
  });
  it('SG19 does not mistake a similarly named module for the privileged file', () => {
    const helper = 'lib/zhiban/domain/identity/persistence-rehydration-helper.ts';
    expect(
      violations(
        new Map([
          [helper, 'export const helper = () => 1;'],
          [application, "import { helper } from '@/lib/zhiban/domain/identity/persistence-rehydration-helper';"],
        ]),
      ),
    ).toEqual([]);
  });
  it('SG20 leaves the ordinary Domain barrel untainted', () => {
    expect(violations(source("export { User } from './user';", 'lib/zhiban/domain/identity/index.ts'))).toEqual([]);
  });
  it('SG21 resolves canonical alias without string-based identity matching', () => {
    expect(resolvedModuleIdentity(application, root)).toBe(
      expectedCanonicalPath(resolve('lib/zhiban/domain/identity/persistence-rehydration.ts')),
    );
    blocked(importCapability, application);
  });
  it('SG22 blocks relative paths with redundant dot segments', () => {
    for (const specifier of [
      '../../domain/identity/persistence-rehydration',
      '../../domain/identity/../identity/persistence-rehydration',
    ])
      blocked(`import { rehydrateMembershipForPersistence } from '${specifier}';`, application);
  });
  it('SG23 restricts internal persistence-validation helpers outside Infrastructure', () => {
    blocked("import { persistenceRecord } from '@/lib/zhiban/domain/identity/persistence-validation';", application);
  });
  it('SG24 detects a real closure call but not its shadowed names', () => {
    blocked(`${importCapability} export function loader(x: unknown) { const inner = () => privileged(x); return inner(); }`);
  });
  it('SG25 covers every entity-level reconstruction root', () => {
    for (const [module, name] of [
      ['user', 'rehydrateUserForPersistence'],
      ['tenant', 'rehydrateTenantForPersistence'],
      ['membership', 'rehydrateMembershipForPersistence'],
      ['role-grant', 'rehydrateRoleGrantForPersistence'],
      ['system-admin-grant', 'rehydrateSystemAdminGrantForPersistence'],
    ]) {
      blocked(`import { ${name} } from '@/lib/zhiban/domain/identity/${module}';`, application);
    }
  });
  it('SG26 keeps the test allowlist narrow', () => {
    expect(
      violations(source(importCapability, 'tests/zhiban/identity/domain/rehydration.test.ts')),
    ).toEqual([]);
    blocked(importCapability, 'tests/zhiban/identity/contracts/repositories.test.ts');
  });
  it('SG27 rejects UI, OpenMAIC, and ordinary Domain consumers', () => {
    for (const file of [
      'app/page.tsx',
      'components/Widget.tsx',
      'lib/zhiban/openmaic/adapter.ts',
      'lib/zhiban/domain/consumer.ts',
    ])
      blocked(importCapability, file);
  });
  it('SG28 rejects a standard barrel star export from an entity root', () => {
    blocked("export * from './user';", 'lib/zhiban/domain/identity/index.ts');
  });
  it('SG29 does not expose persistence-validation through the standard barrel', () => {
    blocked("export * from './persistence-validation';", 'lib/zhiban/domain/identity/index.ts');
  });
  it('SG30 follows a statically computed object-literal key', () => {
    blocked(`${importCapability} const box = { ['loader']: privileged }; const { loader } = box; export { loader };`);
  });
  it('SG31 blocks a default function wrapper', () => {
    blocked(`${importCapability} export default function loader(x: unknown) { return privileged(x); }`);
  });
  it('SG32 follows namespace destructuring to the root symbol', () => {
    blocked(`import * as persistence from '${root}'; const { rehydrateMembershipForPersistence: loader } = persistence; export { loader };`);
  });
  it('SG33 blocks call/apply forwarding and privileged function arguments', () => {
    blocked(`${importCapability} export const loader = (x: unknown) => privileged.call(null, x);`);
    blocked(`${importCapability} export const loader = (x: unknown) => Reflect.apply(privileged, null, [x]);`);
  });
  it('SG34 blocks public class fields and methods that forward reconstruction', () => {
    blocked(`${importCapability} export class Loader { readonly load = privileged; }`);
    blocked(`${importCapability} export class Loader { load(x: unknown) { return privileged(x); } }`);
  });
  it('SG35 blocks an exported object raw property', () => {
    blocked(`${importCapability} export const api = { loader: privileged };`);
  });
  it('SG36 closes P1-C exported object method forwarding', () => {
    expect(violations(source(`${importCapability} export const api = { loader(x: unknown) { return privileged(x); } };`))).toEqual([
      `${infrastructure}: forbidden privileged capability export`,
    ]);
  });
  it('SG37 blocks arrow and function expression properties', () => {
    blocked(`${importCapability} export const api = { loader: (x: unknown) => privileged(x) };`);
    blocked(`${importCapability} export const api = { loader: function(x: unknown) { return privileged(x); } };`);
  });
  it('SG38 follows nested object surfaces and shorthand aliases', () => {
    blocked(`${importCapability} export const api = { persistence: { loader: privileged } };`);
    blocked(`${importCapability} const f = privileged; export const api = { f };`);
  });
  it('SG39 blocks default object values and methods', () => {
    blocked(`${importCapability} export default { loader: privileged };`);
    blocked(`${importCapability} export default { loader(x: unknown) { return privileged(x); } };`);
  });
  it('SG40 blocks object getters returning or invoking reconstruction', () => {
    blocked(`${importCapability} export const api = { get loader() { return privileged; } };`);
    blocked(`${importCapability} export const api = { get value() { return privileged({}); } };`);
  });
  it('SG41 blocks exported class static properties', () => {
    blocked(`${importCapability} export class X { static loader = privileged; }`);
  });
  it('SG42 blocks exported class static methods', () => {
    blocked(`${importCapability} export class X { static loader(x: unknown) { return privileged(x); } }`);
  });
  it('SG43 blocks exported class instance properties', () => {
    blocked(`${importCapability} export class X { loader = privileged; }`);
  });
  it('SG44 blocks exported class instance methods', () => {
    blocked(`${importCapability} export class X { loader(x: unknown) { return privileged(x); } }`);
  });
  it('SG45 blocks class instance and static getters', () => {
    blocked(`${importCapability} export class X { get loader() { return privileged; } }`);
    blocked(`${importCapability} export class X { static get loader() { return privileged; } }`);
  });
  it('SG46 closes P1-A exported class expression forwarding', () => {
    expect(violations(source(`${importCapability} export const X = class { static loader = privileged; };`))).toEqual([
      `${infrastructure}: forbidden privileged capability export`,
    ]);
  });
  it('SG47 closes P1-B anonymous default class forwarding', () => {
    expect(violations(source(`${importCapability} export default class { static loader = privileged; }`))).toEqual([
      `${infrastructure}: forbidden privileged capability export`,
    ]);
  });
  it('SG48 blocks returned object capability', () => {
    blocked(`${importCapability} export function getApi() { return { loader: privileged }; }`);
  });
  it('SG49 blocks returned class capability', () => {
    blocked(`${importCapability} export function getApi() { return class { static loader = privileged; }; }`);
  });
  it('SG50 permits safe data and same-name object members', () => {
    expect(violations(source(`${importCapability} const loader = () => 'safe'; export const api = { loader }; export const info = { name: 'identity', enabled: true };`))).toEqual([]);
  });
  it('SG51 permits classes whose privileged implementation remains private', () => {
    expect(violations(source(`${importCapability} export class X { private loader = privileged; #restore = privileged; private map(x: unknown) { return privileged(x); } name = 'safe'; }`))).toEqual([]);
  });
  it('SG52 distinguishes object method parameter symbols', () => {
    expect(violations(source(`${importCapability} export const api = { loader(privileged: unknown) { return privileged; } };`))).toEqual([]);
  });
  it('SG53 fails closed for unresolved relative imports', () => {
    expect(violations(source("import { x } from './does-not-exist';"))).toEqual([
      `${infrastructure}: UNRESOLVED_PROJECT_LOCAL_MODULE ./does-not-exist`,
    ]);
  });
  it('SG54 fails closed for unresolved configured alias imports', () => {
    expect(violations(source("import { x } from '@/lib/zhiban/domain/identity/no-such-file';"))).toEqual([
      `${infrastructure}: UNRESOLVED_PROJECT_LOCAL_MODULE @/lib/zhiban/domain/identity/no-such-file`,
    ]);
  });
  it('SG55 ignores unresolved external bare packages', () => {
    expect(violations(source("import { x } from 'external-fixture-package'; export const name = 'safe';"))).toEqual([]);
  });
  it('SG56 fails closed for local exports and type-only imports', () => {
    blocked("export * from './does-not-exist';");
    blocked("import type { X } from '@/no-such-file';");
  });
  it('SG57 reuses alias and destructuring flow inside members', () => {
    blocked(`${importCapability} export const api = { loader(x: unknown) { const f = privileged; return f(x); } };`);
    blocked(`${importCapability} export class X { load(x: unknown) { const box = { f: privileged }; const { f: call } = box; return call(x); } }`);
  });
  it('SG58 follows named default classes and class aliases', () => {
    blocked(`${importCapability} export default class Loader { static load(x: unknown) { return privileged(x); } }`);
    blocked(`${importCapability} const X = class { static loader = privileged; }; export { X };`);
    blocked(`${importCapability} export const api = { X: class { static loader = privileged; } };`);
  });
  it('SG59 detects constructor assignments into public fields', () => {
    blocked(`${importCapability} export class X { loader; constructor() { this.loader = privileged; } }`);
    blocked(`${importCapability} export class X { constructor(public loader = privileged) {} }`);
    blocked(`${importCapability} export class X { loader; constructor(f = privileged) { this.loader = f; } }`);
  });
  it('SG60 follows public methods calling private implementation', () => {
    blocked(`${importCapability} export class X { #load(x: unknown) { return privileged(x); } load(x: unknown) { return this.#load(x); } }`);
    expect(violations(source(`${importCapability} export class X { constructor(private loader = privileged) {} getName() { return 'safe'; } }`))).toEqual([]);
  });
  it('SG61 follows object spreads and exported arrays', () => {
    blocked(`${importCapability} const internal = { loader: privileged }; export const api = { ...internal };`);
    blocked(`${importCapability} export const loaders = [privileged];`);
  });
  it('SG62 preserves call, apply and bind member forwarding checks', () => {
    for (const body of [
      'export const api = { loader: privileged.bind(null) };',
      'export const api = { loader(x: unknown) { return privileged.call(null, x); } };',
      'export const api = { loader(x: unknown) { return privileged.apply(null, [x]); } };',
    ]) blocked(`${importCapability} ${body}`);
  });
  it('SG63 terminates across cyclic export graphs while propagating surfaces', () => {
    expect(violations(new Map([
      [infrastructure, `${importCapability} export const api = { loader: privileged }; export * from './fixture-b';`],
      [secondHop, "export * from './fixture-a';"],
    ]))).toHaveLength(2);
  });
  it('SG64 checks unresolved local modules before the large-graph optimization', () => {
    const entries = new Map(Array.from({ length: 101 }, (_, i) =>
      [`tests/scanner-fixture-${i}.ts`, "export const info = 'safe';"]));
    entries.set(application, "import { x } from '@/no-such-file';");
    expect(violations(entries)).toEqual([
      `${application}: UNRESOLVED_PROJECT_LOCAL_MODULE @/no-such-file`,
    ]);
  });
  it('SG65 validates stylesheet resource existence without allowing unresolved code imports', () => {
    expect(violations(source("import './globals.css';", 'app/layout.tsx'))).toEqual([]);
    blocked("import './does-not-exist.css';");
    blocked("import { loader } from './does-not-exist.css';");
  });
  it('SG66 treats public setters as callable member surfaces', () => {
    blocked(`${importCapability} export const api = { set snapshot(x: unknown) { privileged(x); } };`);
    blocked(`${importCapability} export class X { static set snapshot(x: unknown) { privileged(x); } }`);
  });
  it('SG67 follows exported instances of classes with reachable reconstruction members', () => {
    blocked(`${importCapability} class X { load = privileged; } export const api = new X();`);
    blocked(`${importCapability} export const api = new class { load = privileged; }();`);
  });
  it('SG68 follows inherited public surfaces without exposing private-only base members', () => {
    blocked(`${importCapability} class Base { load = privileged; } export class X extends Base {}`);
    expect(violations(source(`${importCapability} class Base { #load = privileged; } export class X extends Base {}`))).toEqual([]);
  });
  it('SG69 follows exported namespace objects and namespace re-exports', () => {
    blocked(`import * as persistence from '${root}'; export const api = persistence;`);
    blocked(`export * as persistence from '${root}';`);
  });
  it('SG70 excludes private static members from aliased class surfaces', () => {
    expect(violations(source(`${importCapability} class X { private static loader(x: unknown) { return privileged(x); } } export const Safe = X;`))).toEqual([]);
  });
});
