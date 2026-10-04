import { describe, expect, test, vi } from 'vitest';
import { DiagnosticBoundary, DiagnosticRejected, safeMedia } from './boundary';
import { createMemoryFixture } from './memory-harness';
import { document, PNG } from './fixtures';
import { projectSlide } from './preview';
import { validateDiagnosticDatabase } from './pg-harness';

describe('D02-D06 local public-backend boundary contracts', () => {
  test('authorized document/scene/list/asset/preview controls perform real public calls', async () => {
    const f = await createMemoryFixture();
    expect((await f.boundary.document('studentA1', f.stages.A)).stage.id).toBe(f.stages.A);
    expect((await f.boundary.scene('studentA1', f.stages.A, `${f.stages.A}-scene`)).stageId).toBe(
      f.stages.A,
    );
    expect((await f.boundary.list('studentA1')).map((d) => d.stage.id)).toEqual([f.stages.A]);
    expect((await f.boundary.bytes('studentA1', f.stages.A, 'png')).bytes).toEqual(PNG);
    expect((await f.boundary.preview('studentA1', f.stages.A)).elements.length).toBe(4);
    expect(f.boundary.calls).toEqual({ document: 3, scene: 1, asset: 1, runtime: 0, write: 0 });
  });
  test.each(['studentA2', 'studentB', 'adminA', 'unknown'])(
    'same/cross-tenant and admin have no fallback: %s',
    async (alias) => {
      const f = await createMemoryFixture();
      await expect(f.boundary.document(alias, f.stages.A)).rejects.toThrow(DiagnosticRejected);
      await expect(f.boundary.bytes(alias, f.stages.A, 'png')).rejects.toThrow(DiagnosticRejected);
      expect(f.boundary.calls.document + f.boundary.calls.asset).toBe(0);
    },
  );
  test.each(['PENDING', 'ORPHAN', 'TRANSFERRING', 'REVOKED'] as const)(
    'mapping %s stays unreadable before store invocation',
    async (state) => {
      const f = await createMemoryFixture();
      f.authority.mappings.get(f.stages.A)!.state = state;
      await expect(
        f.boundary.scene('studentA1', f.stages.A, `${f.stages.A}-scene`),
      ).rejects.toThrow(DiagnosticRejected);
      expect(f.boundary.calls.scene).toBe(0);
    },
  );
  test('mixed authorized/foreign batch is rejected before any load', async () => {
    const f = await createMemoryFixture();
    await expect(f.boundary.batch('studentA1', [f.stages.A, f.stages.B])).rejects.toThrow(
      DiagnosticRejected,
    );
    expect(f.boundary.calls.document).toBe(0);
  });
  test('same principal does not grant an unrelated asset', async () => {
    const f = await createMemoryFixture();
    await expect(f.boundary.bytes('studentA1', f.stages.A, 'hidden')).rejects.toThrow(
      DiagnosticRejected,
    );
    expect(f.boundary.calls.asset).toBe(0);
  });
  test('revoke/disable during asynchronous read prevents bytes/content return', async () => {
    const f = await createMemoryFixture();
    const original = f.docs.loadDocument.bind(f.docs);
    vi.spyOn(f.docs, 'loadDocument').mockImplementation(async (stage) => {
      const doc = await original(stage);
      f.authority.subjects.get('studentA1')!.active = false;
      return doc;
    });
    await expect(f.boundary.document('studentA1', f.stages.A)).rejects.toThrow(DiagnosticRejected);
  });
  test('asset removal during asynchronous fetch prevents return', async () => {
    const f = await createMemoryFixture();
    const boundary = new DiagnosticBoundary(f.authority, {
      document: () => f.docs,
      runtime: f.runtime,
      asset: {
        resolve: async () => {
          f.authority.mappings.get(f.stages.A)!.assets.delete('png');
          return { bytes: PNG, mime: 'image/png', revision: 1 };
        },
      },
    });
    await expect(boundary.bytes('studentA1', f.stages.A, 'png')).rejects.toThrow(
      DiagnosticRejected,
    );
  });
  test('runtime Attempt mutation during read invalidates the captured server binding', async () => {
    const f = await createMemoryFixture();
    const original = f.runtime.getSession.bind(f.runtime);
    vi.spyOn(f.runtime, 'getSession').mockImplementation(async (session) => {
      const row = await original(session);
      f.authority.bindings.get(session)!.attempt = 'foreign-attempt';
      return row;
    });
    await expect(f.boundary.runtime('studentA1', f.sessions.A)).rejects.toThrow(DiagnosticRejected);
  });
  test('actor version, deployment and ownership changes invalidate captured proof', async () => {
    const f = await createMemoryFixture();
    const proof = f.authority.capture('studentA1', f.stages.A);
    f.authority.subjects.get('studentA1')!.version = '2';
    expect(() => f.authority.fresh(proof)).toThrow(DiagnosticRejected);
    f.authority.mappings.get(f.stages.A)!.deployment = 'foreign';
    await expect(f.boundary.document('studentA1', f.stages.A)).rejects.toThrow(DiagnosticRejected);
  });
  test('public runtime read/append is server-bound and stale tail fails', async () => {
    const f = await createMemoryFixture();
    await f.runtime.appendRecord(
      {
        id: 'direct-control',
        sessionId: f.sessions.A2,
        createdAt: new Date().toISOString(),
        payload: { role: 'user', content: 'Synthetic response' },
      },
      { expectedLastSeq: null },
    );
    expect((await f.boundary.runtime('studentA1', f.sessions.A)).learnerKey).toBe(
      f.authority.subjects.get('studentA1')!.learner,
    );
    const record = await f.boundary.append('studentA1', f.sessions.A, null, 'Synthetic response');
    expect(record.seq).toBe(0);
    await expect(f.boundary.append('studentA1', f.sessions.A, null, 'stale')).rejects.toThrow(
      DiagnosticRejected,
    );
    expect((await f.boundary.records('studentA1', f.sessions.A)).length).toBe(1);
  });
  test.each(['studentA2', 'studentB', 'teacherA'])(
    'other learner cannot use session id: %s',
    async (alias) => {
      const f = await createMemoryFixture();
      await expect(f.boundary.runtime(alias, f.sessions.A)).rejects.toThrow(DiagnosticRejected);
      expect(f.boundary.calls.runtime).toBe(0);
    },
  );
  test('runtime binding mismatch and terminal state fail closed', async () => {
    const f = await createMemoryFixture();
    f.authority.bindings.get(f.sessions.A)!.stage = f.stages.A2;
    await expect(f.boundary.runtime('studentA1', f.sessions.A)).rejects.toThrow(DiagnosticRejected);
    f.authority.bindings.get(f.sessions.A)!.stage = f.stages.A;
    await f.runtime.setSessionStatus(f.sessions.A, 'completed', '2026-01-01T00:01:00.000Z');
    await expect(f.boundary.runtime('studentA1', f.sessions.A)).rejects.toThrow(DiagnosticRejected);
  });
  test('save reserves CAS; stale-before-no-op and max revision fail before write', async () => {
    const f = await createMemoryFixture();
    await f.boundary.save('teacherA', f.stages.A, '1', document(f.stages.A));
    expect(f.authority.mappings.get(f.stages.A)!.revision).toBe('2');
    await expect(
      f.boundary.save('teacherA', f.stages.A, '1', document(f.stages.A)),
    ).rejects.toThrow(DiagnosticRejected);
    f.authority.mappings.get(f.stages.A)!.revision = '9223372036854775807';
    await expect(
      f.boundary.save('teacherA', f.stages.A, '9223372036854775807', document(f.stages.A)),
    ).rejects.toThrow(DiagnosticRejected);
    expect(f.boundary.calls.write).toBe(1);
  });
  test('external save failure terminalizes reservation as unreadable orphan', async () => {
    const f = await createMemoryFixture();
    vi.spyOn(f.docs, 'saveDocument').mockRejectedValue(new Error('untrusted driver detail'));
    await expect(
      f.boundary.save('teacherA', f.stages.A, '1', document(f.stages.A)),
    ).rejects.toThrow(DiagnosticRejected);
    expect(f.authority.mappings.get(f.stages.A)!.state).toBe('ORPHAN');
    await expect(f.boundary.document('studentA1', f.stages.A)).rejects.toThrow(DiagnosticRejected);
  });
  test.each(['writer', 'owner', 'tenant', 'deployment'] as const)(
    'save cannot reactivate a mapping after asynchronous %s change',
    async (change) => {
      const f = await createMemoryFixture();
      const original = f.docs.saveDocument.bind(f.docs);
      vi.spyOn(f.docs, 'saveDocument').mockImplementation(async (doc) => {
        await original(doc);
        const mapping = f.authority.mappings.get(f.stages.A)!;
        if (change === 'writer') mapping.writers.delete('teacherA');
        else mapping[change] = 'foreign';
      });
      await expect(
        f.boundary.save('teacherA', f.stages.A, '1', document(f.stages.A)),
      ).rejects.toThrow(DiagnosticRejected);
      expect(f.authority.mappings.get(f.stages.A)!.state).toBe('ORPHAN');
    },
  );
  test('storage exception custom fields/cause never cross closed error', async () => {
    const f = await createMemoryFixture();
    const bad = Object.assign(new Error('untrusted-detail'), {
      code: 'hostile-code',
      cause: new Error('hostile-cause'),
    });
    vi.spyOn(f.docs, 'loadDocument').mockRejectedValue(bad);
    const error = await f.boundary.document('studentA1', f.stages.A).catch((e) => e as Error);
    expect(error).toBeInstanceOf(DiagnosticRejected);
    expect(Reflect.ownKeys(error)).not.toContain('cause');
    expect(Reflect.ownKeys(error)).not.toContain('code');
    expect((error as Error).message).toBe('DIAGNOSTIC_REJECTED');
  });
  test('malformed loaded row is rejected rather than repaired', async () => {
    const f = await createMemoryFixture();
    vi.spyOn(f.docs, 'loadDocument').mockResolvedValue(document('other-stage'));
    await expect(f.boundary.document('studentA1', f.stages.A)).rejects.toThrow(DiagnosticRejected);
  });
  test.each([
    'https://outside.invalid/x',
    'javascript:alert(1)',
    'data:image/svg+xml,x',
    '//outside.invalid/x',
  ])('preview rejects external/active source %s', async (source) => {
    const f = await createMemoryFixture();
    const canvas = document(f.stages.A).scenes[0].content;
    if (canvas.type !== 'slide' || canvas.canvas.elements[0].type !== 'image')
      throw new Error('fixture');
    canvas.canvas.elements[0].src = source;
    expect(() => projectSlide(canvas.canvas, (id) => `/diag/${id}`)).toThrow('DIAGNOSTIC_REJECTED');
  });
  test('rich HTML, CSS/handlers and interactive/non-slide scenes cannot execute', async () => {
    const f = await createMemoryFixture();
    const doc = document(f.stages.A);
    if (doc.scenes[0].content.type !== 'slide') throw new Error('fixture');
    const canvas = doc.scenes[0].content.canvas;
    const text = canvas.elements[3];
    if (text.type !== 'text') throw new Error('fixture');
    text.content = '<img src=x onerror=alert(1)>';
    expect(() => projectSlide(canvas, (id) => id)).toThrow('DIAGNOSTIC_REJECTED');
    vi.spyOn(f.docs, 'loadDocument').mockResolvedValue({
      ...doc,
      scenes: [{ ...doc.scenes[0], type: 'interactive' }],
    } as unknown as typeof doc);
    await expect(f.boundary.preview('studentA1', f.stages.A)).rejects.toThrow(DiagnosticRejected);
  });
  test('media gate rejects active HTML/SVG and spoofed MIME', () => {
    expect(safeMedia('text/html', Buffer.from('<script>'))).toBe(false);
    expect(safeMedia('image/svg+xml', Buffer.from('<svg>'))).toBe(false);
    expect(safeMedia('image/png', Buffer.from('<script>'))).toBe(false);
    expect(safeMedia('image/png', PNG)).toBe(true);
  });
  test.each([
    'postgresql://127.0.0.1/openmaic',
    'postgresql://127.0.0.1/zhiban_pg16_test',
    'postgresql://outside.invalid/zhiban_0b_capability_test',
    'not-a-url',
  ])('database guard rejects existing/foreign target %s', (value) => {
    expect(() => validateDiagnosticDatabase(value)).toThrow('DIAGNOSTIC_DATABASE_REJECTED');
  });
  test('admission credential is server-generated and unknown material has one rejection', async () => {
    const f = await createMemoryFixture();
    expect(f.authority.authenticate(f.credential.studentA1)).toBe('studentA1');
    expect(f.credential.studentA1 === f.credential.studentA2).toBe(false);
    expect(() => f.authority.authenticate('client-role=teacher')).toThrow(DiagnosticRejected);
  });
  test('missing required record returns closed failure with no broad runtime fallback', async () => {
    const f = await createMemoryFixture();
    vi.spyOn(f.runtime, 'getSession').mockResolvedValue(undefined);
    await expect(f.boundary.records('studentA1', f.sessions.A)).rejects.toThrow(DiagnosticRejected);
    expect(f.boundary.calls.runtime).toBe(1);
  });
});
