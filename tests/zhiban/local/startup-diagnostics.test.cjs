/* eslint-disable @typescript-eslint/no-require-imports -- Real owner-only trace I/O. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  cp = require('node:child_process');
const {
  sanitizeTrace,
  readStartupTrace,
} = require('../../../scripts/zhiban-ci/startup-diagnostics.cjs');
const { publicReport } = require('../../../scripts/zhiban-ci/portable-acceptance.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-structured-startup-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file: path.join(root, 'startup-start-rebind.jsonl') };
}
test('real child records content rebind ENOENT without message, path, stack or credentials', (t) => {
  const { root, file } = fixture(t);
  const helper = path.resolve(__dirname, '../../../scripts/zhiban-ci/startup-diagnostics.cjs');
  cp.execFileSync(
    process.execPath,
    [
      '-e',
      `const d=require(process.argv[1]).createStartupDiagnostics('HOST');d.enter('PG_START');d.enter('CONTENT_REBIND');try{require('fs').readFileSync('/private/no-such-source-credential');}catch(e){e.message+=' secret-password';d.fail(e);}`,
      helper,
    ],
    {
      env: { ...process.env, ZHIBAN_LOCAL_STATE: root, ZHIBAN_LOCAL_STARTUP_TRACE: file },
    },
  );
  const trace = readStartupTrace(root, 'start-rebind');
  assert.equal(trace.at(-1).phase, 'CONTENT_REBIND');
  assert.equal(trace.at(-1).state, 'FAIL');
  assert.equal(trace.at(-1).errorCode, 'ENOENT');
  assert.ok(Number.isSafeInteger(trace.at(-1).phaseMs));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const publicValue = publicReport({
    status: 'FAIL',
    diagnostic: { code: 'HOST_EXITED', startupTrace: trace },
  });
  assert.equal(publicValue.diagnostic.startupTrace.at(-1).errorCode, 'ENOENT');
  for (const text of [fs.readFileSync(file, 'utf8'), JSON.stringify(publicValue)]) {
    assert.ok(
      !text.includes('secret-password') && !text.includes('/private/') && !text.includes('stack'),
    );
  }
});
test('trace rejects links, world-readable files, oversized data and output outside owned state', (t) => {
  const { root, file } = fixture(t),
    outside = path.join(root, 'outside');
  fs.writeFileSync(outside, 'unchanged', { mode: 0o600 });
  fs.symlinkSync(outside, file);
  assert.deepEqual(readStartupTrace(root, 'start-rebind'), []);
  fs.unlinkSync(file);
  fs.writeFileSync(file, '{}\n', { mode: 0o644 });
  assert.deepEqual(readStartupTrace(root, 'start-rebind'), []);
  fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, 'x'.repeat(140001));
  assert.deepEqual(readStartupTrace(root, 'start-rebind'), []);
  assert.deepEqual(readStartupTrace(root, '../../outside'), []);
});
test('unknown phases and attacker fields cannot survive cleanup/public filtering; malformed tail tolerated', (t) => {
  const { root, file } = fixture(t);
  const event = {
    layer: 'HOST',
    phase: 'CONTENT_REBIND',
    state: 'FAIL',
    errorCode: 'ENOENT',
    message: 'secret',
    stack: 'private',
    path: '/private/file',
    phaseMs: 1,
    elapsedMs: 2,
  };
  fs.writeFileSync(file, JSON.stringify(event) + '\n{"partial"', { mode: 0o600 });
  assert.deepEqual(readStartupTrace(root, 'start-rebind'), sanitizeTrace([event]));
  assert.deepEqual(
    sanitizeTrace([
      { ...event, phase: 'secret-phase' },
      { ...event, layer: 'secret' },
    ]),
    [],
  );
  assert.equal(sanitizeTrace(Array(300).fill(event)).length, 128);
  assert.deepEqual(publicReport({ startupTrace: [event] }).startupTrace, sanitizeTrace([event]));
});
