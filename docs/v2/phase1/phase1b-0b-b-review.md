# Phase 1B-0B-B — Isolated Diagnostic Evidence Closeout / Capability Verdict

STATUS: COMPLETE_FOR_APPROVED_DIAGNOSTIC_SUBSET / EVIDENCE_FROZEN

Date: 2026-10-04. Branch: `refactor/zhiban-v2`. Signed-off candidate and closeout base HEAD: `b46f1f6aa452ad2026385d3ddcf6dee060272c32`; parent `ca6e69c3b58dbc199e1db1ee57cde405c9f6e56e`; message `test(zhiban-v2): repair openmaic diagnostic fixtures`. Closeout preflight: CLEAN.

This closes the separately approved **B0-A01–A08 diagnostic resource bundle**, covering D01–D05 and D06/D07 closed-path negatives. It does not close every OpenMAIC capability, accept ADR-012, authorize a production Bridge or downgrade the required learning product to slide preview. Only this document is added; no test, production code, workflow, migration, dependency, database or deployment is changed. No tests are rerun and no CI is dispatched by this documentation task.

## Authority and evidence scope

Authority is the [execution plan](../zhiban-v2-execution-plan.md), [approved capability/resource review](phase1b-0b-a-capability-review.md), [BUILD and fixture history](phase1b-0b-b-build.md), [historical diagnostic plan](phase1b-0b-diagnostic-plan.md), [gate map](phase1b-gate-map.md), [ADR-012](../adr/ADR-012-openmaic-identity-bridge.md), and [U01/U02 backlog](openmaic-upstream-extension-backlog.md). This closeout supersedes the earlier BUILD document's pending labels **only for the signed-off diagnostic subset**; earlier audit counts and historical findings remain unchanged.

Implementation/evidence anchors are the [test-only boundary](../../../tests/zhiban/openmaic/boundary.test.ts), [real PG16 cases](../../../tests/zhiban/openmaic/pg16-diagnostic.test.ts), [HTTP host tests](../../../tests/zhiban/openmaic/host.test.ts), [egress tests](../../../tests/zhiban/openmaic/egress.test.ts), [artifact tests](../../../tests/zhiban/openmaic/artifacts.test.ts), [browser probe](../../../tests/zhiban/openmaic/browser.spec.ts), [fresh workspace preparation](../../../tests/zhiban/openmaic/prepare-workspace.mjs), [two-pass runner](../../../tests/zhiban/openmaic/run-diagnostics.mjs), and [existing Storage workflow](../../../.github/workflows/storage-pg-contract.yml).

The official v1.1.2 reference remains `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce`, not moving upstream/fork main. The diagnostic consumes public package specifiers only. The preparation gate checks committed package trees against this exact reference, archives candidate sources, uses pinned pnpm/frozen dependencies, builds fresh artifacts and records provenance. Checkout/run metadata tie this preparation to the signed-off candidate; the artifact tests check fresh-build status, official reference, lock digest and runtime environment. This is the audited CI preparation chain, not an independently signed or permanently retained artifact certificate.

| Public package | Version | Proven consumption boundary |
| --- | --- | --- |
| `@openmaic/dsl` | 0.11.2 | Public schema/types and structural validation; not ownership or authorization. |
| `@openmaic/storage` | 0.31.1 | Published document, asset/bytes and runtime PG stores/hooks in the disposable database; not Zhiban Policy. |
| `@openmaic/generation` | 0.3.13 | Public browser entry resolves/loads; no positive generation/provider execution signoff. |
| `@openmaic/editor` | 0.0.9 | Public core entry resolves/loads; no positive editing/save-use-case signoff. |
| `@openmaic/renderer` | 0.1.11 | Public SlideCanvas with the closed preview projection; not complete Classroom. |
| `@openmaic/importer` | 0.3.0 | Public export targets/entry resolution; not importer pipeline execution or Node compatibility. |

## Final real CI evidence

Primary evidence: [Run 37208515834](https://github.com/yhouzxm/OpenMAIC/actions/runs/37208515834), [job 111454700202](https://github.com/yhouzxm/OpenMAIC/actions/runs/37208515834/job/111454700202).

| Evidence | Actual result |
| --- | --- |
| Workflow / event | Storage PostgreSQL Contract / `workflow_dispatch`; newly dispatched run, not a rerun of the failed candidate. |
| Run/checkout HEAD | `b46f1f6aa452ad2026385d3ddcf6dee060272c32`, exact match. |
| Status / conclusion | COMPLETED / SUCCESS; job duration **5 min 36 s**, within the unchanged 10-minute total job limit. |
| PostgreSQL | **16.15 (Debian 16.15-1.pgdg13+2)**; no PG18 substitution. |
| Runtime | **Node v22.23.3 linux/x64**, Ubuntu **24.04.5**, pinned pnpm **10.28.0**. |
| Frozen installs | Root and disposable diagnostic workspace PASS; no lockfile rewrite. |
| Fresh builds | Prerequisites plus all six public packages rebuilt successfully in the exact job-created workspace. |
| Diagnostic typecheck | `pnpm exec tsc -p tests/zhiban/openmaic/tsconfig.json` actually executed before the runner; PASS. |
| Diagnostic run 1 | **101/101 unit/PG + 1/1 browser PASS**, all five required Vitest files collected, no skipped diagnostic case. |
| Diagnostic run 2 | **101/101 unit/PG + 1/1 browser PASS**, same required collections, no skipped diagnostic case. |
| Cleanup | Exact workspace removal explicitly logged; runner completed successfully through its created-DB cleanup path, with no database cleanup error. Forced cancellation cleanup is not certified. |
| CI rerun | NO; no assertion/SQL failure was automatically rerun. |

Per-pass collection is **42 boundary + 25 real PG16 + 21 HTTP host + 10 artifacts/provenance + 3 egress = 101**. The PG suite has 22 named B0-PG groups and 25 actual cases because B0-PG13 expands four mapping states; it is not 25 new capability families. Playwright then executes the one real SlideCanvas/browser/PG composition probe. Both `B0 DIAGNOSTIC RUN 1 PASS` and `B0 DIAGNOSTIC RUN 2 PASS` appear in the actual log.

Previously passed baseline evidence is reused, not re-audited as a new Identity/production signoff. The fixed workflow nevertheless retains and executes its existing baseline: Storage **1,314 PASS / 7 existing SKIPPED** and four App-domain files **18/18 PASS**, with no new failure. Those seven skips are not diagnostic skips. No selection input or workflow change was introduced to avoid those commands.

Root full-project lint/typecheck are **not** steps of this Storage workflow and must not be reported as CI PASS. Earlier targeted diagnostic lint/typecheck passed locally; the root full-project tooling resource limitation remains a carried-forward verification note, not an assertion failure or proof of a production defect.

## Fixture findings resolved before closeout

The [first run 37206715968](https://github.com/yhouzxm/OpenMAIC/actions/runs/37206715968), at `ca6e69c3b58dbc199e1db1ee57cde405c9f6e56e`, passed 97/99 diagnostic Vitest cases but did not reach browser or the second pass. Two fixture assumptions were corrected in the new candidate, with no public package/production/workflow change:

- **B0-PG16:** the official validator accepts an empty string name. The corrected wrong-runtime-type fixture explicitly fails public validation, then proves save rejection, unreadable ORPHAN state, mapping revision exactly `2`, one write attempt, unchanged persisted document/name and unchanged freshness manifest. No new non-empty-name business rule is invented.
- **B0-PG22:** the public runtime getter reads the JSONB envelope, not the duplicated indexed learner column. The corrected fixture poisons both the scalar learner and `data.learnerKey`, proves the public getter sees the foreign learner, requires boundary rejection, and proves subsequent persisted/public reads remain corrupted rather than silently repaired. Trusted fixture bindings remain unchanged.
- Two additional boundary regressions preserve these behaviors through actual published BrowserDocumentStore/PgRuntimeStore implementations; the local query-double case is not itself real PG proof. The corrected real PG cases now pass in both complete CI passes.

**Remaining public-read limitation:** scalar `learner_key`/`stage_id` versus JSONB consistency is **NOT_VERIFIED**. The getter does not expose/compare those duplicated columns; a scalar-only corruption test cannot certify the envelope boundary. If production integration requires this guarantee, 1B-9 must resolve a supported public-contract/upstream capability path. This closeout authorizes no private SQL production guard, source patch or repair behavior, and does not claim rejection of every persisted corruption shape.

## Capability verdict

The historical verdict vocabulary is retained: **SAFE_ADAPTER / NETWORK_ISOLATION_REQUIRED / UPSTREAM_EXTENSION_REQUIRED / BLOCKED**. Evidence status is separate. A scoped SAFE_ADAPTER below means isolated contract feasibility under the approved host/configuration, **not production implementation approval**. These rows do not recalculate or overwrite the historical 0A surface totals.

| Capability / required state | Verdict | Verification status / decisive evidence | Unproven or closed scope |
| --- | --- | --- | --- |
| D01 controlled host/native bypass closure; prerequisite to any integration | NETWORK_ISOLATION_REQUIRED | ISOLATED_PASS — loopback host, explicit routes/methods, forged authority/path/Host/action negatives, API-level egress fences and B0-PG19 pass twice. | Current root native routes remain PRESENT; production network/build/direct-byte topology NOT_VERIFIED. Tiny-host 404 is not root-Next removal. |
| D02 private PG assets/bytes through authorized gateway | SAFE_ADAPTER, approved isolated configuration only | ISOLATED_PASS — B0-PG04–07, current association/principal checks, unauthorized/copy/HEAD/range/cache negatives and browser post-revoke rejection, twice. | No cloud/CDN/public bucket/signed redirect/production cache proof; already downloaded bytes cannot be revoked. |
| D03 public PG Runtime with server-bound learner/Stage/Attempt | SAFE_ADAPTER, approved isolated configuration only | ISOLATED_PASS — B0-PG08–12, independent acknowledged-connection append CAS, B0-PG21 pre-commit rollback and corrected B0-PG22 envelope rejection, twice. | Scalar/JSON consistency NOT_VERIFIED; synthetic authority is not real Identity/Enrollment or cross-system commit coordination. Broad merge/delete/admin routes remain closed. |
| D04 public PG Document behind mapping gate | SAFE_ADAPTER, approved isolated configuration only | ISOLATED_PASS — B0-PG03 and PG13–17; pre-read denial, authorized controls, fixture CAS, corrected failed-save persisted-state checks, twice. | Mapping is in memory, not durable production ownership/CAS/reconciliation; id-capable reads are not inherently tenant-safe. |
| D05 closed slide-only preview | SAFE_ADAPTER, approved isolated configuration only | ISOLATED_PASS — actual public SlideCanvas + real PG fixture in Chromium, bounded plain text/image/audio/video request projection and gateway media paths, 1/1 twice. | No full Classroom/Quiz/PBL/whiteboard orchestration, arbitrary rich HTML or video decoding/playback proof; synthetic WebM establishes request routing only. |
| D06 interactive/iframe positive execution; closed in this batch | UPSTREAM_EXTENSION_REQUIRED | CLOSED_NEGATIVE_PASS — no iframe/interactive execution, unknown/non-slide content rejected; U02 positive path NOT_VERIFIED. | Negative proof does not validate a positive sandbox, message protocol or trusted learning evidence. |
| D07 agent/tool/native stream positive execution; closed in this batch | BLOCKED for positive execution in this authorization | CLOSED_NEGATIVE_PASS — native agent/action/SSE/admin paths do not dispatch work. | No positive stream/reconnect/revocation latency or in-flight provider cancellation proof; no general agent approval. |
| D08 teacher editing / D09 controlled generation | BLOCKED pending separate diagnostic authorization | NOT_AUTHORIZED / NOT_RUN; export resolution is not positive capability proof. | Need separately approved authority/save/output/budget/rollback diagnostics before opening either capability. |
| D10 optional browser import | BLOCKED pending separate diagnostic authorization | NOT_AUTHORIZED / NOT_RUN; entry resolution only. | Browser pipeline, archive abuse/resource limits/upload workflow and Node support remain unproven. |
| U01 complete Classroom/playback host | UPSTREAM_EXTENSION_REQUIRED | NOT_VERIFIED; no supported complete public hosting seam established. | No copying private engine or native Classroom fallback. |
| U02 isolated interactive host/protocol | UPSTREAM_EXTENSION_REQUIRED | NOT_VERIFIED; no supported positive host/protocol established. | No private iframe pool/helper import, same-origin HTML workaround or relaxed sandbox. |

D02–D05 verdicts describe feasibility of guarded public seams, not a new grant to consume them in production. Supported content is only the implemented closed preview/media subset. Schema validation does not supply ownership, safe HTML, business relationships or authoritative learning outcomes. Admin fixture status alone never grants teaching-resource access.

## Frozen diagnostic boundary and remaining integration gates

The freeze preserves public exports, exact official package versions, synthetic identities, server-derived fixture authority, closed/sanitized errors and no real secrets/provider calls. It preserves one new diagnostic PG16 database, bounded synthetic bytes (4 MiB each / 32 MiB aggregate), loopback-only probe traffic, two admitted operations with no queue, 4 MiB bodies, 10 s operations and the unchanged budgets. The Node API fence/browser interception is **not an OS sandbox for arbitrary hostile JavaScript**. No adversarial script execution is certified.

Identity, Credential, Session, Authorization, 1B-8 recovery, RepositoryRevision, securityEpoch, Membership authorizationVersion and applied migrations are not reopened. No production schema/role model or startup DDL is selected by disposable published-schema provisioning.

Before a production path is designed or opened, the corresponding separately authorized units must establish:

1. **Human ADR-012 acceptance for exact admitted resources/capabilities.** This report supplies evidence for review; ADR-012 remains PROPOSED. U01/U02 and the first-release activity manifest must not be silently dropped or represented as satisfied by preview.
2. **1B-9A durable mapping/lifecycle design:** Zhiban ownership, opaque handles, revisions, pending/active/orphan/transfer/retention, idempotency and reconciliation; no tenant/business columns grafted into OpenMAIC tables. External effects and Zhiban transactions are not distributed ACID.
3. **1B-9B/C and 1B-10 integration proof:** real Session/Policy and current authorization, resource relationships, Credential/User/grant changes coordinated with side effects, actual roles/ACL and same-client guarantees, production native-route/static/direct-byte closure, cache/range/stream behavior and every supported media sink. An in-memory pre-commit check alone does not close the check-to-commit race with real Identity state.
4. **Capability-specific follow-ups:** resolve scalar/JSON integrity if needed; independently approve D08/D09/D10 resources; resolve U01/U02 through supported contracts and positive diagnostics before their required learning/Portal paths. No upstream issue, external message or source fork is created by this closeout.
5. **Root tooling and deployment:** carry forward root full-project lint/typecheck verification, real operational configuration/topology and release gates. Existing successful isolated typecheck is not their substitute. Production cutover, V1 data access and paid AI remain out of scope.

## Final state and next task

P0/P1 below count unresolved findings **inside the approved diagnostic unit**, not absent production capabilities. U01/U02 retain their separately documented product blockers (P1 required-later, release P0 if declared first-release mandatory); they are not downgraded to maintenance notes. The previous pending dynamic-evidence P2 is closed. One root tooling verification note is retained outside the isolated diagnostic gate; it must be checked in the relevant integration unit.

PHASE_1B0B_B: COMPLETE_FOR_APPROVED_DIAGNOSTIC_SUBSET

DIAGNOSTIC_EVIDENCE: FROZEN

REAL_PG16_SIGNOFF: PASS_25_OF_25_TWICE

TWO_COMPLETE_PASSES: PASS_101_UNIT_PG_PLUS_1_BROWSER_EACH

NODE22_LINUX_FRESH_ARTIFACT_PROOF: PASS_AT_b46f1f6a

SAFE_ADAPTER_SCOPE: D02_D05_APPROVED_ISOLATED_CONFIGURATION_ONLY

PRODUCTION_ISOLATION: NOT_VERIFIED

SCALAR_JSON_CONSISTENCY: NOT_VERIFIED

U01: UPSTREAM_EXTENSION_REQUIRED

U02: UPSTREAM_EXTENSION_REQUIRED

ADR_012: PROPOSED_UNCHANGED

PRODUCTION_BRIDGE: NOT_AUTHORIZED

FROZEN_CONTRACT_CONFLICT: NO

P0: 0

P1: 0

P2: 1 — carried-forward root full-project tooling verification; not a failure of the signed-off isolated diagnostic gate.

DOC_FILES_MODIFIED: 1

OTHER_FILES_MODIFIED: 0

COMMIT: NO

PUSH: NO

CI_DISPATCH_THIS_CLOSEOUT: NO

READY_FOR_1B0B_B_CLOSEOUT_CHECKPOINT: YES

READY_FOR_1B9_BUILD: NO

NEXT: Separately authorize this single-document exact-scope checkpoint and independent remote HEAD/message/parent verification (**GPT-6 Sol / Low**). Then explicitly review/accept ADR-012 for the exact admitted capability/resource scope and decide the still-required U01/U02 release gates (**GPT-6.1 Sol / High**); only after that may **1B-9A DESIGN** be separately authorized (**GPT-6.1 Sol / High**). No model switch, architecture acceptance or subsequent BUILD is silently authorized.
