# V1 Capability Inventory

## Scope and method

Source inspected read-only at `E:\openmaic\OpenMAIC`. Evidence includes `lib/zhiban/**`, `app/zhiban/**`, `app/api/zhiban/**`, scripts and migrations `001`–`051`. No V1 file, dependency, branch or database was changed.

Strategy meanings:

- `KEEP_CONCEPT`: retain the business concept, not the implementation.
- `REWRITE`: redesign and implement against V2 boundaries.
- `ADAPT`: capability primarily belongs behind an OpenMAIC/external adapter.
- `REMOVE`: do not carry forward without a new approved need.
- `REVIEW`: product, governance or evidence is insufficient for a final decision.

## Inventory (36 capabilities)

| # | Capability | V1 evidence | Observed purpose | Strategy | V2 note |
|---:|---|---|---|---|---|
| 1 | Identity / local authentication | `lib/zhiban/auth/**`, `app/api/zhiban/auth/**`, migrations 001–002 | Student/teacher/admin login, session cookie, password lifecycle | REWRITE | Identity boundary and federation/security requirements must be re-approved. |
| 2 | Tenant isolation | `tenantId` in auth/types, DB tenant context, identity migrations | Partition accounts and academic/business records | KEEP_CONCEPT | Make Tenant an aggregate and enforce scope in repositories. |
| 3 | RBAC and data scopes | `lib/zhiban/rbac/**`, migrations 003–004 | Permission codes and self/project/class/course/tenant/system scopes | REWRITE | Preserve scoped authorization concept; redesign policy and audit surface. |
| 4 | Student role and experience | `app/zhiban/student/**` | Course, activity, classroom, grade, profile, risk and support views | KEEP_CONCEPT | UI is not reusable; use application queries. |
| 5 | Teacher role and experience | `app/zhiban/teacher/**` | Course operation, classroom, analytics, grade, profile, risk, lab | KEEP_CONCEPT | Split use cases by domain; do not port pages. |
| 6 | Admin role and console | `app/zhiban/admin/**`, admin APIs | Account, role, directory, academic and import administration | REWRITE | Security- and workflow-sensitive. |
| 7 | Academic organization | `lib/zhiban/academic/**`, migrations 005, 025, 030 | Term, organization, people and academic overview | KEEP_CONCEPT | Normalize external directory identities through ports. |
| 8 | Course | curriculum/content/teacher-course modules, migrations 034–040 | Course catalog, ownership, settings, content and AI support | REWRITE | Course becomes a bounded context and aggregate. |
| 9 | Administrative Class | academic module, import routes, migrations 031–032 | Cohort organization and head-teacher management | KEEP_CONCEPT | Separate from Teaching Class. |
| 10 | Teaching Class / Course Offering | academic and roster types, course classroom routes | Term-specific delivery group, teachers and capacity | KEEP_CONCEPT | Model as offering/teaching class under Course. |
| 11 | Enrollment / roster | `course-roster/**`, student access, migration 033 | Student and teacher membership in offerings | REWRITE | Strong lifecycle, idempotency and authorization rules required. |
| 12 | Activity and course content | `content/**`, `openmaic-activity/**`, migrations 035–043 | Publish resources, assignments and OpenMAIC activities | REWRITE | Zhiban owns Activity; OpenMAIC resource is an opaque mapping. |
| 13 | Scene orchestration | `scene-orchestration/**` (`S01-01`…`S07-03`) | 25-scene prerequisites, lifecycle, guidance and routing | REVIEW | Extract pedagogical requirements; do not migrate registry/code verbatim. |
| 14 | Classroom | `classroom/**`, classroom APIs, migrations 011–013, 051 | Live session, dispatch, scene events and access | ADAPT | Zhiban Classroom domain plus `ClassroomPort`/`ScenePort`. |
| 15 | PBL | `lib/zhiban/pbl/**`, student/teacher PBL routes, migrations 009–010 | Project definitions, instances, collaboration and assessment | REVIEW | Compare with current OpenMAIC PBL v2 before defining V2 scope. |
| 16 | Interactive HTML / OpenMAIC activity | OpenMAIC activity module, activity session route, iframe validation page | Embed and run generated interactive content | ADAPT | Use versioned `InteractiveRuntimePort`; no copied iframe code. |
| 17 | Learning Event | learning-center types/services, migrations 012, 014, 017 | Append learning evidence for projection and diagnosis | KEEP_CONCEPT | Redesign event schema, identity, idempotency and provenance. |
| 18 | Attempt, progress and completion | coursework, learning-center progress, migration 037 | Track submissions/activity progress and completion | REWRITE | Learning aggregate owns lifecycle; runtime state is only evidence. |
| 19 | Assessment | assessment APIs/types and migrations 010, 021 | Scores, quiz/lab evaluation and grade linkage | REWRITE | Version assessment/rubric and separate evaluation from publishing. |
| 20 | Concept Error | learning-center diagnosis, remediation state | Detect and govern misconception lifecycle | KEEP_CONCEPT | Assessment-owned, versioned diagnosis with evidence. |
| 21 | Learner Profile | `profile/**`, migrations 014–015 | Evidence-derived learner projection and corrections | REWRITE | Version algorithm, confidence and correction governance. |
| 22 | Six-Dimension Profile | profile/analytics UI and calculator | Multi-dimensional learning portrait | REVIEW | V1 calculator visibly returns five named dimensions; reconcile product definition and evidence validity. |
| 23 | Remediation | `scene-orchestration/remediation.ts` | Map concept errors to guided retry/recommendation | REWRITE | Intervention owns plan; OpenMAIC activity chosen through adapter. |
| 24 | Risk | `risk/**`, migrations 023–024 | Calculate risk signals, case handling and privacy | REWRITE | Governance, explainability, thresholds and human action required. |
| 25 | Grade | `grades/**`, migrations 021–022 | Grade items, publication, export and review | REWRITE | Assessment owns grading policy; immutable publication/audit. |
| 26 | EMA | `ema/**`, migration 016 and course EMA routes | Scheduled/evidence model analysis jobs | REVIEW | Acronym, model purpose, inputs and governance need formal specification. |
| 27 | Virtual Lab | `virtual-lab/**`, lab APIs, migration 049 | Versioned iframe protocol, sessions, actions, hints and evaluation | ADAPT | Keep domain attempt/evidence; replace competition simulator coupling. |
| 28 | AI Tutor | `tutor/**`, migration 038–039 | Course-scoped tutoring with governance | REWRITE | `AIServicePort`; product policy and safety are Zhiban-owned. |
| 29 | AI Peer support | `peer/**`, migration 044 | Emotional/learning peer support with crisis guard | REVIEW | Requires safety, escalation, privacy and clinical-boundary review. |
| 30 | Agent / AI support modes | `agents/**`, migration 018, 020, 040 | Teacher/student/assistant templates and course bindings | ADAPT | Normalize through AI port; no agent-runner coupling in domain. |
| 31 | Teacher analytics | `teaching-analytics/**`, `analysis/**`, migrations 047–048 | Course metrics, jobs and export | REWRITE | Build governed read models from V2 events. |
| 32 | Student dashboard | student overview/analysis/profile/grade/risk pages | Personal progress and support visibility | REWRITE | UI projection over application queries; no page reuse. |
| 33 | Admin import and directory | import/OUC modules, migrations 006, 025–031 | Spreadsheet/import batches, rollback and external identifiers | REWRITE | External directory/import ports, validated staging and audit. |
| 34 | Monitoring and intervention workflow | `monitor/**`, migrations 045–046 | Closed-loop teacher notifications/actions | KEEP_CONCEPT | Intervention domain with explicit ownership and SLA. |
| 35 | Coursework / file submission | `coursework/**`, migration 036–037 | Assignments, attempts, files, feedback | REWRITE | Course defines work; Learning/Assessment own attempts and grading. |
| 36 | Competition-specific mechatronics implementation | scene registry, `MECH_*` lab protocol, knowledge stations, PLC rules | Demo/course-specific 25 scenes and simulator logic | REMOVE | Preserve only as requirements/test evidence; do not migrate into V2 core. |

## Cross-cutting findings

- V1 mixes domain concepts, SQL services, Next handlers, OpenMAIC internals and competition UX in the same feature line.
- The migration sequence records useful business evolution but is not a V2 schema specification.
- Strong concepts worth retaining include tenant scope, administrative/teaching class distinction, evidence-based learning, governed grading/profile/risk, and classroom/activity mappings.
- Highest-risk reuse candidates are authentication, RBAC enforcement, database services, iframe protocol handling, AI output governance and all competition-specific Scene/Virtual Lab code.
- `KEEP_CONCEPT` never authorizes source copy. Every retained concept must be re-expressed in the V2 domain model and tested independently.
