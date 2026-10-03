# Phase 1B-8D — Identity HTTP / API Closeout

STATUS: COMPLETE / FROZEN

Date: 2026-10-04. Branch: `refactor/zhiban-v2`. Signed-off implementation HEAD: `a82f101becebd26343a53224ab61a5274d597b3f`.

This closes the human-approved D8-S01–S08 Identity HTTP/API engineering unit after exact-candidate real PostgreSQL 16 and full Identity regression signoff. It freezes the implemented server-side HTTP boundary, **not** a production cutover. Public production entrypoints remain closed until the separately approved deployment acceptance is satisfied. Historical BUILD-pending language in the [approved design](phase1b-8d-http-api-design.md) describes its earlier checkpoint; this document records the later signed-off state without changing that design.

## Authority and implemented boundary

The authority is the [1B-8D approved design](phase1b-8d-http-api-design.md), D8-S01–S08, and the frozen [1B-8C composition closeout](phase1b-8c-review.md). Identity, Credential, Session, Authorization, approval, CAS, last-admin, and audit contracts remain in force. The [execution plan](../zhiban-v2-execution-plan.md) keeps later recovery, resource, bridge, and deployment phases separate.

The implementation is the fixed [Identity route namespace](../../../app/api/zhiban/identity), [HTTP adapter](../../../lib/zhiban/infrastructure/identity/http/adapter.ts), [bounded protocol](../../../lib/zhiban/infrastructure/identity/http/protocol.ts), [closed DTO translation](../../../lib/zhiban/infrastructure/identity/http/dto.ts), [server-only root](../../../lib/zhiban/infrastructure/identity/http/root.ts), [safe-query Port](../../../lib/zhiban/application/identity/ports/safe-queries.ts) and [composition](../../../lib/zhiban/infrastructure/identity/composition/safe-queries.ts). The exact [middleware exception](../../../middleware.ts), [HTTP unit and real Node/Next tests](../../../tests/zhiban/identity/http), [real PG16 HTTP suite](../../../tests/zhiban/identity/postgres/pg16-identity-http.test.ts), and [existing two-run workflow](../../../.github/workflows/zhiban-identity-pg16-security.yml) supply the verification boundary. There is no new migration or role bootstrap change; inventory remains 0001–0009, with 0001–0009 unchanged. No Domain, package, native OpenMAIC API, or frozen Credential/Session semantics were changed for this unit.

The public namespace uses finite, Node-only route/method dispatch: login, logout, logout-all, me, csrf, spaces, own password state/change, manager membership point, subject consent context, invitations, consents, fixed membership commands, and atomic two-target administrator transfer. Unknown paths and unsupported methods do not dispatch business work. There is no catch-all business mutation, public control-plane/FIRST consumption, recovery/reset, registration, global user resolver, teaching API, tenant-selection mutation, or public rotation endpoint. The native ACCESS_CODE exception matches only `/api/zhiban/identity` and its segment-prefixed descendants; it delegates to the Identity gate and grants no Identity or native-route authority by itself.

## Frozen HTTP and security contract

UserId remains the bounded canonical login locator; the authenticated User comes only from the private Session handle. A Session authenticates a global User, never a Tenant, Membership, role, permission, scope, or active-Tenant snapshot. Path TenantId is an untrusted scope candidate; member commands retain fresh same-client Session, User, Credential securityEpoch, tenant, Membership, grant, approval, authorizationVersion and CAS checks inside the existing use cases. Revoke/disable/credential change races cannot turn an earlier HTTP read into a write permit. No auto-retry follows an uncertain commit or stale version.

Only one exact `__Host-zhiban_session` cookie carries the opaque bearer. The bearer is emitted solely as `Set-Cookie` after successful issuance; it is never persisted as raw token, projected into JSON, logged, audited, placed in a URL/localStorage, or accepted as an Authorization header. The cookie is HttpOnly, Secure, SameSite=Lax, Path=/, with no Domain; clear-cookie attributes are consistent. Session digest, idle/absolute expiry, current User state and Credential epoch remain authoritative in storage. Login account switching revokes the existing Session before new issuance; failure does not silently preserve the old Session. Password change and logout-all clear the cookie only after commit.

Unsafe requests require an exact configured Origin, JSON media type and `X-Zhiban-Request: identity-v1`; authenticated unsafe requests additionally require the current Session-bound CSRF proof. SameSite is not the sole CSRF control. Safe reads retain the custom-header/Origin and Fetch Metadata rules. The protocol rejects duplicate/malformed security headers or cookies, unknown fields, invalid encodings/media, excess wire bytes, unsafe paths and forged locators before KDF or business work. The response is a closed success projection or `{error:{code,requestId}}`, with no-store/security headers and no reflected secrets, internal cause, SQLSTATE, grant history or error detail. Missing/foreign resources do not disclose other-Tenant versions. Verified budget denial maps to 429; backend, catalog, corpus, proxy and unclassified failures fail closed to 503 rather than masquerading as account absence. Request-local refusal observations cannot be supplied by a caller or inherited by a later operation.

The three restricted read compositions are own password revision, a fresh authorized manager point projection, and subject-bound consent context. They expose only the approved current fields, not verifier/history, operator evidence, raw handle, full roster or global search. The manager read binds actor Membership to the authenticated User before further locks, then rechecks current authorization; consent lookup is purpose-, source-, User-, Tenant- and version-bound. Pagination is a navigation hint, never a permission snapshot or complete last-admin roster. Existing column grants, scoped RLS and helpers remain the authority; no convenience definer or ACL expansion was added.

The server-only manifest/process facade defaults closed. It requires approved origin, fixed overwriting proxy/private backend, same approved database endpoint with separate auth/tenant/control runtime pools, persisted catalog and admission policies, local password-screening corpus, operator evidence references, finite capacity/timeouts, and `SINGLE_PROCESS_HTTPS`. A request-supplied IP or X-Forwarded-For chain is not trusted as a verified peer. One process-lifetime root/registry keeps Session and CSRF material private across route bundles; missing or invalid readiness closes the public path. Runtime roles retain existing least privilege: auth owns no tenant permission, tenant runtime cannot read Session/Credential security material, control runtime cannot read token digest/verifier, and PUBLIC gains no new capability. Session and Credential global tables still do not use tenant RLS; tenant-owned membership data remains scoped by its existing RLS.

Existing closed Identity business audit remains in the same mutation transaction, including Session revocation and membership command effects. HTTP wiring adds no generic audit event/table. Bounded operational records contain only safe request ID, finite route/status and duration class; they are not a substitute for a separately approved durable authorization-decision audit. Raw password, bearer, digest, verifier, CSRF, full URL/query/header/body, IP, SQL params, and hostile exception cause/custom code are excluded from ordinary DTO, audit and telemetry output.

## Real CI signoff and verification findings

The final candidate `a82f101becebd26343a53224ab61a5274d597b3f` passed [Zhiban Identity PG16 Security run 37156652308](https://github.com/yhouzxm/OpenMAIC/actions/runs/37156652308): `workflow_dispatch`, exact head SHA, completed SUCCESS. The actual environment was PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2), Node v22.23.3 on linux/x64. `pnpm install --frozen-lockfile` passed. The existing Argon2id native provider executed under Node 22 with m=32768, t=3, p=1. Both complete PG16 run markers and PASS markers are present in the log.

| Final run evidence | Result |
| --- | --- |
| PG16 run 1 / run 2 | 282/282 PASS each, all 12 suites each run |
| Existing 1B-4–8C PG16 regression | 256/256 PASS per run |
| New 1B-8D real PG16 HTTP suite | 26/26 PASS per run |
| Static / Domain and contracts / Credential / Session | 29 / 377 / 99 / 50 PASS |
| Repository / Authorization / use cases / 1B-8C schema | 352 / 110 / 156 / 20 PASS |
| HTTP unit, real Node and Next routing regression | 138/138 PASS |
| Full non-PG Identity regression | 1331/1331 PASS |
| Root lint / typecheck | PASS, 0 errors and 20 existing warnings / PASS |

The real HTTP suite covers the credentialed and anonymous paths, current User/Session/epoch and safe query visibility, member admission/consent and fixed commands, cross-Tenant denial, old-cookie invalidation, authentication-to-write revocation races, independent-connection last-admin contention, atomic transfer, idempotent lost-response confirmation, three injected audit/ledger/effect rollback paths, and the distinct 429 budget / 503 backend or missing-proxy outcomes. The real Node and installed Next routing checks separately exercise header/cookie behavior, route-module continuity, method refusal and namespace isolation. A green unit mock is not substituted for these PG16 and HTTP results.

Two test-harness findings were resolved before freeze; neither was a change to the production protocol. Candidate `e398f74b997acec43eb58ea02dcc44d939b1dc7e`, run 37132684709, passed the previous PG16 suites but exposed anonymous fixtures sending a literal empty Cookie; the production parser correctly rejected that malformed header. Candidate `fe19c98082cd01e215a9dfd4bb0b9b78bc3be5d9`, run 37155798934, closed that case and exposed a fixture that merged differently cased proxy-header keys into a duplicate/invalid address; production again rejected it. The final candidate uses actual `Headers.set/delete` semantics and includes real Node HTTP regressions. Each candidate had a new dispatch on its own SHA; no failed run was treated as passing. Final P0: 0. Final P1: 0. Final P2: 0.

## Deferred and release gates

`PRODUCTION_ENTRYPOINTS` remain **CLOSED_UNTIL_DEPLOYMENT_ACCEPTANCE**. Code/CI acceptance does not prove real HTTPS browser/proxy topology, direct-backend isolation, fixed canonical client-IP overwrite, approved exact origin, provisioned corpus/catalog/admission policies/operator evidence, fleet capacity and timeouts, telemetry/APM redaction, backup/restore/maintenance, or migration-ledger preflight. The first accepted topology is single-process HTTPS. Multi-instance CSRF/key/routing, admission coordination, live key/config rotation and browser/proxy E2E require separately approved design and operational tests. Native OpenMAIC routes and workers are not thereby certified tenant-safe.

`DEFERRED_TO_1B8E_RECOVERY`: public forgot/reset and recovery channels remain **CLOSED**. Any controlled manual recovery or public flow requires separate human-approved identity proof, provider/channel, authorization, audit, replay and operational design. FIRST onboarding is not a recovery endpoint or historical zero-admin recovery shortcut.

`DEFERRED_TO_LATER_PHASES`: Course/Class/Enrollment resource loaders and relationship facts, OpenMAIC Identity Bridge, learner/teacher/admin portals, V1-to-V2 data migration, and E2E/staging/production acceptance. Control-plane HTTP remains closed. Durable application-level authorization-decision audit, beyond existing atomic business events and bounded operational telemetry, requires a separately approved event/storage contract. OUT_OF_SCOPE here: MFA, OAuth/OIDC, JWT, and production cutover.

Later work must preserve the exact D8 route and DTO vocabulary, tenant isolation and current same-client authorization, no Session permission snapshot or client-declared relationship, current CAS/idempotency and last-admin protection, secret-free audit/telemetry, fail-closed public error mapping, and the unchanged 0001–0009 migration checksums. This closeout creates one documentation file; it does not rerun CI, change implementation, commit, push, dispatch CI, or open a public deployment.

PHASE_1B8D: COMPLETE

HTTP_API_DESIGN: FROZEN

HTTP_API_IMPLEMENTATION: FROZEN

REAL_PG16_SIGNOFF: PASS

PG16_RUN_1: 282/282 PASS

PG16_RUN_2: 282/282 PASS

FULL_IDENTITY_REGRESSION: 1331/1331 PASS

P0: 0

P1: 0

P2: 0

CONTROL_HTTP: CLOSED

PUBLIC_RECOVERY: CLOSED

PRODUCTION_ENTRYPOINTS: CLOSED_UNTIL_DEPLOYMENT_ACCEPTANCE

DEFERRED_TO_1B8E: RECOVERY_REQUIRES_SEPARATE_APPROVAL

READY_FOR_1B8D_CLOSEOUT_CHECKPOINT: YES

READY_FOR_NEXT_PHASE: NO_PENDING_CLOSEOUT_CHECKPOINT_AND_SEPARATE_AUTHORIZATION
