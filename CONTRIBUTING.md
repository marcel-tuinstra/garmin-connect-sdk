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

Do not commit request/response dumps, cookies, token files, account identifiers, device identifiers,
workout identifiers, calendar identifiers, or unsanitized workout or calendar payloads.

Destructive integration tests must stay opt-in and clearly gated.
