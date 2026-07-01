# Usage Guide

This guide is the consumer reference for `garmin-connect-sdk`. Keep the README short; put
operational details here.

## Runtime Shape

- Node `>=24`.
- ESM-only.
- Import from `garmin-connect-sdk`.
- Deep package imports are unsupported.
- The bundled CLI is for local smoke checks and manual inspection; applications should use
  `GarminConnectSDK`.

## CLI

Run the installed binary with your package manager. Examples use `pnpm`:

```bash
pnpm exec garmin-connect help
GARMIN_TOKEN_PATH=./.garmin-tokens pnpm exec garmin-connect profile
GARMIN_TOKEN_PATH=./.garmin-tokens pnpm exec garmin-connect activities --limit 5
```

Available commands:

```bash
garmin-connect profile
garmin-connect devices
garmin-connect activities [--limit 10] [--start 0] [--type running]
garmin-connect activity --id <activityId> [--details] [--raw]
garmin-connect sleep [--date YYYY-MM-DD]
garmin-connect body-battery [--date YYYY-MM-DD]
```

The CLI restores `GARMIN_TOKEN_PATH` or `./.garmin-tokens` first. If no valid session
exists, it prompts for email, password, and MFA when needed. It writes JSON summaries by
default. `--raw` can expose health, location, device, workout, and schedule identifiers;
use it only in a private local terminal and redact output before sharing.

## Auth And Session Storage

Use `restoreSession()` before `login()`:

```ts
import { FileTokenStorage, GarminConnectSDK } from 'garmin-connect-sdk';

const garmin = new GarminConnectSDK({
  storage: new FileTokenStorage('./.garmin-tokens'),
});

const restored = await garmin.restoreSession();

if (!restored) {
  await garmin.login({
    email: process.env.GARMIN_EMAIL!,
    password: process.env.GARMIN_PASSWORD!,
    mfaCode: process.env.GARMIN_MFA_CODE,
  });
}
```

`FileTokenStorage('./.garmin-tokens')` stores tokens in `./.garmin-tokens/tokens.json`.
It does not store email or password values, but the token file is a bearer secret and can
include limited session metadata such as display name and client ID. The SDK does not
encrypt token files.

Call `logout()` to clear stored tokens, or delete the token file when Garmin revokes a
session and `restoreSession()` keeps failing.

For apps or plugins:

- Isolate token storage per Garmin account and per application user.
- Protect token directories with OS-level permissions.
- Provide a custom `TokenStorage` when tokens belong in your application's secret store.
- Implement `withRefreshLock()` when multiple processes or SDK instances can refresh the
  same session.

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

| Option                 | Use                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `storage`              | Persist tokens with `FileTokenStorage`, keep them in memory with `MemoryTokenStorage`, or provide a custom `TokenStorage`. |
| `logger`               | Receives SDK logs. Do not log raw Garmin payloads, tokens, cookies, or authorization headers.                              |
| `fetch`                | Inject a custom fetch for tests, proxying, or controlled runtime environments.                                             |
| `retry` / `maxRetries` | Tune retry behavior. `Retry-After` headers are respected when Garmin sends them.                                           |
| `timeoutMs`            | Abort HTTP requests that exceed the configured timeout.                                                                    |

MFA is passed to `login()` with `mfaCode` or `mfaCodeProvider`; it is not a constructor
option.

## Endpoint Map

Only implemented namespaces are listed. Read-only endpoints are intended to stabilize
before `1.0.0`; workout and calendar writes remain experimental.

| Namespace           | Methods                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `garmin.activities` | `count()`, `list()`, `listAll()`, `download()`, `get()`, `getDetails()`, `getSplits()`, `getTypes()` |
| `garmin.sleep`      | `getDailySleep()`, `getSleepRange()`                                                                 |
| `garmin.health`     | `getHeartRate()`, `getStress()`, `getBodyBattery()`, `getHrvStatus()`                                |
| `garmin.user`       | `getProfile()`                                                                                       |
| `garmin.devices`    | `list()`                                                                                             |
| `garmin.workouts`   | `list()`, `get()`, `getTypes()`, `create()`, `createRaw()`, `schedule()`, `unschedule()`, `delete()` |
| `garmin.calendar`   | `getMonth()`, `getWeek()`, `addWorkout()`, `removeWorkout()`                                         |

Type declarations ship with the package and are the best source for request and response
shapes.

## Error Handling

```ts
import {
  GarminBotChallengeError,
  GarminMfaRequiredError,
  GarminRateLimitError,
  GarminSessionExpiredError,
  GarminValidationError,
} from 'garmin-connect-sdk';

try {
  await garmin.activities.list({ limit: 5 });
} catch (error) {
  if (error instanceof GarminRateLimitError) {
    // Back off. retryAfterMs is set when Garmin sends Retry-After.
    throw error;
  }

  if (error instanceof GarminSessionExpiredError) {
    await garmin.logout();
    throw error;
  }

  if (error instanceof GarminMfaRequiredError || error instanceof GarminBotChallengeError) {
    throw error;
  }

  if (error instanceof GarminValidationError) {
    // Garmin may have changed a response shape. Report only minimized, redacted shapes.
    throw error;
  }

  throw error;
}
```

Use public issues only for non-sensitive bugs with minimized redacted shapes. Use private
security reporting for credential, token, health-data, or location-data exposure.

## Activity Details

Garmin activity details expose metric rows as arrays plus descriptors. Use helper functions
to create shareable summaries instead of logging raw payloads:

```ts
import { summarizeActivityDetails } from 'garmin-connect-sdk';

const details = await garmin.activities.getDetails(activityId, {
  maxChartSize: 1000,
  maxPolylineSize: 1000,
});

const summary = summarizeActivityDetails(details);
```

Location metrics are redacted by default. If a private local process intentionally needs
latitude/longitude values, pass `{ redactLocation: false }` to `summarizeActivityDetails()`
or `decodeActivityMetricRow()`.

## Experimental Workout Writes

Workout creation and calendar scheduling mutate the Garmin account. Prefer a test account,
use identifiable names, schedule future test dates only, and clean up immediately. There is
no dry-run mode or rollback. If cleanup fails, workouts or schedules can remain in the
account and may sync to Garmin devices.

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

Use `createRaw(payload)` only when you already have a Garmin-shaped workout payload from a
trusted local builder. Application-specific mappers should live in the consuming app. Do
not log raw workout payloads from live accounts.

## Troubleshooting

| Error or symptom            | Action                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `GarminMfaRequiredError`    | Pass `mfaCode` or `mfaCodeProvider` to `login()`.                                   |
| `GarminBotChallengeError`   | Stop automated retries and complete any required Garmin account challenge manually. |
| `GarminSessionExpiredError` | Delete the token file or call `logout()`, then log in again.                        |
| `GarminRateLimitError`      | Back off and respect `retryAfterMs` when present.                                   |
| `GarminTimeoutError`        | Increase `timeoutMs` or retry later.                                                |
| `GarminValidationError`     | Garmin may have changed a response shape. Share only minimized, redacted shapes.    |
| Repeated auth failures      | Check credentials, MFA, account status, and private Garmin endpoint drift.          |

## Examples

The `examples/` directory is for repository development. It imports local source files and
is not published as consumer sample code. Consumer code should import from
`garmin-connect-sdk`, not from `src` or `dist` paths.
