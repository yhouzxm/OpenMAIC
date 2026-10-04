# Phase 1B-0B-B — Isolated OpenMAIC Diagnostic BUILD

STATUS: HARNESS_IMPLEMENTED / CI_INTEGRATION_APPLIED / TARGETED_FIXTURES_CORRECTED / NEW_CANDIDATE_CI_PENDING

Date: 2026-10-04. Branch: `refactor/zhiban-v2`. Base HEAD: `bfa5068f7684baf59d79d884e989c59eba09a55b`. Initial worktree: CLEAN. Human authorization: separately authorize **1B-0B-B isolated diagnostic BUILD**, within [B0-A01–A08](phase1b-0b-a-capability-review.md). This document is not a dynamic signoff or ADR acceptance.

## Scope and pinned boundary

The initial BUILD added only `tests/zhiban/openmaic/**` and this evidence document. The separately approved checkpoint `ca6e69c3b58dbc199e1db1ee57cde405c9f6e56e` also appended the two exact steps below to the existing Storage workflow. The current targeted fix changes only `pg16-diagnostic.test.ts`, `boundary.test.ts` and this document. No production Adapter, Domain/Identity change, native application startup, migration, root package/lockfile change, real account, paid provider or V1 access is introduced. The nested test-only `package.json` supplies ESM mode for Playwright; it has no dependency or install script. No commit, push or CI dispatch is performed in the targeted fix.

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

## Initial BUILD tests and actual local evidence

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

## Precise workflow integration — APPROVED / applied in ca6e69c3

The approved integration reuses only `.github/workflows/storage-pg-contract.yml`, whose PostgreSQL16/Node22/frozen-install and existing package/app-domain suites remain unchanged. No second workflow, Identity workflow modification or timeout increase was introduced. The following steps were appended **after** existing baseline checks in `ca6e69c3`, keeping `timeout-minutes: 10`:

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

Original candidate collection: **99 unit/PG cases + 1 browser per diagnostic pass** (25 real PG cases included), twice. The targeted fixture fix adds two local boundary regressions, making the next candidate **101 unit/PG cases + 1 browser per pass**, with the same 25 PG cases. Actual CI logs/results are authority; marker checks refuse skipped/missing required suites. Setup/build is before the aggregate 10 min diagnostic window, but the unchanged workflow **total** timeout still applies. If it cannot fit, stop and request a separately reviewed budget/topology amendment; do not delete baseline suites, reduce runs, raise limits or auto-rerun assertion/SQL failures.

Workflow application and the initial checkpoint have completed. Before the next dispatch: complete the explicitly authorized fix checkpoint, independently verify GitHub HEAD/message/parent, then separately authorize a new run bound to that candidate. The original design approval alone did not dispatch a run; the separately authorized first run is recorded below.

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

## First candidate CI and targeted fixture correction — 2026-10-04

[Run 37206715968](https://github.com/yhouzxm/OpenMAIC/actions/runs/37206715968) was a newly authorized `workflow_dispatch` at `ca6e69c3b58dbc199e1db1ee57cde405c9f6e56e`, independently checked against the run metadata and checkout log. Conclusion: FAILURE in 7 min 38 s, within the unchanged job budget. Actual environment: PostgreSQL **16.15 (Debian 16.15-1.pgdg13+2)**, **Node v22.23.3 linux/x64**, Ubuntu **24.04.5**.

Both frozen installs and all six fresh package builds completed. Isolated diagnostic TypeScript passed before the runner started. Artifact/provenance checks ran **10/10 PASS**, including the required fresh-build test. Original Storage checks passed (1,314 PASS / 7 existing SKIPPED; required real PG collections and persisted-insert audit passed), and all four App-domain suites passed **18/18**. The first diagnostic Vitest run collected all five files: **97 PASS / 2 FAIL / 99 total**, including **23 PASS / 2 FAIL / 25 PG cases**. Boundary 40/40, host 21/21, egress 3/3 and artifact 10/10 passed. Neither the browser test nor the second diagnostic pass executed. The exact diagnostic workspace cleanup completed; no database cleanup error was reported. No automatic rerun occurred. These partial results do not satisfy dynamic signoff.

The user separately authorized correction of the two fixtures, preservation of rejection/persistence assertions and recording the public read limitation:

- **B0-PG16:** official `validateStage` checks that `name` is a string and accepts `''`. The fixture now uses a deliberately wrong runtime type (`42`), asserts public validation fails, then exercises the actual PgDocumentStore failure through the boundary. Rejection, unreadable ORPHAN mapping, reservation revision exactly `2`, one write attempt, unchanged loaded document/name and unchanged freshness manifest are all required. No new non-empty-name business rule is introduced.
- **B0-PG22:** public `PgRuntimeStore.getSession()` loads `SELECT data ... WHERE id = $1` and validates that JSON envelope. The fixture now poisons `data.learnerKey` as well as `learner_key`, checks exactly one row changed and verifies the public getter sees the foreign learner. The diagnostic boundary must reject it, while subsequent reads must prove both the indexed value and complete JSON remain unchanged rather than repaired. Server-side fixture bindings remain the original learner; they are not rewritten to match corruption.
- **Local regressions:** the published BrowserDocumentStore with fake IndexedDB proves the same malformed document is rejected without changing persisted content. A separate read-only query double exercises the actual published PgRuntimeStore getter and boundary using the foreign JSON envelope; all three queries must be the expected parameterized `SELECT data`, transaction/write use fails the test, and the stored envelope remains unchanged. This query-double test is local contract evidence, not real PG execution.

**Public read limitation:** the getter does not expose or compare the duplicated `learner_key`/`stage_id` columns with JSONB. Mutating only an indexed column while leaving `data` intact is not a corruption fixture for the envelope consumed by this boundary. Scalar-column/JSON consistency remains **NOT_VERIFIED**, and the corrected test does not certify it. Future 1B-9 integration requiring that integrity guarantee must resolve a supported public-contract/upstream capability path; no private SQL guard, source patch or production repair is adopted here. Do not promote envelope rejection to proof of every persisted-row corruption case or production isolation.

Targeted local verification after correction: **75 PASS / 26 SKIPPED / 101 total**; boundary regressions **42/42 PASS**. Skips are the same 25 real PG cases and one fresh-build provenance case in the local Windows environment. Isolated diagnostic typecheck and targeted lint pass; formatting and diff checks pass. The corrected B0-PG16/B0-PG22 SQL and real persisted assertions remain **PENDING_NEW_CANDIDATE_CI**. Local PG16 is unavailable; the existing PG18 service is not used as a substitute. No workflow, public package source, production code, migration or dependency is changed by this fix.

## Capability / architecture status

| Capability | Status / limit |
|---|---|
| D01 isolated native-path closure | Selected local and first-run Node22/Linux boundary tests PASS; complete two-pass gate PENDING. Current root Next native routes still PRESENT and production reachability NOT_VERIFIED. |
| D02 private PG bytes | Selected first-run PgAssetStore/PgAssetByteStore controls/negatives PASS; complete two-pass proof pending. No cloud/cache/signed delivery approval. |
| D03 PG Runtime | First-run PG CAS and pre-commit rollback PASS; corrected JSON-corruption fixture pending new CI. Scalar-column/JSON consistency NOT_VERIFIED. |
| D04 PG Document | First-run owner/id-capable reads and valid-save CAS PASS; corrected failed-save fixture pending new CI. |
| D05 slide-only renderer | Local browser PASS for the closed projection/request paths; Node22/Linux fresh artifacts PASS at the first candidate, but real PG/browser composition not executed. Not complete classroom/playback or video-codec proof. |
| D06/D07 | Closed-path negatives only; positive iframe/agent/stream functionality remains forbidden. |
| D08–D10 | NOT_AUTHORIZED / NOT_RUN. |
| U01 complete Classroom | UPSTREAM_EXTENSION_REQUIRED / NOT_VERIFIED. |
| U02 interactive host | UPSTREAM_EXTENSION_REQUIRED / NOT_VERIFIED. |

SAFE_ADAPTER_DYNAMIC_SIGNOFF: NONE

ADR_012: PROPOSED_UNCHANGED

PRODUCTION_BRIDGE: NOT_AUTHORIZED

FROZEN_CONTRACT_CONFLICT: NO

BUILD_HARNESS: IMPLEMENTED

REAL_PG16: FIRST_CANDIDATE_23_OF_25_PASS / CORRECTED_CANDIDATE_PENDING_CI

NODE22_LINUX_FRESH_ARTIFACT_PROOF: PASS_AT_ca6e69c3 / NEXT_CANDIDATE_REQUIRES_ITS_OWN_PROOF

P0: 0 (no unresolved finding in admitted local harness)

P1: 0 (fixture corrections locally verified; corrected real PG and complete dynamic signoff remain pending)

P2: 2 — corrected complete PG/browser two-pass evidence pending; root full-project tooling verification resource-blocked locally.

WORKFLOW_MODIFIED_THIS_FIX: NO

PRODUCTION_FILES_MODIFIED: 0

MIGRATION_FILES_MODIFIED: 0

ROOT_PACKAGE_OR_LOCKFILE_MODIFIED: NO

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO

NEXT: Authorize the three-file targeted-fix checkpoint and independent remote verification (**GPT-6 Sol / Low**); afterward separately authorize a new candidate CI/two-pass evidence review (**GPT-6.1 Sol / High**). Preserve the existing workflow and limits. No next phase or model switch is silently authorized.
