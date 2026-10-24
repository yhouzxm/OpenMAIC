// Private validation launcher. No signing key, SQL mutation, listener or host activation.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const h = require('./handoff-contracts.cjs'),
  c = require('./release-contract.cjs'),
  physical = require('./physical-closure.cjs');
const m = require('../m5-terminal/maintenance-lock.cjs');
async function run(input) {
  c.keys(input, [
    'controlDirectory',
    'approvalPath',
    'expectedPath',
    'authorityPublicKeyPath',
    'compatibilityReceiptPath',
    'transportEvidencePath',
    'previousCredentialsPath',
    'shadowEvidencePath',
  ]);
  c.directory(input.controlDirectory);
  h.privateBytes(input.authorityPublicKeyPath);
  const source = h.sources(),
    pin = h.publicPin(input.authorityPublicKeyPath),
    approval = h.verify(
      h.privateBytes(input.approvalPath),
      pin,
      'LOCAL_PRODUCT_HANDOFF_PREPARE',
      source,
    ),
    p = approval.payload,
    expectedRaw = h.privateBytes(input.expectedPath);
  h.live(p);
  const expected = h.expected(expectedRaw, pin, source);
  c.insist(expected.digest === p.expectedProfileSha256, 'Validation expected binding rejected');
  const root = path.join(input.controlDirectory, 'releases', p.releaseId),
    configRaw = c.bytes(path.join(root, 'ordinary.json')),
    cfg = c.config(JSON.parse(configRaw), p.releaseId, p.credentialGenerationId);
  c.insist(
    c.sha(configRaw) === p.configurationSha256 &&
      cfg.deploymentId === p.deploymentId &&
      c.canonical(cfg.target) === c.canonical(p.target),
    'Validation configuration target mismatch',
  );
  const artifactRaw = c.bytes(path.join(root, 'artifact-manifest.json'));
  c.insist(c.sha(artifactRaw) === p.artifactManifestSha256, 'Validation artifact binding rejected');
  h.artifacts(root, JSON.parse(artifactRaw), p.artifactManifestSha256);
  const closure = JSON.parse(c.bytes(path.join(root, 'closure-manifest.json')));
  physical.verify(root, closure);
  const build = JSON.parse(c.bytes(path.join(root, 'build-manifest.json')));
  const aliases = build.libraryAliases || [];
  const aliasesValid = () =>
    Array.isArray(aliases) &&
    aliases.every(
      (x) =>
        path.isAbsolute(x.alias) &&
        fs.realpathSync(x.alias) === x.canonical &&
        closure.systemLibraries.some((l) => l.path === x.canonical),
    );
  c.insist(aliasesValid(), 'Exact ELF aliases required');
  for (const name of ['maintenance.json', 'handoff-fences.jsonl', 'handoff-current.json'])
    h.privateBytes(path.join(input.controlDirectory, name));
  const held = m.acquire(input.controlDirectory, 'handoff', true),
    challenge = crypto.randomBytes(32).toString('hex'),
    attempt = crypto.randomBytes(16).toString('hex'),
    prefix = path.join(input.controlDirectory, 'validation-' + attempt);
  let child, childStart;
  try {
    held.assert();
    const gate = h.privateBytes(path.join(input.controlDirectory, 'maintenance.json')),
      fences = h.privateBytes(path.join(input.controlDirectory, 'handoff-fences.jsonl')),
      pointer = h.privateBytes(path.join(input.controlDirectory, 'handoff-current.json'));
    c.insist(
      JSON.parse(gate).status === 'BLOCKED' &&
        c.sha(gate) === p.expectedBlockedGateSha256 &&
        c.sha(fences) === p.fenceHistorySha256 &&
        c.sha(pointer) === p.pointerSha256,
      'Validation BLOCKED fence/pointer CAS rejected',
    );
    require('./handoff-executor.cjs').history(fences, p);
    const compatibility =
        input.compatibilityReceiptPath === null
          ? null
          : h.privateBytes(input.compatibilityReceiptPath).toString(),
      transport =
        input.transportEvidencePath === null
          ? null
          : h.privateBytes(input.transportEvidencePath).toString(),
      previous =
        input.previousCredentialsPath === null
          ? null
          : JSON.parse(h.privateBytes(input.previousCredentialsPath));
    const request = {
      formatVersion: 1,
      releaseId: p.releaseId,
      credentialGenerationId: p.credentialGenerationId,
      sourceBindingsSha256: source.inventorySha256,
      artifactManifestSha256: p.artifactManifestSha256,
      configurationSha256: p.configurationSha256,
      expectedProfileSha256: p.expectedProfileSha256,
      challenge,
      authorityPublicKey: h.privateBytes(input.authorityPublicKeyPath).toString(),
      expectedProfile: expectedRaw.toString(),
      compatibilityReceipt: compatibility,
      compatibilityReceiptSha256: compatibility === null ? null : c.sha(compatibility),
      transportEvidence: transport,
      previousCredentials: previous,
      shadowEvidence:
        input.shadowEvidencePath === null
          ? null
          : h.privateBytes(input.shadowEvidencePath).toString(),
    };
    m.writeExclusive(prefix + '.challenge', challenge + '\n');
    m.writeExclusive(prefix + '.request.json', JSON.stringify(request) + '\n');
    const fd = fs.openSync(
        prefix + '.request.json',
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      ),
      deadline = Math.min(p.expiresAt, Date.now() + 30000),
      permissions = [
        '--permission',
        '--allow-addons',
        '--allow-fs-read=' + root,
        '--allow-fs-read=' + fs.realpathSync(process.execPath),
        '--allow-fs-read=/proc/self/stat',
        ...closure.systemLibraries.map((l) => '--allow-fs-read=' + l.path),
      ];
    let resultRaw;
    try {
      resultRaw = await new Promise((resolve, reject) => {
        child = spawn(
          fs.realpathSync(process.execPath),
          [
            ...permissions,
            '--require',
            path.join(root, 'host/validation-guard.cjs'),
            path.join(root, 'host/validation-child.cjs'),
            '--validate-handoff',
            root,
          ],
          {
            cwd: root,
            env: { PATH: '/usr/bin:/bin', LANG: 'C' },
            stdio: ['ignore', 'ignore', 'ignore', 'pipe', fd],
          },
        );
        let output = Buffer.alloc(0),
          finished = false;
        const timer = setTimeout(
          () => {
            child.kill('SIGKILL');
          },
          Math.max(1, deadline - Date.now()),
        );
        child.stdio[3].on('data', (part) => {
          output = Buffer.concat([output, part]);
          if (output.length > 65536) child.kill('SIGKILL');
        });
        child.on('spawn', () => {
          try {
            childStart = fs
              .readFileSync('/proc/' + child.pid + '/stat', 'utf8')
              .split(') ')[1]
              .split(' ')[19];
          } catch {
            child.kill('SIGKILL');
          }
        });
        child.on('error', () => {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            reject(Error('Validation spawn rejected'));
          }
        });
        child.on('close', (code, signal) => {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            if (code === 0 && !signal && output.length <= 65536 && Date.now() < deadline)
              resolve(output);
            else {
              let diagnostic;
              try {
                diagnostic = JSON.parse(output);
              } catch {
                diagnostic = { failedCheck: 'CHILD_BOOTSTRAP', code: 'NO_RESULT' };
              }
              m.writeExclusive(
                prefix + '.failed.json',
                JSON.stringify({
                  status: 'VALIDATION_REJECTED',
                  failedCheck: diagnostic.failedCheck,
                  code: diagnostic.code,
                }) + '\n',
              );
              reject(
                Error(
                  'Validation child rejected: ' +
                    diagnostic.failedCheck +
                    '/' +
                    diagnostic.code +
                    (diagnostic.resource ? '/' + diagnostic.resource : ''),
                ),
              );
            }
          }
        });
      });
    } finally {
      fs.closeSync(fd);
    }
    const result = JSON.parse(resultRaw);
    c.insist(
      result.formatVersion === 1 &&
        ['VALIDATED_FOR_LAUNCH', 'VALIDATION_INCOMPLETE'].includes(result.status) &&
        result.childPid === child.pid &&
        result.childStart === childStart &&
        result.challengeSha256 === c.sha(challenge) &&
        result.releaseId === p.releaseId &&
        result.credentialGenerationId === p.credentialGenerationId &&
        result.deploymentId === p.deploymentId &&
        result.epoch === p.epoch &&
        result.sourceBindingsSha256 === source.inventorySha256 &&
        result.artifactManifestSha256 === p.artifactManifestSha256 &&
        result.configurationSha256 === p.configurationSha256 &&
        result.expectedProfileSha256 === p.expectedProfileSha256 &&
        result.validationOnly === true &&
        result.httpListening === false &&
        result.businessWrites === false &&
        result.terminalActionsAllowed === false &&
        result.launchAllowed === false &&
        result.runtimeAccepted === false,
      'Child challenge/identity/result binding rejected',
    );
    h.live(p);
    held.assert();
    c.insist(
      h.sources().inventorySha256 === source.inventorySha256 &&
        c.sha(h.privateBytes(path.join(input.controlDirectory, 'maintenance.json'))) ===
          c.sha(gate) &&
        c.sha(h.privateBytes(path.join(input.controlDirectory, 'handoff-fences.jsonl'))) ===
          c.sha(fences) &&
        c.sha(h.privateBytes(path.join(input.controlDirectory, 'handoff-current.json'))) ===
          c.sha(pointer),
      'Final validation source/fence drift',
    );
    physical.verify(root, closure);
    c.insist(aliasesValid(), 'ELF alias drift after child');
    m.writeExclusive(prefix + '.result.json', resultRaw);
    return {
      status: result.status,
      challengePath: prefix + '.challenge',
      resultPath: prefix + '.result.json',
      validationEvidenceSha256: c.sha(resultRaw),
      result,
      launchAllowed: false,
      runtimeAccepted: false,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
    };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (fs.existsSync(prefix + '.request.json')) {
      fs.unlinkSync(prefix + '.request.json');
      m.syncDir(input.controlDirectory);
    }
    held.release();
  }
}
module.exports = { run };
