# Phase 1B-9C — Exact Runtime Schema / ACL / Security Composition / Workflow Supplement

STATUS: DESIGN_COMPLETE / APPROVED_C9_P01_P08 / FROZEN_FOR_CONTRACT_FOUNDATION

Date: 2026-10-05. Branch: `refactor/zhiban-v2`. Base HEAD: `98147fb69bf83e11250990c77d9c331b52282e75`; original design preflight worktree CLEAN. The user explicitly authorized review and approval of C9-P01–P08; review preflight contained only this untracked supplement. Only this document is changed. Approval freezes its bounded contracts, not their implementation or execution; checkpoint/remote verification and separate BUILD authorization remain required.

Authority: approved [C9-S01–S08](phase1b-9c-runtime-ai-design.md), [B9 schema/security supplement](phase1b-9b-schema-acl-design.md), [1B-9B freeze](phase1b-9b-review.md), [ADR-012](../adr/ADR-012-openmaic-identity-bridge.md), [ADR-013](../adr/ADR-013-openmaic-private-runtime-boundary.md) and [execution plan](../zhiban-v2-execution-plan.md). Historical ADR-013 text about ADR-012's proposed status does not supersede ADR-012's later limited acceptance. Authentication Session, Credential, Identity authorization and applied migrations remain frozen.

## C9-P01 — Exact deliverable, migration decision and production gate

The repository has migrations **0001–0013**, no real Attempt/Enrollment/Activity persistence, no Runtime binding tables and no teaching permission catalog. Therefore this contract foundation BUILD adds **no Identity migration**, including no `0014`, no production `runtime_bindings`/`runtime_operations`/`runtime_audit_events`, and no placeholder business aggregate. `0014` is merely the currently available sequence for a later eligible change. All thirteen existing migration files and their ledger/checksum contract remain unchanged.

Production composition exposes closed `ActivityRuntimePort` and `AIServicePort` facades whose current business facts are UNAVAILABLE and whose result is DENIED. It cannot accept a caller-provided store, binding/facts loader, grant boolean, approval switch or provider callback. The facade performs no native/local Runtime DML, AI call or provisioning. It supplies no native ref/learner handle. No learning route or UI is added.

Reusable Infrastructure contracts can implement validation, reservation/dispatch/settlement state transitions, public-provider transaction boundaries and admission. Their positive persistence implementations are restricted to **test adapters under `tests/`**. No test SQL/repository/fixture manifest is imported by production composition. Fake AI is a pure foundation contract tested through an internal fixture composition; it is not a production fallback that turns DENIED into DRAFT.

Two distinct persistence proofs are required: a test-only local schema in the existing disposable Identity PG16 database, and a separate empty private native Runtime database. The former tests the proposed binding/ledger mechanics with synthetic business relationships and real frozen Identity security checks. The latter tests the actual public PgRuntimeStore schema/provider/ACL. Neither proof declares real Attempt or production network/host integration complete.

Concrete files planned for BUILD are minimal Application `openmaic/runtime.ts` and `openmaic/ai.ts`, Infrastructure `openmaic/runtime/**` and `openmaic/ai/**`, new `tests/zhiban/runtime/**` plus `tests/zhiban/identity/postgres/pg16-runtime-foundation.test.ts`, and the two existing workflows specified in C9-P07. Existing `bridge.ts`, Document/Asset provisioning/receipt, Identity security helper and B9 implementations do not need semantic changes. No dependency, Domain, public HTTP or upstream package-tree change is required. The actual BUILD file inventory must be reported before its separately authorized checkpoint.

## C9-P02 — Exact local schema contract and test-only ownership

Only the disposable fixture creates schema **`zhiban_runtime_contract_test`**, owned by `zhiban_identity_owner`. This name is never in the production migration inventory. Initialization requires GITHUB_ACTIONS=true, ZB_PG16_DISPOSABLE=1, C9_PG16_REQUIRED=1, a loopback `postgres` administrator URL for `zhiban_pg16_test`, and a verified server major 16. A failed guard creates nothing. The fixture cannot be installed from an application startup or maintenance command.

Notation: **U** = UUIDv7 with `zhiban_identity.is_uuid_v7`; **R** = signed `bigint` in 1..9223372036854775807, mapped exclusively as canonical decimal strings/BigInt; **T** = integer epoch milliseconds in 0..8640000000000000; **H** = 64 lowercase hex characters with C collation; **O** = independently generated canonical base64url of 32 CSPRNG bytes, 43 characters, checked by decoding/re-encoding in the mapper; **Q** = non-empty, well-formed Unicode request ID with no control/NUL characters and <=256 UTF-8 bytes. SQL checks length/closed shape; the mapper also rejects noncanonical encodings. All listed fields are NOT NULL unless stated NULL. All local FK deletes are RESTRICT, never CASCADE. There are no generated identity sequences or arbitrary JSON payload columns.

The synthetic business parents are explicitly fixtures, not Course or Attempt Domain entities:

| Fixture table | Exact contract |
| --- | --- |
| `resources` | `tenant_id` FK real `tenants(tenant_id)`, `slot_id U`, `generation_id U`, `stage_ref O`, `state IN ('ENABLED','SUSPENDED','TRANSFERRING','RETIRED')`; PK `(tenant_id,slot_id,generation_id)`, UNIQUE `(tenant_id,generation_id)`, UNIQUE `(tenant_id,stage_ref)`. Only administrator/owner fixture setup mutates these facts. |
| `attempts` | `tenant_id`, `attempt_id U`, `slot_id U`, `generation_id U`, `learner_membership_id U`, `state IN ('ACTIVE','CLOSED','REVOKED')`; PK `(tenant_id,attempt_id)`, UNIQUE `(tenant_id,attempt_id,slot_id,generation_id,learner_membership_id)`; FK exact resource tuple, FK `(tenant_id,learner_membership_id)` to real Membership. No score/completion/evidence column. |
| `scenes` | `tenant_id`, `generation_id U`, `scene_binding_id U`, `scene_ref Q`; PK `(tenant_id,generation_id,scene_binding_id)`, UNIQUE `(tenant_id,generation_id,scene_ref)`; FK resource `(tenant_id,generation_id)`. It supplies a closed same-generation anchor, not a Class/Course relationship. |

The following exact shapes are the executable fixture contracts. Production adoption will require a later reviewed migration replacing fixture resource/Attempt/scene references with the **actual approved business and Bridge composite FKs**. These fixture references must not be presented as production FKs or copied into `0014`.

| Local table | Exact fields and constraints |
| --- | --- |
| `runtime_bindings` | `tenant_id`, `runtime_binding_id U`, `slot_id U`, `generation_id U`, `attempt_id U`, `learner_membership_id U`, `runtime_ref O`, `learner_handle O`, `kind='chat'`, `status IN ('PENDING','ACTIVE','COMPLETED','ARCHIVED','FAILED')`, `repository_revision R`, `outstanding_operation_id U NULL`, `expected_last_seq bigint NULL CHECK 0..127`, `record_count bigint CHECK 0..128`, `record_bytes bigint CHECK 0..2097152`, `native_updated_at T NULL`, `created_at T`, `updated_at T>=created_at`; PK `(tenant_id,runtime_binding_id)`, UNIQUE `(tenant_id,runtime_binding_id,generation_id)`, UNIQUE `(tenant_id,attempt_id,kind)`, UNIQUE `(runtime_ref)`, UNIQUE `(learner_handle)` in this one-native-deployment fixture. Exact Attempt tuple FK, direct same-tenant Membership FK. Initial count/bytes=0, tail NULL. Tail is NULL iff count=0; otherwise tail=count-1. Bytes=0 iff count=0. PENDING/FAILED have zero settled records and native_updated_at NULL; ACTIVE/COMPLETED/ARCHIVED have created_at<=native_updated_at<=updated_at and map respectively to native active/completed/archived. FAILED is a terminal failed creation, not a revived Attempt. |
| `runtime_operations` | `tenant_id`, `operation_id U`, `runtime_binding_id U`, `generation_id U`, `actor_kind='USER'`, `actor_user_id U` FK real User, `actor_membership_id U` FK same-tenant Membership, `request_id Q`, `command IN ('CREATE_RUNTIME','APPEND_USER_RECORD','APPEND_ASSISTANT_RECORD','COMPLETE_RUNTIME','ARCHIVE_RUNTIME')`, `key_digest H`, `intent_digest H`, `expected_binding_revision R`, `reserved_binding_revision R=expected+1`, `expected_authorization_version bigint CHECK 0..9007199254740991`, `expected_last_seq bigint NULL CHECK 0..127`, `prior_status` from the binding status set, `prior_record_count bigint CHECK 0..128`, `prior_record_bytes bigint CHECK 0..2097152`, `record_id U NULL`, `native_record_ref O NULL`, `scene_binding_id U NULL`, `payload_digest H NULL`, `payload_bytes bigint NULL CHECK 1..8192`, `record_serialized_bytes bigint NULL CHECK 1..16384`, `target_status IN ('ACTIVE','COMPLETED','ARCHIVED') NULL`, `state IN ('RESERVED','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')`, `repository_revision R`, `dispatch_started_at T NULL`, `result_binding_revision R NULL`, `result_last_seq bigint NULL CHECK 0..127`, `reason` from the closed set below, `created_at T`, `updated_at T>=created_at`, `completed_at T NULL`; PK `(tenant_id,operation_id)`, UNIQUE `(tenant_id,runtime_binding_id,operation_id)`, FK `(tenant_id,runtime_binding_id,generation_id)` to binding and FK `(tenant_id,generation_id,scene_binding_id)` to scene. UNIQUE `(tenant_id,actor_membership_id,runtime_binding_id,command,key_digest)`; partial UNIQUE `(tenant_id,runtime_binding_id)` WHERE state IN ('RESERVED','OUTCOME_UNKNOWN'); partial UNIQUE `(native_record_ref)` and `(tenant_id,record_id)` when respective values are non-NULL. |
| `runtime_audit_events` | `tenant_id`, `event_id U`, `runtime_binding_id U`, `operation_id U`, `actor_user_id U`, `actor_membership_id U`, `request_id Q`, `event_type IN ('RUNTIME_RESERVED','DISPATCH_MARKED','RUNTIME_SETTLED','RUNTIME_FAILED','OUTCOME_QUARANTINED','OUTCOME_RECONCILED')`, `binding_revision_before R`, `binding_revision_after R`, `operation_revision R`, `reason`, `occurred_at T`; PK `(tenant_id,event_id)`, UNIQUE `(tenant_id,operation_id,operation_revision)`, FK `(tenant_id,runtime_binding_id,operation_id)` to operation and same-tenant actor Membership/real User FKs. No update/delete; no prompt/text/hash/native handle/native ref/authentication secret. Event code + reason + revisions have a closed per-transition relation, not arbitrary event JSON. |

Operation reasons: `NONE`, `DENIED`, `STALE`, `INVALID_INPUT`, `BUDGET_EXCEEDED`, `STORAGE_FAILURE`, `INTEGRITY_FAILURE`, `CANCELLED`, `UNKNOWN_OUTCOME`. RESERVED uses NONE; OUTCOME_UNKNOWN uses UNKNOWN_OUTCOME; SUCCEEDED uses NONE; FAILED uses an applicable closed failure reason and a proved no-effect/rollback outcome. A connection error alone does not permit FAILED. Authentication token/secret digests are never put in this ledger. `intent_digest`/`payload_digest` are internal bounded-command consistency material and never audited/logged/projected; raw record text is held in memory for the single dispatch, not persisted locally.

Unresolved RESERVED/OUTCOME_UNKNOWN rows have completed_at/result_binding_revision/result_last_seq NULL. OUTCOME_UNKNOWN requires dispatch_started_at NOT NULL. SUCCEEDED requires a committed dispatch mark; FAILED may have no mark only for proved pre-dispatch failure. Terminal rows have created_at<=completed_at<=updated_at, result_binding_revision=reserved_binding_revision+1 and the exact resulting tail (including NULL for zero records). A dispatch mark, when present, satisfies created_at<=dispatch_started_at<=completed_at for a terminal row, or <=updated_at otherwise. FAILED excludes reasons NONE/UNKNOWN_OUTCOME. Deferred checks validate these closed nullable/result shapes, including failed non-create preservation of prior status/tail/counters; no terminal shape is inferred merely from a status string.

Append alone requires record_id/native_record_ref/payload_digest/payload_bytes/record_serialized_bytes; scene is optional and must be exact; target_status=NULL. CREATE requires prior PENDING, empty tail and no record/scene/payload/target fields. COMPLETE/ARCHIVE require no record/scene/payload fields and exactly the respective target status. Both append commands retain prior ACTIVE status. APPEND_ASSISTANT_RECORD needs an internal server-producer capability bound to this one intent; positive fixture minting is test-only, and there is no production producer/service actor shortcut. The two append commands cannot use caller-selected roles.

Binding→outstanding-operation FK `(tenant_id,outstanding_operation_id)` is DEFERRABLE INITIALLY DEFERRED; the deferred consistency trigger additionally requires the same binding and the exact reserved revision. Every unresolved operation has exactly its binding fence and every fence has exactly one unresolved operation. Same transaction may insert binding+operation and establish the circular relation; no dangling pointer can commit. Partial uniqueness serializes competing reservations across independent clients. Unique native refs cannot be adopted by another binding; caller errors are sanitized.

Three fixture trigger functions use search_path=`pg_catalog,zhiban_runtime_contract_test,zhiban_identity,pg_temp`: `binding_history_guard()` is INVOKER (immutable ownership, refs/kind/created_at, lifecycle, CAS and counters); `operation_history_guard()` is INVOKER (immutable normalized intent and actor, terminal operation/history, one-way dispatch mark and operation CAS); `runtime_consistency()` is a **test-only SECURITY DEFINER trigger**, owned by zhiban_identity_owner with row_security=on and no direct runtime/PUBLIC EXECUTE (deferred same-binding fence, actor User↔Membership, fixture Attempt/resource/scene relationships, exact status/tail/byte/revision/audit relations). Its only Identity read is the exact already-locked same-tenant Membership's user_id through the existing owner SELECT policy from 0007; it reads no secret and acquires no new Identity lock. No Identity ACL/policy is added. Each trigger validates its table/operation branch before accessing table-specific NEW/OLD fields, and SQL relation aliases never conflict with implicit OLD/NEW.

The consistency check requires exactly one audit event for each operation revision with the valid transition chain in C9-P03; older immutable events remain valid history rather than needing to equal the operation's current revision. Triggers use the fixture parent-lock helper in C9-P05 before their cross-row checks; direct writes may deadlock because PostgreSQL can lock the target row before its trigger, in which case they reject without retry. The application always obtains parent locks before binding locks. Bound history/consistency triggers reject DELETE and invalid/future timestamps/state transitions. No table CHECK alone is claimed to prove a cross-row or concurrency invariant.

## C9-P03 — Exact state transitions, revision headroom and dispatch ownership

The permanent binding unique anchor is `(tenant,Attempt,chat)`. CREATE supplies a server-allocated binding ID and initial expected revision `1`: insertion at revision 1 and reservation to 2 occur in one local transaction; settlement reaches 3. A concurrent second CREATE cannot overwrite it or treat a failed existing binding as new. A later business-approved new Attempt needs a new binding, not resurrection of the old one.

| Transition | Binding / operation revision and effect |
| --- | --- |
| Reserve | Lock exact prior state; compare expected binding revision and tail before replay/no-op. Require binding revision <= max-int8-2. Insert operation revision 1 with RESERVED, advance binding R→R+1 and set the fence; append reservation proves prior count<128 and prior bytes+serialized append bytes<=2 MiB. Commit reservation + audit before native work. |
| Mark dispatch | One conditional update from exact RESERVED/revision 1/dispatch_started_at NULL to revision 2/non-NULL mark; binding remains R+1. Commit DISPATCH_MARKED audit. The winner alone receives a nonserializable one-use dispatcher capability after COMMIT resolves. A later process cannot re-mint it from the marked row. |
| Known settlement | From unmarked RESERVED/revision 1 for a proved pre-dispatch cancellation, or marked RESERVED/revision 2 for native success/proved rollback, operation advances exactly +1 and becomes SUCCEEDED/FAILED; binding R+1→R+2, clear fence, audit atomically. CREATE success PENDING→ACTIVE; proved failed creation PENDING→FAILED. Append success increments count once, tail exactly prior+1 (NULL→0) and bytes by the validated canonical native-record size. COMPLETE/ARCHIVE follow C9 lifecycle. A failed non-create command preserves prior status/count/tail/bytes while advancing settlement revision. |
| Quarantine mark | Marked RESERVED/revision 2→OUTCOME_UNKNOWN/revision 3 with audit; binding revision/fence/status/settled counters remain unchanged. If this local write fails, the committed RESERVED fence still denies access. Crash cannot remove the fence. |
| Reconcile | OUTCOME_UNKNOWN/revision 3→proved SUCCEEDED/FAILED/revision 4, binding R+1→R+2 and clear fence/audit atomically; no replay. A crashed marked RESERVED can first be classified OUTCOME_UNKNOWN, never marked dispatch again. No automatic worker or operator route is opened. |
| True no-op / completed outcome inspection | Fresh authority, exact current revision and settled tail must pass; no fence, writes, native call or revision increment. Use the separate read-only outcome inspection below to return a completed result, without resubmitting the original stale mutation revision. |

At reservation, binding headroom reserves both binding increments. A new operation begins at 1 and has at most three further revision increments (mark, quarantine, reconciliation); direct malformed/max operation revisions reject before dispatch. Mark timestamps are immutable and within operation created_at..updated_at. Terminal events/history cannot be rewritten. Result binding revision is exactly the settlement revision; result tail is the resulting settled tail, NULL only for an empty binding.

The mutation envelope's `idempotencyKey` uses the exact O encoding: canonical base64url of 32 bytes/43 characters, validated by decode/re-encode without trimming or Unicode normalization. It is a caller correlation value, never an authentication capability; its CSPRNG origin cannot be inferred from syntax. Persist only key_digest=SHA-256 of the canonical key's UTF-8 bytes, not the raw key. READ_OUTCOME requires the same key; ordinary safe results/audit/errors do not project it. Request ID Q is separate and supplies no authority. No random key is substituted when a key is missing/invalid.

An exact intent digest covers tenant, actor, command/key digest, binding/Attempt/generation, original expected revision/authVersion/tail, server allocated record/native refs, exact scene, closed payload digest and byte lengths, target status and predetermined timestamps. Hash a versioned fixed-order tuple of validated closed primitives (including explicit NULL), not an arbitrary caller object; payload digest covers the fixed role/content shape without lossy text normalization. Digests/raw serialized intent are not logged or audited. Same key/different intent rejects. After current authority/revision checks, look up an existing key **before** allocating new refs/timestamps; use its immutable allocation when comparing normalized input. Never mint new random IDs then misclassify the same request as a conflicting intent. Key handling cannot accept unbounded text, SQL fragments or provider configuration. Canonical serialized record size is computed with the predicted provider-assigned sequence and validated again against the actual returned record before native COMMIT. A mismatch rolls back.

The read-only internal `READ_OUTCOME` request supplies the same actor/binding/command/key and original business input plus **expected current** binding revision/authVersion. These inspection preconditions are distinct from the original immutable mutation preconditions stored in the ledger/digest. Fresh authority and current revision are checked first; reconstruct the original intent with stored original preconditions/allocations, reject changed input, and project only a completed closed result/current revision. A mutation retried with its original stale revision remains STALE, and READ_OUTCOME never authorizes dispatch, settles an unresolved fence or changes any record. No public HTTP endpoint is added. This preserves stale-before-no-op while making completed outcome inspection executable.

Native timestamp mapping is exact and separate from local ledger time: create uses canonical UTC ISO from binding.created_at for both native timestamps; a record/status mutation uses its predetermined operation.created_at, which must be >= the last confirmed native_updated_at. Append supplies public sessionTransition `{status:'active',updatedAt:that ISO timestamp}` so the record and native timestamp change are atomic. Settlement alone updates native_updated_at after validating the native envelope. Reservation/mark/quarantine/local updated_at changes do not silently claim a native timestamp update. The stored native-created timestamp remains bound to the original binding.created_at; no Date.parse normalization of malformed calendar values is accepted.

Uncertain native COMMIT, timeout, cancellation after dispatch or local completion failure never clears the fence or reports success. An empty/missing public lookup does not prove a timed-out writer cannot later commit. Proving a rollback requires a completed native rollback with no unresolved COMMIT, or an explicitly supported exact outcome proof. Append reconciliation is **disabled** on the current public API because no exact record getter/bounded integrity proof is available. Exact create/status inspection may be tested in an exclusive disposable fixture, but production reconciliation also remains denied until its real authority/integrity contract is supported. No clone/new binding/global scan compensates an uncertain operation.

## C9-P04 — Native Runtime schema, dedicated database and exact ACL

Use a separate empty native Runtime database; fixed CI name **`zhiban_9c_native_test`**. It is distinct from `zhiban_pg16_test` and B9's `zhiban_9b_native_test`. This avoids expanding the applied B9 Document/Asset database catalog or invalidating its provisioning receipt. No application creates a database; disposable CI administrator setup owns test creation/cleanup. Real database/network/credentials/provisioning execution remains an OPS authorization.

Reuse the unchanged admin-only native role bootstrap with the existing names `zhiban_openmaic_owner`, `zhiban_openmaic_migrator`, `zhiban_openmaic_runtime`. Owner NOLOGIN; other two LOGIN/NOINHERIT; all NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS/NOREPLICATION. Only owner→migrator membership is permitted, ADMIN FALSE/INHERIT FALSE/SET TRUE. Runtime owns no relation/function/schema/type/database and has zero role membership edges. The Runtime DB grants CONNECT only to migrator/runtime; PUBLIC and Identity/tenant/auth/control/Bridge roles have none. Database CREATE/TEMP and public schema CREATE are denied to runtime. Bootstrap does not alter existing role security attributes or B9 database grants.

New explicit maintenance module `infrastructure/openmaic/runtime/provision.ts` provides `provisionRuntimeNative` and read-only `verifyRuntimeProvisioning`, using the existing bootstrap roles. Provisioning checks session_user=migrator, exact approved database and an empty public table catalog, enters an explicit transaction, SET LOCAL ROLE owner, SET LOCAL search_path=`public,pg_catalog,pg_temp`, and calls **public** `ensureSchema` from `@openmaic/storage/runtime/pg`. All DDL/ACL/fingerprint/receipt work must succeed in that transaction. A failed provision leaves no partial schema. Production composition neither imports nor calls provisioning. Repeated maintenance checks the receipt/fingerprint without calling ensureSchema; incompatible/nonempty databases reject.

The public schema is adopted exactly, without tenant columns, private integrity triggers or provider patches:

| Native table / indexes | Public DDL contract |
| --- | --- |
| `runtime_sessions` | `id text PRIMARY KEY`, stage_id/learner_key/kind/status/created_at/updated_at TEXT NOT NULL, `data jsonb NOT NULL`; indexes `runtime_sessions_stage_learner_idx(stage_id,learner_key)` and `runtime_sessions_learner_idx(learner_key)`. No tenant RLS; the dedicated service database/role is private and authority is resolved by Zhiban. |
| `runtime_records` | `id text NOT NULL` (not a public PK/unique ID), `session_id text NOT NULL REFERENCES runtime_sessions(id) ON DELETE CASCADE`, `seq bigint NOT NULL CHECK(seq>=0)`, `scene_id text NULL`, `created_at text NOT NULL`, `data jsonb NOT NULL`; UNIQUE `(session_id,seq)` and index `runtime_records_session_scene_idx(session_id,scene_id)`. Host contracts enforce unique record IDs and the stronger size/sequence limits; the native DDL alone does not. |

REVOKE ALL on these tables from PUBLIC and every service/Identity role before exact grants. Revoke PUBLIC/runtime EXECUTE on any user-defined public function; this schema creates none. No sequence privilege is needed. Runtime gets public schema USAGE and only:

| Object | `zhiban_openmaic_runtime` grants |
| --- | --- |
| `runtime_sessions` | SELECT, INSERT; UPDATE `(stage_id,learner_key,kind,status,created_at,updated_at,data)` required by the public `persistSession` implementation and its row-lock path. No UPDATE(id), DELETE, TRUNCATE, REFERENCES, TRIGGER, grant option or ALL. |
| `runtime_records` | SELECT, INSERT only; no UPDATE/DELETE. |
| Other tables / functions / sequences / schemas | NONE beyond standard pg_catalog and explicit public schema USAGE. No Document/Asset table is installed in this dedicated DB. |

These native grants describe a private provider capability, not business authorization. The restricted store remains inaccessible through the production facade, and append/status/list paths retain the supported-integrity gate. ACL tests must distinguish absence of a public host method from DB privilege: no delete/sweep grants, but a trusted native runtime necessarily has exact table SELECT. It is not a tenant credential. PUBLIC table and column ACL are checked independently; `aclexplode(attacl)` is evaluated without constructing `'{}'::aclitem[]`, and NULL column ACL contributes zero grants.

Runtime receipt fields: `database`, `approvalRef`, `capability='RUNTIME_FOUNDATION'`, official SHA, storage/DSL package versions, `runtimeProtocol='0.1.0'`, role names, exact native schema/ACL fingerprint. Reuse `catalogFingerprint(client,'public')` read-only; additionally inspect database/schema ACL and each role's properties/ownership/membership/CONNECT/TEMP privileges because the existing catalog hash does not certify all these properties. Verify source protocol from public RUNTIME_DSL_VERSION and exact expected exported version, never substitute DSL_VERSION or package versions. Fingerprints/caller/database/role mismatch rejects, not an upgrade/re-provision.

## C9-P05 — Exact local ACL, authentic security and transaction composition

Local fixture schema grants are test-only and cannot broaden the real `zhiban_bridge`/Identity ACL. Fixture resources/Attempts/scenes allow SELECT to `zhiban_bridge_runtime` and owner fixture setup DML; the Bridge role has no parent INSERT/UPDATE/DELETE. All six fixture tables ENABLE and FORCE RLS, with SELECT/INSERT/UPDATE policies only for operations that the role is granted. Each uses tenant_id=`zhiban_identity.current_tenant_id()` for USING and WITH CHECK; missing/invalid context denies. Owner also has an exact tenant policy, no USING(true)/BYPASSRLS. Fixture root administration is explicitly outside runtime-role proofs.

| Fixture object | Exact `zhiban_bridge_runtime` grant |
| --- | --- |
| Schema | USAGE only, no CREATE. |
| `resources`, `attempts`, `scenes` | SELECT only. |
| `runtime_bindings` | SELECT, INSERT; UPDATE `(status,repository_revision,outstanding_operation_id,expected_last_seq,record_count,record_bytes,native_updated_at,updated_at)` only. |
| `runtime_operations` | SELECT, INSERT; UPDATE `(state,repository_revision,dispatch_started_at,result_binding_revision,result_last_seq,reason,updated_at,completed_at)` only. Immutable intent fields have no UPDATE grant. |
| `runtime_audit_events` | SELECT, INSERT only; no UPDATE/DELETE. |
| Fixture trigger functions | No PUBLIC/runtime direct EXECUTE; invoked only through their bound triggers. |
| `runtime_parent_context(uuid,uuid,uuid,uuid,uuid)` | EXECUTE only, on the narrowly defined **test-only** parent-lock helper below. |
| Identity utility/helper | Reuse existing EXECUTE on current_tenant_id/is_uuid_v7 and **unchanged** `bridge_identity_context(uuid,text,uuid,uuid,uuid[])`; no new grant on Identity tables/other functions. |

All other runtime roles and PUBLIC receive no fixture schema/table/function rights. No sequence, DELETE/TRUNCATE/REFERENCES/TRIGGER, global RLS policy, production SECURITY DEFINER helper or role edge is added. Audit INSERT validates actor User equals its Membership under the already locked parent rows; no `IdentityAuditEvent` extension or token/digest/verifier read is necessary.

PostgreSQL row-locking SELECT requires UPDATE privilege in addition to SELECT; a SELECT-only parent grant cannot implement FOR SHARE. Keep parent tables SELECT-only for the Bridge role. The fixture therefore defines exactly one helper **in the test schema**, `runtime_parent_context(p_tenant_id uuid,p_slot_id uuid,p_generation_id uuid,p_attempt_id uuid,p_learner_membership_id uuid) RETURNS TABLE(resource_state text,attempt_state text,stage_ref text)`: PL/pgSQL VOLATILE/PARALLEL UNSAFE/SECURITY DEFINER, owner `zhiban_identity_owner`, search_path=`pg_catalog,zhiban_runtime_contract_test,zhiban_identity,pg_temp`, row_security=on, no DML. REVOKE ALL from PUBLIC/all runtimes; EXECUTE only zhiban_bridge_runtime. It validates exact session_user, valid transaction tenant GUC equal to p_tenant_id, UUIDv7 inputs and the exact same-tenant fixture tuple; locks resource FOR SHARE then Attempt FOR SHARE and returns exactly one closed internal row. Missing/foreign/malformed inputs use a constant rejection without interpolated values. It reads no Identity table/token/grant/secret and cannot add participants or substitute for the already executed authentic helper. Trigger callers use the same exact tuple under the same transaction. The function is installed/dropped only by guarded disposable fixture setup. No shipped migration, production helper ACL or existing helper body changes. Real business parents later require their own reviewed same-transaction lock capability.

Infrastructure obtains the real handle resolver only from the existing Identity composition's `bridgeSecurity()` collaborator. Actor Membership/current authorizationVersion and a complete immutable actor/learner participant list are validated before later locks. The fixed call remains:

```sql
SELECT * FROM zhiban_identity.bridge_identity_context($1,$2,$3,$4,$5);
-- exact tuple: tenant UUID, internal Session digest, expected User UUID,
-- actor Membership UUID, distinct related Membership UUID[] of length <=2
```

The helper's internal digest never becomes a Runtime DTO/ledger/audit field; its thirteen-column projection and private registry remain unchanged. Repeated final checks use the exact same participant set, expected authVersion and revisions. Related User/Membership facts must be ACTIVE for the synthetic learner fixture; production still requires real current business policy. Identity role:assign or a fixture SELF grant is never claimed to authorize a real learning action.

Lock order stays compatible: Tenant FOR SHARE → complete sorted Users FOR SHARE → actor shared `zhiban-session-user:` advisory anchor → actor Credential slot FOR SHARE → exact authentication Session FOR SHARE → sorted Memberships/current actor grant rows FOR SHARE → fixture resources sorted by slot/generation FOR SHARE → fixture Attempt FOR SHARE → exact binding FOR UPDATE for mutation (SHARE for read) → operation. Scene consistency is inspected under the already held resource/Attempt anchors; no additional Identity participant is discovered. Privileged fixture parent writers take the same anchors before changes. Actual production resource locks stay pending until real parents exist.

A local transaction uses one zhiban_bridge_runtime client/TenantContext, READ COMMITTED, existing lock/statement/idle bounds (1000/<=5000/10000 ms), fresh clock and actual User/Credential/Session/grant/tenant checks. Reservation and dispatch-mark COMMIT finish before native dispatch. Reacquired dispatch/completion guards hold local authority locks while bounded native work/final checks run. No local client is passed to the native provider; no DB lock crosses a fake AI invocation. Schema/test direct SQL and app protocol paths must both obey the serialization and audit invariants.

`createSession` uses a fresh native transaction and a constructor Queryable pinned to that client. Append/status instantiate the public store with a transaction hook acquiring its own fresh native client; invoking a hook never nests inside an assumed outer transaction or shares a process-global client. In a hook, permitted public envelope checks use a provider reader pinned to that native client; they cannot inspect duplicated scalars. Validate bounded returned record/expected sequence and current guarded authority before COMMIT; known mismatch rolls back. Raw native SQL is restricted to transaction settings and reviewed provisioning/catalog work; fixture poison/assertions are under tests. No private native SQL ownership/integrity/repair guard is added to production adapters.

The Runtime transaction runner retains an Infrastructure-private outcome enum `NOT_DISPATCHED | ROLLED_BACK | COMMITTED | UNKNOWN`, based on acknowledged transaction command tags and whether COMMIT was sent. It cannot infer known rollback from the existing generic BridgeError. After rollback/disposal/release, the hook sanitizes errors before the provider retry loop receives them; errors/results crossing the port contain only closed codes, without `.code` values recognized by the provider, raw `.cause`, messages, SQL parameters or custom properties. Failure to prove cleanup/outcome stays unknown. Public create's direct-query errors and get/validation errors need the same outer sanitization. The no-retry proof counts actual hook/BEGIN/COMMIT/ROLLBACK invocations, not just a mocked final rejection.

Add a Runtime-owned admission module: two admitted operations, no waiting queue, ten-second monotonic deadline across local/native waits. Keep the permit until actual work and connection cleanup settle; a caller timeout cannot release it early. Existing B9 `admittedOperation()` releases its count when the caller's deadline race ends, so it is **not** reused for this stronger Runtime/AI permit contract or modified in this unit. Pools are bounded actual pg.Pool instances, max=2/connectionTimeoutMillis<=1000, distinct local/native databases and credentials. A late connection is disposed; failed/uncertain COMMIT connection is never returned for reuse. Finalization errors cannot erase a committed fence.

## C9-P06 — Closed Runtime / AI interfaces and fake-only composition

Application request envelopes carry authentic handle/context, actor Membership, expected authorizationVersion, a canonical Zhiban binding ID when one exists, expected RepositoryRevision and request ID; mutations also require the exact idempotencyKey from C9-P03. CREATE takes a real server-resolved Attempt target; ownership/native refs/time are generated/resolved internally. APPEND_USER_RECORD input is only bounded text and optional Zhiban scene binding ID, with an explicit number-or-null expected tail. COMPLETE/ARCHIVE have an explicit tail and no payload. READ_SESSION projects one safe binding/status/revision; READ_OUTCOME follows the exact current-versus-original preconditions above; READ_RECORDS remains denied under current unsupported bounds/integrity. Arbitrary action strings, client role/ref/timestamp/seq/provider data and extra fields reject.

The Infrastructure persistence seam is Runtime-specific, transaction-scoped and has no generic UnitOfWork/exported raw SQL/client DTO. It carries only the exact binding/operation/audit records and typed reserve/mark/settle/quarantine transitions above. The Fake and test-PG adapter share the same contract tests, including stale-before-no-op, headroom, immutable terminal history, exact counters/fence and failed audit rollback. The test-PG adapter/DDL live entirely in tests; production composition has no concrete local Runtime repository and remains DENIED. An assistant producer capability cannot be obtained from a browser Role/flag or forged structural object.

AI input is exactly `{requestId,purpose:'AUTHORING_DRAFT_TEXT',brief}` after schema validation; future real use-case authority remains outside the pure provider contract. Template revision `c9-draft-text-v1`, policy `c9-ai-foundation-v1`, input/output schema version `1`, provider alias `FAKE`; no credential/environment/network provider discovery. A fixed server template treats the brief as data. Fake returns a deterministic bounded plain-text draft through the approved output/provenance shape, or a closed failure. It neither imports the public generation pipeline nor writes Runtime/content/audit. This BUILD does not use generic AICallFn or withGenerationRetry. Positive fake tests confer no D09/model-quality/prompt-injection signoff.

Use a separate AI admission pool with capacity two/no queue; brief <=8192 bytes, assembled prompt <=32768 bytes, draft <=16384 bytes, well-formed Unicode/no NUL, one metered call and ten-second deadline. Caller cancellation/deadline returns a closed failure promptly, but an ignoring provider retains its permit until actual settlement. A rejection handler consumes late rejection; late output is discarded and no publication callback runs. Admission tests cover a never-settling synthetic provider occupying both slots, denial of the next call, actual settlement/release, synchronous throw, abort-before-call, duplicate cancel and rejection-after-timeout. No timer/permit is leaked after settlement. This contract intentionally fails closed under unavailable capacity; distributed limits/paid tokens/cost accounting belong to approved real AI jobs.

Regular production exports expose only facades/contracts and closed projections. Native provider/material, fake injection, authentic resolver, test repository and positive fixture factories are not exported from an ordinary Identity/Application barrel or HTTP adapter. Any new Infrastructure internal export needed by tests is not wired to the production factory. Production factory tests must prove business denial happens before native connect/provision/provider activity even when supplied request data are well formed.

## C9-P07 — Exact additive workflow plan

Only these existing workflows need BUILD edits: `.github/workflows/zhiban-identity-pg16-security.yml` and `.github/workflows/storage-pg-contract.yml`. Keep PostgreSQL 16, Ubuntu/Node22, all existing test commands/security assertions, frozen installs, current modes and loop counts/timeouts. Add no workflow, new selection mode or automatic failure rerun. General `ci.yml` stays unchanged; its root test discovery picks up new hermetic unit files. Current targeted modes that skip root tooling must not be called a root lint/typecheck pass.

**Identity workflow:** before either full/bridge-recheck PG16 loop, add the following step, conditioned on `env.IDENTITY_SUITE == 'full' || env.IDENTITY_SUITE == 'bridge-recheck'`, with `shell: bash`:

```bash
set -euo pipefail
git -c http.version=HTTP/1.1 fetch --no-tags --depth=1 \
  https://github.com/THU-MAIC/OpenMAIC.git 1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce
test "$(git rev-parse FETCH_HEAD)" = "1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce"
git diff --exit-code FETCH_HEAD HEAD -- packages/@openmaic
pnpm --filter @openmaic/dsl build
pnpm --filter @openmaic/storage build
node tests/zhiban/runtime/prepare-provider.mjs \
  --receipt "$RUNNER_TEMP/c9-provider.json"
```

The new test preparation script writes a non-secret receipt to that exact RUNNER_TEMP path (GITHUB_SHA, official SHA, Node/platform, source/lock digest, exported runtime protocol and resolved artifact digest); no tracked output. It rejects HEAD != GITHUB_SHA or Node/platform/protocol mismatch. Native/public-provider cases verify that receipt and actually call the built provider, not just install it. Existing later build commands are retained.

Within **both** existing full and bridge-recheck two-pass loops, append this command after pg16-bridge and before the existing PASS marker:

```bash
C9_PG16_REQUIRED=1 C9_PROVIDER_RECEIPT="$RUNNER_TEMP/c9-provider.json" pnpm exec vitest run \
  tests/zhiban/identity/postgres/pg16-runtime-foundation.test.ts --reporter=verbose
```

In the existing static/Domain/Port regression step append the explicit hermetic selection:

```bash
pnpm exec vitest run \
  tests/zhiban/runtime/contracts.test.ts \
  tests/zhiban/runtime/records.test.ts \
  tests/zhiban/runtime/protocol.test.ts \
  tests/zhiban/runtime/native-provider.test.ts \
  tests/zhiban/runtime/admission.test.ts \
  tests/zhiban/runtime/ai.test.ts \
  tests/zhiban/runtime/schema-acl.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

Native-provider unit tests use an injected public Queryable/hook with actual PgRuntimeStore and verify SQL parameters/order/rollback/retry suppression; the real PG files supply independent connections and restricted-role proof. Exact fixture values must be screened/encoded with existing Credential test policy when building real authentication fixtures; do not introduce a new password fixture encoding convention.

**Storage workflow:** reuse its existing exact-official preparation/cleanup chain. In each relevant full and bridge-recheck step, copy new `tests/zhiban/runtime/` into the newly built diagnostic workspace alongside the existing `lib/zhiban` and Bridge copies. Retain the original B9 loops and commands. Then append a separate two-pass Runtime loop, so each prior B9 process/database/role cleanup has finished before Runtime role setup:

```bash
for pass in 1 2; do
  echo "C9 NATIVE PG16 RUN ${pass}"
  C9_NATIVE_REQUIRED=1 pnpm exec vitest run \
    --config tests/zhiban/runtime/vitest.native.config.ts \
    tests/zhiban/runtime/native-pg.test.ts --reporter=verbose
  echo "C9 NATIVE PG16 RUN ${pass} PASS"
done
```

The new `vitest.native.config.ts` includes exactly native-pg.test.ts, alias `@`→diagnostic workspace, maxWorkers=1/fileParallelism=false, testTimeout=15000/hookTimeout=30000 matching current B9 config. It cannot replace or exclude B9's native/browser config. Cases assert existing artifact-provenance.json baseHead=GITHUB_SHA, officialTag, freshBuild, linux/x64/Node22 and Runtime stamp. Each pass creates/checks/cleans its own fixed disposable Runtime DB; no reuse of pass-one data/receipt. Global role setup tracks pre-existing roles, rejects unsafe/mismatched roles and drops only roles the fixture created after closing all tracked pools/clients; it does not alter unrelated credentials/roles.

Required flags with missing URL/provenance/setup hard-fail rather than skip. Ordinary root/hermetic collection without C9_PG16_REQUIRED/C9_NATIVE_REQUIRED may skip real suites, but CI receipt/report must verify their collection and zero skipped cases in the required commands. SQL fixture setup/teardown runs outside test counts and cannot be caught-and-passed. The new suite must fail if native module fails to resolve/load. Counts are actual per-suite sums, not forced snapshots.

Final foundation signoff uses the exact same candidate SHA in the existing **Identity `full`** run (old security/regression plus C9, root lint/8192-MiB temporary-heap tsc) and **Storage `bridge-recheck`** run (fresh public artifacts, retained B9 native tests, new native Runtime twice). Changed-scope evidence can retain previous general CI/diagnostic results with their old SHA; no new full-general-CI success is claimed if not executed. Subsequent authorized targeted reruns need a reviewed selection and precise unchanged evidence attribution; no new mode is added by this proposal.

## C9-P08 — Test inventory, claims and approval gates

Planned real suites use logical case IDs, with actual case counts recorded at BUILD rather than invented now:

| Suite | Required cases |
| --- | --- |
| `C9-I` local/Identity PG16 | Production no binding tables/new migration/facade open gate; fixture inventory/ACL/FORCE RLS/missing context/cross tenant; exact actor/learner current state; reservation/key conflict/headroom; independent concurrent reserve; one-use dispatch mark; stale-before-no-op; correct counters/terminal history; same-transaction audit failure rollback; crash at reserve/mark/native commit/local completion; failed quarantine still fenced; known rollback versus unknown outcome; no redispatch; fresh pre-native-COMMIT and settlement validation. |
| `C9-I` actual frozen-writer races | Independent acknowledged connections for Credential replace/revoke, logout/revokeAll, User disable/restore, Tenant/Membership/grant changes versus guarded dispatch; expiry advanced at acknowledged barriers; local fixture resource/Attempt revoke versus dispatch. Observe waits/locks and persisted state/revisions, no sleep-only timing. Fixture races are not real Enrollment proof. |
| `C9-N` native PG16 | Public provisioning/failed provisioning rollback/read-only repeat verification; exact owner/migrator/runtime/ACL/CONNECT/TEMP/functions; create/get/version/envelope checks; wrong ID/Stage/learner and unknown kind; tail NULL/numeric CAS/competing append; status terminal guard; all three actual retryable SQLSTATE paths translate before retry and have one provider transaction; create final-check rollback, malformed row fail closed, pool/late-connect cleanup/unknown COMMIT treatment. |
| `C9-N` integrity limitation | Poison JSON and prove boundary denial without repair. Scalar-only corruption demonstrates the public getter limitation and the production adapter's blocked-path decision; it must not assert the public getter rejects such corruption. Unbounded list/merge/delete capability remains unavailable. Provider diagnostic status/append positives exist only in admitted disposable contracts. |
| Hermetic Runtime/AI | Shared Fake/test-PG contracts; closed input/output/Unicode/byte limits/sequence schema; real public provider query-hook ordering; no retry/code/cause/content leak; capacity/ignored abort/late completion; assistant capability forgery denied; no paid/network/DB side effect; closed production facade and export/import boundary checks. |

Real SQLSTATE tests may use administrator-installed **test-only** fail-once triggers or acknowledged native-connection faults under the disposable database, with a counter outside the rolled-back failed transaction or an observed hook-attempt counter. A counter updated in the same aborted transaction cannot prove one versus five attempts. A trigger-raised 40001 proves real driver-code/retry suppression, not an actual SERIALIZABLE race; existing signed-off Identity transaction tests supply that separate evidence. A fault trigger changes the schema fingerprint: factory/receipt mismatch must still reject. The isolated public-provider/hook diagnostic may exercise that intentionally modified fixture without treating it as admitted production provisioning; cleanup restores and verifies the baseline before subsequent ACL/receipt proofs. No trigger/row poison or fault injector becomes a native production guard. Preserve raw-error confidentiality in assertion diagnostics and query traces; store statement names/parameter-shape rather than secret/text parameter values.

Expected migration inventory stays 13; existing B9 Identity/native baselines are retained and newly executed tests added by actual count. No new production Runtime FK, scalar integrity, bounded public records API, D01 deployed isolation or D09/paid AI success is inferred from this foundation. Full downstream persistence/opening still needs real Attempt/resource contracts, supported integrity/bounds, exact production FKs/ACL review and integrated evidence. Old migrations/native schemas/receipts are checked unchanged; a later eligible migration must follow current sequence and normal checksum safety.

## Review proposals and state

Review authorization: the user explicitly requested review and approval of C9-P01–P08. Targeted repository checks compared approved C9-S01–S08, actual public PgRuntimeStore DDL/create/status/append contracts, native role bootstrap, the existing authentic security seam/transaction runner, applied helper/RLS definitions and both current workflows. No parser/real-PG16, provider runtime, race or CI PASS is claimed by this documentation review.

Resolved before approval: froze the previously underspecified idempotency key format and digest input; separated its correlation meaning from authentication authority; added exact terminal/unresolved nullable result and timestamp constraints; and scoped DELETE rejection to bound triggers rather than the read-only helper. Existing reservation/mark/settlement increments, stale-before-no-op, retained permits, unsupported-integrity gates and production-unavailable facts are preserved. No frozen Identity/Credential/Session/Bridge semantics or applied migration changes are required.

| Proposal | Decision |
| --- | --- |
| C9-P01 — contract-only BUILD scope and no new Identity migration | APPROVED — production facts/gate closed; no fabricated Attempt or production Runtime tables. |
| C9-P02 — exact test-local binding/operation/audit schema and deferred production FKs | APPROVED — guarded disposable schema, immutable intent/history and deferred fence/audit consistency; real production FKs remain a later gate. |
| C9-P03 — exact revisions, cross-process dispatch fence and outcome settlement | APPROVED — canonical keys, sufficient revision headroom, one-use dispatch, separate current-revision inspection and no replay of unresolved outcomes. |
| C9-P04 — separate native Runtime database, public provisioner and exact ACL/receipt | APPROVED — explicit maintenance only; separate database/public schema, least native grants and full receipt verification without invalidating B9. |
| C9-P05 — unchanged authentic helper, compatible locks and retained admission permits | APPROVED — test-only parent-lock capability, frozen Identity helper/ACL, independent Runtime transaction outcome/admission mechanics. |
| C9-P06 — closed ports, test persistence seam and fake AI composition | APPROVED — no production persistence injection/producer shortcut; bounded fake-only AI, no real generation/network/publication. |
| C9-P07 — additive two-workflow integration with fresh artifacts and explicit collections | APPROVED — exact existing workflows/modes, retained prior commands, actual fresh-provider tests/two-pass gates; no workflow edit in this review. |
| C9-P08 — actual provider/race/failure proofs and bounded signoff claims | APPROVED — implementation/PG16 evidence still required; historical proof retains its exact SHA and does not open unsupported paths. |

Review verdict: **PASS_WITH_EXPLICIT_DOWNSTREAM_GATES**. P0/P1/P2=0/0/0 within this approved design scope after the clarifications above. Real implementation, PG16/native/race evidence, actual Attempt/business authorization, supported scalar integrity/bounded reads, production OPS provisioning/isolation and real AI/D09 remain uncompleted downstream gates, not waived findings or implementation signoff.

Next: separately authorize the single-document checkpoint plus independent GitHub HEAD/message/parent check (**GPT-6 Sol / Low**). Then separately authorize contract foundation BUILD (**GPT-6.1 Sol / High**), initially NO COMMIT/NO PUSH/NO CI DISPATCH. The approved C9-S design remains unchanged; this supplement neither authorizes BUILD by itself nor resolves its supported-integrity/business/paid-AI gates.

PHASE_1B9C_SUPPLEMENT: DESIGN_COMPLETE

DESIGN_APPROVAL: APPROVED_C9_P01_P08

DESIGN_BOUNDARY: FROZEN_FOR_CONTRACT_FOUNDATION

REVIEW_VERDICT: PASS_WITH_EXPLICIT_DOWNSTREAM_GATES

P0: 0

P1: 0

P2: 0

READY_FOR_SUPPLEMENT_CHECKPOINT: YES

IDENTITY_MIGRATION: NONE_FOR_CURRENT_FOUNDATION

MIGRATIONS_0001_0013: UNCHANGED

PRODUCTION_RUNTIME_BINDING_TABLES: NOT_CREATED_PENDING_REAL_ATTEMPT_CONTRACT

PRODUCTION_BUSINESS_ACCESS: CLOSED

SCALAR_DEPENDENT_RUNTIME_OPERATIONS: BLOCKED_PENDING_SUPPORTED_INTEGRITY_PROOF

AI_PROVIDER: FAKE_ONLY_FOUNDATION

WORKFLOW_CHANGES_THIS_ROUND: NONE

BUILD_AUTHORIZED: NO

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO

## 2026-10-07 LOCAL execution environment supplement

The separately authorized [Ubuntu LOCAL PG16 continuation](phase1b-9c-local-pg16.md) adds an explicit disposable LOCAL branch to the C9-P02/P07 execution-environment gate. It preserves the original GitHub Actions path and all frozen production/schema/ACL contracts, requires dedicated-cluster verification and marks local provenance/results LOCAL. It does not replace required CI signoff or authorize commit/push/dispatch.
