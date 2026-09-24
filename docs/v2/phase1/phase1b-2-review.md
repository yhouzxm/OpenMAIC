# Phase 1B-2 — Identity Repository / External Ports Review

Status: IMPLEMENTED / AWAITING HUMAN REVIEW. Base HEAD: `438dff9536c08a5957da7510f370d2eec45d85fb`. No commit or push in this batch. This document does not approve 1B-3.

Revision Round 1 below supersedes the initial contract descriptions where they differ; the initial review history is retained for traceability.

## PORTS IMPLEMENTED / PUBLIC CONTRACTS

`lib/zhiban/application/identity/ports/` contains exactly nine responsibility-specific interfaces: `IdentityRepositoryPort`, `TenantRepositoryPort`, `MembershipRepositoryPort`, `RoleCatalogPort`, `CredentialVerifierPort`, `SessionRepositoryPort`, `AuditPort`, `ClockPort`, and `IdGeneratorPort`. The explicit barrel exports only these contracts and their supporting Application-owned values/errors. No generic repository, UnitOfWork, policy engine, implementation, OpenMAIC bridge, or Course port exists here.

Global `User` and control-plane `SystemAdminGrant` share the restricted Identity repository, without a fake tenant. Tenant repository stores only `Tenant`, not a `members` aggregate. Membership repository exposes only `findById`, `findByUser`, `create`, and conditional `save`, **all with required `TenantContext` as the first argument**. Cross-tenant reads return `null` to avoid existence disclosure; writes fail with `TENANT_SCOPE_VIOLATION`. Missing or malformed context fails closed; a copied valid context is only a scoping value. An unknown tenant and caller eligibility must be checked by future Application; Infrastructure must enforce actual tenant predicates/RLS. No cross-tenant grant-discovery query is provided: `CROSS_TENANT_MEMBERSHIP_DISCOVERY: DEFERRED_TO_APPLICATION_QUERY_DESIGN`.

## TENANT CONTEXT MODEL

**SUPERSEDED BY REVISION 1:** The initial verified-issuance description is no longer the contract. `TenantContext` is a readonly, Application-owned tenant scoping value containing only `tenantId`. `tenantScopeContext` and `requireTenantContext` validate its shape and identifier; a copied valid value can still scope a repository call. This value is not authentication, Membership, or authorization proof. Its purpose is to make tenant scope mandatory on tenant-owned repository methods. Protected Application use cases must perform Authentication → Tenant Resolution → active User → active Tenant → active Membership → Authorization → Repository. Infrastructure must enforce tenant predicates/RLS; RoleGrants and permissions are not cached in context.

## REPOSITORY REVISION MODEL

`Loaded<T> = { value, revision }`. `RepositoryRevision` is an opaque nonempty string token at the Port boundary, used in `save` after an explicit `create`; it is neither a SQL/DB identifier nor a Domain field. `Membership.authorizationVersion` tracks authorization semantics and **is not** `RepositoryRevision`. Both can change independently. Future adapters must atomically compare expected persistence revision before writing; a stale snapshot must not overwrite a concurrent revoke. The in-memory fake demonstrates `STALE_WRITE`, but is not a database concurrency proof. Future combined Membership state/version/audit atomicity remains a separate review item; no transaction API is introduced.

## ERROR TAXONOMY

`IdentityPortError.code` is limited to `CONFLICT`, `STALE_WRITE`, `TENANT_SCOPE_VIOLATION`, `INTEGRITY_FAILURE`, and `UNAVAILABLE`, with no infrastructure error details in its message. Expected absence returns `null`; failed credential checks return `REJECTED`; missing sessions return `null`. Domain input failures remain Domain errors. Infrastructure will map vendor errors to these categories without leaking SQLSTATE, driver errors, identifiers or secrets. Cross-tenant reads use `null`; cross-tenant writes use a generic scope violation, never the actual owner tenant.

## CREDENTIAL RESULT MODEL

`CredentialVerificationRequest` has opaque `identifier` and `secret`; neither is a Domain value, audit attribute, or output. `CredentialVerificationResult` is either `VERIFIED` plus `UserId`, or the single `REJECTED` shape. Unknown account and wrong secret are indistinguishable at this contract boundary. Password hashing, identifier normalization, timing, rate limiting and credential storage are not implemented.

## SESSION PERSISTENCE MODEL

`SessionRecord` binds only a global `UserId` and stores an opaque `TokenDigest` lookup value, session ID, lifecycle timestamps and revocation. No tenant, role, permission snapshot, cookie, HTTP field or raw token appears. Methods express `create`, lookup, conditional `touch`, `revoke`, and `revokeAllForUser`. A lookup result is **not** a valid authorization decision: future Application must check server-side expiry, revocation and current User/Membership state, and fail closed on storage outages. `TokenDigest` is only a type boundary; actual cryptographic digest production/validation is deferred. Disabling one Membership must not call global `revokeAllForUser`; disabling the global User may.

## ROLE CATALOG / AUDIT BOUNDARY

`RoleCatalogPort` returns only controlled Domain `Role` values addressed by frozen `RoleCode`; catalog version is directory metadata, not a Role or grant field. No custom role mutation API or tenant `SYSTEM_ADMIN` exists. Future catalog implementation must validate complete controlled templates and their version, not treat externally supplied roles as trusted.

`AuditPort` appends a fixed, typed Identity event: type, explicit occurredAt, discriminated actor and subject, optional tenant/request context. It has no arbitrary `Record<string, unknown>` attributes. Password, secret, token, digest, provider key and other credential material must never be logged or added to audit. Required atomic audit persistence with Membership changes remains for later implementation review; this Port alone does not claim atomicity.

## CONTRACT TESTS

Pure in-memory fakes exist **only** under `tests/zhiban/identity/contracts/`. Tests cover all nine interface implementations, global/tenant create-read-save, duplicate and stale conflicts, tenant context required on every Membership operation, cross-tenant denial, missing/forged contexts, separate revision vs authorizationVersion, controlled roles, non-enumerating credential outcomes, global session binding and revocation, fixed clock, Identity-owned ID generation, bounded audit shape, and AST import/source boundary. No database, network, V1 data or OpenMAIC resource is used. A fake proving an interface is implementable does not establish future PostgreSQL/RLS or credential security.

Validation on this worktree: 1B-1 Domain tests 94 PASS (5 files); 1B-2 contract tests 12 PASS (3 test files, plus one fake fixture); combined 106 PASS. Root lint PASS with 0 errors and 18 existing warnings outside the new paths; targeted lint of new paths PASS without warnings. Default root typecheck reached the local Node approximately 2GB heap limit and OOM without TypeScript diagnostics. Retrying with process-local `NODE_OPTIONS=--max-old-space-size=8192` and `--incremental false` PASS; no configuration or persistent environment change. The formatting check initially found six new files; only allowed new files were formatted and then revalidated.

## DEFERRED GATES

- **1B-3:** Identity-owned schema/RLS, constrained runtime role, unique tenant code and Membership `(tenantId,userId)`, independent schema/ownership review; **not approved here**. No OpenMAIC resource mapping in 1B-3.
- **1B-4:** Real repositories, tenant predicates and RLS tests, atomic compare-and-write, integrity handling, pool reuse, verified Domain rehydration and historical states.
- **1B-5:** Hashing/credential implementation, identifier normalization, anti-enumeration timing and rate limiting.
- **1B-6:** Digest/session ID generation, cookie handling, expiry/rotation/revocation, storage failure semantics and CSRF.
- **1B-7:** Fresh Policy, grant ceiling, scope/resource relationship and last-admin protection.
- **1B-8:** Trusted TenantContext issuance at use-case boundary, explicit approval provenance, audit atomicity and cross-tenant selection query design.

F-02: STILL DEFERRED TO REPOSITORY IMPLEMENTATION / REHYDRATION REVIEW; no `rehydrate`, `fromRow`, snapshot loader or `Object.assign` loader was added.

F-05: STILL DEFERRED TO APPLICATION APPROVAL DESIGN; Ports do not choose pending-origin grant approval semantics.

OPENMAIC DEPENDENCY: NONE. DATABASE DEPENDENCY: NONE. FRAMEWORK DEPENDENCY: NONE.

## KNOWN QUESTIONS

1. The public `tenantScopeContext` factory constructs only a scoping value, not proof of an active User, Tenant, Membership, or granted Permission. Future Application review must verify every protected call site and forbid treating a client-controlled tenant candidate as authorization; repository isolation remains mandatory even with a constructed context.
2. Session digest and ID values are opaque types but strings at runtime. 1B-6 must ensure only a keyed/cryptographic digest—not a raw bearer token—is passed to storage, and configure absolute/idle limits outside the Domain.
3. Port-level `AuditPort.append` has no atomic coupling to repository writes. 1B-3/4/8 must jointly review commit ordering or outbox strategy without turning this Port into a database transaction API.
4. Role catalog version pinning/rollout and global SystemAdminGrant access policy need later Application/Infrastructure acceptance; this batch only fixes their storage/read contract.

READY_FOR_1B3: NO — wait for human 1B-2 review and a separate Identity schema review.

## REVISION ROUND 1 — adversarial review remediation

This revision changes only the 1B-2 Port contracts, their test-only fakes/tests, and this review document. No Domain, Infrastructure, database, application use case, OpenMAIC or V1 file changed. This section records the revised contract; earlier paragraphs above describe the initial submission.

| Finding | Status | Revised contract and evidence |
| --- | --- | --- |
| 1B2-F01 Membership save invariants | FIXED | `save` requires the stored `id/userId/tenantId/createdAt` identity, tenant scope, independent expected repository revision, nondecreasing authorizationVersion and no authorization-state change at equal version. The fake rejects violation before mutation and returns a fresh revision on success. Tests exercise alternate UserId, TenantId, current-revision version rollback, unchanged storage after failure, equal-version no-op save, and higher-version save. |
| 1B2-F02 Audit sensitive extra fields | FIXED | `createIdentityAuditEvent` projects a finite input union into explicit whitelisted fields and freezes nested actor/grant/scope facts. AuditPort takes only factory-issued events; fake rejects forged inputs. Runtime test passes extra secret/password/rawToken/tokenDigest/credential/providerKey at top and nested levels, then inspects persisted output. The factory's private issuance registry proves projection, **not** actor authorization. |
| 1B2-F03 Audit event completeness | FIXED | The closed event union includes Membership activated/disabled/reactivated/left/rejoined, RoleGrant granted/replaced/revoked, User and Tenant created/disabled/restored, SystemAdminGrant granted/revoked, Session revoked and Authentication rejected. Membership events carry subject IDs, tenant, bounded reason code, authorizationVersion before/after; recovery additionally carries mode, prior grant IDs and approved grant snapshots (`RoleGrantId`, `RoleCode`, validated `Scope`, validity). Activation/rejoin separates prior grant references from newly approved grant facts; revoke records the target grant fact. No Domain objects or arbitrary JSON payload are serialized. Future Application must prove approval and atomically commit state plus audit. |
| 1B2-F04 TenantContext semantics | FIXED | The factory is now `tenantScopeContext`. It is only an Application-owned tenant scoping value: a copied valid value can still scope a repository call; no brand, frozen object, factory or runtime shape check proves User/Tenant/Membership status or permission. Protected use cases must verify Authentication → Tenant Resolution → active User/Tenant/Membership → Authorization before using it; Infrastructure must enforce tenant predicates/RLS. |
| 1B2-F05 Session touch/revoke | FIXED | Port states atomic compare-and-touch only for unrevoked sessions; stale revision fails `STALE_WRITE`, already revoked current record returns `null`, and touch may not clear revocation. Revoke is idempotent/atomic and wins a competing touch; first revoke advances persistence revision. Fake and race-order tests cover stale touch after revoke, touch before revoke, repeated revoke, touch on revoked record and revokeAllForUser. No session grant/role/tenant snapshot was added. |
| 1B2-F06 RoleCatalog completeness | FIXED | `roleCatalogSnapshot` validates nonblank version and exactly one each of STUDENT, TEACHER and TENANT_ADMIN, then freezes and orders the snapshot. Tests reject empty version, empty/missing/duplicate roles and accept arbitrary input order. Domain RoleCode still rejects SYSTEM_ADMIN. |
| 1B2-F07 SessionId generation ownership | DEFERRED_TO_1B6 | IdGeneratorPort remains Identity-Domain-only. SessionId issuance and unpredictability belong to the later Application Session batch. |

Historical finding identifiers from 1B-1 remain distinct: **1B1-F02 runtime constructor/rehydration hardening: STILL DEFERRED** to repository implementation review; **1B1-F05 pending-origin grant approval semantics: STILL DEFERRED** to 1B-8 Application approval design. The present 1B2-F02 and 1B2-F05 are unrelated and are fixed here. No rehydration, approval Policy or transaction API has been added.

The event vocabulary is intentionally Identity-only, not a generic event bus. Controlled reason codes prevent free-text request bodies from being used as reasons. Factory validation cannot prove a grant was truly approved, nor can a standalone AuditPort guarantee atomicity; 1B-4/1B-8 must close those implementation gates. Domain `authorizationVersion` remains separate from opaque `RepositoryRevision`.

Review outcome for this revision: READY_FOR_REVIEW, **not** approval to start 1B-3. 1B-3 still requires human 1B-2 signoff, a separate schema/data-ownership review, and explicit implementation authorization.

Revision verification: Domain tests 94 PASS; Contract tests 19 PASS (four test files plus one test-only fake); combined 113 PASS. Root lint PASS with 0 errors and 18 pre-existing warnings outside this batch; targeted lint for changed Port/contract files PASS with no warnings. Default root TypeScript reached the local approximately 2GB Node heap limit and OOM without type diagnostics; process-local 8GB retry PASS with `--incremental false`, without changing project configuration. All worktree files remain within the three permitted paths, with no staged or tracked-code changes.

## FINAL HUMAN REVIEW SIGNOFF

The initial implementation and its original contract descriptions remain above as historical context. The initial adversarial review found **P0: 0, P1: 3 (1B2-F01–F03), P2: 3 (1B2-F04–F06), P3: 1 (1B2-F07)**. Revision 1 closed F01–F06 at the implementation-review boundary; the targeted Revision 1 review found **P0: 0, P1: 0, P2: 3 cleanup notes (R1-01–R1-03), P3: 1**. Superseded descriptions above must not be used as current Port contracts.

Status: **IMPLEMENTED / PASS_WITH_NOTES**. The final cleanup closes all three targeted P2 notes:

| Cleanup | Status | Final evidence |
| --- | --- | --- |
| R1-01 TenantContext documentation | CLOSED | Historical verified-issuance language is marked superseded and corrected: `TenantContext` is an Application-owned scoping value only. Authentication, Tenant Resolution, active User/Tenant/Membership and Authorization precede protected repository access. |
| R1-02 batch session revoke race | CLOSED | A separate runtime test begins with an active session and a loaded revision, calls `revokeAllForUser`, rejects the old-revision touch, and confirms `revokedAt`, `lastSeenAt`, and the newer revision remain unchanged. |
| R1-03 role catalog runtime validation | CLOSED | `FakeRoleCatalog` re-runs the same `roleCatalogSnapshot` validation at construction. Runtime tests inject malformed snapshots through an `unknown` boundary and reject empty version, missing role, and duplicate role. The TypeScript brand is only a compile-time aid, not runtime validation. |

P0 BLOCKERS: **0**. P1 MUST_FIX: **0**. Remaining P2: **0**. P3: **1B2-F07 SessionId generation ownership → DEFERRED_TO_1B6**. **1B1-F02 runtime constructor hardening: STILL_DEFERRED_TO_REHYDRATION_REVIEW**. **1B1-F05 pending-origin grant semantics: STILL_DEFERRED_TO_1B8**. No Domain, database, Infrastructure, OpenMAIC core, or V1 file changed.

Final validation: Identity Domain tests **94 PASS**; Identity contract tests **20 PASS**; root lint **PASS** with 0 errors and the same 18 existing warnings outside this batch; default root TypeScript **OOM** at the local approximately 2GB Node heap limit; process-local 8GB TypeScript retry **PASS** with `--incremental false`. No project configuration or persistent environment variable changed.

**1B-2 REVIEW VERDICT: PASS_WITH_NOTES. READY_FOR_1B3: YES_AFTER_1B2_COMMIT.** This signoff does **not** authorize creating a schema directly. Phase 1B-3 still requires a separate Schema / Ownership / RLS design review and explicit implementation authorization. No 1B-3 work begins in this batch.
