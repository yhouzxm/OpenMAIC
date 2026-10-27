/** Injected lifecycle checks only. These do NOT establish real external-service success. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContentService } from '@/lib/zhiban/infrastructure/content/service';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
const io = vi.hoisted(() => ({
  image: vi.fn(),
  tts: vi.fn(),
  put: vi.fn(),
  resolve: vi.fn(),
  files: new Map<string, Buffer>(),
}));
vi.mock('@/app/api/generate/image/route', () => ({ POST: io.image }));
vi.mock('@/app/api/generate/tts/route', () => ({ POST: io.tts }));
vi.mock('@/lib/server/materials/bytes', () => ({
  getMaterialByteStore: () => ({
    get: async (k: string) => {
      if (!io.files.has(k)) throw Object.assign(Error(), { code: 'ENOENT' });
      return io.files.get(k);
    },
    put: async (k: string, b: Buffer) => {
      io.files.set(k, b);
    },
    list: async () => [...io.files.keys()].map((key) => ({ key, modifiedAt: Date.now() })),
  }),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({ assetStore: { put: io.put, resolve: io.resolve } }),
}));
import { AuthoringMediaService } from '@/lib/zhiban/infrastructure/authoring/media/service';
import { ContentError } from '@/lib/zhiban/infrastructure/content/model';
function setup(customBytes?: Buffer) {
  let allowed = true;
  const release = vi.fn(),
    query = vi.fn(async () => ({ rows: [{ held: true }] }));
  const content = {
    authoring: async (_x: unknown, work: () => Promise<unknown>) => {
      if (!allowed) throw new ContentError('FORBIDDEN', 403);
      return work();
    },
  } as ContentService;
  const bytes = customBytes ?? Buffer.from('89504e470d0a1a0a00000000', 'hex'),
    digest = createHash('sha256').update(bytes).digest('hex');
  const service = new AuthoringMediaService(
    content,
    { connect: async () => ({ query, release }) } as unknown as Pool,
    {
      mode: 'TRUSTED_SCANNER',
      check: vi.fn(),
      checkArchive: async () => ({
        mode: 'TRUSTED_SCANNER',
        digest,
        reference: 'INJECTED_NOT_REAL_SCAN',
      }),
    },
  );
  vi.spyOn(service, 'status').mockResolvedValue({
    kinds: Object.fromEntries(
      ['image', 'video', 'tts', 'asr'].map((k) => [k, { available: true }]),
    ),
  } as never);
  io.put.mockResolvedValue('owned-asset');
  io.resolve.mockResolvedValue({ bytes, mime: customBytes ? 'audio/wav' : 'image/png' });
  const ok = () =>
    new Response(
      JSON.stringify({
        success: true,
        result: { base64: bytes.toString('base64'), mimeType: 'image/png', width: 10, height: 10 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  const req = (signal?: AbortSignal) =>
    new Request('https://local.invalid/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiban-command': 'injected-stable-key' },
      body: JSON.stringify({ prompt: 'lesson' }),
      signal,
    });
  return {
    service,
    ok,
    req,
    release,
    revoke: () => {
      allowed = false;
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  io.files.clear();
});
describe('media lifecycle and original-request authorization (injected)', () => {
  it('refuses original request before provider execution', async () => {
    const s = setup();
    s.revoke();
    await expect(s.service.execute({} as never, 'image', s.req())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(io.image).not.toHaveBeenCalled();
  });
  it('does not write an asset after revocation during a provider call', async () => {
    const s = setup();
    io.image.mockImplementation(async () => {
      s.revoke();
      return s.ok();
    });
    await expect(s.service.execute({} as never, 'image', s.req())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(io.put).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalled();
  });
  it('retains the execution slot after cancellation until the native producer settles', async () => {
    const s = setup();
    let done!: (r: Response) => void;
    io.image.mockImplementation(
      () =>
        new Promise((r) => {
          done = r;
        }),
    );
    const c = new AbortController(),
      pending = s.service.execute({} as never, 'image', s.req(c.signal));
    await vi.waitFor(() => expect(io.image).toHaveBeenCalledTimes(1));
    c.abort();
    await expect(pending).rejects.toMatchObject({ code: 'MEDIA_CANCELLED' });
    await expect(s.service.execute({} as never, 'image', s.req())).rejects.toMatchObject({
      code: 'MEDIA_BUSY',
    });
    done(s.ok());
    await vi.waitFor(() => expect(s.release).toHaveBeenCalled());
    expect(io.put).not.toHaveBeenCalled();
  });
  it('persists unknown outcome and refuses paid replay, while ready results replay without a new producer', async () => {
    const s = setup();
    io.image.mockRejectedValueOnce(Error('injected disconnect'));
    await expect(s.service.execute({} as never, 'image', s.req())).rejects.toThrow('disconnect');
    await expect(s.service.execute({} as never, 'image', s.req())).rejects.toMatchObject({
      code: 'MEDIA_OUTCOME_UNKNOWN',
    });
    expect(io.image).toHaveBeenCalledTimes(1);
    io.files.clear();
    io.image.mockResolvedValue(s.ok());
    const a = await s.service.execute({} as never, 'image', s.req());
    const b = await s.service.execute({} as never, 'image', s.req());
    expect(a.assetId).toBe(b.assetId);
    expect(io.image).toHaveBeenCalledTimes(2);
    expect(io.put).toHaveBeenCalledTimes(1);
  });
});

it('keeps original TTS narration with saved/replayed audio (injected, not real speech)', async () => {
  const wav = Buffer.alloc(60);
  wav.write('RIFF');
  wav.writeUInt32LE(52, 4);
  wav.write('WAVE', 8);
  const s = setup(wav);
  io.tts.mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        audioId: 'narration',
        format: 'wav',
        base64: wav.toString('base64'),
      }),
    ),
  );
  const req = () =>
    new Request('https://local.invalid/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiban-command': 'tts-stable' },
      body: JSON.stringify({ text: '原讲稿', audioId: 'narration' }),
    });
  const a = await s.service.execute({} as never, 'tts', req());
  const b = await s.service.execute({} as never, 'tts', req());
  expect(a.speechText).toBe('原讲稿');
  expect(b.speechText).toBe('原讲稿');
  expect(io.tts).toHaveBeenCalledTimes(1);
});
import { authoringOwner } from '@/lib/zhiban/infrastructure/authoring/host';
it('does not show an old unacknowledged job as running merely because another job is active (injected)', async () => {
  const s = setup(),
    old = 'f'.repeat(64),
    owner = authoringOwner({} as never),
    prefix = 'media-jobs/' + createHash('sha256').update(owner).digest('hex') + '/';
  io.files.set(
    prefix + old + '.json',
    Buffer.from(JSON.stringify({ version: 1, kind: 'image', status: 'RUNNING', startedAt: 1 })),
  );
  let done!: (r: Response) => void;
  io.image.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      }),
  );
  const pending = s.service.execute({} as never, 'image', s.req());
  await vi.waitFor(() => expect(io.image).toHaveBeenCalledTimes(1));
  const jobs = await s.service.jobs({} as never);
  expect(jobs.items.find((j: { id: string }) => j.id === old)?.status).toBe('UNKNOWN');
  expect(
    jobs.items.some((j: { id: string; status: string }) => j.id !== old && j.status === 'RUNNING'),
  ).toBe(true);
  done(s.ok());
  await pending;
});
