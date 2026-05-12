# Changelog

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
