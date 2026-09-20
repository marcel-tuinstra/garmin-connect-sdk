# Usage Guide

This guide covers authentication, endpoint usage, error handling, and safe writes with
`garmin-connect-sdk`.

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

| Option                 | Use                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`              | Persist tokens with `FileTokenStorage`, keep them in memory with `MemoryTokenStorage`, or provide a custom `TokenStorage`.            |
| `logger`               | Receives SDK logs. Do not log raw Garmin payloads, tokens, cookies, or authorization headers.                                         |
| `fetch`                | Inject a custom fetch for tests, proxying, or controlled runtime environments.                                                        |
| `retry` / `maxRetries` | Tune retry behavior for reads and login. Does not enable retries for workout, calendar, or weight writes. `Retry-After` is respected. |
| `timeoutMs`            | Abort HTTP requests that exceed the configured timeout.                                                                               |

Pass MFA to `login()` through `mfaCode`, either as a string or as a function that returns
the code. It is not a constructor option.

### Read Retries And Write Safety

API `GET` and `HEAD` requests use bounded retries for network failures, `429`, and
eligible `5xx` responses. The default is three retries after the initial attempt.
Set `maxRetries: 0` to disable these ordinary retries. The one-time session recovery
described above is separate from this retry budget.
Use a non-negative safe integer for `maxRetries`; invalid values disable retries.
Timeouts are not retried by default. A custom read retry predicate can opt them in.

Workout creation, replacement, scheduling, unscheduling, deletion, and weight creation/removal send
each mutation once. Increasing global `maxRetries` or providing `retry.shouldRetry`
does not enable retries for these methods. A lost response does not prove that Garmin
rejected the change; read back the affected data before deciding whether to try again.

`workouts.update()` and `workouts.updateRaw()` use `PUT` as a full replacement. They never fetch or
merge the stored workout first. Internally, methods other than `GET` and `HEAD` default to no retries
unless an endpoint explicitly supplies a retry count. Existing write endpoints explicitly disable
retries.

## Endpoint Map

Only implemented namespaces are listed. Public package-root methods and exported TypeScript types
follow Semantic Versioning from `1.0.0`. Workout, calendar, and weight writes remain operationally
experimental because Garmin does not support the underlying endpoints.

| Namespace           | Methods                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `garmin.activities` | `count()`, `list()`, `listAll()`, `download()`, `get()`, `getDetails()`, `getSplits()`, `getTypes()`                            |
| `garmin.sleep`      | `getDailySleep()`, `getSleepRange()`                                                                                            |
| `garmin.health`     | `getHeartRate()`, `getStress()`, `getBodyBattery()`, `getHrvStatus()`                                                           |
| `garmin.weight`     | `getDailyWeighIns()`, `getWeighIns()`, experimental writes: `addWeighIn()`, `removeWeighIn()`                                   |
| `garmin.user`       | `getProfile()`                                                                                                                  |
| `garmin.devices`    | `list()`                                                                                                                        |
| `garmin.workouts`   | `list()`, `get()`, `getTypes()`, `create()`, `createRaw()`, `update()`, `updateRaw()`, `schedule()`, `unschedule()`, `delete()` |
| `garmin.calendar`   | `getMonth()`, `getWeek()`, `addWorkout()`, `removeWorkout()`                                                                    |

Type declarations ship with the package and are the best source for request and response
shapes.

## Sleep Timestamp Representations

Garmin may return `sleepStartTimestampLocal` and `sleepEndTimestampLocal` as timestamp strings,
finite epoch-millisecond numbers, `null`, or omit them. The SDK returns these values unchanged. It
does not parse them, convert them to `Date`, or apply a timezone offset.

Garmin's `*Local` values can contain an unexpected upstream timezone offset. Do not assume that an
epoch-shaped number identifies the correct UTC instant. When instant accuracy matters, use the
corresponding Garmin GMT data when present and convert it with an IANA timezone selected by the
caller.

`getSleepRange()` sends one daily-sleep request per date, with no more than four requests in flight
for one range call. It returns results in date order. The first observed daily-request failure
rejects the range without a partial result. Requests already in flight may finish, but the SDK does
not start queued dates after that failure.

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

// Call only after the user selects a specific record from a fresh daily GET.
async function removeSelectedWeighIn(selected: (typeof day.dateWeightList)[number]) {
  if (selected.samplePk == null) {
    throw new Error('The selected record has no removal identifier.');
  }
  await garmin.weight.removeWeighIn({
    calendarDate: selected.calendarDate,
    samplePk: selected.samplePk,
  });
}
```

`addWeighIn()` adds a manual record; it is not an update or upsert. Garmin permits multiple
weigh-ins per day. `removeWeighIn()` permanently deletes the record identified by its
`calendarDate` and `samplePk`; use both fields from the same GET response. The SDK sends each POST or
DELETE once and disables retries for both. A timeout or transport failure after dispatch has an
unknown outcome: read the day back and reconcile the exact record before taking more action. Do not
log raw weight responses or record identifiers.
See [reconciling uncertain writes](#reconciling-uncertain-writes) before repeating a mutation.

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
an unrecognized failure. A plain HTTP `404` maps to `GarminNotFoundError`, unless stronger
authentication or challenge evidence is present. The SDK does not include response bodies in
classified errors.

```ts
import {
  GarminBotChallengeError,
  GarminMfaRequiredError,
  GarminNotFoundError,
  GarminRateLimitError,
  GarminSessionExpiredError,
  GarminValidationError,
} from 'garmin-connect-sdk';

try {
  await garmin.activities.list({ limit: 5 });
} catch (error) {
  if (error instanceof GarminNotFoundError) {
    // The requested Garmin resource is absent. The error exposes only sanitized diagnostics.
    throw error;
  }

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

Garmin activity details expose metric rows as arrays plus descriptors. Decode those rows by their
descriptors instead of assuming fixed column positions. Keep duration fields such as `duration`,
`elapsedDuration`, and `movingDuration` separate; the SDK does not pick a canonical duration.

This example reads one named heart-rate sample without logging the complete activity payload:

```ts
import { decodeActivityMetricRows, summarizeActivityDetails } from 'garmin-connect-sdk';

const details = await garmin.activities.getDetails(activityId, {
  maxChartSize: 1000,
  maxPolylineSize: 1000,
});

const metricRows = decodeActivityMetricRows(details);
const firstHeartRateSample = metricRows.find((row) => typeof row.heartRate === 'number')?.heartRate;
const heartRateSampleCount = metricRows.filter((row) => typeof row.heartRate === 'number').length;
const summary = summarizeActivityDetails(details);

console.log({
  firstHeartRateSampleAvailable: firstHeartRateSample !== undefined,
  heartRateSampleCount,
  metricRows: summary.metricRows,
});
```

`decodeActivityMetricRows()` supports both payload-level and per-row descriptors, which allows
channel order to change between rows. Missing samples become `null`; malformed rows are skipped.
Location-like metrics are redacted by default. If a private local process intentionally needs
latitude/longitude values, pass `{ redactLocation: false }` to `decodeActivityMetricRows()`,
`summarizeActivityDetails()`, or `decodeActivityMetricRow()`.

## Experimental Workout Writes

Workout creation, replacement, and calendar scheduling mutate the Garmin account. Prefer a test account,
use identifiable names, schedule future test dates only, and clean up immediately. There is
no dry-run mode or rollback. If cleanup fails, workouts or schedules can remain in the
account and may sync to Garmin devices.

```ts
const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const workoutName = `SDK Zone 2 Run ${crypto.randomUUID()}`;

const workout = await garmin.workouts.create({
  name: workoutName,
  sport: 'running',
  steps: [
    { type: 'warmup', durationSeconds: 600 },
    { type: 'interval', durationSeconds: 2400, target: { type: 'heart_rate_zone', zone: 2 } },
    { type: 'cooldown', durationSeconds: 300 },
  ],
});

const updatedWorkout = await garmin.workouts.update(workout.workoutId, {
  name: `${workoutName} updated`,
  sport: 'running',
  steps: [
    { type: 'warmup', durationSeconds: 600 },
    { type: 'interval', durationSeconds: 1800, target: { type: 'heart_rate_zone', zone: 2 } },
    { type: 'cooldown', durationSeconds: 300 },
  ],
});

const schedule = await garmin.workouts.schedule({
  workoutId: workout.workoutId,
  date: futureDate,
});

const scheduleId = schedule.workoutScheduleId ?? schedule.scheduleId ?? schedule.id;
if (scheduleId == null) {
  throw new Error('Read the calendar to identify the schedule before removing it.');
}

// Explicit cleanup of the records returned above; never guess identifiers.
await garmin.workouts.unschedule(scheduleId);
await garmin.workouts.delete(workout.workoutId);
```

Use `createRaw(payload)` or `updateRaw(workoutId, payload)` only when you already have a
Garmin-shaped workout payload from a trusted local builder. An update replaces the complete workout;
omitted fields are not preserved by an implicit merge. Application-specific mappers should live in
the consuming app. Do not log raw workout payloads from live accounts or assume that
`updatedWorkout` is available after an interrupted response.

Every failed `await` stops this example. Do not wrap the entire sequence in a retry loop:
an earlier step may already have succeeded. Store returned identifiers privately before
starting the next step. Cleanup can also fail and needs the same read-back checks.

## Reconciling Uncertain Writes

A timeout, lost connection, or unusable success response can occur after Garmin applies
a change. The SDK returns that failure without repeating the mutation. Stop the write
sequence and inspect the same account through a read endpoint:

Keep the intended name/marker, date, and relevant input in private application state
before dispatch. That gives you something to compare if the response never arrives.

| Uncertain operation                                  | Read back before taking further action                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workouts.create()` / `createRaw()`                  | Page through `workouts.list({ start, limit, myWorkoutsOnly: true })` for the unique name or marker used in the request. For a candidate, use `workouts.get(workoutId)` to compare its details. The default list contains only 20 records; one page is not an exhaustive search.                                    |
| `workouts.update()` / `updateRaw()`                  | Call `workouts.get(workoutId)` and compare the complete stored definition with the intended replacement. A timeout or connection failure may occur after Garmin applies the `PUT`; do not repeat it until the read establishes whether another replacement is needed.                                              |
| `workouts.schedule()` / `calendar.addWorkout()`      | Use `calendar.getWeek(date)` or `getMonth(year, month)` for the requested date. Match the date and workout ID and identify the actual schedule. Multiple entries for the same workout may be legitimate.                                                                                                           |
| `workouts.unschedule()` / `calendar.removeWorkout()` | Read the relevant week/month and check whether the exact schedule is still present. A schedule identifier is not the workout identifier; never substitute one for the other.                                                                                                                                       |
| `workouts.delete()`                                  | Call `workouts.get(workoutId)` for the known ID. A `GarminNotFoundError` is evidence of absence, not proof that this delete succeeded; endpoint drift or authorization can obscure the result. A successful read means it remains. Resolve uncertainty with another read or manual inspection, not another delete. |
| `weight.addWeighIn()`                                | Use `weight.getDailyWeighIns(day)` or `getWeighIns(start, end)` around the measurement's calendar date. Compare the timestamp and mass with the submitted measurement; reads express mass in grams, not the input `kg`/`lbs` unit. Multiple weigh-ins per day are supported.                                       |
| `weight.removeWeighIn()`                             | Read the same day again and look for the exact `samplePk` and `calendarDate` pair from the original GET. Do not remove another entry with a similar weight or substitute `version` for `samplePk`.                                                                                                                 |

For calendar reads, `getMonth()` accepts months 1–12. Missing calendar fields, a partial
list, or a failed read are not proof that a mutation failed. An empty result immediately
after a write may also be inconclusive. Keep the outcome unresolved and inspect again
later, respecting rate limits; do not turn uncertainty into another write.

If there is no reliable match or more than one candidate, ask the user to check Garmin
Connect. Do not automatically create duplicates, delete possible matches, or reconcile
across accounts. Read-back results and identifiers belong in private application state,
not logs or public bug reports. Logging an outcome such as `needsReview: true` is enough.

## Troubleshooting

| Error or symptom            | Action                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `GarminMfaRequiredError`    | Pass a code or code-provider function as `mfaCode` to `login()`.                        |
| `GarminBotChallengeError`   | Stop automated retries and complete any required Garmin account challenge manually.     |
| `GarminNotFoundError`       | Treat the requested resource as absent; verify its identifier when that is unexpected.  |
| `GarminSessionExpiredError` | Delete the token file or call `logout()`, then log in again.                            |
| `GarminRateLimitError`      | Back off and respect `retryAfterMs` when present.                                       |
| `GarminTimeoutError`        | For reads, review the timeout and retry later. For writes, reconcile the outcome first. |
| `GarminValidationError`     | Garmin may have changed a response shape. Share only minimized, redacted shapes.        |
| Repeated auth failures      | Check credentials, MFA, account status, and private Garmin endpoint drift.              |

## Examples

The `examples/` directory is for repository development. It imports local source files and
is not published as consumer sample code. Consumer code should import from
`garmin-connect-sdk`, not from `src` or `dist` paths.
