# Contributing

## Local Setup

```bash
pnpm install
pnpm test
pnpm build
pnpm lint
```

Integration tests are opt-in and require `GARMIN_RUN_INTEGRATION=1`, `GARMIN_EMAIL`, and
`GARMIN_PASSWORD`.

## Security And Rate Limits

Do not commit credentials or token files. Keep login retries conservative and prefer persisted token
refresh over repeated password authentication.
