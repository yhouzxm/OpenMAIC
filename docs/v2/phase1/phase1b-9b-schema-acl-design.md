# Phase 1B-9B Exact Schema / ACL / Security Composition Supplement

STATUS: REVIEWED / APPROVED / FROZEN_SUPPLEMENT

Date: 2026-10-04. Branch: `refactor/zhiban-v2`. Baseline: `0c1096fd68acb0a474668a6080fc5a7f450ff68d`.

This supplement makes approved [B9-S01–S08](phase1b-9a-bridge-design.md) concrete for the separately authorized 1B-9B BUILD. B9-P01–P08 below were reviewed and approved following the user's explicit approval request on 2026-10-04, with the review clarifications recorded below. This design/review task changes one document; no SQL, code, provisioning, tests, workflow, commit, push or CI dispatch is performed. Applied Identity migrations 0001–0011 and frozen Identity/Credential/Session/Authorization semantics are preserved.

## Targeted facts and scope

Authority: [ADR-012](../adr/ADR-012-openmaic-identity-bridge.md), [execution plan](../zhiban-v2-execution-plan.md), [1B-9A](phase1b-9a-bridge-design.md). Reviewed sources include [role bootstrap](../../../lib/zhiban/infrastructure/identity/postgres/bootstrap-roles.pg16.sql), [migration runner](../../../lib/zhiban/infrastructure/identity/postgres/migrate.ts), [0007](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0007_identity_authorization_state.sql), [0008 Session guard](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0008_identity_authentication_composition.sql), [member commands](../../../lib/zhiban/infrastructure/identity/composition/member-commands.ts), [control commands](../../../lib/zhiban/infrastructure/identity/composition/control-commands.ts), [authentication registry](../../../lib/zhiban/infrastructure/identity/composition/authentication.ts), [DocumentStore](../../../packages/@openmaic/storage/src/document/pg.ts), [AssetStore](../../../packages/@openmaic/storage/src/asset/pg.ts), [public PG byte backend](../../../packages/@openmaic/storage/src/asset/pg-bytes.ts) and [RuntimeStore](../../../packages/@openmaic/storage/src/runtime/pg.ts).

The existing migration runner sets `zhiban_identity_owner`; that role already has database CREATE. Existing runtime roles have zero membership edges and no DDL/TEMP/bypass privileges. `identity_session_guard` explicitly accepts only existing tenant/control roles, so it cannot be granted to a new role as a shortcut. The current authorization catalog is `identity-v1` and has no teaching-resource rules. There are no real Activity/Course/Attempt aggregates/tables in the current Zhiban Domain/Application tree.

Consequently, 1B-9B builds **empty, closed mapping infrastructure and disabled resource adapters**. Exact synthetic integration tests are allowed in disposable databases. Production mapping writes/reads through use cases remain closed until the corresponding business unit installs real resource FKs, trusted facts and an approved catalog. A freely configurable `enabled=true` cannot replace those prerequisites.

## B9-P01 — Migration, roles, provisioning and opening gate

### Identity database

The next candidate migration is `0012_openmaic_bridge_foundation.sql` in the existing Identity migration directory/ledger. If 0012 is occupied at BUILD preflight, stop and resolve sequencing; do not overwrite/squash an applied migration. Use the existing explicit owner/migrator runner, transactional ledger/checksum and advisory serialization; do not modify its frozen behavior.

0012 creates schema `zhiban_bridge`, owned by **existing `zhiban_identity_owner`**, seven tables, the functions/triggers below and exact privileges. No new owner-to-migrator membership edge is needed. It does not create cluster roles: an additive, admin-only `bootstrap-bridge-roles.pg16.sql` provisions/checks `zhiban_bridge_runtime` before migration. The old bootstrap remains unchanged.

`zhiban_bridge_runtime`: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, NOREPLICATION; no incoming/outgoing memberships, no SET ROLE path, no object ownership, CREATE or TEMPORARY. Credentials are out of band. It gets CONNECT only to the designated Identity DB, USAGE on the two required schemas and exactly B9-P04/P05 grants. Existing roles receive no new Bridge capability.

### Private OpenMAIC database

Use a separate private database and separate connection pool, with `PgAssetByteStore` as the initial byte backend. This fixes the byte choice to a proved public PG interface, removes any public bucket/static-origin requirement and avoids choosing an unverified filesystem/S3 implementation. Byte/WAL/backup size remains subject to the approved 4 MiB / 32 MiB limits and OPS sizing.

A separate admin-only bootstrap provisions `zhiban_openmaic_owner` (NOLOGIN, NOINHERIT), `zhiban_openmaic_migrator` (LOGIN, NOINHERIT) and `zhiban_openmaic_runtime` (LOGIN, NOINHERIT). All lack SUPERUSER/CREATEDB/CREATEROLE/BYPASSRLS/REPLICATION. Only migrator → owner is permitted, ADMIN FALSE / INHERIT FALSE / SET TRUE. The runtime has no memberships or ownership. This graph is separate from Identity's unchanged graph.

Private DB provisioning is an explicit maintenance command using **public** `ensureAssetSchema` and `ensureDocumentSchema` at the pinned official versions. It sets role to its owner, invokes the public contracts transactionally and stamps a separate maintenance receipt containing official SHA, package versions and catalog fingerprint. It neither copies native DDL into Identity migration 0012 nor patches upstream functions. Subsequent maintenance checks the fingerprint and fails on unexplained drift; `ensure*` is not an application startup step or an upgrade migration strategy. Native Runtime/Agent/Skill/Material schemas are not provisioned by 1B-9B.

Database names/connection secrets and real production creation remain separately authorized OPS resources. CI uses explicitly allowlisted disposable DBs. The two DBs must be distinct; no V1/main native DB reuse. Runtime connections verify role attributes, graph, schema/provisioning fingerprints and approved deployment manifest before admission. No credentials/endpoints are placed in the mapping or audit tables. Explicit CONNECT grants do not revoke privileges inherited from PUBLIC on an existing database: OPS must enforce the exact role/database/network allowlist through PostgreSQL connection policy and verify off-target connections reject. Do not silently rewrite the old Identity database's PUBLIC CONNECT ACL or claim complete connection isolation from the new grants alone.

### Permanent current gate

0012 defines `zhiban_bridge.business_resource_ready(p_tenant_id uuid,p_activity_id uuid) RETURNS boolean`, SQL STABLE SECURITY INVOKER, fixed search_path, whose current body returns **FALSE**. It has no config/GUC override and does not dynamically query guessed future tables. A guard trigger rejects INSERT/UPDATE on all tenant mapping/operation/audit tables while this gate is false, including owner-mediated writes. This is deliberate closed behavior, not a production fixture switch.

The future Activity unit must approve an additive migration that installs actual `(tenant_id,activity_id)` FKs, a supported business gate and compatible resource locks/facts/catalog. Until then no production row can be reserved, published or claimed as a real activity. Runtime bindings/Attempt FKs similarly wait for their real schema. Nullable external effect results are allowed; nullable/fake business ownership is not.

## B9-P02 — Exact document mapping schema

Notation in all tables: `U` = UUID with structural UUIDv7 check; `R` = bigint CHECK >=1 (signed int8); `T` = bigint milliseconds CHECK 0..8640000000000000; `H` = text COLLATE "C", exactly 64 lowercase hexadecimal bytes; `O` = text COLLATE "C", 1..256 UTF-8 bytes, no control characters, exact comparison. Opaque provider references use O, never a guessed private ID prefix. No serial/identity sequence is introduced; Zhiban record IDs are server-generated UUIDv7. Timestamps are server-produced, created<=updated, terminal timestamps within that interval. IDs, counters and timestamps cannot be silently normalized by mappers.

Every tenant table has PK `(tenant_id,<record_id>)`; tenant_id U FK `zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT`. All cross-table tenant FKs include tenant_id. All deletion semantics are RESTRICT; physical deletion grants are absent. Except the stated lifecycle/transfer/result fields, columns are immutable after INSERT. All FK/check/trigger failures use sanitized errors at the port boundary.

| Table | Columns and exact constraints |
| --- | --- |
| `deployment_registry` (global maintenance metadata) | `deployment_id U PRIMARY KEY`, `deployment_ref O UNIQUE`, `official_sha text` exactly 40 lowercase hex, `storage_version text CHECK='0.31.1'`, `dsl_version text CHECK='0.11.2'`, `renderer_version text CHECK='0.1.11'`, `provisioning_digest H`, `state text IN ('CANDIDATE','VERIFIED','DISABLED')`, `repository_revision R`, `created_at T`, `updated_at T`. No endpoint, key or secret. Maintenance-only insert/update; VERIFIED does not enable business access. |
| `resource_slots` | `slot_id U`, `activity_id U NOT NULL`, `deployment_id U` FK registry, `owner_membership_id U` composite FK Membership, `state IN ('ENABLED','SUSPENDED','TRANSFERRING','RETIRED')`, `last_generation bigint CHECK>=0`, `active_generation_id U NULL`, `repository_revision R`, `created_at T`, `updated_at T`, `retired_at T NULL`. UNIQUE `(tenant_id,activity_id,deployment_id)` and `(tenant_id,slot_id,deployment_id)`. New slot SUSPENDED/last_generation=0/pointer=NULL/revision=1. RETIRED iff retired_at nonnull, pointer NULL; ENABLED requires pointer nonnull. activity/tenant/deployment/slot immutable. |
| `resource_generations` | `generation_id U`, `slot_id U`, `deployment_id U`, `generation R`, `owner_membership_id U` composite FK Membership, `owner_handle text` exactly 43 base64url chars from 32 CSPRNG bytes, `stage_ref O`, `content_digest H`, `dsl_version text CHECK='0.11.2'`, `state IN ('PENDING','ACTIVE','ORPHAN','RETIRED')`, `repository_revision R`, `created_at T`, `updated_at T`, `activated_at T NULL`, `terminal_at T NULL`. Composite FK `(tenant_id,slot_id,deployment_id)` to slot; UNIQUE `(tenant_id,slot_id,generation)`, `(tenant_id,slot_id,generation_id)`, `(deployment_id,stage_ref)`, `(deployment_id,owner_handle)`. PENDING has null activation/terminal; ACTIVE nonnull activation/null terminal; RETIRED nonnull activation/terminal; ORPHAN nonnull terminal, activation either retained or null. All references/digests/content identity immutable. |
| `scene_bindings` | `scene_binding_id U`, `generation_id U` composite FK generation, `scene_ref O`, `scene_ordinal bigint CHECK 0..63`, `scene_digest H`, `created_at T`. UNIQUE `(tenant_id,generation_id,scene_ref)` and `(tenant_id,generation_id,scene_ordinal)`; also UNIQUE `(tenant_id,generation_id,scene_binding_id)` for assets. Immutable. Maximum 64 scenes per candidate; each projection keeps B9-S07's 32-element ceiling. No new Classroom execution is admitted by multiple stored scenes. |

Slot pointer FK `(tenant_id,slot_id,active_generation_id)` → generation `(tenant_id,slot_id,generation_id)` is DEFERRABLE INITIALLY DEFERRED to permit one atomic replacement. Generations additionally expose UNIQUE `(tenant_id,generation_id)` for child FKs. A partial UNIQUE `(tenant_id,slot_id) WHERE state='ACTIVE'` ensures one active generation. No immediate partial uniqueness violation is bypassed: terminalize old ACTIVE, insert/transition new ACTIVE, then CAS switch pointer in the same transaction; any later failure rolls back all three.

Deferred `mapping_consistency()` checks the affected slot at COMMIT: enabled pointer resolves to its ACTIVE generation; every ACTIVE has that slot's pointer; the current ACTIVE generation's owner matches the slot owner and all generations match the slot's deployment/tenant; COALESCE(max generation,0)=last_generation; terminal slot has no active generation; referenced scenes/assets are complete for activation. Tenant/user restore does not run resume. Owner change requires old state TRANSFERRING plus a fresh new generation owned by the new same-tenant Membership; old generations retain their own historical owner FK and are not required to match the slot's new owner.

`mapping_history_guard()` enforces PENDING→ACTIVE/ORPHAN and ACTIVE→RETIRED/ORPHAN only, no terminal UPDATE/DELETE, immutable reference/digest columns, timestamp shapes and exact revision increments. `slot_cas_guard()` requires mutation revision=OLD+1 and monotonic last_generation (reservation +1; pointer/lifecycle change +0), rejects max-int8 mutation, prevents tenant/activity/deployment rewrite and terminal revival. A true no-op is decided after stale comparison and issues no UPDATE. Preparation inserts immutable scene/reference records while their generation is PENDING; later changes require a new generation. Integrity failure denies immediately even if quarantine persistence fails.

No Activity table name is invented in this supplement. Its required physical FK is an explicit future opening dependency, with current inserts blocked by B9-P01; absence is never treated as a valid relationship. No cross-DB FK or provider manifest revision substitutes for local CAS.

## B9-P03 — Assets, operation ledger, audit and future Runtime fence

| Table | Columns and exact constraints |
| --- | --- |
| `asset_bindings` | `asset_binding_id U`, `generation_id U`, `scene_binding_id U`, `deployment_id U`, `principal_handle` same 43-char CSPRNG format, `asset_ref O`, `purpose IN ('IMAGE','AUDIO','VIDEO','POSTER','BACKGROUND')`, `mime IN ('image/png','audio/wav','video/webm')`, `byte_length bigint CHECK 1..4194304`, `byte_digest H`, `provider_revision bigint CHECK>=1`, `created_at T`. Composite FK `(tenant_id,generation_id,scene_binding_id)` to scene; deployment/generation consistency checked deferred. UNIQUE `(tenant_id,generation_id,scene_binding_id,purpose,asset_ref)` and global UNIQUE `(deployment_id,asset_ref)`. An Asset ID has exactly one binding, including across tenants/principals; a query-only deferred check is not its uniqueness mechanism. Immutable, added only to PENDING generations. |
| `operations` | `operation_id U`, `slot_id U` composite FK slot, `generation_id U NULL` composite FK generation, `actor_kind IN ('USER','SERVICE_RECONCILE')`, `actor_user_id U NULL` FK User, `actor_membership_id U NULL` composite FK Membership, `service_ref O NULL`, `operation IN ('PREPARE_CONTENT','PREPARE_ASSET','ACTIVATE_GENERATION','SUSPEND','RETIRE','TRANSFER','RECONCILE')`, `actor_key O`, `key_digest H`, `intent_digest H`, `expected_slot_revision R`, `reserved_slot_revision R`, `expected_authorization_version bigint CHECK 0..9007199254740991 NULL`, `state IN ('RESERVED','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')`, `repository_revision R`, `reserved_stage_ref O NULL`, `result_asset_ref O NULL`, `result_generation_id U NULL`, `result_slot_revision R NULL`, `created_at T`, `updated_at T`, `dispatch_started_at T NULL`, `completed_at T NULL`, `reason IN ('NONE','DENIED','STALE','INVALID_CONTENT','STORAGE_FAILURE','UNKNOWN_OUTCOME','INTEGRITY_FAILURE')`. USER requires both actor IDs/version and no service_ref; server actor_key=`user:<canonical UserId>`. SERVICE_RECONCILE requires only service_ref/actor_key=`service:<service_ref>` and operation=RECONCILE. UNIQUE `(tenant_id,actor_key,slot_id,operation,key_digest)`. Intent/actor/expected/reserved values immutable. Result generation must belong to the same slot. |
| `audit_events` | `event_id U`, `slot_id U` composite FK slot, `operation_id U` composite FK operation, `event_type IN ('GENERATION_RESERVED','GENERATION_PREPARED','GENERATION_ACTIVATED','MAPPING_SUSPENDED','MAPPING_RETIRED','TRANSFER_STARTED','TRANSFER_COMPLETED','OPERATION_FAILED','OUTCOME_QUARANTINED','OUTCOME_RECONCILED')`, `actor_kind`, `actor_user_id U NULL`, `actor_membership_id U NULL`, `service_ref O NULL` with the same closed actor shape, `request_id O`, `slot_revision_before R NULL` (null only first reservation), `slot_revision_after R`, `occurred_at T`, `reason` same closed set as operations. No event_payload JSON, arbitrary string event, token/digest/verifier, provider options, native cause or full content. Immutable; same client/transaction as its local effect. |

Asset MIME/purpose combinations are closed: IMAGE/POSTER/BACKGROUND→PNG, AUDIO→WAV, VIDEO→WebM. Registered aggregate logical bytes per candidate <=33554432 (duplicates conservatively count per binding); max 32 asset bindings per scene, max 64 scenes. Deferred consistency verifies the complete projected reference set before activation and that principal=that generation's owner_handle. Repeated content across scenes/purposes/generations uses a fresh Asset ID per binding through public `put`, which allocates a new ID; native bytes may still deduplicate physically. Reusing one Asset ID in several binding rows is outside this initial subset and requires a separately reviewed normalized ownership/link schema. The global unique index arbitrates concurrent claims without a cross-tenant RLS visibility exception; its errors are sanitized, not used as an asset-existence lookup. Native blob deduplication grants no cross-principal read or deletion right. Native Asset IDs are accepted through the public contract; no private `ast_` validator is copied.

A prepare result attaches only to its reserved PENDING candidate. Reservation advances the locked slot revision exactly once; `expected_slot_revision` retains the command's pre-reservation value and `reserved_slot_revision` records its exact committed +1 value. Dispatch compares the latter, not the stale pre-reservation token. A new slot is first inserted SUSPENDED at revision=1 in the same transaction before reservation advances it to 2; competing slot inserts conflict on the permanent unique anchor. A new content generation advances last_generation by one; preparing an asset on that generation advances slot revision without allocating another content generation.

`operation_history_guard()` freezes completed SUCCEEDED/FAILED rows; RESERVED→SUCCEEDED/FAILED/OUTCOME_UNKNOWN; OUTCOME_UNKNOWN→SUCCEEDED/FAILED only after proved reconciliation. RESERVED/OUTCOME_UNKNOWN have completed_at NULL; SUCCEEDED/FAILED have completed_at within created_at..updated_at. Reasons and nullable results match operation/outcome (no opaque arbitrary result JSON); reserved StageRef is present only for operations that allocate a content generation. `dispatch_started_at` is set/committed before any external call. Expiry/crash never turns a dispatched unresolved operation into a fresh dispatch. Marking FAILED does not assert remote absence; its candidate must remain denied until exact cleanup/outcome treatment is decided. Same-key/same-intent completed replay checks current authority/stale versions before returning a closed result. Different intent, RESERVED or unknown outcome never dispatches twice. Deferred consistency verifies actor User matches its Membership and audit actor/slot/operation/result revisions match the actual local effect; no new UNIQUE/index modification on old Identity tables is needed.

SERVICE_RECONCILE is a reserved shape, **closed in the current production factory and database business gate**. No worker login, global scan or operator API is added by 1B-9B. Human-authorized exact reconciliation can be tested with synthetic server actors. Any real worker later requires its own restricted manifest/ACL approval and cannot activate business content.

Runtime and launch registries are **not created by 0012**. 1B-9C's required Runtime blueprint is `(tenant_id,runtime_binding_id U,slot_id,generation_id,attempt_id U NOT NULL,learner_membership_id U NOT NULL,runtime_ref O,learner_handle[43],kind,status,repository_revision R,outstanding_operation_id U NULL,expected_last_seq bigint NULL,created_at T,updated_at T)`, with actual Attempt and same-tenant learner/generation FKs. An exclusive pre-dispatch fence requires unique outstanding operation per binding, local atomic reservation+binding revision increment, and reads/writes deny while outstanding. Exact dispatcher/reconciliation alone inspect it; successful local audit/ledger/binding completion clears it atomically. Leases/crashes never clear it. No Attempt table or dummy binding is introduced here. Future Runtime schema/ACL approval must concretize kinds/payloads and this fence before any append BUILD/opening.

## B9-P04 — Exact RLS / table / function privilege boundary

All six tenant tables (`resource_slots`, `resource_generations`, `scene_bindings`, `asset_bindings`, `operations`, `audit_events`) ENABLE and FORCE RLS. Separate SELECT/INSERT/UPDATE policies for `zhiban_bridge_runtime` and owner use `tenant_id=zhiban_identity.current_tenant_id()` with the same tenant WITH CHECK. Missing/empty/invalid GUC returns no rows and denies writes. The independent business gate trigger is mandatory on every INSERT/UPDATE, not just an application check. There is no DELETE policy or grant. Global deployment registry is maintenance metadata, has no tenant RLS, and no runtime mutation grant.

Schema/table/function privileges start with explicit REVOKE from PUBLIC, `zhiban_runtime`, `zhiban_auth_runtime`, `zhiban_control_runtime` and the new runtime, then only the following grants. Global default PUBLIC function EXECUTE is already revoked for the Identity owner; explicit revokes still apply. No sequences, TRUNCATE, REFERENCES, TRIGGER, schema CREATE, grant option or ALL privilege.

| Object | `zhiban_bridge_runtime` exact grants |
| --- | --- |
| `zhiban_bridge` / `zhiban_identity` schemas | USAGE only |
| `deployment_registry` | SELECT on all listed non-secret metadata columns; no INSERT/UPDATE/DELETE |
| `resource_slots` | SELECT, INSERT; UPDATE `(owner_membership_id,state,last_generation,active_generation_id,repository_revision,updated_at,retired_at)` |
| `resource_generations` | SELECT, INSERT; UPDATE `(state,repository_revision,updated_at,activated_at,terminal_at)` |
| `scene_bindings`, `asset_bindings` | SELECT, INSERT only |
| `operations` | SELECT, INSERT; UPDATE `(state,repository_revision,updated_at,dispatch_started_at,completed_at,reason,result_asset_ref,result_generation_id,result_slot_revision)`; immutable reserved/expected revision fields have no UPDATE grant |
| `audit_events` | SELECT, INSERT only (read is Infrastructure-only, never an API audit feed) |
| Existing utility functions | EXECUTE only `zhiban_identity.current_tenant_id()` and `zhiban_identity.is_uuid_v7(uuid)`; bodies/old ACL recipients unchanged |
| New caller functions | EXECUTE only `zhiban_identity.bridge_identity_context(uuid,text,uuid,uuid,uuid[])` and `zhiban_bridge.business_resource_ready(uuid,uuid)` |
| Any Identity table/sequence or other Identity function | NONE, including old session guards, global/control helpers, credentials/verifiers/token_digest |
| New trigger functions | No runtime/PUBLIC direct EXECUTE; triggers perform only their declared closed checks |

Infrastructure-only mapping SELECT includes opaque principal/references needed by the server; no ordinary Application DTO/barrel exports them. RLS scopes this trusted persistence role, while the Application still performs current business authorization. TenantContext does not become an authorization proof. Owner policy supports exact guard/consistency queries without FORCE RLS bypass or global `USING(true)`.

Two additive lock-only policies on existing Identity tables are part of this **explicit approval request**, because PG16 applies UPDATE policies to SELECT FOR SHARE/UPDATE ([official CREATE POLICY contract](https://www.postgresql.org/docs/16/sql-createpolicy.html)). They do not modify old policy bodies:

```sql
CREATE POLICY memberships_bridge_owner_lock
ON zhiban_identity.memberships FOR UPDATE TO zhiban_identity_owner
USING (session_user='zhiban_bridge_runtime'
       AND tenant_id=zhiban_identity.current_tenant_id())
WITH CHECK (false);

CREATE POLICY grants_bridge_owner_lock
ON zhiban_identity.role_grants FOR UPDATE TO zhiban_identity_owner
USING (session_user='zhiban_bridge_runtime'
       AND tenant_id=zhiban_identity.current_tenant_id())
WITH CHECK (false);
```

Existing owner SELECT policies provide the matching tenant read; this new USING permits the exact helper's row locks, while WITH CHECK false denies actual row updates under the Bridge caller. Existing onboarding UPDATE policies require the control caller and therefore do not provide a permissive alternative for the Bridge caller. No table privilege is granted to Bridge, no INSERT/DELETE policy is added, and unrelated owner/runtime operations do not match the session_user predicate. PG16 tests must prove helper locks succeed, owner-mediated Bridge-caller UPDATE rejects, and old control/onboarding paths remain unchanged.

New trigger signatures (all zero-argument RETURNS trigger): `zhiban_bridge.resource_gate_guard()`, `slot_cas_guard()`, `mapping_history_guard()`, `mapping_consistency()`, `operation_history_guard()`, `audit_immutability_guard()`. INVOKER except `mapping_consistency`, which may be DEFINER owned by Identity owner to read the affected tenant's complete set under FORCE RLS. That exception must verify affected row tenant matches current_tenant_id, fixed search_path and row_security=on; no result projection, dynamic SQL or native-store access. Constraint triggers are DEFERRABLE INITIALLY DEFERRED and return NULL; before-row guards return NEW or reject. Deletion is rejected for all tenant records, including terminal history. `mapping_history_guard` also guards immutable scene/asset rows; column ACL alone is not the owner-mediated history guard.

Projected count/byte/PENDING-state checks cannot be unlocked query-only assertions. Once a future business gate allows DML, `resource_gate_guard` requires READ COMMITTED and serializes child mutations on their exact slot FOR UPDATE, then generation as needed, before accepting INSERT/UPDATE; deferred consistency runs with that anchor held and fresh queries. The admitted repository already takes those locks in B9-P05 order. Parallel child writes cannot jointly exceed a budget or insert into a generation after activation. Direct owner/runtime SQL and mixed activation/child-insert races must be tested too; a deadlock/storage error rejects, never retries into success.

Gate function has search_path=`pg_catalog,zhiban_bridge,zhiban_identity,pg_temp`; INVOKER trigger functions likewise. No additional helper, role inheritance or RLS exception may be added during BUILD without being reported for review.

## B9-P05 — Exact identity helper and compatible lock order

New limited exception:

```sql
zhiban_identity.bridge_identity_context(
  p_tenant_id uuid,
  p_digest text,
  p_expected_user_id uuid,
  p_actor_membership_id uuid,
  p_related_membership_ids uuid[]
)
RETURNS TABLE (
  membership_id uuid, user_id uuid, user_status text, user_revision bigint,
  membership_status text, membership_revision bigint,
  authorization_version bigint, tenant_revision bigint,
  security_epoch bigint, absolute_expires_at bigint, idle_expires_at bigint,
  evaluated_at bigint, effective_grants jsonb
)
```

PL/pgSQL VOLATILE PARALLEL UNSAFE SECURITY DEFINER; owner `zhiban_identity_owner`; search_path=`pg_catalog,zhiban_identity,pg_temp`, row_security=on. REVOKE ALL from PUBLIC/all existing runtimes; EXECUTE only new Bridge role. It contains no business DML and returns no Session ID/token/digest/verifier or other-tenant facts. `effective_grants` is a closed typed security array, not arbitrary JSON/audit; it contains only grant ID, role code, scope kind/id, valid_from, valid_until, for the actor's currently effective grants, bounded to 64 (65 means reject). Each grant/membership/global persisted shape is validated before policy consumption; known corrupt data is not hidden through omission. Related-member rows return an empty grants array.

Validate session_user **exactly** `zhiban_bridge_runtime`, tenant equals transaction-local current_tenant_id, UUIDv7 inputs, digest exactly 64 lowercase hex, related IDs distinct/non-null <=2, all named memberships in that tenant and actor's user matches expected User. Foreign/missing/forged context is one generic `42501 / Bridge context rejected`; no interpolated input. A small unlocked lookup may discover immutable Membership→User IDs and Session locator; it confers no authority and is fully rechecked under locks.

Acquire and hold in this exact order, without upgrades:

1. Tenant row **FOR SHARE**; require ACTIVE. This conflicts with frozen member/control paths' Tenant FOR UPDATE, preserving their serialization. Bridge never updates Tenant.
2. Complete deduplicated actor/related **User IDs sorted by canonical UUID text**, FOR SHARE; never discover another User after taking later locks. Recheck immutable member/user relationships. Project related states, require actor ACTIVE.
3. Actor's existing `pg_advisory_xact_lock_shared(hashtextextended('zhiban-session-user:' || canonicalUserId,0))`.
4. Actor Credential slot FOR SHARE, then exact Session row FOR SHARE. Check current active credential generation/slot integrity, current User revision and securityEpoch, Session binding/shape/not-revoked/absolute and idle expiry; same fail-closed checks as frozen 0008, no reduced guard.
5. Complete actor/related Membership IDs sorted, FOR SHARE. Read/validate actor effective grants and lock those grant rows FOR SHARE in grant-ID order. Non-active actor rejects; related status is a fact for the later real business policy, not an automatic authorization.
6. Future real business resource parent locks in documented order, then sorted Bridge slot rows (SHARE for bounded reads, UPDATE chosen initially for mutation), generation/operation rows. No later User/Tenant/Session/Membership lock can be added by the callback.

Return exactly one row per distinct requested Membership, actor plus up to two related, ordered by ID. Actor securityEpoch/expiry/fresh time are repeated consistently; duplicates/missing/malformed rows fail closed at the mapper. The JSON grants array is fresh current policy input, not a trusted permission snapshot to cache. Expected revisions/authVersion/resource revisions are compared by the Application after locks and again before publication; the helper does not invent teaching permissions.

Final validation in a transaction may revisit only the exact complete identity/related-member set already locked by that transaction. It must not discover or lock additional identities after resource/mapping locks; a changed participant set rejects and needs a separately initiated command, never an automatic retry or lock upgrade.

This order follows actual member commands (Tenant→complete sorted User locks→Session guard→Membership parents) and control commands (Tenant when relevant→sorted User locks→Session guard). Credential/logout-only paths do not acquire a Tenant later; their existing User/advisory/slot/Session conflicts finish or block before Bridge publication. Direct Membership repository saves conflict with the Membership SHARE row; grant updates are also row-locked. Real PG tests must verify those claims against each actual path, including recovery/revokeAll, not just the new helper.

No lock/upstream work with KDF or external AI. Set local lock_timeout=1000ms, statement_timeout<=5000ms and idle_in_transaction_session_timeout=10000ms on the Bridge transaction; total admitted operation <=10s, measured monotonically across connection waits/external calls. Time remains fresh after waits and at publication; expired time rejects even while locks are held. SQL 40001/40P01/55P03, abandoned connections and deadline expiry fail closed without retry. Stable receipt equality is checked before no-op/idempotent success.

## B9-P06 — Authentic handle collaborator and two-database protocol

Production composition additions are confined to `infrastructure/openmaic/**`, minimal Application Bridge ports/use cases, the new migration/bootstrap/provisioning files, tests and existing workflows. One explicit exception is a **minimal Infrastructure collaborator factory** on `IdentityAuthentication`, following its existing `membershipSecurity()` closure pattern: `bridgeSecurity()` passes a private `(handle)=>binding` resolver to a memoized `BridgeSessionSecurity` instance. The original #handles registry/binding method remain private. No frozen Application Session port, authentication behavior or DTO changes.

Infrastructure-only collaborator signature:

```ts
assertCurrent(
  client: BridgePgClient,
  handle: AuthenticatedRequestHandle,
  context: TenantContext,
  actorMembershipId: MembershipId,
  relatedMembershipIds: readonly MembershipId[],
): Promise<BridgeIdentityFacts>
```

It resolves authentic handles in the existing registry, passes only the server digest/User to B9-P05, validates the closed projection and returns safe state/revision facts. Raw binding/digest never leave the security instance or enter Application DTOs/errors/logs. A copied/prototype-forged handle, arbitrary UserId or structurally branded facts rejects. The new Bridge root receives the existing Identity Infrastructure root and a separate Bridge pool; it does not add a fourth pool field to the frozen Identity root config.

`BridgeResourceFactsPort` is a server-created composition dependency receiving the same bounded PG client and real resource locator. Current factory uses an explicit unavailable implementation that returns DENY, matching the SQL false gate. No default owner/self/admin permit. Future positive loader must lock real relationships/state in that client and return a composition-issued proof; caller booleans and TypeScript brands alone do not establish authority. Business action/catalog versions and delegate ceilings wait for the real resource design, without widening `identity-v1` validation.

Interactive command sequence:

1. Admit at most two operations per process with no queue; bound/validate content before locks. Authenticate through the existing Session boundary. Begin one Bridge-role READ COMMITTED transaction; set TenantContext and timeouts; call identity helper; acquire real resource and mapping/ledger locks; fresh policy/revision check. Bridge transaction pools have maximum two clients; permits precede pool acquisition so unbounded pool queues are not admission control. The deadline covers all steps, not a fresh ten seconds for each transaction/call.
2. Reserve unique operation/candidate IDs, scene/reference intention, CAS generation/slot and audit; commit checked COMMIT. In the current production gate this step rejects, not creates synthetic records.
3. Before external dispatch, reacquire the same ordered locks/authority and expected revisions. Commit dispatch_started_at **before** the call, so a crash cannot leave an apparently undispatched repeatable intent. Then a new guarded Bridge transaction locks that exact operation/slot, rechecks authority, and holds them across the bounded external call; pending candidate stays unreadable.
4. Use independent native-store client/transaction; validate returned objects/bytes and exact reserved IDs. Recheck clock, Session/authority, business revisions and content bindings before marking prepared/publishing. Local pointer/history/outcome/audit commit on the one Bridge client; validate command tags and rows. Native COMMIT plus failed local completion is denied/quarantined, not success.

A dispatcher claim additionally takes `pg_try_advisory_xact_lock(hashtextextended('zhiban-bridge-dispatch:' || operationId,0))` **after** mapping/operation locks; false means reject/pending, no wait/retry. The dispatch mark CAS requires state=RESERVED, dispatch_started_at IS NULL, expected operation revision and exact reserved_slot_revision; exactly one returned row and checked COMMIT are required. Once dispatch_started_at is committed, a later worker must never redispatch that intent even if it acquires the claim; it may only reconcile known results. The initiating dispatcher holds an unexported, process-issued one-use dispatch capability minted when the mark commits, bound to operation/intent/deadline. A lost mark/COMMIT acknowledgement yields UNKNOWN, no capability. Capability possession still requires fresh database checks, and is consumed before the external call, never reconstructed from a client request or ledger lookup. This closes both simultaneous dispatch and crash/restart replay.

`withTransaction` for native stores pins a fresh native connection per call, never reuses the Bridge connection. It validates COMMIT tag, rolls back/discards uncertain connections, releases in finally and emits only a closed sanitized Bridge error (no retryable `.code`/raw `.cause`). Native read calls also get a transaction hook and bounded queryable; no raw store/Pool is exposed to Application. Native writes cannot call back into new Identity/resource locks out of order; the guard was acquired before dispatch and final time checks run immediately before native COMMIT and local completion. An expiry/uncertain COMMIT can still leave external effects; local unpublished quarantine is the safety mechanism, not distributed rollback.

Prepared records are not API success for a publication command until its own checked local result is durable. Reconciliation uses exact recorded references, operation ID/digest and fresh authority; it cannot regenerate an Asset ID lost on timeout, search globally, repair native scalar columns or publish for a disappeared Session. If local UNKNOWN marking also fails, dispatched RESERVED/PENDING remains denied and cannot redispatch. Audit failure rolls back local transitions; it cannot undo a native transaction already committed. A known unpublished orphan and its bytes remain retained, with no automatic retry/collector or claim of absence; this bounded storage cost is an explicit outcome of the no-replay policy.

## B9-P07 — Pinned public storage schema and minimum native grants

Official reference/versions remain B9-S01. The dedicated private DB uses its locked `public` schema for the upstream **unqualified** public store queries, search_path=`pg_catalog,public,pg_temp`, no runtime schema CREATE/TEMP. Only maintenance owner can create objects; private DB CONNECT is revoked from PUBLIC and all Identity/Bridge runtimes. Only native migrator/runtime connect. Endpoint, role and database checks prevent Identity/native connection mixups. No native routes or server actions are mounted; the browser cannot access DB or byte origins.

Apply public asset/document provisioning once through maintenance, then exact REVOKE/GRANT in the same transaction. No ALTER of upstream tables/functions for tenant or business fields. Public store calls are a narrowly retained method set, not a exported generic store (`saveDocument` only new pending StageRef, exact load/get/manifest, asset put/identify/resolve). Native private SQL is not used by the Bridge to guard reads or repair resources; SQL inspection below defines ACL requirements only.

| Native table | `zhiban_openmaic_runtime` exact operations/columns |
| --- | --- |
| `document_stages` | SELECT, INSERT; UPDATE `(name,description,interactive_mode,task_engine_mode,created_at,updated_at,data)` for public save UPSERT. No owner_id/id/folder_id UPDATE, DELETE or TRUNCATE. Bridge does not dispatch save for existing published StageRefs. |
| `document_scenes` | SELECT, INSERT; UPDATE `(scene_order,data)`; DELETE required by public authoritative save's absent-scene branch, retained only inside admitted pending generation save. No standalone scene delete capability. |
| `document_outlines` | SELECT, INSERT; UPDATE `(data)`; DELETE (public save executes its no-outline branch even when empty). Current content gate does not admit outlines. |
| `document_stage_revision`, `document_scene_revision` | SELECT, INSERT; UPDATE `(rev)` for unchanged INVOKER revision triggers. No deletion/reset; native signals are not Zhiban CAS. |
| `asset_blobs` | SELECT, INSERT; UPDATE `(byte_size,bytes,unreferenced_at)` for public coordinated byte write and put UPSERT. No DELETE/collector dispatch. Clearing bytes remains an unexposed method, not a public Bridge operation. |
| `asset_entries` | SELECT, INSERT; UPDATE `(committed_at,expires_at,unreferenced_at)` for public document tracking. No principal/id/content_hash/mime/meta/revision/created_at UPDATE, DELETE or replace API. |
| `document_asset_refs` | SELECT, INSERT, DELETE for unchanged public document tracking; no direct bridge API or copied internal helper. |
| `asset_reference_tracking` | SELECT, INSERT for public reference tracking marker; no UPDATE/DELETE |
| `document_asset_withdrawals` | SELECT `(stage_id)`, DELETE only: public reference-tracking save unconditionally clears that Stage's withdrawal marker, including when no row exists. No INSERT/UPDATE or withdrawal API is admitted. |
| `document_folders` | No grant; folder methods closed. If an admitted public method actually requires an additional privilege, STOP/report the precise contract rather than grant ALL. |
| Runtime/Agent/Skill/Material tables/functions | No provisioning or grants in 1B-9B |

There are no package sequences in this chosen subset. Revoke PUBLIC direct EXECUTE on the two provisioned trigger functions `openmaic_bump_scene_revision()` / `openmaic_bump_stage_revision()` and grant no direct runtime EXECUTE; actual trigger DML behavior must be verified on PG16. Do not rewrite upstream function bodies/security modes. Qualified trusted connection search_path and no runtime/temp object creation avoid shadowing their unqualified references. Public package schema is not claimed tenant-RLS protected; the trusted isolated service credential and current Zhiban gateway enforce resource access. Existing tenant/control/auth roles cannot connect/read it.

Use `PgDocumentStore(...,{ownerId:serverOwnerHandle,trackAssetReferences:true,withTransaction})`, `PgAssetStore(...,{byteStore:new PgAssetByteStore(nativeQueryable),quotaBytes:33554432,withTransaction})`. Never leave ownerId/principal implicit or use shared principal. Public byte reads remain within AssetStore exact principal/ID resolve. References are tracked by public document save, without importing `asset/references` internals. No collector, native asset replace, folder/list/global mutation is exposed. Same content hash can be deduplicated physically; MIME/signature/byte length/digest and current mapped purpose still validate on every resolve before delivery.

Gateway preserves the B9-S07 subset/budgets, cookie/CSRF/origin and no-store requirements. Deliver at most 64 KiB per freshly authorized chunk with backpressure and bounded buffers, authorize HEAD/range/conditional paths before response construction, and stop on current denial. Outstanding bytes are bounded but cannot be withdrawn retroactively. Native store errors/IDs/request payloads are sanitized before public responses/logs/audit; SQL parameter logging for digest/content is disabled. Media/body parsing cannot silently bypass pre-allocation length limits.

## B9-P08 — BUILD files and verification acceptance

Expected BUILD groups (actual exact checkpoint file list is established after implementation):

- `lib/zhiban/application/openmaic/**`: closed resource/mapping/operation ports, guarded commands/queries and unavailable business facts loader contract; no current Course/Attempt domain.
- `lib/zhiban/infrastructure/openmaic/**`: Bridge root, security collaborator, mapping mappers/repositories, public storage adapter/hook, explicit native provisioning command, closed preview/gateway transport helpers. Add at most the approved `bridgeSecurity()` collaborator to `infrastructure/identity/composition/authentication.ts`; frozen public authentication contracts/state remain unchanged.
- `infrastructure/identity/postgres/migrations/0012_openmaic_bridge_foundation.sql` plus additive Bridge role bootstrap; old 0001–0011 and old role bootstrap unchanged. A private native provisioning receipt is separate from the Identity ledger.
- `tests/zhiban/bridge/**` and `tests/zhiban/identity/postgres/pg16-bridge.test.ts`; extend existing Identity PG16 workflow for helper/lock/RLS/migration tests and existing Storage PostgreSQL Contract workflow for fresh public native-schema/runtime-role/browser proof. Preserve prior required suites and two-pass signoff; no second workflow, reduced assertion or removed diagnostic coverage.

Tests during BUILD:

| Group | Required evidence |
| --- | --- |
| Current production closure | Empty 0012 applies; missing real Activity FK/catalog/loader means all resource DML/use cases deny, no fake records; VERIFIED deployment alone does not open. No launch/Runtime/AI execution. |
| Migration/roles | Real PG16 apply, repeat CLI NO-OP, checksum 0001–0011 unchanged, rollback/ledger/advisory lock; exact tables/functions/indexes, complete graph/attributes, PUBLIC/table/column/function/sequence denial. |
| RLS/context/helper | Missing/invalid/foreign Tenant GUC; authentic Session actor and related-members limits; malformed/disabled/expired/revoked/epoch mismatch; no digest/verifier projection; existing roles denied new helper; copied handles reject. |
| Mapping/ledger/audit | Pointer/ACTIVE commit consistency, terminal immutability, generation monotonicity, stale-before-no-op/max revision, owner transfer, exact same-tenant FKs, concurrent cross-tenant Asset ID claims (one success), parallel child-budget/activation races, idempotent conflict/no redispatch, audit rollback, uncertain commit/crash denied, byte aggregate/input limits. |
| Independent-connection races | Credential replace/revoke, logout/revokeAll, User disable/restore, Tenant disable, role revoke/member disable/save versus helper/external-call/local completion. Use acknowledged locks/barriers, verify new lock order and fresh time after waits; storage failure/deadlock/40001 reject and all clients release. |
| Native ACL/provider | Invoke actual pinned public save/asset put/read/manifest through the restricted native role; trigger and reference bookkeeping succeed; unneeded methods/privileges denied. No old diagnostic superuser credentials substitute for this proof. |
| Delivery/isolated browser | Closed text/PNG/WAV/WebM projections, wrong IDs/principal/bytes/digests/URLs, HEAD/range/cache, revoke between chunks, backpressure/deadline/admission, direct-native route/byte/database/network denial on actual host. Real deployed D01 isolation still needs 1B-10/OPS proof. |

Positive mapping tests may install **test-only** business schema/FKs and a trusted synthetic catalog/loader in the explicitly disposable test DB, replacing the false gate there through maintenance. Test startup verifies disposable allowlist, and teardown removes those resources. No production environment flag, fixture module, runtime `SET ROLE`, bypass grant or admin seed can activate the shipped factory. Reports distinguish synthetic future-business contract tests from genuine production relationship/integration proof. 0012 rollback/apply/closed-gate tests always run against its unmodified shipped form.

Iterate with targeted tests and affected static contracts. Signoff then runs required affected Identity/security regression, two complete real PG16 passes, fixed public fresh artifacts on Node22/Linux, root lint and typecheck, frozen install and diff checks. Prior diagnostic PASS can be cited for unchanged capability evidence; restricted native ACL/current Identity composition and new races need new execution. Runtime retry/fence/scalar-integrity tests are 1B-9C prerequisites and stay tracked rather than falsely claimed by document/asset tests. If local PG16 is absent, do not install/use PG18 as a substitute; report pending candidate CI.

No schema/role/lock conflict requiring a frozen contract rewrite was found in this design: new role/helper and the two explicitly requested lock-only RLS policies can be additive, while the unavailable business gate keeps unfinished domain relationships closed. Self-review also closed reservation-versus-dispatch revision ambiguity and included the withdrawal DELETE needed by public save. Approval review replaced query-only cross-tenant asset ownership checking with a global unique index and fresh public Asset ID per binding; it clarified historical versus current owner matching, fixed-participant final revalidation and database serialization of child-budget/activation checks. Proposed SQL has not been parsed/applied or tested; this document does not claim that its future implementation or the new race proofs PASS.

## Approval record

Review used the approved 1B-9A/ADR-012 boundary, actual Identity role/RLS/helper/transaction composition and pinned public Document/Asset storage paths. The changes above tighten the proposed supplement before freeze; no frozen Identity semantics, upstream implementation or applied migration changed. Eight contracts are approved as the exact basis for a separately authorized BUILD:

| Contract | Review / decision |
| --- | --- |
| B9-P01 | APPROVED — additive 0012/bootstraps, distinct private database and explicit public provisioning; business gate remains FALSE. Real OPS resources are not authorized here. |
| B9-P02 | APPROVED — seven-table foundation, CAS anchors, immutable generations and atomic pointer consistency; actual Activity FKs/facts/catalog required before opening. |
| B9-P03 | APPROVED — global unique Asset ID claim, closed ledger/audit, durable dispatch mark and quarantine; Runtime schema/fence implementation remains 1B-9C. |
| B9-P04 | APPROVED — FORCE tenant RLS, exact column grants and the two named owner lock-only policies; no direct Identity table grant, mutation capability or secret projection. |
| B9-P05 | APPROVED — exact new DEFINER helper, bounded projection and complete ordered identity locks; no new participants or lock upgrades during final validation. |
| B9-P06 | APPROVED — authentic-handle collaborator, one local transaction client and separate native transaction; no replay or distributed rollback claim. |
| B9-P07 | APPROVED — pinned public storage provisioning and enumerated native privileges, including withdrawal-marker SELECT/DELETE; unlisted methods/capabilities stay closed. |
| B9-P08 | APPROVED — additive existing workflow coverage, real restricted-role/independent-connection proof and explicitly disposable synthetic tests; no production fixture switch. |

Approval includes only the named new roles/schema/functions, exact additive utility EXECUTE grants, two lock-only RLS policies and minimal private `bridgeSecurity()` collaborator exception. An extra grant/helper, native method, business opening or frozen-contract change requires separate review. No unresolved design P0/P1 remains after review; implementation/parser/ACL/race/root-tooling gates are still pending and are not waived or reported as executed PASS. No BUILD, provisioning, commit, push or CI dispatch is authorized by this approval record.

## Reviewable decisions and next step

B9-P01: APPEND_0012_AND_ADDITIVE_BOOTSTRAP / PRIVATE_PG_BYTE_BACKEND / BUSINESS_GATE_FALSE

B9-P02: SEVEN_TABLE_FOUNDATION / EXACT_MAPPING_INVARIANTS / REAL_ACTIVITY_FK_REQUIRED_TO_OPEN

B9-P03: CLOSED_ASSET_LEDGER_AUDIT / DISPATCH_MARK_AND_UNKNOWN_OUTCOME / RUNTIME_SCHEMA_DEFERRED_TO_9C

B9-P04: FORCE_TENANT_RLS / EXACT_COLUMN_GRANTS / NO_IDENTITY_TABLE_SECRET_ACCESS

B9-P05: NEW_NARROW_IDENTITY_CONTEXT / TENANT_USER_SESSION_MEMBERSHIP_RESOURCE_LOCK_ORDER

B9-P06: PRIVATE_HANDLE_COLLABORATOR / ONE_ZHIBAN_CLIENT_AND_SEPARATE_NATIVE_TRANSACTION

B9-P07: PUBLIC_DOCUMENT_ASSET_PG_PROVISIONING / RESTRICTED_NATIVE_ROLE / CLOSED_GATEWAY

B9-P08: ADDITIVE_EXISTING_WORKFLOW_TESTS / REAL_ROLE_AND_RACE_PROOF / NO_PRODUCTION_FIXTURES

PHASE_1B9B_SUPPLEMENT: DESIGN_COMPLETE

APPROVAL: APPROVED_B9_P01_P08

DESIGN_BOUNDARY: FROZEN_SUPPLEMENT

REVIEW_VERDICT: PASS_WITH_EXPLICIT_DOWNSTREAM_GATES

P0: 0

P1: 0

P2: 0

FROZEN_IDENTITY_CONTRACT_CONFLICT: NO

BUSINESS_OPENING: CLOSED_UNTIL_REAL_SCHEMA_FACTS_AND_POLICY

RUNTIME_AND_LAUNCH_BUILD_AUTHORIZED: NO

BUILD_AUTHORIZED_THIS_TASK: NO

MIGRATIONS_CREATED_THIS_TASK: NONE

FILES_CHANGED_THIS_TASK: ONE_DOCUMENT

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO

NEXT: Separately authorize the single-document checkpoint with independent remote HEAD/message/parent verification (**GPT-6 Sol / Low**). Then separately authorize **1B-9B BUILD** (**GPT-6.1 Sol / High**) against these approved/checkpointed contracts; production business access stays closed until the stated opening gates pass.
