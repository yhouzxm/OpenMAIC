# Phase 1B-9C — Runtime / AI Integration Foundation Design

STATUS: DESIGN_COMPLETE / APPROVED_C9_S01_S08 / FROZEN_FOR_CONTRACT_FOUNDATION

Date: 2026-10-05. Branch: `refactor/zhiban-v2`. Design base HEAD: `7ac11cde7835586b44831d2b3270da277528efe6`. Preflight worktree: CLEAN. This round adds only this document; no implementation, migration, workflow, dependency, database operation, paid AI call, commit, push or CI dispatch is authorized.

Authority: [execution plan, 1B-9C](../zhiban-v2-execution-plan.md), [gate map](phase1b-gate-map.md), [public surface](zhiban-openmaic-public-surface.md), approved [B9-S01–S08](phase1b-9a-bridge-design.md), [B9-P01–P08](phase1b-9b-schema-acl-design.md), [1B-9B freeze](phase1b-9b-review.md) and [ADR-012](../adr/ADR-012-openmaic-identity-bridge.md). Identity, Credential, authentication Session and Authorization remain frozen. An OpenMAIC **RuntimeSession is learning persistence**, not an authentication Session or authorization proof.

## Repository audit and bounded deliverable

The current production [Bridge port](../../../lib/zhiban/application/openmaic/bridge.ts) and [composition](../../../lib/zhiban/infrastructure/openmaic/root.ts) reject business actions through unavailable resource facts and the database's FALSE business gate. There is no real Activity/Course/Enrollment/Attempt model, Runtime binding repository, `ActivityRuntimePort` or `AIServicePort`. Existing mapping operations/audit are closed Document/Asset vocabularies, not generic Runtime or AI ledgers.

The pinned public source is official OpenMAIC v1.1.2 SHA `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce`: storage package `0.31.1`, DSL package `0.11.2`, generation package `0.3.13`. Package versions are not serialized protocol versions. Current `DSL_VERSION` is `0.3.0`; **`RUNTIME_DSL_VERSION` is `0.1.0`**, on the distinct required `runtimeDslVersion` field. No package-tree change or moving upstream reference is proposed.

| Actual public contract | Consequence for this design |
| --- | --- |
| `PgRuntimeStore.createSession` stamps the Runtime version and inserts without upsert; `getSession` validates/migrates the JSON envelope | Allocate IDs server-side; compare the exact returned envelope to the binding. Missing/future/wrong-line stamps reject. Never infer ownership from a successful lookup. |
| `listSessions` queries indexed Stage/learner columns and omits corrupt rows | Not an ownership lookup or accepted foundation operation. Enumerate authorized Zhiban bindings instead. |
| `appendRecord` locks the parent, assigns `MAX(seq)+1`, optionally checks a tail, and retries 23505/40001/40P01 up to **five attempts** | Always supply a tail; suppress retry inside the transaction hook, before errors reach the provider loop. Provider sequence is not a Zhiban revision. |
| `setSessionStatus` accepts a tail but does not impose the Zhiban terminal-state policy; mutation may persist a migrated envelope and duplicated scalars | Require a closed host lifecycle; no revival/read-repair. Scalar-dependent mutations remain blocked as described below. |
| `listRecords` reads all matching JSON rows; no public pagination/limit or exact record-ID getter | A post-fetch limit is not a memory bound. Broad reads and uncertain-append reconciliation cannot be assumed safe. |
| Getter JSON does not expose/compare duplicated scalar Stage/learner columns; records also have SQL ordering/parent/scene columns | JSON validation is necessary, not a proof of scalar consistency. Preserve ADR-012's unsupported-integrity gate. |
| Public generation exports accept `AICallFn(systemPrompt,userPrompt,images?)`; retry helpers and logger are also exported | Never expose this generic callback/configuration to Application callers. Generation export availability is not D09 acceptance or a paid-provider signoff. |

1B-9C can deliver a **closed, contract-only foundation**: narrow ports, validation/state/retry/admission boundaries, fake AI contracts and public-provider tests in disposable databases. It cannot fabricate production Attempts to populate bindings, open learner launch, claim learning completion, or make D08/D09/U01/U02 accepted. C9-S01–S08 are approved below for this bounded design; the exact supplement and separate BUILD authorization remain prerequisites.

## C9-S01 — Ownership, authority and composition

- Runtime ownership is one real tenant-scoped Attempt and its learner Membership/User, with an immutable content generation. Only a trusted server use case resolves these relationships; client `learnerKey`, owner, native session ID, role or `relationship=true` is never accepted as proof. No new Scope or permission is invented in 1B-9C.
- Each admitted request needs an authentic request handle, TenantContext, actor Membership, expected current authorizationVersion, expected binding RepositoryRevision and server-resolved target. TenantContext scopes persistence; the current User/Tenant/Membership/grant/permission/scope/resource-state chain authorizes it. Authentication Session supplies only User identity.
- Learner access is to its exact Attempt. Teacher/support access is **DENIED in this foundation** until a concrete permission, resource relationship and purpose are approved; being a teacher/TENANT_ADMIN/SYSTEM_ADMIN is not sufficient. Reconciliation needs a separately authorized exact service/interactive intent, not an admin search endpoint.
- Production uses unavailable business facts, the existing FALSE gate and non-injectable closed composition. No enabled flag, caller callback, environment/GUC or fake resource loader can open it. Positive synthetic bindings exist only in disposable test compositions.
- Future Application ports are `ActivityRuntimePort` and `AIServicePort`, under `application/openmaic`; Infrastructure adapters remain under `infrastructure/openmaic`. No provider object, native store, SQL client, native principal/ref or raw provider error crosses their ordinary exports. Domain imports neither OpenMAIC types nor PG/HTTP/AI SDKs.

## C9-S02 — Exact binding and closed Runtime data

Retain B9-P03's planned binding dimensions: tenant, permanent binding ID, slot, pinned generation, real Attempt, learner Membership, opaque native Runtime ref, opaque learner handle, kind/status, RepositoryRevision, outstanding operation, expected tail and timestamps. Binding IDs use the existing UUIDv7 structural contract and server allocation; native Runtime/record refs and learner handles use independently generated 32-byte CSPRNG values encoded as canonical 43-character base64url strings, not User/Membership IDs or credentials. The handle is an internal partition key, not a browser bearer credential.

Actual Attempt and tenant-composite learner/generation FKs are mandatory before production persistence. No dummy Attempt table, nullable ownership shortcut, arbitrary string relationship or production binding row is introduced while that model is absent. Generation is pinned: publication/transfer cannot silently retarget an existing Runtime. Suspended/retired/transferring mappings and missing/unavailable/terminal business facts reject; historical replay eligibility needs a later explicit policy, not fallback to the latest Stage.

Foundation contracts use only native kind **`chat`**, not quiz/PBL/playback/grade semantics. The closed record payload is `{role: 'user' | 'assistant', content: string}` with no additional keys, non-empty well-formed Unicode text <=8192 UTF-8 bytes, no lone surrogate, NUL, binary, HTML rendering, tool call, executable object, URL fetch or `system` role. Text is untrusted data and must be escaped by any later UI. Role is server-selected: learner commands create only `user`; a separately admitted server producer alone creates `assistant`. An AI result does not automatically become such a record.

Scene anchor is optional but, when present, must resolve to an exact scene binding within the pinned generation. `actionIndex`/`subAnchor` are not admitted yet. Record ID, parent, timestamp and sequence are host/provider-owned; callers cannot supply a sequence or completion/score. UTC canonical server timestamps must be valid, monotonic at the applicable boundary, and distinct from document epoch-millisecond timestamps. Validate returned ID/parent, unique record IDs, contiguous sequences starting at zero, exact tail, anchors and the closed payload before projection. Native skeleton validators alone are too broad; inject explicit validators and reject unknown kinds before calling the store.

The ordinary result exposes only Zhiban binding/record identifiers, safe text/status, current binding revision and a validated tail. It does not expose learner handle, StageRef, native session ID, provider SQL fields or raw history/errors. Runtime facts are **not** trusted Learning evidence or grades; issuance/adoption belongs to 3B/3C.

## C9-S03 — Public adapter, integrity and read budgets

Use only pinned public `@openmaic/storage/runtime` contracts, `@openmaic/storage/runtime/pg` exports and public DSL validation. The method allowlist is exact create/get/append/terminal-status and conditionally bounded record reads; no mergeLearner, deleteSession/deleteAllRuntime, global listing, collector or raw-query Application capability. Reads never infer authority from scalar filters, repair corrupt rows, silently skip malformed records or expose partial success.

Host lifecycle permits native `active → completed → archived` and `active → archived`, never a return to active. Same-state requests may be true no-op only after current authority, expected revision and expected tail checks; each persisted binding transition advances its revision exactly once, no-op leaves it unchanged, max signed-int8 fails closed. A dispatched logical command has separate reservation and settlement transitions as specified in C9-S04, not one revision increment for the entire command. Provider status validation is not this lifecycle guard.

| Operation | Foundation boundary / prerequisites |
| --- | --- |
| Exact getSession | Contract test may validate the JSON envelope against one trusted synthetic binding. It certifies that envelope only, not scalar-column integrity; production remains denied without real business authority. |
| Create | Public non-upsert insert, exact returned envelope, durable creation intent and safe unknown-outcome treatment are required; no real production creation before real Attempt/schema/ACL approval. |
| Append / terminal-status mutation | Tail/retry/lifecycle contracts can be tested with the real public provider in disposable PG16. **Production paths whose safety depends on scalar/JSON consistency remain BLOCKED_PENDING_SUPPORTED_INTEGRITY_PROOF.** Persisting the JSON back into scalars is not an acceptable repair. |
| Record collection / append reconciliation | Closed until the bounded exclusive-writer and integrity conditions below are proved; no unbounded read to discover the tail or locate a committed record. |
| listSessions / merge / delete / broad admin | Not exposed or enabled by this unit. |

Hard limits: <=128 records per binding, <=8192 payload-text bytes per record, <=2 MiB validated serialized records per binding, <=10 seconds per bounded persistence operation, at most two concurrent admitted foundation persistence operations and no waiting queue. Empty tail is explicit `null`; sequence values must be safe non-negative integers <=127, never used as authorizationVersion or RepositoryRevision. DB revision arithmetic remains canonical signed-int8 decimal/BigInt only.

`listRecords` is usable only if a dedicated restricted deployment, supported public integrity guarantees and a durable exact writer ledger prove that **all** writers obey these collection limits. A counter is not proof if another native writer or import can bypass it. Owner maintenance invalidates the admission receipt until reverified. If these prerequisites cannot be established, keep record reads closed and request a supported bounded/integrity-aware upstream API. No private native SELECT guard, SQL-text rewriting, local package patch or full-array fetch followed by slicing is allowed. Supported integrity work requires separate approval; it is not silently assigned to this BUILD.

## C9-S04 — Durable write fence, CAS and uncertain outcomes

Every create/append/status mutation uses a closed operation-specific intent and an exclusive binding fence, not the existing Document operation union as arbitrary JSON. Exact tables/columns/events and idempotency key shape require the pre-BUILD supplement in C9-S05. Retain this protocol:

1. In a local transaction, acquire current authority/business locks, lock the permanent binding, reject stale revision **before** no-op/replay, validate lifecycle/expected tail/budgets, and reserve the exact operation. Commit ledger + audit + outstanding-operation fence + binding revision `+1` before any native dispatch. Before reservation, prove headroom for both reservation and settlement: existing binding revision must be <= signed-int8 maximum minus two. Required operation-ledger transition headroom is also checked before dispatch; its exact increments belong in the supplement. Reject rather than reserve a command that cannot settle. Creation reserves an unavailable binding; no read may treat it as active.
2. In a separate checked local transaction, atomically mark dispatch started only from the exact reserved, not-yet-dispatched operation and commit that mark. Revalidate the committed reserved revision/current state in the dispatch transaction and retain the approved authority locks through the bounded native call. The durable mark/CAS arbitrates across processes; an in-memory capability alone is insufficient. Normal reads/writes deny while any reservation/unknown outcome owns the fence. Only that dispatcher or an authorized exact reconciliation may inspect it.
3. Native writes use an independent fresh client/transaction. Append/status always supply explicit expectedLastSeq; create has no tail option and establishes a new empty session. `createSession` uses the constructor Queryable directly, **not** `withTransaction`: the host must call it with a Queryable pinned to its own fresh native transaction, validating the result and current authority before COMMIT. Append/status use the provider's transaction hook, without nesting it inside a shared/native outer transaction or using a Zhiban client. Public envelope/result checks and fresh final authority/deadline checks must finish before native COMMIT; a callback after COMMIT is too late. Do not claim two-database ACID. Lock-coupled dispatch is for bounded storage, **never for an LLM/network generation job**.
4. After native success, local completion freshly rechecks the exact locked authority/business/binding set and atomically records the proved result/tail/status, completes ledger/audit and clears the fence, advancing local revision once more. Reservation and completion are two distinct persisted mutations, each `+1`; the original expected revision must not be reused after reservation. Recheck overflow before either transition. If authority has changed between native commit and local completion, do not publish success or clear the fence; retain the inaccessible unresolved outcome for authorized reconciliation.
5. Known native rollback can be completed as a failed local operation with closed reason and exact prior tail/state. Timeout, disconnect, uncertain COMMIT or local completion/audit failure after native success leaves or establishes an unresolved fence. A lost local connection must not accidentally clear the already committed reservation.

Same key + same intent never dispatches twice; replay needs fresh authority, current revision and a closed stored outcome. Conflicting intent rejects. Crash, lease expiry, cancellation and process restart do not clear a dispatched fence or replay a write. Recovery is an explicitly authorized **read-only inspection of exact recorded native references**, followed by a guarded local settlement only when the outcome is proved. No record-ID getter and an unbounded list cannot prove append outcome safely; when no supported bounded proof exists, append reconciliation remains closed and the binding quarantined. Rotation/recreation of Runtime is not a fallback for uncertainty. Physical deletion and automatic compensation are out of scope.

Suppress the public append loop **inside** `withTransaction`: on failure rollback/dispose/release, then throw a new closed Infrastructure error with neither retryable `.code` nor raw `.cause`/message/custom fields. Passing the driver error to the provider and sanitizing only after `appendRecord` rejects is too late. Queryable create/get failures must also be sanitized; an uncertain commit never becomes a known rollback. Prove one invocation/one attempted native transaction for each 23505/40001/40P01 using the actual public provider, plus released clients/permits and no secret/error-material exposure. No automatic retry of an old authorization decision.

## C9-S05 — Security composition, schema and ACL gate

Reuse the existing authentic-handle security seam and B9-P05 lock order, not an injected boolean: Tenant FOR SHARE → complete sorted participant Users FOR SHARE → actor's shared session-user barrier → Credential slot FOR SHARE → authentication Session FOR SHARE → sorted Membership/current effective grant locks → future business parents → mapping slot/generation → Runtime binding/operation. Discover immutable participants before acquiring the full lock set; no new participant or lock upgrade at final checks. Fresh time after waits must recheck expiry, authorizationVersion, User/Tenant/Membership/grant and Credential securityEpoch. Missing/disabled/revoked/stale facts and storage errors reject.

The complete future business lock/relationship set, including Attempt/Enrollment state and learner versus actor, is a design prerequisite to opening production. Every required learner/related User and Membership must satisfy the real business policy's current active/eligibility rules; related-member rows in the current helper are facts, not an automatic ALLOW. Do not assume the current helper's <=2 related-member bound covers an arbitrary class/group. If more participants are necessary, report the exact seam change for review. Credential mutation, logout, User disable/restore, grant/Enrollment/Attempt revocation and mapping generation changes must serialize against dispatch; no in-process mutex or permission cache substitutes for that coordination.

Applied migrations **0001–0013 remain byte-for-byte unchanged**. No migration is created in this design. Next available Identity migration is currently **0014**, subject to an inventory check at separately authorized BUILD; that number is not permission to invent an Attempt model. A precise schema/ACL/security-composition supplement is required before any Runtime persistence or native provisioning BUILD. With real Attempt absent, the supplement must distinguish test-only contracts from uncreated production tables; production binding persistence remains deferred.

The supplement must enumerate binding/operation/audit closed fields and FKs, terminal/history/deferred consistency guards, unique exclusive fence, CAS/counter ceilings and database gate, exact RLS policies/table-column-function grants, native public schema provisioner/receipt/fingerprint and same-transaction helper checks. Zhiban tenant tables require FORCE RLS and exact tenant composite references. Global deployment metadata does not acquire tenant ownership. Do not extend `IdentityAuditEvent` for Runtime/AI; local Bridge events need their own approved closed shapes.

No broad grants: auth/tenant/control/PUBLIC runtimes receive no Runtime mapping/native access, session digest or Credential verifier. Retain separate private native owner/migrator/runtime roles and topology; runtime is not owner, has no DDL/role membership/BYPASSRLS/superuser or delete/sweep capability. Public `ensureSchema` is a separately approved one-time **migrator** provisioning step, never startup DDL. Native create needs exact INSERT; reads exact SELECT; set-status public implementation updates all persisted session columns, so an apparent status-only column grant is incompatible. Resolve that exact grant requirement in the supplement, without exposing the store or weakening the integrity gate. Existing Document/Asset ACL/fingerprint assumptions cannot be silently invalidated by adding Runtime objects.

## C9-S06 — Constrained AI Port, fake provider and cancellation

`AIServicePort` is a server-side purpose-specific foundation, not a public `AICallFn`, model router, tool executor or arbitrary prompt API. This contract admits one purpose **`AUTHORING_DRAFT_TEXT`**, tested only with a deterministic **FAKE** provider. Production requests remain denied until real resource authorization, D09 diagnostic/acceptance and a concrete 2D use-case are approved. 7D tutor/retrieval/assistants require their own design. No keys, paid network calls, URL/image fetch, native agents, tools, filesystem, retrieval, generated HTML or automatic saving/publication are added.

Closed input: canonical request ID, approved purpose and non-empty plain-text brief <=8192 UTF-8 bytes, with authentic authority composed outside the pure provider contract. Input, assembled prompt and output must be well-formed Unicode with no lone surrogate or NUL; byte counting must not silently replace invalid text. Server selects a fixed versioned prompt/template and provider alias; callers cannot provide a system prompt, endpoint, credential, temperature, tool set or model options. Reject unknown/additional fields. Untrusted brief/output cannot modify the system instruction, permissions or budget; fake contract tests do not claim real-model prompt-injection resistance.

Closed output: `DRAFT` with bounded plain text <=16384 UTF-8 bytes and safe provenance `{provider: 'FAKE', purpose, inputSchemaVersion, outputSchemaVersion, promptRevision, policyRevision}`; otherwise one closed failure. Neither an OpenMAIC `GenerationResult.error` nor its raw response is returned as a diagnostic. No content persistence/audit or Runtime append follows from generating the draft. Schema validation, human review and later authorized draft-save remain prerequisites.

Per-invocation budget: <=32768 UTF-8 bytes of assembled prompts, <=16384 output bytes, one provider invocation, <=10 seconds, process concurrency <=2 with no queue. Attempt counts consume budget before dispatch, including failed/cancelled calls. Byte bounds are **not token accounting**; approved real-provider tokenizer/usage limits, durable per-actor/cost budgets and idempotent jobs are required before paid use. Do not call the public generation retry helper, allow retries outside the metered wrapper or treat silent fallback content as a success. Concrete scene-generation can make several AICallFn calls and thus is not accepted by this one-call foundation contract.

Abort/deadline checks occur before dispatch and after settlement. Cancellation does not imply remote rollback or refund. The caller receives a closed cancellation/deadline failure promptly even when the provider ignores abort, but the provider keeps its permit until actual settlement; a caller-side timeout is not permit release. Keep only a bounded completion handler, consume late rejections, and discard late results without state mutation. Bounded occupied slots fail closed rather than release early and start unbounded background calls. No DB/Identity lock is held over a provider invocation. Revalidate current authority before any future result adoption. Actual streaming/SSE, distributed admission and HTTP cancellation wiring remain separate gates. Any later public generation integration uses a server-owned metered AICallFn and non-content logger, but is not built or accepted here.

## C9-S07 — Errors, audit, caches and producer boundaries

Application results are closed `DENIED`, `SUCCEEDED` (safe projection) or `FAILED` with an internal closed reason, such as STALE, INVALID_INPUT, BUDGET_EXCEEDED, CANCELLED, STORAGE_FAILURE, INTEGRITY_FAILURE or OUTCOME_UNKNOWN. Future HTTP mapping is a separate adapter task. No resource existence oracle, cross-tenant fact, SQLSTATE, native ID, payload validator path/message, original provider stack/cause, prompt, model secret or internal permission catalog is exposed.

Runtime audit is local and same-client/same-transaction with its reservation/settlement; it records approved Zhiban IDs, actor/purpose, revisions, fixed event/reason and timestamps only. No record text, raw prompt/response, content hash, learner handle, native Runtime ref, authentication token/digest or Credential verifier. AI foundation uses safe in-memory provenance, not a new persisted AI audit/event union. Error-object/custom-code/snapshot/log tests must assert the absence of sentinel secret and content values, including validation and malformed-storage paths.

Do not cache authority. Foundation introduces no Runtime/AI shared-result cache. A later content cache must be tenant/binding/generation/purpose-scoped with current authorization/revision checks and must not permit cross-learner reads or cached permission snapshots. No public route, browser-direct store, localStorage token, original native URL or native runtime/agent action is opened.

## C9-S08 — Executable verification and acceptance gates

| Test family | Required proof for separately authorized BUILD / CI |
| --- | --- |
| Unit/shared contracts | Forged client identity/Attempt/Stage/learner denied; unknown kind/payload/extra field denied; malformed Unicode/NUL denied; corrupt/wrong-version/parent/tail/anchor rejected; no stitching/foreign replay; terminal/no-op/stale/max revision and insufficient reservation/settlement headroom; budgets, closed results, production unavailable facts and exports. |
| Public Runtime provider | Fresh official artifacts; exact protocol `0.1.0` versus package `0.11.2`/document `0.3.0`; actual PgRuntimeStore create/get, create rollback when the pre-COMMIT guard fails, tail-null/number CAS, terminal host policy, one attempt for all three retryable SQLSTATEs and rollback/error/client cleanup. No hardcoded provider snapshot. |
| Real Identity PG16 | Approved local ledger/fence schema if eligible, ACL/RLS, CAS reservation, duplicated intent/no redispatch, malformed local row, crash/unknown outcome/audit failure and fence denial. If no real Attempt schema, assert no production binding tables/open gate; do not claim synthetic tests prove real Enrollment/Attempt rules. |
| Independent-connection races | Acknowledged lock/barrier, not sleep: Credential change, logout/expiry, User/Tenant/Membership/grant mutation versus storage dispatch/final check; competing append/status/fence; local completion failure after native commit; cleanup and max boundaries. Future business races stay pending until their real model exists. |
| Native PG16 | Exact public provisioner/least-role manifest, no startup DDL; missing/foreign/corrupt JSON, PUBLIC denial, no merge/delete/admin capability, transaction atomicity and one-attempt error translation. Scalar-only corruption is recorded as an unsupported-contract probe, not mislabeled PASS. |
| Fake AI security | Fixed purpose/template/provenance/schema; extra provider/tool/URL config rejected; input/output/call/deadline/concurrency limits; exception/abort/ignored-abort/late result behavior; no keys/network/DB writes; no prompt/output/error leakage or implicit publication. |
| Regression/tooling | Affected existing Identity/Credential/Session/Bridge suites and root lint/typecheck/frozen install/diff checks; package protocol metadata unchanged. Preserve prior exact evidence without attributing it to a new SHA. |

Iterate with targeted tests. At candidate signoff, add the approved Runtime tests to the **existing** Identity PG16 and Storage PostgreSQL Contract workflows' relevant two-complete-run gates, plus new unit/contracts to existing regression commands; do not create a second workflow or shrink previous suites. Workflow edits/selection modes require the exact pre-BUILD plan. Record actual suite counts and exact run SHA; current 392 Identity PG16, 54 Bridge PG16 and 11 native PG16 counts are historical baselines, not predictions for the new candidate. Full root lint/typecheck cannot be inferred from targeted modes that skip them.

Local PG16 availability is checked only during authorized implementation. If unavailable, do not install it or use PG18 as substitute; report PENDING_CHECKPOINT, never real-PG PASS. Real SQL/assertion failures do not auto-rerun. Only separately allowed infrastructure-transient handling may rerun. Closeout must distinguish contract foundation signoff from still-closed business/scalar-dependent/AI production paths.

## Review decisions and execution sequence

Review authorization: the user explicitly requested review and approval of C9-S01–S08. Review base remains `7ac11cde7835586b44831d2b3270da277528efe6`; the only pre-existing delta was this design document. Targeted checks used the frozen B9-S05/S06/S08, B9-P03/P05/P06, ADR-012, execution gates and actual public Runtime/provider contracts. No implementation review, diagnostic execution or CI rerun is attributed to this documentation review.

Resolved before approval: clarified revision increments per persisted transition versus per logical command; required reservation/settlement revision headroom before dispatch; separated create's pinned-Queryable transaction from append/status hooks and tail checks; made the durable dispatch mark cross-process and completion freshness explicit; preserved related-learner eligibility checks; tightened Unicode/NUL validation; and distinguished timely caller cancellation from eventual permit release. These are fail-closed design clarifications, not changes to frozen Identity/Credential/Session or public provider semantics.

| Proposal | Decision |
| --- | --- |
| C9-S01 — authority/composition and unavailable business gate | APPROVED — server-owned exact Attempt/learner relationships; production unavailable facts/gate remain closed. |
| C9-S02 — binding, chat-only closed data and non-evidence boundary | APPROVED — CSPRNG native handles, pinned generation, closed chat payload; no fake production Attempt or grading. |
| C9-S03 — public adapter, unsupported integrity and hard read budgets | APPROVED — bounded subset; unsupported scalar-dependent mutations/reads remain blocked, not waived. |
| C9-S04 — durable exclusive fence, revision transitions and no replay/retry | APPROVED — committed reservation/dispatch mark, sufficient headroom, guarded native transaction and local settlement; uncertain outcomes stay denied. |
| C9-S05 — exact schema/ACL/security-composition prerequisite | APPROVED — existing compatible security seam; separate precise supplement, no old migration/role-model modification or fabricated business schema. |
| C9-S06 — fake-only AI purpose, budgets, provenance and cancellation | APPROVED — fixed fake draft purpose and schema; bounded caller/provider lifecycle, no paid/provider/generation opening. |
| C9-S07 — secret-free errors/audit and producer/cache boundary | APPROVED — closed internal decisions, no sensitive diagnostics or permission/result cache. |
| C9-S08 — provider/race/regression/CI evidence | APPROVED — actual provider and independent-connection proof required, historical evidence attributed to its exact candidate. |

Review verdict: **PASS_WITH_EXPLICIT_DOWNSTREAM_GATES**. No unresolved P0/P1/P2 remains inside the approved design scope. Real Attempt/Enrollment contracts, supported scalar integrity/bounded-read evidence, precise persistence/ACL approval, actual provider/race tests, D09 acceptance and production D01 isolation are downstream prerequisites, not completed implementation evidence. Approval freezes the contract foundation design only and does not authorize persistence BUILD or opening any blocked path.

Next: separately authorize this single-document checkpoint and independent remote HEAD/message/parent verification (**GPT-6 Sol / Low**). Then separately authorize the exact Runtime schema/ACL/security-composition/workflow supplement (**GPT-6.1 Sol / High**), including which production tables remain uncreated and which public methods stay blocked; only its approval/checkpoint and a separate BUILD authorization permit contract foundation implementation (**GPT-6.1 Sol / High**). No step is authorized merely by being listed here.

Actual learner launch/Attempt evidence belongs to 3B/3C after 2A–2C relationships and enabled-Bridge integration gates. Concrete authoring AI belongs to 2D/D09; tutor/support to 7D. U01/U02 remain REQUIRED_LATER and are not solved by this storage/AI foundation. Production D01 network/host isolation, real OPS configuration/cutover and 1B-10 integrated security proof remain pending. No scope reduction of the full migration is proposed.

PHASE_1B9C: DESIGN_COMPLETE

DESIGN_APPROVAL: APPROVED_C9_S01_S08

DESIGN_BOUNDARY: FROZEN_FOR_CONTRACT_FOUNDATION

REVIEW_VERDICT: PASS_WITH_EXPLICIT_DOWNSTREAM_GATES

P0: 0

P1: 0

P2: 0

READY_FOR_DESIGN_CHECKPOINT: YES

BUSINESS_RESOURCE_OPENING: CLOSED

ACTUAL_LEARNER_LAUNCH: NOT_AUTHORIZED

SCALAR_DEPENDENT_RUNTIME_OPERATIONS: BLOCKED_PENDING_SUPPORTED_INTEGRITY_PROOF

AI_PROVIDER: FAKE_ONLY_FOUNDATION

PAID_AI_AND_D09: NOT_AUTHORIZED

EXACT_SCHEMA_ACL_SUPPLEMENT: REQUIRED_BEFORE_PERSISTENCE_BUILD

MIGRATIONS_0001_0013: UNCHANGED

BUILD_AUTHORIZED: NO

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO
