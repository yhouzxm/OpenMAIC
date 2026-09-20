# Zhiban V2 Domain Boundaries

## Design stance

V2 uses bounded contexts and ports. These definitions are design constraints, not an authorization to create tables or business implementation in Phase 0.

| Domain | Aggregates | Entities | Value objects | Domain services | Repository ports | External ports |
|---|---|---|---|---|---|---|
| Identity | Tenant, Account, RoleAssignment | User, Role, Membership | TenantId, UserId, RoleCode, DataScope | AuthorizationPolicy, MembershipPolicy | TenantRepository, AccountRepository, RoleAssignmentRepository | IdentityProviderPort, AuditPort |
| Course | Course, CourseOffering, ClassRoster | Term, AdministrativeClass, TeachingClass, Enrollment, ActivityDefinition | CourseId, ClassId, EnrollmentStatus, ActivityType | EnrollmentPolicy, CoursePublicationPolicy | CourseRepository, ClassRepository, EnrollmentRepository | DirectoryImportPort, ActivityCatalogPort |
| Learning | LearningRecord, ActivityAttempt | LearningEvent, Attempt, Completion | LearnerId, ActivityId, Progress, EvidenceRef | ProgressPolicy, CompletionPolicy, EvidenceNormalizationService | LearningEventRepository, AttemptRepository | ActivityRuntimePort, EventClockPort |
| Assessment | Assessment, Gradebook | AssessmentItem, Submission, Grade, ConceptError | Score, Rubric, ConceptCode, ErrorStatus | ScoringPolicy, ConceptDiagnosisService, GradePublicationPolicy | AssessmentRepository, GradeRepository, ConceptErrorRepository | AssessmentEnginePort |
| Profile | LearnerProfile | ProfileDimension, EvidenceSnapshot | ProfileVersion, DimensionScore, Confidence | ProfileProjectionService, ProfileCorrectionPolicy | LearnerProfileRepository | ProfileModelPort |
| Intervention | InterventionCase, RemediationPlan | RiskSignal, Recommendation, Action, Notification | RiskLevel, Priority, InterventionStatus | RiskPolicy, RemediationPolicy, EscalationPolicy | InterventionRepository, RemediationRepository | NotificationPort, AIServicePort |
| Classroom | ClassroomSession | Participant, Dispatch, ClassroomEvent | SessionId, SceneRef, PresenceState | DispatchPolicy, SessionAccessPolicy | ClassroomSessionRepository | ClassroomPort, ScenePort, InteractiveRuntimePort |
| VirtualLab | VirtualLabAttempt | LabSession, LabAction, Measurement, Hint, LabResult | ScenarioId, LabState, MeasurementValue, ProtocolVersion | LabEvaluationService, HintPolicy, EvidencePolicy | VirtualLabAttemptRepository | InteractiveRuntimePort, AssetPort, AIServicePort |

## Aggregate rules

- Identity owns tenant membership and authorization facts; no other domain infers roles from UI routes.
- Course owns catalog, offerings, classes and enrollment. Classroom consumes enrollment decisions but does not rewrite them.
- Learning owns immutable learning evidence and attempt lifecycle. OpenMAIC runtime state is input evidence, not the Learning aggregate itself.
- Assessment owns scoring, grades and concept-error lifecycle; Profile consumes published evidence and never edits Assessment history.
- Profile is a versioned projection with explicit algorithm/evidence versions.
- Intervention owns risk/remediation workflow. It references Profile and Assessment snapshots rather than reaching into their storage.
- Classroom owns live session coordination and mappings to OpenMAIC ids; OpenMAIC owns Stage/Scene execution.
- VirtualLab owns pedagogical attempts and validated lab evidence, not iframe DOM state.

## Cross-domain interaction

Cross-domain calls use application commands/events and ids. Repositories are private to their bounded context. No aggregate may import an OpenMAIC store, React component, Next route or another domain's database model.

Examples:

- `ActivityCompleted` may update Learning, trigger Assessment evaluation and later feed Profile projection.
- `RiskDetected` may open an InterventionCase but may not mutate a LearnerProfile retroactively.
- A ClassroomSession maps an ActivityId to an opaque OpenMAIC StageId through `ClassroomPort`.
- A VirtualLabAttempt accepts validated protocol evidence through `InteractiveRuntimePort`.

## Open questions for Phase 1 planning

- Tenant identity provider and account federation boundary.
- Event idempotency, ordering and retention requirements.
- Course/activity authoring ownership between Zhiban and OpenMAIC.
- Assessment rubric versioning and grade appeal workflow.
- Profile explainability/confidence requirements.
- Classroom offline/reconnect semantics.
- Virtual Lab protocol version and simulator trust boundary.
