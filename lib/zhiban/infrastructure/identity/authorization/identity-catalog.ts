import { createHash } from 'node:crypto';
import { Role, roleId, permission, type RoleCode } from '@/lib/zhiban/domain/identity';
import { identityPermissions } from '@/lib/zhiban/domain/identity/policies/authorization';
import {
  roleCatalogSnapshot,
  type RoleCatalogPort,
} from '@/lib/zhiban/application/identity/ports/role-catalog';
import type {
  AuthorizationCatalog,
  AuthorizationCatalogPort,
} from '@/lib/zhiban/application/identity/ports/authorization';

/** No fixture IDs/default configuration or hot reload. Pin approved values at composition time. */
export class ApprovedIdentityCatalog implements AuthorizationCatalogPort, RoleCatalogPort {
  private readonly catalog: AuthorizationCatalog;
  constructor(config: {
    readonly roleIds: Readonly<Record<RoleCode, string>>;
    readonly approvalRecord: string;
    readonly expectedDigest: string;
  }) {
    if (!config || !/^[A-Za-z0-9._:-]{1,128}$/.test(config.approvalRecord))
      throw new TypeError('Authorization configuration required.');
    const codes = ['STUDENT', 'TEACHER', 'TENANT_ADMIN'] as const;
    const roles = codes.map((code) =>
      Role.create(roleId(config.roleIds[code]), code, identityPermissions[code].map(permission)),
    );
    if (
      new Set(roles.map((r) => r.id)).size !== 3 ||
      Object.keys(config.roleIds).sort().join(',') !== [...codes].sort().join(',')
    )
      throw new TypeError('Invalid authorization configuration.');
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          version: 'identity-v1',
          actionVersion: 'identity-v1',
          delegationVersion: 'identity-v1',
          approvalRecord: config.approvalRecord,
          roles: roles.map((r) => ({ id: r.id, code: r.code, permissions: r.permissions })),
        }),
      )
      .digest('hex');
    if (digest !== config.expectedDigest)
      throw new TypeError('Authorization configuration checksum rejected.');
    this.catalog = Object.freeze({
      snapshot: roleCatalogSnapshot('identity-v1', roles),
      contentDigest: digest,
      actionVersion: 'identity-v1',
      delegationVersion: 'identity-v1',
    });
    Object.freeze(this);
  }
  async load() {
    return this.catalog;
  }
  async snapshot() {
    return this.catalog.snapshot;
  }
  async findByCode(code: RoleCode) {
    return this.catalog.snapshot.roles.find((r) => r.code === code) ?? null;
  }
}
