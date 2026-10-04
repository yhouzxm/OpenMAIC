# Phase 1B-0B-A — OpenMAIC 1.1.2 Capability Re-audit / Diagnostic Authorization

STATUS: STATIC_REAUDIT_COMPLETE / DIAGNOSTIC_RESOURCES_APPROVED / EXECUTION_PENDING

Date: 2026-10-04. Branch: `refactor/zhiban-v2`. Base HEAD: `4154706a089f6b7f02891e1e9dbea04d6c66fda0`. Preflight: CLEAN.

This is the read-only + DESIGN unit in the [execution plan](../zhiban-v2-execution-plan.md). Only this document is added. No diagnostic host, database, fixture, migration, production Adapter, package build, CI dispatch or deployment is created or run. The human approval recorded below accepts resource proposals B0-A01–A08 for a separately authorized 1B-0B-B unit; authorization to perform this audit alone was not permission to create or delete a database.

## Authority and pinned upstream

The [official v1.1.2 tag](https://github.com/THU-MAIC/OpenMAIC/tree/v1.1.2) resolves to commit `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce`, verified through the official GitHub tag API and the local tag. That commit is an ancestor of the current HEAD. Root package version is `1.1.2`. A moving upstream or fork `main` is not this diagnostic's baseline.

Authority remains [ADR-006](../adr/ADR-006-upstream-sync-strategy.md), [ADR-012](../adr/ADR-012-openmaic-identity-bridge.md), [ADR-014](../adr/ADR-014-openmaic-package-host-strategy.md), the [gate map](phase1b-gate-map.md), [0R architecture review](openmaic-integration-architecture-review.md), [public surface](zhiban-openmaic-public-surface.md), [capability necessity](openmaic-capability-necessity.md), [disable matrix](openmaic-feature-disable-matrix.md), [U01/U02 backlog](openmaic-upstream-extension-backlog.md), and [historical diagnostic plan](phase1b-0b-diagnostic-plan.md). Identity, Credential, Session, Authorization and 1B-8 closeouts are not reopened.

The [controlled sync review](../sync/openmaic-1.1.2-sync-review.md) records the already accepted upstream synchronization and its tests. Those tests are historical baseline evidence, not a new Bridge signoff. Provider SSRF/transport hardening in the release does not supply tenant authorization, asset revocation or a Classroom host contract.

### What changed since 0A/0R

Historical 0A/0R examined OpenMAIC `4d2e2bab82374ed45b95964a1f2ed03362666e1c`, with 20 surface groups and 133 recorded entries. Those are historical counts, not a newly repeated 133-entry audit.

`git diff --name-only <0A baseline> v1.1.2 -- packages/@openmaic` contains 27 files: editor core/geometry and tests; generation browser entry, interactive validation and quiz normalization; importer exports, ZIP limits, style-cache handling and tests; renderer geometry export and tests; corresponding package metadata. DSL and storage have no delta in that comparison. This is different from the official **v1.1.0 → v1.1.2** comparison in the sync review, which had no package source changes.

At this audit HEAD, `git diff v1.1.2 HEAD -- packages/@openmaic` is empty. The six package trees therefore match the pinned official release; they are not local identity forks. `next.config.ts` also has no release delta. `middleware.ts` has the previously implemented exact Zhiban Identity namespace exception; it is not an OpenMAIC route-isolation implementation.

## P01–P06: actual public package contracts

Evidence is each package's `package.json` exports plus the corresponding implementation/type declarations. Source paths here are audit evidence only: future consumers must import published package specifiers, never `src`, private modules or ignored local `dist` paths directly.

| ID / package version | Supported consumption seams | Limit requiring diagnostic proof |
|---|---|---|
| P01 DSL `0.11.2` | `@openmaic/dsl`, `@openmaic/dsl/schema/*`; content/runtime types and validation | Structural validation is not ownership, authorization, HTML sanitization or valid learning evidence. Do not expose OpenMAIC DTOs through Identity Domain. |
| P02 storage `0.31.1` | Root `DocumentStore`, `PgDocumentStore`, `AssetStore`, `PgAssetStore`, `PgAssetByteStore`; `@openmaic/storage/document/pg`, `/runtime/pg`, `/asset/pg`, `/asset/pg-bytes`; published schema initialization and transaction hooks | Storage does not implement Zhiban Policy. Server-derived mapping, principal, learner, Attempt and resource checks remain mandatory. Broad server/reference, HTTP, admin and other stores are not automatically adopted. |
| P03 generation `0.3.13` | Root scene generation/build functions and `AICallFn`; `/browser` is an explicit separate browser-safe subset | Fake AI only in diagnosis. Root prompt loaders/orchestration are not browser imports. No native agent/tool/provider route adoption. AICallFn's signature has no AbortSignal: retry's signal option does not prove in-flight provider cancellation. |
| P04 editor `0.0.9` | Root and `/core` expose transaction core; `/react` and `/ui` expose controlled slide editing surfaces | UI selection, insertion controls and transactions do not authorize saving; fresh server authorization, mapping and content validation are needed. Not a complete Course editor. |
| P05 renderer `0.1.11` | Root `SlideCanvas`/`SlideElement`/provider; `/elements`, `/types`, `/snapshot`, `/geometry`, `/fonts.css` | Slide preview only. Image/video slots do not cover background, audio, poster and rich text. No public complete Classroom/interactive execution contract was found. External fonts are not enabled by default. |
| P06 importer `0.3.0` | Root `parse`, `parseZip`, `buildPresentation`, `importPptx`, normalization and upload seams | Full pipeline still uses browser document/canvas/image facilities. Some XML parsing uses xmldom, which does not make the entire importer Node-safe. Optional browser import remains separately gated. |

Export-key counts observed: DSL 2, storage 17, generation 2, editor 4, renderer 6, importer 1. All concrete import/string export target files inspected are present locally; the DSL wildcard is not counted as one verified concrete file. **Local artifact presence is not provenance or runtime proof.** This audit does not execute imports, rebuild packages or certify local ignored artifacts. 1B-0B-B must consume artifacts freshly built from the pinned candidate with the frozen lockfile, verify JS/type resolution and run selected calls in Node/browser contexts. A published npm version need not be substituted for the in-repository pinned package.

### Security-relevant implementation findings

1. `storage/src/document/pg.ts`: owner binding limits writes/listing, but `loadDocument`/`getScene` use id-capable reads (`loadStage` queries by id). `readFreshnessManifest` separately applies owner scope. Do not infer that all reads enforce owner scope. An unauthorized id must be rejected by the diagnostic wrapper **before** calling the store, including direct scene reads. `ownerId` is not a Tenant or an authenticated User.
2. `storage/src/asset/types.ts` and `asset/pg.ts`: `AssetPrincipal.key` is the registry partition and is checked on reads/writes; client-supplied principals are not trusted. An authorized student reads the activity's server-selected asset partition, not an arbitrary UserId or a shared deployment principal. Same partition still does not authorize every asset. `resolveIndirect` can return a signed bearer URL; default diagnosis uses `resolve` bytes instead.
3. `storage/src/runtime/types.ts`: stage/learner partitioned listing exists, but `getSession`, records and mutations take session ids. `mergeLearner`, `deleteStageRuntime` and `deleteAllRuntime` are broad capabilities and must not be exposed. Optional `expectedLastSeq` must be exercised where appropriate; its numeric sequence is not Identity's string/BigInt RepositoryRevision.
4. Document/runtime PG hooks require independently checked-out connections and same-client transactions. `trackAssetReferences` defaults false and needs the asset schema. Any diagnostic reference tracking uses the published provisioning/write seams; it does not import transaction-private asset reference helpers or run garbage collection against existing data.
5. `renderer/src/context.tsx`, `hooks/useSlideBackgroundStyle.ts`, audio/video/image elements and text element show distinct URL/HTML sinks: background CSS URLs, `new Audio(src)`, video `src`/poster, image `src`, and `dangerouslySetInnerHTML`. The preview host must reject or sanitize untrusted rich text and comprehensively constrain media URLs; schema validity alone is insufficient. No arbitrary HTML is executed to obtain a passing result.
6. `importer/src/parser/ZipParser.ts`: defaults include 10,000 entries, 1 GiB per entry/media, 2 GiB aggregate, ratio 200 for text and concurrency 8. The source explicitly notes reliance on declared sizes and possible allocation before a forged-size mismatch is detected. These defaults are not proof of adversarial resource safety. D10 needs a bounded process/browser and smaller explicitly frozen diagnostic limits if separately authorized; changing upstream defaults is not authorized.
7. `generation/src/pipeline-types.ts`: AICallFn returns a string and accepts prompts/images, not a security principal. The host owns authority, budget, network, errors and output validation. `/browser` includes pure retry/outline/PBL kernel helpers, not the complete server generator. A kernel calculation is not a Classroom engine or authoritative assessment result.

## Actual host state and native boundary

Static route-file inventory: **83** `app/api/**/route.ts` files, including **14** Zhiban Identity routes and **69** non-Zhiban native routes. These counts are route definitions, not resolved HTTP endpoints, methods, exposure findings or replacements for historical 133-entry counts.

The current root Next application still includes native Stage/Classroom, generation, agent and media APIs and native pages. `middleware.ts` gates workbench features, delegates the exact Identity namespace to its Node security gate, otherwise permits requests when ACCESS_CODE is absent; with ACCESS_CODE it checks an access-code cookie for APIs and lets pages through. Neither access-code nor a workbench flag establishes Zhiban resource authorization. `next.config.ts` frame restrictions/tracing do not remove native routes.

**CURRENT_ROOT_APP_NATIVE_ROUTES: PRESENT. PRODUCTION_NETWORK_REACHABILITY: NOT_VERIFIED.** The historical DISABLED_IN_V2 labels remain target restrictions, not claims that the current root deployment has been fenced. No live deployment or production network was probed.

Model B remains the accepted architecture direction: a controlled package host, without mounting native Next pages/APIs/actions, embedded dev auth, agent/tools, private bootstrap or private stores. D01's temporary isolated host may demonstrate that package consumption can avoid these dependencies. A tiny host returning 404 alone cannot prove a future Zhiban production build has removed all bypasses. The actual production artifact/topology and every native-path/bytes bypass remain a mandatory **1B-9C** integration proof; directly publishing the current root Next app is not approved by this document.

## U01/U02 and release capability manifest

| Capability | Current finding | Gate |
|---|---|---|
| U01 complete Classroom / multi-scene playback / Quiz / PBL / whiteboard orchestration | Existing implementation is in native/internal surfaces; six published package exports do not supply the complete supported host contract. SlideCanvas, DSL and generation kernels do not close U01. | UPSTREAM_EXTENSION_REQUIRED / NOT_VERIFIED; no internal import, copied engine or native page fallback. |
| U02 Interactive / iframe execution | Native iframe pool/host is private application machinery, not a published isolated execution/resource/message contract. Generated HTML validation does not supply such a host. | UPSTREAM_EXTENSION_REQUIRED / NOT_VERIFIED; positive execution closed. |

R1's exact supported activity manifest still needs human acceptance. If either capability is required by the first release, that release's real learning launch and corresponding Portal acceptance remain blocked until the U01/U02 contract and diagnostic path are approved. This audit does **not** silently downgrade the first release to slide preview or permanently cancel required-later capabilities. Course metadata/other independent Domain work may proceed only through its own authorization gates.

## D01–D10: proposed necessary diagnostic subset

The first 1B-0B-B batch covered by the resource approval is **D01–D05 plus D06/D07 closed-path negatives**. D08/D09 are required before teacher editing/generation opens, but are not part of this first resource approval; D10 is optional and remains unapproved. No capability is SAFE_ADAPTER solely from this table.

| Probe | Proposed execution and decisive negatives | What a PASS would not prove |
|---|---|---|
| D01 | Build/inspect the isolated package host and import graph; probe native pages/API/action transports, encoded/method/host variations and direct storage/bytes access. Reject forged internal principal/learner input; no raw path/method proxy. Demonstrate no mounted native handler or private dependency. | Closure of the current root Next application or a future production deployment; keep that NOT_VERIFIED until 1B-9C. |
| D02 | Real private PgAssetStore/PgAssetByteStore bytes through a test-only gateway. Check copied/guessed ids, foreign/same-tenant unauthorized assets, HEAD/range, cache/revocation, redirect and active HTML/SVG rejection; no signed redirect, public bucket or unrestricted fetch. | Recovery of already downloaded bytes; safety of S3/CDN/direct URLs or production cache optimizations. |
| D03 | Real PgRuntimeStore through server-derived Stage/Attempt/learner mapping. Forge learner/session ids; test same-tenant second learner and cross-tenant reads/writes, stage mismatch, stale append tail, terminal lifecycle, storage failure and independent-connection concurrency. Broad merge/delete-all paths closed. | Real Enrollment/Assessment logic, complete playback, or Identity-to-runtime production composition. |
| D04 | Real DocumentStore with server mapping. Cover id-capable load/getScene, authorized listing, mixed batch, content/freshness revisions, mapping PENDING/ORPHAN/TRANSFERRING, revoke/disable and partial external failure. Denied operations must not call the underlying store. | Cross-system ACID, production mapping schema, business resource existence or generic full-document CAS supplied by the store. |
| D05 | Browser slide-only preview with an authorized fixture projection. Inventory all media/HTML sinks and intercepted requests; use gateway image/background/audio/video/poster assets. Untrusted rich text, external CSS/links, actions and non-slide execution must be rejected or sanitized before use. | Complete U01, arbitrary HTML/interactive execution, native snapshot/export services or learning completion. |
| D06 | Negative-only: interactive scenes, iframe launch/message channels and generated HTML cannot execute or reach data; malicious payload is inert test data. | U02 functionality, sandbox/origin security of a positive interactive host. |
| D07 | Negative-only: native agent/tools/SSE/reconnect/actions remain absent and cannot dispatch work. | Safe positive streaming, worker cancellation or in-flight provider revocation latency. |
| D08 | NOT_AUTHORIZED: future controlled editor transactions, fresh save authority, asset picker, mapping/version conflicts and hostile content. | Course editor or permission enforced by hidden buttons. |
| D09 | NOT_AUTHORIZED: future teacher generation using deterministic fake AICallFn, bounded output/budget, output validation, cancel/failure and orphan handling. | Paid AI/provider integration, native tools or complete classroom execution. |
| D10 | NOT_AUTHORIZED: optional browser importer, bounded synthetic archives, forged size/ZIP abuse, external relationships and upload failures; separate resource budget required. | Node full importer support, safety of unrestricted PPTX files or default ZIP limits. |

Each admitted path needs a successful authorized control as well as denials. A blanket deny-all server or mocks asserting their own output cannot pass D02–D05. Store invocation counters, actual persisted results, browser request traces and controlled failure points must show the boundary acted before or during the relevant operation. Concurrency uses independent connections with acknowledged barriers/locks, not sleep-only races.

## B0-A01–A08: exact resource authorization proposal

**All eight items are APPROVED_FOR_DIAGNOSTIC_RESOURCES as of 2026-10-04.** They form one bounded authorization bundle for the first D01–D07 diagnostic batch, not production permissions. The original resource allowlist and stop conditions below are unchanged. A later BUILD authorization may implement the test harness within this scope. Checkpoint, workflow change scope and CI dispatch remain separately authorized.

| ID | Proposed resource / allowlist | Forbidden or stop condition |
|---|---|---|
| B0-A01 pinned artifacts | Use official v1.1.2 package trees at the approved candidate, Node 22, repository-pinned pnpm and frozen lockfile; build six public package artifacts in a disposable checkout/workspace and check public JS/types/browser entry resolution. | No upgrade, lockfile rewrite, new direct dependency, private import or upstream source patch. Missing public seam is a blocker, not permission to copy internals. |
| B0-A02 test-only files | Future harness/config/browser fixture files confined to `tests/zhiban/openmaic/**`; evidence document under `docs/v2/phase1/**`. Host entry and its route allowlist must be test-only, use the package exports, and expose only explicitly named diagnostic operations. | No `app/**` or production Adapter/Domain/Identity edits, migration changes, V1 reads, real accounts or production host startup. No dotenv autoload from project production settings. |
| B0-A03 independent PG16 | One ephemeral Linux PostgreSQL 16 service/container, database **`zhiban_0b_capability_test`**, separate from existing Identity/V1/production databases. Provision only via published OpenMAIC document/asset/runtime schema initialization seams. Use a pinned same-client transaction hook and bounded independent pools; record server_version and Node architecture. | No local PostgreSQL installation, PG18 substitution, attachment to an existing DB, Identity schema migration or business columns in OpenMAIC tables. If isolated PG16 cannot be obtained within approved CI resources, report BLOCKED_BY_ENVIRONMENT. |
| B0-A04 bytes backend | PgAssetByteStore and PgAssetStore in that same disposable DB, permitting published document/asset reference tracking within its own transactions. All bytes are bounded synthetic PNG/audio/video/text fixtures; aggregate persisted fixture bytes at most **32 MiB**, each at most **4 MiB**. No scheduled GC. | No S3, cloud bucket, shared directory, public asset endpoint, signed browser URL, real PPTX/media or production byte deletion. Registry/bytes interfaces are server-private. |
| B0-A05 synthetic authority | In-memory server-only fixture registry: tenants A/B, teacher A, admin A, student A1/A2 and student B, distinct opaque Stage/Scene/Asset/Attempt/session handles, duplicate display names, missing/foreign/revoked/disabled/stale fixtures and PENDING/ORPHAN/TRANSFERRING mappings. A test-only admission credential selects a registry subject; all other facts are resolved server-side. | No client boolean relationship/role/owner/learner as proof, no insecure native dev auth or real Session material. This models the host boundary, not production Policy or mapping persistence signoff. |
| B0-A06 host/network | One package diagnostic host bound only to loopback on a dynamically allocated port, plus one loopback adversarial observer/redirect sink; browser assets self-hosted. PG port is private to the job. Setup network only for existing GitHub/pnpm/Playwright artifact acquisition; during probes permit only those loopback services and PG. Deny/intercept all other browser/host egress. | No root Next/native process, render/agent process, public tunnel, LAN/cloud/DNS/provider endpoint, external font or actual AI request. Fake AICallFn may be an inert registry stub, never a production provider. If host egress cannot be enforced, affected probes cannot PASS. |
| B0-A07 budgets/evidence | Max two concurrent diagnostic operations, bounded bodies and per-operation deadlines; initial proposal **4 MiB body, 10 s operation, 10 min total diagnostic execution for both passes**. Test-only HTTP errors are closed/sanitized. Trace only probe id, outcome, opaque fixture alias, package/candidate/config and version. Record compile/build, browser requests, store calls, persisted outcomes, revocation/failure and cleanup. | No raw token/password, provider keys, connection credentials, SQL params containing secrets, full driver errors, real identity data or free-form request dumps. Budget failure is evidence, not a reason to silently relax limits; changing the existing workflow timeout needs amended approval. |
| B0-A08 execution/cleanup | Local static/unit checks may follow future BUILD authorization. Real PG/browser evidence uses the existing **`.github/workflows/storage-pg-contract.yml`** with a separately reviewed minimal diagnostic selection, retaining its current checks; no second PG workflow. Run two complete admitted diagnostic passes on one independently verified SHA. Dispose only the job-created container/DB and exact job temporary workspace/artifacts after pools/browser/host close. | CI workflow edits and dispatch are not authorized in this DESIGN round. Do not reset existing pools/schema, run broad DROP/TRUNCATE/remove commands, delete `E:\openmaic\zhiban` or any existing DB/directory. Cleanup errors must be reported; no silent success. |

A future implementation may fail rather than exceed these limits. If a package requires a different host, network, function privilege, table operation or budget, document the exact blocker and seek an amended approval. Do not treat resource approval as approval of arbitrary administrative methods exposed by the storage package. Diagnostic provisioning is test setup, not permission for production startup DDL.

Because OpenMAIC document reference maintenance spans its asset registry, the proposal intentionally keeps document, asset registry and bytes in one **disposable OpenMAIC DB**, separate from Zhiban authority. Runtime tables may share that DB, but receive no browser credentials. This does not propose production DB topology or a cross-system transaction. Fixture mapping is in memory; durable mapping belongs to 1B-9A and its independently reviewed persistence contract.

### Review and explicit human approval — 2026-10-04

The user explicitly requested: “审阅并批准文档中的 B0-A01–A08 诊断资源提案”. Review checked this bundle against the execution plan, historical diagnostic plan, ADR-012, ADR-014 and the actual existing Storage PostgreSQL Contract workflow. No frozen architecture conflict or resource-scope expansion was needed. This records the human's approval; it is not an agent accepting ADR-012 on the human's behalf.

| Item | Review / approved boundary |
|---|---|
| B0-A01 | PASS / pinned official public artifacts only; no upgrade or new direct dependency. Artifact presence still needs fresh-build runtime evidence. |
| B0-A02 | PASS / test-only harness and evidence scope; no production API, Adapter or Identity implementation. |
| B0-A03 | PASS / one job-created PG16 diagnostic DB only. The existing workflow's freshly provisioned `openmaic` DB stays confined to its existing baseline checks; the new diagnostic uses `zhiban_0b_capability_test`, never that baseline DB or a pre-existing environment. |
| B0-A04 | PASS / bounded synthetic private PG bytes; no cloud, direct signed delivery or production GC. |
| B0-A05 | PASS / synthetic server registry resolves authority and mapping; fixture proof does not certify real Identity, Enrollment or durable mapping composition. |
| B0-A06 | PASS / loopback-only host and enforced runtime egress; browser interception alone cannot certify server egress. Failure to enforce either boundary blocks the affected probe. |
| B0-A07 | PASS / fixed concurrency/body/time/evidence limits. Ten minutes bounds both diagnostic passes, not the existing workflow's total setup/baseline duration; no workflow timeout increase is approved. If all required work cannot fit the unchanged job limit, stop and seek amended authorization. |
| B0-A08 | PASS / reuse the existing workflow, preserve baseline checks, verify one candidate twice and clean only exact newly created resources. Future workflow edits need precise-scope review; dispatch needs separate authorization. |

Approval does not start BUILD, create resources, run tests or dispatch CI in this round. D08–D10, positive iframe/stream/agent execution, paid AI, production deployment and data access remain unapproved. U01/U02 remain unresolved capability gates. D01's isolated host proof cannot be promoted to production root-Next isolation proof. Checkpoint/remote verification and the subsequent 1B-0B-B authorization remain the next gates.

REVIEW_VERDICT: PASS

APPROVED_ITEMS: B0-A01, B0-A02, B0-A03, B0-A04, B0-A05, B0-A06, B0-A07, B0-A08

RESOURCE_SCOPE_EXPANDED: NO

BUILD_AUTHORIZED_THIS_ROUND: NO

## Evidence gates and stop rules

1. B0-A01–A08 resource approval is recorded above. Before 1B-0B-B: complete the separately authorized documentation checkpoint and independent remote verification, obtain diagnostic BUILD authorization and confirm precise harness/workflow change scope and the new clean candidate. Do not use this document's base SHA to certify later modified code.
2. Before dynamic signoff: fresh artifacts; actual Node 22/Linux and PG16; synthetic data only; enforced runtime egress; recorded successful controls/negative probes; two complete runs. A skipped probe, unavailable configuration or artifact uncertainty is NOT_VERIFIED, not PASS.
3. Per capability report: required/optional/closed state, package/version/public seam, tested host/configuration, actual evidence and counts, supported content types, failure reason, untested production configurations, verdict and verification status. Keep the historical verdict vocabulary SAFE_ADAPTER / NETWORK_ISOLATION_REQUIRED / UPSTREAM_EXTENSION_REQUIRED / BLOCKED separate from the evidence status. A local isolated PASS can only certify its approved configuration.
4. Missing formal U01/U02 seams, required private import or Category C/D patch: stop the affected capability as BLOCKED_FOR_ARCHITECTURE_REVIEW. Do not restore native pages/tools/dev auth as a test workaround. No Identity ownership, Membership authVersion, Credential securityEpoch, Session semantics or applied migration is changed.
5. Schema initialization alone does not authorize a read. Denial after bytes are fetched, after a cross-learner write, or after an external side effect is not a passing security boundary. Validate lifecycle/version under the admitted same-client boundary; document residual cross-system TOCTOU rather than pretending a distributed transaction exists.
6. 1B-0B-B evidence must be reviewed before a human explicitly accepts ADR-012 for the admitted capabilities/resources. This document keeps ADR-012 PROPOSED. Production Adapter/mapping BUILD and integrated Identity/authorization/host proof remain separate 1B-9A/B/C units.

## Completion and next task

STATIC_REAUDIT: COMPLETE

DIAGNOSTIC_RESOURCE_AUTHORIZATION: B0_A01_A08_APPROVED

DIAGNOSTIC_BUILD_AUTHORIZATION: PENDING_SEPARATE_AUTHORIZATION

DYNAMIC_DIAGNOSTICS: NOT_RUN

SAFE_ADAPTER_DYNAMIC_PROOF: NONE

U01: UPSTREAM_EXTENSION_REQUIRED

U02: UPSTREAM_EXTENSION_REQUIRED

ADR_012: PROPOSED_UNCHANGED

PRODUCTION_BRIDGE: NOT_AUTHORIZED

FROZEN_CONTRACT_CONFLICT: NO

PRODUCTION_FILES_MODIFIED: 0

TEST_FILES_MODIFIED: 0

WORKFLOW_FILES_MODIFIED: 0

DATABASES_CREATED_OR_DELETED: 0

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO

NEXT: Separately authorize the single-document checkpoint. After independent remote HEAD/message/parent verification, authorize 1B-0B-B diagnostic BUILD within approved B0-A01–A08 resources; its checkpoint, CI execution and evidence review remain separate gates.

MODEL_PLAN: 1B-0B-A resource/design review — GPT-6.1 Sol / High; exact documentation checkpoint and remote verification — GPT-6 Sol / Low; 1B-0B-B isolated proof BUILD/security evidence review — GPT-6.1 Sol / High. These are task recommendations, not silent model switches or authorization to execute the next task.
