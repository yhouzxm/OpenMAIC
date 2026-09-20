# ADR-002: OpenMAIC Adapter Layer

## Status

Accepted for architecture; implementation deferred.

## Context

OpenMAIC exposes useful DSL/storage package contracts but much application behavior lives in upgrade-sensitive React, Zustand, Next route and server-runner internals.

## Decision

Zhiban Application/Domain defines Ports. Infrastructure adapters translate those Ports to OpenMAIC. Initial ports are `ActivityRuntimePort`, `ClassroomPort`, `ScenePort`, `InteractiveRuntimePort`, `AssetPort` and `AIServicePort`. No OpenMAIC internal type may leak into Domain.

## Consequences

- Upstream upgrades are localized to adapters and contract tests.
- Some adapter DTO and error translation work is required.
- Direct use of OpenMAIC stores from business/UI shortcuts is prohibited.
- Published OpenMAIC contracts remain preferred inside adapters.
