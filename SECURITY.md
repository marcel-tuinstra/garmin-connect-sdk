# Security Policy

This SDK must not log Garmin passwords, access tokens, refresh tokens, authorization headers, or raw
private health payloads.

Store token files in a protected directory. On POSIX systems, `FileTokenStorage` writes with
owner-only permissions where supported. On other platforms, protect the directory with OS-level file
permissions.

Report vulnerabilities privately to the maintainer. Do not include live Garmin credentials or tokens
in reports.
