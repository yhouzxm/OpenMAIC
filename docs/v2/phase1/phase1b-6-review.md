# Phase 1B-6 Session Closeout / Freeze

STATUS: COMPLETE / FROZEN

Branch: `refactor/zhiban-v2`. Audited HEAD: `9baca9a5dffb21ce94b453687372bb7239c465fc`. This document closes the Session implementation and its real PostgreSQL 16 signoff. It records the repository and CI state at this checkpoint; it does not start the HTTP authentication API or production cutover. This documentation round has no commit or push.

## Scope and authority

The frozen design comes from [session strategy](session-strategy.md), [authentication boundary](auth-boundary.md), [1B-2 Port review](phase1b-2-review.md), and the [1B-5 Credential closeout](phase1b-5-review.md). The implemented boundary is the [Session Port](../../../lib/zhiban/application/identity/ports/session-repository.ts), [token and policy material](../../../lib/zhiban/infrastructure/identity/sessions/session-material.ts), [credential-to-session composition](../../../lib/zhiban/infrastructure/identity/sessions/session-authenticator.ts), [browser security contract](../../../lib/zhiban/infrastructure/identity/sessions/browser-security.ts), [PostgreSQL repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/session.ts), [checked records](../../../lib/zhiban/infrastructure/identity/postgres/repositories/session-records.ts), and [0006 migration](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0006_identity_sessions.sql).

Evidence includes the [33-test real PG16 Session suite](../../../tests/zhiban/identity/postgres/pg16-sessions.test.ts), [Session security tests](../../../tests/zhiban/identity/sessions/security.test.ts), [shared repository contracts](../../../tests/zhiban/identity/sessions/repository-contract.test.ts), [Session SQL unit tests](../../../tests/zhiban/identity/postgres/session-repository.test.ts), [migration static contracts](../../../tests/zhiban/identity/postgres/session-schema.test.ts), and the [existing PG16 workflow](../../../.github/workflows/zhiban-identity-pg16-security.yml). Unit SQL harnesses and Fakes are not substituted for the real database results below.

## Ownership and secret boundary

Session is GLOBAL USER authentication state. It is not owned by a Tenant or Membership and stores no tenant, role, permission, or authorization snapshot. A validated Session establishes `UserId` only; Tenant selection and RBAC still require their own fresh checks. Disabling one Membership does not globally revoke the User's Sessions.

**1B2-F07: CLOSED.** The Session service generates `SessionId` independently of the Domain `IdGenerator`: `ses_` plus 32 CSPRNG bytes encoded as canonical base64url. It separately generates a 32-byte (256-bit) opaque bearer token. The browser receives the raw token only through an explicit server-side cookie adapter extraction capability. The repository stores a canonical SHA-256 digest of that token, never the bearer itself. The raw token is not part of Domain state, SQL parameters, audit payload, log, error message, or ordinary serialized Session output. No JWT, localStorage token, or URL token is introduced.

Session issuance follows real Credential verification. The security-only approval is tied to the verified credential snapshot and current User revision; a copied or fabricated ordinary Session record does not gain that approval. Unknown or invalid credentials do not issue a Session. The internal authentication result is not a durable Session creation certificate.

## Lifecycle, freshness, and concurrency freeze

| Operation | Frozen behavior |
| --- | --- |
| Issue | New SessionId/token/digest; insert only after credential verification; commit only if ACTIVE User, User revision, current credential pointer/revision, and securityEpoch still match the approved snapshot. |
| Validate and touch | Look up by digest, check unrevoked and strict absolute/idle deadlines, ACTIVE User, bound User revision and current Credential securityEpoch; perform a CAS touch and checked commit before returning authenticated `UserId`. Storage failure fails closed. |
| Revoke | Terminal, audited, idempotent on the current revoked state. A stale touch cannot clear revocation. |
| Revoke all | Scoped to one global User and serialized with issuance/touch through the User barrier. |
| Rotate | Create a fresh token/Session, revoke and audit the old Session in one transaction. Failure rolls the complete change back; rotation does not extend the old absolute deadline. |

The default configurable security policy is 8 hours absolute and 30 minutes idle. Invalid or overflowing policy values fail closed. Touch may slide the idle deadline only within the original absolute deadline; reaching either deadline rejects validation. Revoked and expired Sessions cannot be revived by touch or rotation.

Session persistence uses frozen `RepositoryRevision` CAS semantics: canonical positive signed-int8 decimal strings, BigInt validation, stale-before-no-op, no revision change for a complete current no-op, exactly one increment for a mutation, and fail-closed behavior at the maximum. There is no automatic retry. Session `securityEpoch` is the global Credential epoch, never Membership `authVersion`; the record also binds the current global User revision. Credential replacement or revocation changes the epoch and immediately invalidates old Sessions. A disabled User is rejected and its Sessions are revoked; restoring the User cannot revive a pre-disable Session.

Issuance and User disable share a per-User transaction barrier. The Session insert completes its User FK key-share before taking the barrier, then checks User and Credential state again under the barrier. Credential mutation and issuance serialize through the credential slot. The real tests cover both issue-versus-credential orderings, both issue-versus-disable orderings, and both touch-versus-revoke orderings with separate PostgreSQL connections and acknowledged lock waits. Revoke wins the terminal state; competing rotations have one winner and no orphan new Session.

## Cookie and CSRF boundary

The protocol-neutral production cookie policy uses `__Host-zhiban_session`, HttpOnly, Secure, SameSite=Lax, Path=/, and no Domain attribute. Development uses a separate non-`__Host-` name. The token belongs in this cookie, not localStorage or a URL. SameSite alone is insufficient for unsafe requests: the server-only contract requires an exact configured Origin and a CSRF proof bound to a validated SessionId. The actual HTTP cookie extraction, issuance, clearing, and Origin/CSRF enforcement wiring remain with 1B-8.

## Database, privileges, and audit

The final migration inventory is 0001–0006. Previously applied 0001–0005 are byte/checksum unchanged. `0006_identity_sessions.sql` adds Session `security_epoch` and `user_revision` bindings, validates new token digest shape, keeps bindings immutable, enforces monotonic touch/terminal revocation, and coordinates User disable with Session revocation. Historical unbound rows may remain for migration compatibility but are never authenticated. The migration is applied by the existing explicit runner; no startup DDL or new workflow is introduced.

`zhiban_identity.sessions` is a global User-owned table, so it has no tenant RLS. Its ACL and security checks are the boundary: `zhiban_auth_runtime` has only the required Session access; `zhiban_runtime` cannot read or write Sessions; `zhiban_control_runtime` cannot read `token_digest` or create Sessions; PUBLIC has no table, column, or relevant function capability. The runtime roles do not own the table. Control receives only the narrowly required timestamp reads for the User-disable trigger. No tenant runtime access is granted through the absence of tenant RLS.

`SESSION_REVOKED` uses the closed global audit shape and carries safe IDs, not bearer token or digest. Explicit revoke, revoke-all, and rotation insert audit on the same client and transaction as the Session mutation. The User-disable trigger revokes and audits in the same User update transaction. Injected real SQL failures prove rollback of both mutation and audit, including User disable. No generic UnitOfWork or arbitrary audit payload is introduced.

## Real CI evidence and coverage repair

The initial Session candidate `39c114dd85cd2662788ce830d57cb3c3850c7157`, [run 37018401221](https://github.com/yhouzxm/OpenMAIC/actions/runs/37018401221), passed the Session implementation and 121/121 real PG16 tests twice. Its workflow executed only 553 selected static/unit regression tests and omitted five existing repository suites. This was a CI coverage gap, not a Session production failure, so that run was not used for full Identity signoff.

The final candidate `9baca9a5dffb21ce94b453687372bb7239c465fc` changes only the existing workflow. It restores `global-repositories`, `membership-repository`, `mappers`, `transactions`, and `persistence-authenticity` to the static regression step. Their 352 tests ran and passed in final [run 37022859398](https://github.com/yhouzxm/OpenMAIC/actions/runs/37022859398). All original workflow commands and both real PG16 runs remain. The CI coverage gap was resolved before freeze.

| Final run evidence | Result |
| --- | --- |
| Workflow / event / head / conclusion | Zhiban Identity PG16 Security / workflow_dispatch / `9baca9a5dffb21ce94b453687372bb7239c465fc` / SUCCESS |
| Actual PostgreSQL / runner | 16.15 (Debian 16.15-1.pgdg13+2) / Ubuntu 24.04 |
| Node and frozen install | v22.23.3 linux/x64 / PASS |
| PG16 RUN 1 and RUN 2 | 121/121 PASS each, with both RUN/PASS markers and all eight suites present |
| Original 1B-4/1B-5 PG16 | 88/88 PASS per run |
| Session real PG16 | 33/33 PASS per run |
| Static migration/role/runner | 28/28 PASS |
| Domain and Port contracts | 376/376 PASS |
| Credential unit/contracts | 99/99 PASS |
| Session unit/contracts | 50/50 PASS |
| Restored repository suites | 133 + 116 + 70 + 29 + 4 = 352/352 PASS |
| Full Identity regression | 905/905 PASS |
| Root lint / typecheck | PASS, 0 errors and 20 existing warnings / PASS, both executed |

The real Session suite verifies the global catalog and ACL, digest lookup with a real Credential verification path, wrong token, disabled/restored User, credential epoch change, strict expiry boundaries, touch CAS, terminal and batch revocation, concurrent races, atomic rotation and audit rollback, malformed/unbound rows, pool cleanup, and maximum revision fail-closed behavior. Real PG16 results are not inferred from Fakes or static SQL assertions. The original 88 tests continue to cover role/RLS, global and Membership CAS, aggregate atomicity, aborted COMMIT, and actual 40001/40P01 classification.

FINAL P0: 0. FINAL P1: 0. FINAL P2: 0. The former coverage finding is closed by the final candidate and run. This documentation-only closeout does not rerun the completed CI or change implementation files.

## Deferred boundaries and forbidden regressions

DEFERRED_TO_1B8_AUTH_API: public login/logout API; identifier UX/resolver; public authentication error normalization; recovery, reset, and re-auth approval flows; distributed/IP admission and rate limiting; actual HTTP cookie extraction/wiring; actual HTTP CSRF/Origin enforcement; application/API audit integration; and 1B1-F05 pending-origin approval semantics. The Session security policy and CSRF contract do not by themselves certify an HTTP adapter.

OUT_OF_SCOPE: MFA, OAuth/OIDC, JWT, OpenMAIC Identity Bridge, Course, Portal, and production cutover. 1B-7 Authorization policy remains a separate phase; a validated Session must not be treated as tenant Membership or Permission proof.

Later phases must preserve independent CSPRNG SessionId/token issuance, digest-only persistence, secret-free audit/errors/logs, current User and Credential epoch checks, fail-closed storage behavior, expiry, CAS/stale-before-no-op, terminal revocation, issuance and mutation race serialization, atomic rotation/audit, least-privilege ACL, and the distinction between global Session identity and tenant authorization. Applied migration checksums must not be rewritten.

PHASE_1B6: COMPLETE

SESSION_DESIGN: FROZEN

SESSION_IMPLEMENTATION: FROZEN

REAL_PG16_SIGNOFF: PASS

FULL_IDENTITY_REGRESSION: 905/905 PASS

P0: 0

P1: 0

P2: 0

DEFERRED_TO_1B8: AUTH/API

READY_FOR_1B6_CLOSEOUT_CHECKPOINT: YES

READY_FOR_1B7: YES_AFTER_CLOSEOUT_CHECKPOINT
