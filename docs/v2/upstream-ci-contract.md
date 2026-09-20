# OpenMAIC Upstream CI Contract

## Scope

This contract is derived from the repository at base commit
`4d2e2bab82374ed45b95964a1f2ed03362666e1c`. Its authoritative inputs are:

- `.github/workflows/ci.yml`
- `package.json`
- `pnpm-workspace.yaml`
- `render-service/package.json`
- `render-service/package-lock.json`

It records what upstream CI actually executes. It is not a proposed local CI
design.

## Execution environment

| Concern | Upstream contract |
|---|---|
| OS | `ubuntu-latest` for all jobs |
| Node | Node 22 via `actions/setup-node` |
| Root engine | `>=22.19.0` |
| Root package manager | pnpm `10.28.0` declared by `packageManager`; installed by `pnpm/action-setup` |
| Render service package manager | npm using its own `package-lock.json` |
| Root workspace | `packages/*` and `packages/@openmaic/*`, excluding `packages/docs` |
| Render service workspace status | Independent npm package; deliberately outside the root pnpm workspace |

The supported CI parity target is therefore Ubuntu plus Node 22. A Windows
Node 24 run is useful diagnostic evidence, but it is not equivalent to the
official gate.

## Root check job

The `check` job runs on Ubuntu with a 15-minute job timeout. Its effective
contract is:

1. Check out full Git history.
2. Run the Bash parallel-runner self-test.
3. Set up pnpm and Node 22.
4. Run package-version checks when applicable to the Git event.
5. Run `node scripts/check-internal-dependency-ranges.mjs`.
6. Run `pnpm install --frozen-lockfile`.
7. Run `pnpm check:node-engine`.
8. Verify installation did not move `HEAD` or rewrite tracked files under
   `packages/@openmaic`.
9. Run the following independent checks through the CI Bash parallel helper:
   - `pnpm check`
   - `pnpm lint`
   - `npx tsc --noEmit`
   - `pnpm check:i18n-keys`
10. Run `pnpm test` sequentially.
11. Run `pnpm --filter @openmaic/importer test`.
12. Run `pnpm --filter @openmaic/dsl test`.
13. Run `pnpm --filter @openmaic/generation run typecheck`.
14. Run `pnpm --filter @openmaic/generation test`.
15. Run the generation Node-consumer smoke test through a temporary local
    server and Bash process lifecycle wrapper.
16. Run `pnpm --filter @openmaic/storage run typecheck`.
17. Run `pnpm --filter @openmaic/storage test`.

The workflow explicitly keeps root Vitest and storage package tests
sequential. Its comment records that running them together on a four-core
runner caused five-second tests to flake from CPU contention.

## Root TypeScript boundary

The official root TypeScript command is exactly:

```text
npx tsc --noEmit
```

`render-service` is not part of that root TypeScript result. Its dependencies,
typecheck and tests are handled by a separate job.

Additional package typecheck scripts exist for DSL, Renderer and Editor. They
are useful local checks, but only Generation and Storage package typechecks are
explicit steps in this upstream workflow.

## Render service job

The `render-service` job runs on Ubuntu and Node 22 with a 10-minute job
timeout. It sets `PUPPETEER_SKIP_DOWNLOAD=true` for the whole job and executes:

```text
cd render-service
npm ci
npm run typecheck
npm test
cd ..
docker build --tag openmaic-render-service:ci render-service
```

The browser download is intentionally skipped because the unit tests validate
service boundaries without launching Chromium. Docker image creation remains a
separate required CI step.

## E2E and build job

The `e2e` job is a separate Ubuntu/Node 22 job. It installs the root workspace,
installs Playwright Chromium, runs browser guardrail tests, materializes and
lints HyperFrames samples, and runs:

```text
pnpm build
pnpm exec playwright test
```

The build enables the MAIC editor, Pi chat and courseware-reference public
feature flags. A local root unit-test result does not cover this browser job.

## Local Phase 0B parity limits

The Phase 0B host has Node `v24.18.1`, no installed Node 22 manager/runtime, no
configured WSL distribution and no Docker CLI. Therefore:

- the Windows checks are diagnostic, not an official-CI replacement;
- the Bash parallel-runner self-test and Bash-managed generation smoke are not
  supported in the current shell;
- the render-service Docker build is not run and is not counted as a source
  failure;
- Ubuntu/Node 22 remains required to resolve Node- and platform-sensitive test
  results.

