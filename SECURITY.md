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

## Adoption Metrics

Maintainer adoption measurements never run inside the SDK. They collect sanitized npm, GitHub
traffic, public-repository signals, and thresholded voluntary-registration aggregates through a
separate scheduled workflow. Package installation, import, SDK construction, authentication, and
normal runtime behavior make no adoption request. Do not add postinstall hooks, background or
recurring requests, device identifiers, account identifiers, or implicit runtime telemetry.

Private or unindexed consumers can deliberately run `garmin-connect-adoption share`. The command
shows the fixed HTTPS destination and exact payload, then asks for confirmation with a default of
no. It never reads a repository, Git remote, manifest, lockfile, source file, path, Garmin session,
credential, profile, device, or health data. A local random management capability controls status,
renewal, and withdrawal; it is saved before the first request so an ambiguous response can be retried
without orphaning the registration. Keep that file private and out of source control. A withdrawal
deletes the active intake row, keeps only keyed hashes in a 24-hour replay-prevention tombstone, and
cannot erase already published rounded, thresholded historical aggregates. Encrypted operator
backups expire within 30 days and may retain the deleted row until then.

The intake stores keyed hashes instead of the client registration ID or management token. It keeps
only SDK version, coarse private/unindexed visibility, consent version, timestamps, and expiry.
Registrations expire after 90 days without deliberate renewal. Logs must not retain request bodies,
authorization headers, raw IP addresses, user agents, registration IDs, or management capabilities.
The aggregate endpoint suppresses non-zero cohorts below five and rounds released counts down to a
multiple of five.

The public repository index must not contain profiles, names, email addresses, contributors, commit
authors, source snippets, private repositories, Garmin data, traffic referrers, or visited paths.
Report an incorrect entry or request an opt out through private vulnerability reporting. The
[operations guide](https://github.com/marcel-tuinstra/garmin-connect-sdk/blob/main/docs/operations/adoption-measurement.md)
documents consent, the exact data fields, source credentials, retention, withdrawal, recovery, and
limitations.
