# Security Policy

This SDK must not log Garmin passwords, access tokens, refresh tokens, authorization headers, or raw
private health payloads.

This package uses unofficial Garmin Connect endpoints. Garmin can change, rate limit, block, or add
account checks to those endpoints without notice. Use this package only with accounts and data you
are allowed to access.

Store token files in a protected directory. On POSIX systems, `FileTokenStorage` writes with
owner-only permissions where supported. On other platforms, protect the directory with OS-level file
permissions. Token files are not encrypted by the SDK and can grant account access until Garmin
expires or revokes them.

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

## Private Payloads

Do not commit request/response dumps, cookies, account identifiers, workout identifiers, calendar
identifiers, or unsanitized workout/calendar payloads. Use redacted shapes and field names in
examples.
