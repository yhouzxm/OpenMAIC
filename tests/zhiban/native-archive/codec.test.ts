/** Pure codec/attack fixtures only; actual scanner/PG/UI is a separate local journey. */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readBoundedZip, crc32 } from '@/lib/zhiban/infrastructure/authoring/archive/zip';
import {
  designOnly,
  mapDesignRefs,
  nativeManifest,
  fromNativeManifest,
} from '@/lib/zhiban/infrastructure/authoring/archive/design';
import { makeDocument, makeSlideScene } from '../../agent-runtime/_stage-fixtures';
import { autonomousProject } from '../classroom-ai/pbl-fixtures';
const zip = async (files: Record<string, string>, compression: 'STORE' | 'DEFLATE' = 'DEFLATE') => {
  const z = new JSZip();
  for (const [p, b] of Object.entries(files)) z.file(p, b);
  return z.generateAsync({ type: 'nodebuffer', compression });
};
describe('bounded native archive codec', () => {
  it('reads real STORE and DEFLATE archives with native directory entries', async () => {
    for (const compression of ['STORE', 'DEFLATE'] as const) {
      const bytes = await zip({ 'manifest.json': '{}', 'media/test.txt': 'design' }, compression);
      const files = await readBoundedZip(bytes);
      expect(files.get('media/test.txt')!.toString()).toBe('design');
    }
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
  it('rejects traversal before decompressing', async () => {
    await expect(readBoundedZip(await zip({ '../escape': 'bad' }))).rejects.toThrow();
  });
  it('rejects CRC corruption and encrypted entries', async () => {
    const bytes = await zip({ 'manifest.json': '{}' }, 'STORE');
    const data = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
    bytes[data] ^= 1;
    await expect(readBoundedZip(bytes)).rejects.toThrow();
    const encrypted = await zip({ 'manifest.json': '{}' });
    encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
    await expect(readBoundedZip(encrypted)).rejects.toThrow();
  });
  it('enforces claimed expansion size while inflating, rather than after allocation', async () => {
    const bytes = await zip({ payload: 'x'.repeat(1024 * 1024) });
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(1, central + 24);
    await expect(readBoundedZip(bytes)).rejects.toThrow();
  });
  it('rejects duplicate names and Unix symbolic links', async () => {
    const bytes = await zip({ a: 'x', b: 'y' });
    let n = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    n = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), n + 4);
    bytes[n + 46] = 'a'.charCodeAt(0);
    await expect(readBoundedZip(bytes)).rejects.toThrow();
    const z = new JSZip();
    z.file('link', 'target', { unixPermissions: 0xa1ff });
    await expect(
      readBoundedZip(await z.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })),
    ).rejects.toThrow();
  });
  it('drops private runtime/producer data and strips PBL learner state', () => {
    const p = autonomousProject();
    p.submissions.push({
      id: 'private',
      kind: 'text',
      content: 'private work',
      microtaskId: 'task-1',
      createdAt: '',
    });
    p.threads[0].messages.push({
      id: 'private-message',
      roleType: 'user',
      content: 'private chat',
      ts: '',
    });
    const doc = makeDocument('source', 'title', [
      { ...makeSlideScene('p', 'source', 0), type: 'pbl', content: { type: 'pbl', projectV2: p } },
    ]);
    const clean = designOnly({ ...doc, chats: [{ private: 'secret' }] } as never);
    expect(clean.outline).toBeUndefined();
    expect(JSON.stringify(clean)).not.toContain('private');
    expect(clean.scenes[0].content.type).toBe('pbl');
  });
  it('round-trips native narration/roster mappings and all design media slots', () => {
    const scene = makeSlideScene('s', 'stage', 0);
    scene.actions = [{ id: 'speech', type: 'speech', text: 'script', audioId: 'audio' }];
    const doc = makeDocument('stage', 'test', [scene]);
    const m = nativeManifest(doc, {
      'audio/test.wav': { type: 'audio', sourceRef: 'audio', mimeType: 'audio/wav' },
    });
    const restored = fromNativeManifest(m);
    expect(restored.scenes[0].actions?.[0]).toMatchObject({ text: 'script', audioId: 'audio' });
    mapDesignRefs(restored, new Map([['audio', 'fresh']]));
    expect(restored.scenes[0].actions?.[0]).toMatchObject({ audioId: 'fresh' });
  });
});
