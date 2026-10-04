# Phase 1B-0B-B — Isolated OpenMAIC Diagnostic BUILD

STATUS: HARNESS_IMPLEMENTED / LOCAL_PARTIAL_EVIDENCE / CI_INTEGRATION_DESIGN_APPROVED / WORKFLOW_IMPLEMENTATION_PENDING

Date: 2026-10-04. Branch: `refactor/zhiban-v2`. Base HEAD: `bfa5068f7684baf59d79d884e989c59eba09a55b`. Initial worktree: CLEAN. Human authorization: separately authorize **1B-0B-B isolated diagnostic BUILD**, within [B0-A01–A08](phase1b-0b-a-capability-review.md). This document is not a dynamic signoff or ADR acceptance.

## Scope and pinned boundary

Only `tests/zhiban/openmaic/**` and this evidence document are added. No production Adapter, Domain/Identity change, native application startup, migration, package/lockfile change, real account, paid provider, V1 access, commit, push or CI dispatch. The nested test-only `package.json` supplies ESM mode for Playwright; it has no dependency or install script and changes neither the root manifest nor lockfile. Existing workflows remain unchanged: B0-A08 requires separate precise-scope authorization before integration.

The six OpenMAIC package source trees still match official v1.1.2 (`1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce`). Public specifiers, not `src`/private modules, are consumed. Versions remain DSL 0.11.2, storage 0.31.1, generation 0.3.13, editor 0.0.9, renderer 0.1.11, importer 0.3.0.

Admitted probes: D01–D05; D06/D07 **closed-path negatives only**. D08/D09/D10 are NOT_AUTHORIZED. Resolving editor/generation exports is not positive editor/generation execution. Importer entry files can resolve, but its root is not Node-safe (browser facilities are required); no DOM/XHR shim or importer pipeline is adopted.

## Implemented harness

| Area | Implementation and proof boundary |
|---|---|
| Synthetic authority | Server-only registry selects subject from a fresh 256-bit admission credential. Teacher A, admin A, students A1/A2/B; separate stage, owner, asset, learner, Attempt and runtime handles. Client tenant/owner/learner/role fields never supply proof. No real Session/Policy is represented. |
| Document | Gate owner/stage/deployment, current subject/version and mapping state before id-capable public reads. Restricted listing and all-or-nothing batch admission. Recheck after asynchronous reads and validate loaded stage/scene structure. Fixture CAS reservation uses canonical int8 string/BigInt; failed/stale external save remains unreadable PENDING/ORPHAN, never silently published. |
| Private bytes | Published PgAssetStore + PgAssetByteStore; server-selected owner partition plus individual stage–asset association. GET/HEAD/single range use the same fresh authorization, no signed redirect, `private, no-store`, `nosniff`. Only bounded synthetic PNG/WAV/WebM signatures; reject HTML/SVG/spoofed MIME. Post-read association recheck prevents removed asset return. |
| Runtime | Published PgRuntimeStore, server-derived stage/Attempt/learner binding, current active chat parent and validated envelope. Cross-tenant and same-tenant other learner access rejected before storage. Append uses public `expectedLastSeq` CAS, not Identity RepositoryRevision. PG transaction hook rechecks fixture authority before/after SQL, rolling back pre-commit revocation. Independent-connection acknowledged barrier tests exactly-one append success. Broad merge/delete/admin functions have no host route. |
| Host | Loopback-only Node HTTP; closed diagnostic routes, methods and body shapes. Reject encoded/ambiguous paths, forged Host/forwarding/internal authority/action headers and duplicate authorization. No native pages/APIs/actions/iframe/SSE transport is mounted. Closed error contains no driver cause/code or secret. Max 2 admitted operations, no queue, 4 MiB request body, 10 s request deadline; permit retained until underlying work settles. PG connection/query/lock timeouts are bounded. |
| Slide preview | Browser consumes public SlideCanvas. Reconstruct a closed image/audio/video/plain-text subset; gateway-only background/image/audio/video/poster sources. Reject untrusted HTML, external/data/javascript URLs, actions, unknown/non-slide execution and unsafe geometry. No external font/CSS, arbitrary HTML or iframe host is enabled. Synthetic WebM proves request routing only, **not valid video decoding/playback**. |
| Egress | Controlled Node host process API fence covers fetch/HTTP(S)/TCP/TLS via sockets, DNS, UDP, child processes and workers; only explicitly registered loopback ports allowed, redirects rejected. Separate browser request interception + CSP covers admitted preview. This is not an arbitrary-JS/OS sandbox; no hostile script is executed. Production topology/isolation remains unverified. |
| Fresh artifacts | `prepare-workspace.mjs` archives committed package trees, verifies equality to v1.1.2, checks pinned pnpm, installs frozen dependencies without startup hooks, builds prereqs and six packages in one exact disposable workspace, records provenance/lock digest. Public JS/types targets and selected Node/browser imports are checked. No source/lockfile rewrite or upgrade. |
| CI runner/cleanup | Linux Node22-only `run-diagnostics.mjs` requires fresh provenance, PG16 and a newly created `zhiban_0b_capability_test`. Never attach/reset an existing diagnostic DB. Two complete unit/PG + browser runs; suite missing/skipped/failed means failure. Aggregate 10 min diagnostic budget and 4/32 MiB persisted-byte budget checked. Cleanup may drop only the DB created by that invocation; exact workspace helper refuses broad/unrelated paths. |

The controlled fixture registry is in memory, **not a durable Zhiban mapping or cross-system transaction**. A document save can have committed externally when a later authorization/publication check fails: its mapping then stays unreadable; the test does not call this distributed rollback. Runtime's pre-commit authority check demonstrates the admitted hook, not atomicity with a real Identity database. The gap between an in-memory check and a DB commit, authority mutation coordination and durable orphan/reconciliation policy remain mandatory 1B-9 integration proofs. No result here certifies real Course/Enrollment/Assessment evidence.

## Tests and actual local evidence

Commands run from repository root (no dotenv/root Next setup):

```powershell
pnpm exec vitest run --config tests/zhiban/openmaic/vitest.config.ts
pnpm exec tsc -p tests/zhiban/openmaic/tsconfig.json
pnpm exec eslint tests/zhiban/openmaic
```

Actual local environment: **Node v24.18.1 / Windows**, pinned pnpm 10.28.0. No local PG16 or Docker; no PG18 substitute. Edge's Chromium engine was found and used in a fresh private browser profile with command-scoped `B0_BROWSER_MEMORY=1`, `B0_BROWSER_EXECUTABLE` and disposable output directory. All temporary environment overrides were restored/removed.

| Evidence | Actual status |
|---|---|
| Boundary contracts | 40/40 PASS — public BrowserDocumentStore/BrowserRuntimeStore with isolated fake IndexedDB; asset backend is a bounded fixture stub, not PG evidence. |
| Real Node HTTP controls/negatives | 21/21 PASS. |
| Node egress fence | 3/3 PASS, including actual allowed observer request and denied network/worker/subprocess APIs. |
| Public artifact checks | 9/9 local PASS; fresh-build provenance test is explicitly SKIPPED, not a passing build certificate. |
| Local Vitest total | **73 PASS; 26 SKIPPED** (25 real PG cases + 1 fresh-build provenance). No failed assertion in final local run. |
| Actual browser | **1/1 PASS**, public SlideCanvas media request paths, no iframe/native requests, external fetch denial and post-revoke bytes rejection. Local public browser backend + fixture bytes only. |
| Diagnostic TypeScript | PASS (strict isolated config); root full-project typecheck **NOT_VERIFIED**. |
| Diagnostic lint | PASS, 0 errors / 0 warnings after fixes. |
| Real PG16 + Linux Node22 | **NOT_RUN / PENDING_CANDIDATE_CI**, never inferred from local results. |
| Fresh six-package rebuild | **NOT_VERIFIED / BLOCKED_BY_LOCAL_SETUP_RESOURCES**. Frozen install did not complete in the bounded local setup window. |

Local initial setup encountered C-drive exhaustion (`ENOSPC`) and memory pressure during root full-project typecheck; that command was stopped and is not reported PASS/OOM. Only this task's new setup processes/exact diagnostic temporary workspaces were stopped/cleaned; no user project, shared package cache or DB was erased. The subsequent E-drive disposable setup reused the cache but still did not finish within its 300 s setup-operation bound. CI must prove a fresh frozen build; existing ignored dist artifacts are **not** promoted to that evidence. Downloaded package-cache entries are ordinary setup cache, not production data or provenance.

Normal findings fixed in this BUILD: missing fake IndexedDB key-range environment; constructible Worker/DNS rejection; PG version column and failed-rollback connection disposal; safe browser compile mode; asynchronous asset/Attempt/save-authority rechecks; malformed record validation; no false PASS for skipped provenance; bounded child-process cleanup and pinned command-scoped pnpm behavior. No test assertion or safety boundary was weakened.

## Precise workflow integration — APPROVED / NOT applied

Reuse only `.github/workflows/storage-pg-contract.yml`, whose PostgreSQL16/Node22/frozen-install and existing package/app-domain suites must remain unchanged. No second workflow; no Identity workflow modification; no timeout increase. Add the following steps **after** existing baseline checks, keeping `timeout-minutes: 10`:

```yaml
- name: Diagnostic setup — exact official reference and browser
  run: |
    git -c http.version=HTTP/1.1 fetch --no-tags --depth=1 https://github.com/THU-MAIC/OpenMAIC.git 1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce
    test "$(git rev-parse FETCH_HEAD)" = "1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce"
    pnpm exec playwright install --with-deps chromium

- name: OpenMAIC isolated diagnostics — fresh artifacts, two passes
  shell: bash
  run: |
    set -euo pipefail
    setup_log="$RUNNER_TEMP/b0-setup.log"
    node tests/zhiban/openmaic/prepare-workspace.mjs | tee "$setup_log"
    diagnostic_workspace="$(sed -n 's/^DIAGNOSTIC_WORKSPACE=//p' "$setup_log")"
    test -n "$diagnostic_workspace"
    trap 'node "$GITHUB_WORKSPACE/tests/zhiban/openmaic/cleanup-workspace.mjs" "$diagnostic_workspace"' EXIT
    cd "$diagnostic_workspace"
    pnpm exec tsc -p tests/zhiban/openmaic/tsconfig.json
    node tests/zhiban/openmaic/run-diagnostics.mjs
```

The existing job's `PG_CONTRACT_URL` is used only to check the ephemeral service and CREATE/DROP the new diagnostic DB; existing baseline tables are neither used nor reset by diagnosis. New diagnostic table provisioning is exclusively through public schema seams. Runner children receive a filtered environment, only the new diagnostic URL, required flags and basic executable/home settings. No provider/API credentials, browser secret traces, raw admission material, request-body snapshot or full driver exception is an evidence artifact.

Expected collection now: **99 unit/PG cases + 1 browser per diagnostic pass** (25 real PG cases included), twice. Actual CI logs/results are authority; marker checks refuse skipped/missing required suites. Setup/build is before the aggregate 10 min diagnostic window, but the unchanged workflow **total** timeout still applies. If it cannot fit, stop and request a separately reviewed budget/topology amendment; do not delete baseline suites, reduce runs, raise limits or auto-rerun assertion/SQL failures.

Before dispatch: separately authorize implementation of this approved exact workflow scope, validate its syntax/commands, do an explicitly authorized scope checkpoint, independently verify GitHub HEAD/message/parent, then separately authorize a new run bound to that candidate. No run is dispatched by this approval.

### Review and explicit human approval — 2026-10-04

The user explicitly requested: “审阅并批准文档中的精确 workflow 接入方案”. The review compared the two steps above with approved B0-A01–A08, the actual Storage workflow and the preparation, runner, cleanup and test configurations. This records approval of the integration design, not execution permission or dynamic diagnostic signoff. Only this document is changed in this review; the existing uncommitted diagnostic BUILD files are preserved.

| Reviewed item | Verdict / exact approved constraint |
|---|---|
| Workflow scope | PASS — append exactly the two proposed steps to `.github/workflows/storage-pg-contract.yml` after both existing baseline steps. Preserve triggers, concurrency, PG16 service, Node22, frozen installation, baseline capture/collection assertions and app-domain suites. No second workflow or Identity workflow edit. |
| Official reference / artifact setup | PASS — command-scoped HTTP/1.1 fetch of the pinned official commit, exact FETCH_HEAD check, existing Playwright Chromium installation, disposable frozen install and fresh six-package builds. No moving main, dependency/lockfile change or private-source substitution. |
| Database separation | PASS — use the existing job-created service only; baseline connection performs version/catalog checks and CREATE/DROP of the exact newly created diagnostic database. Diagnostic tables/data live only in `zhiban_0b_capability_test`; existing baseline tables are not reset or consumed. An existing diagnostic database causes failure, not cleanup or reuse. |
| Complete evidence | PASS — required fresh-provenance/PG flags, all five Vitest files with no skipped/failed required cases, and the browser suite in each of two passes. Expected 99 unit/PG + 1 browser per pass remains pending actual execution. A green baseline job or local skipped PG tests are not diagnostic signoff. |
| Isolation / cleanup | PASS — filtered child environments, approved loopback-only fixture host, no root native host/provider execution, exact workspace cleanup and drop only the database created by this invocation. EXIT cleanup handles normal command completion/failure; job cancellation/forced termination is not represented as verified cleanup. Resources remain confined to the ephemeral job. |
| Budget / failure handling | PASS — existing total job timeout stays 10 minutes; runner's aggregate diagnostic budget is not additional job time. Fit is NOT_VERIFIED. Any timeout, SQL/assertion failure, missing suite, artifact uncertainty or cleanup failure blocks signoff; no automatic limit increase, test reduction or assertion-failure rerun. |
| Candidate / next gates | PASS — checkpoint and independently verify the later candidate, then verify dispatched run event/head SHA and artifact provenance against that same candidate during evidence review. This BUILD base HEAD is not the future candidate SHA. Workflow application, checkpoint, push and dispatch are separate actions, none executed by this approval. |

REVIEW_VERDICT: PASS_WITH_NOTES

PRECISE_WORKFLOW_DESIGN: APPROVED

APPROVED_WORKFLOW_CHANGE: TWO_APPEND_ONLY_STEPS_ABOVE

RESOURCE_SCOPE_EXPANDED: NO

WORKFLOW_IMPLEMENTATION_THIS_REVIEW: NO

CI_DISPATCH_AUTHORIZED_THIS_REVIEW: NO

The notes are unresolved execution evidence and budget fit, not approval to relax B0-A01–A08. No frozen contract conflict was found. U01/U02, D08–D10, positive agent/iframe execution, production Bridge and ADR-012 acceptance remain outside this approval.

## Capability / architecture status

| Capability | Status / limit |
|---|---|
| D01 isolated native-path closure | Local selected-path evidence PASS; full Node22Linux/fresh artifact gate PENDING; current root Next native routes still PRESENT and production reachability NOT_VERIFIED. |
| D02 private PG bytes | Local protocol/boundary tests PASS; actual PgAssetStore/PgAssetByteStore proof PENDING_PG16. No cloud/cache/signed delivery approval. |
| D03 PG Runtime | Local public-browser contract PASS; PG CAS, rollback and corruption cases implemented but NOT_RUN. |
| D04 PG Document | Local gate/CAS/publication tests PASS; owner/id-capable reads and actual persisted results PENDING_PG16. |
| D05 slide-only renderer | Local browser PASS for the closed projection/request paths; real PG bytes + fresh Node22Linux artifact proof pending. Not complete classroom/playback or video-codec proof. |
| D06/D07 | Closed-path negatives only; positive iframe/agent/stream functionality remains forbidden. |
| D08–D10 | NOT_AUTHORIZED / NOT_RUN. |
| U01 complete Classroom | UPSTREAM_EXTENSION_REQUIRED / NOT_VERIFIED. |
| U02 interactive host | UPSTREAM_EXTENSION_REQUIRED / NOT_VERIFIED. |

SAFE_ADAPTER_DYNAMIC_SIGNOFF: NONE

ADR_012: PROPOSED_UNCHANGED

PRODUCTION_BRIDGE: NOT_AUTHORIZED

FROZEN_CONTRACT_CONFLICT: NO

BUILD_HARNESS: IMPLEMENTED

REAL_PG16: PENDING_CANDIDATE_CI

NODE22_LINUX_FRESH_ARTIFACT_PROOF: PENDING_CANDIDATE_CI

P0: 0 (no unresolved finding in admitted local harness)

P1: 0 (not a claim that unexecuted PG/CI gates passed)

P2: 2 — fresh Node22/Linux/PG16 evidence pending; root full-project tooling verification resource-blocked locally.

WORKFLOW_MODIFIED: NO

PRODUCTION_FILES_MODIFIED: 0

MIGRATION_FILES_MODIFIED: 0

ROOT_PACKAGE_OR_LOCKFILE_MODIFIED: NO

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO

NEXT: Separately authorize application of the approved two-step integration to the existing Storage workflow and targeted syntax/scope validation (**GPT-6.1 Sol / High**). Then authorize the exact-scope checkpoint and independent remote verification (**GPT-6 Sol / Low**); afterward separately authorize candidate CI/two-pass evidence review (**GPT-6.1 Sol / High**). No next phase or model switch is silently authorized.
