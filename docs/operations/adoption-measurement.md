# Adoption measurement

This repository measures a few public signals without adding telemetry to the SDK. The collector is
maintainer tooling under `tools/adoption`; it is not included in the npm package and is never run by
an SDK consumer.

The latest generated report lives on the data branch:
[SDK adoption evidence](https://github.com/marcel-tuinstra/garmin-connect-sdk/blob/adoption-metrics/docs/adoption/latest.md).
The underlying dated snapshots are available in the same branch under `data/adoption/snapshots`.

The report starts with four separately sourced indicators and three charts, followed by the exact
tables used to interpret them. The external-adoption baseline begins on **2026-09-21**. Earlier
snapshots remain historical context, and a 14-day raw window that crosses that date is labeled as
overlapping pre-baseline context. The charts are generated as dependency-free local SVG files under
`docs/adoption/assets/<snapshot-date>` and are linked at full size from both the dated report and
`latest.md`. They contain no scripts, external fonts, images, links or remote resources.

## What the metrics mean

- **raw npm downloads** count package retrievals reported by npm. They include caches, CI and repeated
  downloads. The rolling per-version endpoint is treated as a separate, less stable source and is
  labeled by retrieval date because npm does not expose its exact window boundaries.
- **raw GitHub repository traffic** contains daily views, viewers, clones and cloners for this
  repository within GitHub's rolling window. It is repository traffic, not SDK use.
- **external public repository evidence** is static evidence found in indexed public files.
  Repositories owned by `marcel-tuinstra` or `Tuinstra-DEV` are excluded case-insensitively before
  repository inspection, persistence and reporting. Similarly named owners are not excluded.
  Dependency declarations, lockfile resolutions, SDK imports and strict constructor callsites stay
  distinct. A callsite is active-use evidence, not proof that a deployment is running.
- **active installations** are not measured. None of the other metrics is used as a substitute.

The 14-day npm summary adds only observed daily package-download values. A partially observed period
is labeled with its coverage instead of silently treating missing days as zero. GitHub unique-viewer
and unique-cloner summaries use the newest observed rolling-window total inside the report's recent
window; daily unique values and repeated rolling windows are never summed. The report shows every
window value's own observation date so independently delayed sources remain visible.

The version chart uses only the newest recent npm version snapshot. It shows the five versions with
the highest download values and combines chart-only overflow into `Other versions`; the table keeps
every exact version row. The highest stable semantic version observed in that snapshot is
highlighted when it appears among those chart rows. The yellow `#FFD83D` marker always includes a
text label and outline, so latest-state emphasis does not depend on color alone.

There is no combined “users” number. npm and GitHub traffic aggregates do not identify the actor or
origin, so they cannot reliably remove the maintainer's local clones, CI checkouts or package
downloads. Those values therefore remain unchanged and explicitly labeled raw. Missing, delayed,
denied, failed and rate-limited observations use a `null` value and an explicit status. Only a
validated upstream zero is stored as zero.

## Schedule and storage

The `Adoption metrics` workflow runs daily at 03:17 UTC from the default branch. It also accepts one
fixed `repository_dispatch` event so a maintainer can bootstrap or diagnose collection without a
branch-selectable workflow trigger. Run it with an authenticated GitHub CLI session that has write
access to this repository:

```sh
gh api --method POST \
  repos/marcel-tuinstra/garmin-connect-sdk/dispatches \
  -f event_type=adoption-metrics
```

GitHub resolves `repository_dispatch` against the default branch. The workflow does not accept or
read a client payload, so the caller cannot select a ref or influence collector commands. Scheduled
and manual runs use the same jobs, credentials, concurrency group, validation and publication path.
Daily collection re-reads GitHub's rolling traffic data, so observations survive after they leave the
source window. GitHub can delay scheduled work and may disable public repository schedules after
prolonged inactivity. Maintainers should check the workflow at least weekly; a gap longer than the
traffic window cannot be reconstructed.

The workflow keeps collection and publication separate:

1. Three read-only jobs collect npm data, repository traffic and public code evidence independently.
2. Each job uploads a sanitized staging artifact for at most 30 days.
3. A publisher with no source credentials validates those files, performs deterministic upserts and
   normally pushes one commit to the `adoption-metrics` branch. It never force-pushes.

Suppression loading fails closed: public discovery does not run if the data-branch list cannot be
read or validated. On the initial bootstrap run, the publisher can create the data branch and its
empty suppression file while discovery remains explicitly missing; the next run can collect public
evidence. A later permissions, network or API failure never falls back to an empty list.

After a manual run, inspect all four jobs on the Actions run page. Confirm that the three sanitized
source artifacts exist, that their logs and files contain no token values or raw upstream responses,
and that the publisher updated `docs/adoption/latest.md` plus `data/adoption` on the
`adoption-metrics` branch. The readable report remains available at the link at the top of this
document. Repeating a manual run is safe: concurrent runs are serialized and deterministic keys
update existing observations instead of duplicating metrics.

The key for a measurement is source, metric, metric date and optional dimension. Repeating the same
collection updates that record instead of appending a duplicate. Retrieval time, run ID and source
status remain in the dated snapshot. A successful observation is never replaced by a later failed,
missing or rate-limited retry. Canonical observations are split into monthly files under
`data/adoption/measurements`; dated snapshots preserve each collection date, while compact records
under `data/adoption/runs` keep run status and counts without duplicating the payload. Reports and
`latest.json` contain at most the most recent 90 days. Concurrent workflow runs are serialized.
Each report renders a fixed 14-day daily grid. Missing observations remain `—` in the table and gaps
in a chart; lines are never drawn through them. Repeating collection on the same date deterministically
overwrites the three assets in that date's directory. Replaying an older date writes only that dated
report and its dated assets; it does not move or rewrite `latest.md`, `latest.json` or the assets linked
by the latest report.

The adopter index keeps its first and most recent positive observation. The source-controlled owner
policy is also applied to existing index entries, so historical internal repositories disappear even
when the latest discovery run is partial or failed. A repository not found in a
complete search is labeled `not_observed`; after 30 days without positive evidence it becomes stale
and stops counting as an adopter. A partial run can add positive evidence but cannot advance negative
or stale state. A fully failed discovery run does not change the index. Maintainers can place
lower-case `owner/repository` values in
`data/adoption/adopters/suppressions.json` on the data branch to exclude them from current and future
reports.

## Access and secrets

The npm source needs no credential. Before merging or enabling the workflow, create three GitHub
Actions environments and restrict each deployment branch to the default branch:

- `adoption-traffic`
- `adoption-discovery`
- `adoption-publication`

Keep the source secrets in their matching environment, not as unrestricted repository secrets:

- `ADOPTION_TRAFFIC_TOKEN`: a fine-grained token restricted to this repository with only the
  repository metadata and Administration read access needed by GitHub's traffic endpoint.
- `ADOPTION_DISCOVERY_TOKEN`: a separate identity with no private-repository access. A no-scope token
  for public information is preferred. Repository visibility is checked again before evidence is
  accepted; anything other than `public` is discarded.

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
spreadsheet-formula prefixes. Generated SVG text is control-stripped, length-bounded and XML-escaped.
The report's normal Markdown tables remain the readable fallback at narrow widths and increased zoom;
the full-size chart link is provided because proportionally shrinking an SVG cannot make small labels
readable on its own.

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

## Retention

Sanitized snapshots, reports and public repository evidence remain in the `adoption-metrics` Git
history for the lifetime of the project. Staging artifacts expire after 30 days. Raw API responses
are never retained. If a public repository becomes private, deleted or opts out, its current index
entry is suppressed on the next run.

## Recovery

The data branch is the canonical store. To recover:

1. Inspect the latest valid commit on `adoption-metrics`; never rewrite or force-push the branch.
2. Re-run the failed trusted default-branch workflow from its Actions run page, or send the fixed
   `adoption-metrics` repository dispatch shown above. Do not add a branch-selectable dispatch
   trigger. A rerun records a new retrieval-day snapshot; within their upstream rolling windows,
   daily measurements can still repair older canonical metric dates. Unrecoverable source days
   remain explicitly missing. Idempotent keys prevent duplicate metrics.
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
