# Changelog

## 1.0.0-alpha.4

Release-candidate hardening release focused on sport/activity review support, CLI safety, and
documentation clarity.

### Highlights

- Added privacy-safe activity heart-rate shape summaries for downstream review features.
- Added sport-focused activity detail/split helpers and read endpoint hardening.
- Fixed activity detail summaries to count heart-rate samples exposed through metric rows, not only
  `heartRateDTO` tuple arrays.
- Masked the interactive CLI password prompt and added CLI prompt regression coverage.
- Improved documentation structure, package smoke coverage, and devops gate guidance.
- Hardened Garmin login error classification for bot challenges, CAPTCHA, and auth drift.

## 1.0.0-alpha.3

Release-candidate hardening release focused on test quality, package verification, and read-only API
stability.

### Highlights

- Added package smoke verification for packed-package install, runtime exports, declarations, and
  CLI help.
- Added enforced runtime SDK coverage thresholds and expanded edge-case coverage for auth, HTTP,
  endpoints, token storage, dates, workout payloads, logging, and SDK composition.
- Added shared test helpers for Garmin-like responses, token fixtures, JWT fixtures, and fetch-call
  inspection.
- Documented the `1.0.0-rc.1` readiness checklist and release process.
- Clarified that read-only endpoints are release-candidate stable while workout/calendar writes stay
  experimental.
- Fixed duplicated SSO cookie forwarding during MFA verification in Node.

## 1.0.0-alpha.2

Adds experimental Garmin Connect workout creation and calendar scheduling support.

### Highlights

- Experimental workouts namespace for listing, reading, creating, scheduling, unscheduling, and
  deleting workouts.
- Experimental calendar namespace for month/week reads and workout schedule add/remove helpers.
- High-level running/cycling workout payload builder with repeat-group support.
- Raw Garmin-shaped workout creation escape hatch for trusted local builders.
- Tolerant workout schemas, unit coverage, and opt-in destructive live integration coverage.
- Sleep schema tolerance for live Garmin responses where `sleepLevels` can be `null`.

### Notes

Workout writes mutate a Garmin account. Keep this experimental, prefer a test account for validation,
and keep app-specific mapping in the consuming application.

## 1.0.0-alpha.1

Initial alpha release of `garmin-connect-sdk`, an unofficial Node 24+ TypeScript SDK for reading a
user's own Garmin Connect data.

### Install

```bash
pnpm add garmin-connect-sdk@alpha
```

Until the npm alpha has been published, install directly from the GitHub tag:

```bash
pnpm add github:marcel-tuinstra/garmin-connect-sdk#v1.0.0-alpha.1
```

### Highlights

- Node 24+ ESM TypeScript SDK scaffold.
- Garmin Connect mobile SSO login, token refresh, session restore, and logout.
- Memory and file token storage.
- Read-only endpoints for profile, devices, activities, sleep, heart rate, stress, body battery, and HRV.
- Zod validation with Garmin drift tolerance.
- Retry, timeout, and safe logging foundations.
- Activity metric descriptor decoding helpers.
- Unit tests, opt-in live integration tests, and GitHub Actions CI.
- Manual CLI and smoke-test tooling for local verification.

### Manual Testing

```bash
pnpm build
pnpm smoke
pnpm garmin -- activities --limit 10
pnpm garmin -- activity --id <activityId> --details
```

### Notes

This project is unofficial and not affiliated with Garmin. Treat Garmin tokens and returned
activity, health, location, device, and profile data as private. Avoid repeated password logins;
prefer session restore and token refresh.
