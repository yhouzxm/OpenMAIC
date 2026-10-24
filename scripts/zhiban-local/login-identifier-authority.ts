/** LOCAL synthetic nomination only; no web caller can sign or select a target User. */
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { sign, verify } from 'node:crypto';
import type { Pool } from 'pg';
import { userId } from '@/lib/zhiban/domain/identity';
import {
  canonicalLoginAlias,
  aliasManifestDigest,
  aliasManifestFields,
  type AliasManifest,
} from '@/lib/zhiban/domain/login-identifiers/model';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  bearerForCookie,
  digestBearer,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { observedTransport } from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { controlTransaction } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import type { MemberControlConfig } from './member-authority';
import { loadLoginIdentifiers } from './login-identifiers';
type Pools = { auth: Pool; tenant: Pool; control: Pool };
function check(v: unknown): asserts v {
  if (!v) throw Error('LOCAL identifier authority rejected');
}
async function privatePath(path: string, dir = false) {
  const s = await lstat(path);
  check(
    !s.isSymbolicLink() &&
      s.uid === process.getuid?.() &&
      !(s.mode & 0o077) &&
      (dir ? s.isDirectory() : s.isFile()),
  );
}
export async function loadIdentifierEnvelope(cfg: MemberControlConfig, ref: string) {
  userId(ref);
  const dir = join(cfg.authority.root, 'login-identifier-approvals');
  await privatePath(cfg.authority.root, true);
  await privatePath(dir, true);
  const path = join(dir, ref + '.json');
  await privatePath(path);
  const e = JSON.parse(await readFile(path, 'utf8'));
  check(
    Object.keys(e).sort().join() ===
      'approverSignature,evidenceOrigin,githubActions,kind,manifest,operatorSignature' &&
      e.kind === 'LOCAL_SYNTHETIC_LOGIN_IDENTIFIER' &&
      e.evidenceOrigin === 'LOCAL' &&
      e.githubActions === false &&
      cfg.authority.operatorPublic !== cfg.authority.approverPublic,
  );
  const m = e.manifest as AliasManifest,
    bytes = Buffer.from(JSON.stringify(m));
  check(Object.keys(m).sort().join() === [...aliasManifestFields].sort().join());
  check(
    verify(null, bytes, cfg.authority.operatorPublic, Buffer.from(e.operatorSignature, 'base64')) &&
      verify(null, bytes, cfg.authority.approverPublic, Buffer.from(e.approverSignature, 'base64')),
  );
  check(
    m.kind === 'LOGIN_IDENTIFIER_NOMINATION' &&
      m.environment === cfg.authority.environment &&
      m.sourceRef === ref &&
      m.operatorUserId === cfg.operator.uid &&
      m.grantId === cfg.operator.grant &&
      canonicalLoginAlias(m.alias) === m.alias,
  );
  for (const id of [m.userId, m.operatorUserId, m.grantId, m.sourceRef]) userId(id);
  for (const rev of [m.expectedUserRevision, m.operatorRevision, m.grantRevision])
    check(/^[1-9][0-9]{0,15}$/.test(rev));
  check(
    typeof m.subjectReference === 'string' &&
      /^[A-Za-z0-9._:-]{1,120}$/.test(m.subjectReference) &&
      Number.isSafeInteger(m.issuedAt) &&
      Number.isSafeInteger(m.expiresAt) &&
      m.expiresAt > m.issuedAt &&
      m.expiresAt - m.issuedAt <= 1800000,
  );
  return m;
}
async function operator<T>(
  cfg: MemberControlConfig,
  pools: Pools,
  work: (
    c: Awaited<ReturnType<typeof createIdentityComposition>>,
    digest: string,
    ids: IdentityIds,
  ) => Promise<T>,
) {
  check(await loadLoginIdentifiers(pools.auth));
  const c = await createIdentityComposition(
    { auth: pools.auth, tenant: pools.tenant, control: pools.control },
    {
      ...cfg.composition,
      admission: {
        ...cfg.composition.admission,
        hmacKey: Buffer.from(cfg.composition.admission.hmacKey, 'hex'),
      },
      membership: { policy: cfg.composition.membership.policy, operator: null },
    },
  );
  const ids = new IdentityIds(),
    logged = await c.security.login(
      cfg.operator.uid,
      cfg.operator.password,
      observedTransport('127.0.0.1'),
      ids.nextCommandId(),
    );
  check(logged.status === 'ISSUED');
  const raw = bearerForCookie(logged.bearer),
    h = await c.security.authenticate(raw);
  check(h);
  try {
    return await work(c, digestBearer(raw)!, ids);
  } finally {
    await c.security.logout(h, ids.nextCommandId());
  }
}
export async function prepareLoginIdentifier(
  cfg: MemberControlConfig,
  pools: Pools,
  uid: string,
  input: string,
  subject: string,
) {
  userId(uid);
  const alias = canonicalLoginAlias(input);
  check(alias && /^[A-Za-z0-9._:-]{1,120}$/.test(subject));
  return operator(cfg, pools, async (_c, digest, ids) => {
    const m = await controlTransaction(pools.control, async (client) => {
      for (const id of [...new Set([uid, cfg.operator.uid])].sort())
        await client.query('SELECT user_id FROM zhiban_identity.users WHERE user_id=$1 FOR SHARE', [
          id,
        ]);
      await client.query('SELECT * FROM zhiban_login_identifiers.nomination_status($1,$2,$3,$4)', [
        digest,
        cfg.operator.uid,
        cfg.operator.grant,
        ids.nextCommandId(),
      ]);
      const {
        rows: [u],
      } = await client.query(
        "SELECT repository_revision::text AS revision FROM zhiban_identity.users WHERE user_id=$1 AND status='ACTIVE'",
        [uid],
      );
      const {
        rows: [o],
      } = await client.query(
        "SELECT repository_revision::text AS revision FROM zhiban_identity.users WHERE user_id=$1 AND status='ACTIVE'",
        [cfg.operator.uid],
      );
      const {
        rows: [g],
      } = await client.query(
        'SELECT repository_revision::text AS revision FROM zhiban_identity.system_admin_grants WHERE grant_id=$1 AND user_id=$2 FOR SHARE',
        [cfg.operator.grant, cfg.operator.uid],
      );
      check(u && o && g);
      const at = Date.now();
      return {
        kind: 'LOGIN_IDENTIFIER_NOMINATION',
        environment: cfg.authority.environment,
        sourceRef: ids.nextCommandId(),
        alias,
        userId: uid,
        expectedUserRevision: u.revision,
        operatorUserId: cfg.operator.uid,
        operatorRevision: o.revision,
        grantId: cfg.operator.grant,
        grantRevision: g.revision,
        subjectReference: subject,
        issuedAt: at - 1,
        expiresAt: at + 1799999,
      } as AliasManifest;
    });
    const dir = join(cfg.authority.root, 'login-identifier-approvals');
    await mkdir(dir, { mode: 0o700, recursive: true });
    await privatePath(dir, true);
    const bytes = Buffer.from(JSON.stringify(m)),
      signatures = [];
    for (const role of ['operator', 'approver']) {
      const path = join(cfg.authority.root, `member-${role}.pem`);
      await privatePath(path);
      signatures.push(sign(null, bytes, await readFile(path)).toString('base64'));
    }
    await writeFile(
      join(dir, m.sourceRef + '.json'),
      JSON.stringify({
        kind: 'LOCAL_SYNTHETIC_LOGIN_IDENTIFIER',
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        manifest: m,
        operatorSignature: signatures[0],
        approverSignature: signatures[1],
      }),
      { mode: 0o400, flag: 'wx' },
    );
    return {
      sourceRef: m.sourceRef,
      alias,
      userId: uid,
      expiresAt: m.expiresAt,
      state: 'PREPARED_NOT_REGISTERED',
    };
  });
}
export async function registerLoginIdentifier(
  cfg: MemberControlConfig,
  pools: Pools,
  ref: string,
  inspect = false,
) {
  const m = await loadIdentifierEnvelope(cfg, ref);
  return operator(cfg, pools, async (_c, digest) => {
    const state = async () => {
      const { rows } = await pools.control.query(
        'SELECT * FROM zhiban_login_identifiers.nomination_status($1,$2,$3,$4)',
        [digest, cfg.operator.uid, cfg.operator.grant, ref],
      );
      if (rows.length) {
        check(
          rows.length === 1 &&
            rows[0].source_digest === aliasManifestDigest(m) &&
            rows[0].alias === m.alias &&
            rows[0].user_id === m.userId,
        );
        return {
          ...rows[0],
          outcome: rows[0].current_source === ref ? 'REGISTERED_CURRENT' : 'REGISTERED_SUPERSEDED',
        };
      }
      return null;
    };
    const prior = await state();
    if (prior || inspect)
      return {
        sourceRef: ref,
        ...(prior ?? { outcome: 'NOT_REGISTERED' }),
        sourceExpired: m.expiresAt <= Date.now(),
      };
    const {
      rows: [r],
    } = await pools.control.query(
      'SELECT zhiban_login_identifiers.nominate($1,$2,$3)::text AS revision',
      [m, aliasManifestDigest(m), digest],
    );
    return {
      sourceRef: ref,
      alias: m.alias,
      userId: m.userId,
      revision: r.revision,
      state: 'PENDING_RECIPIENT_CONFIRMATION',
    };
  });
}
