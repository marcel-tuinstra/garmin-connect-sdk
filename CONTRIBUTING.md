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

`pnpm package:smoke` packs the package, installs it into a temporary consumer project,
checks the public exports, verifies blocked deep imports, and runs the installed CLI help.
It does not publish anything.

Unit tests use Arrange/Act/Assert style and should cover meaningful behavior, including
edge cases and failure paths. Coverage is enforced at 70% minimum for runtime SDK code.

## Manual Local Checks

After a build, the repo CLI can exercise a persisted local Garmin session:

```bash
pnpm build
pnpm smoke
pnpm garmin -- activities --limit 10
pnpm garmin -- activity --id <activityId> --details
pnpm garmin -- profile
pnpm garmin -- devices
pnpm garmin -- sleep --date YYYY-MM-DD
pnpm garmin -- body-battery --date YYYY-MM-DD
```

Use a date where the test account has data. The CLI restores `GARMIN_TOKEN_PATH` or
`./.garmin-tokens` first and prints JSON summaries by default. The activity command can
print raw Garmin payloads with `--raw`; use that only in a private local terminal and
redact output before sharing it.

After installing a packed or published package, the same CLI is available through package
binaries:

```bash
pnpm exec garmin-connect activities --limit 10
pnpm exec garmin-connect activity --id <activityId> --details
pnpm exec garmin-connect-smoke
```

The `examples/` directory is for repository development. It imports local source files and
is not published as consumer sample code.

## Live Integration Tests

Integration tests are opt-in and use live Garmin credentials or an existing token session.
Do not paste real credential values into shared terminals, recorded shells, screenshots,
CI logs, or public issue text.

```bash
GARMIN_RUN_INTEGRATION=1 \
GARMIN_EMAIL="<email>" \
GARMIN_PASSWORD="<password>" \
pnpm test tests/integration/garmin.integration.test.ts
```

If `.garmin-tokens/` already contains a valid session, credentials are not required for the
live test. Set `GARMIN_TOKEN_PATH` to isolate a test session. If MFA is enabled during a
fresh login, set `GARMIN_MFA_CODE`.

Workout write integration tests are separately gated:

```bash
GARMIN_RUN_INTEGRATION=1 \
GARMIN_RUN_WORKOUT_WRITE=1 \
pnpm test tests/integration/garmin.integration.test.ts
```

These tests create temporary running and cycling workouts, schedule them to a future date,
check the calendar, and then attempt to remove both schedules and workouts. Run them only
against an account where live workout/calendar mutation is acceptable.

Weight writes use a separate explicit gate and require synthetic or intentionally requested test
values. The test performs a bounded preflight GET, skips an exact daily duplicate, sends at most one
POST per value, and verifies through GET without printing raw health data:

```bash
GARMIN_RUN_INTEGRATION=1 \
GARMIN_RUN_WEIGHT_WRITE=1 \
GARMIN_TEST_CURRENT_WEIGHT_KG=<kg> \
GARMIN_TEST_PREVIOUS_WEIGHT_KG=<kg> \
pnpm test tests/integration/garmin.integration.test.ts
```

Successful requested records remain in the account. Do not enable this gate in shared CI.

Weight removal has its own gate. It creates one temporary synthetic entry, reads its `samplePk`,
deletes that exact entry, and confirms its absence. Choose a value that does not already occur today:

```bash
GARMIN_RUN_INTEGRATION=1 \
GARMIN_RUN_WEIGHT_DELETE=1 \
GARMIN_TEST_DELETE_WEIGHT_KG=<synthetic-kg> \
pnpm test tests/integration/garmin.integration.test.ts
```

The test sends one POST and one DELETE. It does not retry either mutation after an ambiguous result,
and it must stay disabled in shared CI.

## Pull Requests

- Keep PRs focused on one concern.
- Include the verification commands you ran.
- Update README, docs, SECURITY, CONTRIBUTING, or CHANGELOG when behavior, public API, package
  contents, or privacy expectations change.
- Do not publish npm packages, create GitHub releases, create tags, or change release
  history in a contributor PR.
- Do not use `git commit --amend` or force-push in this repository.

## Security And Rate Limits

Do not commit credentials, environment files, token files, cookies, request/response dumps,
account identifiers, device identifiers, workout identifiers, calendar identifiers, or
unsanitized workout/calendar payloads.

Keep login retries conservative and prefer persisted token refresh over repeated password
authentication.

Use GitHub private vulnerability reporting for credential, token, health-data, or
location-data exposure. Public issues must use minimized redacted shapes.
