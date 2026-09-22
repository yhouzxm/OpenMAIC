# ADR-005: Production V1 Isolation

## Status

ACCEPTED

## Context

The V1 production/reference project is located at `E:\openmaic\OpenMAIC`. Phase 0 needs its capability evidence but must not risk production maintenance state or accidentally import its coupled implementation.

## Decision

Treat the V1 directory and `feature/zhiban-mechatronics` as read-only reference sources. Do not install dependencies, format, checkout, reset, commit or edit there. Do not merge the V1 branch into V2. Any retained capability is re-specified and implemented behind V2 boundaries.

## Consequences

- Production maintenance remains isolated.
- V2 loses no product knowledge because inventories and characterization requirements are recorded.
- Copy/paste migration is disallowed.
- A future V1 bug fix and a V2 feature are separate changes and reviews.
