// Disposable fixture only. No real-target launcher or credentials in argv/env/stdout.
const fs = require('node:fs'),
  path = require('node:path'),
  c = require('./release-contract.cjs');
if (process.argv[2] !== '--local-disposable-only' || !process.connected)
  throw Error('Disposable worker entry rejected');
const input = JSON.parse(c.bytes(process.argv[3]));
c.insist(
  input.directory.startsWith('/tmp/zhiban-release-pg16-') &&
    fs.realpathSync(input.directory) === input.directory,
  'Dedicated fixture root required',
);
const gate = JSON.parse(c.bytes(path.join(input.directory, 'maintenance.json')));
c.insist(c.UUID.test(gate.payload?.releaseId), 'Disposable release required');
const cfg = JSON.parse(
    c.bytes(path.join(input.directory, 'releases', gate.payload.releaseId, 'ordinary.json')),
  ),
  fixture = path.dirname(input.directory);
c.insist(
  cfg.target?.environment === 'LOCAL_DISPOSABLE' &&
    cfg.target.port === 56496 &&
    cfg.target.dataDirectory === path.join(fixture, 'data') &&
    cfg.target.socketDirectory === path.join(fixture, 'socket'),
  'Worker rejects real target configuration',
);
require('./ordinary-launcher.cjs')
  .launch(input)
  .then((host) => {
    process.send({ type: 'READY', childPid: host.childPid });
    host.done.then((result) => {
      process.send?.({ type: 'DONE', status: result.status }, () => {});
      process.disconnect?.();
    });
  })
  .catch(() => {
    process.send?.({ type: 'FAILED' }, () => {});
    process.exitCode = 1;
    process.disconnect?.();
  });
