# Data Ownership Model

## Principle

Ownership means authority over schema, lifecycle, invariants and migrations. A foreign id does not transfer ownership. Zhiban may reference OpenMAIC records but must not extend OpenMAIC schemas with business columns.

## OpenMAIC-owned data

| Data | Authority | Zhiban relationship |
|---|---|---|
| Stage / document | OpenMAIC DSL and document store | Store opaque StageId mapping on a Zhiban Activity/ClassroomSession |
| Scene and Scene content | OpenMAIC DSL/document store | Read descriptors through `ScenePort`; never use as the Zhiban activity aggregate |
| AssetRef, registry and bytes | OpenMAIC asset store | Reference through `AssetPort`; Zhiban may own purpose/retention metadata |
| Agent session, messages and tool state | OpenMAIC agent runtime/storage | Reference a session id for traceability; do not treat it as a learner profile |
| Runtime payload/state | OpenMAIC RuntimeStore | Normalize selected evidence into Zhiban LearningEvents |
| Editor document state | OpenMAIC editor/document model | No Zhiban business invariants in editor state |
| Playback cursor/engine state | OpenMAIC playback | Transient execution detail; only validated outcomes cross the boundary |
| Importer intermediate model | OpenMAIC importer | Accept final validated document/asset ids only |
| Provider/media task state | OpenMAIC AI/media subsystems | Zhiban stores business request/provenance and accepted result references |

## Zhiban-owned data

| Data | Owning domain | OpenMAIC relationship |
|---|---|---|
| Tenant, User, Role, RoleAssignment | Identity | May map a Zhiban principal to an OpenMAIC owner/learner key in Infrastructure |
| Course, Term, Administrative Class, Teaching Class | Course | May reference OpenMAIC activities; never stored in Stage metadata as authority |
| Enrollment | Course | Authorizes launches; OpenMAIC does not become enrollment authority |
| Activity definition and publication policy | Course | Holds opaque OpenMAIC Stage/Classroom reference when applicable |
| LearningEvent | Learning | Can be derived from validated OpenMAIC runtime/interactive evidence |
| Attempt, Progress, Completion | Learning | Correlates to runtime handles but uses Zhiban lifecycle/idempotency rules |
| Assessment, Submission, Grade | Assessment | May consume OpenMAIC quiz or AI evidence; publication remains Zhiban-owned |
| ConceptError | Assessment | Derived/versioned diagnosis, not embedded into OpenMAIC Scene state |
| LearnerProfile and dimensions | Profile | Projection from Zhiban evidence with algorithm version and confidence |
| Risk, InterventionCase, RemediationPlan | Intervention | May choose an OpenMAIC activity/scene through a recommendation mapping |
| ClassroomSession, participant and dispatch | Classroom | Maps to OpenMAIC classroom/stage/runtime ids |
| VirtualLabAttempt, actions, measurements and result | VirtualLab | Uses validated interactive protocol evidence and AssetRefs |
| Audit and governance records | Relevant Zhiban domain | May include OpenMAIC ids/SHA as context; never stored only in OpenMAIC logs |

## Shared-reference records

Integration mappings are Zhiban-owned Infrastructure records, conceptually containing:

- tenant id and owning Zhiban aggregate id;
- OpenMAIC resource kind and opaque id;
- base/protocol version;
- creation source and timestamps;
- lifecycle state and last compatibility check;
- no duplicated OpenMAIC content blob.

Their schema is deliberately deferred; Phase 0 creates no tables.

## Consistency and lifecycle rules

- Zhiban commits business state only after required OpenMAIC operations succeed, or records a recoverable pending operation with idempotency key.
- Deleting a Zhiban aggregate does not silently delete OpenMAIC resources; retention/orphan policy must be explicit.
- Deleting an OpenMAIC asset/document must surface broken-reference state to Zhiban rather than fabricating success.
- Learning evidence is append-oriented and idempotent; corrections are new governed records.
- AI/session/runtime data has separate retention from grades and profiles.
- Cross-tenant lookups are forbidden even when an opaque OpenMAIC id is known.

## Data that must not be conflated

- OpenMAIC access code/token ≠ Zhiban identity or RBAC.
- Stage owner ≠ course teacher assignment.
- Runtime learner key ≠ canonical Zhiban UserId.
- Scene completion/navigation ≠ Zhiban Completion unless policy accepts evidence.
- Agent transcript ≠ LearningEvent history.
- Asset principal ≠ Tenant without explicit server-side mapping.
- AI evaluation ≠ published Grade.

## Decisions deferred

Database technology, physical schemas, event transport, retention durations, encryption keys, data residency and migration mechanics require separate ADRs before implementation.
