# Phase 1B-4 Identity PostgreSQL Repository Layer Closeout

STATUS: CLOSED / FROZEN

READY_FOR_1B5: YES

Date: 2026-10-02. Branch: `refactor/zhiban-v2`. Audited implementation HEAD: `caa6b5a4f6a30608de59a46a86d4b20e02a452a4`.

This closes Phase 1B-4 implementation and real PostgreSQL 16 verification. It does not authorize starting Credential implementation, enable application authorization flows, or certify a production deployment. This documentation change awaits independent review/checkpoint; no commit or push is performed in this closeout.

## Scope and sources of authority

The frozen scope comprises 4A design, 4B-1A persistence rehydration hardening, 4B-1B repository contracts/Fakes, 4B-2A precise mapper boundary and its testability amendment, 4B-2 mappers/transactions, the 4B-3 authenticity prerequisite, global repositories, the 4B-4 Membership aggregate repository, and 4B-5 real PG16 signoff.

The audit uses actual repository files and Git history, not earlier chat reports as substitutes for code:

- [4A repository design](phase1b-4a-repository-design.md), [schema review](schema-review.md), [3B security implementation review](phase1b-3b-1-review.md), and [3B real PG16 review](phase1b-3b-2-review.md).
- [Application repository ports](../../../lib/zhiban/application/identity/ports/identity-repository.ts), [Tenant port](../../../lib/zhiban/application/identity/ports/tenant-repository.ts), [Membership port](../../../lib/zhiban/application/identity/ports/membership-repository.ts), [revision/Loaded types](../../../lib/zhiban/application/identity/ports/repository-types.ts), [TenantContext](../../../lib/zhiban/application/identity/ports/tenant-context.ts), [errors](../../../lib/zhiban/application/identity/ports/errors.ts), and [contract Fakes](../../../tests/zhiban/identity/contracts/fakes.ts).
- Domain [User](../../../lib/zhiban/domain/identity/user.ts), [Tenant](../../../lib/zhiban/domain/identity/tenant.ts), [SystemAdminGrant](../../../lib/zhiban/domain/identity/system-admin-grant.ts), [Membership](../../../lib/zhiban/domain/identity/membership.ts), [RoleGrant](../../../lib/zhiban/domain/identity/role-grant.ts), [persistence validation](../../../lib/zhiban/domain/identity/persistence-validation.ts), and [privileged rehydration](../../../lib/zhiban/domain/identity/persistence-rehydration.ts).
- [Checked mapper values](../../../lib/zhiban/infrastructure/identity/postgres/mappers/checked-values.ts), [User mapper](../../../lib/zhiban/infrastructure/identity/postgres/mappers/user.ts), [Tenant mapper](../../../lib/zhiban/infrastructure/identity/postgres/mappers/tenant.ts), [SystemAdminGrant mapper](../../../lib/zhiban/infrastructure/identity/postgres/mappers/system-admin-grant.ts), and [Membership mapper](../../../lib/zhiban/infrastructure/identity/postgres/mappers/membership.ts).
- [Transactions](../../../lib/zhiban/infrastructure/identity/postgres/transactions.ts), [repository support](../../../lib/zhiban/infrastructure/identity/postgres/repositories/repository-support.ts), [User/global Identity repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/user.ts), [Tenant repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/tenant.ts), [SystemAdminGrant repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/system-admin-grant.ts), and [Membership repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/membership.ts).
- [DH07 guard](../../../tests/zhiban/identity/domain/privileged-capability-guard.ts), [terminal contract](../../../tests/zhiban/identity/domain/mapper-terminal-contract.ts), [mapper boundary fixtures](../../../tests/zhiban/identity/domain/mapper-boundary.test.ts), [PG16 repository signoff](../../../tests/zhiban/identity/postgres/pg16-repository-signoff.test.ts), [PG16 transaction tests](../../../tests/zhiban/identity/postgres/pg16-transactions.test.ts), and the [existing PG16 workflow](../../../.github/workflows/zhiban-identity-pg16-security.yml).

## Verified checkpoint ancestry

All checkpoints below exist and pass `git merge-base --is-ancestor <SHA> HEAD` against the audited HEAD. No history was rewritten.

| Frozen unit | Checkpoint SHA | Commit subject |
| --- | --- | --- |
| 4A | `92d95d5420cfb2ec08a38eed9c18e6a19715b98e` | docs(zhiban-v2): freeze identity repository design |
| 4B-1A | `67f95884bf7c849dad05350a023449b107706f61` | feat(zhiban-v2): harden identity persistence rehydration |
| 4B-1B | `63bddb1904cb272cb053182a521e13844fd7b12f` | feat(zhiban-v2): harden identity repository contracts |
| 4B-2A | `f662af11e053cf6365bfe291f77c07a52bce363c` | test(zhiban-v2): define precise identity mapper boundary |
| 4B-2A testability | `0a1326ba633dc41b9dfa2a15d5620c503f5a2082` | test(zhiban-v2): allow identity mapper test consumers |
| 4B-2 | `6d4fa7da9650d1603a8cd548aad9c004f22a2c63` | feat(zhiban-v2): add identity postgres persistence primitives |
| 4B-3 authenticity | `1262a5fbd406ad6b641c3047cc7479ae5cac563b` | feat(zhiban-v2): add identity persistence authenticity assertions |
| 4B-3 global repositories | `19cf01fdfb36a2ff0f4ddef0812124db3dfdcaea` | feat(zhiban-v2): add global identity postgres repositories |
| 4B-4 Membership | `e1d4394b7aadbf4991cb7da9634fe7a767ba11ba` | feat(zhiban-v2): add membership aggregate postgres repository |
| 4B-5 suite | `73450ca21b8a95b6c1a9a78630bfc12903448bb3` | test(zhiban-v2): add pg16 repository signoff suite |
| SG21 / final candidate | `caa6b5a4f6a30608de59a46a86d4b20e02a452a4` | test(zhiban-v2): fix cross-platform capability path assertion |

## Frozen contracts

### RepositoryRevision and TRUE NO-OP

`RepositoryRevision` is repository metadata, not Domain state: a canonical positive signed int8 decimal string in `1..9223372036854775807`. Validation uses the exact decimal grammar and BigInt bounds. Revision never passes through JS Number, parseInt, parseFloat, or `xmin`.

The save protocol is original-candidate authenticity, load/lock stored row, absence semantics, expected revision comparison, immutable/lifecycle validation, full persistence equality, then no-op or CAS mutation. Revision token syntax validation does not substitute for comparing the token with the locked database row. Missing save targets follow the frozen conflict semantics; missing find results are null.

Stale is checked before no-op. A genuine no-op requires complete persistence equality, performs no UPDATE or child write, preserves revision, and returns the current stored `Loaded<T>`, not the caller's candidate wrapped as Loaded. State-changing SQL increments `repository_revision` exactly once under its CAS predicate. BigInt next-revision checks validate the returned result; they are not a JS-number increment. Mutation at int8 maximum fails closed; a genuine no-op at maximum remains valid. SQL command, row count, and RETURNING shape are validated; an impossible zero/multiple-row result is not blindly interpreted as a stale write.

### Original candidate authenticity

User, Tenant, SystemAdminGrant, and Membership saves validate the original caller candidate before projection, comparison, grant inspection, or SQL. Entity-specific persistence assertions reuse the existing lexical/module-private issued-instance WeakSets. Correct prototype, instanceof, copied fields/getters, and Object.freeze do not establish issuance: prototype-forged candidates fail closed with the existing Domain invalid-entity semantics.

Assertions perform no transition or mutation and expose no token, registry, factory, or rehydration capability. Mapper round-tripping proves the new rehydrated instance, never the original candidate. Business-command probes are forbidden. Persistence-only assertions do not expose privileged rehydration through the standard Domain barrel.

### Membership authVersion

RepositoryRevision prevents database lost updates; authVersion controls authorization-state evolution. Neither replaces the other.

| Candidate compared with stored authVersion | Frozen save result |
| --- | --- |
| Lower | REJECT |
| Equal, entire persistence state identical | TRUE NO-OP, after current revision check |
| Equal, any parent or RoleGrant persistence difference | REJECT |
| Higher | Mutation may proceed only after authenticity, tenant, revision, immutable, lifecycle/history, and persistence invariant checks |

Full equality covers Membership id, userId, tenantId, status, authVersion, createdAt, updatedAt, disabledAt, disabledReason, and ordered complete RoleGrant history. Each child comparison covers id, roleCode, scope, createdAt, validFrom, validUntil, and revokedAt. Global entity comparisons likewise enumerate their complete frozen persistence fields, including nullable lifecycle/history fields; no JSON.stringify equality framework is used.

Membership id/tenantId/userId and immutable creation/ownership fields cannot change. Existing history cannot be erased, reordered, rewritten, or revived by a higher authVersion. Global repositories retain their entity-specific immutable and lifecycle checks.

## Persistence and security boundaries

Rows pass explicit runtime validation and field projection before privileged persistence rehydration yields authentic Domain entities. Writes use explicit mapper parameter projection, not arbitrary spread, reflection, generic serialization, or transition replay. UUIDv7 structure, enums/status, exact fields, nullable values, canonical integer grammar, ranges, and relevant text representation are fail-closed. SQL NULL, missing/undefined, empty string, and zero are not interchangeable.

authVersion is validated as canonical nonnegative decimal int8 input within `0..9007199254740991` before Number conversion. Instant is epoch milliseconds in `0..8640000000000000`, validated before safe-integer conversion; no Date, clock, locale parsing, or normalization repair reconstructs timestamps. RepositoryRevision stays outside Domain persistence state.

The exact privileged terminal mapper directory is `lib/zhiban/infrastructure/identity/postgres/mappers/**`. Certified terminal mapper exports have production consumers only inside the frozen repository boundary. Application, Domain, OpenMAIC, unrelated Infrastructure, production barrels, generic reconstruction, and raw capability escape remain forbidden. Directory membership alone is not a blanket permission for arbitrary exports.

The testability amendment permits `tests/zhiban/identity/postgres/**` to import/call legal terminal mappers for runtime result verification. It does not permit direct privileged capability imports, capability forwarding, mapper re-exports, exported alias/object/class wrappers, generic reconstruction services, or dynamic-load laundering. Legal test → terminal mapper → internal capability dependency is not misclassified as a direct capability import. Existing outside-boundary attacks remain blocked.

RoleGrant reconstruction is a non-exported Membership-mapper child helper. There is no independent RoleGrant repository or business CAS boundary and no generic reconstruction framework.

## Aggregate and concurrency semantics

Membership is the aggregate root. Loads preserve active, future, expired, and revoked history without effective-only filtering. Tenant/membership child associations are validated by the mapper in addition to SQL predicates, composite FK, and RLS.

`grant_ordinal` is Infrastructure-only BIGINT metadata, never Domain state or an unsafe JS number. The mapper validates and sorts BigInt ordinals and requires deterministic contiguous zero-based order. Current persistence appends new grants and performs first revocation updates; it does not delete/reinsert old history. New ordinal allocation is protected by the locked parent and checked against the expected aggregate order.

Writes lock the tenant-scoped parent, check revision/authVersion/invariants, perform parent CAS, persist children, and verify the resulting aggregate, all on one exclusive client in one tenant transaction. Parent or child failure rolls back the entire operation, including revision changes. Identical no-op reaches none of those mutation statements. Membership reads use the existing repeatable-read read-only transaction mode so parent and children come from one consistent snapshot.

Global repositories use control transactions only: no TenantContext, tenant GUC, or pool.query bypass. Real coordinated two-client tests prove exactly one different mutation wins from the same revision, revision advances once, and an old-revision no-op is stale. Membership races additionally prove a single winner's authVersion and complete history, with no mixed or partial child state.

This protocol protects repository clients; it is not a claim that arbitrary trusted SQL can never violate application CAS rules. Runtime credentials remain a trusted Infrastructure boundary, and application authorization is not inferred from possession of a TenantContext.

## Tenant isolation and transactions

TenantContext is scoping context only, not authorization/session/membership proof. Isolation layers are explicit repository tenant predicates, validated parent/child tenant association, transaction-local `app.tenant_id`, and database RLS/composite constraints. Tenant-owned memberships and role_grants have enabled/FORCE RLS under the frozen schema. Restricted runtime roles are non-superuser, NOBYPASSRLS, non-owner, and retain the bootstrap's NOCREATEDB/NOCREATEROLE restrictions and least-privilege ACLs. Tenant runtime cannot access control-plane-only Tenant resources. No grants, policies, roles, or schema were relaxed for signoff.

Tenant transaction order is exclusive connect → BEGIN → `set_config('app.tenant_id', ..., true)` → work → COMMIT → release. Context is set on the same client/transaction before tenant queries. Control transactions omit the GUC. Session-global SET, a second-client GUC, pool.query inside the transaction, and cross-tenant fallback are forbidden. Missing/invalid/unknown context fails closed, and commit/rollback plus max=1 physical connection reuse leave no tenant context leakage.

Connect, BEGIN, set_config, work, COMMIT, ROLLBACK, and release failure paths retain exactly-once release for acquired clients. Cleanup errors do not unconditionally replace an existing primary error; uncertain/broken clients are not returned as reusable clean connections. COMMIT must return a COMMIT command tag: PostgreSQL's aborted-transaction ROLLBACK tag fails closed.

Only safely narrowed real SQLSTATE 40001 and 40P01 map to `RETRYABLE_PERSISTENCE_FAILURE`. Unknown, connection, permission/RLS, unique/FK/check, and other SQLSTATE errors are not misclassified. Automatic retry is absent. No generic UnitOfWork/TransactionManager/RepositoryManager or audit orchestration was added.

## Final real PostgreSQL 16 evidence

The closeout re-read the completed run metadata and logs; no dispatch or rerun was needed.

| Evidence | Verified value |
| --- | --- |
| Workflow | Zhiban Identity PG16 Security |
| Run | [36976848311](https://github.com/yhouzxm/OpenMAIC/actions/runs/36976848311) |
| Event / branch | workflow_dispatch / refactor/zhiban-v2 |
| Head SHA | `caa6b5a4f6a30608de59a46a86d4b20e02a452a4` |
| Status / conclusion | completed / SUCCESS |
| Runtime server_version | 16.15 (Debian 16.15-1.pgdg13+2) |
| PG16 suite RUN 1 | 53/53 PASS |
| PG16 suite RUN 2 | 53/53 PASS, same PG16 environment |

Both run markers and PASS markers appear in the logs. These are real PG16 tests, not mocks or static SQL assertions. The existing guarded disposable harness was reused; administrator access is limited to setup/seed/catalog/cleanup and behavioral RLS assertions use the actual restricted runtime roles. No PG18 substitute or local PG16 installation was used.

| Suite executed in each PG16 round | Tests |
| --- | ---: |
| pg16-role-bootstrap.test.ts | 10 |
| pg16-migration-runner.test.ts | 4 |
| pg16-schema-security.test.ts | 5 |
| pg16-rls.test.ts | 8 |
| pg16-transactions.test.ts | 5 |
| pg16-repository-signoff.test.ts | 21 |
| Total per round | 53 |

### Real signoff matrix

| Verification | Final result |
| --- | --- |
| ROLE SECURITY / control-plane ACL | PASS |
| RLS CATALOG | PASS |
| TENANT READ ISOLATION | PASS |
| TENANT WRITE ISOLATION | PASS |
| MISSING CONTEXT (also invalid/unknown) | FAIL_CLOSED |
| TENANT GUC LIFECYCLE | PASS |
| POOL TENANT LEAKAGE | NONE |
| GLOBAL CAS CONCURRENCY | PASS |
| GLOBAL STALE-BEFORE-NO-OP | PASS |
| MEMBERSHIP CAS CONCURRENCY | PASS |
| MEMBERSHIP AUTHVERSION | PASS |
| AGGREGATE ATOMICITY | PASS |
| ABORTED COMMIT | PASS |
| REAL 40001 | PASS |
| REAL 40P01 | PASS |
| RETRYABLE CLASSIFICATION | PASS |
| AUTO RETRY | NO |

Concurrency uses explicit lock/barrier coordination rather than arbitrary sleeps. Real SERIALIZABLE conflicts and deadlocks produce the PostgreSQL SQLSTATEs before classification; hand-thrown mock codes do not supply this evidence. The controlled real child failure proves parent revision, revocation, and inserted history roll back together. Both rounds pass without skipping assertions or changing timeouts.

## Final test evidence and severity

| Final candidate CI gate | Result |
| --- | --- |
| Bootstrap/migration static regression | 26/26 PASS |
| Identity Domain / Port contract regression | 376/376 PASS |
| DH01–DH07, RHY01–RHY16, TOCTOU and boundary/security regression in that suite | PASS |
| Full DH07 fixtures | 158 PASS |
| SG21 on Linux | PASS |
| Root lint, actually executed | PASS: 0 errors, 20 existing warnings |
| Root typecheck, actually executed | PASS |

The workflow's typecheck uses process-scoped `NODE_OPTIONS=--max-old-space-size=8192`; it is not a permanent environment change. The prior local serial 754/754 regression evidence remains historical implementation/fix evidence, not the count of tests run by this CI job. This docs-only closeout does not rerun it or PG16 CI.

FINAL P0: 0. FINAL P1: 0. FINAL P2: 0. The completed scope has no open security/correctness findings. Later-phase work below is not misrepresented as completed or as an unresolved defect in this repository-layer signoff.

## Deferred-item reconciliation

Historical documents retain their original checkpoint context. This section supersedes their deferred status only for the explicitly completed persistence scope.

| Historical item | Classification | Disposition |
| --- | --- | --- |
| 1B1-F02 persistence constructor/rehydration hardening | CLOSED_IN_1B4 | Lexical issuance, persistence validation, DH/RHY/TOCTOU, exact mapper boundary and original-candidate assertions completed. |
| Local PG16 unavailable as a signoff blocker | CLOSED_IN_1B4 | Real GitHub PG16 16.15 evidence closes the verification gap; local installation availability itself has not changed. |
| Original 32 real PG16 deferred tests | CLOSED_IN_1B4 | The 27 role/migration/schema/RLS tests plus 5 transaction tests are included in each final 53-test round, together with 21 repository signoff tests. |
| Global/Membership CAS, RLS, context reuse, snapshot/aggregate atomicity, aborted COMMIT, actual retryable errors | CLOSED_IN_1B4 | Final real PG16 suite passes twice. |
| grant order, same-authVersion/no-op, precision, and retry classification persistence questions | CLOSED_IN_1B4 | Actual mapper/repository/transaction contracts and real verification now establish the frozen rules above. |
| SG21 Linux expected-path failure | CLOSED_IN_1B4 | New candidate fixes test-local platform expectation; actual Linux regression passes with guard semantics unchanged. |
| Local parallel test/worker resource timeouts | CLOSED_IN_1B4 | Independent serial 754/754 rerun passed without timeout changes; final Linux CI gates are stable and green. |
| Old failed run 36973167899 as final signoff evidence | OBSOLETE | It belongs to the pre-SG21 candidate and cannot replace the final run. |
| Earlier broad mapper allowlist / blanket prohibition on test consumers | OBSOLETE | Precise 2A production repository-only rule and restricted testability amendment supersede them; capability restrictions remain. |
| Historical 4A repository NOT IMPLEMENTED / not-ready markers | OBSOLETE | Superseded only for the units completed here, not for application/security phases still below. |

The following remain in their original later-phase ownership, not silently closed by a green repository CI:

| Remaining item | Classification / owner |
| --- | --- |
| Credential identifier/schema/hash/verification/secret handling | STILL_DEFERRED_TO_LATER_PHASE — 1B-5 |
| Session implementation, SessionId ownership/unpredictability, digest/expiry/cookie/CSRF/rotation; 1B2-F07 | STILL_DEFERRED_TO_LATER_PHASE — 1B-6 |
| Authorization policies, grant ceiling/last-admin rules, permission/catalog evolution and invalidation | STILL_DEFERRED_TO_LATER_PHASE — 1B-7 / application integration |
| Approval/invite/recovery/tenant discovery/idempotency; 1B1-F05 | STILL_DEFERRED_TO_LATER_PHASE — original application phase ownership (1B-8) |
| Audit application integration and mutation+audit same-client composition | STILL_DEFERRED_TO_LATER_PHASE — 1B-8; standalone repository auto-transactions do not promise atomic audit application orchestration |
| Global/control-plane status versus tenant authorization serialization | STILL_DEFERRED_TO_LATER_PHASE — 1B-7/1B-8; no cross-pool ACID or widened role privileges are implied |
| UUIDv7 issuance service / configured RoleId catalog and later Course/Class resources | STILL_DEFERRED_TO_LATER_PHASE — corresponding Infrastructure/resource phases |
| OpenMAIC Identity Bridge / V1 mapping and migration | STILL_DEFERRED_TO_LATER_PHASE — 1B-9 or separately authorized phase; no legacy permission model is promoted to the V2 model |
| Production connection/secret/backup/recovery/deployment hardening, including PUBLIC CONNECT disposition | STILL_DEFERRED_TO_LATER_PHASE — deployment scope; ephemeral CI is not production certification |

Schema review's 3A-N01/N02/N03 notes require split disposition: NUL/surrogate persistence validation and deterministic grant/no-op rules are closed; credential/session identifier length/index and temporal policy, catalog upgrade policy, and application integration remain with their later owners. Real ledger/role verification is complete, but that does not close Session service behavior. A future metadata-only same-authVersion mutation is not an implicit exception: the frozen rule rejects any persistence difference and changing it requires explicit new contract review.

## Forbidden future regressions

Later phases must not bypass RepositoryRevision, authVersion, original-candidate authenticity, TenantContext, repository predicates, RLS, aggregate ownership, or transaction primitives for convenience. Specifically forbidden are stale-as-no-op acceptance, JS-number revision arithmetic, effective-only history loading, independent RoleGrant writes/CAS, same-authVersion mutation, raw privileged capability exposure, mapper round-trip authenticity inference, session-global context, pool.query transaction bypass, silent retry, and partial parent/child commit.

Do not broaden mapper/test allowlists, change immutable or history rules, loosen roles/RLS, or change the frozen Domain/Ports/schema to accommodate application shortcuts. Higher authVersion is not blanket permission to rewrite identity/history. Audit and cross-control-plane authorization must be designed explicitly before enabling the associated use cases.

## Next-phase readiness

PHASE 1B-4: CLOSED / FROZEN. PHASE_1B4B_5_SIGNOFF: PASS. READY_FOR_1B5: YES.

1B-5 Credential builds on this frozen layer. It must not rewrite Identity Domain, bypass repository contracts, change Tenant/RBAC or RepositoryRevision semantics, put credential secrets in Domain aggregates, record raw credentials in audit, or introduce Session logic early. Readiness is a dependency result, not authorization to start implementation in this documentation round.

Only this closeout document is added. Production, tests, workflow, schema/migrations/RLS, and role bootstrap remain unchanged. COMMIT: NO. PUSH: NO.
