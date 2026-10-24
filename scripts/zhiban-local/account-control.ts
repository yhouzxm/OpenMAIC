/** Resolve a pinned, private owned LOCAL control bundle; no password or ticket in argv/stdout. */
import { readFile, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { MemberControlConfig } from './member-authority';
export async function withAccountControl<T>(
  work: (
    cfg: MemberControlConfig,
    pools: { auth: Pool; tenant: Pool; control: Pool; business: Pool },
  ) => Promise<T>,
): Promise<T> {
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
    throw Error('Owned LOCAL account target rejected');
  const path = join(meta.root, 'member-control.json');
  for (const p of [meta.root, join(meta.root, 'socket'), path]) {
    const s = await lstat(p);
    if (s.isSymbolicLink() || s.uid !== process.getuid?.() || s.mode & 0o077)
      throw Error('Private LOCAL input rejected');
  }
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== meta.sourceHashes[path])
    throw Error('Control config source mismatch');
  const cfg = JSON.parse(bytes.toString()) as MemberControlConfig;
  if (
    cfg.kind !== 'LOCAL_SYNTHETIC_MEMBER_CONTROL' ||
    cfg.authority.root !== meta.root ||
    cfg.composition.origin !== meta.origin
  )
    throw Error('Account control binding rejected');
  const opened: Pool[] = [];
  const pool = (user: string) => {
    const p = new Pool({
      host: join(meta.root, 'socket'),
      port: 56517,
      database: meta.database,
      user,
      max: 2,
      connectionTimeoutMillis: 3000,
      statement_timeout: 10000,
      idle_in_transaction_session_timeout: 10000,
    });
    opened.push(p);
    return p;
  };
  try {
    return await work(cfg, {
      auth: pool('zhiban_auth_runtime'),
      tenant: pool('zhiban_runtime'),
      control: pool('zhiban_control_runtime'),
      business: pool('zhiban_academic_runtime'),
    });
  } finally {
    await Promise.all(opened.map((p) => p.end()));
  }
}
