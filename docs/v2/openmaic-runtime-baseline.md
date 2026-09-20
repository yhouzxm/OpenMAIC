# OpenMAIC Runtime Baseline

## Snapshot and verification context

- OpenMAIC source base SHA: `4d2e2bab82374ed45b95964a1f2ed03362666e1c`
- Phase 0 documentation commit: `8ced0410b8a7a79acfc090c078e355bd8a9c6995`
- V2 branch: `refactor/zhiban-v2`
- Diagnostic branch: `ci/zhiban-v2-linux22-baseline`
- Diagnostic Draft PR: `https://github.com/yhouzxm/OpenMAIC/pull/1`
- Official CI environment: `ubuntu-latest`, Node 22
- Local diagnostic environment: Windows / PowerShell, Node `v24.18.1`
- Root engine requirement: `>=22.19.0`
- pnpm: `10.28.0`
- Verification date: 2026-09-20 (Asia/Shanghai)

The diagnostic commit changes only `.gitignore` and `docs/v2/**`. The OpenMAIC
application, package, render-service and test source trees are identical to the
pinned source base SHA.

## Official Ubuntu / Node 22 verification

The Draft PR triggered the repository's actual GitHub Actions workflows. All
observed checks completed successfully.

## Phase 0B final status

```text
OFFICIAL-LIKE ENVIRONMENT: Ubuntu / Node 22
ROOT CI: PASS
RENDER SERVICE: PASS
RENDER SERVICE TYPECHECK: PASS
RENDER SERVICE TEST: PASS
RENDER SERVICE DOCKER: PASS
E2E: PASS
POSTGRESQL STORAGE CONTRACT: PASS
SOURCE REGRESSIONS: 0
WINDOWS LOCAL FAILURES: LOCAL_ENVIRONMENT_ONLY
RUNTIME_BASELINE_TRUSTED: YES
PHASE 0B VERDICT: READY_FOR_PHASE_1
```

| Job | Result | Duration | Verified scope |
|---|---|---:|---|
| Issue Triage (offline contracts) | PASS | 7s | Offline issue-triage contract tests |
| Lint, Typecheck & Unit Tests | PASS | 9m33s | Frozen install, engine contract, generated-file guard, Prettier, ESLint, root TypeScript, i18n, root unit tests, Importer, DSL, Generation and Storage checks |
| Render Service (typecheck + tests) | PASS | 1m17s | Independent npm install, TypeScript, unit tests and Docker image build |
| E2E Tests | PASS | 4m27s | Chromium install, browser guardrails, HyperFrames lint, Next build and Playwright E2E |
| Storage Contract (PostgreSQL 16) | PASS | 5m17s | Storage and app-domain PostgreSQL contracts against PostgreSQL 16 |

Evidence:

- CI workflow run: `https://github.com/yhouzxm/OpenMAIC/actions/runs/35511096213`
- Storage PostgreSQL workflow run: `https://github.com/yhouzxm/OpenMAIC/actions/runs/35511096215`

### Root CI details

Every executed root step passed:

- `pnpm install --frozen-lockfile`
- `pnpm check:node-engine`
- install mutation guard for tracked package files
- `pnpm check`
- `pnpm lint`
- `npx tsc --noEmit`
- `pnpm check:i18n-keys`
- `pnpm test`
- Importer and DSL unit tests
- Generation typecheck, unit tests and Node-consumer smoke
- Storage typecheck and unit tests

The five Windows assertion candidates did not reproduce in the official root
unit-test step. No OpenMAIC source regression was found.

### Render service details

The official render-service job passed all four required gates:

- independent `npm ci`
- `npm run typecheck`
- `npm test`
- `docker build --tag openmaic-render-service:ci render-service`

This confirms that the Phase 0A render-service failure was caused by invoking
the independent package before its own install, not by a render-service source
defect.

### E2E details

The E2E job passed Playwright Chromium installation, both browser guardrails,
HyperFrames sample generation/linting, the Next.js production build and the
Playwright suite. No CDN, network, missing-browser or missing-secret failure was
observed.

## Local Windows / Node 24 diagnostics

The local results remain useful as a portability and workstation-capacity
record, but they are not the trusted upstream baseline.

| Layer | Local result | Official Ubuntu / Node 22 result | Classification |
|---|---|---|---|
| Root install | PASS | PASS | Baseline pass |
| Root format | PASS | PASS | Baseline pass |
| Root lint | PASS with 18 warnings | PASS | Baseline pass |
| Root TypeScript | Default V8 heap OOM; passed with process-local 8 GB heap | PASS with official command | `LOCAL_ENVIRONMENT_ONLY` |
| Root unit tests | 8244 passed, 101 failed, 97 skipped; one worker error | PASS | `LOCAL_ENVIRONMENT_ONLY` |
| Generation tests | One path-separator assertion failed | PASS | `LOCAL_ENVIRONMENT_ONLY` |
| Storage tests | 80 timeout/resource failures; one worker error | PASS | `LOCAL_ENVIRONMENT_ONLY` |
| Root build | PASS | PASS in E2E job | Baseline pass |

No timeout, worker count, assertion, test source or application source was
changed to obtain the official result.

## Windows failure reclassification

The local root clusters were:

- `WINDOWS_SHELL`: 16
- `WINDOWS_PATH`: 3
- `POSIX_COMMAND`: 1
- `TIMEOUT`: 76
- `REAL_ASSERTION_MISMATCH` candidates: 5
- Vitest worker startup/termination errors: one in the normalized run and five
  in the earlier run

Because the unchanged source and tests passed in the official Ubuntu/Node 22
workflow, all 101 root failures are reclassified as `LOCAL_ENVIRONMENT_ONLY`
for this pinned baseline. The five fast assertion mismatches are no longer
classified as upstream source-regression candidates. The Windows results still
identify unsupported shell/path assumptions and severe Node 24/host resource
sensitivity that may matter if native Windows becomes a supported CI target.

## Local render-service diagnostics

The independent package also passed locally after following its actual install
contract:

| Layer | Local result | Official result |
|---|---|---|
| `npm ci` with `PUPPETEER_SKIP_DOWNLOAD=true` | PASS | PASS |
| `npm run typecheck` | PASS | PASS |
| `npm test` | PASS: 221 passed, 23 skipped | PASS |
| Docker image build | NOT RUN: Docker unavailable locally | PASS |

## Integrity statement

- OpenMAIC core source modified: NO
- Test source modified: NO
- V1 project modified: NO
- Database modified: NO
- Timeout/worker configuration modified: NO
- Deployment performed: NO
- Diagnostic PR merged: NO
- Phase 0 documentation commit pushed: YES (`8ced0410`)
- This CI-result document update committed: NO; awaiting human review

## Gate

- Architecture ready: **YES**
- Runtime baseline trusted: **YES**
- Windows local failures reclassified: **YES — LOCAL_ENVIRONMENT_ONLY**
- Source regressions found: **0**
- Phase 0B verdict: **READY_FOR_PHASE_1**

The trusted statement applies to the pinned OpenMAIC source snapshot and the
successful official Ubuntu/Node 22 workflows above. The diagnostic PR remains
Draft and must not be merged; it may be closed and its temporary branch removed
only after human confirmation.
