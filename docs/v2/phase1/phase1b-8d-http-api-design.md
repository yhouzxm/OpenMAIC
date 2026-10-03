# Phase 1B-8D — Identity HTTP / API Design

STATUS: HUMAN_APPROVED_DESIGN / FROZEN

Date: 2026-10-03. Branch: `refactor/zhiban-v2`. Audited HEAD: `8f888ea65e6ecb9c61bb1f0e936fcdb08be17140` (`docs(zhiban-v2): close out membership composition`), parent `41ed4bbf48fb7f8af988cd347b3217424e4e0fe4`. Worktree was CLEAN before this document. This unit writes one document only: no implementation, migration, dependency, workflow, test, commit, push, or CI dispatch.

2026-10-03 human approval: the user explicitly requested **“审阅并批准 D8-S01–S08”**. The eight contracts below have been reviewed against the actual repository and are HUMAN_APPROVED_DESIGN / FROZEN, including the non-semantic review clarifications recorded in section 15. Earlier “proposal” wording describes design formation, not an outstanding product choice. Approval is not permission to build, checkpoint, dispatch CI or open production entrypoints: documentation checkpoint, independent remote verification and BUILD authorization remain separate. Existing frozen ownership, lifecycle, CAS, approval, audit, Session, Credential, and Authorization semantics remain authoritative. Deployment acceptance and recovery approval are separate gates.

## 1. Authority and repository audit

Read authority: [execution plan](../zhiban-v2-execution-plan.md), [implementation plan](phase1b-implementation-plan.md), [gate map](phase1b-gate-map.md), [authentication boundary](auth-boundary.md), [Session strategy](session-strategy.md), [approved 1B-8 design and Appendices B/C](phase1b-8-identity-composition-design.md), and [1B-8C closeout](phase1b-8c-review.md). 1B-4/5/6/7 frozen contracts are inherited, not reopened by an HTTP adapter.

Audited implementation includes [own authentication use cases](../../../lib/zhiban/application/identity/use-cases/authentication.ts), [member use cases](../../../lib/zhiban/application/identity/use-cases/memberships.ts), [member composition Port](../../../lib/zhiban/application/identity/ports/membership-composition.ts), [composition root](../../../lib/zhiban/infrastructure/identity/composition/root.ts), authentication/admission/member commands and their private security bridge under `lib/zhiban/infrastructure/identity/composition/`, [authorization repository](../../../lib/zhiban/infrastructure/identity/postgres/repositories/authorization.ts), [browser security](../../../lib/zhiban/infrastructure/identity/sessions/browser-security.ts), applied migrations 0008/0009, existing composition tests and [two-run PG16 workflow](../../../.github/workflows/zhiban-identity-pg16-security.yml), native API inventory, `middleware.ts`, `next.config.ts`, and `instrumentation.ts`.

| Asset | Actual state | 8D action |
| --- | --- | --- |
| UserId-first login, real/dummy KDF, issuance, logout/all, password change | EXISTS, signed off in 8B | Wire existing use cases; no replacement authentication model |
| Session handle, CSRF policy, cookie policy, epoch/User freshness | EXISTS | Keep private registry and one process-lifetime root; extract/set/clear real cookies |
| Own-space discovery | EXISTS in 0008 and 8B | Reuse auth-only Session-bound discovery; no global membership list or new ACL |
| Member invite/consent/activation/recovery/grant/transfer | EXISTS, signed off in 8C | Thin fixed-action routes; same-client guards, approval and audit stay inside use case |
| Public Identity routes | ABSENT | New namespace, closed DTOs and exhaustive entrypoint coverage |
| Public password CAS metadata | GAP | Existing password command needs revision; `me` deliberately does not return it. Add restricted own password-state query, never verifier material |
| Public member/version/consent metadata | GAP | Existing outcomes contain effects, not complete next-command inputs or consent IDs. Add bounded, explicitly authorized read projections |
| Public error classification | PARTIAL | Existing `CONFLICT`/`INTEGRITY_FAILURE` cover several causes; `UNAVAILABLE` also covers admission and storage. Do not infer HTTP causes from these codes alone |
| Trusted proxy, approved production corpus/policies/config loading | DEFERRED | Exact configuration and acceptance gate; no invented production values or test-fixture defaults |
| Native OpenMAIC access-code middleware | EXISTS | Would intercept new namespace when ACCESS_CODE is set; proposed exact namespace exception, not an identity bypass for native routes |
| Control-plane HTTP / recovery / teaching relationship loaders | CLOSED / DEFERRED | Do not register these routes or treat SYSTEM_ADMIN as tenant permission |

Evidence baseline, not new 8D evidence: [run 37123488443](https://github.com/yhouzxm/OpenMAIC/actions/runs/37123488443), exact implementation SHA `41ed4bbf48fb7f8af988cd347b3217424e4e0fe4`, SUCCESS, PostgreSQL 16.15, Node v22.23.3 linux/x64, PG16 **256/256 ×2** (206 previous + 50 C8), non-PG Identity **1189/1189**, frozen install and native Argon2 PASS, lint 0 errors/20 existing warnings, typecheck PASS. The current HEAD only adds the closeout document. No prior result proves new HTTP behavior.

## 2. Approved contract inventory and scope

D8-S01–S08: REVIEW PASS / HUMAN_APPROVED_DESIGN. Approval covers only the contracts and exact exceptions stated here, not unspecified schema, role, product or deployment expansion.

| Approval | Exact proposed contract |
| --- | --- |
| D8-S01 | Fixed same-origin browser JSON routes and DTOs in sections 3–5; no public control/recovery, generic action endpoint, tenant selection mutation, or teaching API |
| D8-S02 | Cookie, Origin/CSRF, request limits, no-store and secret-free response protocol in sections 6–7 |
| D8-S03 | Restricted own-password revision, manager command-state and subject consent-context queries in section 5; existing roles/helpers only, no schema/ACL expansion |
| D8-S04 | Private request-local closed refusal classification in section 8; existing Port error vocabulary/output and state transitions unchanged; no arbitrary exception interpretation |
| D8-S05 | Server-only process-lifetime root and explicit deployment/proxy/config acceptance in section 9; public routes disabled by default |
| D8-S06 | The exact Zhiban Identity namespace exception to native access-code middleware in section 10; native endpoint behavior remains unchanged |
| D8-S07 | Safe operational request records plus existing same-transaction audit in section 11; no new IdentityAuditEvent or database audit capability |
| D8-S08 | Unit, real HTTP, PG16 and complete regression/CI acceptance in sections 12–14; unchanged old suites and separate checkpoint/signoff |

BUILD scope, after approval: `app/api/zhiban/identity/**`, minimal `lib/zhiban/infrastructure/identity/http/**` server-only adapter/config/protocol code, minimal safe-query Application Ports/use cases and Infrastructure implementations, private composition refusal observations/root wiring, `middleware.ts` exact exception, relevant Identity HTTP tests, and minimal additions to the existing PG16 workflow. Existing validators/providers/transactions are reused. No Domain changes, package changes, native OpenMAIC route changes, UI, ServiceActor, or operator HTTP.

MIGRATION: NONE. APPLIED 0001–0009: BIT-FOR-BIT UNCHANGED. ROLE BOOTSTRAP: UNCHANGED. NEW TABLE/GRANT/RLS/DEFINER: NONE. Query implementation must prove executable use of existing column grants and helpers; if it needs an unavailable column/capability, STOP for a separate precise schema/ACL proposal. Approval of this document is not permission to widen roles.

## 3. HTTP entrypoint inventory

All paths below have prefix `/api/zhiban/identity`. Node Route Handlers only, `runtime = 'nodejs'`, dynamic uncached handling, no Edge KDF/database work. Explicit finite path/method dispatch; no Server Actions, workers, webhooks, generic catch-all mutation, GET business writes, automatic redirect, CORS credential access, or `Authorization: Bearer` fallback. Next parameter/cookie APIs must follow the installed Next 16.3.3 API, not copied older synchronous examples. [Next Route Handler contract](https://nextjs.org/docs/app/api-reference/file-conventions/route), [cookies contract](https://nextjs.org/docs/app/api-reference/functions/cookies).

The endpoint helper is mandatory for every listed handler: protocol validation → deployment/root gate → request-local context → authentication where required → Origin/CSRF for unsafe requests → strict DTO/locators → safe visibility check when needed → existing use case → whitelist result/cookie → no-store response. Login has its explicit anonymous path. Business authorization is rechecked by the use case in its transaction; the HTTP check is not a commit permit.

| Method / suffix | Input and actor | Use case / minimal success |
| --- | --- | --- |
| POST `/login` | `{userId,password}`; anonymous protocol, or protected account-switch protocol | `security.login`; 200 own identity + Set-Cookie only, never bearer in JSON |
| POST `/logout` | `{}`; own current cookie, or defined missing/stale-cookie completion | `application.logout`; 204 + clear cookie |
| POST `/logout-all` | `{password}`; own Session + step-up | `application.logoutAll`; 204 + clear cookie |
| GET `/me` | No query/body; own Session | `application.me`; `{userId,absoluteExpiresAt,idleExpiresAt}` |
| GET `/csrf` | No query/body; own Session | `application.csrfToken`; `{csrfToken}` only |
| GET `/spaces` | `after` optional canonical MembershipId, `limit` 1–50/default 25 | `application.spaces`; `{spaces,nextCursor}`; four existing fields per space |
| GET `/password` | No query/body; own Session | New restricted own-password state: `{credentialRevision}` |
| POST `/password` | `{password,newPassword,expectedCredentialRevision}`; own Session + step-up | Existing `application.changePassword`; 204 + clear cookie, new login required |
| GET `/tenants/{tenantId}/memberships/{membershipId}` | `actorMembershipId` required; optional `afterGrantId` and `consentPurpose` | New manager command-state query; current authorized point projection, not a global/list query |
| GET `/tenants/{tenantId}/consent-context` | Exactly one of `admissionId` / `onboardingRef` | New subject query bound to authenticated User via existing consent-context helper |
| POST `/tenants/{tenantId}/invitations` | Manager envelope + `admissionId,password`; independently provisioned source | `members.invite`; 200 closed `MembershipCommandOutcome` |
| POST `/tenants/{tenantId}/consents` | Subject envelope + exactly one source locator; no password proof claim | `members.consent`; 200 closed outcome; consent is not activation/grant |
| POST `/tenants/{tenantId}/memberships/{membershipId}/{command}` | Manager envelope + action-specific proposal + password | Fixed command allowlist below → `members.execute`; 200 closed outcome |
| POST `/tenants/{tenantId}/admin-transfer` | Manager envelope + exactly two closed targets + password | `MEMBERSHIP_ATOMIC_TRANSFER` via one `members.execute`, not two independent requests |

Fixed `{command}` allowlist: `activate`, `disable`, `leave`, `reactivate`, `rejoin`, `grant`, `revoke-grant`, `replace-grants`. Mapped constants respectively: `MEMBERSHIP_ACTIVATE`, `MEMBERSHIP_DISABLE`, `MEMBERSHIP_LEAVE_ADMIN`, `MEMBERSHIP_REACTIVATE`, `MEMBERSHIP_REJOIN`, `ROLE_GRANT`, `ROLE_REVOKE`, `ROLE_REPLACE`. Unknown command/method has no operation. `leave` is administrator-mediated, not a new self-service leave policy. Do not expose FIRST/admin/User/Tenant/provision/import commands through this table.

There is no `/select-space`: `/spaces` returns navigation candidates; the caller chooses the next fixed Tenant path and every request revalidates it. No Session.activeTenant, role/permission snapshot, automatic first-space selection, global user search, email/username resolver, public registration, forgot/reset password, control operations, or recovery endpoint. FIRST subject consent may reference a delivered onboarding locator; consuming it and creating the first administrator remain operator-only.

Unknown namespace path: 404. Unsupported method: 405 with exact Allow and no body/DB work; explicit HEAD/OPTIONS must not invoke GET authentication/touch or produce automatic credentialed preflight access. Export all supported Next method slots with the common refusal helper when not allowed, so framework-generated 405/automatic HEAD/OPTIONS do not bypass response policy. A denial-only unmatched-path route may provide uniform 404/no-store in this exact namespace; it never initializes a business root, resolves actors or dispatches actions and is not a generic mutation endpoint. Unsupported transport methods outside Next's method set must be rejected by the tested framework/proxy boundary. No ACAO/ACAC headers. Cross-origin preflight is rejected. Exported route coverage tests must prove these properties rather than rely on framework defaults.

## 4. Closed input and output contracts

Success JSON is exactly the route's whitelist, with server requestId in a bounded response header. Error JSON is exactly `{error:{code,requestId}}`. No server message, internal reason, supplied locator, failed field value, permission catalog, RoleGrant history, SQLSTATE, stack, cause, custom error field, secret, or reflected body. 204 has no JSON. Explicit projection only: do not spread Domain, Loaded, driver row, private handle, root, proof, or error.

UserId login is the existing bounded ASCII/canonical UUIDv7 resolver, not a global lookup service. Wrong-but-bounded locator/secret uses the existing unified login rejection; oversize/wrong JSON type is protocol rejection. Preserve password bytes/code points: no trim, lowercase, NFC, logging, snapshot, or frontend hash. Existing provider bounds stay unchanged: verification 1–1024 UTF-8 bytes with valid Unicode; creation at least 15 code points and at most 1024 UTF-8 bytes, mandatory screening and provider policy. No new password policy algorithm in HTTP.

All path/member/admission/grant IDs use existing canonical UUIDv7 validators. `onboardingRef` is the existing bounded ASCII approval reference, not an approval UUID; it must be resolved through the approved evidence store before calling the SQL helper. Actor UserId always comes from the private authenticated handle; never from body, request headers or Session claims. Path TenantId is a candidate for a new TenantContext, not proof. Body TenantId/actorUserId/requestId/approved/relationship/isAdmin/RoleId/SessionId/epoch/catalog digest are forbidden; action is server-selected except the explicitly closed per-target transfer action. Body target UserId is allowed only in the two-target transfer as an untrusted locator, then checked against scoped persisted Membership ownership. Single-target UserId is derived from the authorized point query and rechecked in the write transaction.

Manager envelope: `actorMembershipId`, `expectedActorRevision`, `expectedActorAuthorizationVersion`, `expectedTenantRevision`, plus exact route fields. Revisions are canonical positive signed-int8 decimal **strings**, validated with existing BigInt logic and never Number. authVersion is a safe nonnegative integer under the frozen range. `Idempotency-Key` is required for invite/consent/member/transfer only, bounded 1–128 ASCII `[A-Za-z0-9._:-]`; it is a locator, never an approval or a password/token fingerprint. HTTP server generates its own safe requestId for each attempt; client X-Request-ID is ignored, not adopted or logged.

Single member command adds `expectedRevision` and `expectedAuthorizationVersion`. Exact action-specific fields:

| Command | Additional fields and translation |
| --- | --- |
| activate / rejoin | `admissionId,consentId,grants`; explicit 0–16 new grant proposals, no preserve/revoke/mode |
| reactivate | `admissionId,consentId,mode`; REPLACE_GRANTS requires explicit 0–16 `grants`; PRESERVE_EXISTING_VALID_GRANTS requires explicit 0–16 `preserveGrantIds`; no mixed shape |
| disable | `reason` exactly ADMIN_REQUEST, ACCESS_REVIEW or SECURITY_POLICY; no free-text or claimed recovery/service reason |
| leave | No proposal fields; existing ADMIN leave semantics and server-selected compatible reason |
| grant | Exactly one proposal; no supplied new grant ID or validFrom |
| revoke-grant | Exactly one `revokeGrantId`; no replacement grants |
| replace-grants | Explicit 0–16 proposals; no supplied grant IDs/history |

Empty collections are explicit proposals, not omitted approval or a bypass. They preserve the actual frozen `membershipIntent` 0–16 contract and Domain ability to have an ACTIVE membership without roles; fresh action permission, consent where required, versions, ceiling and last-admin complete post-state still apply. An empty proposal cannot remove the last effective administrator. ROLE_GRANT alone still requires exactly one proposal. The route fills unused internal fields with the exact null/empty shape and defaults non-disable command reasons to ADMIN_REQUEST; transfer disable reasons use the same three-value whitelist. Recovery/service reasons cannot be asserted by browser input.

Grant proposal is exactly `{roleCode,scope,validUntil}` matching `MembershipGrantProposal`; scope exactly `{type,scopeId}` using existing Scope parser, with null scopeId for SELF/TENANT and a canonical matching ID for CLASS/COURSE. Membership roles exclude SYSTEM_ADMIN. This release has no trustworthy Class/Course relationship loader, so proposals needing those relationships DENY instead of accepting a client boolean. No role string hierarchy, tenant-admin unlimited delegation or grant/scope stitching.

Admin-transfer body contains envelope and two distinct targets with the existing target fields; action is one of the approved member action constants, not arbitrary text. Exact nullable/forbidden fields follow the same action table; server supplies outer transfer action, requestId and compatible closed reasons. Sorted lock set, complete roster, last-admin post-state and maximum two targets remain inside 8C. Never decompose an atomic transfer into two saves or allow nested transfers.

Invite body does not accept target UserId, role or approval source contents: source `admissionId` resolves an independently approved existing User/Tenant. Subject consent body accepts the source locator and expected member revision/authVersion (null/null for FIRST only); the HTTP handle determines the subject. `onboardingRef` maps internally to the existing `controlApprovalRef`; it is not caller-provided operator authority. Reject both-source/neither-source, foreign source, wrong purpose and stale versions.

Command response whitelist is the existing `{commandId,status,effects}`; each effect has only `{userId,membershipId,revision,authorizationVersion,status}`. Null shape stays exact. Do not add approval material, consent proof, reauthentication capability, effective permissions, grant history or internal receipt. A returned status/version is not an authorization permit for a later request.

Lost response: no transparent HTTP/driver retry and no blanket same-key replay. Refetch authorized current state and explicitly resubmit with the current expected versions and exact approved intent only when existing 8C confirmation semantics permit. Changed key/intent, stale version, expired source, changed authority or revoked Session still reject. Login/password do not gain durable secret-bearing idempotency records.

## 5. Minimal safe read composition — D8-S03

These queries close actual wiring gaps, not new business capability. They must be server-only implementation behind protocol-neutral safe query Ports/use cases. Routes never issue SQL or access security records directly. Query inputs are locators; no secret or raw handle is serialized in an ordinary DTO. Existing 8B/C public methods and closed command outcomes remain unchanged.

**Own password state.** Add `passwordState(handle) → {credentialRevision}` beside own use cases, backed by the existing private authentication registry and auth-role transaction. Reuse the existing validated locked authentication path, including User anchor → Session-user advisory barrier → Credential slot/aggregate validation → Session and final clock checks; do not copy a weaker slot-only authentication query. Only project slot repository_revision after checks. The existing security path may read verifier/history internally for aggregate integrity; that material stays inside Infrastructure and is never projected. No hash, epoch, CredentialId, SessionId, token digest or other User lookup is returned. Missing/corrupt slot or Session fails closed. Revision is a compare-and-swap token, not a Credential verifier. The later password command still uses its own current-password proof and independent locked CAS. Do not silently select a fresh revision inside POST to bypass the caller's expected version.

**Manager point query.** Add a closed query for one path Tenant/Membership and supplied actorMembershipId. First, on that tenant client with scoped SELECT and before any User lock, verify actor Membership's immutable user_id matches the private authenticated User; a spoofed actor cannot cause later Session checks to lock an extra out-of-order User. This is an identity binding check, not authority. Then use existing `authorizationGlobals(GUARD_MEMBERSHIP)` Tenant serialization → complete sorted User locks, existing private `MembershipSecurity.assertSession`, scoped member loading, fresh catalog and `MEMBERSHIP_READ` Policy. The actor must still be the authenticated User's ACTIVE Membership. Recheck Session/time and fresh read authorization before returning; no generic SQL client or locked callback is exposed. No business mutation or audit is performed by this query. Do not call an independent AuthorizationState transaction and then trust its detached result as a Session-protected query/write proof.

Projection is exactly `{tenantId,membershipId,userId,status,revision,authorizationVersion,actorRevision,actorAuthorizationVersion,tenantRevision,grants,nextGrantCursor,consent}`. Grant element is exactly `{grantId,roleCode,scope,validUntil}`. `afterGrantId` is an optional canonical RoleGrantId locator; use ascending grant ID order, 16/page plus one bounded lookahead, and return the last emitted ID only if another effective grant exists. Each page freshly authenticates/authorizes; pages are not a pinned permission snapshot or a complete roster. Never return revoked/expired/future history or use a page as a complete authorization roster. `consentPurpose`, when supplied, is exactly ACTIVATE, REACTIVATE or REJOIN; absent means `consent:null` with no consent discovery query. Consent projection is exactly `{consentId,admissionId,purpose,expectedMemberRevision,expectedAuthorizationVersion,expiresAt}` for at most one still-current result of that purpose, otherwise a trusted ambiguity/conflict refusal. FIRST consent is excluded from this manager query. No command history, operator manifests, approval details or credential/session data. Filter by this Tenant/target and actual current versions/time before projection, not fetch-all-and-filter outside RLS. Existing aggregate/roster bounds remain enforced; pagination must not hide an over-bound aggregate by truncating validation.

Consent metadata is needed because `MembershipCommandOutcome` deliberately does not carry consentId. A manager obtains it only with current MEMBERSHIP_READ; activation still validates/consumes it in 8C. "Unconsumed" is derived from the existing approval/command provenance, not an invented mutable column on the append-only consent table: reject a consent already referenced by a consuming approval, verify current target User/member versions, time, purpose and admission chain. Missing consent is represented as null on an otherwise visible member, not permission to bypass consent. There is no global admission/consent browser or management search in this unit. Multiple effective grants or old consent history cannot be combined into an approval proof.

Own spaces reuse the existing helper's maximum 50 without passing 51 for lookahead: set `nextCursor` to the last emitted MembershipId when result length equals requested limit, otherwise null. A full final page may therefore lead to an empty subsequent page; this is a navigation hint, not a completeness/permission proof. Do not add a second global scan, stable cross-request snapshot or capability to make this cursor exact.

**Subject consent context.** Add `consentContext(handle,tenantId,admissionId|onboardingRef)` via existing `identity_member_consent_context`/private bridge in the Tenant transaction. For FIRST, mirror `MemberAdmissions.consent`'s approved `controlManifest` lookup and User/Tenant/purpose/environment binding; pass its resolved approval_id, not the public approval_ref, into the SQL helper. A missing approved evidence store closes this FIRST path, not a default manifest or new control-table SELECT grant. The helper already serializes Tenant → subject User → Session; final Session/time checks use the same client after that order. It binds source to the authenticated User and returns only `{membershipId,expectedMemberRevision,expectedAuthorizationVersion,purpose,expiresAt}` after checks. It works for a PENDING subject or FIRST subject without pretending they have an ACTIVE administrative Membership. Foreign/absent/unusable locators are non-disclosing refusals. It does not expose or issue a consentId, create an admission, grant, or renew an expired invitation. Source locators are delivered by the approved operator/manager channel; no public User probe or new email/SMS producer.

Runtime ACL remains exact: auth uses already permitted slot/Session columns; tenant uses existing scoped member/consent SELECT and approved helpers, not direct Credential/Session secret SELECT. For every proposed SELECT/row lock, test the actual role, column privileges and RLS. If current grants cannot support this exact projection safely, STOP; do not add a convenience definer/GRANT under D8 approval.

## 6. Browser protocol, Session and cookie

Unsafe routes require exact single configured Origin, JSON media type and `X-Zhiban-Request: identity-v1`. Authenticated unsafe routes additionally require `X-Zhiban-CSRF` from `application.csrfToken` and `application.assertUnsafe(handle,origin,proof)`; proof is Session-bound, not identity/role proof. Missing/null/foreign scheme/host/port/subdomain Origin rejects. No trusting Host/Forwarded/X-Forwarded-Host, Referer fallback, wildcard origin, frontend secret, double-submit substitute, or SameSite-only defense. [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Safe JSON reads require the custom header, and any present Origin must match; reject cross-site Fetch Metadata when present. Missing Origin on a same-origin read is permitted only by this read protocol, never on unsafe requests. `Sec-Fetch-Site` is defense in depth, not a replacement for Origin/CSRF. No cross-origin credentialed CORS or JSONP. Fetch Metadata/header authenticity does not confer a user identity.

Extract only one exact `__Host-zhiban_session` cookie. Reject duplicate named cookies or malformed/oversize cookie/header encodings; do not accept another cookie name, URL token, localStorage or Authorization header as credential. Never forward request cookies/CSRF to OpenMAIC. Malformed syntax rejects before storage/KDF; a valid-format but absent/revoked/expired/epoch-stale cookie maps to unauthenticated only when the private trusted classification proves that fact, not on database failure.

`security.authenticate` may return null for unknown token and may throw CONFLICT for a known invalid old Session. The adapter must cover both paths; it cannot assume every rejected Session is null. Storage, mapper, corruption and unknown error instead return 503, not anonymous success. Authentication/touch and a CSRF check still do not replace same-client mutation Session/proof rechecks in 8B/C.

Login with no cookie follows anonymous login-CSRF protocol. With a live existing cookie, explicit account switch requires that Session's CSRF proof and safe logout **before** calling fresh login with no oldCookie argument. Use the current existing logout/login use cases, not new DB semantics. Revocation and issuance are separate transactions: if the new password fails, the old Session remains revoked and response clears its cookie; no claim of atomic cross-account switch. A stale cookie returns normalized 401 + clear and requires an explicit fresh anonymous attempt. Never create a new bearer first and then pass a failing oldCookie to `security.login`: current implementation does issuance before its optional old-cookie check, which could leave an unreturned Session when that check rejects. Do not auto-replay this request.

Logout with a valid Session requires its CSRF proof and performs existing atomic revoke/audit, then 204 + clear. With missing or trusted invalid old cookie, exact anonymous Origin/JSON/custom-header protocol may return the same 204 + clear without a revoke; it cannot revoke by client SessionId. A genuine storage/corruption failure is never converted to idempotent success. Logout-all requires current password; password change requires current password, approved screening and caller CAS. Successful logout-all/password change clears cookie only after commit. On uncertain commit return sanitized failure; caller does not automatically resubmit secrets.

Cookie reuse is exact `sessionCookiePolicy(true)`: HttpOnly, Secure, SameSite=Lax, Path=/, no Domain, `__Host-zhiban_session`. Only the cookie helper calls `bearerForCookie`; raw token's sole HTTP output is Set-Cookie after successful commit/live validation. Max-Age/Expires are bounded by remaining absolute expiry; DB idle/absolute enforcement remains authoritative, no cookie refresh extends absolute time. Clear with same attributes plus Max-Age=0 and past Expires. Never disable Secure from client/proxy headers or select a production dev cookie. Test HTTP handler units may inspect flags; browser transport acceptance uses HTTPS.

Defaults stay absolute 8h/idle 30m, configurable only through approved existing SessionPolicy. CSRF policy/root is single process-lifetime, not per route/request. Restart invalidates old proof, not necessarily the still-valid Session: authenticated client explicitly refetches `/csrf`. Revoke/rotation uses a different SessionId, so old proof does not authorize the new Session. No public rotation route is introduced; existing rotation remains a future explicitly wired policy, and fresh login is not presented as automatic periodic rotation.

## 7. Bounded parser, response and caching rules

Existing approved limits remain: login 8 KiB, own-password 16 KiB, all other unsafe Identity bodies 32 KiB, request headers 8 KiB total, at most 2 transfer targets and 16 grant proposals/preserve IDs. Limits are UTF-8 wire bytes, not just string.length or Content-Length. `logout-all` uses the 32 KiB outer bound plus existing password byte limit. Request target/query bound 2 KiB; JSON max depth 8, no duplicate object keys or prototype keys, no unexpected fields, sparse arrays, nonfinite values or coercion. Use a bounded duplicate-key-aware decoding step plus existing validators, not an entire-file regex or JSON snapshot. JSON request object descriptors reaching Application are plain validated data.

Check declared length before read; stream/count decoded bytes with an enforced limit and cancel on overflow; lying/missing/chunked length does not bypass. Reject compressed bodies, multipart, form/text/plain, non-UTF-8/invalid UTF-8, duplicate security headers, duplicated/unknown query parameters, encoded path separators, unexpected body on GET, and locator/path/body mismatch. Accept only `application/json` with optional charset=utf-8. 413/400/415/431 are secret-free protocol refusals before KDF/business work. Proxy must enforce upstream wire/header/time bounds too; middleware/body cloning must not allocate an unbounded buffer before the handler. Application limits do not prove proxy or framework transport limits.

Every success/error/method/disabled response made by Identity has Cache-Control `no-store`, Content-Type appropriate to its shape, X-Content-Type-Options `nosniff`, Referrer-Policy `no-referrer`; identity JSON has Cross-Origin-Resource-Policy `same-origin`. No ETag, Last-Modified, shared/CDN cache, revalidate, React cache/use cache or cross-request deduplication of Session/authorization. Do not forward arbitrary incoming headers via NextResponse.next. 204 has no Content-Type body requirement. Response whitelist tests cover both success and exceptions; no debug stack in development HTTP responses either.

Admission → KDF → short critical transaction order stays existing. Do not hold member/Tenant locks during Argon2, queue plaintext, lower provider parameters, or add transparent DB retry. Request cancellation never rolls back an already committed command; bounded cleanup releases stream, clients and private request context, without replaying after unknown commit. Root-level finite concurrent request admission must refuse before reading secret bodies when saturated, with no unbounded waiting queue; exact capacity/timeouts require the approved deployment manifest and load test, not arbitrary production defaults.

## 8. Non-enumerating error mapping — D8-S04

Do not map every CONFLICT to 409, every INTEGRITY_FAILURE to 400/403, or every UNAVAILABLE to 429. Actual frozen codes intentionally do not distinguish all public cases. Keep IdentityPortError's six-code contract and existing sanitizers, private proofs and command outcome shapes. Introduce an optional, private **request-local closed refusal observation** at trusted composition branches, not a client-supplied exception field or Domain/HTTP dependency.

Observation tags are only `SESSION_REJECTED`, `REAUTH_REJECTED`, `TARGET_HIDDEN`, `POLICY_DENIED`, `REQUEST_STALE`, `ADMISSION_DENIED`, `PASSWORD_POLICY_REJECTED`. The capability is issued by the adapter context and accessed by trusted composition wiring; no payload, locator, IP, request body, password, digest, caller error message/cause or code getter. Async-local isolation and an inner operation scope avoid concurrent/nested stale tags. It records only an explicit branch that immediately refuses; successful or subsequent work cannot inherit a refusal. Session/Origin/proof checks are separate operation scopes so a caught login-issuance failure cannot leave a tag that reclassifies a later audit/storage failure. Only the refusal terminating that operation can determine its public result. Observer failures fail closed, never turn a command result into ALLOW. No change to policy/state/CAS/order/Port results when no observer is installed; no refusal observer runs after a successful COMMIT or turns success into an asserted rollback.

Required observation sites are explicit legitimate rejections in authentication/member security, approved source visibility/policy/version branches, admission `allowed === false`, and screening `true` (actual compromised verdict). Exceptions/nonboolean screening remain system failure. A KDF cap exhaustion may produce the admission tag only at the trusted capacity branch, not by interpreting a provider's UNAVAILABLE. Use a private server collaborator with no Next types; do not rewrite all generic repository guards to guess business reasons. Persisted corruption, invalid private capabilities and malformed database rows do not get business-refusal tags. All exceptions are caught before framework logging and converted to fresh closed responses without original error objects.

| Verified public condition | HTTP / error code |
| --- | --- |
| Bounded login unknown/missing/wrong/disabled or account-specific issuance refusal | 401 `UNAUTHENTICATED`, same body/headers apart from independent requestId |
| Absent or trusted invalid Session for a protected route | 401 `UNAUTHENTICATED`; clear invalid cookie, no resource detail |
| Invalid Origin/CSRF for request protocol | 403 `REQUEST_FORBIDDEN`, no resource probe |
| Absent/foreign/unreadable Tenant/member/source | 404 `NOT_FOUND`, before any stale/key detail |
| Readable resource but currently disallowed action/delegation or failed step-up | 403 `FORBIDDEN`, no grant/history or password detail |
| Stale version or changed idempotency intent, after current identity/visibility | 409 `CONFLICT`, no current hidden version/policy leak |
| Valid shape but rejected new-password policy | 400 `INVALID_REQUEST`, no corpus/secret/policy internals |
| Verified budget/capacity denial | 429 `TOO_MANY_REQUESTS`; fixed approved coarse Retry-After, no remaining per-account counters |
| Known transport syntax/type/size/media/header failure | 400/413/415/431 `INVALID_REQUEST`, no values/errors reflected |
| Storage/schema/catalog/config/corpus/proxy health failure or unclassified error | 503 `SERVICE_UNAVAILABLE`, never exception forwarding or success |

Fresh visibility is checked before the command; same-client final Policy remains authoritative. Revocation during a write cannot reuse the earlier visibility result to disclose new conflict/resource details. When a trusted final classification is unavailable, choose the conservative non-disclosing failure, not an invented 403/409. Same code object injected by a provider, fake cause or proxy cannot fabricate observation authority. Screening exceptions/nonboolean, malformed mapper rows and driver outages must specifically reach 503; rejection remains fail closed.

Important existing-helper limitation: several frozen definers intentionally collapse all internal exceptions into one rejection. Their response cannot honestly prove "missing resource" versus hidden internal failure. Safe queries may establish a business refusal through permitted scoped reads and trusted branches, but must not invent a cause from the helper's SQLSTATE/message. When the FIRST/helper-only path cannot establish one, return generic 503 with no source detail, not claimed 404 or success. Guaranteed precise 404 for every such hidden case would need a separately approved helper contract change; it is not part of this migration-free proposal. Test this conservative fallback explicitly. Ordinary verifiably absent/foreign/unreadable locators still use 404.

Login's existing issuance catch normalizes per-locator provider/record failure. Keep it. Systemic health/root/admission failures are handled uniformly before parsing a User locator and yield 503; don't add a special known-user error. Login audit/storage failure after attempted verification remains generic system failure; no account-specific status. Overall constant-time is not claimed. Unknown/wrong/disabled equal-response tests and real dummy-KDF tests are separate from timing/throughput measurement.

## 9. Explicit configuration and deployment acceptance — D8-S05

Public Identity feature defaults CLOSED. An immutable approved server-only manifest is supplied to a loader; missing/invalid config gives sanitized unavailable responses without body/KDF/database mutation. A disabled unknown route remains 404; known configured Identity routes may uniformly return 503. Nothing in NEXT_PUBLIC variables, cookie/host headers, browser settings or test fixtures enables it. HTTP root is a single cached initialization Promise/root per Node process, shared across route modules; no per-request pools/CSRF policy/dummy initialization. Failure closes entrypoints, no concurrent init storm or permissive fallback. Approved restart is required for manifest/key change. Test factories are explicitly injected and never the default production module.

The singleton must survive actual Next route-module bundling: one process-private factory/facade owns the root, authenticated/verifier/bearer registries, cookie serialization and CSRF policy. Routes call that facade rather than exchange private branded handles with separately bundled module copies. No raw bearer or private handle goes into an Application response to solve bundling. The Next multi-route smoke test must prove login → me → csrf → unsafe command across different route modules uses the same registry/policy and no second root initialization.

| Required deployment fact | Validation / refusal |
| --- | --- |
| Exact HTTPS origin/environment/approval references | Exact URL origin, no path/credentials/alias origin or inferred host; origin mismatch rejects |
| THREE runtime pools, same approved DB endpoint/database | Existing role/property/root checks plus approved connection identity; same database name alone is not proof of same server. No owner/migrator pool, SET ROLE or startup DDL |
| RoleCatalog identity-v1 and real UUIDv7 role IDs | Approved persisted catalog content matches manifest; no test IDs or role privilege defaults |
| Approved local compromised-password corpus | Real local values, approvalRef and exact JSON content digest expected by root; no test synthetic policy or network transmission; missing/mismatch closes all entrypoints |
| Four persisted admission policies and 32-byte secret HMAC key | Existing policy digests match independently approved records; windows/limits/max buckets backed by load tests and bounded prune responsibility |
| SessionPolicy, finite pool/request/time limits | Approved 8h/30m defaults or explicit security-policy values; KDF cap 2 and Argon2id m=32768/t=3/p=1 unchanged; bounded queue-free request capacity |
| Membership composition policy | Approved environment/capacity/source TTL for member routes; absence closes member routes, does not fabricate admissions |
| Trusted proxy network and canonical client address | Verified fixed single proxy overwrites one agreed `X-Zhiban-Client-IP`, removes inbound alternatives, app reachable only through it; exactly one valid IP becomes `observedTransport` |
| Logging/telemetry/backup controls | Body/cookie/CSRF/Set-Cookie/SQL params/crypto errors excluded, safe sink proven; encrypted/restricted backup/restore and bounded data maintenance separately accepted |
| Operator evidence | HTTP facade projects only own/member/query capabilities from the private root, never operator/control objects. FIRST subject consent may use the same approved read-only manifest lookup privately; source creation/import/provision/FIRST consumption retain separate approved operator tooling. Null store is not an approval substitute |

Next Request does not provide an authenticated peer IP simply by reading X-Forwarded-For. Therefore public mode requires the approved fixed proxy/private backend topology above and independent network verification. Never accept an arbitrary XFF chain, choose first/last untrusted header, trust a client CIDR assertion, or call a header a verified peer. Missing/invalid canonical address uniformly closes requests; direct backend access must be denied externally and tested. Direct-network or multi-proxy deployment requires separate precise adapter approval, not a runtime fallback.

First HTTP acceptance is `SINGLE_PROCESS_HTTPS`: one Node worker/process/root behind the approved proxy, no serverless/multi-worker/replica claim. Existing PG admission storage is shared and atomic, but process CSRF keys and KDF cap are not a global cluster contract. Multi-instance CSRF/key/routing, fleet admission/load and online config rotation require a later design. Production may remain disabled while BUILD/CI is accepted against explicit isolated test configuration.

No real passwords, DSNs, HMAC values, raw corpus or operator evidence in docs, fixtures, manifests committed to Git, public health, or CI output. Add only a nonsecret manifest interface/validation and secret-store references; actual provisioned values and responsible approver are operational artifacts, not guessed developer defaults. Explicit migration CLI remains separate; root validates capability existence but cannot prove old migration ledger checksum under runtime ACL, so maintenance preflight supplies that evidence without granting ledger access.

## 10. Native OpenMAIC middleware coexistence — D8-S06

Actual middleware applies ACCESS_CODE/openmaic_access to every `/api/` except access-code and health. A thin Identity login would otherwise require unrelated OpenMAIC access-code authentication. The only approved change is an exact segment exception for pathname `/api/zhiban/identity` or prefix `/api/zhiban/identity/`, before the access-code block. It calls NextResponse.next to let the mandatory Identity Node gate decide. No broad `/api/zhiban`/`/api` wildcard, substring, encoded-separator trick, trusted-cookie privilege, or alternate route bypass. Workbench feature gating and all native endpoint checks remain unchanged.

The exception is routing isolation, not authorization proof; no unguarded Identity handler, secret response or production feature default is acceptable. Test with ACCESS_CODE on/off: Identity protocol remains independently enforced; neighboring/native routes retain their old behavior. Unknown Identity endpoints still 404 and protected paths still require the Session/Origin/CSRF/current use-case guards. Request/response from native access-code never establishes Zhiban identity.

This does **not** certify native OpenMAIC routes/asset/workers as tenant-safe or expose them through the future bridge. Public deployment must satisfy the separate network/bridge entrypoint gate; Identity API CI acceptance alone cannot authorize production cutover or native teaching API access.

## 11. Audit and operational records — D8-S07

Keep existing closed IdentityAuditEvent vocabulary, payloads and same-client audit/mutation composition. Routes never reinsert a business event after commit or call a generic arbitrary-JSON audit endpoint. Existing AUTHENTICATION_REJECTED and SESSION_REVOKED behavior remains; 8C approvals/command effects and audits are still atomic. No new SQL audit table/ACL/migration is implied by HTTP wiring.

Introduce bounded operational request records, distinct from immutable domain audit: only server requestId, finite route template/action, finite status/disposition, duration bucket and approved aggregate counters. Do not log raw URL/query/body/header/IP/identifier, Cookie/Set-Cookie/CSRF, password/newPassword, bearer/digest/verifier, principal history, raw error/cause/SQL params or JSON.stringify(request/root). No free-form error message or uncontrolled label cardinality. If a deployment requires durable authorization-decision audit, its event shape/storage/retention/failure policy needs separate approval; this unit must not pretend a console access record is that audit or open a new union.

Operational logging is bounded, best-effort, sanitized and cannot convert a committed business mutation into a retryable reported rollback. Durable existing business audit remains mandatory and transactional. Test injected hostile error getters/causes/custom codes, observer/telemetry failures and framework error capture. Approved production telemetry disabling/redaction is a deployment gate, not inferred from passing a mocked logger.

## 12. Implementable BUILD order

1. Confirm exact approved checkpoint HEAD, CLEAN worktree, old migration checksums and no conflicting sequence. Re-read D8-S01–S08 and actual 8B/C signatures; produce scope inventory before writes.
2. Implement strict transport/parser/header/cookie/result/error helpers and request-local observation contract with targeted adversarial tests; no routes enabled yet.
3. Implement the three minimal safe query compositions, with fake/contract/unit SQL order/columns tests and actual-role PG16 tests. Prove private handles, same-client checks, RLS/visibility and projection; no schema workaround.
4. Wire approved configuration loader/process singleton, readiness and trusted-proxy adapter. Production remains closed without accepted manifest; test config injection is explicit and isolated.
5. Wire own routes and account-switch/logout flows, then fixed member routes. Route helpers whitelist every request/response; public operator/recovery/service routes are absent. Preserve reauthentication outside locks and 8C same-client final checks.
6. Add the exact middleware exception and integration coverage for ACCESS_CODE and neighboring paths. No other native route changes.
7. Execute targeted HTTP/unit tests first and fix ordinary P1/P2. Add real Node HTTP and PG16-backed endpoint tests, then full existing Identity regression, lint/typecheck/diff and High security review. Do not auto-retry mutations, lower Argon2 or skip errors.
8. Only after BUILD results and P0/P1=0: separate exact checkpoint, independent remote HEAD/message/parent verification, new workflow_dispatch CI signoff, and later HTTP closeout. BUILD authorization by itself never includes these external writes.

## 13. Test and evidence contract — D8-S08

Proposed paths: `tests/zhiban/identity/http/**`, `tests/zhiban/identity/postgres/pg16-identity-http.test.ts`; server-only safe-query tests colocated with Identity use-case tests. Real HTTP harness starts a bounded local Node listener and sends actual requests to the same adapter functions used by Route Handlers, uses independent cookie jars, closes server/pools, and inspects actual status/body/headers. A helper-only listener does not prove Next middleware/route discovery: require a separate actual Next routing smoke test with config-injected approved test root, or an executable build/router integration proving the installed Next exports, middleware and entrypoint coverage. No production fixture root import. HTTPS browser/proxy behavior is its own acceptance test, not inferred from fetch's manual Cookie header.

| Test IDs | Required proof |
| --- | --- |
| D8-H01–04 | All allowlisted handlers use mandatory gate; unknown/method/HEAD/OPTIONS no mutation; native ACCESS_CODE coexistence; no public control/recovery/Server Action/worker bypass |
| D8-H05–08 | Streaming body/header/query limits, duplicate keys/cookies/security headers, malformed UTF-8/media/path/body tampering; all rejected before KDF/business DB work |
| D8-H09–12 | Anonymous login exact Origin/JSON/header, missing/null/subdomain/scheme/port refusal, no CORS credential allowance, custom header cannot confer identity |
| D8-H13–16 | Live Session CSRF, wrong/missing/foreign proof, stale/rotated/restarted proof, safe-read protocol and Session auth/touch behavior |
| D8-H17–20 | Exact Set-Cookie/clear attributes and absolute expiry bound; bearer only Set-Cookie; failure no new bearer; account switch revoke-before-issue and fresh-anonymous stale-cookie retry |
| D8-H21–24 | Unified login unknown/missing/wrong/disabled; real dummy KDF; no corruption/provider account oracle; storage/backend failure not anonymous success |
| D8-H25–28 | Own revision query private/session/epoch/time binding; POST stale CAS; screening true vs nonboolean/throw; change epoch invalidates prior cookie and success clears it |
| D8-H29–32 | Own-space only four fields, bounded cursor/empty result, foreign/cross-tenant denial, no Session tenant/role snapshot or navigation-as-authorization |
| D8-H33–36 | Manager point projection and consent context, foreign/nonactive/PENDING/FIRST boundaries, current consent reference only, no history/operator proof/secret columns |
| D8-H37–40 | Fixed member actions, versioned DTOs and body/path/batch tamper; no SYSTEM_ADMIN/fake relationship/permission-scope stitching/ceiling bypass |
| D8-H41–44 | HTTP verification followed by grant/Session/credential/User revoke: real command fails or safely serializes; restore cannot revive; last-admin/transfer policy preserved |
| D8-H45–48 | Idempotency/lost-response confirmation only under current authority/versions; changed intent/stale-before-no-op; audit/ledger/state all roll back on injected failure; no auto-retry |
| D8-H49–52 | Concurrent request-local error tags isolated; budget 429 vs outage 503; reauth/policy/visibility/stale mapping; hostile errors cannot forge tags or leak causes |
| D8-H53–56 | No-store/response whitelist/no redirects/secrets in logs/errors/APM; bounded telemetry failure; singleton config/proxy/corpus/catalog/pools gate and missing config fail closed |

These are coverage obligations, not a claim that 56 tests already exist or that every ID equals exactly one assertion. BUILD reports actual test counts and a mapping; don't inflate counts or use regex snapshots/mock call counts as real behavior proof.

New real PG16 HTTP suite must test actual runtime roles and guards through the adapter: issue/read/password/logout/all, own revision visibility, spaces, manager/subject read projection including FIRST, valid member mutation + source consent, exact-public-error handling, cross-Tenant body/path and foreign sources, current revisions, HTTP-authenticate-to-write revoke barriers, credential/User disable/restore races, last-admin concurrent mutation, idempotency and audit fault rollback, missing proxy/budget/backend failure, and cleanup. Use independent connections and acknowledged locks/barriers, not sleep-only race. No skipped PUBLIC/column/function denial and no new runtime grants. Native Argon2 uses existing production parameters and real provider; no deterministic hash snapshot/secret diagnostic object.

Existing workflow keeps all 11 suites / **256 real PG16 tests per run**, executed in both full runs, then appends the new suite to both. Actual count becomes **256 + new real HTTP/PG cases per run**; report exact per-suite totals from logs, not guessed numbers. Retain every existing non-PG command and **1189 existing Identity tests**, add the HTTP/query tests and integration step explicitly; test count changes are explained by actual inventory, never a green job alone. CI must prove frozen install, PostgreSQL16.x, Linux/Node22/native Argon2, root lint (0 errors, existing warnings allowed), and root typecheck with only command-scoped 8 GiB heap if needed. No second PG16 workflow.

Local execution during BUILD: targeted HTTP/query/unit tests → existing Identity regression serially → migration/static (inventory 0001–0009 unchanged) → typecheck → lint → git diff --check. If local PG16 remains unavailable, no install or PG18 substitution; REAL_PG16 PENDING_CHECKPOINT. Checkpoint/remote verification/CI dispatch require separate authorization. True SQL/assertion/production/security failures do not automatically rerun; only documented infrastructure transient permits at most one authorized rerun.

## 14. Threat review and release gates

| Threat | Required mitigation / gate |
| --- | --- |
| Login CSRF/account switching/session fixation | Exact anonymous protocol; live-cookie proof; revoke-before-issue; server SessionId; bearer never caller-controlled |
| Stale Session proof after initial HTTP allow | Existing same-client current User/epoch/Session/proof checks at entry/final commit, not handle or CSRF as long-lived permit |
| Metadata as global user/source oracle | Own password only; current manager point/read authorization; subject helper binding; 404 before versions; no global list |
| Session/Tenant scope confused with permission | Authentication only supplies User; fixed scoped use case plus same effective grant/scope/ceiling/last-admin checks |
| Budget/storage errors misclassified; screening fail-open | Trusted private immediate refusal observations, no code/cause heuristics; system exceptions503; exact false-only screening and global health gate |
| Proxy spoofing or direct app access | Approved fixed proxy overwrites address and blocks direct backend; no header-as-peer assumption; public mode closed until verified |
| Shared cache/APM/body/log leakage | Mandatory no-store/projected response/safe telemetry and independent proxy/APM acceptance; Set-Cookie only allowed raw bearer output |
| Config/fixtures/owner role fallback | Explicit immutable approved manifest; process-lifetime root; real catalog/corpus/budgets/pools; no startup DDL or unapproved defaults |
| Native middleware or alternate entrypoints bypass | Exact namespace exception only; exhaustive route/method/ServerAction/worker inventory; no teaching bridge claim |
| Uncertain commit/replayed privileged write | No automatic retry; explicit fresh state/authority/CAS and existing confirmation; same-client source/audit/ledger atomicity |

BUILD complete and READY_FOR_8D_CI_CHECKPOINT require targeted/complete regression, typecheck, lint0, diff PASS, no old migration/role/Domain semantic changes, P0=0/P1=0, and all D8 coverage mapped. Real HTTP/PG16 evidence may be pending only when local infrastructure is genuinely unavailable; never claim PHASE_1B8D COMPLETE before exact-candidate CI and closeout.

Production PUBLIC_IDENTITY_OPEN separately requires accepted exact proxy/network/origin, real corpus/catalog/operator sources, approved rate/capacity/timeouts, telemetry/backup/restore/maintenance, HTTPS cookie/CSRF tests, and a documented approved recovery alternative while 8E stays closed. Code/CI acceptance alone is not production acceptance. Remaining operational facts are named release prerequisites, not fabricated config or an unbounded BUILD blocker.

Out of scope: public recovery/reset, MFA, OAuth/OIDC, JWT, global admin web API, identifier expansion, portals, Course/Class/Enrollment loaders, OpenMAIC Identity Bridge/native route security redesign, V1 data migration, multi-instance CSRF deployment, production cutover. No application decision audit schema or ServiceActor capability is silently added.

## 15. Review, human approval and next task

Review date: 2026-10-03. Human authorization: **“审阅并批准 D8-S01–S08”**. Review method: repository contract/signature/DDL/lock-order inspection and documentation consistency checks; no production execution or new test result is claimed. All eight contracts PASS and are approved as clarified in this document.

| Resolved design-review finding | Closure |
| --- | --- |
| Framework automatic HEAD/OPTIONS/405 and unknown-path response policy left implicit | Mandatory explicit method refusals and denial-only namespace fallback; actual Next/proxy coverage required |
| Restricted revision query wording could encourage bypassing aggregate/advisory validation | Reuse full existing locked authentication path; verifier/history remain private Infrastructure inputs only |
| Public replace shape accidentally narrowed frozen 0–16 collections to 1–16 | Explicit empty collection support restored, unchanged permission/consent/CAS/last-admin rules; ROLE_GRANT exactly one |
| Member projection/cursors/consent purpose not fully closed | Exact DTO, finite purpose enum, grant page/lookahead and own-space cursor behavior specified; no hidden roster truncation |
| Actor binding and private module-registry lifetime could be mistaken for detached/global proof | Immutable actor ownership check before User locks; one process-private facade/registry with actual cross-route smoke tests |
| Nested caught refusal could contaminate later storage error or post-commit reporting | Operation-local terminal refusal observations only, no inherited tag after catch/success and no post-COMMIT observer |

No frozen business contract conflict or new schema/ACL capability was required. Conservative 503 for unclassifiable helper failures is explicit, not falsely labeled resource absence, and cannot authorize any mutation. Missing operational configuration, actual Next/HTTP/PG16 BUILD evidence, backup and production network acceptance remain separate pending gates, not completed tests or design defects.

DESIGN_SCOPE: HTTP_ADAPTERS_AND_EXACT_SERVER_WIRING

REPOSITORY_AUDIT: COMPLETE

DESIGN: HUMAN_APPROVED_AND_FROZEN

APPROVAL_ITEMS: D8-S01–S08

APPROVAL_STATUS: ALL_EIGHT_HUMAN_APPROVED

REVIEW_VERDICT: PASS

P0: 0

P1: 0

P2: 0

FROZEN_CONTRACT_CONFLICT: NO

SCHEMA_OR_ACL_CHANGE: NONE_PROPOSED

APPLIED_MIGRATIONS_0001_0009: UNCHANGED

CONTROL_HTTP: CLOSED

PUBLIC_RECOVERY: CLOSED

PRODUCTION_ENTRYPOINTS: CLOSED_UNTIL_DEPLOYMENT_ACCEPTANCE

IMPLEMENTATION: NOT_STARTED

TEST_EXECUTION_THIS_UNIT: NONE_DOC_ONLY

COMMIT: NO

PUSH: NO

CI_DISPATCH: NO

READY_FOR_1B8D_DESIGN_REVIEW: COMPLETED

READY_FOR_1B8D_DESIGN_CHECKPOINT: YES

READY_FOR_1B8D_BUILD: NO_PENDING_DOCUMENT_CHECKPOINT_REMOTE_VERIFICATION_AND_BUILD_AUTHORIZATION

Next task: separately authorize the **one-file 1B-8D approved design documentation checkpoint**, suggested model **GPT-6.1 Sol / Low**. Then independently verify GitHub HEAD/message/parent (**GPT-6.1 Sol / Low**) before separately authorizing 1B-8D BUILD with tests/security self-review (**GPT-6.1 Sol / High**, NO COMMIT/PUSH/CI DISPATCH). Human approval of D8-S01–S08 does not execute or authorize those next tasks automatically.
