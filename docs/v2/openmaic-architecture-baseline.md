# OpenMAIC Architecture Baseline for Zhiban V2

## Baseline

- Snapshot: `4d2e2bab82374ed45b95964a1f2ed03362666e1c`
- Upstream: `THU-MAIC/OpenMAIC` `main`
- Origin: `yhouzxm/OpenMAIC` `main`
- Application: Next.js 16.3.3, React 19, pnpm workspace
- Contract packages: `@openmaic/dsl`, `@openmaic/storage`, `@openmaic/generation`, `@openmaic/importer`, `@openmaic/renderer`, `@openmaic/editor`

This document describes the observed architecture at the pinned snapshot. “Stable” means an exported contract with tests and a package boundary; it does not promise semantic-version compatibility beyond upstream's own guarantees.

## System shape

```text
Next routes / React surfaces
        |
        v
Application orchestration (classroom, generation, workbench, playback)
        |
        +----> Zustand client stores
        +----> server services / agent runtime
        +----> persistence bootstrap
                         |
                         v
          @openmaic/storage contracts and adapters

@openmaic/dsl <---- renderer / editor / importer / generation
     ^
     +---------- persisted Stage, Scene, Action and AssetRef shapes
```

## Module map

| Area | Responsibility | Core entry points | Principal data flow | Stability and V2 treatment |
|---|---|---|---|---|
| Classroom | Creates, loads and presents a Stage plus Scenes; owner/read-only checks; share URL boundary | `app/classroom/[id]/page.tsx`, `components/classroom/ClassroomSurface.tsx`, `app/api/classroom/route.ts`, `lib/server/classroom-storage.ts` | Route id → storage read → stage store hydration → Stage surface | Next routes and server helpers are internal. Expose through `ClassroomPort`; do not import them into Domain. |
| Scene | Typed unit of lesson content (`slide`, `quiz`, `interactive`, `pbl`) and dispatch to a renderer | `lib/types/stage.ts`, `components/stage/scene-renderer.tsx`, `@openmaic/dsl` scene types | Stored Scene → validation/migration → renderer selected by `scene.type` | DSL shape is the strongest contract. App aliases and dispatcher are internal. Translate through `ScenePort`. |
| Stage | Aggregate-like lesson document and top-level edit/playback shell | `@openmaic/dsl/stage`, `lib/store/stage.ts`, `components/stage.tsx` | Stage/Scenes → Zustand → persistence debounce and render mode | DSL structure is reusable; `useStageStore` and Stage React component are internal and upgrade-sensitive. |
| Runtime | Learner-scoped append/read state for quiz, PBL and interactive execution | `lib/runtime/config.ts`, `lib/runtime/store.ts`, `@openmaic/storage/runtime/*` | learner key + stage scope → RuntimeStore → browser/HTTP/Postgres backend | `RuntimeStore` and configuration seam are extension points. Payload validators and app singleton are internal. |
| Persistence | Selects browser or server persistence and exposes HTTP gateway | `lib/persistence/bootstrap.ts`, `lib/persistence/server-provider.ts`, `app/api/persistence/[...path]/route.ts` | Browser calls HTTP → authenticated principal → Document/Runtime/Asset stores → Postgres/object bytes | Store interfaces are adaptable; bootstrap, environment variables, route protocol and schemas are OpenMAIC-owned. |
| Storage | Document, runtime, asset, KV, material and agent-session contracts/backends | `packages/@openmaic/storage/src/index.ts` and subpath exports | Contract call → browser/HTTP/PG implementation → persistence medium | Published interfaces are preferred integration contracts. Concrete PG schema and HTTP handlers remain upstream-owned. |
| Asset | Allocated media references, owner isolation, byte storage, lifecycle and quota | `@openmaic/storage/asset/*`, `lib/persistence/asset-*`, `lib/media/*` | generated/imported bytes → AssetStore → AssetRef in DSL → authorized resolution | Use an `AssetPort`; never depend on asset table layout or private lifecycle jobs. |
| Agent Runtime | Runs tool-using agent sessions, course edits, material and media tools | `app/api/agent/*`, `lib/server/agent-runtime/runner.ts`, `store.ts`, `generation-tools.ts` | request/session → runner → tools → document/runtime/asset stores → streamed response | Large internal subsystem with rapid change. Use `AIServicePort` or a narrow façade; do not import runner internals. |
| AI Provider | Provider configuration, model fetch/probe and AI SDK construction | `lib/ai/providers.ts`, `lib/server/provider-config.ts`, provider API routes | settings/server config → provider resolution → model invocation | Provider catalog/config are internal. V2 owns intent and policy, while `AIServicePort` hides provider-specific types. |
| Interactive HTML / iframe | Sandboxes interactive HTML, injects storage/error/element-observation shims and manages iframe pool/messages | `lib/utils/iframe.ts`, `components/scene-renderers/InteractiveIframeHost.tsx`, `lib/store/widget-iframe.ts`, `lib/store/interactive-iframe-pool.ts` | Scene HTML → patch/sanitize → pooled iframe → typed postMessage/observation → app | Treat postMessage protocol as an adapter surface. Shim source and Zustand pools are internal and must not enter V2 Domain. |
| Generation | Produces outlines, typed scenes, actions and media with prompt/template packages | `app/api/generate/*`, `lib/hooks/use-scene-generator.ts`, `packages/@openmaic/generation` | brief/material → prompt/template → model → validated DSL content → Stage | Package templates/types are reusable with caution. UI hooks, routes and orchestration are internal. Invoke through application use cases. |
| Editor | Edits slide DSL with ProseMirror/table/canvas tooling | `packages/@openmaic/editor`, `components/edit/*`, `components/slide-renderer/Editor/*` | DSL slide → editor commands/state → Scene patch → stage persistence | Published editor exports are an extension point; command internals and app chrome are not. |
| Renderer | Renders DSL elements and snapshots | `packages/@openmaic/renderer`, `components/slide-renderer/*` | DSL slide/elements + asset resolution → React/canvas output | Published renderer components/types are preferred. V2 must not fork chart/text/layout internals. |
| Importer | Parses PPTX and maps presentation constructs into DSL slides/assets | `packages/@openmaic/importer`, `lib/import/use-import-classroom.ts` | uploaded PPTX → parser/serializer → DSL slides + assets → document | Use package entry points or an import adapter; avoid depending on parser model internals. |
| Playback | Derives cursor/state and executes navigation/action timing | `lib/playback/index.ts`, `lib/playback/engine.ts`, `components/edit/PlaybackChromeRoot.tsx` | current Scene + actions → engine state → UI/TTS/widget effects | App-internal subsystem. V2 may request activity execution through `ActivityRuntimePort`, not control engine internals. |
| Media | Generates, commits, resolves and reconciles image/video/audio references | `lib/media/media-orchestrator.ts`, `lib/media/types.ts`, `lib/server/store-generated-asset.ts` | provider request → polled/generated bytes → asset pool → Scene media slot | Adapter-only. V2 should own pedagogical intent, not OpenMAIC provider tasks or ref-count mechanics. |
| Authentication / access code | Protects hosted resources using access codes/tokens and owner principals | `lib/server/access-token*.ts`, `lib/server/stage-access.ts`, `middleware.ts` | request credentials → principal/access decision → scoped route/store operation | This is OpenMAIC resource access, not Zhiban identity/RBAC. Bridge identities at an adapter boundary; never equate the two models. |

## Core data flows

### Classroom load and edit

1. `app/classroom/[id]/page.tsx` passes the URL id into `ClassroomSurface`.
2. Classroom loading resolves the persisted Stage and ordered Scenes.
3. `lib/store/stage.ts` hydrates client state, migrates scene shapes and tracks dirty descriptors.
4. `components/stage.tsx` chooses edit or playback chrome.
5. Incremental Stage/Scene changes flow through document persistence; assets are reconciled separately.

V2 integration point: resolve a V2 Activity to an OpenMAIC document id in the Application layer, then call `ClassroomPort`. V2 must not store React state or Zustand selectors in its aggregates.

### Generation

1. A brief, source material and settings enter an API route or agent tool.
2. `@openmaic/generation` templates and app orchestration invoke a configured model.
3. Results are normalized and validated against `@openmaic/dsl`.
4. Media requests allocate or replace AssetRefs.
5. Stage/Scene documents are persisted and presented by the classroom surface.

V2 integration point: an application use case supplies business intent and receives stable ids/status through `AIServicePort` and `ScenePort`; prompts and provider objects remain outside Domain.

### Interactive execution

1. Interactive Scene content is patched before iframe execution.
2. A bounded iframe pool mounts content and injects error, storage and observation bridges.
3. Widget messages are queued until readiness and scoped by Scene/document token.
4. Learning state is persisted through RuntimeStore, not trusted from arbitrary window messages.

V2 integration point: `InteractiveRuntimePort` converts protocol messages into validated learning evidence. Raw `MessageEvent`, DOM nodes and iframe handles never cross into Domain.

### Persistence

1. Browser mode uses IndexedDB-backed stores.
2. Server mode configures HTTP clients with learner/access headers.
3. The persistence API derives the authenticated principal server-side.
4. Postgres implementations persist documents/runtime metadata; asset bytes may live in Postgres or object storage.

V2 integration point: Zhiban repositories persist Zhiban aggregates. OpenMAIC stores remain authoritative for OpenMAIC documents/runtime/assets; mappings use foreign ids and explicit ownership rules.

## Dependency direction observed

- `@openmaic/dsl` is dependency-free and is the contract keystone.
- Renderer, importer, generation and editor depend on DSL contracts.
- The Next application composes published packages with app-local stores, services and routes.
- `@openmaic/storage` defines ports and browser/HTTP/Postgres implementations; the app selects them in bootstrap code.
- React surfaces depend on application stores. Those stores must not be treated as domain repositories.

## Stable or public-enough seams

- Exported `@openmaic/dsl` types, validators, normalizers and migrations.
- Exported `@openmaic/storage` store interfaces and documented subpath exports.
- Published package entry points of renderer, editor, importer and generation.
- Persisted ids and typed results returned by supported application APIs, when wrapped by a V2 adapter.

These seams still require contract tests pinned to the baseline SHA.

## Internal implementation seams

- `lib/store/**` Zustand state and actions.
- `components/stage*`, workbench chrome and React component topology.
- `lib/server/agent-runtime/**` runner/tool details.
- `lib/utils/iframe*` injected code and iframe pool implementation.
- Next route file layout and unversioned JSON response details.
- Postgres DDL, trigger/revision implementation and asset lifecycle workers.
- Prompt/template internals and provider-specific request models.

## V2 protection guidance

V2 should avoid direct changes to Stage rendering, Stage store persistence, iframe injection, storage schemas, renderer/editor internals, generation templates and agent runner internals. New behavior should begin as a V2 use case plus a Port. Only an OpenMAIC adapter may translate to these internals, and every adapter must have a compatibility test against the pinned snapshot.

## Version-line policy

```text
upstream/main -> main -> sync/openmaic-* -> compatibility tests -> refactor/zhiban-v2
```

`upstream/main` must never be merged automatically into `refactor/zhiban-v2`. `feature/zhiban-mechatronics` is a V1 reference/maintenance line, not a merge source for V2.
