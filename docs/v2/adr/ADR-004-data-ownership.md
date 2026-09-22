# ADR-004: Data Ownership Split

## Status

Accepted for architecture; storage implementation deferred.

Detailed storage design remains deferred; this wording clarification does not accept a schema or change data ownership.

## Context

OpenMAIC already owns Stage, Scene, runtime, assets and agent-session persistence. Zhiban owns institutional and learning-governance concepts. Extending OpenMAIC tables with Zhiban columns would create a fragile fork.

## Decision

OpenMAIC owns its documents, scenes, runtime payloads, assets, agent sessions and execution internals. Zhiban owns tenant/user/RBAC, course/class/enrollment, learning evidence/attempts, assessment/concept errors/grades, profile, intervention and virtual-lab attempts. Cross-system relationships use Zhiban-owned mapping records with opaque OpenMAIC ids.

## Consequences

- No Zhiban database columns or migrations are added to OpenMAIC storage.
- Lifecycle and reconciliation policies are required for mapped resources.
- OpenMAIC runtime data must be normalized before becoming governed learning evidence.
- Phase 0 creates no tables.
