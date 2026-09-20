# Devops Gate Baseline

This repo already has a focused Node CI workflow. Baseline devops work should strengthen the existing package checks without adding network-facing Garmin calls to default automation.

## Current gate surface

- `.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
- CI uses Node 24, Corepack, pnpm, typecheck, lint, unit tests, coverage, build, and package smoke validation.
- Third-party GitHub Actions are pinned to reviewed full commit SHAs. Their release tags remain
  in comments for update review, and checkout credentials are discarded after fetch.
- `pnpm audit:dependencies` audits the committed `pnpm-lock.yaml`, including development tooling.
  The blocking threshold is `high`, so high and critical findings fail CI.
- `package.json` exposes the same cheap local checks through `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm coverage`, `pnpm build`, and `pnpm package:smoke`.
- Live Garmin smoke commands exist, but they require user credentials and must remain opt-in.

## Baseline readiness checklist

- Keep default CI credential-free and fixture-based.
- Keep workflow permissions at `contents: read` unless a narrowly scoped job documents why it
  needs more. Never persist checkout credentials in the default test job.
- Review the source and release notes behind an Action commit before changing a pinned SHA; the
  tag comment is context, not the security boundary.
- Treat a dependency-audit registry or authentication failure as a failed gate, never as zero
  vulnerabilities. Retry the workflow only after confirming the registry is healthy.
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
pnpm audit:dependencies
pnpm test
pnpm package:smoke
```

The audit command requires npm-registry access. It is lockfile-aware and intentionally checks
both runtime and development dependencies because build and test tooling are part of the package
supply chain. Findings below `high` remain visible in the audit output but do not block this gate.
