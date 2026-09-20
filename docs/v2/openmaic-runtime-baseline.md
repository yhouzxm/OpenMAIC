# OpenMAIC Runtime Baseline

## Snapshot and environment

- Base SHA: `4d2e2bab82374ed45b95964a1f2ed03362666e1c`
- Branch: `refactor/zhiban-v2`
- Official CI: `ubuntu-latest`, Node 22
- Local host: Windows / PowerShell
- Local Node: `v24.18.1`
- Root engine requirement: `>=22.19.0`
- pnpm: `10.28.0`
- Run date: 2026-09-20 (Asia/Shanghai)

No `nvm`, `fnm`, `volta`, installed Node 22 runtime, configured WSL Linux
distribution or Docker CLI was available. No system software was installed.

## Normalized baseline

| Layer | Command | Result | Evidence |
|---|---|---|---|
| Root install | `pnpm install --frozen-lockfile` | PASS | Lockfile was current; postinstall builds completed; neither `pnpm-lock.yaml` nor tracked `packages/@openmaic` files changed. |
| Root engine contract | `pnpm check:node-engine` | PASS | Root minimum `22.19.0` satisfies the checked direct production dependencies. |
| Root format | `pnpm check` | PASS | All matched files use Prettier formatting. |
| Root lint | `pnpm lint` | PASS | 0 errors, 18 existing warnings. |
| Root TypeScript | `npx tsc --noEmit` | FAIL (environment) | Node 24 hit the default approximately 2 GB V8 heap limit and exited with `JavaScript heap out of memory`; no TypeScript diagnostic was emitted. |
| Root TypeScript diagnostic | same command with process-local `NODE_OPTIONS=--max-old-space-size=8192` | PASS | Proves the type graph checks cleanly when memory is available; no repository or global configuration changed. |
| i18n keys | `pnpm check:i18n-keys` | PASS | 12 locale files aligned to `en-US.json`. |
| Root unit tests | `pnpm test` | FAIL | 8244 passed, 101 failed, 97 skipped; 1 worker error. Failures are normalized below. |
| Root build | `pnpm build` | PASS | Phase 0A run on the same SHA and local runtime completed compilation, Next TypeScript, static pages and route generation. |

The official TypeScript command is recorded as a failure because its unmodified
invocation exited nonzero. The diagnostic pass prevents that OOM from being
misreported as a TypeScript source error.

## Workspace package checks

| Package check | Result | Evidence |
|---|---|---|
| Importer tests | PASS | 33 files, 245 tests passed. |
| DSL tests | PASS | 7 files, 252 tests passed. |
| DSL typecheck | PASS | Formal package `typecheck` script. |
| Generation typecheck | PASS | Source and test tsconfig checks passed. |
| Generation tests | FAIL (Windows-specific) | 145 passed, 1 failed because asset paths used Windows `\` separators instead of expected `/`. |
| Generation Node-consumer smoke | NOT SUPPORTED ON WINDOWS | The official step uses Bash job control, traps and command substitution; it was not emulated or rewritten. |
| Storage typecheck | PASS | Source and test tsconfig checks passed. |
| Storage tests | FAIL (environment-sensitive) | 969 passed, 80 failed, 180 skipped; three files failed and one worker failed to start. Failures were overwhelmingly PGlite/HTTP timeouts under extreme host slowdown. |
| Renderer typecheck | PASS | Formal package `typecheck` script. |
| Editor typecheck | PASS | Formal package `typecheck` script. |

## Render service

`render-service` is an independent npm package and was validated in its own
directory with `PUPPETEER_SKIP_DOWNLOAD=true`, matching the upstream job.

| Layer | Result | Evidence |
|---|---|---|
| Install | PASS | `npm ci` installed 213 packages from the independent lockfile. npm reported 5 moderate and 1 high audit findings; no audit fix was run. |
| TypeScript | PASS | `npm run typecheck` completed with no diagnostics. |
| Unit tests | PASS | 21 files passed, 1 skipped; 221 tests passed, 23 skipped. |
| Docker image | NOT RUN | Docker is not installed on this host; this is not a source failure. |

The earlier Phase 0A render-service failure was a package-usage error caused by
running typecheck before the service's independent `npm ci`. It is resolved as
a baseline-procedure issue, with no source change.

## Failure categories

### Windows-specific failures

- 16 root tests require `/bin/bash` and fail with `ENOENT` on Windows.
- 3 root tests compare POSIX paths with native Windows paths.
- 1 root test invokes the POSIX commands `grep` and `true`.
- 1 Generation package test compares `/` asset paths with Windows `\` paths.

Root Windows-specific total: 20 failed tests. Package Windows-specific total:
1 additional failed test.

### Node 24 / resource-sensitive failures

- The official root TypeScript command exhausts the default V8 heap on local
  Node 24, but passes with a process-local 8 GB heap.
- 76 root failures were assigned to timeout behavior. Many land exactly on the
  5s or 10s limit, and failed counts vary between full runs.
- Storage package PGlite/HTTP tests slowed to 8 seconds through 11 minutes per
  failed case; 80 tests failed and one fork worker could not start.
- A representative chat-storage timeout passed in 32ms when selected alone,
  proving at least part of the timeout population is contention/cumulative
  work rather than a fixed failed assertion.
- A representative JSON-action test still timed out alone, so not every timeout
  is explained by full-suite contention.

These are `NODE_VERSION_SUSPECT` rather than confirmed Node 24 defects because
Node 22 was not installed locally.

### Potential real failures

Five root failures were fast assertion mismatches rather than platform command,
path or timeout errors:

- one chat-storage runtime-record count assertion;
- one interactive observation stale-state assertion;
- two media-orchestrator assertions;
- one KV-persist problem-count assertion.

The chat-storage count mismatch (`3 !== 2`) reproduced when selected alone.
These five require Ubuntu/Node 22 verification before they can be called
upstream regressions.

### Unknown failures

None remain unclassified at the cluster level. Classification does not mean all
failures are resolved; it defines the environment and next test needed to
confirm them.

## Worker errors

The earlier run's five worker errors and this run's one worker error shared the
Vitest fork-pool signature `Timeout waiting for worker to respond`, during
startup or termination. Three named affected files passed completely when run
alone (112, 38 and 17 tests respectively). No worker output reported a heap
OOM, native crash or unhandled application rejection. The supported conclusion
is Windows host resource contention/fork startup timeout pending Node 22/Linux
verification.

## Linux reproduction path

- WSL available: NO (no configured distribution reported)
- Docker available: NO
- Node 22 local runtime: NO

The next trustworthy reproduction should use a pre-existing or explicitly
provisioned Ubuntu environment with Node 22.19+, pnpm 10.28.0, the unchanged
base SHA and the command order documented in `upstream-ci-contract.md`. This
phase did not install WSL, Docker or Node.

## Integrity statement

- OpenMAIC core source modified: NO
- Test source modified: NO
- V1 project modified: NO
- Database modified: NO
- Timeout/worker configuration modified: NO
- Commit/push/deployment performed: NO

Only Phase 0 documentation and the previously approved `.gitignore` rule are
changed in the worktree.

## Gate

- Architecture ready: **YES**
- Runtime baseline trusted: **NO**
- Verdict: **NEEDS_LINUX_NODE22_VERIFICATION**

The baseline is well classified and the render-service procedure is now valid,
but the official root TypeScript invocation did not pass under the local
default heap and the remaining timeout/assertion candidates have not been run
on the official Ubuntu/Node 22 target.
