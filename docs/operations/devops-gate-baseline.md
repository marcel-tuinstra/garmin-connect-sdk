# Devops Gate Baseline

This repo already has a focused Node CI workflow. Baseline devops work should strengthen the existing package checks without adding network-facing Garmin calls to default automation.

## Current gate surface

- `.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
- CI uses Node 24, Corepack, pnpm, typecheck, lint, unit tests, coverage, build, and package smoke validation.
- `package.json` exposes the same cheap local checks through `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm coverage`, `pnpm build`, and `pnpm package:smoke`.
- Live Garmin smoke commands exist, but they require user credentials and must remain opt-in.

## Baseline readiness checklist

- Keep default CI credential-free and fixture-based.
- Do not add scheduled live endpoint tests unless rate-limit, credential, and terms-of-use risks are explicitly accepted.
- Treat package smoke validation as the release-readiness boundary for exported files and CLI entries.
- If dependency automation is enabled later, route major dependency changes through the existing CI matrix and review changes that touch auth, HTTP, schema parsing, or packaging.
- Keep destructive or write-capable integration tests behind explicit manual gates.

## Deferred integration points

- A Renovate configuration can be added later with grouping for TypeScript, Vitest, Vite, tsup, ESLint, and pnpm lockfile maintenance.
- A shared devops gate should reuse the existing CI job rather than adding a second package workflow.
- Keep release automation maintainer-controlled; generic dependency or CI changes must never publish.

## Cheap local verification

For a documentation-only baseline change:

```sh
git diff --check
```

For package or workflow changes:

```sh
pnpm typecheck
pnpm test
pnpm package:smoke
```
