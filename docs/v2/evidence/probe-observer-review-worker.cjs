// REVIEW TEST ONLY. Fault adapter rejects real targets before imports/instrumentation.
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process');
const [approvalPath, publicKeyPath, pin, mode] = process.argv.slice(2),
  p = JSON.parse(fs.readFileSync(approvalPath)).payload;
if (
  p.target.environment !== 'LOCAL_DISPOSABLE' ||
  !/^\/tmp\/zhiban-observer-pg16-[A-Za-z0-9_-]+\/data$/.test(p.target.dataDirectory) ||
  p.target.port !== 56497
)
  throw Error('DISPOSABLE_REVIEW_ONLY');
const source = path.resolve(__dirname, '../candidates/m5-readonly-startup');
const spawn = cp.spawn;
cp.spawn = (file, args, options) => {
  const guardian = path.basename(args[0] || '') === 'observer-guardian.cjs';
  const actualArgs =
    guardian && mode === 'short-release-journal'
      ? [path.join(__dirname, 'probe-observer-review-guardian.cjs'), ...args.slice(1)]
      : args;
  const child = spawn(file, actualArgs, options);
  if (guardian && mode === 'release-ack-lost') {
    const emit = child.emit.bind(child);
    child.emit = (name, ...rest) =>
      name === 'message' && rest[0]?.type === 'released' ? true : emit(name, ...rest);
  }
  return child;
};
const c = require(path.join(source, 'observer-contract.cjs')),
  journal = c.journal;
c.journal = (stage, event) => {
  journal(stage, event);
  if (mode === 'pgpass-drift' && event.state === 'START_BOUND')
    fs.appendFileSync(p.paths.pgpassFilePath, '# TEST_ONLY_UNAPPROVED_BYTES\n');
};
require(path.join(source, 'observer-executor.cjs'))
  .run({ approvalPath, publicKeyPath, trustedPublicKeySha256: pin })
  .then(({ result }) => {
    console.log(JSON.stringify(result));
    process.exitCode = result.status === 'OBSERVED_STOP_CONFIRMED' ? 0 : 2;
  })
  .catch((e) => {
    console.log(
      JSON.stringify({
        status: 'REJECTED',
        code: /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'PRIVATE_REVIEW_ERROR',
      }),
    );
    process.exitCode = 2;
  });
