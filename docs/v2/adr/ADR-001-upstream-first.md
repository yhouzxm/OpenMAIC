# ADR-001: Upstream-First Baseline

## Status

Accepted for Phase 0.

## Context

V1 mixed Zhiban changes with an older OpenMAIC feature line. V2 starts from the verified current upstream snapshot `4d2e2bab82374ed45b95964a1f2ed03362666e1c`; `v1.0.3` is only the nearest release reference.

## Decision

Use OpenMAIC `origin/main`/`upstream/main` snapshot `4d2e2bab…` as the V2 base. Keep `main` as the upstream synchronization line and develop V2 on `refactor/zhiban-v2`. Do not derive V2 by merging `feature/zhiban-mechatronics`.

## Consequences

- V2 receives the current storage/runtime/editor/renderer improvements.
- V1 business capability must be re-specified rather than inherited through Git history.
- Compatibility is measured against a pinned SHA.
- Upstream upgrades require a controlled sync branch and tests.
