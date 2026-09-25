# Phase 1B-3B-1 — Identity PostgreSQL Schema / RLS Implementation Review

Status: REVISION ROUND 1 DRAFT / FOCUSED RE-REVIEW REQUIRED. Date: 2026-09-25.
Base HEAD: `32d5ff86460c9e0c8a191f61937f4623e4e7a3f4` on `refactor/zhiban-v2`.
Authority: [1B-3A signoff](schema-review.md). PostgreSQL target: 16. Nothing was committed, pushed or deployed in this batch.

## Scope and execution boundary

- Seven Identity-owned business tables: `users`, `tenants`, `memberships`, `role_grants`, `system_admin_grants`, `sessions`, `audit_events` in `zhiban_identity`; plus `schema_migrations` metadata.
- No Credential, RoleCatalog, Permission, Class, Course, OpenMAIC resource mapping, or OpenMAIC storage table. No Repository, Session service, Authentication, Authorization Policy, API or Adapter.
- Administrative `bootstrap-roles.pg16.sql` is a **psql-only** operation on a **new isolated V2 database**. It embeds `\set ON_ERROR_STOP on`, `\set ON_ERROR_ROLLBACK off`, `BEGIN` and `COMMIT`. It creates missing roles with exact attributes; it reuses existing names only after rejecting unsafe attributes, unexpected role memberships and effective runtime DDL privileges. It neither silently repairs existing role attributes nor revokes unknown role memberships. The NOLOGIN owner, LOGIN migrator and three LOGIN runtime roles have no embedded password. Only migrator may `SET ROLE` owner. Database-local role settings pin the trusted search path; identifier-safe current-database grants allow owner schema creation and revoke PUBLIC CREATE/TEMPORARY. It is not an application startup script. An operator must confirm the target is neither the V1 nor OpenMAIC database.
- Versioned raw SQL files are loaded by `migrate.ts`; `migrate-cli.ts` requires `ZHIBAN_IDENTITY_MIGRATOR_DATABASE_URL` and is invoked only as an explicit maintenance command (for example `pnpm exec tsx lib/zhiban/infrastructure/identity/postgres/migrate-cli.ts`). There is no import from web startup, no package install and no new ORM. The CLI was **not run** in this batch.

## Migration files and runner

| File | Purpose |
| --- | --- |
| `lib/zhiban/infrastructure/identity/postgres/bootstrap-roles.pg16.sql` | Separate administrator role and dedicated-database privilege bootstrap; not a numbered migration |
| `lib/zhiban/infrastructure/identity/postgres/migrations/0001_identity_bootstrap.sql` | Schema, restrictive defaults, migration ledger |
| `lib/zhiban/infrastructure/identity/postgres/migrations/0002_identity_core.sql` | Six non-audit business tables, UUIDv7/Instant/enum/state constraints, FK/indexes, immutable history guards |
| `lib/zhiban/infrastructure/identity/postgres/migrations/0003_identity_audit_and_rls.sql` | One mixed audit table with exact payload validators, pure tenant resolver, RLS and least-privilege ACL |

The runner validates contiguous unique versions, computes SHA-256 over raw UTF-8 contents and refuses changed, unknown or gapped applied versions before any further migration write. It verifies the migrator login, `SET ROLE`s the NOLOGIN owner, obtains a **session advisory lock on that same connection**, checks schema/ledger consistency, and executes each whole SQL file inside `BEGIN`/ledger insert/`COMMIT`; failure rolls back that file and does not write its ledger row. It does not split SQL on semicolons or auto-run from runtime. First migration creates schema and ledger in one transaction. Role bootstrap is deliberately separate because ordinary migrator must not have `CREATEROLE`.

## Physical safety controls

- UUID columns use PostgreSQL `uuid` plus UUIDv7/RFC-variant CHECK. Domain instants are BIGINT epoch-ms in `0..8640000000000000`; migration `applied_at` alone uses timestamptz. `authorization_version` and `repository_revision` are separate BIGINT values; neither uses `xmin`.
- Tenant control-plane table has no RLS; `zhiban_runtime` has no direct Tenant/User/Session/SystemAdminGrant table privilege. Membership/RoleGrant use `ENABLE + FORCE RLS` with select/insert/update policies keyed to the transaction-local `app.tenant_id`. There is no DELETE policy/grant. RoleGrant has the required composite `(tenant_id,membership_id)` FK and deterministic `grant_ordinal`. Immutable membership identity/version and irreversible grant/session/system-admin revocation have database guards.
- `current_tenant_id()` is a table-free SECURITY INVOKER parser of `current_setting('app.tenant_id',true)`. Missing/invalid/non-v7 returns NULL; a syntactically valid unknown TenantId returns itself, while RLS rows and FKs fail closed. No SECURITY DEFINER tenant-existence or global-status helper exists.
- Audit is one mixed `audit_events` table. Closed 18-event type, actor/subject/scope/version, exact top-level and nested JSONB grant shape, fixed event type→scope and role-specific INSERT RLS are physical constraints. Non-null `tenant_id` has Tenant FK `ON DELETE RESTRICT`; actor/user/membership subjects are weak references. Runtime has INSERT-only audit column privilege, no SELECT/UPDATE/DELETE/TRUNCATE. `event_payload` is not an arbitrary JSON dump.
- Owner/migrator are separate from runtime. Role bootstrap permits owner membership **only** to migrator with `ADMIN FALSE, INHERIT FALSE, SET TRUE`; all runtime roles must have **no membership edge in either direction**. It checks PostgreSQL 16 membership options and SET-capable transitive paths, not only `NOINHERIT`. Identity-owned schema/table/sequence/function ACLs are normalized with explicit runtime-role `REVOKE` before exact grants; `schema_migrations` has no runtime grants. No role attributes or unknown cluster memberships are silently repaired. Privileged role closure, ACL and actual row behavior still require real PG16 verification.

## Verification performed and deferred

Static migration/runner contract tests and existing Identity Domain/Ports tests were run locally; root lint and typecheck were run. This batch did **not** connect to a persistent PostgreSQL instance, use production credentials, change an existing database, or claim RLS/ACL/pool-isolation verified. An optional PGlite-only syntax smoke was attempted but its internal template1 privilege/catalog behavior could not apply the administrator bootstrap; it was removed rather than weakening the approved SQL. That attempt was in-memory, not a PG16 security result.

| Check | Result |
| --- | --- |
| Identity PostgreSQL static/runner tests | 26 passed (7 bootstrap static, 11 migration static, 8 runner) |
| Identity Domain tests | 94 passed |
| Identity Port contract tests | 20 passed |
| Root lint | PASS, 0 errors / 20 existing warnings |
| Root default typecheck | PASS; no 8 GB retry needed |
| Real PostgreSQL 16 restricted-role RLS/ACL/pool isolation | NOT RUN — 1B-3B-2 gate |

1B-3B-2 must apply the unmodified bootstrap and migrations to a fresh **real PostgreSQL 16** disposable V2 database and use genuinely restricted runtime connections. Its exit gate includes role closure/ownership, PUBLIC ACL, missing/invalid/unknown context, cross-tenant read/insert/update/delete, composite FK, audit shape and append-only, unknown-Tenant audit FK, search_path, migration failure/checksum/locking, transaction-local context and pool/rollback reuse. Table owner, superuser, BYPASSRLS, PGlite and static regex tests cannot stand in for this gate. The 1B-4/1B-8 gate still owns same-client/same-transaction business mutation + audit failure rollback.

## Independent finding retained: P0-01

The independent review found that the first draft used blind `CREATE ROLE`. With ordinary `psql -f`, a duplicate-role error can leave processing active; a dangerous pre-existing same-name runtime role could then be reused. The first draft did not validate role attributes, the `pg_auth_members` graph, PostgreSQL 16 `SET ROLE` options, or dangerous effective runtime DDL privileges. Its prior statement of zero P0 findings is superseded by this finding, not erased.

## Revision Round 1 — fail-closed role bootstrap

- **Root cause closed by design:** the psql-only script sets `ON_ERROR_STOP on` internally before one transaction. Missing roles are created in that transaction; all five roles' exact security attributes, runtime membership edges, owner/migrator graph and approved membership options are checked before the owner grant or any Identity migration. Any exception exits psql nonzero and rolls back partially created roles and grants. An existing safe role can pass; an unsafe same-name role is rejected, never silently `ALTER ROLE`-repaired. For example, a pre-existing `zhiban_runtime SUPERUSER` or `BYPASSRLS` triggers the attribute exception before `COMMIT`; `zhiban_runtime` membership in owner/migrator/control triggers the membership exception even with `NOINHERIT`.
- **Static evidence only:** `bootstrap-role-contract.test.ts` checks fail-stop and transaction ordering, five roles, exact attributes, membership closure checks, unexpected owner/migrator edges and Identity-owned ACL normalization. `migration-contract.test.ts` checks the new role specification. Static tests do not prove real PG16 SQL execution, rollback, `SET ROLE` behavior or RLS.
- **ACL scope:** migrations revoke pre-existing grants on `zhiban_identity` schema, metadata table and Identity-owned tables/sequences/functions from the three runtime roles and PUBLIC before exact grants. They do not revoke privileges in any other schema or unknown cluster membership. Database-wide PUBLIC CONNECT is not changed and remains a deployment/3B-2 check.
- **Operational gate:** (1) an administrator confirms a dedicated disposable V2 PG16 target and runs `psql -X -f bootstrap-roles.pg16.sql`; the script itself requires stop-on-error and one transaction, so no `--single-transaction` wrapper is needed. (2) Only a zero exit code allows the next step; an error prohibits migration. (3) Provision the migrator connection out of band as `ZHIBAN_IDENTITY_MIGRATOR_DATABASE_URL` and run `pnpm exec tsx lib/zhiban/infrastructure/identity/postgres/migrate-cli.ts`. (4) 1B-3B-2 performs real restricted-role verification. None of these commands was run against a real database in this revision.

The focused re-review must evaluate the SQL and static claims. The real PostgreSQL 16 1B-3B-2 exit tests are:

| Case | Required real PG16 observation |
| --- | --- |
| R01 | Empty cluster-safe dedicated database bootstrap succeeds |
| R02 | Safe existing roles bootstrap succeeds |
| R03 | Pre-existing SUPERUSER runtime fails before grants or migration |
| R04 | Pre-existing BYPASSRLS runtime fails |
| R05 | Runtime → owner membership fails |
| R06 | Runtime → migrator → owner transitive path fails |
| R07 | Auth runtime → control runtime membership fails |
| R08 | Unsafe later role causes rollback of newly created earlier roles |
| R09 | Successful rerun is idempotent |
| R10 | Migrator can use its intended owner membership; runtime cannot `SET ROLE` owner, migrator or another runtime |

## Findings and next gate

- P0: P0-01 is **fixed in the revision design and static contracts**, pending focused re-review; no claim of real PG16 execution.
- P1: 0 identified in this revision's static checks; focused re-review remains required.
- P2: real PG16 must verify role bootstrap, rollback, `SET ROLE`, database grants, function privileges, policy semantics and SQL syntax. The PGlite smoke could not adjudicate these.
- P3: Repository CAS/rehydration (1B-4), Credential (1B-5), Session (1B-6), Policy (1B-7), Application audit atomicity/approval (1B-8), OpenMAIC Bridge/V1 migration (later) remain out of scope.

READY_FOR_FOCUSED_REREVIEW: YES, subject to final local checks. READY_FOR_1B3B2: YES_PENDING_REREVIEW, not authorization to start 3B-2 now and not a declaration that 1B-3B is complete. READY_FOR_1B4: NO. No migration, SQL or roles were run against a real database in this batch.
