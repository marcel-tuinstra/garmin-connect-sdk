# garmin-connect-sdk

[![CI](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml)

Unofficial Node 24+ TypeScript SDK for accessing your own Garmin Connect data, with
a small CLI for quick local verification.

Garmin does not publish or support the private Connect endpoints used by this package.
They can change, rate limit, block, or disappear without notice. This project is not
affiliated with, endorsed by, or supported by Garmin. Read the
[disclaimer](./DISCLAIMER.md) before using it.

Read APIs are the primary use case. Workout creation and calendar scheduling are
experimental account-mutating helpers without dry-run or rollback support.

## Install

The package is ESM-only, requires Node `>=24`, and supports imports from
`garmin-connect-sdk` only.

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

## First Check

After install, run the package binary with your package manager. Shown with `pnpm`:

```bash
GARMIN_TOKEN_PATH=./.garmin-tokens pnpm exec garmin-connect profile
GARMIN_TOKEN_PATH=./.garmin-tokens pnpm exec garmin-connect activities --limit 5
```

The CLI restores `GARMIN_TOKEN_PATH` or `./.garmin-tokens` first. If no valid session
exists, it prompts for email, password, and MFA when Garmin asks for it. CLI output is
summary-first by default; `--raw` is only for private local debugging.

## SDK Quickstart

```ts
import { FileTokenStorage, GarminConnectSDK } from 'garmin-connect-sdk';

const garmin = new GarminConnectSDK({
  storage: new FileTokenStorage('./.garmin-tokens'),
});

if (!(await garmin.restoreSession())) {
  const { GARMIN_EMAIL, GARMIN_PASSWORD, GARMIN_MFA_CODE } = process.env;
  if (!GARMIN_EMAIL || !GARMIN_PASSWORD) throw new Error('Missing Garmin credentials.');

  await garmin.login({
    email: GARMIN_EMAIL,
    password: GARMIN_PASSWORD,
    mfaCode: GARMIN_MFA_CODE,
  });
}

const profile = await garmin.user.getProfile();
const activities = await garmin.activities.list({ limit: 5 });

console.log({
  displayName: profile.displayName,
  activities: activities.length,
});
```

Prefer `restoreSession()` and token refresh over repeated password login. `FileTokenStorage`
stores tokens, not email or password values, but token files still grant account access
and should be protected like credentials.

## Included Surface

| Area             | Status              | Examples                                                            |
| ---------------- | ------------------- | ------------------------------------------------------------------- |
| Activities       | Read-oriented       | List, download, details, splits, type metadata                      |
| Sleep and health | Read-oriented       | Daily sleep, sleep ranges, heart rate, stress, HRV, Body Battery    |
| User and devices | Read-oriented       | Profile and registered devices                                      |
| Workouts         | Experimental writes | List, create, schedule, unschedule, delete                          |
| Calendar         | Experimental writes | Month/week views and workout schedule changes                       |
| CLI              | Local verification  | Profile, devices, activities, activity details, sleep, Body Battery |

The package root is the supported public surface. Deep imports such as
`garmin-connect-sdk/src/...`, `garmin-connect-sdk/dist/...`, or internal auth/client paths
are unsupported.

## Safety Boundaries

- Keep Garmin credentials, MFA codes, token files, cookies, and authorization headers private.
- Do not log or paste raw health, location, activity, device, workout, or calendar payloads.
- Isolate token storage per user/account in apps or plugins.
- Back off on rate limits and expect private endpoint drift.
- Treat workout/calendar writes and write integration tests as live account changes that may
  sync to Garmin devices.

See [Security](./SECURITY.md) for reporting and redaction guidance.

## More Docs

- [Usage guide](./docs/usage.md): CLI, auth/session storage, SDK options, endpoint map,
  errors, activity helpers, and experimental writes.
- [Security policy](./SECURITY.md): sensitive data handling and private vulnerability reports.
- [Disclaimer](./DISCLAIMER.md): unofficial/private endpoint and legal-use boundaries.
- [Contributing](./CONTRIBUTING.md): local setup, tests, package smoke checks, and PR expectations.
- [Changelog](./CHANGELOG.md): release history.

## Status

Current releases are alpha builds on the path to `1.0.0-rc.1`. Read-only APIs are intended
to stabilize first; workout and calendar write helpers remain experimental until explicitly
promoted.
