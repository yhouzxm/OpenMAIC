# Phase 1B-8C Membership / Control Composition Closeout

STATUS: COMPLETE / FROZEN

Date: 2026-10-03. Branch: `refactor/zhiban-v2`. Signed-off implementation HEAD: `41ed4bbf48fb7f8af988cd347b3217424e4e0fe4`.

This closes the approved 1B-8C membership and control composition unit, including its PostgreSQL migration, security review, targeted repairs, and real PostgreSQL 16 signoff. It freezes the protocol-neutral use cases and their persistence boundary. Public HTTP adapters, deployment configuration, recovery, and production cutover are separate gates. Historical implementation-pending labels in the [approved design](phase1b-8-identity-composition-design.md) record earlier checkpoints; this closeout records the signed-off implementation without rewriting those decisions.

## Authority and implemented scope

The authority is the approved design's Appendix C, C8-S01–S08 and the limited FIRST terminal-state read clarification in C.13–C.14. The [execution plan](../zhiban-v2-execution-plan.md) separates 1B-8C from 1B-8D HTTP and conditional 1B-8E recovery. The frozen [1B-7 Authorization closeout](phase1b-7-review.md) and Identity, Credential, and Session contracts remain in force.

Implementation evidence is the [closed composition Port](../../../lib/zhiban/application/identity/ports/membership-composition.ts), [member commands](../../../lib/zhiban/infrastructure/identity/composition/member-commands.ts), [admission and consent commands](../../../lib/zhiban/infrastructure/identity/composition/member-admissions.ts), [control commands](../../../lib/zhiban/infrastructure/identity/composition/control-commands.ts), [private Session and re-authentication bridge](../../../lib/zhiban/infrastructure/identity/composition/membership-security.ts), [composition root](../../../lib/zhiban/infrastructure/identity/composition/root.ts), [0009 migration](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0009_identity_membership_composition.sql), [50-case real PG16 suite](../../../tests/zhiban/identity/postgres/pg16-membership-composition.test.ts), [schema contracts](../../../tests/zhiban/identity/postgres/membership-composition-schema.test.ts), and the [existing two-run workflow](../../../.github/workflows/zhiban-identity-pg16-security.yml). The final GitHub run is cited below; unit mocks are not substituted for actual PostgreSQL results.

The implementation retains GLOBAL User ownership, tenant Membership relationships, current RoleCatalog and authorizationVersion semantics, Credential securityEpoch, and Session as authentication of a User only. TenantContext remains persistence scope, not permission proof. Applied migrations 0001–0008 remain unchanged; final inventory is 0001–0009. There is no new generic repository framework, public API, RoleGrant state machine, or Tenant teaching permission.

## Member and approval lifecycle freeze

Admission, the subject's consent, and a current administrator's grant approval are separate facts. Initial admission accepts only an independently approved `OPERATOR_IMPORT` source for an existing global User and a specific Tenant. Registering it neither creates a Membership nor grants a role. Invite consumes that source and creates a PENDING Membership with no grants. Subject consent records the relevant purpose and current versions, but does not activate or grant. Activation, reactivation, rejoin, grant, replace, revoke, disable, administrator leave, and atomic two-target transfer retain the frozen Authorization Policy, current grant ceiling, expected revisions, complete last-admin post-state, and same-client audit rules.

New or replaced grants receive new IDs and current approval; terminal history cannot revive. The 1B1-F05 pending-origin gap is **closed in the 1B-8C use-case scope**: a historical pending grant cannot become effective merely through activation. PRESERVE requires a current valid grant and a complete previously consumed 1B-8C approval-to-command-to-audit provenance chain, including the narrowly defined FIRST chain. Legacy grants without that proof require a fresh approved replacement. Revoked, expired, future, or unapproved grants do not satisfy preservation or the last-admin count. A disabled or left Membership needs a fresh admission and purpose-bound consent before its permitted recovery path.

Every sensitive command uses the real private authenticated handle and recent password proof. REAUTHENTICATE admission precedes Argon2 work; the expensive KDF runs outside the business transaction. The same business client checks current User, Session, Credential slot revision and epoch, actor authority, target versions, source and approval validity at entry and before commit. Forged handles or proof values, stale versions, loss of Session or grant, credential change, and storage failure reject. A committed grant revocation removes authority on the next fresh decision. No Session role or Tenant permission snapshot is trusted.

Tenant commands serialize on the Tenant anchor, lock the complete bounded User set in order, then perform fresh Policy and last-admin checks with parent CAS, history, approval/source consumption, closed audit, and durable safe command outcome in one transaction. Control commands use their approved manifest, current SystemAdminGrant, Session and proof, and their separate serialization point. A duplicate key cannot bypass stale-before-no-op, current authority, or changed safe intent. A lost-response confirmation requires current expected versions and the exact committed outcome; it performs no new mutation, audit, grant ID allocation, or source consumption. No automatic retry follows an uncertain COMMIT.

Control User disable/restore preserves Session revocation: restoring an ACTIVE User does not revive the old Session. Tenant restore requires fresh operational and governance administrator counts through the control-only guard. FIRST_TENANT_ADMIN is limited to a new Tenant's EMPTY onboarding anchor, independently approved operator and subject consent, and fixed TENANT_ADMIN/TENANT grant. Its terminal-state helper branch only confirms the exact still-current successful result; it cannot create a second administrator or recover an older zero-admin Tenant. The FIRST member, grant, two audits, approval consumption, control outcome, and terminal anchor commit or roll back together.

## Persistence, ACL, and secret boundary

`0009_identity_membership_composition.sql` adds the approved 10 tables: six FORCE RLS Tenant-owned admission, consent, approval, grant approval, command, and effect tables; four global control approval, command, effect, and onboarding tables. Its seven narrowly callable helpers, deferred consistency enforcement, immutable/source guards, 25 RLS policies, 22 triggers, and five secondary indexes retain the approved inventory. Old migration files and role bootstrap are unchanged. Runtime grants are operation- and column-limited: tenant runtime sees only its scoped records, control runtime gets only its bounded control and FIRST capabilities, auth runtime receives no new Tenant data capability, and PUBLIC gets no table, column, or function capability. Control does not gain direct Membership/RoleGrant reading or verifier/token-digest access. The FIRST owner DML exception is limited to its approved initial row shapes.

New audit vocabulary is exactly `MEMBERSHIP_PENDING_CREATED` and `MEMBERSHIP_CONSENT_RECORDED`, with closed payloads and ownership. The existing membership and global audit events remain closed. Command effects, source/approval consumption, parent state, and audit use one business transaction; injected faults must roll back all of them. The append-only command ledger stores bounded safe intent and minimal outcome, never password, raw bearer, token digest, verifier, CSRF proof, or re-authentication proof. Errors and ordinary DTOs do not expose those materials or internal SQL details.

The real suite covers scoped ACL/RLS, admission/consent/approval provenance, F05 negative cases, exact versions and confirmation, malformed records, old Session invalidation, disable/restore, two-target rollback, last-admin concurrency, independent connections with acknowledged lock barriers, FIRST isolation and terminal confirmation, audit atomicity, secret-free records, and client/context cleanup. These are evidence for the implemented protocol-neutral paths, not a claim that a later HTTP entrypoint is already enforced.

## Real CI signoff and resolved verification findings

The final candidate `41ed4bbf48fb7f8af988cd347b3217424e4e0fe4` passed [Zhiban Identity PG16 Security run 37123488443](https://github.com/yhouzxm/OpenMAIC/actions/runs/37123488443): `workflow_dispatch`, exact head SHA, completed SUCCESS. The actual server was PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2); Node was v22.23.3 on linux/x64. `pnpm install --frozen-lockfile` passed. Both full PG16 run markers and PASS markers are in the log.

| Final run evidence | Result |
| --- | --- |
| PG16 run 1 / run 2 | 256/256 PASS each, all 11 suites each run |
| Original PG16 regression | 206/206 PASS per run |
| New 1B-8C PG16 suite | 50/50 PASS per run |
| Previously failing C8-PG06, PG23, PG24, PG35 | PASS in both runs |
| Static / Domain and contracts / Credential / Session | 29 / 377 / 99 / 50 PASS |
| Repository / Authorization / use cases / 1B-8C schema | 352 / 110 / 152 / 20 PASS |
| Full non-PG Identity regression | 1189/1189 PASS |
| Root lint / typecheck | PASS, 0 errors and 20 existing warnings / PASS |

Real PG16 verification resolved three findings before freeze. The first candidate exposed a parser-invalid 0009 policy delimiter; the corrected 0009 then passed the migration runner and checksum tests. A test-only password screening fixture rejected the valid base64url dummy used by the real Argon2 provider; the fixture and native-provider regression were corrected. The next run exposed fixture clock ordering in three member cases and one old-Session assertion inconsistent with the existing fail-closed `CONFLICT` contract; the final candidate fixed those tests and added a persisted revocation assertion. These were repaired before signoff. The final run was newly dispatched on its exact SHA, not a rerun of an older candidate.

FINAL P0: 0. FINAL P1: 0. FINAL P2: 0.

## Deferred boundaries

DEFERRED_TO_1B8D_AUTH_HTTP: thin public Identity adapters, identifier UX and safe lookup, real cookie extraction/set/clear, actual Origin/CSRF enforcement, public 401/403/404 and non-enumerating error mapping, protected route and worker coverage, response cache/secret checks, deployment-backed admission and IP/rate controls, and application/API decision audit. Configuration of the approved catalog, screening corpus, HMAC and CSRF keys, trusted proxy/client IP, operator evidence store, capacity thresholds, backup and multi-instance behavior must be completed and verified before opening production entrypoints. A green protocol-neutral CI run does not establish those deployment facts.

DEFERRED_TO_1B8E_RECOVERY: public recovery remains closed. Any reset channel or controlled operator recovery needs its own explicit identity-proof, approval, provider, audit, replay, and operational design. FIRST onboarding is not a recovery path. Expired PENDING invitations have no implicit renewal producer in this unit.

DEFERRED_TO_RESOURCE_PHASES: Course, Class, Enrollment, and teaching relationship loaders, their permissions, and resource mutation guards. OUT_OF_SCOPE: MFA, OAuth/OIDC, JWT, OpenMAIC bridge, V1 migration, portals, and production cutover.

Later work must preserve exact admission/consent/approval separation, private Session and password proof, fresh same-client authorization and versions, no grant/scope stitching or terminal revival, bounded sorted lock sets, last-admin protection, closed safe outcomes, audit atomicity, least-privilege ACL/RLS, and unchanged applied migration checksums. This closeout creates one documentation file and does not rerun CI or change implementation.

PHASE_1B8C: COMPLETE

MEMBERSHIP_COMPOSITION_DESIGN: FROZEN

MEMBERSHIP_COMPOSITION_IMPLEMENTATION: FROZEN

REAL_PG16_SIGNOFF: PASS

PG16_RUN_1: 256/256 PASS

PG16_RUN_2: 256/256 PASS

FULL_IDENTITY_REGRESSION: 1189/1189 PASS

1B1_F05: CLOSED_IN_1B8C_USE_CASE_SCOPE

P0: 0

P1: 0

P2: 0

DEFERRED_TO_1B8D: AUTH_HTTP_AND_DEPLOYMENT_WIRING

DEFERRED_TO_1B8E: RECOVERY_REQUIRES_SEPARATE_APPROVAL

READY_FOR_1B8C_CLOSEOUT_CHECKPOINT: YES

READY_FOR_1B8D: YES_AFTER_CLOSEOUT_CHECKPOINT_AND_SEPARATE_DESIGN_AUTHORIZATION
