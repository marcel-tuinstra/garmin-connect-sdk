# garmin-connect-sdk

[![CI](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml)

Unofficial Node 24+ TypeScript SDK for a user's own Garmin Connect data, including read endpoints
and experimental workout creation/scheduling helpers. Garmin does not publish or support these
private Connect endpoints, so they may change without notice.

This project is not affiliated with, endorsed by, or supported by Garmin. Use it conservatively,
respect rate limits, and keep credentials and tokens private.

Workout creation and calendar scheduling are experimental account-mutating methods. Prefer Garmin's
official APIs for supported production integrations.

## Install

Alpha releases are published under the `alpha` dist tag:

```bash
pnpm add garmin-connect-sdk@alpha
```

Release candidates will use the `rc` dist tag:

```bash
pnpm add garmin-connect-sdk@rc
```

## Quickstart

```ts
import { FileTokenStorage, GarminConnectSDK } from 'garmin-connect-sdk';

const garmin = new GarminConnectSDK({
  storage: new FileTokenStorage('./.garmin-tokens'),
});

if (!(await garmin.restoreSession())) {
  await garmin.login({
    email: process.env.GARMIN_EMAIL!,
    password: process.env.GARMIN_PASSWORD!,
  });
}

const activities = await garmin.activities.list({ limit: 20 });
const sleep = await garmin.sleep.getDailySleep('2026-05-12');
const bodyBattery = await garmin.health.getBodyBattery('2026-05-12');
```

## Session Persistence

`FileTokenStorage` persists access and refresh tokens so applications can call
`restoreSession()` before using password login. It never stores email or password values, but token
files still grant account access and should be protected like credentials.

The SDK prefers `restoreSession()` and token refresh over repeated password login. This reduces
login friction and avoids unnecessary requests to Garmin's SSO endpoints.

## Endpoints

Only implemented namespaces are listed here.

Read-only endpoints are release-candidate stable. Workout and calendar write helpers are still
experimental and may change before `v1.0.0`.

- `garmin.activities.list({ start, limit, activityType })`
- `garmin.activities.listAll({ pageSize, maxPages, activityType })`
- `garmin.activities.get(activityId)`
- `garmin.activities.getDetails(activityId)`
- `garmin.activities.getSplits(activityId)`
- `garmin.sleep.getDailySleep(date)`
- `garmin.sleep.getSleepRange(start, end)`
- `garmin.health.getHeartRate(date)`
- `garmin.health.getStress(date)`
- `garmin.health.getBodyBattery(dateOrRange)`
- `garmin.health.getHrvStatus(date)`
- `garmin.user.getProfile()`
- `garmin.devices.list()`
- `garmin.workouts.list({ start, limit, myWorkoutsOnly })`
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
future test dates only, and clean up test schedules/workouts immediately.

```ts
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
  date: '2026-06-15',
});

await garmin.workouts.unschedule(schedule.workoutScheduleId ?? schedule.id!);
await garmin.workouts.delete(workout.workoutId);
```

Use `createRaw(payload)` when you already have a Garmin-shaped workout payload from a trusted local
builder. Application-specific mappers should live in the consuming app. Do not log raw workout
payloads from live accounts.

## Activity Metrics

Garmin activity details expose metric rows as arrays plus descriptors. Use
`summarizeActivityDetails()` or `decodeActivityMetricRow()` to map those rows into keyed objects.
Location metrics are redacted by default.

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

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm package:smoke
```

Manual smoke test after a build:

```bash
pnpm build
pnpm smoke
```

`pnpm package:smoke` packs the package, installs it into a temporary consumer project, verifies the
public runtime exports and type declarations, and checks the installed CLI help command.

The smoke tool restores `GARMIN_TOKEN_PATH` or `./.garmin-tokens` first. If no valid session exists,
it prompts for email, password, and MFA when needed. It prints endpoint summaries only, not raw
profile, activity, sleep, health, or device payloads.

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

The CLI also restores tokens first and prints JSON summaries only.

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

## Roadmap

- `1.0.0-rc.1`: freeze read-only API surface, keep workout/calendar writes experimental, and require
  package smoke verification in CI.
- `1.0.0`: promote after downstream use confirms no breaking API changes are needed.
- Later: broader Garmin payload schemas and more endpoint namespaces.
