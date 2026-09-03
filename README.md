# garmin-connect-sdk

[![CI](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/marcel-tuinstra/garmin-connect-sdk/actions/workflows/ci.yml)

Unofficial Node 24+ TypeScript SDK for accessing your own Garmin Connect data, with
a small CLI for quick local verification.

Garmin does not publish or support the private Connect endpoints used by this package.
They can change, rate limit, block, or disappear without notice. This project is not
affiliated with, endorsed by, or supported by Garmin. Read the
[disclaimer](./DISCLAIMER.md) before using it.

Read APIs are the primary use case. Workout creation, calendar scheduling, and weight mutations are
experimental account-mutating helpers without dry-run or rollback support.

[![Current project Board](https://tracker.tuinstra.dev/api/public/organizations/tuinstra-dev/projects/garmin-connect-sdk/scope.svg)](https://tracker.tuinstra.dev/p/tuinstra-dev/garmin-connect-sdk)

## Install

Version `1.1.0` introduces a license change. Read [License](#license) before upgrading.

The package is ESM-only, requires Node `>=24`, and supports imports from
`garmin-connect-sdk` only.

Install the stable release:

```bash
npm install garmin-connect-sdk
pnpm add garmin-connect-sdk
yarn add garmin-connect-sdk
```

The `alpha` and `rc` dist tags are reserved for consumers who explicitly opt into prereleases.

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

| Area             | Status                      | Examples                                                            |
| ---------------- | --------------------------- | ------------------------------------------------------------------- |
| Activities       | Read-oriented               | List, download, details, splits, type metadata                      |
| Sleep and health | Read-oriented               | Daily sleep, sleep ranges, heart rate, stress, HRV, Body Battery    |
| Weight           | Reads + experimental writes | Daily/range weigh-ins plus manual creation and removal              |
| User and devices | Read-oriented               | Profile and registered devices                                      |
| Workouts         | Experimental writes         | List, create, schedule, unschedule, delete                          |
| Calendar         | Experimental writes         | Month/week views and workout schedule changes                       |
| CLI              | Local verification          | Profile, devices, activities, activity details, sleep, Body Battery |

The package root is the supported public surface. Deep imports such as
`garmin-connect-sdk/src/...`, `garmin-connect-sdk/dist/...`, or internal auth/client paths
are unsupported.

## Safety Boundaries

- Keep Garmin credentials, MFA codes, token files, cookies, and authorization headers private.
- Do not log or paste raw health, location, activity, device, workout, or calendar payloads.
- Isolate token storage per user/account in apps or plugins.
- Back off on rate limits and expect private endpoint drift.
- Treat workout/calendar/weight writes and write integration tests as live account changes. Weight
  writes mutate health history; workout and calendar changes may also sync to Garmin devices.
- Treat `weight.addWeighIn()` as non-idempotent: repeated calls can create duplicate health records.
  The SDK does not retry this write automatically; reconcile an ambiguous outcome with a weight GET.
- `weight.removeWeighIn()` permanently removes the selected record. The SDK sends the DELETE once;
  read the same day back after an ambiguous outcome instead of retrying blindly.

See [Security](./SECURITY.md) for reporting and redaction guidance.

## More Docs

- [Usage guide](./docs/usage.md): CLI, auth/session storage, SDK options, endpoint map,
  errors, activity helpers, and experimental writes.
- [Security policy](./SECURITY.md): sensitive data handling and private vulnerability reports.
- [Disclaimer](./DISCLAIMER.md): unofficial/private endpoint and legal-use boundaries.
- [Contributing](./CONTRIBUTING.md): local setup, tests, package smoke checks, and PR expectations.
- [Changelog](./CHANGELOG.md): release history.

## Status

Version `1.0.0` defines the supported package-root API. Read methods and exported TypeScript
signatures follow Semantic Versioning. Workout, calendar, and weight mutations remain operationally
experimental because they use unsupported Garmin endpoints, but their public method signatures also
follow Semantic Versioning.

## License

Starting with version `1.1.0`, this SDK uses the
[PolyForm Noncommercial License 1.0.0](./LICENSE). It is source-available software,
not OSI-approved open source. The license permits noncommercial purposes and specifies
permitted personal uses and categories of noncommercial organizations.

Commercial use outside those permitted purposes is not licensed. A free app or demo
is not automatically noncommercial; the license qualifies personal uses as having no
anticipated commercial application. Read the full terms before using or distributing the SDK.

Previously published releases through `1.0.0` remain available under their original MIT
terms, including the commercial-use rights they granted. The new terms do not revoke those
rights. Dependencies retain their own licenses and notices.

The SDK license does not grant permission to access Garmin systems. See the
[disclaimer](./DISCLAIMER.md) for Garmin access and account risks.
