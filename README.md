# garmin-connect-sdk

[![CI](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml)

Unofficial Node 24+ TypeScript SDK for a user's own Garmin Connect data, including read endpoints
and experimental workout creation/scheduling helpers. Garmin does not publish or support these
private Connect endpoints, so they may change without notice.

This project is not affiliated with, endorsed by, or supported by Garmin. Use it conservatively,
respect rate limits, and keep credentials and tokens private. You are responsible for Garmin's terms
and any laws or policies that apply to your use. Read the [disclaimer](./DISCLAIMER.md) before using
the package.

Workout creation and calendar scheduling are experimental account-mutating methods. Prefer Garmin's
official APIs for supported production integrations.

## Requirements And Install

Use Node `>=24`. The package is ESM-only and supports imports from the package root only.

Alpha releases are published under the `alpha` dist tag:

```bash
npm install garmin-connect-sdk@alpha
pnpm add garmin-connect-sdk@alpha
yarn add garmin-connect-sdk@alpha
```

Release candidates will use the `rc` dist tag:

```bash
npm install garmin-connect-sdk@rc
pnpm add garmin-connect-sdk@rc
yarn add garmin-connect-sdk@rc
```

## First Run

The CLI is the fastest local check after install:

```bash
GARMIN_TOKEN_PATH=./.garmin-tokens pnpm exec garmin-connect profile
GARMIN_TOKEN_PATH=./.garmin-tokens pnpm exec garmin-connect activities --limit 5
```

The CLI restores a saved token session first. If no valid session exists, it prompts for email,
password, and MFA when Garmin asks for it.

## Quickstart

```ts
import { FileTokenStorage, GarminConnectSDK } from 'garmin-connect-sdk';

const garmin = new GarminConnectSDK({
  storage: new FileTokenStorage('./.garmin-tokens'),
});

const restored = await garmin.restoreSession().catch(() => false);

if (!restored) {
  const { GARMIN_EMAIL, GARMIN_PASSWORD, GARMIN_MFA_CODE } = process.env;
  if (!GARMIN_EMAIL || !GARMIN_PASSWORD) throw new Error('Missing Garmin credentials.');

  await garmin.login({
    email: GARMIN_EMAIL,
    password: GARMIN_PASSWORD,
    mfaCode: GARMIN_MFA_CODE,
  });
}

const today = new Date().toISOString().slice(0, 10);
const activities = await garmin.activities.list({ limit: 20 });
const sleep = await garmin.sleep.getDailySleep(today);
const bodyBattery = await garmin.health.getBodyBattery(today);
```

## Session Persistence

`FileTokenStorage` persists access and refresh tokens so applications can call
`restoreSession()` before using password login. It never stores email or password values, but token
files still grant account access and should be protected like credentials. Token files are not
encrypted by the SDK and can include limited session metadata such as display name and client ID
when Garmin returns it.

The SDK prefers `restoreSession()` and token refresh over repeated password login. This reduces
login friction and avoids unnecessary requests to Garmin's SSO endpoints.

`FileTokenStorage` serializes refreshes across SDK instances that point at the same token file and
writes token updates with an atomic rename. Custom `TokenStorage` implementations can provide
`withRefreshLock()` when one token store is shared across SDK instances or processes.

By default `new FileTokenStorage('./.garmin-tokens')` stores tokens in
`./.garmin-tokens/tokens.json`. Call `logout()` to clear stored tokens, or delete the token file when
Garmin revokes a session and `restoreSession()` keeps failing.

## Public API

Import from `garmin-connect-sdk`. The supported surface is `GarminConnectSDK`, token storage
implementations, public errors, endpoint data types, and documented helper functions. Internal auth
and HTTP classes are not exported from the package root, and package subpath imports are unsupported.

Runtime exports:

- `GarminConnectSDK`
- `FileTokenStorage`, `MemoryTokenStorage`
- `GarminAuthError`, `GarminMfaRequiredError`, `GarminRateLimitError`, `GarminRequestError`,
  `GarminSessionExpiredError`, `GarminTimeoutError`, `GarminValidationError`
- `buildWorkoutPayload`, `decodeActivityMetricRow`, `normalizeMetricDescriptors`,
  `summarizeActivityDetails`, `summarizeActivitySplits`, `errorFromResponse`, `parseRetryAfter`

Type exports include endpoint result types, workout builder types, `TokenStorage`,
`GarminConnectSDKOptions`, `LoginOptions`, `GarminTokens`, and `MfaCodeProvider`.

## SDK Options

```ts
const garmin = new GarminConnectSDK({
  storage: new FileTokenStorage('./.garmin-tokens'),
  timeoutMs: 30_000,
  maxRetries: 3,
  logger: console,
  fetch: globalThis.fetch,
});
```

| Option | Use |
| --- | --- |
| `storage` | Persist tokens with `FileTokenStorage`, keep them in memory with `MemoryTokenStorage`, or provide a custom `TokenStorage`. |
| `logger` | Receives SDK logs. Do not log raw Garmin payloads, tokens, cookies, or authorization headers. |
| `fetch` | Inject a custom fetch for tests, proxying, or controlled runtime environments. |
| `retry` / `maxRetries` | Tune retry behavior. `Retry-After` headers are respected when Garmin sends them. |
| `timeoutMs` | Abort HTTP requests that exceed the configured timeout. |
| `mfaCode` / `mfaCodeProvider` | Pass a one-time MFA code or callback to `login()` when Garmin requires MFA. |

For apps or plugins that store sessions for more than one account, isolate token storage per user
and implement `withRefreshLock()` when multiple processes can refresh the same session.

## SDK And CLI Boundary

Use `GarminConnectSDK` as the integration surface for apps and plugins. The CLI is for local smoke
tests and manual inspection, and it covers a smaller set of endpoints than the SDK. There is no
public endpoint-registration hook, public `HttpClient`, or supported authenticated request escape
through package subpaths.

## Endpoints

Only implemented namespaces are listed here.

Read-only endpoints are intended to stay stable through the `1.0.0` release candidate. Workout and
calendar write helpers remain experimental and may change before `v1.0.0`.

- `garmin.activities.count()`
- `garmin.activities.list({ start, limit, activityType, startDate, endDate, sortOrder })`, defaults
  to `start: 0`, `limit: 20`
- `garmin.activities.listAll({ pageSize, maxPages, activityType, startDate, endDate, sortOrder })`,
  defaults to `pageSize: 100`, `maxPages: 10`
- `garmin.activities.download(activityId, format)`, defaults to `tcx`; supported formats are
  `original`, `tcx`, `gpx`, `kml`, and `csv`
- `garmin.activities.get(activityId)`
- `garmin.activities.getDetails(activityId, { maxChartSize, maxPolylineSize })`
- `garmin.activities.getSplits(activityId)`
- `garmin.activities.getTypes()`
- `garmin.sleep.getDailySleep(date)`
- `garmin.sleep.getSleepRange(start, end)`
- `garmin.health.getHeartRate(date)`
- `garmin.health.getStress(date)`
- `garmin.health.getBodyBattery(dateOrRange)`, returns one record or an array for a date range
- `garmin.health.getHrvStatus(date)`
- `garmin.user.getProfile()`
- `garmin.devices.list()`
- `garmin.workouts.list({ start, limit, myWorkoutsOnly })`, defaults to `myWorkoutsOnly: true`
- `garmin.workouts.get(workoutId)`
- `garmin.workouts.getTypes()`
- `garmin.workouts.create({ name, sport, steps })`
- `garmin.workouts.createRaw(payload)`
- `garmin.workouts.schedule({ workoutId, date })`
- `garmin.workouts.unschedule(scheduleId)`
- `garmin.workouts.delete(workoutId)`
- `garmin.calendar.getMonth(year, month)`
- `garmin.calendar.getWeek(date, { start })`
- `garmin.calendar.addWorkout({ workoutId, date })`
- `garmin.calendar.removeWorkout(scheduleId)`

## Experimental Workouts

Workout writes mutate the Garmin account. Keep names identifiable, prefer a test account, schedule
future test dates only, and clean up test schedules/workouts immediately. There is no dry-run mode
or rollback. If cleanup fails, a workout or calendar entry can remain in the account and may sync to
Garmin devices.

```ts
const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const workout = await garmin.workouts.create({
  name: 'SDK Zone 2 Run',
  sport: 'running',
  steps: [
    { type: 'warmup', durationSeconds: 600 },
    { type: 'interval', durationSeconds: 2400, target: { type: 'heart_rate_zone', zone: 2 } },
    { type: 'cooldown', durationSeconds: 300 },
  ],
});

const schedule = await garmin.workouts.schedule({
  workoutId: workout.workoutId,
  date: futureDate,
});

await garmin.workouts.unschedule(schedule.workoutScheduleId ?? schedule.id!);
await garmin.workouts.delete(workout.workoutId);
```

Use `createRaw(payload)` when you already have a Garmin-shaped workout payload from a trusted local
builder. Application-specific mappers should live in the consuming app. Do not log raw workout
payloads from live accounts.

`workouts.schedule()` and `calendar.addWorkout()` call the same Garmin scheduling endpoint.
`workouts.unschedule()` and `calendar.removeWorkout()` remove the same schedule ID.

## Activity Metrics

Garmin activity details expose metric rows as arrays plus descriptors. Use
`summarizeActivityDetails()` or `decodeActivityMetricRow()` to map those rows into keyed objects.
Location metrics are redacted by default. `getDetails()` and `getSplits()` return Garmin payloads
that are intentionally only partly typed; use the summary helpers for sharing or logging.

```ts
import { FileTokenStorage, GarminConnectSDK, summarizeActivityDetails } from 'garmin-connect-sdk';

const garmin = new GarminConnectSDK({
  storage: new FileTokenStorage('./.garmin-tokens'),
});

await garmin.restoreSession();

const [activity] = await garmin.activities.list({ limit: 1 });
const details = await garmin.activities.getDetails(activity.activityId, {
  maxChartSize: 1000,
  maxPolylineSize: 1000,
});

const summary = summarizeActivityDetails(details);
console.log(summary);
```

If you intentionally need latitude/longitude values in a private local process, pass
`{ redactLocation: false }` to `summarizeActivityDetails()` or `decodeActivityMetricRow()`.

## Rate Limits And Privacy

Avoid repeated password logins. Garmin may rate limit, block, or change access patterns. Persist
tokens where appropriate, back off on `GarminRateLimitError`, and do not log credentials, tokens, or
raw health payloads.

Profile, activity, sleep, health, and device payloads can contain sensitive personal data, including
location and health metrics. Examples should summarize data instead of printing full payloads.

## Errors And Troubleshooting

| Error or symptom | Action |
| --- | --- |
| `GarminMfaRequiredError` | Pass `mfaCode` or `mfaCodeProvider` to `login()`. |
| `GarminSessionExpiredError` | Delete the token file or call `logout()`, then log in again. |
| `GarminRateLimitError` | Back off and respect `retryAfterMs` when present. |
| `GarminTimeoutError` | Increase `timeoutMs` or retry later. |
| `GarminValidationError` | Garmin changed a response shape. Open a redacted schema drift issue with `issues`. |
| Repeated auth failures | Check credentials, MFA, account status, and private Garmin endpoint drift. |

## Development

```bash
corepack enable
pnpm install
pnpm test
pnpm coverage
pnpm typecheck
pnpm lint
pnpm build
pnpm package:smoke
```

Unit tests are written in Arrange/Act/Assert style and should cover meaningful behavior, including
edge cases and failure paths. Coverage is enforced at 70% minimum for runtime SDK code.

Manual smoke test after a build:

```bash
pnpm build
pnpm smoke
```

`pnpm package:smoke` packs the package, installs it into a temporary consumer project, verifies the
public runtime exports and type declarations, and checks the installed CLI help command.

The smoke tool restores `GARMIN_TOKEN_PATH` or `./.garmin-tokens` first. If no valid session exists,
it prompts for email, password, and MFA when needed. It prints endpoint summaries only.

Manual CLI checks:

```bash
pnpm build
pnpm garmin -- activities --limit 10
pnpm garmin -- activity --id 123456789
pnpm garmin -- profile
pnpm garmin -- devices
pnpm garmin -- sleep --date 2026-05-12
pnpm garmin -- body-battery --date 2026-05-12
```

The CLI also restores tokens first and prints JSON summaries by default.
The activity command can print raw Garmin payloads with `--raw`; use that only in a private local
terminal and redact output before sharing it.

After installing the package, the same CLI is available through package binaries:

```bash
pnpm exec garmin-connect activities --limit 10
pnpm exec garmin-connect activity --id 123456789 --details
pnpm exec garmin-connect-smoke
```

Integration tests are opt-in and use live Garmin credentials:

```bash
GARMIN_RUN_INTEGRATION=1 \
GARMIN_EMAIL="you@example.com" \
GARMIN_PASSWORD="your-password" \
pnpm test tests/integration/garmin.integration.test.ts
```

If `.garmin-tokens/` already contains a valid session, credentials are not required for the live
test. Set `GARMIN_TOKEN_PATH` to use a different token file or directory. If MFA is enabled during a
fresh login, add `GARMIN_MFA_CODE`. Never commit `.garmin-tokens/` or environment files.

Workout write integration tests are separately gated:

```bash
GARMIN_RUN_INTEGRATION=1 \
GARMIN_RUN_WORKOUT_WRITE=1 \
pnpm test tests/integration/garmin.integration.test.ts
```

This creates temporary running and cycling workouts, schedules them to a future date, checks the
calendar, and then attempts to remove both schedules and workouts.

## Examples

The `examples/` directory is for repository development. It imports local source files and is not
published in the npm package. Consumer examples should import from `garmin-connect-sdk`, not from
`src` or `dist` paths.

## Project Docs

- [Disclaimer](./DISCLAIMER.md)
- [Security policy](./SECURITY.md)
- [Contributing guide](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)
- [Release process](./RELEASE.md)

## Roadmap

- `1.0.0-rc.1`: freeze read-only API surface, keep workout/calendar writes experimental, and require
  package smoke verification in CI.
- `1.0.0`: promote after downstream use confirms no breaking API changes are needed.
- Later: broader Garmin payload schemas and more endpoint namespaces.
