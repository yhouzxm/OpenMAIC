# OpenMAIC 1.1.2 controlled synchronization review

## Scope and provenance

This is a release-pinned compatibility update, not an upgrade to the current development `main`, a Zhiban feature implementation, or a deployment signoff.

| Reference | Pinned commit |
| --- | --- |
| V2 base, `refactor/zhiban-v2` | `9c99299d6f2a121dbaced4a1c62f5471a75af6b3` |
| Previous official release, `v1.1.0` | `21d83ec51b908a4b169ee2be7498a29da213c74d` |
| Official target, `THU-MAIC/OpenMAIC` `v1.1.2` | `1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce` |
| Release merge on `sync/openmaic-1.1.2` | `45d8ab0d5263826c9b422648b8ae1a404e800681` |
| Executable CI candidate, including approved dispatch entry points | `f7044814d66faf72a17ec72cb1e1c186ac982262` |
| Approved mechanical-formatting candidate (local; push pending) | `08e579f66ab54152f8d57bcf56ccb7fbe9310a85` |

Official sources: [v1.1.1 security release](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.1.1) and [v1.1.2 security release](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.1.2).

At audit time, `origin/main` was `5312c2b4b4bcb2e7db07cacabcdac8bfddc827fa`, not the official release commit. Relative to 1.1.0 it changes 899 files, including unreleased owner-identity, mandatory server persistence, storage ownership and model-configuration work. Its root version field is still 1.1.1; this field alone is not a release identifier. It is deliberately excluded. The user selected the official-release scope; the merge is pinned to the verified upstream tag rather than moving either `main` or the V2 branch to that broader development tree. ADR-006's isolated sync, compatibility verification and human integration approval gates remain in force. No history is rewritten.

## Merge and preservation evidence

The official release range comprises five commits and 110 changed files. It merged without conflicts. Root `package.json` changes only `version` from 1.1.0 to 1.1.2; the V2 dependency `@node-rs/argon2@2.2.1` remains. `pnpm-lock.yaml` is unchanged. No workspace package changes occur in this release range.

At the release merge and first executable candidate, these were byte-identical to the V2 base: `lib/zhiban/**`, `tests/zhiban/**`, the Identity PG16 workflow, all six applied Identity migrations (0001-0006), and `packages/**`. The subsequently approved 69-file formatting change is documented separately below; it does not preserve TS file bytes but preserves production syntax-tree semantics. The Identity workflow, migrations, package sources and lockfile remain byte-identical. Compared with the target release, the merged upstream `app`, `components`, `lib` and `tests` contain no additional core changes except the pre-existing Zhiban-owned trees. No V1 file is edited and no V1 branch is merged.

The only executable customization added for validation is one `workflow_dispatch` key in each existing `ci.yml` and `storage-pg-contract.yml`, explicitly approved by the user. All jobs and test commands are retained. A PR targeting the newer fork `main` would test a synthetic merge with out-of-scope development changes; direct dispatch instead tests the exact candidate. Manual dispatch does not run the upstream event-specific PR/push version-bump steps, so the unchanged version-check script was separately run against the pinned V2 base and passed. Internal dependency-range validation also passed.

## Security and behavior delta

- MinerU Cloud requests and downloaded results use the strict provider transport, validated/pinned network addresses, HTTPS public result URLs and bounded response/archive processing.
- Caller-selected LLM, PDF, image/video, model-list and voice-list endpoints use validated address-pinned transport and refuse redirects. Provider failure responses exposed to callers use fixed text rather than upstream bodies or connection details.
- Provider-returned media use bounded streaming and public HTTPS validation; supported inline `data:` results decode locally. The same boundary is used by native classroom generation and agent image/video tools.
- Client AliDocMind endpoints are restricted to official HTTPS regional hosts. Provider lookup checks own properties rather than treating inherited property names as operator-managed providers.
- Client provider URLs with queries/fragments or redirect-only URLs are no longer accepted. Configure the final endpoint. Caller-selected private/loopback providers require `ALLOW_LOCAL_NETWORKS`; server-managed providers follow the official operator policy. Pinned requests do not use Node environment proxy routing.

No provider URL or secret-bearing local configuration was copied into the candidate. Future Adapter/deployment tests must cover final URLs, local managed providers, proxy expectations, PDF result bounds and provider error translation. This release does not grant permission to relax SSRF policies to restore old behavior.

## Compatibility boundaries

ADR-013 remains unchanged: native OpenMAIC is a private capability runtime, not the public Zhiban authentication/authorization boundary. Existing native API routes are updated, with zero new route files in this release delta; their presence is not proof of safe public exposure. Provider-transport hardening is not tenant authorization.

ADR-014 remains unchanged: supported package exports are preferred. Because `packages/**` is unchanged, this upgrade neither removes package APIs nor resolves U01 (full Classroom/Playback host) or U02 (isolated Interactive host). ADR-012 remains PROPOSED; no Identity Bridge, Authorization policy/API, Course/Class model, Portal or production cutover is implemented. Capability-specific 0B and production isolation checks remain deferred to their owning phases, not weakened by a green sync CI.

## Validation

Local environment: Windows, Node v24.18.1, pnpm 10.28.0. The managed worktree shares the existing ignored `node_modules` through a directory junction because the release changes no lockfile or dependency. Local runs do not constitute a fresh install or Node 22 proof. Linux CI installs from the candidate's frozen lockfile in its own environment.

| Check | Result |
| --- | --- |
| Local upstream changed-surface tests (39 suites) | First run: 688/690 PASS, two 5-second cold-import timeouts in `extract-document-route`; unchanged suite rerun alone: 34/34 PASS. No test or timeout modification. Not an unconditional full-run PASS. |
| Local Identity serial regression | PASS, 905/905 across 33 files before formatting and again after the formatting/static-matcher follow-up |
| Local lint/typecheck | Interrupted after several minutes without completion on this Windows host; not claimed as local PASS. Both executed and passed in Linux Identity CI. |
| Package version and internal dependency checks | PASS |
| Source preservation and Git diff check | PASS |
| [Upstream CI 37075091465](https://github.com/yhouzxm/OpenMAIC/actions/runs/37075091465) | FAILURE: quality job FAIL on 69 pre-existing Zhiban TS formatting violations only; ESLint (0 errors / 20 warnings), TypeScript and i18n passed. Subsequent root/package tests in that job SKIPPED. E2E (including production build), Render Service, Main image (deps/builder) and Issue Triage jobs PASS. No full upstream CI PASS claim. |
| [Storage PG16 37075094999](https://github.com/yhouzxm/OpenMAIC/actions/runs/37075094999) | SUCCESS: package 1314 passed / 7 skipped; all four mandatory real-PG suites executed (32 + 28 + 8 + 39 cases), suite-collection and 12-table write audit PASS; app-domain PG tests 18/18 PASS. |
| [Zhiban Identity PG16 37075098854](https://github.com/yhouzxm/OpenMAIC/actions/runs/37075098854) | SUCCESS: PG16 121/121 twice; static 28, Domain/contracts 376, Credential 99, Session 50, restored repository regression 352 = 905/905; frozen install, lint and typecheck PASS. PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2), Node v22.23.3 linux/x64; native Argon2id m=32768 t=3 p=1 executed. |

All three runs were newly dispatched with `event=workflow_dispatch` and `headSha=f7044814d66faf72a17ec72cb1e1c186ac982262`; no old-SHA run is used as upgrade evidence. Each real Identity PG16 run contains 10 + 4 + 5 + 8 + 5 + 21 + 35 + 33 = 121 passing tests, and both RUN/PASS markers were verified. SQL/assertion failures must be investigated, not rerun as infrastructure failures.

### Existing formatting gate

The root quality job reports 69 TS files under `lib/zhiban/**` and `tests/zhiban/**`. These are byte-identical to the V2 base and absent from the official release delta. The release therefore did not introduce those formatting differences. This is an existing baseline tooling gap, not a demonstrated Identity/Credential/Session logic regression; nevertheless it prevents subsequent upstream unit/package tests and blocks synchronization signoff. No formatting rule, test command or assertion is weakened to bypass it.

The user explicitly approved a separate mechanical formatting change. Commit `08e579f66ab54152f8d57bcf56ccb7fbe9310a85` formats exactly the 69 files reported by the failed job, with no formatter config or test-threshold changes. A TypeScript compiler-API comparison against `f7044814` confirms equivalent syntax trees after removing redundant expression/type parenthesis wrappers only; node kinds, identifiers, literal/template values, child ordering, operators and variable declaration kinds remain identical. Raw ASTs differ where Prettier adds/removes those parenthesis wrappers, so the claim is normalized AST equivalence, not raw-tree or byte equality. All six migration files remain byte-identical.

Local post-format verification exposed one format-sensitive static regression: `credential-schema.test.ts` counted the text `.count).toBe(0)` three times, but Prettier inserted newlines/trailing argument commas into two of the existing real PUBLIC ACL assertions. The three queries and `toBe(0)` assertions were still present and their ASTs unchanged. The static matcher now accepts whitespace and an optional trailing comma before `)`, while still requiring exactly three zero-count assertions and retaining the table, column and function ACL SQL checks. Its targeted suite passes 6/6. No real ACL assertion, query, test count or threshold is removed. This one regex compatibility adjustment is an intentional test-AST change, not included in the mechanical AST-equivalence claim. Prettier also required a second layout-only pass on `credentials/fakes.ts`; subsequent checks of all 69 paths pass. Final comparison confirms all 29 production TS ASTs equivalent and test ASTs equivalent except that exact documented regex adjustment. The full local regression after the adjustment passes 905/905 across 33 files (151.48 seconds). New-candidate Linux CI is still pending; the earlier green Identity/Storage runs prove only `f7044814`.

The first HTTP/1.1 push of this commit failed with connection reset; the last verified remote sync ref remains `f7044814`. Three dispatches made before push confirmation consequently bound to that old SHA (37076896743, 37076899826, 37076903394); cancellation was requested for all three and none is used as new-candidate evidence. The user allowed one push retry; it failed to connect to GitHub port 443 after 21068 ms. No further retry, force push, SSH fallback or persistent Git config change was performed. The local candidate (including the small test compatibility follow-up) requires a successful push, independently read-back remote SHA, and fresh dispatches. Do not rerun the old formatting-failing SHA to claim closure.

## Final candidate verification and approved V2 integration

The pending push/CI descriptions above are historical. The subsequent candidate `6c08f4dcbd8fd84105c9823d3a5229565d96a85d` was successfully pushed to `sync/openmaic-1.1.2` and independently read back before dispatch. All three new runs used `workflow_dispatch` and that exact head SHA:

| Final candidate gate | Evidence |
| --- | --- |
| [CI 37077902289](https://github.com/yhouzxm/OpenMAIC/actions/runs/37077902289) | SUCCESS; Prettier, lint (0 errors / 20 existing warnings), typecheck and i18n passed; root 9890 passed / 219 skipped; importer 271, DSL 252, generation 199; storage without PG 1137 passed / 184 skipped; production build, E2E 65/65, Render Service and main Docker deps/builder passed. Existing environment-dependent skips are not claimed as passing real-PG tests. |
| [Storage PG16 37077906212](https://github.com/yhouzxm/OpenMAIC/actions/runs/37077906212) | SUCCESS; 1314 passed / 7 skipped; all four mandatory real-PG suites (32 + 28 + 8 + 39) passed; required suite collection and 12-table write audit passed; app-domain PG 18/18 passed. |
| [Identity PG16 37077909383](https://github.com/yhouzxm/OpenMAIC/actions/runs/37077909383) | SUCCESS; PostgreSQL 16.15, Node v22.23.3 linux/x64; all eight suites passed in both complete runs (121/121 each); 905/905 static/Domain/Port/Credential/Session/repository regression; actual native Argon2 execution, lint and typecheck passed. |

After this evidence, the human explicitly approved integration into V2. `refactor/zhiban-v2` was fast-forwarded from `9c99299d6f2a121dbaced4a1c62f5471a75af6b3` to the exact tested candidate `6c08f4dcbd8fd84105c9823d3a5229565d96a85d`, pushed using HTTP/1.1 with command-scoped postBuffer, and the remote ref was read back at the same SHA. The worktree was clean. No additional merge commit, production deployment or business implementation occurred. Root version is 1.1.2; migration 0001–0006, lockfile and workspace package sources remain unchanged from the V2 base.

## Integration gate (final state; supersedes pending markers above)

SYNC_COMPATIBILITY: PASS

HUMAN_SYNC_SIGNOFF: APPROVED

V2_INTEGRATION: COMPLETE

Human approval after complete compatibility evidence was obtained before this integration. Future upgrades require their own exact-candidate verification and human approval. Keep the pinned prior V2 base available. Do not use a Git rollback to undo applied database state; this sync creates no migration. This gate does not close U01/U02, approve ADR-012, expose native OpenMAIC routes, authorize V1 data migration or certify production cutover.
