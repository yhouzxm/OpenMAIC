import { expect, it, vi } from 'vitest';
import { classroomImageTool } from '@/lib/zhiban/infrastructure/classroom-ai/vision';
it('reads only a bounded server selection and refuses invalid indices before loading', async () => {
  const load = vi.fn(async () => ({
    bytes: Buffer.from('fixture'),
    mime: 'image/png',
    digest: 'digest',
  }));
  const tool = classroomImageTool({
    count: 1,
    sourceDigest: 'publication',
    guard: (work) => work(),
    load,
  })!;
  const r = await tool.execute('read', { index: 0 });
  expect(r.content[0].type).toBe('image');
  expect(r.details).toEqual({ sourceDigest: 'publication', assetDigest: 'digest' });
  await expect(tool.execute('foreign', { index: 1 })).rejects.toThrow();
  expect(load).toHaveBeenCalledTimes(1);
  load.mockRejectedValueOnce(new Error('revoked'));
  await expect(tool.execute('revoked', { index: 0 })).rejects.toThrow('revoked');
  expect(
    classroomImageTool({ count: 0, sourceDigest: 'none', guard: (work) => work(), load }),
  ).toBeUndefined();
});

it('does not hold a live fence during independently locked reads and refuses revocation before delivery', async () => {
  let held = false,
    authorized = true;
  let loaded!: () => void, release!: () => void;
  const hasLoaded = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  const readBarrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tool = classroomImageTool({
    count: 1,
    sourceDigest: 'fixed',
    load: async () => {
      expect(held).toBe(false);
      loaded();
      await readBarrier;
      return { bytes: Buffer.from('fixture'), mime: 'image/png', digest: 'asset' };
    },
    guard: async (work) => {
      if (!authorized) throw Error('revoked');
      held = true;
      try {
        return await work();
      } finally {
        held = false;
      }
    },
  })!;
  const execution = tool.execute('concurrent-revocation', { index: 0 });
  await hasLoaded;
  authorized = false;
  release();
  await expect(execution).rejects.toThrow('revoked');
  expect(held).toBe(false);
});
