# Usage Guide

This guide is the consumer reference for `garmin-connect-sdk`. Keep the README short; put
operational details here.

Starting with version `1.1.0`, use is subject to the
[PolyForm Noncommercial License 1.0.0](../LICENSE). Read the
[license summary](../README.md#license) before upgrading from an earlier MIT release.
The SDK license does not grant Garmin access permission; see the [disclaimer](../DISCLAIMER.md).

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

The CLI stops on rate limits, bot challenges, and transient validation failures. It prompts
for credentials only if storage has no session or Garmin has rejected the session.

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

`restoreSession()` returns `false` if storage has no session. For stored tokens, it refreshes
them when needed and makes an authenticated profile request before returning `true`, even
if the access token has not reached its local expiry time. A failed check throws the
corresponding SDK error. Rate limits, network failures, or Garmin service failures do not
prove that the session is invalid; keep the stored tokens and retry the read later.

Call `logout()` to clear stored tokens and the SDK's cached profile. Keep token storage on
a persistent volume for containers so deployments can reuse the session.

For an authenticated `GET` or `HEAD` that Garmin rejects, the SDK attempts one token refresh
and repeats the read once. This also applies to the profile read during `restoreSession()`.
It does not retain your password or call `login()` for this recovery. Concurrent rejected
reads within an SDK instance share the refresh attempt.

The SDK clears the rejected session before recovery. A definitive refresh-token rejection
leaves storage empty. After a temporary refresh failure, it preserves the refresh credential
with an expired access-token timestamp, so the next use must refresh before sending an
authenticated API request. The failed operation returns its error without another recovery
attempt. Bot challenges, ambiguous `403` responses, and rate limits do not trigger this
recovery path. Writes do not get an auth-recovery replay.

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
| `retry` / `maxRetries` | Tune retry behavior for reads and login. Does not enable retries for workout, calendar, or weight writes. `Retry-After` is respected. |
| `timeoutMs`            | Abort HTTP requests that exceed the configured timeout.                                                                    |

Pass MFA to `login()` through `mfaCode`, either as a string or as a function that returns
the code. It is not a constructor option.

### Read Retries And Write Safety

API `GET` and `HEAD` requests use bounded retries for network failures, `429`, and
eligible `5xx` responses. The default is three retries after the initial attempt.
Set `maxRetries: 0` to disable these ordinary retries. The one-time session recovery
described above is separate from this retry budget.
Use a non-negative safe integer for `maxRetries`; invalid values disable retries.
Timeouts are not retried by default. A custom read retry predicate can opt them in.

Workout creation, scheduling, unscheduling, deletion, and weight creation/removal send
each mutation once. Increasing global `maxRetries` or providing `retry.shouldRetry`
does not enable retries for these methods. A lost response does not prove that Garmin
rejected the change; read back the affected data before deciding whether to try again.

There is no public `PUT` operation. Internally, methods other than `GET` and `HEAD`
default to no retries unless an endpoint explicitly supplies a retry count. Existing
write endpoints explicitly disable retries.

## Endpoint Map

Only implemented namespaces are listed. Public package-root methods and exported TypeScript types
follow Semantic Versioning from `1.0.0`. Workout, calendar, and weight writes remain operationally
experimental because Garmin does not support the underlying endpoints.

| Namespace           | Methods                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `garmin.activities` | `count()`, `list()`, `listAll()`, `download()`, `get()`, `getDetails()`, `getSplits()`, `getTypes()` |
| `garmin.sleep`      | `getDailySleep()`, `getSleepRange()`                                                                 |
| `garmin.health`     | `getHeartRate()`, `getStress()`, `getBodyBattery()`, `getHrvStatus()`                                |
| `garmin.weight`     | `getDailyWeighIns()`, `getWeighIns()`, experimental writes: `addWeighIn()`, `removeWeighIn()`        |
| `garmin.user`       | `getProfile()`                                                                                       |
| `garmin.devices`    | `list()`                                                                                             |
| `garmin.workouts`   | `list()`, `get()`, `getTypes()`, `create()`, `createRaw()`, `schedule()`, `unschedule()`, `delete()` |
| `garmin.calendar`   | `getMonth()`, `getWeek()`, `addWorkout()`, `removeWorkout()`                                         |

Type declarations ship with the package and are the best source for request and response
shapes.

## Weight Reads And Experimental Writes

Garmin returns weight and mass fields from its read endpoints in grams. The write method accepts
the value in the explicitly selected `kg` or `lbs` unit. The timestamp must include `Z` or a numeric
offset so historical measurements keep their original local wall-clock time.

```ts
const history = await garmin.weight.getWeighIns('2026-07-11', '2026-07-18');
const day = await garmin.weight.getDailyWeighIns('2026-07-18');

await garmin.weight.addWeighIn({
  value: 75.4,
  unit: 'kg',
  measuredAt: '2026-07-18T14:30:00.000+02:00',
});

const removable = day.dateWeightList.find((entry) => entry.samplePk != null);
if (removable?.samplePk != null) {
  await garmin.weight.removeWeighIn({
    calendarDate: removable.calendarDate,
    samplePk: removable.samplePk,
  });
}
```

`addWeighIn()` adds a manual record; it is not an update or upsert. Garmin permits multiple
weigh-ins per day. `removeWeighIn()` permanently deletes the record identified by its
`calendarDate` and `samplePk`; use both fields from the same GET response. The SDK sends each POST or
DELETE once and disables retries for both. A timeout or transport failure after dispatch has an
unknown outcome: read the day back and reconcile the exact record before taking more action. Do not
log raw weight responses or record identifiers.

## Error Handling

An authenticated API `401` or an explicit rejected-token response maps to
`GarminSessionExpiredError`; eligible reads first get the bounded recovery described above.
A generic `403` does not prove that a token expired: keep the
session and check endpoint permissions or Garmin availability. Identifiable bot or CAPTCHA
challenges raise `GarminBotChallengeError`. Rate limits and service failures retain their
own error classes, even if their response includes auth-related text.

The OAuth distinction between a rejected token and insufficient permissions follows
[RFC 6750, section 3.1](https://www.rfc-editor.org/rfc/rfc6750#section-3.1). Garmin's private
endpoints can depart from that standard; report a minimized response shape if you encounter
an unrecognized failure. The SDK does not include response bodies in classified errors.

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
| `GarminMfaRequiredError`    | Pass a code or code-provider function as `mfaCode` to `login()`.                   |
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
