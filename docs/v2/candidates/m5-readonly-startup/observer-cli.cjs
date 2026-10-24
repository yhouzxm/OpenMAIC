#!/usr/bin/env node
const e = require('./observer-executor.cjs');
(async () => {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === 'inspect') console.log(JSON.stringify(e.inspect(args[1])));
  else if (args.length === 4 && args[0] === 'observe') {
    const { result } = await e.run({
      approvalPath: args[1],
      publicKeyPath: args[2],
      trustedPublicKeySha256: args[3],
    });
    console.log(JSON.stringify(result));
    process.exitCode = result.status === 'OBSERVED_STOP_CONFIRMED' ? 0 : 2;
  } else throw Error('EXPLICIT_APPROVAL_AND_EXTERNAL_PIN_REQUIRED');
})().catch((e) => {
  console.log(
    JSON.stringify({
      status: 'REJECTED',
      code: /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'PRIVATE_INPUT_REJECTED',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      runtimeAccepted: false,
      launchAllowed: false,
    }),
  );
  process.exitCode = 2;
});
