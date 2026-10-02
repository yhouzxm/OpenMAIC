# Phase 1B-5 Credential Closeout

STATUS: COMPLETE / FROZEN

READY_FOR_1B6: YES_AFTER_CLOSEOUT_CHECKPOINT

Date: 2026-10-02. Branch: `refactor/zhiban-v2`. Signed-off implementation HEAD: `8e19c9359a9f021d3c9669fff50650e43c7a6f5d`.

This closes Phase 1B-5A Credential design and Phase 1B-5B persistence, hashing, repository and real PostgreSQL 16 signoff. This documentation-only closeout awaits independent review/checkpoint. It does not implement Session, enable a public login API, approve recovery flows, or certify production cutover. No code, tests, workflow, migrations or packages change in this round; no commit/push or test/CI rerun is performed.

## Scope and sources of authority

The frozen scope is global PASSWORD ownership, security-only contracts/records, mature hashing and screening, verification, permanent slot/history persistence, CAS/securityEpoch, atomic credential mutation plus closed audit composition, least-privilege ACL, and the completed real PG16 evidence.

Repository sources read for this closeout:

- [Credential design](phase1b-5-credential-design.md) and [1B-4 closeout](phase1b-4-review.md). Historical design-time ABSENT/PARTIAL/deferred implementation markers remain historical; the completed items below supersede those markers without changing the design.
- [Credential repository contract](../../../lib/zhiban/application/identity/ports/credential-repository.ts), [hashing contract](../../../lib/zhiban/application/identity/ports/password-hashing.ts), [screening contract](../../../lib/zhiban/application/identity/ports/password-screening.ts), and unchanged [CredentialVerifierPort](../../../lib/zhiban/application/identity/ports/credential-verifier.ts).
- [Argon2 provider](../../../lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher.ts), [verifier](../../../lib/zhiban/infrastructure/identity/credentials/credential-verifier.ts), [local screening](../../../lib/zhiban/infrastructure/identity/credentials/password-screening.ts), [private verifier material](../../../lib/zhiban/infrastructure/identity/credentials/verifier-material.ts), and [sanitized errors](../../../lib/zhiban/infrastructure/identity/credentials/credential-errors.ts).
- [Credential repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/credential.ts), [security record validation](../../../lib/zhiban/infrastructure/identity/postgres/repositories/credential-records.ts), [0004](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0004_identity_credentials.sql), and [0005](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0005_identity_credential_consistency_fix.sql).
- [Credential real PG16 tests](../../../tests/zhiban/identity/postgres/pg16-credentials.test.ts) and [existing PG16 workflow](../../../.github/workflows/zhiban-identity-pg16-security.yml), together with the completed run metadata/logs linked below.
- [1B-2 review](phase1b-2-review.md) for the continuing ownership of 1B2-F07 and 1B1-F05.

## Frozen ownership and secret boundary

CREDENTIAL OWNERSHIP: GLOBAL USER. TYPE: PASSWORD ONLY. Initial locator: canonical lowercase UUIDv7 UserId, not a tenant-prefixed identifier or bearer proof. No email/phone/username lookup or identifier UX is added.

Credential is an Infrastructure security persistence record, not ordinary Identity Domain aggregate state. TenantContext is NOT REQUIRED: credentials belong to the global User, not Membership. Membership authVersion is NOT REUSED for passwords, credential freshness or sessions. Credential verification neither chooses a tenant nor inspects Membership, RoleGrant or RBAC.

| Material / result | Frozen boundary |
| --- | --- |
| Raw password/secret | Short-lived input only; never persisted, Domain state, audit, log, error/cause, snapshot, ordinary Loaded result or API-shaped output. No submitted-secret queue/cache. |
| Encoded verifier / PHC material | Infrastructure security persistence/provider boundary only; excluded from ordinary business barrels, metadata/results, audit and SQL-parameter logging. |
| PasswordVerifierHandle / PasswordRehashHandle | Narrow security-only contract handles; material lives in Infrastructure-private WeakMaps, not serializable handle fields. Copies/forgeries do not acquire material or proof. |
| Slot/history metadata | Explicit safe projections; ordinary Loaded slot/history results contain no verifier. |
| Verification snapshot | Infrastructure-only current User/credential/revision/epoch plus private handle, never ordinary business Loaded output or a public authentication certificate. |
| Provider/driver/caller errors | Fresh closed-code sanitized errors; vendor message, custom code, cause and attached security material are not forwarded. |

RAW SECRET PERSISTED: NO. RAW SECRET DOMAIN: NO. RAW SECRET AUDIT/LOG: NO. VERIFIER: INFRASTRUCTURE SECURITY BOUNDARY ONLY.

JS string zeroization and overall constant-time service behavior are not claimed. Deployment still owns database/backup access, encryption/retention and tracing/APM redaction; cleared terminal live verifiers do not erase historical backups. No production data/hash import is enabled by this freeze.

## Hashing, screening and admission freeze

PASSWORD HASH: Argon2id, provider `@node-rs/argon2@2.2.1`, Argon2 v19, `m=32768` KiB (32 MiB), `t=3`, `p=1`, output 32 bytes, secure random salt generated by the provider. Storage uses its standard self-describing PHC representation. Target Node version is 22; Linux native runtime execution is proved below.

Hashing and verification belong to PasswordHashingPort and its Infrastructure implementation, never Domain crypto. Production and tests share the production policy; approved legacy fixtures are explicit compatibility/rehash vectors, not a lower production default. Bounded algorithm/version/cost/encoding validation precedes provider dispatch. No plaintext/reversible encryption, home-grown KDF/salt protocol, fixed salt, silent downgrade or weak fallback is permitted.

Creation screening is required by the frozen design. The provisioned approved local compromised-password corpus is configuration, not collected authentication traffic. It is bounded and performs no external network disclosure of the raw password. Missing/invalid corpus configuration fails closed. Only an exact boolean `false` screening result allows hash creation; match, invalid/non-boolean result or exception cannot allow creation. Errors remain sanitized. Input length/Unicode bounds and baseline creation policy remain enforced without trimming, normalization, truncation or prehashing.

Process-wide expensive KDF admission is capped at 2 hash/verify jobs, rejects excess work rather than queueing raw secrets, and releases permits on exceptions. The verifier also has bounded process-local concurrency and expiring locator budgets. These controls are not a distributed/IP rate limiter. Public/IP/distributed rate/admission integration remains mandatory in 1B-8 or the corresponding application/API layer; no public login is enabled here.

## Lifecycle, repository and concurrency freeze

Credential generations follow `ACTIVE -> REPLACED` or `ACTIVE -> REVOKED`. REPLACED/REVOKED are terminal and cannot revive on User restoration or stale command replay. Replacement requires a fresh CredentialId, including replacement after revoke. History retains safe immutable generation/lifecycle facts; replacement/revocation clears the old verifier rather than retaining a usable password hash archive.

The per-User PASSWORD slot is a permanent concurrency anchor, including when its active pointer is null. It is never recreated as an absence-based last-writer-wins reset path. Slot pointer, generation and history ownership must agree. UUIDv7, closed type/status, canonical numeric values, timestamps, nullable fields and verifier representation are validated fail closed by records and database constraints.

| Operation | Frozen semantics |
| --- | --- |
| Initial create | User FK, unique permanent slot, new ACTIVE generation, revision/epoch/generation initially 1, and mutation audit commit together. Concurrent initial creates have exactly one success; loser CONFLICT. |
| Replace | Current expected revision/target, fresh CredentialId and generation; terminalize/clear old ACTIVE, install new ACTIVE, advance pointer/revision/epoch once and audit in one transaction. Same plaintext replacement is still a security mutation, not an inferred no-op. |
| Revoke | Terminalize/clear current ACTIVE, null pointer, revision/epoch advance once, generation unchanged, audit atomically. Terminal history is never revived. |
| TRUE NO-OP | Revoke with a current null target only after current expected revision validation; returns current stored safe Loaded, with no writes/audit or revision/epoch changes. Stale null-target revoke is rejected first. |
| Technical rehash | Explicit verified same-secret proof; same CredentialId/generation/lifecycle, revision advances once, securityEpoch unchanged. Not automatic verification-path persistence and not a reset capability. Stale proof cannot overwrite a replacement/revoke. |

RepositoryRevision retains 1B-4 semantics: canonical positive signed-int8 decimal string, BigInt validation, never JS Number/xmin, stale-before-no-op, guarded CAS, exactly one increment per mutation, max-int8 mutation fail closed. securityEpoch is a separate canonical nonnegative signed-int8 string/BigInt contract; persisted initialized slots start at 1. Replace/revoke increment it exactly once; verification, technical rehash and true no-op do not. Epoch maximum fails closed without wrap. It is neither Membership authVersion nor User RepositoryRevision.

Hashing is prepared outside the database write-lock critical section. The repository consumes private handles, then re-reads/locks the permanent slot and validates current revision/target before mutation. Parent CAS, all credential history/pointer changes and closed mutation audit use one exclusive auth-runtime client and one transaction. Failure at slot, old history, new insert or audit rolls back the whole state; no partial revision/epoch advancement or terminalization is committed. Concurrent replacement and revoke-versus-replace have exactly one winner, with the loser stale rather than silently replayed.

The existing non-tenant transaction primitive is reused with an explicitly composed auth-runtime pool, not a control/migrator pool or a second transaction framework. Same-client BEGIN/work/checked COMMIT, rollback, primary error preservation and cleanup semantics remain frozen. Real SQLSTATE 40001/40P01 alone classify retryable persistence failure; AUTO RETRY: NO. Aborted COMMIT returning ROLLBACK fails closed. No independent generation repository/CAS or generic UnitOfWork is introduced.

## Authentication and audit freeze

Correct current password for an ACTIVE User is accepted; wrong password is rejected. Unknown/invalid User locator and missing/inactive credential use a prepared valid dummy verifier and real KDF verification rather than a credential-existence fast path. DISABLED User is rejected even for a correct password. Dummy success cannot authenticate an absent/inactive subject.

After crypto, a fresh validated database read checks current ACTIVE User, slot pointer, RepositoryRevision and securityEpoch. Disable or credential replacement during verification invalidates that decision; there is no hidden automatic retry. The unchanged CredentialVerifierPort returns only VERIFIED(UserId) or REJECTED. It issues no session/cookie/token and performs no tenant/RBAC selection. The final observation is not a lasting approval or an epoch-bound Session issuance proof.

Unknown/missing/inactive/wrong/disabled paths retain the uniform internal rejection shape; provider/admission/persistence failures retain sanitized failure contracts. Public HTTP error/status/body/header normalization is a later 1B-8 API boundary requirement, not a claim established by this internal union. Dummy KDF reduces the obvious fast-path oracle, not overall constant-time behavior; measured real/dummy/legacy distributions are evidence, not a perfect timing guarantee.

Credential mutation audit composition is complete: closed GLOBAL events `CREDENTIAL_CREATED`, `CREDENTIAL_REPLACED`, `CREDENTIAL_REVOKED`, `CREDENTIAL_REHASHED`, explicit safe IDs and revision/epoch strings, approved actor/reason/request context, no arbitrary attributes. Audit contains no raw secret, hash/verifier, salt, provider parameters/object or crypto exception. Required event insert uses the same mutation client/transaction; audit failure rolls back credential state. Broader application/API approval and authentication audit integration remains deferred, not implicitly completed by this repository composition.

## Database and privilege freeze

Final migration inventory is `0001_identity_bootstrap.sql`, `0002_identity_core.sql`, `0003_identity_audit_and_rls.sql`, `0004_identity_credentials.sql`, `0005_identity_credential_consistency_fix.sql`. No startup DDL/ORM auto-sync or extra production migration is introduced. A failing test-only 0006 is an in-memory runner fixture, not part of that inventory.

Credential tables are `zhiban_identity.credential_slots` and `zhiban_identity.credentials`. Tenant RLS is NOT REQUIRED for these global User-owned security records; dedicated ACL is the boundary, not a tenant GUC or permissive RLS fallback. Existing tenant-owned table RLS/FORCE RLS remains unchanged.

The schema owner remains `zhiban_identity_owner` NOLOGIN. Runtime is not owner, superuser or BYPASSRLS and retains NOCREATEDB/NOCREATEROLE and restricted role membership. Deferred same-user composite FKs/consistency triggers, single-ACTIVE uniqueness, ownership/generation/lifecycle guards and parent-CAS requirements enforce commit-time aggregate consistency and no terminal revival.

| Principal | Credential privilege result |
| --- | --- |
| zhiban_auth_runtime | Minimum SELECT/INSERT and explicit required UPDATE columns; no blanket table UPDATE, DELETE, TRUNCATE or DDL. User lifecycle read, not broad User write privilege. |
| zhiban_runtime | Credential table read/write DENIED. |
| zhiban_control_runtime | Credential/verifier read/write DENIED. |
| PUBLIC | Credential table grants NONE; column grants NONE; relevant function capability grants NONE. |

The PUBLIC column catalog assertion explodes nullable `attacl` directly with the non-NULL condition; no zero-dimensional empty-array fallback, skipped column check or catch-and-pass. Table, column and function checks all execute. CREATE OR REPLACE in 0005 preserves the function identity/privileges and changes only the conflicting relation alias.

### Real PG16 verification findings resolved before freeze

| Candidate / run | Resolution before final signoff |
| --- | --- |
| `c8046386ae8bd220ca086e95c0dd130ccd0b0bf6` / 36995821113 | Real PG16 identified the 0004 PL/pgSQL CASE/IF parser boundary. The unapplied invalid migration was corrected with explicit CASE parentheses, without changing generation/epoch semantics. |
| `86c059242729ff926f3f0e7a56dadffc3557e103` / 36999048385 | Parser/application and migration runner passed; real execution identified `old` SQL relation alias ambiguity with implicit OLD, plus the PUBLIC column ACL empty-array catalog query issue. |
| `8e19c9359a9f021d3c9669fff50650e43c7a6f5d` / 37002603143 | Additive 0005 replaces credential_consistency with relation alias `prior_credential`, preserving all business checks. Applied 0004 stays byte/checksum-identical to the prior candidate. PUBLIC query is corrected without removing any ACL assertion. Full final verification passes twice. |

Once 0004 could successfully apply, it was not rewritten for the runtime fix. Fresh databases apply 0001–0005; previously applied 0004 databases advance through 0005, not checksum drift. Old runs are historical findings, not substitute final signoff evidence.

## Final real PostgreSQL 16 evidence

Completed metadata and logs were read for this closeout; no dispatch/rerun was needed.

| Evidence | Final result |
| --- | --- |
| Workflow | Zhiban Identity PG16 Security |
| Run | [37002603143](https://github.com/yhouzxm/OpenMAIC/actions/runs/37002603143) |
| Candidate / branch | `8e19c9359a9f021d3c9669fff50650e43c7a6f5d` / refactor/zhiban-v2 |
| Event / status / conclusion | workflow_dispatch / completed / SUCCESS |
| Actual server_version | 16.15 (Debian 16.15-1.pgdg13+2) |
| PG16 RUN 1 | 88/88 PASS |
| PG16 RUN 2 | 88/88 PASS, same PG16 environment |
| Original 1B-4 real PG16 | 53/53 PASS per run |
| Credential real PG16 | 35/35 PASS per run |
| Actual KDF runtime | v22.23.3 linux/x64, Ubuntu runner; @node-rs/argon2@2.2.1 |
| Argon2 native hash/correct verify/wrong verify/dummy execution | PASS |
| Frozen dependency install | PASS, no lockfile drift |

Both RUN/PASS markers and all seven suite results appear in the logs, not merely a green overall job. Real PG16 is not replaced by mocks, static SQL assertions or PG18. Restricted runtime connections execute credential/RLS behavior; admin access supplies setup, seed, catalog and cleanup only.

| Suite in each complete PG16 run | Passing tests |
| --- | ---: |
| pg16-role-bootstrap.test.ts | 10 |
| pg16-migration-runner.test.ts | 4 |
| pg16-schema-security.test.ts | 5 |
| pg16-rls.test.ts | 8 |
| pg16-transactions.test.ts | 5 |
| pg16-repository-signoff.test.ts | 21 |
| pg16-credentials.test.ts | 35 |
| Total | 88 |

### Real signoff matrix

| Capability | Final result |
| --- | --- |
| Migration 0001–0005 parse/apply; second CLI no-op; checksum drift; failed migration rollback; advisory lock | PASS, 4/4 each run |
| 0004 retained checksum; 0005 runtime trigger; alias ambiguity | PRESERVED / PASS / ABSENT |
| Runtime role security, tenant RLS catalog/FORCE RLS, tenant read/write isolation | PASS |
| Missing/invalid/unknown tenant context; tenant GUC; reused pool leakage | FAIL_CLOSED / PASS / NONE |
| Global CAS and stale-before-no-op; Membership CAS/authVersion/history; aggregate rollback | PASS |
| Aborted COMMIT; real 40001/40P01 and retryable classification; automatic retry | PASS / PASS / NO |
| Credential schema, auth least privilege, tenant/control denial, PUBLIC table/column/function ACL | PASS |
| Initial create race; replacement race; revoke-versus-replace race | EXACTLY_ONE_SUCCESS |
| Correct/wrong password; dummy KDF; disabled User and post-crypto validation | ACCEPTED / REJECTED / PASS / REJECTED |
| Replace, old-password rejection, new-password validity, revision/epoch increments, stale rejection | PASS |
| Controlled replacement/revoke failures including audit | FULL_ROLLBACK |
| Terminal revival, reused old ID, stale rehash revival | BLOCKED |
| Max revision/epoch and malformed persisted record | FAIL_CLOSED |
| Closed secret-free audit, same-transaction composition, pool/client cleanup | PASS |
| Former alias ambiguity and zero-dimensional ACL array error | ABSENT |

Real concurrency uses acknowledged database locks/barriers, not sleep-based races. The real Credential path tests forced SQL failures after acknowledged slot/history/insert/audit writes and compared all stored state after rollback. Common 40001/40P01 proofs remain in the retained original suite rather than being claimed from fake exceptions.

## Final test evidence and severity

| Final candidate CI gate | Result |
| --- | --- |
| Bootstrap/migration/runner static and unit regression | 27/27 PASS |
| Identity Domain / Port contracts | 376/376 PASS |
| Credential unit/contracts, repository and schema | 99/99 PASS |
| Screening non-boolean/exception fail-closed, sanitized cause/custom-code errors, permit release and final authentication validation | PASS |
| Root lint, actually executed | PASS: 0 errors, 20 existing warnings |
| Root typecheck, actually executed | PASS with command-scoped NODE_OPTIONS=--max-old-space-size=8192 |

FINAL P0: 0. FINAL P1: 0. FINAL P2: 0 for the completed Credential scope. Local PG16 availability is not upgraded by this evidence; GitHub real PG16 closes the verification gap. Later-phase and deployment obligations below are not open defects or completed features in this signoff. This docs-only round does not rerun the 850+ local regression or PG16 CI.

## Deferred-item reconciliation

CLOSED_IN_1B5: Credential schema/tables reserved by 1B-3B; Credential persistence/repository; hashing provider; verifier; raw-secret/private-verifier boundary; RepositoryRevision/CAS; securityEpoch; initial-create and replace races; atomic replacement and revoke; dummy verification; disabled User rejection; closed credential audit composition; Credential ACL; real PG16 proof; Linux Node 22 native Argon2 proof. Migration parser/runtime alias and PUBLIC catalog-query findings are resolved before freeze.

### DEFERRED_TO_1B6_SESSION

- SessionId ownership/unpredictability, including 1B2-F07; session issuance, rotation and revocation.
- Absolute expiry, idle expiry, opaque cookie/session token handling and digest storage composition.
- securityEpoch binding; credential change/revoke/compromise invalidates pre-change sessions; no old-session revival.
- User disable/session invalidation coordination and fresh current-User checks.
- Issuance/revocation races and credential/User changes between authentication observation and session commit; server-only freshness binding, not client-provided epoch or VERIFIED(UserId) alone.
- CSRF/origin session integration; coordination with later API boundaries.

Existing Session contracts/schema are prerequisites, not evidence of a Session service implemented by 1B-5. No session table mutation, token issuance, cookie or JWT implementation is added here.

### DEFERRED_TO_1B8_AUTH_API

- Public login API and identifier UX/resolver policy; public authentication error normalization across status/body/headers and operational failures.
- Reset/re-auth approval, recovery channels, evidence/token issuance/consumption and notifications; Credential replacement persistence is not authority to reset another User.
- Distributed/IP admission/rate controls and public integration of bounded local controls.
- Application/API audit integration and use-case authorization; Credential-specific same-transaction mutation audit is already complete, not deferred again.
- 1B1-F05 pending-origin grant recovery approval remains with frozen 1B-8 approval design; it is not Credential or Session ownership work.

### OUT_OF_SCOPE

MFA, OAuth, JWT, OpenMAIC Identity Bridge, Course, Portal and production cutover remain outside 1B-5. Authorization/RBAC policy implementation is a separate phase. Deployment corpus provisioning/refresh, logging/backup hardening and production data migration are not certified by ephemeral CI. No tenant/RBAC/Domain ownership model is rewritten.

## Forbidden future regressions and next-phase readiness

Later work must not expose secrets/verifiers through Domain/business results/audit/logs/errors, weaken screening or hashing parameters, broaden Credential ACL, attach TenantContext or Membership authVersion to global password state, bypass permanent slot CAS/epoch/history guards, accept stale no-ops, revive terminal generations, hash while holding long DB locks, split mutation/audit transactions, silently retry obsolete approvals, or rewrite applied migrations/checksums. No future Session issuance may treat an old authentication result as a current epoch-bound proof.

1B-6 builds on this frozen Credential foundation after the documentation checkpoint and independent verification. This round creates only this closeout document, with no implementation, migration, package, test or workflow changes. COMMIT: NO. PUSH: NO.

PHASE_1B5: COMPLETE

CREDENTIAL_DESIGN: FROZEN

CREDENTIAL_IMPLEMENTATION: FROZEN

REAL_PG16_SIGNOFF: PASS

P0: 0

P1: 0

P2: 0

DEFERRED_TO_1B6: SESSION

DEFERRED_TO_1B8: AUTH/API

READY_FOR_1B6: YES_AFTER_CLOSEOUT_CHECKPOINT
