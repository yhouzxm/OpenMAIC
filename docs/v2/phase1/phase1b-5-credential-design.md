# Phase 1B-5A Credential Design and Security Boundary

Status: CREDENTIAL_DESIGN FROZEN — design only, pending independent review/checkpoint.

Date: 2026-10-02. Branch: `refactor/zhiban-v2`. Base HEAD: `d0630065e41af447ae518fd976b35f113d8335f6`.

READY_FOR_1B5B_SCHEMA: YES, for a separately authorized supplementary schema/contract review; not permission to write/run migrations, enable login, implement Session, or deploy. This round changes only this document. No production, test, package, workflow, schema, or existing Port changes; no commit/push.

## 1. Authority and current assets

Read authorities: [ADR-007](../adr/ADR-007-identity-model.md), [ADR-008](../adr/ADR-008-tenant-model.md), [ADR-009](../adr/ADR-009-rbac-policy.md), [ADR-010](../adr/ADR-010-authentication-session.md), [ADR-011](../adr/ADR-011-tenant-isolation.md), [Identity design](identity-domain.md), [auth boundary](auth-boundary.md), [session strategy](session-strategy.md), [migration plan](identity-migration-plan.md), [V1 read-only audit](v1-identity-audit.md), [threat model](identity-threat-model.md), [implementation plan](phase1b-implementation-plan.md), [1B-1 review](phase1b-1-review.md), [1B-2 review](phase1b-2-review.md), [schema review](schema-review.md), [3B implementation review](phase1b-3b-1-review.md), [4A design](phase1b-4a-repository-design.md), and [1B-4 closeout](phase1b-4-review.md).

Implementation evidence: [User and authenticity assertion](../../../lib/zhiban/domain/identity/user.ts), [Domain barrel](../../../lib/zhiban/domain/identity/index.ts), [CredentialVerifierPort](../../../lib/zhiban/application/identity/ports/credential-verifier.ts), [SessionRepositoryPort](../../../lib/zhiban/application/identity/ports/session-repository.ts), [AuditPort/event factory](../../../lib/zhiban/application/identity/ports/audit.ts), [errors](../../../lib/zhiban/application/identity/ports/errors.ts), [revision/Loaded](../../../lib/zhiban/application/identity/ports/repository-types.ts), [ID generator](../../../lib/zhiban/application/identity/ports/id-generator.ts), [Fakes](../../../tests/zhiban/identity/contracts/fakes.ts), [external contracts](../../../tests/zhiban/identity/contracts/external-ports.test.ts), [role bootstrap](../../../lib/zhiban/infrastructure/identity/postgres/bootstrap-roles.pg16.sql), [core migration](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0002_identity_core.sql), [audit/RLS/ACL migration](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0003_identity_audit_and_rls.sql), and [transaction primitives](../../../lib/zhiban/infrastructure/identity/postgres/transactions.ts).

| Asset | Current status | Actual finding |
| --- | --- | --- |
| DOMAIN TYPES | ABSENT for Credential; EXISTS for User | User is global, ACTIVE/DISABLED, has no password, hash, identifier, or credential version; Credential is not in the Domain barrel. |
| PORTS | PARTIAL | CredentialVerifierPort accepts opaque `identifier: string`, `secret: string`; returns only VERIFIED(UserId) or REJECTED. No hashing, CRUD, identifier normalization or Credential repository contract exists. |
| FAKES | PARTIAL | FakeCredentialVerifier uses synthetic `known`/secret equality; proves uniform result shape only, not crypto, timing, storage, or User lifecycle. |
| SCHEMA / TABLES | DEFERRED / ABSENT for credentials | 3A-D01 and schema review §5.6 explicitly exclude credentials from 3B. Actual migrations contain no credential table/column. User/Session tables exist independently. |
| AUDIT EVENTS | PARTIAL | AUTHENTICATION_REJECTED and SESSION_REVOKED exist in the closed 18-event union/schema. Credential-created/replaced/revoked/rehash events do not exist. CREDENTIAL_REJECTED is a reason, not a mutation event. |
| SESSION DEPENDENCIES | EXISTS contract / DEFERRED service | Global SessionRecord, digest lookup, touch, revoke and revokeAllForUser contracts/schema exist; SessionId ownership remains 1B2-F07 → 1B-6. No credential epoch binding exists. |
| AUTH DEPENDENCIES | PARTIAL / DEFERRED | Authentication/tenancy/authorization split is frozen; production Credential provider, login API and identifier resolver are absent. Membership authVersion is tenant authorization state only. |
| DB ROLE CAPACITY | EXISTS role / DEFERRED grants | zhiban_auth_runtime already owns the authentication responsibility; 3B deliberately reserves Credential ACL to 1B-5. It currently has no Credential grant because no table exists. |

V1 evidence is reference, not a dependency or data import: Argon2id was identified in V1 code, including historical parameters/encoded version and dummy verification; phone/login lookup and tenant-bound accounts must not be copied into the global V2 model. No production hash/data is read. 3B's exclusion is an intentional design gap to complete here, not an ADR conflict.

## 2. Ownership, type scope and identifier

CREDENTIAL OWNERSHIP: GLOBAL USER. TYPE SCOPE: PASSWORD ONLY.

One global User has one password slot and at most one active password generation. Credentials are neither Membership children nor tenant-owned records. Switching tenant neither copies a password nor selects another equivalent password record. A tenant admin cannot read verifiers, reset a global password, or supply TenantContext as authentication proof. Global SystemAdminGrant alone is not a channel/identity recovery proof either.

This minimum batch does not add email, phone, username, tenant-local login name, OAuth/OIDC, MFA, passkey, recovery credential, shared/default password or a general IAM type registry. The existing verifier's opaque identifier is interpreted by the initial 1B-5 adapter as a **canonical lowercase UUIDv7 UserId string**: no tenant prefix, trim, case folding, ambiguous match, or fallback scan. Unknown/invalid identifiers take the uniform rejection path. UserId is a locator, never a bearer credential.

This is an internal minimal authentication contract, not a claim of a usable human-facing login-name UX. No new identifier column is coupled to password storage. A future human-friendly identifier resolver needs its own normalization, Unicode/case, verified ownership, uniqueness, bounded indexing and anti-enumeration contract before it can be enabled. V1 migration still requires explicit approval and compatibility/reset evidence.

## 3. Record, secret and hash boundary

Credential is a **security Infrastructure persistence record**, not an addition to ordinary Identity Domain aggregates. Application defines narrow security-specific operations and safe metadata; Infrastructure owns verifier-bearing storage records/provider handles. User and its existing authenticity mechanism stay unchanged. No hash-storage type or provider object enters the ordinary Domain/Port barrel, User DTO, UI or API response.

| Field/fact | Boundary |
| --- | --- |
| credentialId, userId, PASSWORD type, status, creation/terminal timestamps | Domain-safe metadata values; Application security metadata may carry them, but this does not create a new Domain entity. |
| Slot RepositoryRevision and global credential securityEpoch | Application/security concurrency metadata, never User or Membership state. |
| Verifier/PHC representation, salt/crypto parameters, provider handle | Infrastructure security persistence/provider boundary only; never ordinary Loaded results, audit, logs or application results. |
| Raw password/secret | Short-lived server-side Application/Infrastructure input only. Never persisted, cached, queued, returned, audited, logged, serialized, included in exception text/cause or attached to Domain state. |
| Provider/version metadata | A closed policy identifier if needed internally; no arbitrary JSON metadata, provider response object, PII or secret annotations. |

Ordinary repository results are `Loaded<CredentialSlotMetadata>` plus explicit safe generation history where authorized, **without verifier fields**. A separately named internal verification-record operation may read a verifier only inside the credential adapter; it cannot be exported as a business `Loaded<...>`. A compile-time brand alone is not a runtime secrecy guarantee: implementation must prevent accidental JSON/debug serialization and explicitly project metadata/results. Tests must inject and serialize representative provider/driver error objects and confirm no verifier escapes.

JS strings cannot promise deterministic memory zeroization. Minimize references/lifetime, avoid shared caches/closures and request body logging, redact tracing/APM, and do not claim stronger memory guarantees. Raw secrets are never DB parameters, including audit parameters. Encoded verifiers necessarily enter their dedicated parameterized persistence operation and must be excluded from SQL parameter logs/errors.

### Hash responsibilities and minimal additional contract

CredentialVerifierPort remains unchanged: it orchestrates locator resolution, credential state, crypto and current User checks and returns the existing minimal result. It cannot create a verifier, replace one, or express rehash policy; adding creation to it would conflate authentication outcomes with secret storage.

Therefore a minimal **Application-owned, security-only PasswordHashingPort** is required in a later contract batch. Its semantic operations are `hash(secret)`, `verify(secret, private verifier handle)` and `needsRehash(private verifier handle)`. Only the credential security composition can obtain/pass those handles; the concrete encoded storage type and extraction stay Infrastructure-local. Hash creation returns such a non-business handle, never an API/application DTO. The provider performs salt generation, established password hashing, and constant-time comparison using its vetted primitive; Domain has no crypto SDK or clock dependency. No generic crypto factory/provider framework is authorized.

Use a mature Argon2id provider and self-describing PHC-style encoding for the initial PASSWORD implementation. The existing documents establish Argon2id compatibility intent, not a frozen V2 package or a promise that all V1 hashes are usable. Provider/library choice and tuned parameters must be measured on the target Node 22/Linux environment and reviewed before implementation signoff. Encoded algorithm/version/work factors support explicit allowlisted agility, bounds and future rehash; no arbitrary algorithm string can select code or unbounded memory/CPU cost. Unsupported/malformed material fails closed, never falls back to plaintext or weaker crypto.

For security rationale, [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) recommends adaptive password hashing and describes PHC-format algorithm/work-factor storage. This design forbids plaintext, reversible password encryption, MD5, SHA256(password), home-grown crypto/salt protocols and silent algorithm downgrade. A pepper is not introduced in this minimal design; any future pepper needs separately approved external key custody/rotation and outage semantics, never a DB-stored key next to the verifier.

Raw password bytes must not be silently trimmed, normalized, truncated, or prehashed by application code. Creation password policy, compromised-password screening, input/resource ceilings (supporting long passwords), provider verification limits and exact test vectors are implementation gates; no V1 composition/default-password rule is inherited. All external inputs have an explicit bounded byte budget before expensive work; malformed UTF-16 and unsupported provider input fail uniformly. Validated PHC input is bounded ASCII (design storage ceiling 1024 bytes) with allowlisted cost maxima before provider dispatch; any necessary ceiling change requires explicit schema review, not silent truncation.

## 4. Lifecycle, compromise and replacement

The stable slot is a concurrency owner; each distinct credential generation has a fresh CredentialId. Generation statuses are ACTIVE, REPLACED, REVOKED. Terminal generations never become ACTIVE again, including after User restore. No independent mutable DISABLED state is necessary: User.DISABLED gates use of an otherwise active credential, while compromise/security revocation is irreversible.

| Action | Credential outcome |
| --- | --- |
| First approved creation | New slot and new ACTIVE generation atomically; no duplicate User/type slot. |
| Verify | No lifecycle mutation; require current slot pointer, ACTIVE generation, successful crypto and current ACTIVE User. |
| Password change/reset/rotation | Old ACTIVE → REPLACED, fresh ID → ACTIVE, pointer/revision/securityEpoch advance atomically. Old password is no longer selected or verified. |
| Revoke/compromise | Current generation → REVOKED; clear active pointer, clear live verifier and advance revision/securityEpoch atomically. |
| Explicit replacement after revoke | Fresh ID → ACTIVE; terminal old record stays terminal. The persistent slot prevents stale/absence ABA writes. Requires approved recovery/change authorization, not merely possession of UserId. |
| User disabled | Authentication REJECTED regardless of valid password; no automatic credential rewrite. Global session invalidation belongs to 1B-6/8. |
| User restored | May verify a still-current ACTIVE credential through a fresh complete check. REVOKED/REPLACED credentials and old revoked sessions stay invalid. |
| Verified technical rehash | Same credential identity/secret and lifecycle; guarded verifier update, slot revision advance, securityEpoch unchanged. It cannot overwrite a concurrent replace/revoke. |

Password reset identity/channel validation is not implemented. A caller-supplied reason, frozen object, CredentialId or version is not authorization. Approval/re-authentication/reset-token consumption belongs to later Application boundaries; tenant admin permissions cannot substitute for it.

Old terminal generations retain safe lifecycle metadata, not usable hash material. Clear verifier on replacement/revocation in the same transaction; do not keep a password-reuse hash archive without separately approved requirements. Logical history is not an audit substitute. Database backups may still contain past verifiers: access control, encryption and retention remain deployment controls, not claimed cryptographic erasure.

## 5. Repository contract and two concurrency values

Proposed `CredentialRepositoryPort` is an Application security contract, not yet code. Narrow operations and their required semantics:

- `findSlot(userId)` → safe Loaded metadata or null; authorized history access returns safe generation metadata only.
- `createPassword(userId, newCredentialId, private verifier handle, at)` → safe Loaded metadata; expected slot absence, existing User FK and unique slot, conflict if already initialized. A revoked slot is not absent.
- `replacePassword(userId, expectedRevision, expectedCurrentCredentialIdOrNull, newCredentialId, private verifier handle, at)` → safe Loaded metadata; one atomic generation replacement under slot CAS. New ID must never have appeared in history.
- `revokePassword(userId, expectedRevision, expectedCurrentCredentialIdOrNull, at)` → safe Loaded metadata; stale first, exact current target, first revoke only. Current null pointer is a true no-op, never a revival.
- `rehashPassword(userId, expectedRevision, credentialId, private verifier handle, at)` → safe Loaded metadata; only the verified current ACTIVE generation, same secret, explicit trusted provider decision. Not a password-reset path.
- Infrastructure-private active verification snapshot and final validation operations are consumed only by the verifier adapter, never exposed as general hash lookup services.

Names/signature bindings and private handle representation must be realized and tested in the separately authorized contract/implementation batch. These responsibilities and outcomes are frozen; this document does not pretend these methods already exist or alter existing Ports/Fakes.

**RepositoryRevision:** slot-level canonical positive signed-int8 decimal string, BigInt validation, never JS Number/xmin. It protects every credential history/pointer/verifier mutation, including rehash. Load/lock → absence → expected revision → target/ownership/lifecycle → full private persistence equality → no-op or CAS. Stale-before-no-op and current stored safe Loaded return are mandatory. Mutation increments once using database CAS; int8 maximum fails closed, identical no-op succeeds. No last-write-wins or automatic retries.

**securityEpoch:** independent global credential freshness counter, canonical nonnegative signed-int8 decimal string checked with BigInt, not Membership authVersion or User repository revision. First creation initializes 1; logical creation/replacement/revocation advances once; verification and identical no-op do not; technical rehash changes revision but not epoch. Epoch maximum must fail closed without wrap. An emergency authorized User disable remains a separate fail-closed response if a credential operation cannot be completed; do not report a failed revocation as successful.

The slot persists when no credential is active. This durable CAS owner is required to prevent two resets after revocation, creation after absence, or stale old-generation commands bypassing concurrency. It is not a generic aggregate framework or IAM expansion. Two reset writers from R: exactly one succeeds, loser STALE_WRITE; revoke vs replace similarly linearizes, never implicitly retries by loading the winner and applying an obsolete approval. A technical rehash loses to concurrent replacement/revocation and cannot resurrect the old generation.

Hashing is prepared before acquiring write locks, after policy/input checks; it is never done while holding a long DB lock. Inside one non-tenant/global transaction on one auth-role client, lock the slot, validate its expected revision/target and current persisted invariants, perform guarded logical mutation plus all generation changes, verify rowCount/RETURNING, and commit. First creation relies on unique slot insertion in that same transaction; conflicts roll back every inserted generation. No child has an independent business CAS. Replacement/revocation failure leaves all old/new/pointer/revision/epoch facts unchanged. No returned result until commit is verified.

Reuse the 1B-4 global transaction lifecycle (exclusive client, no tenant GUC, same-client work, checked COMMIT tag, rollback and exactly-once release, primary error preservation). The current helper is named controlTransaction and documents control-role composition; future credential composition must explicitly bind the **auth-runtime pool** to the same non-tenant lifecycle without passing a control/migrator connection or broadening privileges. Its mechanics do not SET ROLE or grant permissions. Do not copy it into a second transaction manager; any required composition annotation belongs in the authorized implementation review, not this docs round.

## 6. Verification, enumeration, timing and failures

Frozen verification flow:

1. Validate bounded opaque identifier/secret input and apply the approved admission/rate-limit policy. Resolve the minimal canonical UserId locator, without tenant scanning or public existence checks.
2. Read User and the current ACTIVE credential security snapshot, including slot revision/epoch, explicitly scoped to userId. Validate all persisted representations and relationships.
3. Execute exactly one approved provider verification: real current verifier when usable, otherwise a private startup-prepared dummy verifier using the supported cost policy. Wrong secret, unknown User, absent/revoked credential and disabled User take the same external result shape. Dummy success can never authenticate a missing/inactive subject.
4. After crypto, use a fresh final database check for current ACTIVE User and unchanged slot revision/active credential/epoch; do not trust the pre-crypto snapshot. Concurrent mutation invalidates that attempt; no hidden re-verification loop. Final credential check can hold the slot's shared lock through its transaction completion; do not obtain forbidden User write privileges merely to read status.
5. Return only `{status: 'VERIFIED', userId}` or `{status: 'REJECTED'}`. It selects no tenant, Membership, grants or permissions and issues no session/token/cookie. VERIFIED describes checks at their final database observation, not a permanent authorization certificate.

The post-crypto check closes replace/revoke and already-disabled-user races within this boundary. A subsequent disable/change can invalidate the result: 1B-6 must coordinate **new Session issuance**, and all later protected requests must read current User/credential freshness. A standalone `VERIFIED(UserId)` cannot supply a missing epoch binding or prove that it is still valid at a later session commit. No new claim of cross-role/pool ACID is made here.

The existing Port's REJECTED shape is retained for unknown user, missing/inactive credential, incorrect secret, invalid locator and User disabled. Internal closed counters may distinguish these categories for restricted monitoring; do not place submitted identifiers, verifiers or provider details in the audit payload or expose a per-account reason endpoint. Public HTTP status/body/header/redirect uniformity and rate-limit disclosure must be tested in 1B-8, not inferred from a typed union.

[OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) identifies response/timing discrepancies as enumeration risks. Dummy crypto belongs to Infrastructure, never Domain. It reduces an obvious unknown-user fast path; it does not prove constant-time network/service behavior, especially with legacy work factors. No arbitrary sleep is a timing-security proof. Test instrumentation must prove comparable provider work, and Linux measurements must assess distributions under bounded load. Resource admission, IP/opaque-locator/account budgets and concurrency caps must prevent dummy verification itself becoming a DoS. Exact limiter storage/budgets are an implementation gate, and public/IP integration is 1B-8; login remains disabled without them. No permanent account lockout that lets an attacker trivially deny another user is introduced.

| Internal condition | Contract / public treatment |
| --- | --- |
| Unknown/missing/inactive/wrong secret/disabled User | REJECTED; uniform public authentication failure. |
| Credential changed during verification | REJECTED; no secret/result details and no auto retry. |
| Missing mutation target / duplicate slot or generation | Existing CONFLICT semantics; not a public existence oracle. |
| Stale expected slot revision | STALE_WRITE, checked before no-op. |
| Malformed stored representation / impossible mutation result | INTEGRITY_FAILURE; fail closed and bounded internal alert. |
| Real SQLSTATE 40001 / 40P01 | RETRYABLE_PERSISTENCE_FAILURE only; caller must not blindly replay obsolete approval. |
| Provider/DB outage or unknown failure | Sanitized UNAVAILABLE or appropriate existing integrity classification; never VERIFIED or weaker fallback. |

No new generic error taxonomy or change to IdentityPortError constructor is needed. Vendor exception messages/causes/stacks, SQL details and submitted secrets must not cross the port. Public operational-unavailable mapping may be distinct from bad credentials only if it does not depend on account existence; 1B-8 must test that property.

## 7. Future PostgreSQL design (requirements, not DDL)

Two narrowly scoped tables support permanent CAS ownership plus immutable generation history. No identifier table, ORM-generated schema, guessed FK to Membership, or column in users is added.

| Table / field | Design requirement |
| --- | --- |
| `zhiban_identity.credential_slots.user_id` | UUIDv7 PK/FK to users(user_id), ON DELETE RESTRICT; one permanent PASSWORD slot per global User. No tenant_id. |
| `credential_slots.credential_type` | Closed text PASSWORD only, immutable. No speculative multi-type API. |
| `credential_slots.active_credential_id` | Nullable UUIDv7 pointer to the same User's credential generation; NULL denotes no usable generation, not a default/empty ID. |
| `credential_slots.repository_revision` | Positive BIGINT, initial 1, int8 max, canonical string adapter; root CAS owner. |
| `credential_slots.security_epoch` | Nonnegative BIGINT freshness counter, initial logical creation 1; canonical string/BigInt only. |
| `credential_slots.created_at / updated_at` | Frozen epoch-ms BIGINT bounds/ordering; creation immutable, monotonic updates. |
| `zhiban_identity.credentials.credential_id` | Fresh UUIDv7 PK per generation; authentication-owned ID generation, not assumed to exist on current Domain IdGeneratorPort. |
| `credentials.user_id / credential_type` | Same slot ownership, FK RESTRICT; composite unique key `(user_id, credential_id)` for pointer/successor association. |
| `credentials.status` | Closed ACTIVE / REPLACED / REVOKED. Irreversible terminal transitions. |
| `credentials.verifier_material` | Bounded self-describing PHC text; non-NULL only for ACTIVE, NULL for terminal history. Never plaintext or JSON/provider dump. |
| `credentials.created_at / updated_at` | Epoch-ms safe bounds and ordering; createdAt immutable. |
| `credentials.replaced_at / revoked_at` | Strict nullable epoch-ms: ACTIVE both NULL; REPLACED replaced_at only; REVOKED revoked_at only, ordered with updatedAt. |
| `credentials.replaced_by_credential_id` | NULL except REPLACED; same-user composite FK to fresh successor, never self/reused old ID. |
| Arbitrary metadata / raw reset token / salt columns | ABSENT. PHC contains necessary encoding parameters; no duplicated custom salt protocol. |

1B-5B must realize partial UNIQUE(user_id) WHERE status=ACTIVE, slot/user/generation composite association, type/status/timestamp/verifier checks, immutable/terminal-history guards, and **commit-time slot-pointer/ACTIVE-generation consistency**. A partial index alone does not prove pointer consistency. First creation and replacement may temporarily have no active pointer inside the transaction, but cannot commit orphan ACTIVE history or an invalid pointer. An audited deferred constraint trigger or equivalent constrained design must be reviewed, never assumed from an application assertion. No SECURITY DEFINER bypass to a global secret lookup is introduced.

Indexes: slot PK for direct lookup/CAS, composite generation association uniqueness, the active unique index, and `(user_id, created_at, credential_id)` for restricted history. No verifier/hash index or global identifier enumeration index. Slot/generation IDs and nulls are runtime validated as well as DB constrained; explicit SQL columns/parameters, no SELECT *, and explicit security projection. Terminal clearing is one approved transition, not unrestricted history editing or runtime DELETE.

Owner: existing `zhiban_identity_owner` NOLOGIN. Migration: existing zhiban_migrator through a **new additive migration**, never rewriting applied 0001–0003/checksums. Schema review precedes migration. No migration/bootstrap/workflow is edited now.

RLS: **tenant RLS NOT_REQUIRED** for these global records; use dedicated auth-role ACL, consistent with ADR-011's controlled global exception. Do not attach app.tenant_id, fake TenantContext, public/global fallback policies or Membership references. Existing mixed audit RLS remains required and its closed extension must be reviewed independently.

DB ROLE: **zhiban_auth_runtime** for credential verification and approved credential mutations. Grant only explicit SELECT/INSERT and required mutation columns on these two new tables; no runtime DELETE/TRUNCATE/DDL, no owner/migrator/runtime membership, no global users UPDATE or tenant-table access. Auth runtime already has the User SELECT needed for lifecycle checks; use that read-only composition rather than a writable control repository. Tenant runtime and ordinary control runtime receive **zero Credential table/verifier permissions**, including column, view, function, sequence and inherited paths. No control credential-management API by default. Safe administrative recovery must be routed through the approved authentication service, not a broad GRANT.

ROLE_CONTRACT_GAP: NO for this credential-only design: the existing auth role explicitly reserves this responsibility. Missing grants to new tables are scheduled schema work, not existing usable permissions. Future Session issuance/User-disable coordination and any new global lock/helper privilege require 1B-6/8 review; they cannot be smuggled into 1B-5 grants. Real PG16 ACL/role-closure tests must prove effective denial, not just inspect SQL text.

## 8. Audit boundary and additive contract completion

Existing AUTHENTICATION_REJECTED has GLOBAL scope, no subject identifier and empty payload; use approved service/system actor and CREDENTIAL_REJECTED reason, never the submitted locator as actor/subject/requestId. Existing SESSION_REVOKED belongs to Session followup, not evidence that password replacement was audited.

Freeze the future minimal **additive** closed vocabulary: CREDENTIAL_CREATED, CREDENTIAL_REPLACED, CREDENTIAL_REVOKED, CREDENTIAL_REHASHED. These are requirements, **not currently accepted events**. Each has GLOBAL scope, subject UserId, approved actor, explicit Instant, safe requestId, and existing closed reason code. Exact event-specific payloads:

| Future event | Closed payload facts |
| --- | --- |
| CREDENTIAL_CREATED | credentialId; repositoryRevisionAfter; securityEpochAfter |
| CREDENTIAL_REPLACED | priorCredentialId (nullable after revoke); credentialId; repositoryRevisionBefore/After; securityEpochBefore/After |
| CREDENTIAL_REVOKED | credentialId; repositoryRevisionBefore/After; securityEpochBefore/After |
| CREDENTIAL_REHASHED | credentialId; repositoryRevisionBefore/After; securityEpoch (unchanged) |

Revision/epoch facts use validated decimal strings, not existing Membership authorizationVersion fields. No algorithm/salt/verifier/password/secret/token/provider object/HTTP body or free-text rejection reason is allowed; no general attributes bag. No no-op event that falsely reports a mutation. Existing 18-event input/payload shapes remain unchanged. Later contract/schema work must add typed factory validation, exact database payload validation, explicit auth INSERT policy cases and matching security tests, preserving old event shape compatibility. It cannot silently cast these names to the current closed union or relabel them USER_RESTORED/SESSION_REVOKED.

Credential mutation and its required mutation audit must commit atomically on the same auth client; audit failure rolls back replacement/revocation/rehash. The standalone AuditPort today has no same-client guarantee. Freeze the composition obligation, not an invented claim that it already works: realize a small credential-specific transaction/audit composition in authorized implementation/1B-8 integration, not a generic UoW or cross-pool commit. Credential mutation endpoints stay closed until this path is proved. This is additive planned credential contract completion, not modification/relaxation of the frozen 3B/4B behavior in this round.

## 9. Session, recovery and security epoch followups

SESSION IMPLEMENTED: NO. Membership authVersion is never reused for credential version or session freshness.

REQUIRED_FOLLOWUP for 1B-6: password change/reset, credential revocation and compromise invalidate all pre-change global sessions; login/controlled post-change reauthentication creates a fresh session, never revives an old one. User disable invalidates all sessions and every request checks current User. Membership disable stays tenant-local, not a reason for blanket global password/session reset.

The durable credential securityEpoch supplies a global freshness requirement. 1B-6 must bind sessions to the verified epoch (or prove an equivalent atomic issuance/revocation barrier) and reject mismatch on request/renewal. That prevents a concurrent login creating an old-password session after bulk revocation has scanned the table. Current SessionRecord/Session schema/VERIFIED result do **not** contain that binding; this is a required later contract completion, not an existing feature or a token field added here. Existing verifier output remains minimal; an internal server-only coordinated authentication/Session composition must retain/revalidate the verification epoch, not accept a client-provided or reconstructed freshness proof.

1B-6 must also close User-disable vs Session-create ordering without granting auth broad User write privilege, define lock ordering with control revocation, and preserve fail-closed behavior on epoch/state-store outages. No Session is issued when these barriers or audit obligations are unavailable. Exact implementation is a separate 1B-6 security gate. 1B2-F07 remains deferred: SessionId generation/unpredictability is not assigned to the Domain ID generator by this design. Cookie/JWT/rotation storage, CSRF and expiry are not implemented.

Recovery identity evidence, verified channels, single-use/short-lived reset-token issuance/consumption, recent-auth proof and notification are 1B-8 Application/API work with Session interactions in 1B-6. This phase supplies only approved atomic replacement semantics. No email/SMS/OTP/magic-link/MFA workflow, tenant-admin password setting, birthday/shared password or production V1 import is authorized.

## 10. Threat model and required tests

All entries below are implementation/signoff requirements, not executed test claims in this docs round.

| Threat | Mitigation / layer | Required evidence |
| --- | --- | --- |
| DB dump exposure | Mature bounded Argon2id/PHC, salt managed by provider, no raw secret, clear terminal live verifiers; deployment encryption/retention | Synthetic provider vectors, no plaintext column/params, old generation cleared; explicitly document backup/offline-guessing residual risk. |
| Log/exception leakage | Credential adapter + logging/APM redaction and sanitized errors | Spy on success/failure/provider/SQL/rollback logs and nested causes; secret/verifier absent. |
| Audit leakage | Exact typed event projection + SQL closed payload/ACL | Top/nested extra-secret injection and raw identifier/hash/salt/token rejection; no driver/provider object. |
| Credential enumeration | Uniform verifier result and public response policy | Unknown/missing/inactive/wrong secret/disabled all REJECTED; API body/status/headers/redirect later equal. |
| Timing oracle | One real/dummy provider path + bounded admission, no Domain crypto | Provider invocation instrumentation and Linux timing distributions, including cost versions; no arbitrary delay assertion or claim of perfect constant time. |
| Concurrent resets / revoke-replace / rehash race | Durable slot lock/CAS + revision + target ID | Real two-client barrier tests: one winner, one stale; no old-password overwrite or terminal revival. |
| Stale credential revival | Terminal generation guards, unique active pointer, no automatic restore | Revoked/replaced/frozen/copied stale record cannot activate; replacement requires fresh ID/current expected revision. |
| User disabled bypass | Current User check after crypto; later issuance/request barrier | Disable between load/crypto/final check rejects; valid secret for DISABLED rejects; restore cannot revive terminal generations/sessions. |
| Tenant boundary confusion | Global User ownership, no tenant context, auth-only ACL | Tenant/control role SELECT and mutation denied, no tenant-prefixed locator/fallback, no Membership authVersion changes. |
| Hash exposure through mapping/serialization | Private security record/handle and explicit safe metadata/result projection | Domain/barrel AST imports blocked; JSON/debug/DTO/Loaded/error inspections contain no verifier; unrelated code cannot obtain handle. |
| Partial replacement or lost audit | Same-client transaction with slot/generation/audit | Inject failures at each write/audit/COMMIT; original pointer/status/revision/epoch/history unchanged on rollback; aborted COMMIT tag fails. |
| Malformed verifier / excessive work / outage | Full runtime grammar/range/cost bounds, admission limits, no weak fallback | Unknown algorithm/version/oversized encoding/cost/provider failure rejects or sanitized failure, no success; limits tested under load. |

Additional required cases: creation conflict and absence semantics; safe history; complete no-op vs stale; max revision/epoch fail closed; bigint string boundaries without Number; UUIDv7 and Instant/NULL validation; original input captured/validated without getters or normalization repairs; slot/ACTIVE-generation consistency and wrong User association at commit; real 40001/40P01 classified only, no retry; release once/primary error preserved; effective auth/tenant/control ACL and no role elevation. Schema tests reuse the existing PG16 harness, not owner/mock signoff. Existing 1B-4 DH/RHY/TOCTOU and contracts must not be weakened for credential work.

## 11. Frozen vs deferred and exit gate

| Classification | Content |
| --- | --- |
| FROZEN_IN_1B5A | Global User ownership; PASSWORD-only/minimal UserId locator; security record not Domain entity; raw-secret/verifier boundaries; narrow hashing/repository responsibility; irreversible generation lifecycle; atomic replacement/history; durable slot CAS and independent credential epoch; current User verification; generic rejection/dummy timing boundary; auth-role/non-tenant persistence; closed additive audit requirements; threat/test matrix and future Session obligations. |
| DEFERRED_TO_1B5_IMPLEMENTATION | Supplementary 1B-5B schema/contract review, ID/handle/Port code, additive migration/ACL/event validation, provider/library and parameter performance/compatibility, password policy/input ceilings/rate-limit mechanism, private mapper/repository, transaction/audit composition and unit/real PG16 verification. No production hash migration or endpoint enablement implied. |
| DEFERRED_TO_1B6_SESSION | 1B2-F07, digest/Session ownership, epoch binding or equivalent issuance barrier, bulk invalidation/rotation, User-disable race, cookies/expiry/CSRF/session storage. |
| DEFERRED_TO_1B8_AUTH_API | Public login response and rate-limit integration, change/recovery approval/re-auth/reset-token workflow, public identifier UX/resolver if needed, safe audit orchestration and all API/use-case authorization. Credential-specific persistence audit must be proved before any such endpoint opens. |
| OUT_OF_SCOPE | Membership/RBAC rewrite, OAuth/JWT platform, MFA/OTP/magic links, OpenMAIC bridge/native credentials, Course/Class, production data/V1 migration/deployment, provider secrets in Domain or unrestricted IAM framework. |

FROZEN_CONTRACT_CONFLICT: NO. No accepted ADR requires tenant-owned passwords, existing concrete Credential schema, public hash output, or reuse of Membership authVersion. Candidate columns in 3A are expressly nonbinding pending this design. Historical V1 choices are not competing V2 contracts. Additive future credential ports/events/tables complete reserved design gaps; existing frozen contracts and applied migration files remain unchanged.

ROLE_CONTRACT_GAP: NO for the design's credential-only auth role responsibility; Session orchestration remains an explicit later contract requirement, not a grant performed here.

P0: 0. P1: 0. P2: 0 for this design boundary. Deferred implementation/measurement/security gates are not evidence of implemented controls. CREDENTIAL_DESIGN: FROZEN. READY_FOR_1B5B_SCHEMA: YES. No login/Session/authorization implementation is approved or claimed. COMMIT: NO. PUSH: NO.
