# Phase 1B-9B — OpenMAIC Bridge Foundation Closeout / Freeze

STATUS: COMPLETE_FOR_APPROVED_FOUNDATION / DESIGN_AND_IMPLEMENTATION_FROZEN_FOR_APPROVED_SCOPE

Date: 2026-10-05. Branch: `refactor/zhiban-v2`. Final targeted candidate: `089b3cd66e971408c8a4c904ca09f26344a436a2`, parent `9b5c4ead9b2acd715e974902d56e820af8aa374d`. Closeout preflight worktree: CLEAN.

This closes the approved 1B-9B Document/Asset and Bridge mapping foundation against [B9-S01–S08](phase1b-9a-bridge-design.md), [B9-P01–P08](phase1b-9b-schema-acl-design.md) and [ADR-012](../adr/ADR-012-openmaic-identity-bridge.md). The freeze covers the implemented, disabled-by-default infrastructure and its tested synthetic contracts. It does **not** open a production teaching resource or certify a deployed OpenMAIC host.

## Implemented boundary

- Zhiban owns tenant/resource mapping, generation history, operation ledger, audit and RepositoryRevision CAS. OpenMAIC owner handles, StageRefs and AssetRefs remain opaque infrastructure references, never authorization evidence. The [Application Bridge port and unavailable facts loader](../../../lib/zhiban/application/openmaic/bridge.ts) expose a closed decision; the [production composition](../../../lib/zhiban/infrastructure/openmaic/root.ts) rechecks an authentic Session/Identity projection and rejects every business action while real Activity schema, catalog, relationships and loader are absent.
- [0012](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0012_openmaic_bridge_foundation.sql) adds `zhiban_bridge` mapping, generation, scene, asset, operation and audit tables plus a global deployment registry. The shipped `business_resource_ready()` gate returns FALSE. Permanent slots, tenant-composite references, terminal history, one active generation, deferred pointer consistency, closed operation/audit vocabulary and positive signed-int8 revisions are database-enforced. Synthetic test resources are confined to disposable CI databases.
- [0013](../../../lib/zhiban/infrastructure/identity/postgres/migrations/0013_openmaic_bridge_consistency_fix.sql) repairs shared-trigger row-field dispatch by replacing `mapping_consistency()` after `0012` was already applicable. The `0012` checksum and prior `0001–0011` migrations remain unchanged. The upgrade test verifies that applying only `0013` preserves prior ledger/checksums, function identity/owner/security configuration/ACL and existing trigger bindings.
- The Identity database uses a separate `zhiban_bridge_runtime` with FORCE tenant RLS, exact table/column/function privileges and a narrow current-Identity helper. The private OpenMAIC database has separate owner, migrator and runtime roles, an explicit provisioning receipt and catalog fingerprint. The runtime uses pinned public `@openmaic/storage` Document/Asset interfaces and the PG byte backend; it has no production business gate override, native route, generic store or collector capability.
- The [guarded transaction protocol](../../../lib/zhiban/infrastructure/openmaic/protocol.ts), [repository](../../../lib/zhiban/infrastructure/openmaic/repository.ts), [native storage adapter](../../../lib/zhiban/infrastructure/openmaic/native-storage.ts) and [closed content validator](../../../lib/zhiban/infrastructure/openmaic/content.ts) keep local reservation/CAS/audit separate from native transactions. Dispatch is one-use, bounded and freshly authorized; uncertain external outcomes remain denied pending exact reconciliation. No distributed ACID, automatic retry or published in-place overwrite is claimed. Preview and media delivery use exact registered references, bounded content, private/no-store policy and current authorization checks.

The official source is OpenMAIC v1.1.2 SHA `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce`. Pinned **package** versions remain storage `0.31.1`, DSL `0.11.2` and renderer `0.1.11` in [catalog metadata](../../../lib/zhiban/infrastructure/openmaic/catalog.ts) and the deployment/generation metadata. The public `MaicDocument.dslVersion` is a distinct **document protocol** stamp: the exported `DSL_VERSION` is `0.3.0`. Bridge intentions use `asset:<AssetRef>`; the native Document provider persists the bare allocated AssetRef for its public reference tracker. Read conversion validates the unmodified stored shape before returning Bridge content, so unsafe fields, URLs, wrong references or a package-version document stamp fail closed. Neither the provider packages nor their version metadata was changed for this fix.

## Real CI evidence and resolved findings

| Evidence | Exact candidate and result |
| --- | --- |
| [General CI 37307803725](https://github.com/yhouzxm/OpenMAIC/actions/runs/37307803725) | `9b5c4ead…`, workflow_dispatch `bridge-recheck`, SUCCESS; root 10593 tests, importer 271, DSL 252, generation 199 and storage 1137 PASS; frozen install, formatting and package checks PASS. |
| [Identity PG16 37307808986](https://github.com/yhouzxm/OpenMAIC/actions/runs/37307808986) | `9b5c4ead…`, workflow_dispatch `bridge-recheck`, SUCCESS; PostgreSQL 16.15, Node v22.23.3 linux/x64; 13 real suites **392/392 PASS ×2**, including Bridge **54/54 ×2**, and `0012→0013` upgrade **5/5 ×2**. Identity non-PG regression 1471 and Bridge unit/contracts 62 PASS. |
| [Storage PG16 37307815089](https://github.com/yhouzxm/OpenMAIC/actions/runs/37307815089) | `9b5c4ead…`, FAILURE at B9-N05 (10/11 in first pass; second pass did not run). Private provisioning and earlier ACL/provider cases passed. The document fixture used DSL package version `0.11.2` as the document protocol stamp, and the provider's reference tracker required bare AssetRefs. This run is recorded as the finding, not as signoff. |
| [Storage PG16 37311769711](https://github.com/yhouzxm/OpenMAIC/actions/runs/37311769711) | Final `089b3cd6…`, workflow_dispatch `bridge-recheck`, SUCCESS; PostgreSQL **16.15**, Node **v22.23.3** on Ubuntu/Linux; fresh official artifacts, frozen install and native minimum-role suite **11/11 PASS ×2**. B9-N05 checks persisted `DSL_VERSION`, bare AssetRef, reference row and revision. B9-N07 rollback, B9-N08 PUBLIC denial, B9-N10 foreign-principal denial and B9-N11 private-DB CONNECT denial pass in both runs. |
| [General CI 37311775585](https://github.com/yhouzxm/OpenMAIC/actions/runs/37311775585) | Final `089b3cd6…`, workflow_dispatch `bridge-recheck`, SUCCESS; Linux/Node v22.23.3, frozen install, root **10603 PASS**, including content **27/27** and new real public provider **1/1**; importer 271, DSL 252, generation 199 and storage 1137 PASS. Formatting and generation/storage typechecks PASS. |

The final provider regression uses actual published `PgAssetStore`/`PgDocumentStore` behavior against PGlite SQL: save/load round-trip, tracked AssetRef, manifest revision and provider rejection of `0.11.2` as a document protocol stamp. It is separate from the final restricted-role PostgreSQL 16 proof. The final targeted candidate did not rerun the Identity PG16 or full Identity non-PG suites; their passing evidence belongs to `9b5c4ead…`. The five-file final delta changes only the native document boundary and its targeted tests. The earlier root lint and root typecheck passed locally during that fix; they were intentionally skipped by the targeted `bridge-recheck` general CI mode, so this document does not attribute a new root tooling pass to that run.

The Identity run also proves the previously approved locks and Bridge races with independent PostgreSQL connections: Credential mutation, logout, User/Tenant/Membership state and grant changes against Bridge dispatch or completion. The migration suite covers apply/upgrade, repeated no-op, checksum drift, failed migration rollback and advisory serialization. Native tests prove least-privilege roles, exact public storage calls, reference tracking, rollback and pool cleanup. These results support the approved foundation; they do not establish real Course/Activity/Attempt authorization or a production network topology.

## Deferred gates

- **1B-9C Runtime/AI foundation:** trusted Attempt/learner binding, expected-tail and no-retry provider behavior, durable exclusive write fence, scalar/JSON consistency where required, bounded record reads and constrained AI ports. Unproved scalar-dependent operations remain CLOSED. No actual learner launch or grade follows from this Document/Asset signoff.
- **Business resource opening and 1B-10:** real Activity/Course/Enrollment/Attempt schema and tenant FKs, current resource facts/catalog and policy, production role/database/network isolation, actual host route/static/direct-byte closure, HTTP Session/CSRF wiring, media/cache/range/revocation behavior and integrated positive/negative proofs. The shipped FALSE business gate is not an operational feature flag. Production credentials, DB creation, byte sizing, backup, retention and cutover require their separate OPS acceptance.
- **Additional capabilities:** D08–D10 are not accepted by this unit. U01 complete Classroom/Playback and U02 Interactive/VirtualLab remain REQUIRED_LATER under ADR-012, not R1 hard requirements; full migration cannot silently drop them. Preview is neither complete Classroom execution nor learning completion evidence. No JWT, native editor/agent route, private upstream patch, physical collector or V1 migration is opened here.

Within the approved 1B-9B foundation, the documented runtime/provider failure and protocol/reference mismatch are resolved by the final candidate and real CI. Outside that bounded scope, the deferred gates above remain explicit prerequisites rather than counted as completed tests.

PHASE_1B9B: COMPLETE_FOR_APPROVED_FOUNDATION

BRIDGE_DESIGN: FROZEN_B9_S01_S08_AND_B9_P01_P08

BRIDGE_IMPLEMENTATION: FROZEN_FOR_APPROVED_FOUNDATION

REAL_IDENTITY_PG16_SIGNOFF: PASS_392_OF_392_TWICE_AT_9b5c4ead

REAL_BRIDGE_PG16_SIGNOFF: PASS_54_OF_54_TWICE_AT_9b5c4ead

REAL_NATIVE_PG16_SIGNOFF: PASS_11_OF_11_TWICE_AT_089b3cd6

REAL_PROVIDER_REGRESSION: PASS_AT_089b3cd6

PRODUCTION_BUSINESS_RESOURCE_ACCESS: CLOSED

PRODUCTION_D01_HOST_NETWORK_ISOLATION: NOT_VERIFIED

P0: 0

P1: 0

P2: 0

READY_FOR_1B9B_CLOSEOUT_CHECKPOINT: YES

READY_FOR_1B9C: YES_AFTER_CLOSEOUT_CHECKPOINT_AND_SEPARATE_AUTHORIZATION
