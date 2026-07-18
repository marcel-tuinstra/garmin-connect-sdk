# Security Policy

This SDK must not log Garmin passwords, access tokens, refresh tokens, authorization headers, or raw
private health payloads, including weight history and body-composition responses.

This package uses unofficial Garmin Connect endpoints. Garmin can change, rate limit, block, or add
account checks to those endpoints without notice. Use this package only with accounts and data you
are allowed to access.

Store token files in a protected directory. On POSIX systems, `FileTokenStorage` writes with
owner-only permissions where supported. On other platforms, protect the directory with OS-level file
permissions. Token files are not encrypted by the SDK and can grant account access until Garmin
expires or revokes them.

Treat `.garmin-tokens/tokens.json` as a bearer secret. It may also contain limited session metadata
such as display name and client ID. Apps and plugins should isolate token storage per Garmin account
and per application user, and should use a dedicated secret store when filesystem tokens are not
appropriate.

Do not paste real `GARMIN_EMAIL`, `GARMIN_PASSWORD`, or `GARMIN_MFA_CODE` values into shared
terminals, recorded shells, screenshots, CI logs, public issues, or shell history.

When sharing bug reports, redact Garmin profile data, activity IDs, device IDs, email addresses,
locations, authorization headers, cookies, token files, and raw health/activity payloads. Prefer
minimal reproduction steps and sanitized response shapes.

## Reporting Security Issues

Report vulnerabilities privately through GitHub private vulnerability reporting:

https://github.com/marcel-tuinstra/garmin-connect-sdk/security/advisories/new

Use private reporting for credential exposure, token exposure, auth bypass, accidental logging of
private Garmin payloads, health data exposure, or location data exposure. Do not open a public issue
for those reports.

Public issues are fine for non-sensitive bugs when the report uses redacted payload shapes and no
live account data.

Manual weight creation is non-idempotent, and removal permanently deletes health history. The SDK
sends each POST or DELETE once. Reconcile an ambiguous result through a bounded read, and do not
publish values, timestamps, `samplePk` identifiers, or raw responses as test evidence.

## Private Payloads

Do not commit request/response dumps, cookies, account identifiers, weigh-in identifiers, workout
identifiers, calendar identifiers, or unsanitized health/workout/calendar payloads. Use redacted
shapes and field names in examples.

CLI `--raw` output can expose health, location, device, workout, and schedule identifiers. Use it
only in a private local terminal and redact it before sharing.
