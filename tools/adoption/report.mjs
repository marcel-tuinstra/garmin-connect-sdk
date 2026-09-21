import { EXTERNAL_ADOPTION_BASELINE_DATE, isExternalRepositoryKey } from './policy.mjs';

const DAILY_WINDOW_DAYS = 14;
const DAILY_TRAFFIC_METRICS = ['views', 'unique_viewers', 'clones', 'unique_cloners'];
const WINDOW_TRAFFIC_METRICS = [
  'views_window_total',
  'unique_viewers_window_total',
  'clones_window_total',
  'unique_cloners_window_total',
];

export function buildAdoptionReportModel(snapshot) {
  const measurements = canonicalReportMeasurements(
    Array.isArray(snapshot?.measurements) ? snapshot.measurements : [],
  );
  const referenceDate = validDate(snapshot?.metricDate) ? snapshot.metricDate : '1970-01-01';
  const dates = precedingDates(referenceDate, DAILY_WINDOW_DAYS);
  const cutoffDate = dates[0];
  const npmDaily = dailyRows(measurements, dates, ['package_downloads'], 'npm').map((row) => ({
    metricDate: row.metricDate,
    ...row.package_downloads,
  }));
  const githubDaily = dailyRows(measurements, dates, DAILY_TRAFFIC_METRICS, 'github');
  const githubWindow = Object.fromEntries(
    WINDOW_TRAFFIC_METRICS.map((metric) => [
      metric,
      latestObservedMeasurement(measurements, 'github', metric, cutoffDate, referenceDate),
    ]),
  );
  const versionMeasurements = measurements.filter(
    ({ source, metric, metricDate }) =>
      source === 'npm' &&
      metric === 'version_downloads_last_week' &&
      metricDate >= cutoffDate &&
      metricDate <= referenceDate,
  );
  const versionDate = versionMeasurements
    .map(({ metricDate }) => metricDate)
    .filter(validDate)
    .sort()
    .at(-1);
  const versionSnapshot = versionMeasurements
    .filter(({ metricDate }) => metricDate === versionDate)
    .sort((left, right) =>
      String(left.dimension ?? '').localeCompare(String(right.dimension ?? '')),
    );
  const latestRetrieval = [...(snapshot?.retrievals ?? [])]
    .filter(({ retrievedAt }) => typeof retrievedAt === 'string')
    .sort((left, right) =>
      `${left.retrievedAt}|${left.runId ?? ''}`.localeCompare(
        `${right.retrievedAt}|${right.runId ?? ''}`,
      ),
    )
    .at(-1);
  const adopters = Array.isArray(snapshot?.adopters)
    ? snapshot.adopters.filter(({ repositoryKey }) => isExternalRepositoryKey(repositoryKey))
    : [];
  const observedNpm = npmDaily.filter(({ status }) => status === 'observed');
  const publicEvidenceStatus = sourceStatus(latestRetrieval, 'github_public_search');
  const publicProjectCount = adopters.filter(({ countsAsAdopter }) => countsAsAdopter).length;

  return {
    snapshot,
    referenceDate,
    latestRetrieval,
    npmDaily,
    githubDaily,
    githubWindow,
    versionDate: versionDate ?? null,
    versionSnapshot,
    adopters,
    kpis: {
      npmDownloads: {
        value:
          observedNpm.length > 0
            ? observedNpm.reduce((total, { value }) => total + value, 0)
            : null,
        observed: observedNpm.length,
        expected: DAILY_WINDOW_DAYS,
        partial: observedNpm.length !== DAILY_WINDOW_DAYS,
        startDate: dates[0],
        endDate: dates.at(-1),
      },
      uniqueCloners: summaryMeasurement(githubWindow.unique_cloners_window_total),
      uniqueViewers: summaryMeasurement(githubWindow.unique_viewers_window_total),
      publicProjects: {
        value:
          publicProjectCount > 0 || publicEvidenceStatus.status === 'success'
            ? publicProjectCount
            : null,
        status: publicEvidenceStatus,
      },
    },
  };
}

export function renderAdoptionReport(snapshot, options = {}) {
  const model = buildAdoptionReportModel(snapshot);
  const assetPrefix = safeAssetPrefix(
    options.assetPrefix ?? `./assets/${model.referenceDate}`,
    model.referenceDate,
  );
  const { kpis } = model;
  const npmStatus = sourceStatus(model.latestRetrieval, 'npm_downloads');
  const viewsStatus = sourceStatus(model.latestRetrieval, 'github_traffic_views');
  const clonesStatus = sourceStatus(model.latestRetrieval, 'github_traffic_clones');
  const publicStatus = sourceStatus(model.latestRetrieval, 'github_public_search');
  const githubObservedCells = model.githubDaily.reduce(
    (count, row) =>
      count + DAILY_TRAFFIC_METRICS.filter((metric) => row[metric].status === 'observed').length,
    0,
  );

  return `# SDK adoption overview

Generated from the ${inline(model.referenceDate)} snapshot at ${inline(model.latestRetrieval?.retrievedAt ?? 'not yet collected')}.

External-adoption baseline: ${inline(EXTERNAL_ADOPTION_BASELINE_DATE)}. ${baselineContext(model.referenceDate, kpis.npmDownloads.startDate)}

| Raw npm downloads · 14 days | Raw unique cloners · GitHub window | Raw unique viewers · GitHub window | External public projects with usage evidence |
| ---: | ---: | ---: | ---: |
| **${summaryValue(kpis.npmDownloads.value)}** | **${summaryValue(kpis.uniqueCloners.value)}** | **${summaryValue(kpis.uniqueViewers.value)}** | **${summaryValue(kpis.publicProjects.value)}** |

**Coverage:** ${kpis.npmDownloads.observed}/${kpis.npmDownloads.expected} npm days observed (${statusLabel(npmStatus)}); ${githubObservedCells}/${DAILY_WINDOW_DAYS * DAILY_TRAFFIC_METRICS.length} GitHub daily values observed (views ${statusLabel(viewsStatus)}, clones ${statusLabel(clonesStatus)}); public evidence ${statusLabel(publicStatus)}. GitHub windows: unique cloners ${observationLabel(kpis.uniqueCloners, model.referenceDate)}, unique viewers ${observationLabel(kpis.uniqueViewers, model.referenceDate)}.

> Active installations are not measured. Raw signals can include CI, caches, repeat downloads and internal activity. npm downloads, repository traffic and external public-code evidence are separate signals and must not be added together as a user count.

## Usage and trends

Charts are linked to their full-size local SVG. Their exact values and missing-data states remain available in the tables below.

### Daily npm downloads

[![Daily npm downloads for the 14 days before ${model.referenceDate}; missing days are gaps and the latest observation is labeled.](${assetPrefix}/npm-downloads.svg)](${assetPrefix}/npm-downloads.svg)

### Daily GitHub activity

[![Daily GitHub clones and views for the 14 days before ${model.referenceDate}; clones use a solid line with circles and views use a dashed line with squares.](${assetPrefix}/github-traffic.svg)](${assetPrefix}/github-traffic.svg)

### Downloads by released version

[![Newest npm rolling version-download snapshot; the highest stable version observed is explicitly labeled and chart overflow is grouped as Other versions.](${assetPrefix}/version-downloads.svg)](${assetPrefix}/version-downloads.svg)

## Drill-down

Missing values remain ${inline('—')}; they are never converted to zero or joined across gaps.

### Daily npm downloads

Period: ${inline(kpis.npmDownloads.startDate)} through ${inline(kpis.npmDownloads.endDate)}. Source status: **${statusLabel(npmStatus)}**.

${table(
  ['Date', 'Downloads', 'Status'],
  model.npmDaily.map((item) => [item.metricDate, displayValue(item), item.status]),
)}

### GitHub traffic by day

One row represents one calendar date. Rolling totals are intentionally kept out of this table. Source status: views **${statusLabel(viewsStatus)}**; clones **${statusLabel(clonesStatus)}**.

${table(
  ['Date', 'Views', 'Unique viewers', 'Clones', 'Unique cloners'],
  model.githubDaily.map((row) => [
    row.metricDate,
    displayValue(row.views),
    displayValue(row.unique_viewers),
    displayValue(row.clones),
    displayValue(row.unique_cloners),
  ]),
)}

### Current GitHub rolling window

Each value keeps its own observation date because GitHub's rolling endpoints can refresh independently. These are window totals, not additional daily observations.

${table(
  ['Metric', 'Observed', 'Freshness', 'Value', 'Status'],
  [
    windowRow('Views', model.githubWindow.views_window_total, model.referenceDate),
    windowRow(
      'Unique viewers',
      model.githubWindow.unique_viewers_window_total,
      model.referenceDate,
    ),
    windowRow('Clones', model.githubWindow.clones_window_total, model.referenceDate),
    windowRow(
      'Unique cloners',
      model.githubWindow.unique_cloners_window_total,
      model.referenceDate,
    ),
  ],
)}

### npm version snapshot

Snapshot date: ${inline(model.versionDate ?? 'not available')}${model.versionDate ? ` (${ageLabel(model.versionDate, model.referenceDate)})` : ''}. This is npm's rolling version-level snapshot; it is separate from daily package downloads. Every exact version remains in this table even when the chart groups overflow.

${table(
  ['Version', 'Downloads', 'Status'],
  model.versionSnapshot.map((item) => [item.dimension ?? '—', displayValue(item), item.status]),
)}

### External public repository evidence

This index contains independently owned public repository identifiers and evidence URLs only. Public projects with usage evidence exclude repositories owned by ${inline('marcel-tuinstra')} or ${inline('Tuinstra-DEV')}. Archived and forked repositories remain visible but are excluded from the project count. Static active-use evidence is not runtime proof.

${table(
  ['Repository', 'State', 'Declared', 'Resolved', 'Evidence', 'Confidence', 'Counted'],
  model.adopters.map((item) => [
    item.repositoryKey,
    item.repositoryState,
    item.declaredVersionRange ?? '—',
    item.resolvedVersion ?? '—',
    (item.evidenceTypes ?? []).join(', '),
    item.confidence,
    item.countsAsAdopter ? 'yes' : 'no',
  ]),
)}

<details>
<summary><strong>Collection health and limitations</strong></summary>

${statusTable(model.latestRetrieval?.sourceStatuses ?? [])}

- npm downloads can include caches, CI and repeat downloads.
- GitHub traffic is repository-level and its rolling history cannot be backfilled after the source window expires.
- GitHub public code search can be delayed, incomplete, rate-limited or truncated and does not include private or unindexed repositories.
- A dependency, lockfile, import or static callsite is evidence with a stated confidence level, not proof of a running installation or license violation.

</details>
`;
}

function dailyRows(measurements, dates, metrics, source) {
  const values = new Map();
  for (const measurement of measurements) {
    if (measurement.source !== source || !metrics.includes(measurement.metric)) continue;
    const key = `${measurement.metric}|${measurement.metricDate}`;
    const existing = values.get(key);
    if (!existing || String(measurement.retrievedAt ?? '') >= String(existing.retrievedAt ?? '')) {
      values.set(key, measurement);
    }
  }
  return dates.map((metricDate) => ({
    metricDate,
    ...Object.fromEntries(
      metrics.map((metric) => [
        metric,
        values.get(`${metric}|${metricDate}`) ?? missingMeasurement(metricDate),
      ]),
    ),
  }));
}

function canonicalReportMeasurements(measurements) {
  const canonical = new Map();
  for (const measurement of measurements) {
    if (!measurement || typeof measurement !== 'object') continue;
    const key = [
      measurement.source,
      measurement.metric,
      measurement.metricDate,
      measurement.dimension ?? '',
    ].join('|');
    const existing = canonical.get(key);
    if (!existing) {
      canonical.set(key, measurement);
      continue;
    }
    if (existing.status === 'observed' && measurement.status !== 'observed') continue;
    if (existing.status !== 'observed' && measurement.status === 'observed') {
      canonical.set(key, measurement);
      continue;
    }
    if (String(measurement.retrievedAt ?? '') >= String(existing.retrievedAt ?? '')) {
      canonical.set(key, measurement);
    }
  }
  return [...canonical.values()];
}

function latestObservedMeasurement(measurements, source, metric, cutoffDate, referenceDate) {
  return (
    measurements
      .filter(
        (item) =>
          item.source === source &&
          item.metric === metric &&
          item.status === 'observed' &&
          item.metricDate >= cutoffDate &&
          item.metricDate <= referenceDate,
      )
      .sort((left, right) =>
        `${left.metricDate}|${left.retrievedAt ?? ''}`.localeCompare(
          `${right.metricDate}|${right.retrievedAt ?? ''}`,
        ),
      )
      .at(-1) ?? missingMeasurement(null)
  );
}

function missingMeasurement(metricDate) {
  return { metricDate, status: 'missing', value: null };
}

function summaryMeasurement(measurement) {
  return {
    value: measurement.status === 'observed' ? measurement.value : null,
    status: measurement.status,
    metricDate: measurement.metricDate,
  };
}

function windowRow(label, measurement, referenceDate) {
  return [
    label,
    measurement?.metricDate ?? '—',
    measurement?.metricDate ? ageLabel(measurement.metricDate, referenceDate) : 'missing',
    displayValue(measurement),
    measurement?.status ?? 'missing',
  ];
}

function precedingDates(referenceDate, count) {
  const end = new Date(`${referenceDate}T00:00:00.000Z`);
  const dates = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - offset);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function baselineContext(referenceDate, windowStartDate) {
  if (referenceDate < EXTERNAL_ADOPTION_BASELINE_DATE) {
    return 'This snapshot is pre-baseline context and is not part of the external-adoption trend.';
  }
  if (windowStartDate < EXTERNAL_ADOPTION_BASELINE_DATE) {
    return 'The raw 14-day lookback overlaps pre-baseline context; only external repository evidence is filtered by owner.';
  }
  return 'External public repository evidence is measured from this date onward.';
}

function sourceStatus(retrieval, source) {
  return (
    retrieval?.sourceStatuses?.find((status) => status.source === source) ?? {
      source,
      status: 'missing',
      reasonCode: 'not_collected',
    }
  );
}

function statusLabel(status) {
  const state = safeToken(status?.status ?? 'missing');
  return status?.reasonCode ? `${state} (${safeToken(status.reasonCode)})` : state;
}

function observationLabel(measurement, referenceDate) {
  return measurement.metricDate
    ? `${inline(measurement.metricDate)} (${ageLabel(measurement.metricDate, referenceDate)})`
    : '**missing**';
}

function ageLabel(metricDate, referenceDate) {
  const age = Math.max(
    0,
    Math.round(
      (Date.parse(`${referenceDate}T00:00:00.000Z`) - Date.parse(`${metricDate}T00:00:00.000Z`)) /
        86_400_000,
    ),
  );
  return age === 0 ? 'current snapshot' : `${age} ${age === 1 ? 'day' : 'days'} old`;
}

function safeToken(value) {
  return (
    String(value)
      .replace(/[^A-Za-z0-9_.-]/g, '_')
      .slice(0, 80) || 'unknown'
  );
}

function statusTable(statuses) {
  return table(
    ['Source', 'Status', 'HTTP', 'Reason'],
    statuses.map((status) => [
      status.source,
      status.status,
      status.httpStatus ?? '—',
      status.reasonCode ?? '—',
    ]),
  );
}

function table(headers, rows) {
  const safeHeaders = headers.map(cell);
  const body = rows.length > 0 ? rows : [headers.map(() => '—')];
  return [
    `| ${safeHeaders.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

function summaryValue(value) {
  return Number.isFinite(value) ? String(value) : '—';
}

function displayValue(measurement) {
  return measurement?.status === 'observed' ? String(measurement.value) : '—';
}

function cell(value) {
  const raw = stripControlCharacters(String(value ?? '—'));
  const formulaSafe = /^[=+@-]/.test(raw) && raw !== '—' ? `'${raw}` : raw;
  return formulaSafe
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]{}()#+.!])/g, '\\$1')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
    .slice(0, 500);
}

function stripControlCharacters(value) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 32 || codePoint === 127 ? ' ' : character;
    })
    .join('');
}

function inline(value) {
  const safe = stripControlCharacters(String(value ?? '—'))
    .replaceAll('`', '')
    .slice(0, 160);
  return `\`${safe || '—'}\``;
}

function safeAssetPrefix(value, metricDate) {
  const expected = `./assets/${metricDate}`;
  return value === expected ? value : expected;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
