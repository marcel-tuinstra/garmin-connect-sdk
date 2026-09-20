# Adoption intake service

This service accepts deliberately submitted, pseudonymous private/unindexed adoption registrations.
It is not part of the npm package. The public protocol and privacy boundaries are documented in
[`docs/operations/adoption-measurement.md`](../../docs/operations/adoption-measurement.md).

## Runtime

- Node 24 or the included container image
- a private persistent volume mounted at `/data`
- HTTPS termination at `adoption.tuinstra.dev`
- a Linux host-network deployment with a reverse proxy on the same host; the service binds to
  `127.0.0.1` by default

Generate independent random values for the registration pepper and aggregate token. Put them in two
owner-readable secret files outside this checkout and point `ADOPTION_REGISTRATION_PEPPER_FILE` and
`ADOPTION_AGGREGATE_TOKEN_FILE` at those paths when invoking Compose. Compose mounts the values as
files instead of putting them in container environment metadata. Never place them in Git, shell
history, container dumps, logs, or workflow artifacts. The aggregate token is copied only to the
GitHub `adoption-opt-in-aggregate` environment as `ADOPTION_AGGREGATE_TOKEN`.

```bash
docker compose -f compose.example.yml up -d --build
curl --fail --head http://127.0.0.1:8787/health
```

The example uses host networking so the loopback reverse proxy is recognized as trusted without
trusting Docker bridge addresses. The reverse proxy must overwrite `X-Forwarded-For` with the
connecting address and must not write request headers, bodies, query strings, user agents, or client
addresses to access or tracing logs. Do not expose port 8787 publicly. Add TLS and proxy-level
request/body/rate limits as defense in depth; the application also caps bodies and stores only a
keyed address hash for the current hourly rate-limit window.

The service authenticates aggregate reads before rate limiting or expiry maintenance. Other
recognized requests must pass their protocol metadata and credential shape before maintenance.
Expiry cleanup runs at most once every five minutes, and its rate-limit-window lookup is indexed.

Back up the private SQLite volume encrypted and access-restricted to the service operator. Test
restore into an isolated path. Never copy the database to GitHub Actions, the `adoption-metrics`
branch, issue attachments, or support conversations. SQLite secure deletion is enabled and an
authenticated withdrawal checkpoints/truncates the WAL before returning success. Configure the
backup system to expire and purge every copy within 30 days; verify that retention and deletion
policy before release and during restore drills.

Registration creation/renewal and its revocation-tombstone check run in one SQLite transaction.
Withdrawal writes the tombstone and deletes the active row in one transaction, preventing either
side of a concurrent renewal/withdrawal race from resurrecting a withdrawn registration.

Before release, verify this sequence through the public HTTPS origin:

1. create one test registration;
2. confirm status and idempotent renewal;
3. confirm the aggregate suppresses the test cohort below five;
4. withdraw the registration;
5. confirm status returns the same non-enumerating not-found response as a wrong capability;
6. confirm the aggregate returns a validated zero;
7. inspect proxy and application logging configuration without printing secrets or request data.
