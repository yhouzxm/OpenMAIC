import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyPackageDelta } from './package-provenance.mjs';
const path = 'packages/@openmaic/dsl/src/quiz.ts';
const delta = {
  official: 'c0f296aa36096ec3d1e1e2b94a7a48e20075e0a1',
  sha256: { [path]: createHash('sha256').update('reviewed').digest('hex') },
};
test('only exact reviewed package delta is admitted', () => {
  verifyPackageDelta(delta, [path], () => Buffer.from('reviewed'));
  for (const [d, files, bytes] of [
    [delta, [path], 'tampered'],
    [delta, [], 'reviewed'],
    [delta, [path, 'packages/@openmaic/storage/src/pg.ts'], 'reviewed'],
    [{ ...delta, official: 'old' }, [path], 'reviewed'],
  ])
    assert.throws(() => verifyPackageDelta(d, files, () => Buffer.from(bytes)), /REJECTED/);
});
