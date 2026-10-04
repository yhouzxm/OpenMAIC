# Phase 1B-9A OpenMAIC Bridge / Mapping / Lifecycle Design

STATUS: REVIEWED / APPROVED / FROZEN_DESIGN_BOUNDARY

Date: 2026-10-04. Branch: `refactor/zhiban-v2`. Design baseline: `82403cdafb401db69e2c52df19c981965b6167a0`.

This document records the explicitly approved eight design contracts, B9-S01–S08. On 2026-10-04 the user authorized “审阅并批准 B9-S01–S08”; the targeted review and same-scope fail-closed clarifications below are recorded under that authorization. Approval freezes the design boundary, not an implemented or verified production capability. It does not authorize BUILD, migrations, production provisioning, deployment, commit, push or CI dispatch. Existing Identity, Credential, Session, Authorization and 1B-8 contracts remain frozen. Historical diagnostic fixtures are evidence, not production authorization or resource loaders.

## Authority and targeted repository findings

Current acceptance is [ADR-012](../adr/ADR-012-openmaic-identity-bridge.md): **limited D02–D05 architecture accepted**, D01 production isolation/real authorization still required. [Execution plan](../zhiban-v2-execution-plan.md), [original Bridge ownership proposal](openmaic-identity-bridge.md) and [0B evidence closeout](phase1b-0b-b-review.md) define the inherited boundary. Historical PROPOSED statements in the latter documents do not override the current ADR.

Targeted implementation sources, relative to this document:

- [Identity authorization composition](../../../lib/zhiban/application/identity/authorize.ts), [pure policy](../../../lib/zhiban/domain/identity/policies/authorization.ts), [transactional authorization repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/authorization.ts), [Session/authentication composition](../../../lib/zhiban/infrastructure/identity/composition/authentication.ts), [revision closeout](phase1b-4-review.md), [permission matrix](permission-matrix.md).
- Public [DocumentStore](../../../packages/@openmaic/storage/src/document/types.ts), [RuntimeStore](../../../packages/@openmaic/storage/src/runtime/types.ts), [PgRuntimeStore](../../../packages/@openmaic/storage/src/runtime/pg.ts), [AssetStore](../../../packages/@openmaic/storage/src/asset/types.ts). [Diagnostic boundary](../../../tests/zhiban/openmaic/boundary.ts) and [closed preview](../../../tests/zhiban/openmaic/preview.ts) are test-only.

| Repository fact | Design consequence |
| --- | --- |
| Current `identity-v1` action/catalog validation covers Membership/Role mutations, not activity actions | Never substitute `MEMBERSHIP_READ` or TENANT_ADMIN status for resource permission. A business catalog/action contract is a prerequisite for opening its use case. |
| Authentication handle registry and locked Session revalidation are private composition capabilities | A UserId, copied handle, TenantContext or old ALLOW is insufficient. Bridge needs an approved minimal security composition seam, not private-method imports. |
| Document save has no caller expected-revision CAS; Asset put allocates a new ID | Zhiban CAS governs publication; replacements use new immutable external generations, not last-write-wins updates to published content. |
| Public Runtime get loads JSON; list partitioning uses duplicated scalar columns | Validate exact returned bindings; do not claim scalar/JSON consistency or use indexed listing as ownership proof. |
| PgRuntime append internally retries `23505` / `40001` / `40P01` | Bridge must suppress unsafe automatic replay at the public transaction-hook boundary; see B9-S08. |
| Applied Identity migrations are `0001–0011` | All remain byte-for-byte unchanged. New schema/helper/ACL requires a separately approved exact supplement and the then-next migration number. |

## B9-S01 — Capability and host boundary

Proposed production shape: a **Zhiban-owned server gateway/adapter using fixed public packages**, a private OpenMAIC storage database and private byte backend. The gateway must not mount native OpenMAIC persistence, agent, action, editor, importer, admin or dev-auth routes. Browser bundles receive only the accepted public slide renderer and reconstructed closed projections, never native stores or credentials. Network isolation must cover database, byte origin, alternate ports/hosts, static paths and redirects; route absence alone is not network proof.

Reference remains official v1.1.2, SHA `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce`: DSL `0.11.2`, storage `0.31.1`, renderer `0.1.11`. No package-tree changes, internal imports, copied private engines, insecure dev auth or core patches.

| Capability | Admitted candidate | Still closed |
| --- | --- | --- |
| D02 | Registered private assets through reauthorized gateway reads | Direct byte URLs, shared-principal fallback, request-time physical deletion |
| D04 | Exact mapped document/scene read; controlled creation of unpublished replacement generations | Arbitrary editor/native write route, published in-place overwrite, global enumeration |
| D05 | Closed slide projection: plain text, image, audio, video references | Rich HTML, arbitrary CSS/URLs, iframe, interactive scripts, Classroom/playback orchestration |
| D03 | Exact mapped runtime persistence contracts, later bound to real learning resources | Actual learner launch before Attempt/learning design, broad learner merge/delete, grades derived from Runtime JSON |

D06/D07 negative results do not admit execution; D08–D10 require separate diagnostics/acceptance. U01/U02 remain REQUIRED_LATER, default R3/7A–7B, not R1 hard requirements and not optional full-migration features. A release making them mandatory is blocked until they pass. Preview is not completion evidence.

## B9-S02 — Trusted ownership, resource facts and closed operations

Zhiban owns Tenant, business resource, owner Membership, publication and learner/Attempt relationships. OpenMAIC IDs, owner/principal and learner keys are opaque Infrastructure references, never authorization facts. Server generates non-derivable 256-bit opaque principal/learner handles; no client-supplied anonymous cookie, owner, learnerKey, StageId or runtimeSessionId is accepted as authority. Principal partitioning is not authorization.

Application ports are bounded collaborators: `OpenMAICResourceAccessPort`, mapping/operation persistence, trusted resource-facts loader and security guard. Domain reuses pure policy evaluation; it imports neither OpenMAIC packages nor SQL/HTTP. Infrastructure implements public package calls and privileged projections. Ordinary DTOs contain only Zhiban resource IDs, approved preview/media projections and closed results, not upstream owner credentials or raw persistence rows.

| Closed operation | Required server-produced facts | Public seam |
| --- | --- | --- |
| READ_PREVIEW / READ_SCENE / READ_ASSET | Current Session, User/Tenant/Membership, one effective grant with permission AND scope, real resource relationship/state, active mapped generation and referenced asset | Exact Document/Scene/Asset lookup followed by validated projection |
| PREPARE_CONTENT / PREPARE_ASSET | Current author authority, real resource owner/assignment, expected mapping revision, approved input and budgets | New unpublished Document generation / Asset put |
| ACTIVATE_GENERATION | Fresh author/publication authority, complete verified candidate and all asset bindings, expected slot revision | Zhiban-only pointer switch; not OpenMAIC public/published flag |
| SUSPEND / RETIRE / TRANSFER | Explicit resource-management policy and current revisions | Local deny/intent; transfer recreates under a new opaque owner, not native bulk re-key |
| READ_RUNTIME / APPEND_RUNTIME / TRANSITION_RUNTIME | Real Attempt, actor learner Membership, exact activity generation, permitted runtime kind/state and expected tail | Exact get/append/status APIs only, subject to B9-S08 |
| RECONCILE | Restricted ServiceActor purpose, exact recorded intent/handles and current resource status | Exact public lookup; cannot activate/publish or assume another tenant's resources |

These are Bridge operation names, **not additions to `IdentityAction` or automatic permission grants**. Existing proposed `activity:author`, `activity:consume`, `activity:manage_metadata` require approved business catalog/rules/loaders in the corresponding Course/Activity/Learning unit. Administrative metadata authority never implies content/learner access. SYSTEM_ADMIN is not a tenant teaching fallback. Same-grant permission/scope, exact CLASS/COURSE/SELF relationships and default DENY remain mandatory.

No real Activity/Course/Attempt currently established for a use case means **that production use case stays CLOSED**. 1B-9B/C may implement disabled adapters/contracts with synthetic test resources; no production dummy resource IDs, fake FKs, nullable ownership escape or trusted client relationship booleans. Later 2C/3A/3B approve genuine resource loaders and binding constraints before activation.

## B9-S03 — Durable mapping and revision contract

Proposed logical records live in a Zhiban-owned tenant schema, separate from `zhiban_identity` and native OpenMAIC tables. Exact SQL names, types, FKs, triggers, privileges and helper signatures belong to the required schema/ACL supplement, not implicit permission to create them here.

| Record | Required durable information / invariant |
| --- | --- |
| Resource binding slot | Tenant + real resource identity + deployment + owner Membership; permanent anchor, current active generation pointer, RepositoryRevision. One slot per resource/deployment; same-tenant owner/resource constraints. |
| Resource generation | Slot identity, monotonically increasing generation, server owner handle, opaque StageRef, immutable validated content/version digest, state, created/activated/terminal timestamps; unique external reference per deployment. |
| Asset binding | Tenant, generation, purpose, registered AssetRef/principal, MIME, length and validated byte digest; all admitted scene/poster/background/media references explicitly linked. No guessed asset becomes readable. |
| Runtime binding | Tenant, real Attempt and learner Membership, pinned active resource generation, server learner key, exact runtime ID/kind/version, lifecycle and revision; no anonymous-to-user merge inference. |
| Operation ledger | Tenant, resource, actor/service purpose, closed operation, idempotency-key digest, normalized intent digest, expected revisions, fixed external IDs when caller-assignable, state/result and timestamps. |
| Bridge audit | Closed event/field vocabulary, mapping/operation IDs and state/revision transitions; same Zhiban client/transaction as local mutation. No arbitrary JSON or expansion of frozen Identity audit union. |

Tenant ownership is immutable; cross-tenant transfer is CLOSED. External references have no cross-database FK and cannot resolve ownership by themselves. Business references must be real and constrained when their schema exists. No additions of tenant, role, permission or Attempt columns to native Stage/Runtime tables.

RepositoryRevision exactly reuses canonical positive signed int8 decimal strings, BigInt validation, stale-before-no-op, unchanged genuine no-op, mutation +1 exactly once and maximum fail-closed. OpenMAIC manifest revision, asset revision and runtime sequence are separate provider values, never aliases for RepositoryRevision or Membership authorizationVersion. Content generation advances only when a new generation is reserved; failure never reuses its ID. Every mapping/security-state transition invalidates previously captured mapping revisions.

## B9-S04 — Lifecycle, transfer and retention

Candidate generation states: `PENDING → ACTIVE` or `PENDING → ORPHAN`. `ACTIVE → RETIRED` or `ACTIVE → ORPHAN` on a verified integrity failure. ORPHAN and RETIRED are terminal and unreadable; repair creates a new candidate, never resurrects terminal history.

Slot access states: `ENABLED`, `SUSPENDED`, `TRANSFERRING`, `RETIRED`. New/unready slots are SUSPENDED. Reads require ENABLED + complete ACTIVE pointer + current business authorization. Suspension changes revision before any external cleanup. Explicit approved resume requires fresh authority, integrity and CAS; identity restoration alone does not resume a slot. RETIRED slots remain tombstones and cannot resume.

Terminalizing a currently pointed generation must clear or replace the slot pointer and establish the corresponding denied/enabled slot state in the same local transaction, with revision and audit. No enabled slot may point to ORPHAN/RETIRED history. Integrity failure denies the current request even if persisting quarantine fails; a successful quarantine write is not a prerequisite for rejection.

Replacement reserves a PENDING candidate, writes/validates it externally, then atomically switches the local slot and retires the prior generation with closed audit. Before switch, the old generation may remain readable only if still authorized; failure leaves it unchanged and the candidate inaccessible. Published document/scene and asset bytes are not modified in place.

Transfer first sets TRANSFERRING under current authority/CAS, denying all access and editing. Validate the new same-tenant owner/assignment; recreate the exact approved content and asset bindings using supported public operations and a new server principal. Fresh authorization then switches owner/pointer atomically. Failure remains denied pending reconciliation, not an automatic rollback to stale ownership. No upstream private SQL owner rewrite.

Business retirement immediately denies access without deleting remote bytes. Retention/legal-hold/reference policy and offline collector approval are deployment prerequisites; until approved, retain tombstones/history and disable physical deletion. No user request, orphan compensation or bulk job deletes shared assets. Collection must prove no live/pending/history retention reference, select exact registered handles and recheck before supported deletion; unsupported or ambiguous deletion stays quarantined.

## B9-S05 — Idempotency and cross-system failure handling

No distributed ACID is claimed. OpenMAIC owns its public store transaction; Zhiban owns mapping, operation ledger and audit transactions. Never pass a Zhiban client as the package's fresh-transaction hook or nest provider work into an assumed shared transaction.

Protocol:

1. Authenticate/authorize and validate bounded input before expensive work. Under current security/resource guard, CAS reserve a PENDING generation and unique operation intent; commit the reservation before external work. Raw payloads/secrets are not ledger/audit diagnostics.
2. Reacquire current authority and lock the exact slot/operation before dispatch. Hold the compatible guard for the bounded external operation, preventing a concurrent authority mutation from committing ahead of its authorization linearization point. The external call uses its own pinned connection/transaction.
3. Validate returned IDs, envelope, content/asset relationships, versions and bytes against the reserved intent. Freshly recheck time, authority and revisions after lock waits and immediately before local publication. Commit mapping pointer + terminal history + ledger result + audit together.
4. Failure rolls back local publication. Known external effects remain non-visible candidates; unknown commit outcome is `OUTCOME_UNKNOWN`, quarantines the affected candidate/runtime binding and triggers bounded reconciliation. Never report success from an uncommitted local result.

Ledger states: RESERVED → SUCCEEDED / FAILED / OUTCOME_UNKNOWN; OUTCOME_UNKNOWN resolves to a verified recorded outcome or FAILED, never by guessing. The idempotency unique key is `(tenant, actor-or-service-purpose, resource, operation, keyDigest)`; same key/different normalized intent is rejected. A repeated completed command still requires current authorization before returning a sanitized result; revocation is not bypassed by replay. An in-progress command returns a closed pending/conflict result, without a second dispatch.

For a mutation of an already-active Runtime binding, reservation must also **commit a durable exclusive write fence before external dispatch**, bound to that binding revision and operation ID. All normal reads/writes reject while the fence is outstanding; only the exact guarded dispatcher and restricted reconciliation may inspect the recorded operation. Reservation uniqueness and the fence are local atomic facts, not an in-memory lock or a flag written after failure. Local success clears the fence atomically with ledger/audit/revision; an expired lease, worker crash or unresolved RESERVED operation never clears it automatically. A crash after external commit but before local completion therefore remains fail-closed even before anyone can persist OUTCOME_UNKNOWN. Freshly authorized reconciliation may clear it only after proving the exact prior outcome and consistent binding; otherwise quarantine stays denied. The exact supplement must specify these constraints and crash tests.

There is **no automatic command retry**. Reservation/lock/authentication/storage failure denies. Asset put may allocate a new ID and leave bytes before metadata commit; timeout without an attributable ID cannot be safely replayed as the same creation. Reconciliation checks only recorded handles and intent using public APIs, never global scanning/claiming by owner guess. Orphans can be retained; cleanup is not success compensation.

Runtime external append can commit before local ledger/audit fails. Quarantine that runtime binding; do not surface its uncertain record as accepted business evidence. Reconciliation needs exact record ID, expected prior tail and payload binding; if a public contract cannot uniquely prove the outcome, retain OUTCOME_UNKNOWN and deny further use rather than append again. Learning completion/grades remain Zhiban-owned decisions outside this unit.

## B9-S06 — Current authorization locks, schema, ACL and isolation

Bridge security composition must validate an authentic server-issued request handle and current Session (revocation/expiry/epoch), User ACTIVE, Tenant ACTIVE, Membership ACTIVE, effective grant, business relationship/state and mapping revision. It returns only a closed internal decision and revision facts, not token/digest/verifier material. Admission or an old receipt is not a substitute for transactional revalidation.

For side effects, use **one Zhiban PG client/transaction/TenantContext** for security projection, compatible locks, fresh facts, CAS and local audit. Locks must conflict with actual User disable, Credential change, Session revoke/revokeAll, Tenant disable and Membership/grant/resource mutation paths. User rows, the existing per-user Session advisory anchor, credential slots, Session rows, Tenant/Membership parent rows and business/mapping anchors are relevant; a new unrelated Bridge mutex does not coordinate existing writers. Grant expiry and Session expiry require fresh clock checks because locks do not stop time.

Do not concatenate existing private lock functions in a guessed order. The exact supplement must define one lock order consistent with actual 1B-7/8 paths, no lock upgrades, bounded waits and narrowly projected security helpers; genuine deadlock/serialization/stale results fail closed with no retry. Approval requires independent-connection tests demonstrating revocation/disable races, not merely a pre-commit callback. The already-private authentication registry needs an explicit minimal composition collaborator; do not export its registry or trust a forged object.

Proposed privilege boundary:

| Boundary | Minimum contract |
| --- | --- |
| Zhiban mapping database | Tenant mappings/ledger/audit use ENABLE + FORCE tenant RLS, transaction-local TenantContext, same-tenant constraints and no owner/runtime bypass. Proposed dedicated `zhiban_bridge_runtime` gets only specified mapping DML and exact security-projection/lock EXECUTE. |
| Existing Identity roles/tables | No broader grants to tenant/auth/control runtimes; Bridge has no direct password verifier/token_digest SELECT. Any new SECURITY DEFINER projection/lock exception requires exact caller/GUC/purpose/ownership checks, fixed search_path, closed projection, explicit REVOKE and separately approved ACL. No global reader/helper. |
| Private OpenMAIC storage | Separate proposed `zhiban_openmaic_runtime`, only public-store-required table/sequence operations; no owner, DDL, SUPERUSER, BYPASSRLS, CREATEROLE or grant capability. Not a browser/tenant/control runtime credential. Exact published provisioning schema/ACL reviewed before BUILD. |
| Private bytes | Gateway service only; private origin/path namespace, no public bucket/static mount/signed redirect. Offline collector has separately scoped credentials, disabled until retention/provisioning approval. |
| Owner/migrator | Explicit provisioning/migration runner only; no startup DDL, ORM auto-sync or runtime migration privilege. PUBLIC has no table/column/function capability. |

Dedicated role names/schema are **proposals**, not existing assets or permission to change the role model. Preserve migrations 0001–0011. Before persistence BUILD, produce and approve the exact new migration/helper/RLS/GRANT inventory and provisioning/byte topology. If existing frozen contracts must change, STOP for explicit contract review; do not silently widen old ports or roles. The diagnostic disposable topology is not this production topology.

## B9-S07 — Gateway, launch, preview and bounded delivery

Browser requests name only Zhiban resources; server resolves current mappings. Unknown, inaccessible, pending, orphan, mismatched or malformed resources share a closed public denial; internal reasons never include SQLSTATE, native errors, owner handles, object paths or another tenant's existence. URL/body/header/exception/audit redaction tests cover provider errors and custom properties.

A launch is a restricted, session-bound server context, **not an OpenMAIC bearer credential or direct native URL**. If a reference is required, use a 256-bit opaque server-issued reference, digest-only registry, maximum five-minute expiry bounded by Session expiry, exact actor/session/resource/generation/operation and captured epoch/authVersion/revisions. Every use revalidates current facts; it cannot authorize an entire Tenant or outlive revoke/disable/rotation. No token in URL or localStorage. Learning launch remains CLOSED until its real resource contract exists; no JWT or anonymous fallback.

Delivery contract:

- Resolve only mapped assets referenced by the exact authorized generation/scene/purpose. Reconstruct slide output rather than spread unknown fields. Initial positive subset remains diagnostic plain text and PNG/WAV/WebM media; text forbids markup metacharacters, fields/geometry are bounded, maximum 32 elements per slide. Synthetic WebM routing proof is not decoder/playback certification. Additional MIME/content needs explicit validation/acceptance.
- No arbitrary HTTP/data/blob URLs, remote fonts, rich HTML, SVG/XML, scripts, iframe, tools or native streaming endpoints. Use browser CSP/origin and existing cookie/CSRF contracts; all mutating adapters enforce CSRF/origin rather than relying on SameSite alone. Client-submitted URLs never trigger unrestricted server fetch.
- All success/denial/HEAD/range/conditional responses are private `no-store`; shared/CDN caching and public signed redirects are off. If ETag/304 is introduced, authorize before evaluating the condition; never expose a globally reusable cache key. Set exact safe MIME, nosniff and appropriate resource/CSP headers.
- Single bounded byte range only; validate full/suffix ranges and length against registered bytes. HEAD and each new range request reauthorize independently. Do not fetch an arbitrary object first and filter tenant afterward.
- Initial ceilings: 4 MiB input/output/asset, 32 MiB aggregate assets per candidate, 10-second operation deadline, two expensive operations per process with no queued admission. Enforce before allocation/parse/write where possible; input length, record count and projected output caps are checked independently. These are proposed ceilings, not performance claims; raising them requires reviewed policy/proof.
- Active delivery checks current Session/authority/mapping before each bounded chunk (at most 64 KiB) and stops on revoke, expiry, mismatch, timeout or storage failure. Check-and-send races have a bounded already-authorized in-flight chunk; never claim retroactive removal of bytes already delivered or instantaneous cancellation. No unbounded long stream/SSE; positive stream/provider cancellation remains unaccepted.

Any internal cache is keyed by tenant, resource, generation, actor purpose and validated revision; it caches content, not authority. Background jobs use exact restricted ServiceActor intents, not fake SYSTEM_ADMIN or stale Session permission snapshots.

## B9-S08 — Runtime integrity, retry boundary and executable verification

Runtime uses Zhiban bindings, not indexed results, to choose exact IDs. On every allowed read/write, validate returned session ID, stage/generation, learner key, kind, lifecycle, version and timestamps against the trusted binding. For records also validate exact session ID, permitted scene anchors, unique IDs, sequence order/tail and closed payload schema. Wrong/future/missing/corrupt fields fail closed without repair or fallback. Runtime versions/sequences are not authorizationVersion.

Do not use `listSessions(stageId, learnerKey)` to establish ownership or return unvalidated partial lists; enumerate only authorized Zhiban runtime bindings and load exact IDs. Do not use scalar scene filters as authorization. `listRecords` is usable only with a trusted exclusive-writer binding and a proved bounded collection; its current public API has no pagination/limit. If the bound cannot be proved, disable that operation pending a supported upstream interface, rather than download an unbounded collection then filter.

The public getSession JSON check does not certify duplicated scalar `learner_key`/`stage_id` consistency. Where correctness, partitioning, transition or cleanup depends on those scalar fields, the affected operation is **BLOCKED_PENDING_SUPPORTED_INTEGRITY_PROOF** until public/upstream support and positive tests establish it. No native table SELECT/UPDATE guard, private-schema SQL patch, scalar-only automatic repair or silent acceptance. Validating JSON alone is not closure of that gap.

Every append/status transition supplies `expectedLastSeq` (null means explicitly empty); no omitted-tail last-writer-wins. Parent/binding checks and fresh authority surround the bounded public transaction. The Bridge-provided `withTransaction` must rollback/release first, then translate retryable PG errors into a sanitized closed Bridge failure **without retryable `code` or raw cause**, preventing the inspected provider's internal retry loop from dispatching another attempt. Unit and real provider tests must demonstrate exactly one attempt for 23505/40001/40P01 and no leakage; merely catching after append returns is too late. If this cannot hold on the pinned public contract, close append and request upstream support, never patch core.

No mergeLearner, deleteAll/learner/stage sweep, implicit record grading, client-authoritative completion, unrestricted agent or AI provider call is admitted. 1B-9C AI foundation uses fake providers and constrained purpose/budgets; concrete AI/generation use cases await their own designs/diagnostics.

### Execution and acceptance matrix

| Unit | Work / required evidence | Gate |
| --- | --- | --- |
| 1B-9A approval | Review B9-S01–S08, explicitly record acceptance/revisions in this document; exact-scope documentation checkpoint may be bundled with independent remote HEAD/message/parent verification | No BUILD by inference |
| 1B-9B pre-BUILD supplement | Exact mapping subset, migration inventory, role/table/column/function ACL, FORCE RLS, authentic-handle seam and lock order, private published-store/byte provisioning and resource-gating manifest | Independent approval; no fake business resource schema |
| 1B-9B BUILD | Closed document/asset gateway and mapping/ledger/audit contracts, immutable candidates, compensation, fail-closed disabled resource loaders | Unit/provider contracts + real PG16 races/ACL + browser media boundary |
| 1B-9C BUILD | Exact Runtime adapter/binding contracts, expected-tail and no-retry proof; unresolved scalar-dependent operations remain disabled | Real Attempt absent means contract-only; no actual learning launch |
| Business opening / 1B-10 | Real approved Course/Activity/Enrollment/Attempt relationships and catalog; native route/byte/network bypass closure, deployed-role verification, actual HTTP Session/CSRF wiring, current-revoke behavior | Positive integrated proof for each enabled capability; production OPS/cutover separately approved |

Tests must cover forged handles/client relationship facts, cross-tenant and same-tenant horizontal access, grant/scope stitching, stale authVersion/CAS, wrong/missing external bindings, pending/orphan/terminal denial, old/new generation atomic switch, transfer isolation, exact MIME/URL sinks, HEAD/range/cache requests and bounded stream revocation. Include ledger replay/conflicting intent, external timeout/unknown commit, local audit failure after external success, retention/shared-asset non-deletion, malformed rows and max revision.

Real PG16 tests use independent connections with acknowledged locks/barriers: credential/session/User/grant/resource change versus external mutation/publication; duplicate create; concurrent publication/transfer; crash/reconciliation; RLS/ACL/helper projection; lease/expiry after waits; connection cleanup. No sleep-only or mock callback proves coordination. Verify Linux Node22, fixed fresh artifacts and public APIs; reuse signed-off diagnostic evidence only for its unchanged exact scope. New producer/HTTP/DB proof is not supplied by that reuse.

Use targeted tests during iteration. A changed security/schema composition requires affected Identity regression and the existing real PG16 workflow gates; do not mechanically rerun all historic diagnostics each edit, nor silently drop required signoff. Existing workflows are extended only under separate BUILD authorization, not modified here. Carry forward the historical root full-project lint/typecheck verification note into the integration candidate; isolated diagnostic tsc is not root tooling proof.

## Approval record

The review checked current ADR-012 and execution gates, the actual Identity-only catalog boundary, pinned Runtime retry/error behavior and applied migration inventory. No new diagnostic execution or full regression was needed for this documentation review. B9-S04 pointer consistency and B9-S05 durable pre-dispatch Runtime fencing were clarified within their existing atomicity/fail-closed scope before acceptance; no frozen Identity contract or upstream implementation changed.

| Contract | Review / decision |
| --- | --- |
| B9-S01 | APPROVED — fixed public D02–D05 subset; production isolation and additional capabilities are not certified. |
| B9-S02 | APPROVED — trusted real resource facts and explicit business policy required; no Identity permission substitution or fake resources. |
| B9-S03 | APPROVED — Zhiban-owned mappings, opaque references, permanent CAS anchors and separate provider revisions. |
| B9-S04 | APPROVED — immutable generations, terminal history, atomic pointer/state changes and retained tombstones. |
| B9-S05 | APPROVED — local intent/idempotency/audit, durable Runtime write fence, unknown-outcome quarantine; no distributed ACID or automatic replay. |
| B9-S06 | APPROVED — compatible current-authority locks and minimum-privilege boundary; exact schema/ACL/helper/lock-order supplement remains a separate approval gate. |
| B9-S07 | APPROVED — closed projection/media gateway, bounded delivery and launch, fresh authorization; no native bearer URL or claim of instantaneous byte withdrawal. |
| B9-S08 | APPROVED — exact runtime bindings/tails, no unsafe provider retry, unsupported integrity-dependent operations remain closed. |

No unresolved design P0/P1 was identified after these clarifications. D01 production proof, real business loaders, exact persistence/ACL approval, scalar-dependent integrity proof and root tooling verification remain implementation/integration gates, not completed evidence or waived requirements. U01/U02 decisions remain unchanged. Approval permits the separately authorized document checkpoint, not automatic BUILD.

## State and next action

PHASE_1B9A: DESIGN_COMPLETE

DESIGN_APPROVAL: APPROVED_B9_S01_S08

DESIGN_BOUNDARY: FROZEN

REVIEW_VERDICT: PASS_WITH_EXPLICIT_DOWNSTREAM_GATES

ACCEPTED_CAPABILITY_REFERENCE: ADR_012_D02_D03_D04_D05

PRODUCTION_D01_ISOLATION: NOT_VERIFIED

SCALAR_JSON_INTEGRITY: NOT_VERIFIED_AFFECTED_OPERATIONS_BLOCKED

BUSINESS_RESOURCE_OPENING: CLOSED_UNTIL_REAL_CONTRACTS

EXACT_SCHEMA_ACL_SUPPLEMENT: REQUIRED_BEFORE_PERSISTENCE_BUILD

U01_U02: REQUIRED_LATER_NOT_R1_HARD_REQUIREMENTS

FROZEN_IDENTITY_CONTRACT_CHANGES: NONE

MIGRATIONS_0001_0011: UNCHANGED

BUILD_AUTHORIZED: NO

PRODUCTION_DEPLOYMENT_AUTHORIZED: NO

COMMIT: NO

PUSH: NO

NEXT: Separately authorize the single-document exact-scope checkpoint plus independent remote HEAD/message/parent verification (**GPT-6 Sol / Low**); then separately authorize the 1B-9B exact schema/ACL/security-composition supplement (**GPT-6.1 Sol / High**). No model switch or subsequent task is automatic.
