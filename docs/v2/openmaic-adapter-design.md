# OpenMAIC Adapter Design

## Boundary rule

Ports are owned by Zhiban Application/Domain and describe what Zhiban needs. OpenMAIC adapters implement them in Infrastructure. OpenMAIC DTOs, React components, Zustand state, route handlers and provider objects must not leak through a Port.

## Port summary

| Port | Zhiban need | OpenMAIC capability | Data ownership | Primary risk | Upgrade impact |
|---|---|---|---|---|---|
| `ActivityRuntimePort` | Start/resume/complete an activity; obtain normalized progress/evidence | RuntimeStore, quiz/PBL runtime and playback orchestration | Zhiban owns Attempt/Completion; OpenMAIC owns execution state | Confusing transient runtime state with durable learning evidence | Medium-high: runtime payloads and playback internals evolve |
| `ClassroomPort` | Create/load a classroom execution, authorize launch, obtain opaque document/session ids | Classroom APIs, Stage/Scene document persistence, owner/access checks | Zhiban owns enrollment/session intent; OpenMAIC owns classroom document | Bypassing OpenMAIC ownership or coupling to route response internals | High: routes and client hydration are app-internal |
| `ScenePort` | Resolve activity scenes, read safe metadata, request supported scene mutations | DSL Stage/Scene contracts, document store, validation/migration | OpenMAIC owns Scene content; Zhiban owns Activity-to-Scene mapping | Treating Scene as Zhiban aggregate or relying on app aliases | Medium when limited to DSL; high for app store actions |
| `InteractiveRuntimePort` | Launch an interactive artifact and ingest validated, correlated evidence | iframe host, postMessage bridges, observation/runtime storage | OpenMAIC owns iframe execution; Zhiban owns accepted learning/lab evidence | spoofed/stale messages, protocol drift, DOM coupling | High; require protocol versioning and compatibility tests |
| `AssetPort` | Allocate/resolve media and retain opaque evidence references | AssetStore, AssetRef, HTTP/PG/browser adapters, media lifecycle | OpenMAIC owns bytes/asset registry; Zhiban owns business reference/purpose | principal leakage, lifecycle mismatch, executable content | Medium if using storage contract; high if using media internals |
| `AIServicePort` | Request generation, coaching, feedback or structured evaluation under Zhiban policy | provider config, generation package, agent runtime/media tools | Zhiban owns request purpose/policy/result acceptance; OpenMAIC owns invocation/session artifacts | provider leakage, nondeterminism, PII, prompt coupling | High; adapter must normalize results and record model/prompt provenance |

## Proposed contracts

These are conceptual signatures, not Phase 0 implementation.

```ts
interface ActivityRuntimePort {
  start(input: StartActivity): Promise<RuntimeHandle>;
  resume(handle: RuntimeHandle): Promise<RuntimeSnapshot>;
  submit(input: RuntimeSubmission): Promise<RuntimeOutcome>;
  close(handle: RuntimeHandle): Promise<void>;
}

interface ClassroomPort {
  provision(input: ProvisionClassroom): Promise<ClassroomHandle>;
  load(handle: ClassroomHandle, principal: PrincipalRef): Promise<ClassroomSnapshot>;
  createLaunch(handle: ClassroomHandle, learner: LearnerRef): Promise<LaunchDescriptor>;
}

interface ScenePort {
  list(classroom: ClassroomHandle): Promise<SceneDescriptor[]>;
  resolve(ref: SceneRef): Promise<SceneDescriptor>;
  applySupportedPatch(command: ScenePatchCommand): Promise<SceneRevision>;
}

interface InteractiveRuntimePort {
  prepare(input: InteractiveLaunch): Promise<InteractiveHandle>;
  accept(message: unknown, context: EvidenceContext): Promise<AcceptedEvidence[]>;
  snapshot(handle: InteractiveHandle): Promise<InteractiveSnapshot>;
}

interface AssetPort {
  put(input: AssetWrite): Promise<OpaqueAssetRef>;
  describe(ref: OpaqueAssetRef): Promise<AssetDescriptor | null>;
  resolveAuthorized(ref: OpaqueAssetRef, principal: PrincipalRef): Promise<AssetRead>;
}

interface AIServicePort {
  generate<T>(request: AIRequest<T>): Promise<AIResult<T>>;
  evaluate<T>(request: EvaluationRequest<T>): Promise<EvaluationResult<T>>;
}
```

## Adapter responsibilities

Every adapter must:

1. Validate Zhiban input before invoking OpenMAIC.
2. Derive OpenMAIC principals server-side; never trust client-submitted owner keys.
3. Translate external/OpenMAIC errors into stable application error categories.
4. Return opaque ids and application-owned DTOs.
5. Record the OpenMAIC base SHA and relevant protocol/model versions in diagnostics.
6. Be idempotent where a retry could duplicate attempts, classrooms, assets or AI work.
7. Provide contract tests that run on `sync/openmaic-*`.

## Adapter-specific decisions

### ActivityRuntimePort

- Runtime snapshots are not automatically LearningEvents.
- Evidence is accepted only after correlation to tenant, learner, activity, attempt and runtime handle.
- Completion is decided by Zhiban policy using normalized evidence, not by UI navigation alone.

### ClassroomPort and ScenePort

- Persist an explicit Zhiban mapping: Activity/Session id ↔ opaque Stage/Classroom id.
- Use DSL validators at the adapter boundary.
- Do not expose `useStageStore`, `StageState`, Next request/response types or component props.

### InteractiveRuntimePort

- Require source, protocol version, activity/scenario id, session id and nonce/document token.
- Allowlist message types and payload schemas.
- Treat iframe state as untrusted until normalized.

### AssetPort

- Preserve OpenMAIC principal isolation and AssetRef opacity.
- Zhiban records purpose, retention class and owner mapping but does not duplicate byte ownership.
- Deletion/retention must coordinate; a Zhiban record deletion does not directly delete OpenMAIC bytes without policy.

### AIServicePort

- Separate generation, coaching and assessment policies.
- Store provenance and structured validation outcomes, not provider SDK response objects.
- AI output cannot directly publish a grade, role, risk intervention or completion without domain policy.

## Upgrade gate

For each `sync/openmaic-*` branch, run adapter contract tests against old and candidate SHAs, compare persisted fixture compatibility, verify principal isolation, and require manual approval for protocol/schema changes. Only then may the sync branch merge into `refactor/zhiban-v2`.
