# Adoption measurement

This repository measures public signals and a separate voluntary private/unindexed registration
signal without adding implicit telemetry to the SDK. Maintainer collection lives under
`tools/adoption` and is not included in the npm package. The published package contains only the
separately invoked `garmin-connect-adoption` consent command; installation, import, SDK
construction, authentication, and normal use never run it or make an adoption request.

The latest generated report lives on the data branch:
[SDK adoption evidence](https://github.com/marcel-tuinstra/garmin-connect-sdk/blob/adoption-metrics/docs/adoption/latest.md).
The underlying dated snapshots are available in the same branch under `data/adoption/snapshots`.

## What the metrics mean

- **npm downloads** count package retrievals reported by npm. They include caches, CI and repeated
  downloads. The rolling per-version endpoint is treated as a separate, less stable source and is
  labeled by retrieval date because npm does not expose its exact window boundaries.
- **GitHub repository traffic** contains daily views, viewers, clones and cloners for this repository
  within GitHub's rolling window. It is repository traffic, not SDK use.
- **public repository evidence** is static evidence found in indexed public files. Dependency
  declarations, lockfile resolutions, SDK imports and strict constructor callsites stay distinct.
  A callsite is active-use evidence, not proof that a deployment is running.
- **voluntary private/unindexed registrations** are pseudonymous, time-limited and unverified
  self-reports submitted only after a consumer runs the dedicated command and confirms its exact
  payload. The collector receives thresholded aggregates, never raw registrations.
- **active installations** are not measured. None of the other metrics is used as a substitute.

There is no combined “users” number. Missing, delayed, denied, failed and rate-limited observations
use a `null` value and an explicit status. Only a validated upstream zero is stored as zero.

## Schedule and storage

The `Adoption metrics` workflow runs daily at 03:17 UTC from the default branch. It deliberately has
no branch-selectable manual dispatch because the source jobs use credentials. Daily collection
re-reads GitHub's rolling traffic data, so observations survive after they leave the source window.
GitHub can delay scheduled work and may disable public repository schedules after prolonged
inactivity. Maintainers should check the workflow at least weekly; a gap longer than the traffic
window cannot be reconstructed.

The workflow keeps collection and publication separate:

1. Four read-only jobs collect npm data, repository traffic, public code evidence and thresholded
   voluntary-registration aggregates independently.
2. Each job uploads a sanitized staging artifact for at most 30 days.
3. A publisher with no source credentials validates those files, performs deterministic upserts and
   normally pushes one commit to the `adoption-metrics` branch. It never force-pushes.

Suppression loading fails closed: public discovery does not run if the data-branch list cannot be
read or validated. On the initial bootstrap run, the publisher can create the data branch and its
empty suppression file while discovery remains explicitly missing; the next run can collect public
evidence. A later permissions, network or API failure never falls back to an empty list.

The key for a measurement is source, metric, metric date and optional dimension. Repeating the same
collection updates that record instead of appending a duplicate. Retrieval time, run ID and source
status remain in the dated snapshot. A successful observation is never replaced by a later failed,
missing or rate-limited retry. Canonical observations are split into monthly files under
`data/adoption/measurements`; dated snapshots preserve each collection date, while compact records
under `data/adoption/runs` keep run status and counts without duplicating the payload. Reports and
`latest.json` contain at most the most recent 90 days. Concurrent workflow runs are serialized.

The adopter index keeps its first and most recent positive observation. A repository not found in a
complete search is labeled `not_observed`; after 30 days without positive evidence it becomes stale
and stops counting as an adopter. A partial run can add positive evidence but cannot advance negative
or stale state. A fully failed discovery run does not change the index. Maintainers can place
lower-case `owner/repository` values in
`data/adoption/adopters/suppressions.json` on the data branch to exclude them from current and future
reports.

## Access and secrets

The npm source needs no credential. Before merging or enabling the workflow, create four GitHub
Actions environments and restrict each deployment branch to the default branch:

- `adoption-traffic`
- `adoption-discovery`
- `adoption-publication`
- `adoption-opt-in-aggregate`

Keep the source secrets in their matching environment, not as unrestricted repository secrets:

- `ADOPTION_TRAFFIC_TOKEN`: a fine-grained token restricted to this repository with only the
  repository metadata and Administration read access needed by GitHub's traffic endpoint.
- `ADOPTION_DISCOVERY_TOKEN`: a separate identity with no private-repository access. A no-scope token
  for public information is preferred. Repository visibility is checked again before evidence is
  accepted; anything other than `public` is discarded.
- `ADOPTION_AGGREGATE_TOKEN`: a read-only capability for the intake's aggregate endpoint. It cannot
  list, modify, renew, or delete registrations and belongs only in `adoption-opt-in-aggregate`.

The collection jobs have `contents: read`. Source tokens exist only in their matching environment
and step. The publisher receives neither token; its separately restricted environment alone gets
`contents: write` for the data branch. External Actions are pinned to commits. Tokens and upstream
response bodies must never be printed, stored in artifacts or committed.

Repository Actions settings must permit the publisher's `GITHUB_TOKEN` to write contents. Protect
`adoption-metrics` against deletion and force pushes while allowing normal updates by the
environment-gated GitHub Actions publisher. Validate those settings before the first scheduled run.

Public source files are hostile input. The collector caps response sizes and result counts, accepts
only fixed API hosts, validates repository identities, and never clones, installs, builds or executes
another repository. Generated Markdown escapes table delimiters, control characters and
spreadsheet-formula prefixes.

## Public repository privacy

The index contains only an already-public owner/repository identifier, repository state, version
evidence, evidence type, source URL, observation time and confidence. It does not collect personal
names, email addresses, profiles, contributors, commit authors, snippets, referrers, paths visited by
readers, Garmin data or credentials. Forked, archived and disabled repositories remain visible for
provenance but do not count as adopters.

Repository owners can opt out by opening a privacy request through
[private vulnerability reporting](https://github.com/marcel-tuinstra/garmin-connect-sdk/security/advisories/new).
The maintainer adds the lower-case repository key to the suppression file, verifies that the next
collection and publication omit it from the staging artifact, current index, report, dated snapshot
and run record. The maintainer also deletes any retained workflow artifacts created before the
suppression took effect. Because Git history is durable and forks may exist, the maintainer will also
assess whether history rewriting or a GitHub support request is appropriate; no automatic erasure
guarantee is made.

## Voluntary Registration Privacy

`garmin-connect-adoption share` uses the fixed `https://adoption.tuinstra.dev` origin. It previews
the exact five-field payload and asks for final confirmation with a default of no. Decline and
`--dry-run` make no request and write no state. The allowlist is `schemaVersion`, `consentVersion`,
`consent`, `sdkVersion`, and `visibility`; the service rejects unknown fields, oversized bodies,
invalid versions, public visibility, non-HTTPS requests and malformed credentials.

The client generates a random 128-bit registration ID and an independent 256-bit management
capability. Each request also carries a fresh random request ID and current request timestamp for
replay resistance. The server stores keyed hashes of the stable registration ID and management
capability, not their raw values. It stores only SDK version, coarse visibility, consent version,
creation/update timestamps and expiry. It does not accept repository identity, URLs, paths, source,
arbitrary metadata, Garmin data, credentials, profiles, devices, health data, usage frequency,
personal identity, or commercial-use claims. This is pseudonymous processing: the capability is
stable until withdrawal or expiry even though the service does not ask who owns it.

After explicit consent and before the first request, the client saves the management capability as
pending owner-only local state. If the server commits but its response is lost, rerunning `share`
reuses that capability and can recover or revoke the same record instead of creating an orphan.

The edge processes a network address to serve and rate-limit a request. Before persistence, the
application converts it to a keyed hash used only in the current hourly rate-limit window. Request
bodies, authorization values, raw IP addresses, user agents, registration IDs and management
capabilities must not enter application, proxy or tracing logs. The SQLite registry is private,
encrypted at the host/storage layer, access-restricted to the service account, and never copied into
Git or workflow artifacts. Encrypted, access-restricted backups expire within 30 days and must be
purged on that schedule.

Active registrations expire 90 days after their most recent deliberate share. `status` checks the
active record using the management capability. `withdraw` deletes that record before local state is
removed, writes only keyed registration/capability hashes to a 24-hour replay-prevention tombstone,
and checkpoints/truncates SQLite's WAL before returning success. Creation and renewal atomically
check that tombstone, so an in-flight renewal cannot resurrect a withdrawn registration. A deleted
active row can remain in an encrypted operator backup for at most 30 days. Historical aggregate
reports cannot be reliably decremented and remain under the report retention policy. Lost
pseudonymous management capabilities cannot be recovered or linked to an owner by the service; the
active record expires naturally.

The aggregate endpoint requires a separate read-only token. Its threshold cannot be configured below
five; it suppresses every non-zero total or bucket below five and rounds released counts down to a
multiple of five. Rounding reduces small-cohort and day-to-day differencing risk but cannot make a
published historical aggregate retractable. Published source name: `private_opt_in_self_report`.
Reports call it an unverified voluntary registration and never a verified repository, unique user,
active install, commercial user, or license violation.

Authenticated traffic triggers expiry maintenance at most once every five minutes. Unauthenticated
aggregate requests do not run maintenance, and the rate-limit store indexes its expiry window so
cleanup remains bounded as the table grows.

## Retention

Sanitized snapshots, reports, public repository evidence and thresholded voluntary aggregates remain
in the `adoption-metrics` Git history for the lifetime of the project. Staging artifacts expire
after 30 days. Raw API responses and raw voluntary registrations never enter Git or artifacts. An
active voluntary registration expires after 90 days. An authenticated withdrawal transactionally
deletes its active row, retains a keyed replay-prevention tombstone for 24 hours, and checkpoints the
SQLite WAL before success is returned. Encrypted operator backups may retain the deleted row for no
more than 30 days. If a public repository becomes private, deleted or opts out, its current index
entry is suppressed on the next run.

## Recovery

The data branch is the canonical store. To recover:

1. Inspect the latest valid commit on `adoption-metrics`; never rewrite or force-push the branch.
2. Re-run the failed trusted default-branch workflow from its Actions run page. Do not add a
   branch-selectable dispatch trigger. A rerun records a new retrieval-day snapshot; within their
   upstream rolling windows, daily measurements can still repair older canonical metric dates.
   Unrecoverable source days remain explicitly missing. Idempotent keys prevent duplicate metrics.
3. If source collection succeeded but publication failed, download the retained sanitized artifacts
   and run `tools/adoption/cli.mjs publish` against them before their 30-day expiry.
4. Mark unrecoverable source days as missing. Do not interpolate them or convert them to zero.

A storage failure cannot be written into the store that just failed. In that case the workflow fails,
the staging artifacts remain available for recovery, and the previous data-branch commit stays intact.

## Source limitations

GitHub code search covers indexed default-branch content, can be truncated and is rate-limited. It is
not a census. Ranged or malformed dependency declarations remain labeled as such; a range without a
lock resolution does not establish an installed version. Archived and forked repositories are
reported separately. npm downloads, organization names, imports, traffic and static callsites do not
establish commercial use or a license violation.

Voluntary registrations are self-selected and unverified. One project can register more than once
from separately initialized environments, many consumers will never opt in, small cohorts are
hidden, and expiry measures recent deliberate registrations rather than active installations.
