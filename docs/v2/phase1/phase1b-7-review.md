# Phase 1B-7 Authorization Closeout / Freeze

STATUS: COMPLETE / FROZEN

Date: 2026-10-03. Branch: `refactor/zhiban-v2`. Signed-off implementation HEAD: `b0fb6b2d442cd7b51c75ad1c32527d3d69332526`.

This closes 1B-7A Authorization design and 1B-7B implementation, security review, targeted repair, and real PostgreSQL 16 signoff. It freezes the Policy and same-transaction primitive, not public API enforcement or production deployment. This documentation-only closeout awaits its own checkpoint; no implementation, test, workflow, migration, package, commit, push, or CI dispatch changes occur in this round.

## Scope and sources of authority

The authority is the approved [Authorization design](phase1b-7-authorization-design.md), including A7-01 RoleCatalog/action rules, A7-02 delegation ceiling, and the precise A7-03 database capability exception. It preserves [RBAC](rbac-model.md), [permission matrix](permission-matrix.md), [authorization flow](authorization-flow.md), [authentication boundary](auth-boundary.md), [tenant isolation](tenant-isolation.md), [1B-4 repository closeout](phase1b-4-review.md), and [1B-6 Session closeout](phase1b-6-review.md). The [execution plan](../zhiban-v2-execution-plan.md) separates this unit from 1B-8 application/API composition.

Actual implementation and evidence read for closeout:

- [Pure Domain policies](../../../lib/zhiban/domain/identity/policies/authorization.ts), [Application authorize](../../../lib/zhiban/application/identity/authorize.ts), [Authorization contracts](../../../lib/zhiban/application/identity/ports/authorization.ts), and [closed sanitized errors](../../../lib/zhiban/application/identity/authorization-error.ts).
- [Approved immutable catalog adapter](../../../lib/zhiban/infrastructure/identity/authorization/identity-catalog.ts), [checked minimal records](../../../lib/zhiban/infrastructure/identity/postgres/repositories/authorization-records.ts), [Authorization read/mutation repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/authorization.ts), and the internal client-bound collaborators in the [Membership repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/membership.ts).
- [0007 migration](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0007_identity_authorization_state.sql), [Domain Policy tests](../../../tests/zhiban/identity/authorization/policy.test.ts), [Application tests](../../../tests/zhiban/identity/authorization/application.test.ts), [SQL repository tests](../../../tests/zhiban/identity/postgres/authorization-repository.test.ts), [schema static contracts](../../../tests/zhiban/identity/postgres/authorization-schema.test.ts), [real Authorization PG16 suite](../../../tests/zhiban/identity/postgres/pg16-authorization.test.ts), and the [existing PG16 workflow](../../../.github/workflows/zhiban-identity-pg16-security.yml).
- Actual GitHub run metadata and logs for the final candidate, not a previous SHA's success or local Fakes substituted for real PostgreSQL evidence.

Historical ABSENT/PARTIAL/implementation-pending statements in the design and execution plan describe their original checkpoints. The completed items below supersede those implementation-status markers within this unit without rewriting the frozen design or approving later phases.

## Identity, Policy, and resource boundary freeze

User remains GLOBAL USER. Membership is the tenant relationship. Session establishes authenticated `UserId` only; it stores no authorization snapshot. TenantContext remains request/persistence scoping, not permission proof. Credential securityEpoch, Session lifecycle, Membership authorizationVersion, RoleGrant history, and the existing Identity lifecycle contracts are unchanged.

Domain evaluation is pure and defaults to DENY. ALLOW requires ACTIVE User, ACTIVE Tenant, ACTIVE actor Membership, correct User/Tenant/resource associations, a registered action and approved catalog, and a currently effective RoleGrant. That same grant must supply **all required permissions and the matching scope**, followed by trusted resource relationship, resource-state, and freshness checks. Permission from grant A cannot combine with scope from grant B; unrelated scopes cannot be unioned into TENANT authority.

Grant validity remains `validFrom <= now < validUntil`, with null validUntil unbounded and any revokedAt terminal. Disabled/archived global state, PENDING/DISABLED/LEFT actor Membership, revoked/expired/future grant, missing or malformed facts, unknown action/scope/catalog, or storage failure cannot produce ALLOW. Committed revocation removes authorization on the next fresh decision; retaining a login Session does not retain revoked tenant rights. Explicit Membership recovery does not revive terminal grants.

Scopes remain SELF, CLASS, COURSE, TENANT. SELF requires actual actor ownership; conflicting User/Membership subject facts reject even if one matches. CLASS and COURSE require exact identifiers and do not imply one another. TENANT is limited to the verified current Tenant and the action's explicit coverage rule, never a general relationship bypass. SYSTEM and arbitrary string scopes are not introduced.

The production Identity composition accepts authenticated actor identity, action and Membership locators, not client-owned relationship/owner/role booleans. It loads real scoped Membership associations and minimal global state. Pure Domain resource facts are ordinary values: types, Object.freeze, or issuance checks do not establish a real Course/Class relationship. Current production actions are Identity membership management only. Course/Class/Enrollment/TeachingAssignment loaders and their permissions remain with their future resource units; CLASS/COURSE delegation is closed without those trusted loaders.

SYSTEM_ADMIN stays an independent SystemAdminGrant. The implemented control-plane eligibility predicate requires ACTIVE global User and a current grant for that User; it neither approves every control action nor grants tenant teaching access. SYSTEM_ADMIN cannot become a Membership RoleGrant, TENANT_ADMIN fallback, SYSTEM scope, or synthetic Tenant.

## Catalog, actions, and delegation freeze

The initial manifest, action version and delegation version are `identity-v1`:

| RoleCode | Approved current permissions |
| --- | --- |
| STUDENT | Empty set; no implied Identity management or future teaching permission |
| TEACHER | Empty set; teaching permissions require separate resource approval |
| TENANT_ADMIN | `membership:read`, `membership:manage`, `role:assign`, within the current Tenant |

`ApprovedIdentityCatalog` requires explicitly provisioned stable distinct UUIDv7 RoleIds, an approvalRecord, and the expected canonical content digest. Missing/invalid configuration or digest mismatch fails closed. Test fixture IDs are not production defaults. This phase implements and verifies the adapter/configuration contract; it does **not** provision a production catalog, bootstrap administrator, or enable endpoints. Those explicit approved values must be recorded at the later server composition/configuration step.

The catalog is immutable and binds its exact role/permission content, catalog version, action/delegation versions, and approval record. No hot reload, V1 template import, implicit role string hierarchy, or rolling permission-shrink safety is claimed. Catalog changes must follow the design's approve/close affected entrypoints/drain/switch all instances/verify/reopen protocol; missing or mixed configuration stays closed.

| Closed Identity action | Required permissions from one effective TENANT grant |
| --- | --- |
| MEMBERSHIP_READ | membership:read |
| MEMBERSHIP_DISABLE / MEMBERSHIP_LEAVE_ADMIN | membership:manage |
| MEMBERSHIP_ACTIVATE / MEMBERSHIP_REACTIVATE / MEMBERSHIP_REJOIN | membership:manage AND role:assign |
| ROLE_GRANT / ROLE_REPLACE / ROLE_REVOKE | role:assign |

Each action retains its current target-state and existing Domain transition checks. No public invite, accept, student self-leave, profile, global User/Tenant management, or teaching action is inferred from a similar permission name.

Delegation is authorized against the actor's fresh **pre-mutation** state and one TENANT_ADMIN/TENANT grant with role:assign. The explicit ceiling permits STUDENT/SELF, STUDENT or TEACHER/CLASS or COURSE only with real resource facts, and TENANT_ADMIN/TENANT only for another ACTIVE User's scoped Membership. Unlisted combinations deny. TENANT_ADMIN is not unlimited delegation. Giving oneself a new/restored management grant is blocked; a proposed post-state grant cannot authorize its own creation.

New grants receive createdAt and validFrom from the fresh in-transaction Clock, not client timestamps, and cannot outlive the authorizing grant. Preserve-existing recovery retains immutable historical timestamps only for explicitly selected currently effective grants within the same ceiling. Revoked, expired or future grants cannot be used as restored current authority. Actual approval provenance, invitation acceptance and 1B1-F05 remain 1B-8 responsibilities; a field named approvedGrant is not independent proof of human approval.

## Freshness, last-admin, and transaction freeze

Every authorization reads current state rather than caching a Permission snapshot. The internal receipt binds actor/target identities, Tenant/action/resource/request correlation, current actor authorizationVersion, actor/target Membership revisions, User revisions, Tenant revision, matched grant, evaluation time, and catalog/action/delegation versions/content digest. It is not a public bearer certificate or durable permission to write later.

RepositoryRevision stays a canonical positive signed-int8 decimal string validated with BigInt; Membership authorizationVersion stays its independent JS-safe counter. No Number revision arithmetic, xmin, automatic retry, or stale-before-no-op bypass is introduced. Current true no-op preserves revision/version and emits no extra mutation audit; real mutation uses the existing exactly-once Domain/version and repository CAS rules. Maximum revision/authVersion mutations fail closed.

Initial authorization reads use one READ ONLY REPEATABLE READ transaction. Sensitive mutations use the following dedicated same-client READ COMMITTED protocol, not a combination of independent auth/control/tenant transactions:

```text
BEGIN + LOCAL TenantContext
→ helper locks Tenant row, then sorted related Users FOR SHARE
→ sorted actor/target Membership parent locks
→ fresh complete scoped roster/grants/global associations + trusted Clock
→ re-authorize and compare all receipt/version/catalog bindings
→ delegation against pre-state + last-admin check on complete proposed post-state
→ existing parent CAS / child history + closed audit on the same client
→ final time/authority/operational-admin recheck
→ checked COMMIT + release
```

The mutation primitive accepts one or two distinct existing target Memberships, not arbitrary SQL callbacks, a raw client capability, a generic UnitOfWork, or partial-success batches. Existing Membership client-bound mechanics are reused internally without changing its public Port, authenticity, CAS, history or no-op semantics. Privileged mapper production consumers/allowlists are not widened. Any transition, insert, CAS, audit, final time validation or commit failure rolls back the whole operation; second-target failure cannot commit the first target.

Last-admin counts distinct Membership/User associations, never grant rows. Governance count requires ACTIVE Membership with a current TENANT_ADMIN grant. Operational count additionally requires ACTIVE User and TENANT scope with the approved management permissions. The complete proposed state must retain both counts above zero. PENDING/DISABLED/LEFT members and future/expired/revoked grants do not count; a disabled User cannot be a usable successor. Atomic replacement must establish a valid successor within the same transaction, not rely on a future grant or later repair.

Independent real PG16 connections and acknowledged row-lock waits prove that concurrent two-admin removals cannot both commit to zero administrators: after the first commit, the waiting transaction rereads the roster and rejects removal of the last administrator. Both User-disable orderings and both Tenant-disable orderings are verified through the approved row locks, including the distinction between FOR SHARE and insufficient FOR KEY SHARE. Authority expiry during mutation, audit failure and second-target failure prove full rollback.

This guarantee is scoped to the typed guarded primitive. Existing low-level repository calls and arbitrary trusted SQL do not automatically acquire it. 1B-8C must route **every protected use-case entrypoint** through the protocol and prove no bypass with integration/call-site tests. Natural grant expiry and emergency global User disable can still leave a Tenant without a usable administrator; this freeze does not promise a perpetual administrator-count invariant or block an urgent security disable. Controlled recovery, expiry operations and future multi-entity lock-order changes require separate design.

## Database capability, RLS, and audit freeze

Migration inventory is 0001–0007. Applied 0001–0006 remain byte/blob unchanged from the design baseline; no historical checksum was rewritten. `0007_identity_authorization_state.sql` contains only the approved function, two owner-scoped SELECT policies, and exact ownership/EXECUTE ACL. It adds no business table, runtime role, role inheritance, direct global table grant, or startup DDL. CI proves parse/apply, second CLI no-op, checksum drift rejection, failed next test-only migration rollback without a ledger entry, and migration advisory serialization. This is not evidence that a production database has been migrated.

The sole approved exception is `zhiban_identity.authorization_state(uuid,uuid,uuid[],text)`: SECURITY DEFINER, owner `zhiban_identity_owner`, VOLATILE, PARALLEL UNSAFE, fixed `search_path = pg_catalog, zhiban_identity, pg_temp`, and `row_security = on`. All prior Identity functions retain their invoker contract; unknown/overloaded definers are not blanket allowed.

Only `zhiban_runtime` may execute this signature; PUBLIC, auth runtime and control runtime cannot. Runtime role attributes/ownership/inheritance remain unchanged. The two new policies permit only owner SELECT on memberships/role_grants with `tenant_id = current_tenant_id()`; FORCE RLS and existing runtime policies remain. Tenant runtime still cannot directly read Users/Tenants or Credential/Session security tables. No verifier, token digest, global profile, arbitrary User query or global enumeration capability is added.

Modes are exactly READ_CONTEXT and GUARD_MEMBERSHIP. Explicit Tenant parameter must match LOCAL context; the connection must be the expected tenant runtime. Actor must be an ACTIVE scoped Membership, and all targets must already belong to the Tenant. Invalid identifiers, missing context, foreign/duplicate/excess targets or unknown mode reject. Application separately binds the actor Membership's User to authenticated UserId; DB connection identity is not browser authentication.

The fixed TABLE projection is only fact kind, Tenant state/revision and actual Membership-to-User state/revision associations. READ_CONTEXT returns actor/target facts, not the administrator roster. GUARD_MEMBERSHIP derives the complete related User set from scoped actor/targets and ACTIVE Memberships with unrevoked admin grants, including future/expired candidates before the final validity calculation. It locks sorted Users FOR SHARE and rejects the entire operation above 256 distinct Users rather than truncating. Missing, conflicting, malformed or incomplete records fail closed. The helper does no business mutation/audit and does not issue ALLOW or an authentication certificate.

Role/Membership mutations reuse existing closed audit vocabulary and payload projection, on the same client/transaction as persistence. No IdentityAuditEvent union expansion or arbitrary JSON decision audit is introduced. Passwords, verifiers, bearer tokens, digests, provider details and raw SQL/error cause are not part of authorization receipts or audit payloads. Driver/caller failures are sanitized at the boundary. Public denial normalization and decision audit are deferred to 1B-8.

## Real CI evidence and targeted test repair

Implementation checkpoint `42ca260edd2a553d7e19e6931ff1d1460a1a41d8`, [run 37092573259](https://github.com/yhouzxm/OpenMAIC/actions/runs/37092573259), passed the original 121 PG16 tests and 46 of 47 Authorization tests in the first run. AUTHZ-PG17 expected an array for `pg_policies.roles`, but the current pg driver returned its `name[]` as a string. The assertion failed; the second round and later regression/tooling steps were not executed. That run was not accepted as signoff and was not automatically rerun.

The final repair candidate `b0fb6b2d442cd7b51c75ad1c32527d3d69332526`, parent `42ca260edd2a553d7e19e6931ff1d1460a1a41d8`, has subject `test(zhiban-v2): normalize authorization policy roles array`. It changes one test-query expression to `roles::text[] AS roles`, preserving the exact owner, SELECT command, tenant qualifier and all other ACL/RLS assertions. No production/migration semantics changed and no new migration was needed. This catalog-test decoding gap was resolved before freeze, not hidden by skipping or weakening a security test.

Final [run 37093587008](https://github.com/yhouzxm/OpenMAIC/actions/runs/37093587008) is a new workflow_dispatch bound to that exact candidate, completed SUCCESS without rerun. Actual logs contain both PG16 RUN/PASS marker pairs, all nine suites in each round, all six regression command groups, and executed lint/typecheck steps:

| Final evidence | Result |
| --- | --- |
| Workflow / event / head / conclusion | Zhiban Identity PG16 Security / workflow_dispatch / `b0fb6b2d442cd7b51c75ad1c32527d3d69332526` / SUCCESS |
| PostgreSQL / runner / Node | 16.15 (Debian 16.15-1.pgdg13+2) / Ubuntu 24.04 Linux / v22.23.3 |
| Frozen install / Argon2 runtime regression | PASS / `@node-rs/argon2@2.2.1` actual hashing/verifier tests PASS |
| PG16 Run 1 / Run 2 | 168/168 PASS each |
| Original eight PG16 suites | 10 + 4 + 5 + 8 + 5 + 21 + 35 + 33 = 121/121 PASS each run |
| Authorization real PG16 | 47/47 PASS each run; AUTHZ-PG17 included |
| Static role/migration/runner | 29/29 PASS |
| Domain and Port contracts | 377/377 PASS |
| Credential unit/contracts | 99/99 PASS |
| Session unit/contracts | 50/50 PASS |
| Existing repository regression | 133 + 116 + 70 + 29 + 4 = 352/352 PASS |
| Authorization Policy / Application / repository / schema | 65 + 11 + 29 + 5 = 110/110 PASS |
| Full Identity regression | 29 + 377 + 99 + 50 + 352 + 110 = 1017/1017 PASS |
| Root lint / typecheck | PASS, 0 errors and 20 existing warnings / PASS with command-scoped 8GB heap |

The original 905 regression tests are retained. The increase to 1017 is 110 Authorization tests plus one migration upgrade contract and one Domain subtree-import architecture regression. The latter permits only relative imports resolving inside the same Domain root; forbidden dependencies and DH07 mapper capability checks remain. All original real role/RLS, global/Membership CAS, stale-before-no-op, aggregate atomicity, actual 40001/40P01, Credential and Session suites continue to pass twice. No second workflow or reduced security suite was introduced.

The 47 real Authorization cases cover active/inactive state, exact scopes and no stitching, current versions/revocation, last-admin and atomic transfer, independent concurrent removals, global-state races, exact function ACL/RLS/search_path, bounded roster, max revision/authVersion, complete audit/second-target rollback and resource cleanup. The malformed SELECT-record case is explicitly fault-injected; it is not misrepresented as invalid data successfully persisted past database constraints. Unit SQL harnesses do not replace those real execution results.

FINAL P0: 0. FINAL P1: 0. FINAL P2: 0. The earlier catalog-test finding is closed by the final candidate and run. This docs-only round does not rerun the signed-off tests or CI.

## Deferred boundaries and forbidden regressions

DEFERRED_TO_1B8_AUTH_API:

- 1B-8A application/security composition design, explicit production catalog RoleIds/approval/digest provisioning, identifier UX/resolver and production ID service configuration.
- Approval provenance and 1B1-F05 pending-origin semantics; first Membership/admin bootstrap, no-admin recovery, explicit control-plane action approvals and operational recovery ownership.
- Actual Identity commands, idempotency and all protected entrypoints wired through the guarded same-client protocol; no low-level repository bypass accepted as authorized behavior.
- Session freshness/revocation execution point for sensitive writes, including initial authentication followed by Session revocation or User disable/restore. Current ACTIVE User alone is not proof of a still-valid Session. Future multi-User/control/membership composition must preserve or independently review lock order.
- Natural administrator grant expiry, emergency global disable and Tenant restore coordination; recovery/transfer responsibility rather than a fictitious perpetual last-admin invariant.
- Public login/logout/tenant-selection and membership APIs, safe DTOs, non-enumerating public error/401/403/404 normalization, real HTTP cookie extraction/setting/clearing, Origin/CSRF enforcement, distributed/IP admission/rate controls and application decision audit.
- Reset/re-auth/recovery channels only after explicit channel/identity-approval decisions; no fake sender, missing screening corpus or absent deployment limiter may silently become a production default.

DEFERRED_TO_RESOURCE_PHASES: real Course/Class/Enrollment/TeachingAssignment relationship loaders; separately approved teaching Permission/action increments; resource-state/version and mutation locks; query/list/export scope enforcement and long-stream/background revalidation. This generic scope Policy does not certify unimplemented resource actions.

OUT_OF_SCOPE: public API/UI implementation in this round, MFA, OAuth/OIDC, JWT, OpenMAIC Identity Bridge, Course/Class domain implementation, Portals, V1 data migration, production database application and production cutover.

Later work must preserve default DENY, the active chain, same-grant all-permissions-and-scope checks, explicit resource facts, approved immutable catalog and ceiling, no self elevation/SystemAdmin fallback, current versions/time, terminal history, same-client guard/CAS/audit, bounded minimal DB capability, exact definer/RLS exception and unchanged applied migrations. A primitive's successful CI is not proof that future HTTP/worker entrypoints cannot bypass it. Starting 1B-8 requires this closeout checkpoint and separate design authorization; this document does not authorize implementation or rollout.

PHASE_1B7: COMPLETE

AUTHORIZATION_DESIGN: FROZEN

AUTHORIZATION_CONTRACT: FROZEN

AUTHORIZATION_IMPLEMENTATION: FROZEN

REAL_PG16_SIGNOFF: PASS

FULL_IDENTITY_REGRESSION: 1017/1017 PASS

A7_01: CLOSED_IN_1B7_SCOPE

A7_02: CLOSED_IN_1B7_SCOPE

A7_03: CLOSED_IN_1B7_SCOPE

FROZEN_CONTRACT_CONFLICT: NO

ROLE_CONTRACT_GAP: RESOLVED_WITHIN_APPROVED_A7_03_CAPABILITY

P0: 0

P1: 0

P2: 0

DEFERRED_TO_1B8: AUTH/API_COMPOSITION_AND_ENTRYPOINT_ENFORCEMENT

READY_FOR_1B7_CLOSEOUT_CHECKPOINT: YES

READY_FOR_1B8: YES_AFTER_CLOSEOUT_CHECKPOINT_AND_SEPARATE_DESIGN_AUTHORIZATION
