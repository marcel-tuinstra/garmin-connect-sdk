## 1. Goal

Bouw v0.1 van `garmin-connect-sdk`: een Node 20+ TypeScript SDK die Garmin Connect authenticatie, sessieherstel, activities, sleep, health/body battery, user profile en devices ondersteunt met veilige logging, Zod-validatie en tests.

## 2. Approach

De repo bevat momenteel geen bronbestanden of package-configuratie, dus de implementatie start met een volledige maar kleine TypeScript package scaffold. De SDK volgt de domein-gebaseerde API uit de opdracht (`garmin.activities.list()`, `garmin.sleep.getDailySleep()`, `garmin.health.getBodyBattery()`) en baseert endpoint-paden en auth-concepten op `cyberjunky/python-garminconnect`, maar kopieert geen Python-code. Auth wordt geïsoleerd in `src/auth/AuthService.ts` zodat de gevoelige mobile SSO/DI OAuth-flow, token refresh en storage contracten los staan van endpoint- en HTTP-code.

## 3. File Changes

- **Create** `package.json` - package metadata, `type: module`, export map voor `dist/index.js` en `dist/index.d.ts`, scripts voor `build`, `test`, `lint`, `format`, dependencies (`zod`) en devDependencies (`typescript`, `vitest`, `tsup`, `eslint`, `prettier`, `dotenv`, `@types/node`).
- **Create** `pnpm-lock.yaml` - lockfile na `pnpm install`.
- **Create** `tsconfig.json` - strict TypeScript config voor Node 20, ESM, declaration output en Vitest-compatible module resolution.
- **Create** `tsup.config.ts` - ESM build vanaf `src/index.ts` naar `dist/` met `.d.ts` generation.
- **Create** `eslint.config.js` - flat ESLint config voor TypeScript-bron, tests en examples.
- **Create** `.prettierrc` - consistente formatting.
- **Create** `.gitignore` - negeer `node_modules`, `dist`, coverage, env files en lokale Garmin tokenbestanden.
- **Create** `vitest.config.ts` - unit tests standaard aan, integration tests alleen opt-in via env.
- **Create** `src/index.ts` - publieke exports: `GarminConnectSDK`, storage classes, auth/types, endpoint result types en custom errors.
- **Create** `src/client/GarminConnectSDK.ts` - hoofdklasse die `AuthService`, `HttpClient` en endpoint namespaces initialiseert; expose `login()`, `restoreSession()`, `logout()` en properties `activities`, `sleep`, `health`, `user`, `devices`.
- **Create** `src/client/HttpClient.ts` - fetch wrapper voor Garmin Connect API calls met base URLs, auth header injection, automatic refresh-before-request, JSON parsing, response validation hook, retry/backoff voor 5xx/network/429 volgens configuratie.
- **Create** `src/client/GarminRequestError.ts` - custom error hierarchy: `GarminRequestError`, `GarminAuthError`, `GarminRateLimitError`, `GarminSessionExpiredError`, `GarminMfaRequiredError`, `GarminValidationError`, allemaal met `statusCode`, `endpoint`, `cause`.
- **Create** `src/auth/types.ts` - types voor `GarminTokens`, `LoginOptions`, `GarminConnectSDKOptions`, `MfaCodeProvider`, token expiry metadata en auth responses.
- **Create** `src/auth/TokenStorage.ts` - interface met `load()`, `save(tokens)`, `clear()`.
- **Create** `src/auth/MemoryTokenStorage.ts` - in-memory storage voor tests en ephemeral usage.
- **Create** `src/auth/FileTokenStorage.ts` - JSON token persistence in directory of file path, directory creation, `0600` file permissions waar ondersteund, geen password persistence.
- **Create** `src/auth/AuthService.ts` - native Garmin mobile SSO login orchestration, MFA callback support, DI OAuth token exchange/refresh, token restoration from storage, logout/clear; login retries bewust beperkt en geen credentials logging.
- **Create** `src/endpoints/ActivitiesEndpoint.ts` - `list({ start, limit, activityType })`, `get(activityId)`, `getDetails(activityId, options)`, `getSplits(activityId)` met Garmin paden `/activitylist-service/activities/search/activities`, `/activity-service/activity/{id}`, `/details`, `/typedsplits`.
- **Create** `src/endpoints/SleepEndpoint.ts` - `getDailySleep(date)` en `getSleepRange(start, end)`; daily endpoint gebruikt `/wellness-service/wellness/dailySleepData/{displayName}` met `date` en `nonSleepBufferMinutes=60`; range splitst veilig per dag als Garmin geen range-route accepteert.
- **Create** `src/endpoints/HealthEndpoint.ts` - `getHeartRate(date)`, `getStress(date)`, `getBodyBattery(date | range)`, `getHrvStatus(date)` met paden `/wellness-service/wellness/dailyHeartRate/{displayName}`, `/wellness-service/wellness/dailyStress/{date}`, `/wellness-service/wellness/bodyBattery/reports/daily`, `/hrv-service/hrv/{date}`.
- **Create** `src/endpoints/UserEndpoint.ts` - `getProfile()` via `/userprofile-service/socialProfile` en cached profile/displayName support voor endpoints die displayName nodig hebben.
- **Create** `src/endpoints/DevicesEndpoint.ts` - `list()` via `/device-service/deviceregistration/devices`.
- **Create** `src/schemas/activity.schema.ts` - Zod schemas voor activity summary list, activity detail wrapper en split payload met permissieve `.passthrough()` voor Garmin shape drift.
- **Create** `src/schemas/sleep.schema.ts` - Zod schemas voor daily sleep payload en sleep range array.
- **Create** `src/schemas/health.schema.ts` - Zod schemas voor heart rate, stress, body battery en HRV/status payloads.
- **Create** `src/schemas/user.schema.ts` - Zod schemas voor social profile and devices.
- **Create** `src/types/activity.ts` - exported inferred/static activity types.
- **Create** `src/types/sleep.ts` - exported sleep types.
- **Create** `src/types/health.ts` - exported health types.
- **Create** `src/types/user.ts` - exported user/device profile types.
- **Create** `src/utils/dates.ts` - date formatting helpers (`YYYY-MM-DD`), range validation and date iteration.
- **Create** `src/utils/retry.ts` - exponential backoff with jitter, `RetryOptions`, `sleep(ms)`, `isRetryableStatus()`; respects `Retry-After` for 429.
- **Create** `src/utils/logger.ts` - small redacting logger abstraction; default no-op except warnings/errors, never logs credentials/tokens/full payloads.
- **Create** `examples/basic.ts` - dotenv example matching requested quickstart with `FileTokenStorage`, activities, sleep, body battery.
- **Create** `examples/sync-last-30-days.ts` - iterates dates and fetches activities/sleep/health without storing passwords.
- **Create** `tests/unit/token-storage.test.ts` - memory and file token storage behavior, clear, no password fields.
- **Create** `tests/unit/retry.test.ts` - retry/backoff attempts, jitter bounds via injected timer/random, `Retry-After` handling.
- **Create** `tests/unit/errors.test.ts` - HTTP status to custom error mapping for 401, 429, expired session and validation errors.
- **Create** `tests/unit/dates.test.ts` - date formatting and invalid/range cases.
- **Create** `tests/unit/endpoints.test.ts` - URL/path/query building for activities, sleep, body battery, user, devices using mocked `HttpClient`.
- **Create** `tests/unit/schemas.test.ts` - Zod parsing for representative Garmin-like payloads and validation failure redaction.
- **Create** `tests/integration/garmin.integration.test.ts` - skipped unless `GARMIN_EMAIL` and `GARMIN_PASSWORD` are set and an explicit integration flag such as `GARMIN_RUN_INTEGRATION=1` is present.
- **Create** `README.md` - disclaimer, install, quickstart, session persistence, activities, sleep/health, rate-limit warning, privacy/security notes, roadmap.
- **Create** `LICENSE` - MIT license.
- **Create** `CONTRIBUTING.md` - local setup, test/build commands, security/rate-limit expectations.
- **Create** `SECURITY.md` - credential/token handling, vulnerability reporting, no credential logging policy.

## 4. Implementation Steps

### Task 1: Package Scaffold

1. Create `package.json`, `tsconfig.json`, `tsup.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, and `vitest.config.ts` with ESM-first Node 20 settings.
2. Install dependencies with `pnpm install` to create `pnpm-lock.yaml`.
3. Ensure `package.json` has `exports` pointing to `./dist/index.js` and `types` pointing to `./dist/index.d.ts` so `import { GarminConnectSDK } from 'garmin-connect-sdk'` resolves after build.

### Task 2: Error, Utility, and Type Foundations

1. Implement `src/client/GarminRequestError.ts` with the full custom error hierarchy and consistent constructor options `{ message, statusCode, endpoint, cause }`.
2. Implement `src/utils/dates.ts` with `formatDate(date: Date | string): string`, validation for `YYYY-MM-DD`, and `eachDate(start, end)` used by sleep range.
3. Implement `src/utils/retry.ts` with configurable max retries defaulting to `3`, exponential backoff, bounded jitter, `Retry-After` parsing, and a `shouldRetry` policy that retries network/5xx/429 but not auth/client validation errors.
4. Implement `src/utils/logger.ts` with redaction helpers for `password`, `access_token`, `refresh_token`, `Authorization`, and payload summaries only.

### Task 3: Token Storage

1. Define `src/auth/TokenStorage.ts` and `src/auth/types.ts` for token metadata, SDK options and login options.
2. Implement `src/auth/MemoryTokenStorage.ts` for unit-test-friendly persistence.
3. Implement `src/auth/FileTokenStorage.ts` so `new FileTokenStorage('./.garmin-tokens')` stores a JSON token file under that directory, creates the directory if needed, writes with owner-only permissions where possible, and never stores Garmin passwords.

### Task 4: Auth Service

1. Implement `src/auth/AuthService.ts` with `restoreSession()`, `login({ email, password, mfaCode })`, `refreshIfNeeded()`, `refresh()`, `logout()` and token save/load integration.
2. Model the Garmin native mobile SSO flow from the current Python reference: login against `sso.garmin.com/mobile/api/login`, handle MFA challenge with `mfaCode`, exchange service ticket for DI OAuth bearer tokens via `diauth.garmin.com`, and store access/refresh token expiry metadata.
3. Map auth failures: invalid credentials to `GarminAuthError`, MFA challenge without callback to `GarminMfaRequiredError`, 429 to `GarminRateLimitError`, expired/revoked refresh token to `GarminSessionExpiredError`, and 5xx/unavailable to `GarminRequestError` with Garmin unavailable wording.
4. Do not retry login aggressively: at most one non-credential retry for transient network/5xx if configured, and never retry 401/403/429 login responses.

### Task 5: HTTP Client

1. Implement `src/client/HttpClient.ts` around native `fetch` with Garmin Connect base URL `https://connect.garmin.com` and JSON request/response helpers.
2. Before each API request, call `AuthService.refreshIfNeeded()`; attach `Authorization: Bearer <access_token>` plus conservative Garmin-compatible headers.
3. Convert HTTP failures to custom errors in `src/client/GarminRequestError.ts`: 401/403 to session/auth errors, 429 to rate-limit with `Retry-After`, 5xx to request/unavailable errors.
4. Validate responses through a provided Zod schema; on mismatch throw `GarminValidationError` with endpoint and Zod field paths, not full payload contents.

### Task 6: Endpoint Namespaces

1. Implement `src/endpoints/UserEndpoint.ts` first because `displayName` is required by sleep and heart-rate endpoints; cache profile data in `GarminConnectSDK.ts` or `AuthService.ts` after login/restore.
2. Implement `src/endpoints/ActivitiesEndpoint.ts` with query building for `start`, `limit`, optional `activityType`, and detail/split paths.
3. Implement `src/endpoints/SleepEndpoint.ts` using the profile displayName and date helpers; implement range by iterating daily calls unless a known range endpoint is confirmed during implementation.
4. Implement `src/endpoints/HealthEndpoint.ts` for heart rate, stress, body battery and HRV/status with date/range query parameters matching the Python reference endpoints.
5. Implement `src/endpoints/DevicesEndpoint.ts` with `list()`.
6. Implement `src/client/GarminConnectSDK.ts` to compose all endpoints and expose `login`, `restoreSession`, `logout`, and config options including `maxRetries` default `3`.

### Task 7: Schemas and Public Types

1. Implement `src/schemas/activity.schema.ts`, `src/schemas/sleep.schema.ts`, `src/schemas/health.schema.ts`, and `src/schemas/user.schema.ts` with strict required identifiers/dates and `.passthrough()` for unknown Garmin fields.
2. Implement `src/types/activity.ts`, `src/types/sleep.ts`, `src/types/health.ts`, `src/types/user.ts` from Zod inference where possible.
3. Export all public types and classes from `src/index.ts`.

### Task 8: Examples and Documentation

1. Implement `examples/basic.ts` with `dotenv/config`, `FileTokenStorage`, `login`, activities list, daily sleep and body battery.
2. Implement `examples/sync-last-30-days.ts` with safe date iteration and no password/token logging.
3. Write `README.md` with the unofficial SDK disclaimer, installation, quickstart, auth/session persistence, endpoint examples, rate-limit warning, privacy/security notes and roadmap.
4. Add `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md`.

### Task 9: Tests

1. Add `tests/unit/token-storage.test.ts` for `MemoryTokenStorage` and `FileTokenStorage`.
2. Add `tests/unit/retry.test.ts` for backoff, retry count, 429 `Retry-After` and non-retryable auth failures.
3. Add `tests/unit/errors.test.ts` for custom error mapping.
4. Add `tests/unit/dates.test.ts` for date formatting and invalid input.
5. Add `tests/unit/endpoints.test.ts` with mocked `HttpClient` to assert path and query construction for activities, sleep, body battery, user and devices.
6. Add `tests/unit/schemas.test.ts` with representative Garmin-like payloads and validation failures.
7. Add `tests/integration/garmin.integration.test.ts` guarded by env vars so CI/default `pnpm test` skips it.

### Task 10: Verification

1. Run `pnpm install`.
2. Run `pnpm test` and fix unit failures.
3. Run `pnpm build` and verify `dist/index.js` and `dist/index.d.ts` exist.
4. Run TypeScript compilation for examples or include examples in `tsconfig` checking so `examples/basic.ts` compiles.
5. Optionally run integration tests only with explicit env vars and user-provided credentials.

## 5. Acceptance Criteria

- `pnpm install` completes and produces `pnpm-lock.yaml`.
- `pnpm test` passes without requiring Garmin credentials.
- `pnpm build` produces `dist/index.js` and `dist/index.d.ts`.
- `src/index.ts` exports `GarminConnectSDK` and the storage/error classes.
- `examples/basic.ts` type-checks and uses `new GarminConnectSDK({ storage: new FileTokenStorage('./.garmin-tokens') })`.
- `FileTokenStorage` saves and restores access/refresh token data and never persists `email` or `password`.
- `GarminConnectSDK.restoreSession()` loads persisted tokens and can prepare authenticated requests without calling password login.
- `GarminConnectSDK.logout()` clears stored tokens.
- `garmin.activities.list({ limit: 20 })` builds `/activitylist-service/activities/search/activities?start=0&limit=20`.
- `garmin.activities.get(activityId)`, `getDetails(activityId)`, and `getSplits(activityId)` build the expected `/activity-service/activity/{id}` paths.
- `garmin.sleep.getDailySleep(date)` uses the daily sleep endpoint and includes `nonSleepBufferMinutes=60`.
- `garmin.health.getBodyBattery(date)` uses `/wellness-service/wellness/bodyBattery/reports/daily` with `startDate` and `endDate`.
- HTTP 429 responses throw `GarminRateLimitError` and respect `Retry-After` when retrying non-login calls.
- HTTP 401/403 after an API request throw `GarminSessionExpiredError` or `GarminAuthError` as appropriate.
- Zod validation failures throw `GarminValidationError` containing endpoint and field paths, not full response payloads.
- Integration tests are skipped unless `GARMIN_RUN_INTEGRATION=1`, `GARMIN_EMAIL`, and `GARMIN_PASSWORD` are set.
- `README.md` clearly states this is an unofficial Garmin Connect SDK and warns about rate limits, credential handling and token privacy.

## 6. Verification Steps

- Run `pnpm install`.
- Run `pnpm test`.
- Run `pnpm build`.
- Run `pnpm lint` if configured in the script set.
- Confirm `dist/index.js` and `dist/index.d.ts` exist after build.
- Confirm `node --input-type=module -e "import('./dist/index.js').then(m => console.log(Boolean(m.GarminConnectSDK)))"` prints `true`.
- Confirm unit tests cover endpoint URL building for activities list/get/details/splits, sleep daily, heart rate, stress, body battery, user profile and devices.
- Manually inspect `.garmin-tokens` output from a mocked/local storage test to verify no password or email fields are written.
- Optional integration verification: run `GARMIN_RUN_INTEGRATION=1 GARMIN_EMAIL=... GARMIN_PASSWORD=... pnpm test tests/integration/garmin.integration.test.ts` outside CI, with MFA supplied only through callback/env during the run.

## 7. Risks & Mitigations

- **Garmin auth flow drift:** The mobile SSO/DI OAuth flow may change. Keep auth isolated in `src/auth/AuthService.ts`, document it as unofficial, and make integration tests opt-in so maintainers can validate against live Garmin only when intended.
- **Cloudflare or login rate limiting:** Native Node `fetch` may not bypass all Garmin login protections that Python handles with `curl_cffi`. Mitigate by avoiding aggressive login retries, surfacing `GarminRateLimitError`, supporting token persistence/refresh so users rarely hit login, and documenting the limitation clearly.
- **Response shape changes:** Garmin payloads vary by account/device. Use Zod schemas with required core fields plus `.passthrough()`, and report validation field paths without dumping private payloads.
- **Display name dependency:** Some endpoints require Garmin `displayName`. Fetch and cache `/userprofile-service/socialProfile` after login/restore; throw a clear `GarminAuthError` if profile data lacks a usable display name.
- **Token file permissions on Windows:** POSIX `0600` is not portable. Implement best-effort permissions and document that users should protect the token directory on their OS.