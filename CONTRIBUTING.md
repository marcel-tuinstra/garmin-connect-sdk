# Contributing

## Local Setup

Use Node `>=24`, Corepack, and the pinned pnpm version from `package.json`.

```bash
node --version
corepack enable
pnpm install --frozen-lockfile
```

Run the same checks CI runs before opening a PR:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm coverage
pnpm build
pnpm package:smoke
```

`pnpm package:smoke` packs the package, installs it into a temporary consumer project, checks the
public exports, and verifies the installed CLI help. It does not publish anything.

Unit tests do not require Garmin credentials. Integration tests are opt-in and require
`GARMIN_RUN_INTEGRATION=1` plus either a valid token session or `GARMIN_EMAIL` and
`GARMIN_PASSWORD`. Use `GARMIN_TOKEN_PATH` to isolate a test session. If Garmin asks for MFA during
fresh login, set `GARMIN_MFA_CODE`.

Workout write integration tests must also set `GARMIN_RUN_WORKOUT_WRITE=1`. They create and delete
real Garmin workouts and calendar schedules.

## Pull Requests

- Keep PRs focused on one concern.
- Include the verification commands you ran.
- Update README, SECURITY, CONTRIBUTING, RELEASE, or CHANGELOG when behavior, public API, package
  contents, privacy expectations, or release process changes.
- Do not publish npm packages, create GitHub releases, create tags, or change release history in a
  contributor PR.
- Do not use `git commit --amend` or force-push in this repository.

## Security And Rate Limits

Do not commit credentials or token files. Keep login retries conservative and prefer persisted token
refresh over repeated password authentication.

Do not commit request/response dumps, cookies, token files, account identifiers, device identifiers,
workout identifiers, calendar identifiers, or unsanitized workout or calendar payloads.

Destructive integration tests must stay opt-in and clearly gated.

Use GitHub private vulnerability reporting for credential, token, health-data, or location-data
exposure. Public issues must use minimized redacted shapes.
