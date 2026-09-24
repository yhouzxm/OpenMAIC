import { Role, roleCode, type RoleCode } from '@/lib/zhiban/domain/identity';

declare const catalogBrand: unique symbol;
const requiredCodes: readonly RoleCode[] = ['STUDENT', 'TEACHER', 'TENANT_ADMIN'];

/** Version belongs to directory metadata, not Role Entity or Membership grants. */
export interface RoleCatalogSnapshot {
  readonly [catalogBrand]: true;
  readonly version: string;
  readonly roles: readonly Role[];
}

/** Complete, controlled directory; order supplied by the caller is not significant. */
export function roleCatalogSnapshot(version: string, roles: readonly Role[]): RoleCatalogSnapshot {
  if (typeof version !== 'string' || version.trim() === '' || !Array.isArray(roles)) {
    throw new TypeError('A catalog version and complete roles are required.');
  }
  const byCode = new Map<RoleCode, Role>();
  for (const role of roles) {
    if (!(role instanceof Role)) throw new TypeError('A validated Role is required.');
    const code = roleCode(role.code);
    if (byCode.has(code)) throw new TypeError('Duplicate tenant role.');
    byCode.set(code, role);
  }
  if (byCode.size !== requiredCodes.length || requiredCodes.some((code) => !byCode.has(code))) {
    throw new TypeError('The tenant role catalog must contain exactly three roles.');
  }
  return Object.freeze({
    version: version.trim(),
    roles: Object.freeze(requiredCodes.map((code) => byCode.get(code)!)),
  }) as RoleCatalogSnapshot;
}

export interface RoleCatalogPort {
  findByCode(code: RoleCode): Promise<Role | null>;
  snapshot(): Promise<RoleCatalogSnapshot>;
}
