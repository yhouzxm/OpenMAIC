# 1B-9C Ubuntu LOCAL PG16 continuation

Date: 2026-10-07. Approved continuation base: `68774fcc9bc1ac98f81cbbd5ced73bbe7e2ac8d6`, branch `refactor/zhiban-v2`. The user authorized implementation of the proposed LOCAL disposable mode, the two test-fixture corrections and two-pass PG16/non-PG verification. NO COMMIT / NO PUSH / NO CI DISPATCH.

This is a narrow environment supplement to C9-P02/P07 in [the frozen exact design](phase1b-9c-schema-acl-design.md). C9-S01–S08, all production semantics, applied migrations 0001–0013, production business denial, unsupported integrity gates and fake-only AI remain frozen. Existing GitHub workflows/modes and their required loops are unchanged.

## Environment and isolation

`ZB_PG16_EXECUTION_MODE=LOCAL` is explicit; an absent mode retains the existing GITHUB_ACTIONS behavior. LOCAL rejects any GITHUB_ACTIONS/GITHUB_SHA variable, Node other than 22, non-Linux/non-x64, absent disposable flag, non-loopback URL, query/fragment options, non-postgres administrator, port other than 55432 or database other than zhiban_pg16_test. Required suites fail on absent connection/provenance; skipped cases are never counted as PASS.

Before any fixture reset, verify server major 16, session_user/current_database, server port 55432 and data_directory `/var/lib/postgresql/16/zhiban_test`. Allowed databases are only postgres/template0/template1/zhiban_pg16_test. Allowed custom roles are postgres plus the existing seven fixed Identity fixtures. Allowed namespaces are public/information_schema and zhiban_identity/zhiban_bridge/zhiban_runtime_contract_test; public must have no relations or routines. Mismatches fail before destructive queries. The separately running 5432/main cluster is never connected to or modified.

The existing reset drops only its fixed schemas/owned objects/roles in this dedicated cluster. C9 closes tracked pools before removing the Runtime fixture and resetting Identity. The LOCAL runner serializes runs with an exclusive temporary-directory lock, executes each existing PG suite in a separate serial process and verifies no zhiban schemas/roles survive both complete passes. Failures stop the runner, preserve logs and never produce a PASS marker. Interrupted/stale locks need inspection before removal; there is no automatic destructive cleanup of an uncertain environment. Database isolation does not waive ACL/FORCE RLS/least-privilege/bootstrap/migration assertions.

Use an existing `~/.pgpass` (0600), or PGPASSFILE, for postgres authentication; do not put credentials in commands, receipts, tracked files or chat. Dedicated synthetic test-role credentials are generated for the process. No PostgreSQL installation, cluster recreation, pg_hba changes or production/V1 credentials are involved.

Bootstrap removes inherited PGSERVICE/PGSERVICEFILE/PGHOSTADDR and passes the validated host, port, database and administrator as explicit psql arguments. Passwords remain in the child environment or pgpass; PGPASSFILE is retained. LOCAL and both existing GitHub Actions mode forms have negative tests for inherited connection redirection.

## Provider and evidence

Build unchanged public DSL/storage artifacts before each pass. The receipt records executionMode LOCAL, actual HEAD, official SHA `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce`, Node/platform/architecture/protocol, source/lock/ESM-resolved artifact SHA256 and candidatePatchDigest. LOCAL requires the approved HEAD and branch; the candidate digest binds tracked uncommitted changes plus untracked test/design files. Source must match the pinned official package tree; working package/lock changes and untracked package source reject. Receipt consumption revalidates all fields against the current process/tree/artifact, including candidate changes. A LOCAL receipt cannot satisfy the GITHUB_ACTIONS branch. Receipts live outside the repository and are regenerated for each pass.

This is LOCAL evidence, not CI signoff, fresh deployed isolation, real Attempt authorization or paid AI proof. Storage/native has a separate `/openmaic`/native-database/provenance lifecycle and is not enabled by this addition.

## Fixture corrections

The test-only UUID domain permits NULL or a structurally valid UUIDv7. Required columns still enforce NOT NULL, and nullable operation/scene references retain exact FK/trigger checks. The frozen Identity UUID helper is unchanged. The binding field assertion is corrected from 19 to the frozen 18 fields; no field is added or removed.

## Reproduction and inventory

From the repository root, with the local pgpass entry configured:

```bash
PATH=/home/zxm/.nvm/versions/node/v22.23.3/bin:$PATH \
  node tests/zhiban/runtime/run-local.mjs all \
  68774fcc9bc1ac98f81cbbd5ced73bbe7e2ac8d6
```

The runner also accepts `pg` or `nonpg` to continue independent checks, and `pg-second` to execute one fresh complete pass numbered 2 (all 15 PG files, fresh build/receipt, normal preflight/cleanup; no automatic retry). It requires pnpm 10.28.0. It writes per-command logs, Vitest JSON reports, per-pass receipts and summary.json into a new `/tmp/zhiban-local-*` directory, prints actual counts and rejects skipped/pending/missing cases. Each requested file must be collected exactly once, with at least one assertion and only passed cases; missing, unexpected, duplicate or empty files fail even if Vitest exits successfully. The non-PG Bridge manifest explicitly excludes native-pg.test.ts and browser.test.ts; their separate Storage/native/browser evidence remains outside this continuation. A directory-wide selection collects 13 unavailable native/browser cases and must not be reported as zero-skipped hermetic proof.

| Selection | Kind | Execution / expected cases | Existing CI inclusion |
| --- | --- | --- | --- |
| role-bootstrap, migration-runner, schema-security, rls, transactions, repository-signoff, credentials, sessions, authorization, identity-composition, membership-composition, identity-http, manual-recovery, bridge | Real PG16 | Each `pg16-*.test.ts`, twice serially; historical original baseline 402 cases, record actual counts | Existing Identity full; retained modes unchanged |
| runtime-foundation | Real PG16 C9-I | Twice serially, C9_PG16_REQUIRED=1 and per-pass receipt; 36 collected cases | Existing Identity full/bridge-recheck, twice |
| bootstrap-role-contract and schema-acl | Hermetic negative guards | URL/cluster mismatch refuses mutation; mixed origin/hash tampering refuses receipt; actual counts | Existing explicit static selections (no new workflow selection needed) |
| Identity non-PG | Hermetic/static/contracts | All Identity `.test.ts` except `pg16-*`, one serial run; actual collected count | Existing static selections/root discovery |
| Bridge and seven Runtime suites | Hermetic/static/public provider | Serial runs, real flags absent; actual counts | Existing explicit selections |
| lint, 8192-MiB process-only tsc, root prettier check, diff check | Tooling | Retain diagnostics; any failure blocks local completion | Existing tooling; no CI result inferred |

## Historical evidence retained

User-provided Identity run 37384425524: original PG16 402/402 PASS, Runtime 12/36 PASS and 24 FAIL; second pass and non-PG regression not executed. User-provided Storage run 37336615018 SUCCESS retains only its original SHA/suite scope. This continuation does not rewrite those runs or attribute LOCAL results to them. New final evidence and counts are recorded separately after execution.

## 2026-10-07 measured LOCAL timing correction

Three targeted diagnostic rounds separately measured beforeEach fixture hooks and actual test bodies. Migration's two-CLI case used 0.34–0.42 s fixture time and 4.47–4.65 s body time, of which 4.40–4.58 s was the two pnpm/tsx subprocesses. The preserve Membership case used 1.55–1.70 s fixture time and 4.47–4.92 s body time; leave/rejoin used 1.87–2.15 s fixture time and 4.32–4.43 s body time. Each Membership body retained 9 real Argon2 hashes and 11 verifies, plus 608/612 client SQL calls. Measured body connections totalled 0.35–0.41 s; individual measured queries were at most 155 ms. These profiles show the default 5000-ms body budget has little scheduling margin on this host. JSON reporter duration includes fixture hooks and is not a body-only measurement.

Only LOCAL real-PG Vitest commands now use testTimeout=15000. The original hook budget, pool statement/connection timeouts, child-process timeout, Argon2 policy, all assertions, CI commands/timeouts and production code/migrations remain unchanged. Hermetic suites retain their existing timeout behavior. summary.json records the PG body budget and actual pass selection. There is no automatic retry or swallowed failure.

Profiling used a separate 30000-ms diagnostic budget and selected three cases (52 deliberately unselected cases each round); those diagnostic reports are not zero-skipped PG signoff. Instrumentation and detailed reports live outside the repository, record timing/counts only and never log SQL, parameters, URLs or credentials.

The earlier first PG pass remains 402+36 PASS at candidate digest `74c9d7e0f6e531a9874975bab3abdffa1afc67aedfba4005518b28b7ba366d6b` under the stricter default budget. This correction changes only this LOCAL runner, its hermetic guard tests and this supplement; PG test/harness/schema, production, provider and lock bytes are unchanged. A new second-pass receipt binds the current candidate; the old first-pass receipt is retained and is not rewritten or attributed to the new patch digest. Original failed second-pass reports remain failed. Report the resulting evidence with this exact scope difference, without claiming two uninterrupted runs of the new patch.
