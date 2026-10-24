/* eslint-disable @typescript-eslint/no-require-imports -- Shared before-install diagnostic contract. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const phases = new Set([
  'PERSISTENT_CONFIG',
  'RESTORE_POINTER',
  'CATALOG_LAUNCH',
  'PLAYER_BUILD',
  'SDK_VERIFY',
  'SDK_BUILD',
  'SDK_CACHE_WRITE',
  'QUIZ_CSS',
  'QUIZ_BUNDLE',
  'PUBLISHED_PLAYER_BUNDLE',
  'ATTEMPT_RUNTIME_BUNDLE',
  'HOST_BUNDLE',
  'HOST_LAUNCH',
  'RESTORE_SNAPSHOT',
  'RESTORED_CONTROL',
  'PG_START',
  'DB_VERSION',
  'LOCAL_DB_BOOTSTRAP',
  'MIGRATION_CHECK',
  'CONTENT_REBIND',
  'CONTENT_LOAD',
  'IDENTITY_COMPOSITION',
  'TLS_LOAD',
  'SERVICE_COMPOSITION',
  'HTTPS_LISTEN',
  'HOST_READY',
]);
const layers = new Set(['PERSISTENT', 'CATALOG', 'HOST']);
const components = new Set(['dsl', 'storage', 'editor', 'renderer', 'generation']);
const errorCodes = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENOBUFS',
  'ETIMEDOUT',
  'ENOMEM',
  'ECONNREFUSED',
  'ERR_MODULE_NOT_FOUND',
  '42501',
  '42P01',
  '42883',
  '23514',
  '3F000',
  '42704',
  'XX000',
]);
const names = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
  'AggregateError',
  'SystemError',
]);
function sanitizeTrace(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-128).flatMap((v) => {
    if (
      !v ||
      !layers.has(v.layer) ||
      !phases.has(v.phase) ||
      !['ENTER', 'LEAVE', 'FAIL', 'READY'].includes(v.state)
    )
      return [];
    const out = { layer: v.layer, phase: v.phase, state: v.state };
    for (const key of ['elapsedMs', 'phaseMs'])
      if (Number.isSafeInteger(v[key]) && v[key] >= 0 && v[key] <= 5400000) out[key] = v[key];
    if (components.has(v.component)) out.component = v.component;
    if (errorCodes.has(v.errorCode)) out.errorCode = v.errorCode;
    if (names.has(v.errorName)) out.errorName = v.errorName;
    return [out];
  });
}
function tracePath(state, file) {
  if (
    !state ||
    !file ||
    !path.isAbsolute(state) ||
    path.resolve(state) !== state ||
    path.dirname(file) !== state ||
    !/^startup-(start|start-rebind)\.jsonl$/.test(path.basename(file))
  )
    return false;
  let part = '/';
  for (const item of state.split('/').filter(Boolean)) {
    part = path.join(part, item);
    if (fs.lstatSync(part).isSymbolicLink()) return false;
  }
  const info = fs.lstatSync(state);
  return info.isDirectory() && info.uid === process.getuid() && !(info.mode & 0o077);
}
function createStartupDiagnostics(layer) {
  if (!layers.has(layer)) throw Error('Unknown startup diagnostic layer');
  const began = performance.now();
  let phase,
    component,
    entered = began;
  function emit(state, error) {
    let fd;
    try {
      const event = sanitizeTrace([
        {
          layer,
          phase,
          state,
          component,
          elapsedMs: Math.floor(performance.now() - began),
          phaseMs: Math.floor(performance.now() - entered),
          errorCode: error?.code,
          errorName: error?.name,
        },
      ])[0];
      if (!event) return;
      const file = process.env.ZHIBAN_LOCAL_STARTUP_TRACE;
      if (!tracePath(process.env.ZHIBAN_LOCAL_STATE, file)) return;
      fd = fs.openSync(
        file,
        fs.constants.O_APPEND |
          fs.constants.O_CREAT |
          fs.constants.O_WRONLY |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      const info = fs.fstatSync(fd);
      if (
        !info.isFile() ||
        info.uid !== process.getuid() ||
        info.mode & 0o077 ||
        info.nlink !== 1 ||
        info.size > 131072
      )
        return;
      fs.writeSync(fd, JSON.stringify(event) + '\n');
    } catch {
      /* Diagnostic failure never masks or authorizes application startup. */
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  return {
    enter(next, pkg) {
      if (!phases.has(next)) throw Error('Unknown startup diagnostic phase');
      if (phase) emit('LEAVE');
      phase = next;
      component = pkg;
      entered = performance.now();
      emit('ENTER');
    },
    fail(error) {
      emit('FAIL', error);
    },
    ready() {
      phase = 'HOST_READY';
      entered = performance.now();
      emit('READY');
    },
  };
}
function readStartupTrace(state, mode) {
  let fd;
  try {
    const file = path.join(state, 'startup-' + mode + '.jsonl');
    if (!tracePath(state, file)) return [];
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const info = fs.fstatSync(fd);
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      info.size > 140000 ||
      info.nlink !== 1
    )
      return [];
    const data = fs.readFileSync(fd, 'utf8');
    return sanitizeTrace(
      data
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        }),
    );
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
module.exports = { createStartupDiagnostics, sanitizeTrace, readStartupTrace };
