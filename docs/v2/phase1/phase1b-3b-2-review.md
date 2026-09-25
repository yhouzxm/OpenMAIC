# Phase 1B-3B-2 PostgreSQL 16 Verification Harness

STATUS: VERIFICATION HARNESS / PENDING CI

REAL PG16 VERIFIED: NO

## Scope and isolation

This is a temporary verification checkpoint on `verify/identity-pg16-3b2`, not a formal V2 signoff. The formal `refactor/zhiban-v2` baseline remains `32d5ff86460c9e0c8a191f61937f4623e4e7a3f4`. The GitHub Actions job uses an ephemeral `postgres:16` service with synthetic fixtures only. It requires an explicit dedicated test URL, a disposable-database marker, GitHub Actions, localhost, the fixed database name, and a PostgreSQL 16 version check before any reset. It never reads the general `DATABASE_URL`.

## Verification coverage

The two-run security suite checks R01–R10 role bootstrap, actual migrator execution and rollback/locking, catalog ownership, restricted runtime ACLs, RLS and composite tenant FK, immutable grants, all 18 audit event types and negative payloads, session schema, and real node-postgres pool context isolation. Existing static migration and role tests plus Domain/Port contract regressions run separately. Lint and root typecheck are CI gates.

The tests deliberately use the `postgres` administrator only for disposable cluster setup, controlled fixtures, and catalog inspection; all business access assertions use the corresponding restricted role. Cleanup is limited to the exact Identity CI role allowlist and schema inside the guarded disposable test service. Public database `CONNECT` is recorded as a deployment-hardening fact, not changed in this task.

## Evidence pending

- Verification commit: PENDING
- GitHub Actions run ID: PENDING
- Actual PostgreSQL server version: PENDING
- Complete suite run 1: PENDING
- Complete suite run 2: PENDING
- Final P0/P1 classification: PENDING
- Formal V2 merge: NOT PERFORMED

CI failure must be reported without an immediate fix/recommit in this task. A green run permits only a separate evidence update on this verification branch; human final signoff remains required before any formal V2 integration.
