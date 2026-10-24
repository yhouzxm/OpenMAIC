import { PostgresTeacherRelationships } from '@/lib/zhiban/infrastructure/teaching/postgres/relationships';
/** Owned LOCAL cluster only. Existing global user; no credential provisioning or web route. */
import { readFile, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import {
  localAuthorityStore,
  issueLocalAdmission,
  type MemberControlConfig,
} from './member-authority';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { tenantId, membershipId } from '@/lib/zhiban/domain/identity';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
const args = process.argv.slice(2);
async function main() {
  if (
    args.length < 3 ||
    args.length > 4 ||
    !['INVITE', 'REACTIVATE', 'REJOIN'].includes(args[2]) ||
    args.some((x, i) => i < 2 && !/^[0-9a-f-]{36}$/.test(x))
  )
    throw Error(
      'Use: pnpm exec tsx scripts/zhiban-local/prepare-member-admission.ts TENANT USER INVITE|REACTIVATE|REJOIN [MEMBER]',
    );
  const meta = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  if (
    meta.evidenceOrigin !== 'LOCAL' ||
    meta.githubActions !== false ||
    meta.port !== 56517 ||
    meta.database !== 'zhiban_trial_content_disposable' ||
    meta.origin !== 'https://127.0.0.1:3461' ||
    dirname(meta.root) !== tmpdir() ||
    !meta.root.startsWith(join(tmpdir(), 'zhiban-trial-content-'))
  )
    throw Error('Owned LOCAL target rejected');
  const path = join(meta.root, 'member-control.json');
  for (const p of [meta.root, path]) {
    const s = await lstat(p);
    if (s.isSymbolicLink() || s.uid !== process.getuid?.() || s.mode & 0o077)
      throw Error('Private input rejected');
  }
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== meta.sourceHashes[path])
    throw Error('Authority configuration hash mismatch');
  const cfg = JSON.parse(bytes.toString()) as MemberControlConfig;
  if (cfg.kind !== 'LOCAL_SYNTHETIC_MEMBER_CONTROL' || cfg.authority.root !== meta.root)
    throw Error('Control binding rejected');
  const pools: Pool[] = [];
  const pool = (user: string) => {
    const p = new Pool({
      host: join(meta.root, 'socket'),
      port: 56517,
      database: meta.database,
      user,
      max: 2,
      connectionTimeoutMillis: 3000,
      statement_timeout: 10000,
    });
    pools.push(p);
    return p;
  };
  try {
    const auth = pool('zhiban_auth_runtime'),
      tenant = pool('zhiban_runtime'),
      control = pool('zhiban_control_runtime');
    const teacherRelationships = cfg.teacherRelationshipFingerprint
      ? await PostgresTeacherRelationships.create(tenant, cfg.teacherRelationshipFingerprint)
      : undefined;
    const c = await createIdentityComposition(
      { auth, tenant, control },
      {
        ...cfg.composition,
        admission: {
          ...cfg.composition.admission,
          hmacKey: Buffer.from(cfg.composition.admission.hmacKey, 'hex'),
        },
        membership: {
          policy: cfg.composition.membership.policy,
          operator: localAuthorityStore(cfg.authority),
        },
      },
      { teacherRelationships },
    );
    let versions = null;
    if (args[2] !== 'INVITE') {
      if (!args[3]) throw Error('Member ID required');
      const m = await new PostgresMembershipRepository(tenant).findById(
        tenantScopeContext(tenantId(args[0])),
        membershipId(args[3]),
      );
      if (!m || m.value.userId !== args[1]) throw Error('Target binding rejected');
      versions = {
        id: m.value.id,
        revision: m.revision,
        authorizationVersion: m.value.authorizationVersion,
      };
    }
    const id = await issueLocalAdmission(
      cfg.authority,
      c,
      control,
      cfg.operator,
      args[0],
      args[1],
      args[2] as 'INVITE' | 'REACTIVATE' | 'REJOIN',
      versions,
    );
    console.log(
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          syntheticAuthority: true,
          admissionId: id,
          joinUrl: `${meta.origin}/zhiban/join?tenant=${args[0]}&admission=${id}`,
          expiresWithinMinutes: 30,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(pools.map((p) => p.end()));
  }
}
main().catch(() => {
  console.error(
    'LOCAL member admission preparation refused; check arguments, current state and private authority configuration.',
  );
  process.exitCode = 1;
});
