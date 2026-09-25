# Phase 1B-3B-2 PostgreSQL 16 Verification Harness

STATUS: REAL PG16 VERIFICATION COMPLETE

REAL PG16 VERIFIED: YES

## Scope and isolation

This is a temporary verification checkpoint on `verify/identity-pg16-3b2`, not a formal V2 signoff. The formal `refactor/zhiban-v2` baseline remains `32d5ff86460c9e0c8a191f61937f4623e4e7a3f4`. The GitHub Actions job uses an ephemeral `postgres:16` service with synthetic fixtures only. It requires an explicit dedicated test URL, a disposable-database marker, GitHub Actions, localhost, the fixed database name, and a PostgreSQL 16 version check before any reset. It never reads the general `DATABASE_URL`.

## Verification coverage

The two-run security suite checks R01–R10 role bootstrap, actual migrator execution and rollback/locking, catalog ownership, restricted runtime ACLs, RLS and composite tenant FK, immutable grants, all 18 audit event types and negative payloads, session schema, and real node-postgres pool context isolation. Existing static migration and role tests plus Domain/Port contract regressions run separately. Lint and root typecheck are CI gates.

The tests deliberately use the `postgres` administrator only for disposable cluster setup, controlled fixtures, and catalog inspection; all business access assertions use the corresponding restricted role. Cleanup is limited to the exact Identity CI role allowlist and schema inside the guarded disposable test service. Public database `CONNECT` is recorded as a deployment-hardening fact, not changed in this task.

## Initial checkpoint (historical PENDING CI state)

- Verification commit: PENDING
- GitHub Actions run ID: PENDING
- Actual PostgreSQL server version: PENDING
- Complete suite run 1: PENDING
- Complete suite run 2: PENDING
- Final P0/P1 classification: PENDING
- Formal V2 merge: NOT PERFORMED

CI failure must be reported without an immediate fix/recommit in this task. A green run permits only a separate evidence update on this verification branch; human final signoff remains required before any formal V2 integration.

## Completed GitHub Actions evidence

This section supersedes the historical pending fields above; it documents a disposable CI database, not production validation.

- GITHUB WORKFLOW: Zhiban Identity PG16 Security
- GITHUB RUN ID: [36138237154](https://github.com/yhouzxm/OpenMAIC/actions/runs/36138237154)
- VERIFIED COMMIT: `1d35de63eb5ac18090726ece3d5a2f50172ad5bc`
- POSTGRESQL VERSION: 16.15 (`SELECT version()` and `SHOW server_version` checked by the job)
- RUN 1: PASS — 27 real PG16 tests (10 role, 4 migration, 5 ownership/ACL, 8 RLS/audit)
- RUN 2: PASS — the same 27 tests after fixture cleanup
- Static migration/role tests: PASS — 26 tests
- Domain and Port contract regression: PASS — 114 tests
- Root lint and typecheck: PASS (lint warnings are non-blocking upstream baseline warnings)

### R01–R10 role bootstrap

| Case | Real PostgreSQL 16 result |
| --- | --- |
| R01 empty bootstrap | PASS |
| R02 safe existing roles | PASS |
| R03 pre-existing SUPERUSER runtime | REJECTED |
| R04 pre-existing BYPASSRLS runtime | REJECTED |
| R05 runtime → owner membership | REJECTED |
| R06 runtime → intermediate → migrator → owner transitive path | REJECTED |
| R07 auth runtime → control runtime membership | REJECTED |
| R08 partial bootstrap rollback of newly created roles | PASS |
| R09 successful bootstrap rerun idempotency | PASS |
| R10 migrator → owner works; runtime SET ROLE owner/migrator/control denied | PASS |

### Migration, ownership and restricted ACL

- Migration from an empty database: PASS (0001, 0002, 0003).
- Migration rerun: PASS, no-op with matching checksums.
- Checksum mismatch: REJECTED without changing the ledger.
- Failed test-only migration: PASS, object and ledger entry rolled back.
- Concurrent independent connections: PASS, advisory lock serialized execution and each version appeared once.
- Runtime roles: NON_SUPERUSER, NON_OWNER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE; no runtime role inheritance path.
- Schema, table, sequence and function ownership: PASS, owned by the dedicated NOLOGIN Identity owner.
- Runtime DDL: DENIED. `schema_migrations` SELECT/INSERT/UPDATE/DELETE/TRUNCATE ACL: PASS (denied).
- Tenant control table access from tenant runtime: DENIED. Auth/control runtime table boundaries: PASS.

### RLS and structural constraints

- `current_tenant_id`: PASS. Missing, empty, malformed and UUIDv4 context: FAIL_CLOSED; unknown valid UUIDv7 tenant returns no rows (FAIL_CLOSED).
- Tenant A read A: ALLOW. Tenant A read B: DENY. Cross-tenant INSERT/UPDATE and DELETE: DENY.
- Membership RLS and RoleGrant RLS: PASS; catalog `FORCE ROW LEVEL SECURITY`: PASS.
- Runtime table owner: NO. Runtime `BYPASSRLS`: NO.
- Composite tenant foreign key: PASS. Membership immutable identity: PASS. RoleGrant historical immutability and one-way revocation: PASS.
- `SYSTEM_ADMIN` as a tenant RoleGrant: REJECTED; system-administrator boundary remains separate.

### Audit and connection-pool isolation

- All 18 closed audit event shapes through their designated restricted writers: PASS.
- Scope mismatch, unknown type/reason, password/token-digest/unexpected keys, nested grant/scope extra keys: REJECTED.
- Unknown tenant foreign key: REJECTED. Documented weak actor/subject references: PASS.
- Audit append-only runtime behavior and writer separation: PASS. Audit event identity sequence generation and narrow sequence privilege: PASS.
- Real node-postgres Pool with transaction-local tenant context: pool reuse PASS; rollback reuse PASS; tenant switch reuse PASS; failed transaction reuse PASS. Every checkout without a new context failed closed.

## Verification verdict and remaining gates

- P0 BLOCKERS: 0
- P1 MUST_FIX: 0
- P2 NOTES: 0
- Deployment hardening note: the database `PUBLIC CONNECT` catalog fact was inspected; this verification did not change cluster policy.
- P3 DEFERRED: Repository; Credential; Session service; Authorization Policy; Application audit composition; OpenMAIC Bridge / V1 migration.
- 1B-3B VERIFICATION VERDICT: PASS
- PHASE_1B3B: READY_FOR_FINAL_SIGNOFF
- READY_FOR_1B4: NO

Human 1B-3B final signoff, formal V2 branch integration, and its commit/push checkpoint remain separate required steps. The formal V2 branch was not modified by this evidence commit.
