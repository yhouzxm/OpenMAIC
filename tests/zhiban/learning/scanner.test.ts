import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  clamAvArgs,
  loadClamAv,
  type ClamAvProfile,
} from '../../../lib/zhiban/infrastructure/learning-files/scanner/clamav';
describe('host scanner trust boundary (no simulated malware clearance)', () => {
  it('rejects wrong profile pin, stale database, writable profile and symlink before execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhiban-scanner-test-'));
    try {
      const db = join(root, 'db'),
        lib = join(root, 'lib'),
        certs = join(root, 'certs');
      for (const dir of [db, lib, certs]) await mkdir(dir, { mode: 0o700 });
      for (const name of ['main', 'daily', 'bytecode'])
        await writeFile(join(db, name + '.cvd'), 'ClamAV-VDB:expired:1:1:1:x:y:z:1'.padEnd(512));
      const p: ClamAvProfile = {
        version: 1,
        evidenceOrigin: 'LOCAL',
        binary: join(root, 'missing'),
        libraryPath: lib,
        database: db,
        certificates: certs,
        engineVersion: 'ClamAV 1.5.4',
        files: {},
      };
      const raw = JSON.stringify(p),
        path = join(root, 'profile.json');
      const hash = createHash('sha256').update(raw).digest('hex');
      await writeFile(path, raw, { mode: 0o600 });
      await expect(loadClamAv(path, '0'.repeat(64))).rejects.toThrow('hash rejected');
      await expect(loadClamAv(path, hash)).rejects.toThrow('database stale');
      await chmod(path, 0o666);
      await expect(loadClamAv(path, hash)).rejects.toThrow('ownership rejected');
      await chmod(path, 0o600);
      const link = join(root, 'link');
      await symlink(path, link);
      await expect(loadClamAv(link, hash)).rejects.toThrow('ownership rejected');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('requires official recent signatures and rejects encrypted/over-limit content; scans stdin', () => {
    const args = clamAvArgs({ database: '/db', certificates: '/certs' } as ClamAvProfile);
    expect(args).toContain('--official-db-only=yes');
    expect(args).toContain('--fail-if-cvd-older-than=7');
    expect(args).toContain('--alert-encrypted=yes');
    expect(args).toContain('--alert-exceeds-max=yes');
    expect(args.at(-1)).toBe('-');
  });
});
