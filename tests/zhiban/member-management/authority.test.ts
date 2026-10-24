import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sign } from 'node:crypto';
import { createLocalAuthority, localAuthorityStore } from '@/scripts/zhiban-local/member-authority';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zhiban-trial-content-'));
  roots.push(root);
  const a = await createLocalAuthority(root, 'LOCAL_ONLY');
  const ref = '01a14f00-0000-7000-8000-000000000001';
  const manifest = {
    purpose: 'MEMBER_ADMISSION',
    environment_ref: 'LOCAL_ONLY',
    approval_ref: ref,
    operator_ref: 'LOCAL_SYNTHETIC_OPERATOR',
    approver_ref: 'LOCAL_SYNTHETIC_APPROVER',
  };
  const bytes = Buffer.from(JSON.stringify(manifest)),
    sigs = [];
  for (const role of ['operator', 'approver'])
    sigs.push(
      sign(null, bytes, await readFile(join(root, `member-${role}.pem`))).toString('base64'),
    );
  const e = {
    kind: 'LOCAL_SYNTHETIC_TWO_AUTHORITY_MEMBER_ADMISSION',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    manifest,
    operatorSignature: sigs[0],
    approverSignature: sigs[1],
  };
  const path = join(root, 'member-approvals', ref + '.json');
  await writeFile(path, JSON.stringify(e), { mode: 0o600 });
  return { a, ref, e, path };
}
describe('LOCAL member evidence boundary', () => {
  it('requires both authority signatures and keeps LOCAL evidence distinct', async () => {
    const f = await fixture();
    expect(await localAuthorityStore(f.a).load(f.ref)).toEqual(f.e.manifest);
  });
  it('rejects an altered purpose/target even with the original signatures', async () => {
    const f = await fixture();
    await writeFile(
      f.path,
      JSON.stringify({ ...f.e, manifest: { ...f.e.manifest, purpose: 'USER_CREATE' } }),
    );
    await expect(localAuthorityStore(f.a).load(f.ref)).rejects.toThrow();
  });
  it('rejects swapped signer keys and a false GitHub label', async () => {
    const f = await fixture();
    await expect(
      localAuthorityStore({
        ...f.a,
        operatorPublic: f.a.approverPublic,
        approverPublic: f.a.operatorPublic,
      }).load(f.ref),
    ).rejects.toThrow();
    await writeFile(f.path, JSON.stringify({ ...f.e, githubActions: true }));
    await expect(localAuthorityStore(f.a).load(f.ref)).rejects.toThrow();
  });
  it('rejects arbitrary path locators and an unrelated root', async () => {
    const f = await fixture();
    await expect(localAuthorityStore(f.a).load('../outside')).rejects.toThrow();
    await expect(createLocalAuthority('/tmp/unrelated', 'LOCAL_ONLY')).rejects.toThrow();
  });
});
