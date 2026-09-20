# OpenMAIC Baseline Failure Matrix

## Observation scope

- Base SHA: `4d2e2bab82374ed45b95964a1f2ed03362666e1c`
- Host: Windows / PowerShell
- Local runtime: Node `v24.18.1`, pnpm `10.28.0`
- Official parity target: `ubuntu-latest`, Node 22
- Root run: 748 files; 718 passed, 18 failed, 12 skipped
- Root tests: 8442 total; 8244 passed, 101 failed, 97 skipped
- Root unhandled worker errors: 1 in this run; 5 in the earlier Phase 0A run

No timeout, worker count, assertion, test source or application source was
changed.

## Root failure clusters

The following categories assign one primary cause to every one of the 101 root
test failures. Secondary `NODE_VERSION_SUSPECT` flags overlap the timeout and
assertion groups and are not added to the total.

| Primary category | Failed tests | Files | Evidence |
|---|---:|---:|---|
| `WINDOWS_SHELL` | 16 | 1 | Test explicitly spawns `/bin/bash`; Windows returns `ENOENT`. |
| `WINDOWS_PATH` | 3 | 3 | Expected POSIX separators but received Windows `\` separators. |
| `POSIX_COMMAND` | 1 | 1 | Test invokes `grep ... || true`; neither command is available in the Windows test shell. |
| `TIMEOUT` | 76 | 11 | Test/hook limits reached, usually at 5s or 10s; repository-scan, fake IndexedDB, PGlite and agent tests dominate. |
| `REAL_ASSERTION_MISMATCH` | 5 | 4 | Fast content/state/count assertions not explained by a timeout or path separator. Node 22/Linux confirmation is still required. |
| **Total** | **101** | **18** | Mutually exclusive primary assignment. |

No root failures were assigned to `PORT_PROCESS`, `MISSING_BROWSER`,
`MISSING_SERVICE`, `NETWORK` or `UNKNOWN`. `WORKER_CRASH` is tracked separately
because Vitest reports it outside the failed-test count.

## Detailed matrix

| Test | Suite | Error signature | Category | Reproducible | Environment sensitive | Node22 verification needed | Likely source regression | Action |
|---|---|---|---|---|---|---|---|---|
| `tests/ci/publish-openmaic-skill.test.ts` | 16/16 failed | `spawnSync /bin/bash ENOENT` | `WINDOWS_SHELL` | Yes, file-only | Yes | No for diagnosis; yes for official pass | No | Run in upstream Ubuntu/macOS Bash environment. |
| `tests/server/skill-export.test.ts` | 1/10 failed | ZIP names use `/`; mapped disk paths contain `\` | `WINDOWS_PATH` | Yes, file-only | Yes | Yes | No | Confirm on Ubuntu; treat Windows result as separator mismatch. |
| `tests/media/classroom-media-bytes.test.ts` | 1/3 failed | Expected mixed `/`, received native Windows separators | `WINDOWS_PATH` | Yes in full run | Yes | Yes | No | Confirm on Ubuntu. |
| `tests/media/asset-url-boundary.test.ts` | 1/2 failed | Backslash paths fail POSIX path allow-list comparison | `WINDOWS_PATH` | Yes in full run | Yes | Yes | No | Confirm on Ubuntu. |
| `tests/media/media-placeholder-lease-guard.test.ts` | 1/31 failed | `grep` and `true` are not recognized | `POSIX_COMMAND` | Yes in full run | Yes | No for diagnosis; yes for official pass | No | Run in Ubuntu; do not emulate by changing the test. |
| `tests/lint-llm-entry-guard.test.ts` | 1/32 failed | 5s timeout; file took about 60s | `TIMEOUT` | Full-run only | Yes | Yes | Unlikely | Re-run on Ubuntu/Node 22 under official load. |
| `tests/document/extract-document-route.test.ts` | 5/33 failed | Four 5s timeouts and one long allocation path | `TIMEOUT` | Full-run only | Yes | Yes | Unclear | Verify on Ubuntu/Node 22. |
| `tests/runtime/chat-storage.test.ts` | 40/67 failed | 39 tests at approximately 5s; one fast `3 !== 2` assertion | `TIMEOUT` + `REAL_ASSERTION_MISMATCH` | Yes, file-only | Yes | Yes | Possible for one assertion | A representative timed-out case passed in 32ms when selected alone; the count assertion still failed alone. Verify both on Node 22/Linux. |
| `tests/agent-runtime/skill-edit-tools.test.ts` | 4/101 failed | 5s tests and 10s PGlite hooks; worker termination timeout | `TIMEOUT` | Variable across full runs | Yes | Yes | Unlikely | Verify sequential official CI; retain worker evidence. |
| `tests/quiz/runtime.test.ts` | 4/27 failed | Cross-tab tests reach about 5s | `TIMEOUT` | Full-run only | Yes | Yes | Unclear | Verify on Node 22/Linux. |
| `tests/lib/chat/pi/call-agent-json-actions.test.ts` | 3/36 failed | 5s/15s timeouts; representative case still times out alone | `TIMEOUT` | Yes, file-only | Possibly | Yes | Possible | Reproduce on Node 22/Linux before source diagnosis. |
| `tests/lib/chat/pi/element-reference-route-l2.test.ts` | 13/33 failed | Mostly 5s+ timing failures plus stale observation assertion | `TIMEOUT` + `REAL_ASSERTION_MISMATCH` | Variable across full runs (4 then 13) | Yes | Yes | Possible for one assertion | Verify on Node 22/Linux; investigate state isolation only if retained. |
| `tests/server/url-guard-unconditional-invariant.test.ts` | 1/1 failed | Repository scan ran about 40s | `TIMEOUT` | Full-run only | Yes | Yes | Unlikely | Verify on upstream runner. |
| `tests/agent-runtime/import-pptx.test.ts` | 1/31 failed | Worker/PPTX case exceeded 5s | `TIMEOUT` | Full-run only | Yes | Yes | Unclear | Verify on upstream runner. |
| `tests/workbench/workspace-rail-session-rename.test.ts` | 5/5 failed | 7–32s cases; overlapping React `act()` warnings | `TIMEOUT` | Full-run only | Yes | Yes | Possible | Verify on Node 22/Linux; inspect act isolation only if retained. |
| `tests/video-export/eslint-boundary.test.ts` | 1/8 failed | Repository scan ran about 88s | `TIMEOUT` | Full-run only | Yes | Yes | Unlikely | Verify on upstream runner. |
| `tests/media/server-backed-media-orchestrator.test.ts` | 2/52 failed | Fast orchestration assertions | `REAL_ASSERTION_MISMATCH` | Full-run only | Unclear | Yes | Possible | Re-run on Node 22/Linux; investigate only if retained. |
| `tests/store/kv-persist.test.ts` | 1/40 failed | Fast persisted-problem count assertion | `REAL_ASSERTION_MISMATCH` | Full-run only | Unclear | Yes | Possible | Re-run alone on Node 22/Linux. |

The five `REAL_ASSERTION_MISMATCH` assignments are: one chat-storage count,
one element-reference stale-state assertion, two media-orchestrator assertions
and one KV-persist assertion. They are potential failures, not confirmed
upstream regressions, until the official OS and Node version are used.

## Worker error analysis

The earlier Phase 0A full run reported five unhandled worker errors. The
current normalized run reported one. The exact current signature was:

```text
[vitest-pool]: Failed to start forks worker
Caused by: [vitest-pool-runner]: Timeout waiting for worker to respond
```

Across the two runs, named affected files included:

- `tests/server/provider-config.test.ts`
- `tests/workbench/workspace-course-chat-bootstrap.test.ts`
- `tests/edit/surfaces/slide/element-pick-layer-purposes.test.ts`

Two earlier reports were generic fork-runner startup timeouts without a stable
test assertion. The run also emitted worker-termination timeout messages after
several heavy files.

Diagnostic-only file runs, without changing timeout or worker settings, all
passed:

| File | Diagnostic result |
|---|---|
| `tests/server/provider-config.test.ts` | 112/112 passed |
| `tests/workbench/workspace-course-chat-bootstrap.test.ts` | 38/38 passed |
| `tests/edit/surfaces/slide/element-pick-layer-purposes.test.ts` | 17/17 passed |

No worker report contained a JavaScript heap OOM, native crash, or unhandled
application rejection. The evidence identifies Vitest fork startup/termination
timeouts under resource contention on Windows. It does not prove a source
regression. Node 22/Linux verification remains required.

## Timeout diagnostics

These are diagnostics only; repository timeout and parallelism settings were
not changed.

| Diagnostic | Full/file result | Selected-test result | Interpretation |
|---|---|---|---|
| `chat-storage` deterministic HTTP 400 case | Timed out in the 67-test file | Passed in 32ms | File-internal cumulative/resource contention. |
| `chat-storage` structured-clone case | Fast assertion failure in file | Same `3 !== 2` failure alone | Potential real or Node-version-sensitive assertion. |
| `call-agent-json-actions` JSON action case | Timed out in full and file runs | Still timed out at 5s alone | Stable Windows/Node 24 timeout candidate. |
| Three worker-start files | Worker startup failed in full suite | All passed alone | Fork-pool resource contention, not fixed test assertions. |

## Package-level failures

| Package | Result | Classification |
|---|---|---|
| Importer tests | 245/245 passed | None |
| DSL tests | 252/252 passed | None |
| Generation tests | 145/146 passed | One `WINDOWS_PATH` separator mismatch in packaged asset inventory |
| Storage tests | 969 passed, 80 failed, 180 skipped; one worker error | Three PGlite/HTTP asset files dominated by 5s/10s timeouts and extreme host slowdown; `NODE_VERSION_SUSPECT` / `TIMEOUT` pending Ubuntu Node 22 |
| Render service tests | 221 passed, 23 skipped | None after the package's own `npm ci` |

## Required next action

Run the unchanged baseline in Ubuntu with Node 22.19 or newer, using the exact
upstream CI sequence. If the five root assertion candidates or the stable
single-test JSON-action timeout remain there, open an upstream baseline issue
with the retained failing assertion and timing evidence. Do not modify Zhiban
business or OpenMAIC core code during that verification.

