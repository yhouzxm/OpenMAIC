# ADR-003: V2 Domain Boundaries

## Status

PROPOSED

Validate bounded contexts individually during planning. Phase 1A freeze does not accept ADR-003 globally. Identity refinement does not validate Course, Learning, Assessment, Profile, Intervention, Classroom or VirtualLab.

## Context

V1 couples identity, course delivery, learning evidence, assessment, profiles, intervention, classroom execution and a specialized virtual lab through shared services and database evolution.

## Decision

Adopt eight initial bounded contexts: Identity, Course, Learning, Assessment, Profile, Intervention, Classroom and VirtualLab. Contexts communicate through application commands/events and ids. Repositories are context-private.

## Consequences

- Ownership and invariants become explicit.
- Cross-domain workflows need orchestration and eventual-consistency decisions.
- Physical schema and service deployment remain undecided.
- VirtualLab and advanced AI capabilities can be deferred without contaminating core domains.
