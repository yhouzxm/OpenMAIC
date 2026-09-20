# V1 to V2 Migration Matrix

No row authorizes migration in Phase 0. Locations are read-only evidence in `E:\openmaic\OpenMAIC`.

| V1 Capability | V1 Location | Business Purpose | Current Dependency | V2 Domain | Strategy | OpenMAIC Dependency | Data Dependency | Risk | Migration Phase | Required Tests |
|---|---|---|---|---|---|---|---|---|---|---|
| Identity | `lib/zhiban/auth`, auth APIs | Authenticate local roles | Next cookies, PG | Identity | REWRITE | None; map principal later | accounts/sessions | High | 1 | auth, lockout, session, tenant isolation |
| Tenant | db tenant context | Partition business data | PG conventions | Identity | KEEP_CONCEPT | owner-key mapping | tenant ids | High | 1 | cross-tenant denial |
| RBAC | `lib/zhiban/rbac` | Scoped authorization | auth + SQL grants | Identity | REWRITE | None | roles/grants/scopes | High | 1 | policy matrix, audit |
| Student experience | `app/zhiban/student` | Learner workflows | Next pages/APIs | UI across domains | REWRITE | adapters only | read models | Medium | 4 | journey/accessibility |
| Teacher experience | `app/zhiban/teacher` | Teaching workflows | Next pages/APIs | UI across domains | REWRITE | adapters only | read models | Medium | 4 | role/use-case journeys |
| Admin console | `app/zhiban/admin` | Governance operations | Next + imports | Identity/Course | REWRITE | None | directory/audit | High | 3 | authorization, audit, bulk safety |
| Academic organization | `academic`, migrations 005/025/030 | Terms/org/people | PG/imports | Course/Identity | KEEP_CONCEPT | None | external directory | Medium | 1 | mapping, effective dates |
| Course | curriculum/content modules | Catalog/delivery settings | PG + routes | Course | REWRITE | activity mappings | course data | High | 2 | aggregate invariants |
| Administrative Class | academic/import | Cohort grouping | imports/PG | Course | KEEP_CONCEPT | None | class membership | Medium | 2 | membership/history |
| Teaching Class | offerings/roster | Delivery group | academic service | Course | KEEP_CONCEPT | classroom mapping | offering/term | Medium | 2 | capacity/lifecycle |
| Enrollment | roster/student access | Entitlement | RBAC + PG | Course | REWRITE | launch authorization | enrollment | High | 2 | duplicate/status/access |
| Activity/content | content/openmaic-activity | Publish learning unit | PG + Stage ids | Course | REWRITE | Scene/Classroom ports | activity mappings | High | 2 | publish/version/mapping |
| Scene orchestration | `scene-orchestration` | Sequence 25 scenes | hard-coded registry | Learning/Classroom | REVIEW | ScenePort | progress/evidence | High | Later | prerequisite/state/model tests |
| Classroom | `classroom`, APIs | Live delivery | OpenMAIC internals | Classroom | ADAPT | Classroom/Scene ports | session mappings | High | 2 | adapter contract/reconnect |
| PBL | `pbl`, PBL routes | Project learning | OpenMAIC PBL + PG | Learning/Assessment | REVIEW | ActivityRuntimePort | project attempts | High | Later | compatibility/collaboration |
| Interactive HTML | activity session/iframe page | Interactive execution | iframe/messages | Learning/Classroom | ADAPT | InteractiveRuntimePort | evidence | High | 2 | spoof/stale/protocol tests |
| Learning Event | learning-center/events | Evidence history | PG events | Learning | KEEP_CONCEPT | runtime evidence input | append log | High | 2 | idempotency/order/provenance |
| Attempt/progress/completion | coursework/progress | Learning lifecycle | mixed services | Learning | REWRITE | ActivityRuntimePort | events/attempts | High | 2 | state machine/retry |
| Assessment | assessment/grade services | Evaluate outcomes | AI/quiz/lab | Assessment | REWRITE | assessment adapter | rubric/evidence | High | 3 | version/scoring/security |
| Concept Error | diagnosis/remediation | Misconception state | rule functions/events | Assessment | KEEP_CONCEPT | optional AI evidence | diagnosis history | High | 3 | explainability/lifecycle |
| Learner Profile | `profile` | Learner projection | event queries | Profile | REWRITE | None directly | governed evidence | High | 3 | reproducibility/correction |
| Six-Dimension Profile | profile analytics UI | Portrait dimensions | inconsistent V1 algorithm | Profile | REVIEW | None | evidence definitions | High | Later | product/evidence validation |
| Remediation | remediation resolver | Corrective pathway | scene registry | Intervention | REWRITE | Scene/AI ports | errors/plans | High | 3 | policy/outcome/audit |
| Risk | `risk`, monitor | Detect/support risk | profile/events | Intervention | REWRITE | optional AI via port | signals/cases | High | 3 | false-positive/privacy/SLA |
| Grade | `grades` | Publish/appeal grades | assessment/coursework | Assessment | REWRITE | None | gradebook/audit | High | 3 | calculation/publish/appeal |
| EMA | `ema`, analysis jobs | Model analysis jobs | worker/PG | Profile/Intervention | REVIEW | AIServicePort | snapshots/jobs | High | Later | definition/model governance |
| Virtual Lab | `virtual-lab` | Practical simulation | iframe + bespoke API | VirtualLab | ADAPT | Interactive/Asset/AI ports | lab attempts | High | Later | protocol/evaluation/recovery |
| AI Tutor | `tutor` | Guided help | provider + course data | Intervention | REWRITE | AIServicePort | consent/context | High | 3 | safety/privacy/provenance |
| AI Peer | `peer` | Peer-like support | LLM + rule guard | Intervention | REVIEW | AIServicePort | sensitive messages | Critical | Later | crisis/escalation/red-team |
| Agent support modes | `agents` | Role/course agent templates | OpenMAIC agent runtime | Application | ADAPT | AIServicePort | configuration | High | 3 | capability/permission tests |
| Teacher analytics | analytics/analysis | Teaching insight | SQL/jobs | Reporting read model | REWRITE | runtime evidence inputs | events/grades | Medium | 4 | metric/reconciliation/export |
| Student dashboard | student pages | Personal insight | many APIs | Reporting read model | REWRITE | adapters only | projections | Medium | 4 | privacy/consistency |
| Admin import | import/ouc-import | Bulk directory/course data | XLSX/crypto/PG | Identity/Course | REWRITE | None | staging/audit | High | 2 | validation/idempotency/rollback |
| Monitoring/intervention | `monitor` | Closed-loop action | notifications/jobs | Intervention | KEEP_CONCEPT | NotificationPort | cases/actions | High | 3 | escalation/SLA/audit |
| Coursework/files | `coursework` | Assign/submit/feedback | file store/PG | Course/Learning/Assessment | REWRITE | AssetPort optional | submissions/files | High | 3 | upload/auth/attempt/grading |
| Competition mechatronics | scene registry/lab templates | Demonstration scenario | hard-coded PLC/scenes | None in core | REMOVE | None | demo fixtures only | Medium | Never/core | archival characterization only |

## Phase interpretation

- Phase 1: architecture skeleton, Identity foundations and port contracts after approval.
- Phase 2: Course/Learning/Classroom foundations and OpenMAIC compatibility adapters.
- Phase 3: Assessment/Profile/Intervention governance.
- Phase 4: read models and role experiences.
- Later: separately approved PBL, Virtual Lab, AI Peer, EMA and specialized pedagogies.
