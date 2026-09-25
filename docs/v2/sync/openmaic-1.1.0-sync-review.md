# OpenMAIC v1.1.0 controlled sync — Stage B review

Status: **SYNC CANDIDATE / NOT APPROVED FOR V2 MERGE**. This review records a Git merge and static/test evidence, not a deployment, Identity bridge acceptance, or permission to begin 1B-3A.

## Git provenance and scope

| Item | Value |
| --- | --- |
| Old OpenMAIC base | `4d2e2bab82374ed45b95964a1f2ed03362666e1c` |
| New official base / `main` / `origin/main` / `upstream/main` | `21d83ec51b908a4b169ee2be7498a29da213c74d` (`v1.1.0`, `release: v1.1.0 (#1677)`) |
| Upstream range | 42 commits; 301 changed files |
| V2 checkpoint / sync branch starting point | `4b1a725696b6f262b951ca4111ba923ad0272a51` |
| Merge base | `4d2e2bab82374ed45b95964a1f2ed03362666e1c` |
| Merge commit | `45d45f6b3451ee94001abdaa08dc201c0f4decbb` (`git merge main`, `ort`) |
| Conflicts | None; no manual OpenMAIC core customization |

The 1B-1 and 1B-2 commits remain ancestors. All 12 `lib/zhiban/domain/identity` files and all 13 `lib/zhiban/application/identity/ports` files remain present and unchanged relative to the V2 checkpoint; `docs/v2` remains present. The Identity source imports no OpenMAIC internal types, React, Next, Zustand, or PostgreSQL implementation. `refactor/zhiban-v2` was not modified or merged into.

## Six published package contracts

These are published package exports, **not authorization guarantees**. Compatibility below is source/test evidence on this Windows checkout, not a published-tarball or Linux host acceptance test.

| Package | Old → new | Export delta | Source compatibility and architecture impact |
| --- | --- | --- | --- |
| `@openmaic/dsl` | 0.11.2 → 0.11.2 | None | Unchanged contract; Domain still does not consume DSL types. |
| `@openmaic/storage` | 0.31.1 → 0.31.1 | None | `RuntimeStore`, `PgRuntimeStore`, `AssetStore` export paths unchanged. No new tenancy or authorization contract. |
| `@openmaic/generation` | 0.3.10 → 0.3.13 | Add `./browser`; root entry retained | Browser-safe entry increases Model B options without importing Node-only root orchestration. `scene-generator` now rejects unusable interactive script syntax; generated content behavior therefore needs capability-specific review. |
| `@openmaic/importer` | 0.2.5 → 0.3.0 | Root adds `DEFAULT_ZIP_PARSE_LIMITS` and `ZipParseLimits`; existing root entry retained | Source signatures remain usable, but default ZIP size/ratio limits now reject some archives previously accepted. Review large-deck product limits; browser parser output remains untrusted. |
| `@openmaic/renderer` | 0.1.9 → 0.1.11 | Add `./geometry`; previous exports retained | Geometry bounds now include line controls/elbows. Slide preview candidate remains; no complete Classroom host contract was added. |
| `@openmaic/editor` | 0.0.7 → 0.0.9 | Export paths unchanged (`.`, `./core`, `./react`, `./ui`) | Private core helper was replaced by the **public** renderer `./geometry` export. No removed public editor export found. Host must build/pin matching renderer and editor versions; stale local renderer `dist` produced false geometry failures before frozen rebuild. |

Generation compatibility: **NEEDS_REVIEW** for content validation behavior and official Linux/package-host verification; its new validator tests pass. Editor and renderer: **PASS for tested source contracts** after rebuilding packages. Importer: **NEEDS_REVIEW** for the new default ZIP rejection behavior, though its full local suite passes. DSL/storage contracts are **UNCHANGED**. Package Host coverage is **PARTIAL_IMPROVED**, not FULL: U01 supported multi-scene Classroom/Playback host and U02 isolated Interactive host remain unresolved.

## Protected surface and authorization delta

The old-to-new protected-file scan found changes in nine groups: persistence API (1), persistence library (1), `lib/store` (4), agent runtime (3), InteractiveIframeHost (1), generation package (10), editor (5), importer (8), renderer (4): **37 changed files**. `lib/server/access-token*`, `lib/server/stage-access*`, `lib/utils/iframe*`, and the storage package are unchanged. The package counts include tests/config, not 37 independent authorization decisions.

### Persistence and shared owner

`app/api/persistence/[...path]/route.ts` adds request-ID validation/generation, 5xx error logging, and an `x-request-id` response header. Its existing route/method dispatch, browser reachability, and document/asset/runtime authorization decision are not replaced by a new Zhiban extension point. `lib/persistence/server-auth.ts` changes explanatory comments: the public dev token is only consulted for runtime; document/asset owner resolution and capability-by-ID reads remain. No new persistence browser method or path was found. There is **no formal Zhiban authorization contract** to reuse here.

`PERSISTENCE_SHARED_OWNER_ID` is an opt-in, deployment-wide **OpenMAIC owner identifier**. With `ACCESS_CODE` present, `resolveRequestOwnerId` uses an explicit authenticated owner first, then the configured shared owner, then the anonymous-cookie/default path. The setting has startup validation, does not mint an anonymous cookie in shared mode, and does not turn `ACCESS_CODE` into a per-user session. It is **not** `TenantId`, `MembershipId`, `TenantContext`, `RoleGrant`, or a Zhiban principal. Mapping it to tenant isolation would collapse users into one owner and increase cross-user read/write exposure if raw OpenMAIC Web were reachable. Shared-owner collision with the Zhiban tenant model: **NO in the target design; forbidden as an implementation shortcut**. Existing `NETWORK_ISOLATION_REQUIRED` / `DISABLED_TARGET` decisions remain.

### Agent, Interactive, Classroom and playback

Native Agent owner now accepts the shared-owner fallback; the authenticated-owner argument remains a seam, not evidence that Zhiban User/Membership/Session is wired. Anonymous cookie behavior remains when shared owner is unset. Native Agent and tools remain disabled in the V2 target until capability-specific authorization and isolation are verified.

InteractiveIframeHost adds a host-side runtime-error banner and continues matching iframe messages by `event.source`; the sandbox remains `allow-scripts allow-forms allow-popups`. The error store drops unused `clearAll`. A new generation validator parses classic inline script syntax without executing it; it skips module/external scripts and is not an iframe authorization or message-origin protocol. No supported isolated Interactive execution host, resource gateway, or U02 closure was found.

Classroom refactors course-session lifecycle and TTS progress; Playback adds whiteboard-element references. These are internal/native Web changes, not a published multi-scene execution host. U01 remains **open**. `NEXT_PUBLIC_PI_CHAT_ENABLED` now defaults on; existing chat endpoints accept `x-model-routes` for model routing. Those are changed native surfaces to include in capability-specific 0B verification, not permission to expose native Web.

### 1B-0A delta and ADRs

No newly added `app/api` route file was found (**new native route count 0**). Changed authorization-relevant modes include shared-owner resolution and client-supplied chat model routing; the persistence request-ID wrapper changes observability, not authorization. No new standalone direct-browser bypass route is statically confirmed, but raw native routes plus opt-in shared owner still require isolated deployment verification. The 0B checklist must now assert shared owner is unset or confined to an explicitly approved private scenario, and check Pi/chat model-routing exposure. This is a **delta**, not a repeat of the 133-entry audit. Dynamic verification remains required before any capability is opened.

ADR-013 **UNCHANGED**: OpenMAIC remains a PRIVATE CAPABILITY RUNTIME; public surface is Zhiban pages/APIs/authorized byte gateway/restricted launch handle. Native OpenMAIC Web remains `DISABLED_TARGET`. ADR-014 **UNCHANGED** in strategy, with partial package coverage improved. ADR-012 remains **PROPOSED**; sync does not accept it or authorize Bridge implementation.

## Environment, dependency and build delta

`.env.example` adds `PERSISTENCE_SHARED_OWNER_ID`, `TTS_MIN_INTERVAL_MS`, and `TTS_BACKOFF_BUDGET_MS`; it documents Pi-chat's default-on build-time flag and the fail-open behavior when `ACCESS_CODE` is unset. `instrumentation.ts` warns on missing access code and validates shared owner at startup. `next.config.ts` pins the Pi-chat flag in the build. Dockerfile moves workspace package build from install to builder with a scoped heap limit; render-service gains Linux/systemd resource-budget machinery. No secret value was written. `pnpm install --frozen-lockfile` succeeded and rebuilt the packages with the upstream lockfile; `pnpm-lock.yaml` and tracked files remained unchanged.

## Tests and limitations (Windows / Node 24.18.1 / pnpm 10.28.0)

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| Zhiban Identity Domain | PASS | 94/94 |
| Zhiban Identity Contracts | PASS | 20/20 |
| Root lint | PASS | 0 errors; 20 warnings versus old 18, the two new warnings are upstream `components/settings/index.tsx`. |
| Root typecheck | OOM_THEN_PASS | Default Node heap (~2 GB) OOM; process-local 8 GB retry passed, no config change. |
| Generation full package tests | FAIL / Windows-only known path assertion | 198/199 passed. Unchanged `test/assets.test.ts` compares POSIX expected asset paths against Windows `\\` paths. New validator/quiz tests separately 49/49 passed. This is not evidence that generated content is production-safe. |
| Editor / Importer / Renderer package tests | PASS | 598/598, 271/271, 96/96 after frozen package rebuild. |
| Storage | PARTIAL | Full suite stalled on this Windows host and was interrupted; targeted Asset/Runtime/Document browser contracts passed 179/179. Package source/exports unchanged. |
| Root unit baseline | PARTIAL | Full parallel suite produced multiple local import/test timeouts and was stopped. Targeted changed-surface set passed 91/92 with one cold-import timeout; standalone persistence route rerun passed 42/42. No all-root PASS claim. |
| Root production build | PARTIAL | Vendor assertion passed; Next optimized build made no further progress for several minutes on this host and was interrupted. Not a build PASS. |
| Render-service | PARTIAL | Typecheck passed; full Windows test suite 287 passed, 28 failed, 34 skipped (Linux `getuid`, systemd/cgroup, symlink privileges/path semantics). Representative coordinator/resource-client/preview tests passed 49/49. Linux CI still required. |
| E2E | NOT_RUN_ENVIRONMENT | Official-like Phase 0 E2E was Ubuntu/Node 22; current Windows local setup is not that environment. No deployment/server was started for this sync review. |

## Blockers and recommendation

No unresolved merge conflict or demonstrated P0/P1 Identity/source compatibility blocker was found. However **READY_TO_MERGE_SYNC_INTO_V2 = NO** pending official-like Ubuntu/Node 22 validation of generation's full suite, render-service Linux resource tests, root build/unit baseline, representative E2E, and capability-specific 0B deployment isolation. The importer default ZIP limits and changed generated-content validation need explicit product compatibility review. These are review gates; do not alter frozen ADR status, change OpenMAIC core, or begin 1B-3A to resolve them.

The sync branch may be pushed as a **candidate for human review** if the Git scope remains only the upstream merge plus this review document. A pushed sync candidate is not permission to merge it into `refactor/zhiban-v2`.
