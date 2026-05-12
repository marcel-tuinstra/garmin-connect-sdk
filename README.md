# garmin-connect-sdk

Unofficial Node 20+ TypeScript SDK for Garmin Connect. Garmin does not publish or support these
private Connect endpoints, so they may change without notice.

## Install

```bash
pnpm add garmin-connect-sdk
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

## Endpoints

- `garmin.activities.list({ start, limit, activityType })`
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

## Rate Limits And Privacy

Avoid repeated password logins. Garmin may rate limit, block, or change access patterns. Persist
tokens where appropriate, back off on `GarminRateLimitError`, and do not log credentials, tokens, or
raw health payloads.

## Roadmap

- Broader Garmin payload schemas.
- More endpoint namespaces.
- Live integration validation when maintainers opt in with test credentials.
