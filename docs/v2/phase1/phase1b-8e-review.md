# Phase 1B-8E — Controlled Manual Recovery Closeout / Freeze

STATUS: COMPLETE / DESIGN_AND_IMPLEMENTATION_FROZEN

Date: 2026-10-04. Branch: `refactor/zhiban-v2`. Signed-off candidate: `fc5d0b675c539cade68b5aeb30b7f82a3484d91c`, parent `64abc76c8b60f01b858068c604db835a2b6fbc8b`. Closeout preflight worktree: CLEAN.

This closes the approved 1B-8E controlled manual recovery unit. It freezes the E8-S01–S08 decisions and E8-P01–P08 exact schema, ACL, private transport, evidence, lifecycle, concurrency and verification contracts in the [approved recovery design](phase1b-8e-recovery-design.md), together with the implementation and real PostgreSQL 16 evidence below. Historical implementation-pending labels in the design record earlier gates; this closeout is the authoritative final state.

Public forgot-password and reset channels remain closed. This unit supplies a disabled-by-default, attended recovery capability for separately approved operational deployment. It does not create real identity records, staff appointments, contact channels, certificates, signing keys, policy values or production access.

## Authority and implemented scope

The implementation follows the frozen [Credential closeout](phase1b-5-review.md), [Session closeout](phase1b-6-review.md), [Authorization closeout](phase1b-7-review.md), [1B-8C composition closeout](phase1b-8c-review.md), [1B-8D HTTP closeout](phase1b-8d-review.md), and the recovery design and supplement. Global User, Credential and Session ownership, RepositoryRevision, Credential securityEpoch, Membership authorizationVersion, tenant isolation and existing role semantics remain unchanged.

Implementation evidence is the [manual recovery Port](../../../lib/zhiban/application/identity/ports/manual-recovery.ts), [same-client composition](../../../lib/zhiban/infrastructure/identity/recovery/composition.ts), [signed evidence boundary](../../../lib/zhiban/infrastructure/identity/recovery/evidence.ts), [private transport](../../../lib/zhiban/infrastructure/identity/recovery/private-transport.ts), [security bridge](../../../lib/zhiban/infrastructure/identity/recovery/security.ts), [process-private registry](../../../lib/zhiban/infrastructure/identity/recovery/registry.ts), [terminal client](../../../lib/zhiban/infrastructure/identity/recovery/terminal-client.ts), [0010 schema migration](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0010_identity_manual_recovery.sql), [0011 source-lock migration](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0011_identity_recovery_source_locks.sql), [real PG16 suite](../../../tests/zhiban/identity/postgres/pg16-manual-recovery.test.ts), and the [existing PG16 workflow](../../../.github/workflows/zhiban-identity-pg16-security.yml).

The implemented channel is `ATTENDED_MANUAL_RECOVERY_V1`: an existing ordinary global User appears in person, an independently appointed verifier checks the pre-existing platform identity binding, a different current SystemAdmin approves and executes the recovery, and the subject privately supplies the new password through the dedicated terminal lane. Tenant administrators, Membership, RoleGrant, roster data, client claims and FIRST onboarding do not authorize global password recovery.

## Identity, authority and eligibility freeze

Recovery requires three distinct Users: subject, identity verifier and executing SystemAdmin. The actor must have an ACTIVE User, current Session bound to the current Credential securityEpoch, a current SystemAdminGrant and fresh intent-bound password proof. Enrollment, appointment and contact source anchors must be CURRENT, signed by an approved Ed25519 key, bound to the exact environment, purpose, case, User and versions, and valid at the database time boundary.

The subject must be ACTIVE and have an existing Credential slot. Every expected User revision, slot revision, securityEpoch, active CredentialId, generation, source revision and actor grant revision is fixed at registration and freshly checked under locks. A target with any SystemAdminGrant history is ineligible. Platform administrator self-recovery, all-admin lockout and break-glass remain closed pending a separate custody/quorum design.

The evidence boundary accepts exact canonical manifests and canonical unpadded base64url Ed25519 signatures. A valid signature alone is insufficient: trusted issuer, approved key, purpose, environment and current persisted source anchors must all match. Source blocking is terminal and atomically prevents further use by incomplete cases. No identity document, person identifier, contact address, raw evidence or free-form evidence text is persisted by this layer.

## Lifecycle, material and private transport freeze

The case lifecycle is `REGISTERED → VERIFIED → APPROVED → TICKET_ISSUED → COMPLETED`. An incomplete case may terminalize as `REJECTED`, `CANCELLED` or `EXPIRED`; terminal cases never reopen. Case validity is 30 minutes from the actual persisted VERIFIED time. A ticket is valid for at most 10 minutes and never beyond its case deadline. Reissue cancels the prior ticket, creates a new ticket generation and advances the case revision exactly once without extending the case deadline.

The ticket is a server-generated 256-bit opaque `mrec1_` secret. PostgreSQL stores only its purpose-separated canonical SHA-256 digest. The raw ticket and password never enter ordinary DTOs, PostgreSQL, audit, telemetry, logs, exceptions, snapshots, URL components, cookies, localStorage, argv or environment variables. Password screening is exact-false allow and fails closed for non-boolean results and errors; Argon2id retains m=32768, t=3, p=1 and the existing process KDF cap.

The subject and operator use separate authenticated private lanes. The terminal verifies the approved origin, lane, site and terminal certificate context, uses bounded bodies and timeouts, and requires the applicable request/session/CSRF proof. The subject lane alone receives the raw ticket and password. The operator lane receives only safe intent and opaque process handles. The registry is bounded, process-private and single-use; restart loses ceremony/submission material and requires authorized reissue rather than secret reconstruction.

Recovery errors are the closed internal outcomes `RECOVERY_REJECTED`, `RECOVERY_UNAVAILABLE` and `OUTCOME_UNKNOWN`. Driver errors, SQLSTATE, persisted history, resource existence, password/verifier material and hostile error cause/custom fields do not cross the boundary. The private transport is not added to the public 1B-8D route namespace.

## Persistence, migration and ACL freeze

The final migration inventory is `0001–0011`. Applied migrations `0001–0009` are unchanged. `0010_identity_manual_recovery.sql` adds exactly eight global security tables:

- `identity_recovery_policy`
- `identity_recovery_sources`
- `identity_recovery_cases`
- `identity_recovery_tickets`
- `identity_recovery_events`
- `identity_recovery_outcomes`
- `identity_recovery_notifications`
- `identity_recovery_admission_buckets`

These tables contain no tenantId and use no tenant RLS because the recovery target is a global User. UUIDv7, canonical signed-int8 revisions, bounded times, closed states, immutable fields, terminal transitions, single live ticket, append-only provenance/outcome, commit consistency and CAS rules are enforced by database constraints and triggers. No policy, source, staff identity, contact or enabled production record is seeded.

`0011_identity_recovery_source_locks.sql` preserves the applied `0010` checksum and replaces only the existing `identity_recovery_actor_guard(uuid,text,text)` definition. For LIVE operations it acquires `FOR SHARE NOWAIT` locks on exactly the case-bound enrollment, appointment and contact sources. OUTCOME and CANCEL retain their read-only terminal-state path. Function name, signature, ownership, SECURITY DEFINER settings and grants are unchanged; no table or role capability is widened.

Runtime access is least privilege. `zhiban_auth_runtime` receives only the approved recovery table columns and six exact helpers needed for case execution. `zhiban_control_runtime` can provision/disable the approved policy and source records and invoke only its source-block capability. `zhiban_runtime` and PUBLIC have no recovery table, column or function capability. Control receives no Credential verifier or Session digest access; auth receives no generic SystemAdminGrant SELECT or source-management power. Runtime roles remain non-owner, non-superuser and without BYPASSRLS or SET ROLE.

The narrow owner audit policy can read only a recovery-linked `CREDENTIAL_REPLACED` / `ACCOUNT_RECOVERY` event that matches the immutable outcome. It does not expose unrelated audit history. Existing Credential and Session global-table ACL and tenant RLS policies remain unchanged.

## Atomicity, locks and recovery outcome freeze

Screening, Argon2 and actor step-up complete before the critical transaction. Completion then uses one restricted auth client and one READ COMMITTED transaction. It locks the policy gate, sorted Users, actor Session barrier, sorted Credential slots, actor Session and SystemAdminGrant, the three sources, case and ticket in the frozen order. All expected versions and deadlines are checked again after the locks are held.

The same transaction consumes the ticket, transitions the case, creates a new CredentialId/history generation, terminalizes the prior ACTIVE Credential when present, advances Credential slot RepositoryRevision and securityEpoch exactly once, inserts the existing closed credential audit event, records the safe immutable outcome and creates the pending completion notification. Deferred consistency checks and a final time check run before COMMIT. Any failure rolls back the complete mutation. There is no automatic retry after stale state, lock refusal, deadlock, serialization failure or uncertain commit.

Credential securityEpoch advancement invalidates every old subject Session immediately. Recovery does not issue a new normal Session and does not restore a disabled User. Restoring a User later cannot revive the old Session. Revoked-password re-establishment requires its separately approved clearance and creates a new CredentialId/generation; terminal Credential history never revives. The same plaintext remains a security mutation, not a no-op.

The stable policy gate, User/slot locks, Session advisory barrier, source locks, case/ticket CAS and process-registry claim serialize competing completion, source blocking, password mutation, Session issuance/logout, User disable/restore and SystemAdmin grant changes. Independent-connection tests use acknowledged locks rather than sleep-only timing. Stale-before-no-op and maximum revision/epoch/generation failures remain fail closed.

The durable outcome contains safe IDs and before/after revisions only. It supports explicit post-commit confirmation after a lost response without replaying the reset. `SESSION_REVOKED` is not fabricated: Session invalidation follows the frozen epoch contract. `CREDENTIAL_REPLACED` with `ACCOUNT_RECOVERY` and recovery provenance commit with the mutation. Notification records contain no arbitrary body or secret; delivery and acknowledgement remain separate approved operations.

## Verification evidence and resolved findings

The final candidate `fc5d0b675c539cade68b5aeb30b7f82a3484d91c` passed [Zhiban Identity PG16 Security run 37184672775](https://github.com/yhouzxm/OpenMAIC/actions/runs/37184672775): `workflow_dispatch`, exact head SHA, recovery mode, completed SUCCESS. The environment was PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2), Node v22.23.3 on Linux x64. `pnpm install --frozen-lockfile` passed.

| Final evidence | Result |
| --- | --- |
| Recovery PG16 run 1 | migration 4/4 + recovery 65/65 = 69/69 PASS |
| Recovery PG16 run 2 | migration 4/4 + recovery 65/65 = 69/69 PASS |
| Migration inventory | 0001–0011 apply; second run NO-OP; checksum drift rejection; failed test-only 0012 rollback; advisory-lock serialization PASS ×2 |
| Recovery repair static/composition | 54/54 PASS |
| E8-PG05 / E8-PG05a | restricted registration and exact LIVE source locks PASS ×2 |
| E8-PG37 | malformed persisted verifier fails closed before mutation; state/history/revision unchanged PASS ×2 |
| E8-PG38 | max revision, epoch and generation fail closed with state unchanged PASS ×2 |
| E8-PG40 | independent Session INSERT lock makes reset reject promptly; Session commits and clients cleanly release PASS ×2 |
| Following PG41/PG42/PG45/PG27/PG43/PG44 | PASS ×2; no timeout or leaked-client cascade |
| Local targeted implementation regression | 161 PASS |
| Local full Identity regression | 1470 PASS; 347 real-PG cases skipped because local PG16 was unavailable |
| Local root lint / typecheck | PASS, 0 errors and 20 existing warnings / PASS |

The recovery-mode run intentionally reused the prior accepted complete 1B-8D PG16 baseline and the local full Identity/lint/typecheck evidence; those workflow steps were skipped rather than reported as newly executed. The final candidate after production commit `5c943a78ab343d509e5674aa12af52e66a327a8f` changes only the targeted workflow and two recovery fixture tests. Run 37184672775 therefore supplies the missing real PostgreSQL evidence for migrations `0010–0011`, the 65-case recovery suite and the fixture corrections without weakening prior checks.

Real PG16 verification findings were resolved before freeze. Initial implementation checks aligned the exact helper signatures and migration inventory. Runtime diagnostics then identified that LIVE recovery required locks on the three case-bound source anchors; `0011` added that capability without changing `0010` or widening ACL. A maximum-generation fixture was corrected to represent corrupt history. The first targeted run then exposed two test setup defects: the malformed-verifier fixture was rejected by the SQL shape CHECK before reaching the application mapper, and a paused Session INSERT reused a one-client pool and blocked the test harness rather than the database lock path. The final fixtures use a SQL-shape-valid but noncanonical verifier, independent PostgreSQL connections, full state/revision assertions and unconditional promise/client cleanup. Both full recovery passes completed without failures or timeout cascades.

FINAL P0: 0. FINAL P1: 0. FINAL P2: 0.

## Deployment and deferred boundaries

`PRODUCTION_RECOVERY_ENTRYPOINTS` remain **CLOSED_UNTIL_OPERATIONAL_ACCEPTANCE**. Enabling recovery requires an approved immutable policy record, real enrollment/appointment/contact anchors, Ed25519 issuer and key lifecycle, distinct trained personnel, approved private HTTPS terminal certificates and origin, network isolation, production screening corpus, bounded capacity/timeouts, notification backchannel, telemetry/APM redaction, backup/restore/retention procedures and an attended recovery drill. The first implementation is single-process; multi-instance registry/routing and coordinated admission require a separate design.

`PUBLIC_RECOVERY` remains **CLOSED**. There is no forgot-password route, email/SMS reset, remote chat/video recovery, temporary shared password or recovery API under the public Identity namespace. `SYSTEM_ADMIN_SELF_OR_LOCKOUT_RECOVERY` remains **CLOSED_PENDING_SEPARATE_DESIGN**. FIRST provisioning is not recovery.

Deferred work includes production deployment acceptance and private terminal operations; any future public recovery channel; platform administrator break-glass custody; multi-instance secret registries; long-term recovery history retention/archive; and durable application/API authorization-decision audit beyond the existing closed business events. MFA, OAuth/OIDC, JWT, OpenMAIC Identity Bridge, Course, Class, Enrollment, learning runtime, portals, V1 migration and production cutover remain outside 1B-8E.

Later work must preserve three-person separation, source/key revocation, exact version binding, no tenant-derived global authority, private subject-only secret handling, current actor Session/grant/step-up, same-client completion, fixed lock order, source locks, CAS and epoch invalidation, immutable outcomes, secret-free audit/notification, closed errors, least-privilege ACL, and unchanged applied migration checksums. This closeout changes one documentation file only.

PHASE_1B8E: COMPLETE

RECOVERY_DESIGN: FROZEN

RECOVERY_IMPLEMENTATION: FROZEN

REAL_PG16_RECOVERY_SIGNOFF: PASS

RECOVERY_PG16_RUN_1: 69/69 PASS

RECOVERY_PG16_RUN_2: 69/69 PASS

RECOVERY_REAL_SUITE: 65/65 PASS ×2

MIGRATION_REAL_SUITE: 4/4 PASS ×2

RECOVERY_STATIC_COMPOSITION: 54/54 PASS

FULL_LOCAL_IDENTITY_REGRESSION: 1470 PASS

PUBLIC_RECOVERY: CLOSED

SYSTEM_ADMIN_SELF_OR_LOCKOUT_RECOVERY: CLOSED_PENDING_SEPARATE_DESIGN

PRODUCTION_RECOVERY_ENTRYPOINTS: CLOSED_UNTIL_OPERATIONAL_ACCEPTANCE

P0: 0

P1: 0

P2: 0

READY_FOR_1B8E_CLOSEOUT_CHECKPOINT: YES

READY_FOR_NEXT_PHASE: NO_PENDING_CLOSEOUT_CHECKPOINT_AND_SEPARATE_AUTHORIZATION
