# OpenMAIC Core Protection Boundary

## Purpose

This policy prevents Zhiban delivery pressure from turning upstream internals into an undocumented fork. A proposed change must be classified before implementation. The default is `PREFER_ADAPTER`.

## Categories

- **A — PREFER_ADAPTER:** consume through a Zhiban-owned Port and keep OpenMAIC-specific translation in Infrastructure.
- **B — EXTENSION_POINT:** an exported/configurable seam intended for integration; use with contract tests.
- **C — MODIFY_ONLY_IF_REQUIRED:** upstream internal code. Change only after an ADR proves no adapter or contribution path works.
- **D — DO_NOT_CUSTOMIZE:** security, persistence correctness, engine internals or generated/vendor code that V2 must not fork.

## Path classification

| Path / surface | Category | Rule |
|---|---|---|
| `components/stage.tsx`, `components/stage/**` | C | Do not add Zhiban conditions or role logic. Integrate outside the Stage chrome. |
| `components/classroom/**` | A | Wrap with `ClassroomPort`; do not make it tenant-aware internally. |
| `components/scene-renderers/**` | A | Select supported Scene types through DSL; add V2 interpretation outside renderers. |
| `lib/types/stage.ts` | C | Prefer upstream DSL types or adapter-owned DTOs. App aliases are not a V2 domain model. |
| `lib/runtime/**` | B | `configureRuntimeStorage` and `RuntimeStore` are supported seams; app singletons/validators remain upstream-owned. |
| `lib/store/**` | D | Never import Zustand stores into Domain/Application or patch them for V2 workflows. |
| `lib/utils/iframe.ts`, `lib/store/widget-iframe.ts`, `lib/store/interactive-iframe-pool.ts` | D | Security- and lifecycle-sensitive. Integrate via a protocol adapter and compatibility tests. |
| `app/api/classroom/**`, `app/api/stages/**` | A | Call through an adapter; do not embed V2 entities or RBAC in upstream routes. |
| `app/api/persistence/**` | D | Keep principal derivation, protocol and storage dispatch upstream-owned. |
| `lib/persistence/**` | D | Do not alter schemas, ownership, quotas or bootstrap for V2 data. |
| `packages/@openmaic/storage/**` exported interfaces | B | Use documented interfaces; pin contract tests. |
| `packages/@openmaic/storage/**` PG/HTTP/browser implementations | D | No Zhiban columns, tables, tenant assumptions or migrations. |
| `packages/@openmaic/dsl/**` | B/C | Consume exported types/validators. Extending the upstream contract requires a separate upstream-quality proposal, never a local business shortcut. |
| `packages/@openmaic/renderer/**` | D | Consume package exports; do not fork rendering/layout behavior for Zhiban. |
| `packages/@openmaic/editor/**` | D | Consume supported editor APIs; do not place business authorization in editor commands. |
| `packages/@openmaic/generation/**` | A | Invoke through `AIServicePort`; prompt/template customization belongs in an adapter or upstream extension mechanism. |
| `packages/@openmaic/importer/**` | B | Use package entry points; parser/serializer internals are C/D. |
| `lib/server/agent-runtime/**` | A/C | Wrap supported use cases; runner state, tool integrity and storage internals are not extension points. |
| `lib/media/**`, `lib/server/store-generated-asset.ts` | A | Use `AssetPort`/`AIServicePort`; never couple Zhiban entities to provider task structures. |
| `lib/playback/**` | A/C | Request playback/runtime capabilities through a Port; avoid engine changes. |
| `lib/server/access-token*.ts`, `lib/server/stage-access.ts` | D | Keep OpenMAIC access security separate from Zhiban identity and RBAC. |
| `app/**`, `components/**` generic UI composition | C | A change needs an explicit upstream-neutral requirement and regression tests. |

## Enforcement checklist

Before changing any path outside `docs/v2/**` or future Zhiban-owned modules:

1. Identify the V2 use case and owning domain.
2. Define or reuse a Port without importing React, Next.js, Zustand or OpenMAIC internals.
3. Demonstrate why an Infrastructure adapter is insufficient.
4. Record the decision in an ADR and identify upstream contribution potential.
5. Add compatibility tests and upgrade rollback criteria.
6. Obtain human approval before touching category C; category D requires redesign or upstream work.

## Forbidden shortcuts

- Adding tenant/user/role fields to OpenMAIC Stage or Scene to avoid a mapping table.
- Reading `useStageStore` from Zhiban domain/application code.
- Writing V2 records into OpenMAIC document/runtime/asset tables.
- Trusting iframe messages as learning evidence without adapter validation and identity binding.
- Importing provider SDK types into V2 domain services.
- Copying V1 `lib/zhiban` code into OpenMAIC packages.
- Merging `upstream/main` directly into the V2 branch without a sync branch and compatibility suite.
