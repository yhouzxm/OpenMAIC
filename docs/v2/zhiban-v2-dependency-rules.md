# Zhiban V2 Dependency Rules

## Required direction

```text
UI (React / Next.js)
          |
          v
Application (use cases, commands, DTO mapping)
          |
          v
Domain (entities, value objects, policies, port abstractions)

Infrastructure ----implements----> Domain/Application Ports
      |
      +---- OpenMAIC adapters
      +---- persistence adapters
      +---- identity / AI / notification adapters
```

## Layer rules

### Domain

- Pure TypeScript with no React, Next.js, browser, database or OpenMAIC imports.
- Owns invariants, state transitions, entities, value objects, domain events and repository port abstractions.
- Accepts time, ids, AI recommendations and external facts through explicit inputs/ports.

### Application

- Coordinates domain objects and ports for one use case.
- Defines command/query DTOs and transaction/idempotency boundaries.
- May depend on Domain only; it does not know concrete OpenMAIC stores, API routes or React components.

### Infrastructure

- Implements repository and external ports.
- Contains OpenMAIC, Postgres, provider SDK, HTTP and iframe protocol translations.
- Converts external errors and DTOs to application-owned results; external types do not leak inward.

### UI

- Invokes application use cases and renders DTOs.
- Owns route state and interaction state, not business invariants.
- Must not call repositories or OpenMAIC stores directly.

## Explicit prohibitions

- `Domain -> React`
- `Domain -> Next.js`
- `Domain -> OpenMAIC internal store`
- `Domain -> provider SDK`
- `Application -> Zustand store`
- `Application -> Next route handler`
- `OpenMAIC adapter -> Zhiban database tables` except through a declared Zhiban repository port
- Cross-domain direct repository access

## Boundary checks planned for Phase 1

- Import rules enforced by ESLint/dependency-cruiser-equivalent after directory layout is approved.
- Contract tests for every OpenMAIC Port adapter at the pinned base SHA.
- Architecture tests ensuring Domain has no framework imports.
- DTO schema tests at UI/API and iframe boundaries.
- Upgrade suite run on `sync/openmaic-*` before any merge to V2.

No enforcement tooling is added in Phase 0.
