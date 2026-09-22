# ADR-006: Controlled Upstream Synchronization

## Status

ACCEPTED

## Context

V2 must consume upstream improvements without allowing an untested upstream merge to break adapters, persistence or learning workflows.

## Decision

Use the flow:

```text
upstream -> main -> sync/openmaic-* -> compatibility tests -> refactor/zhiban-v2
```

`main` remains the OpenMAIC synchronization line. Each upgrade uses a dedicated `sync/openmaic-*` branch, records old/new SHAs, runs baseline plus adapter compatibility tests and receives human approval. Never automatically merge `upstream/main` into `refactor/zhiban-v2`.

## Consequences

- Upgrades are auditable and reversible by branch policy.
- V2 may intentionally lag upstream while incompatibilities are resolved.
- Adapter tests and persisted fixture compatibility become release gates.
- `feature/zhiban-mechatronics` is not part of the sync graph.
