# Security Policy

This SDK must not log Garmin passwords, access tokens, refresh tokens, authorization headers, or raw
private health payloads.

Store token files in a protected directory. On POSIX systems, `FileTokenStorage` writes with
owner-only permissions where supported. On other platforms, protect the directory with OS-level file
permissions.

When sharing bug reports, redact Garmin profile data, activity IDs, device IDs, email addresses,
locations, authorization headers, cookies, token files, and raw health/activity payloads. Prefer
minimal reproduction steps and sanitized response shapes.

## Private Payloads

Do not commit request/response dumps, cookies, account identifiers, workout identifiers, calendar
identifiers, or unsanitized workout/calendar payloads. Use redacted shapes and field names in
examples.

Report vulnerabilities privately to the maintainer. Do not include live Garmin credentials or tokens
in reports.
