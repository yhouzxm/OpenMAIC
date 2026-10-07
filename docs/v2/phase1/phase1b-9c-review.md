# Phase 1B-9C — Runtime / AI Contract Foundation Closeout

STATUS: COMPLETE_FOR_APPROVED_CONTRACT_FOUNDATION / IMPLEMENTATION_FROZEN_FOR_APPROVED_SCOPE

Date: 2026-10-08. Branch: `refactor/zhiban-v2`. Signed-off candidate: `0239ef6614ddb037af0d1efd1b3a0f73a1c8261a`, parent `68774fcc9bc1ac98f81cbbd5ced73bbe7e2ac8d6`. Closeout preflight worktree: CLEAN.

This closes the bounded 1B-9C contract foundation approved by [C9-S01–S08](phase1b-9c-runtime-ai-design.md) and [C9-P01–P08](phase1b-9c-schema-acl-design.md), after exact-candidate PostgreSQL 16 signoff. The freeze covers the closed production ports/composition, fake-only AI foundation, disposable Runtime persistence contracts and their workflow gates. It does **not** open a production Runtime, learner launch, Attempt binding, record collection, real AI provider or paid call.

## Authority and implemented boundary

The authority is the two frozen C9 designs above, the [1B-9B Bridge closeout](phase1b-9b-review.md), [ADR-012](../adr/ADR-012-openmaic-identity-bridge.md), [ADR-013](../adr/ADR-013-openmaic-private-runtime-boundary.md) and the [execution plan](../zhiban-v2-execution-plan.md). Identity, Credential, Session, Authorization, HTTP and Bridge contracts remain frozen. Applied Identity migrations `0001`–`0013` are byte-for-byte unchanged; no `0014`, production Runtime binding table, fabricated Attempt model or production ACL expansion was introduced.

- The [Runtime Application port](../../../lib/zhiban/application/openmaic/runtime.ts) exposes only the fixed create, user/assistant append, complete, archive and bounded read action vocabulary with authentic handle/context, actor Membership, expected authorization/repository versions and closed results. The [AI Application port](../../../lib/zhiban/application/openmaic/ai.ts) admits only `AUTHORING_DRAFT_TEXT`, fixed schemas and FAKE provenance. Provider objects, SQL clients, native references, prompts, raw errors and arbitrary tools do not cross those ports.
- The [production foundation root](../../../lib/zhiban/infrastructure/openmaic/runtime/root.ts) accepts no injected business capability and returns `DENIED` for Runtime and AI. Real Attempt/Enrollment/resource facts are unavailable, so production cannot create a positive binding through an environment flag, caller callback or fake loader.
- The Runtime infrastructure implements bounded validation, admission, records, guarded native calls and the approved reserve → durable dispatch mark → native transaction → local settlement protocol. The local operation fence, revisions, audit and outcome rules are exercised through a test-only PostgreSQL repository/schema. Uncertain native outcome or failed local completion retains a closed fence; no automatic retry, cross-database ACID or broad reconciliation endpoint is claimed.
- The actual public `PgRuntimeStore` is used with the official OpenMAIC source pin `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce`, Runtime protocol `0.1.0`, storage package `0.31.1`, DSL package `0.11.2` and document protocol `0.3.0`. Queryable create, append/status transaction hooks, one-attempt SQLSTATE translation, closed errors and pool/client cleanup are tested without a private package patch.
- The deterministic [fake AI provider](../../../lib/zhiban/infrastructure/openmaic/ai/fake.ts) retains the fixed template/policy revisions, one call, byte/deadline limits, capacity two/no queue and permit retention until provider settlement. It has no key discovery, network/model/tool/filesystem access, persistence or automatic publication. Its positive tests are contract evidence only, not model-quality or prompt-injection acceptance.
- [C9-I](../../../tests/zhiban/identity/postgres/pg16-runtime-foundation.test.ts) uses the disposable `zhiban_runtime_contract_test` schema and existing Identity security facts. [C9-N](../../../tests/zhiban/runtime/native-pg.test.ts) provisions a separate disposable Runtime database with exact owner/migrator/runtime roles and public provider ACL. Both are test-only; neither schema is a production migration or deployment recipe.

The [Ubuntu LOCAL continuation](phase1b-9c-local-pg16.md) adds an explicit `LOCAL` mode for the dedicated PG16 cluster, provenance checks, serialized two-pass execution and exact cleanup boundaries. It never sets `GITHUB_ACTIONS`, cannot use the normal 5432 cluster, and is marked LOCAL throughout. Its receipts and timing diagnostics helped repair the candidate, but they are not substituted for CI signoff.

## Exact-candidate CI signoff

Both authorized workflows ran once from the same committed SHA `0239ef6614ddb037af0d1efd1b3a0f73a1c8261a` and completed successfully. The environment recorded Ubuntu/Linux x64, Node v22.23.3, pnpm 10.28.0 and PostgreSQL 16.15.

| Evidence | Selection and exact result |
| --- | --- |
| [Identity run 37646908710](https://github.com/yhouzxm/OpenMAIC/actions/runs/37646908710) | `workflow_dispatch`, `full`, SUCCESS. Fifteen required PG16 files passed **438/438 ×2**, zero skipped: retained baseline **402** plus C9-I **36** each pass. |
| Identity non-PG/tooling in run 37646908710 | Identity **1490**, Bridge **72**, Runtime **95** = **1657 PASS**. Bridge's separately configured native 11 and browser 2 cases were optional skips in this step. Root lint passed with 0 errors/20 warnings; root `tsc --noEmit` passed with the process-only 8192-MiB budget. |
| [Storage run 37646937823](https://github.com/yhouzxm/OpenMAIC/actions/runs/37646937823) | `workflow_dispatch`, `bridge-recheck`, SUCCESS. Retained B9 native **11/11 ×2** and C9-N **20/20 ×2**: **62 PASS**, zero skipped in the required native commands. |

Identity created a fresh official-provider receipt and both C9-I `beforeAll` invocations verified current GITHUB SHA, official source, lock and built artifact before executing. Storage's B9/C9 setup verified current base head, official source, fresh build, Node/platform and live PG16 schema/provider behavior. The workflows uploaded no receipt/provenance artifact; this closeout therefore records the successful checks and logs without inventing raw CI hash values or copying LOCAL receipt values into CI.

All required Identity PG teardown hooks completed before each full-pass marker and the job stopped its containers. Storage C9-N closed tracked pools, removed its owned disposable database and roles, required a fresh empty setup on pass two, removed the exact diagnostic workspace and stopped containers. Neither job printed a separate post-hook zero-schema/role inventory query, so this document does not claim one. The independent zero-inventory observation belongs only to the earlier LOCAL receipt and its candidate scope.

## Findings closed before signoff

The earlier [Identity run 37384425524](https://github.com/yhouzxm/OpenMAIC/actions/runs/37384425524) at `68774fcc…` remains a failed historical run: the original PG16 baseline passed 402/402, C9-I passed 12/36 and failed 24, and the second pass/non-PG regression did not execute. It exposed a test fixture UUID domain that rejected the legal nullable `outstanding_operation_id` and an assertion that expected 19 fields although the frozen operation record has 18. Both fixture/test defects were corrected without changing production semantics or applied migrations.

LOCAL timing then isolated the migration runner and Membership cases that could legitimately approach the default five-second Vitest body timeout because they include process startup, KDF and real SQL. The LOCAL runner alone supplies a 15-second real-PG test budget; CI commands and their frozen default test budget were left unchanged. Exact-file collection guards reject missing, empty, skipped, unexpected or duplicate requested suites even if Vitest exits successfully. Negative guard regression passed. The retained LOCAL evidence is deliberately split: one complete pass belongs to the earlier candidate and one fresh complete pass to the final reviewed content, so it is **not** represented as an uninterrupted same-candidate two-pass signoff. The exact committed content subsequently supplied the required two complete rounds in CI.

The historical Storage run `37336615018` retains only its original SHA and selected-suite scope. The new exact-candidate Storage run independently proves the B9/C9 native subset described above; it does not rewrite that older result.

## Evidence boundary

- No new general `ci.yml` run was dispatched for `0239ef…`. Earlier general CI and B9 results retain their exact historical SHA/suite scope. This closeout makes no new full build, formatter, importer, DSL, generation, renderer, browser, E2E, Docker or deployment claim.
- Identity's 13 optional Bridge native/browser skips are reported as skips, not PASS. B9 native is independently covered by the Storage run; browser behavior was not rerun for this candidate.
- Storage `bridge-recheck` intentionally skipped the full Storage package, App-domain and full isolated/browser steps. Its 62 native passes cannot be described as a new Storage-full signoff.
- C9-I proves the approved disposable schema, authentic existing Identity barriers, independent-connection races and production gate denial. Synthetic fixture resource/Attempt facts do not prove a real Enrollment/Attempt relationship or authorize learner activity.
- C9-N proves the approved disposable native schema/ACL/provider contract. Poison-JSON and scalar-only probes preserve the known public getter limitation; they do not establish supported scalar/JSON integrity or a bounded records API.
- Fake AI tests prove only the closed local contract, budgets, cancellation/late-settlement behavior and absence of side effects. They provide no D09, real-model, token/cost, prompt-injection, output-quality or paid-provider evidence.

Within this exact approved foundation scope, P0/P1/P2 are zero. The closed production composition and unresolved downstream prerequisites are deliberate acceptance boundaries rather than missing tests hidden by this signoff.

## Deferred gates

- **Production business model and persistence:** define and approve real Course/Activity/Enrollment/Attempt ownership, tenant-composite FKs, learner-versus-actor policy, state transitions and lock participants. Only then may a separately reviewed production Runtime schema/migration/ACL replace the test fixture. Production business resource access and actual learner launch remain closed.
- **Integrity, reads and recovery:** obtain supported scalar/JSON integrity guarantees and a bounded record API before enabling scalar-dependent append/status or `READ_RECORDS`. Exact reconciliation authority and evidence are still required for uncertain create/status outcomes; append remains quarantined where the public API cannot prove its result. No private SQL repair, unbounded list, merge, delete or broad admin path is approved.
- **Enabled Bridge and operations:** 1B-10 must repeat authorization and revocation negatives through actual Application/HTTP/DB/host paths and prove direct/native/static/runtime/SSE isolation. Production D01 database/network/host separation, credentials, provisioning, backup/retention, observability, capacity and cutover require separate OPS acceptance.
- **AI use cases:** concrete authoring belongs to 2D with D09 and real authority, provider, prompt/schema, tokenizer/usage, durable actor/cost budget, job idempotency, human review and publication controls. Tutor/retrieval/assistant work belongs to 7D. No real provider, paid call, generic agent/tool or automatic Runtime append is authorized here.
- **Learning evidence and migration completeness:** issuance/adoption of learning evidence remains in 3B/3C. U01 complete Classroom/Playback and U02 Interactive/VirtualLab remain `REQUIRED_LATER`; this foundation cannot be used to mark them complete or reduce the migration scope.

PHASE_1B9C: COMPLETE_FOR_APPROVED_CONTRACT_FOUNDATION

RUNTIME_AI_DESIGN: FROZEN_C9_S01_S08_AND_C9_P01_P08

IMPLEMENTATION: FROZEN_FOR_APPROVED_CONTRACT_FOUNDATION

SIGNED_OFF_SHA: 0239ef6614ddb037af0d1efd1b3a0f73a1c8261a

REAL_IDENTITY_PG16_SIGNOFF: PASS_438_OF_438_TWICE

REAL_C9_IDENTITY_PG16_SIGNOFF: PASS_36_OF_36_TWICE

REAL_STORAGE_NATIVE_SIGNOFF: PASS_B9_11_OF_11_TWICE_AND_C9_20_OF_20_TWICE

NON_PG_EXPLICIT_REGRESSION: PASS_1657_WITH_13_OPTIONAL_SKIPS

PRODUCTION_RUNTIME_COMPOSITION: DENY_ONLY

PRODUCTION_BUSINESS_RESOURCE_ACCESS: CLOSED

ACTUAL_LEARNER_LAUNCH: NOT_AUTHORIZED

SCALAR_DEPENDENT_RUNTIME_OPERATIONS: BLOCKED_PENDING_SUPPORTED_INTEGRITY_PROOF

AI_PROVIDER: FAKE_ONLY_FOUNDATION

PAID_AI_AND_D09: NOT_AUTHORIZED

PRODUCTION_D01_ISOLATION: NOT_VERIFIED

P0: 0

P1: 0

P2: 0

READY_FOR_1B9C_CLOSEOUT_CHECKPOINT: YES

READY_FOR_1B10_DESIGN: YES_AFTER_CLOSEOUT_CHECKPOINT_AND_SEPARATE_AUTHORIZATION
