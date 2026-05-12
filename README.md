# garmin-connect-sdk

[![CI](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml)

Unofficial Node 24+ TypeScript SDK for reading a user's own Garmin Connect data. Garmin does not
publish or support these private Connect endpoints, so they may change without notice.

This project is not affiliated with, endorsed by, or supported by Garmin. Use it conservatively,
respect rate limits, and keep credentials and tokens private.

## Install

Alpha releases are published under the `alpha` dist tag:

```bash
pnpm add garmin-connect-sdk@alpha
```

Until the npm alpha has been published, install directly from the GitHub tag:

```bash
pnpm add github:marcel-tuinstra/garmin-connect-sdk#v1.0.0-alpha.1
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
```

Manual smoke test after a build:

```bash
pnpm build
pnpm smoke
```

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

## Roadmap

- Broader Garmin payload schemas.
- More endpoint namespaces.
- Live integration validation when maintainers opt in with test credentials.
- Read-only workout data helpers for downstream analysis tools.
