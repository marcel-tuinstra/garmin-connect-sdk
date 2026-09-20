import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

import { buildAdopterIndex, extractRepositoryEvidence, normalizeSourceStatus } from './model.mjs';

const NPM_API = 'https://api.npmjs.org';
const GITHUB_API = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULTS = 100;
const MAX_REPOSITORIES = 20;
const MAX_FILES_PER_REPOSITORY = 6;
const DISCOVERY_CONCURRENCY = 6;
const DISCOVERY_BUDGET_MS = 12 * 60_000;
const MAX_SOURCE_BYTES = 262_144;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function collectNpmDownloads({
  fetchImpl = globalThis.fetch,
  packageName,
  startDate,
  endDate,
  retrievedAt,
}) {
  const encodedName = encodeURIComponent(packageName);
  const dailyUrl = `${NPM_API}/downloads/range/${startDate}:${endDate}/${encodedName}`;
  const versionUrl = `${NPM_API}/versions/${encodedName}/last-week`;
  const [daily, versions] = await Promise.all([
    requestJson(fetchImpl, dailyUrl),
    requestJson(fetchImpl, versionUrl),
  ]);
  const measurements = [];
  const statuses = [];

  if (daily.ok) {
    const parsed = parseNpmDaily(
      daily.body,
      dailyUrl,
      retrievedAt,
      startDate,
      endDate,
      packageName,
    );
    if (parsed === null) {
      statuses.push({ source: 'npm_downloads', status: 'failed', reasonCode: 'invalid_payload' });
      measurements.push(
        missingMeasurement('npm', 'package_downloads', endDate, 'failed', dailyUrl, retrievedAt),
      );
    } else {
      measurements.push(...parsed.measurements);
      statuses.push({
        source: 'npm_downloads',
        status: parsed.missingDates > 0 ? 'partial' : 'success',
        ...(parsed.missingDates > 0 ? { reasonCode: 'missing_dates' } : {}),
      });
    }
  } else {
    const dailyStatus = sourceFailure('npm_downloads', daily);
    statuses.push(dailyStatus);
    measurements.push(
      missingMeasurement(
        'npm',
        'package_downloads',
        endDate,
        dailyStatus.status,
        dailyUrl,
        retrievedAt,
      ),
    );
  }

  if (versions.ok) {
    const versionMeasurements = parseNpmVersions(
      versions.body,
      versionUrl,
      retrievedAt,
      packageName,
    );
    if (versionMeasurements === null) {
      statuses.push({ source: 'npm_versions', status: 'failed', reasonCode: 'invalid_payload' });
      measurements.push(
        missingMeasurement(
          'npm',
          'version_downloads_last_week',
          endDate,
          'failed',
          versionUrl,
          retrievedAt,
        ),
      );
    } else {
      measurements.push(...versionMeasurements);
      statuses.push({ source: 'npm_versions', status: 'success' });
    }
  } else {
    const versionStatus = sourceFailure('npm_versions', versions);
    statuses.push(versionStatus);
    measurements.push(
      missingMeasurement(
        'npm',
        'version_downloads_last_week',
        endDate,
        versionStatus.status,
        versionUrl,
        retrievedAt,
      ),
    );
  }

  const status = aggregateStatus('npm_downloads', statuses);
  return { status, statuses, measurements };
}

export async function collectGitHubTraffic({
  fetchImpl = globalThis.fetch,
  repository,
  token,
  retrievedAt,
}) {
  const metricDate = retrievedAt.slice(0, 10);
  if (!token) {
    const status = { source: 'github_traffic', status: 'missing', reasonCode: 'token_missing' };
    return {
      status,
      statuses: [status],
      measurements: trafficFailureMeasurements(
        ['views', 'clones'],
        metricDate,
        'missing',
        null,
        retrievedAt,
      ),
    };
  }
  if (!validRepositorySlug(repository)) throw new Error('Invalid GitHub repository slug.');

  const measurements = [];
  const statuses = [];
  for (const kind of ['views', 'clones']) {
    const url = `${GITHUB_API}/repos/${repository}/traffic/${kind}?per=day`;
    const result = await requestJson(fetchImpl, url, { token });
    if (!result.ok) {
      const status = sourceFailure(`github_traffic_${kind}`, result);
      statuses.push(status);
      measurements.push(
        ...trafficFailureMeasurements([kind], metricDate, status.status, url, retrievedAt),
      );
      continue;
    }
    const parsed = parseTraffic(kind, result.body, url, retrievedAt);
    if (parsed === null) {
      statuses.push({
        source: `github_traffic_${kind}`,
        status: 'failed',
        reasonCode: 'invalid_payload',
      });
      measurements.push(
        ...trafficFailureMeasurements([kind], metricDate, 'failed', url, retrievedAt),
      );
    } else {
      statuses.push({
        source: `github_traffic_${kind}`,
        status: parsed.missingDates > 0 ? 'partial' : 'success',
        ...(parsed.missingDates > 0 ? { reasonCode: 'missing_dates' } : {}),
      });
      measurements.push(...parsed.measurements);
    }
  }

  return {
    status: aggregateStatus('github_traffic', statuses),
    statuses,
    measurements,
  };
}

export async function collectPublicRepositoryEvidence({
  fetchImpl = globalThis.fetch,
  token,
  retrievedAt,
  queries,
  excludeRepositories = [],
}) {
  if (!token) {
    return {
      status: { source: 'github_public_search', status: 'missing', reasonCode: 'token_missing' },
      statuses: [
        { source: 'github_public_search', status: 'missing', reasonCode: 'token_missing' },
      ],
      adopters: [],
      observations: [],
    };
  }

  const matches = [];
  let partial = false;
  let invalidSearchHit = false;
  const deadlineAt = Date.now() + DISCOVERY_BUDGET_MS;
  const searchStatuses = [];
  for (const [index, query] of (queries ?? []).entries()) {
    const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=${MAX_SEARCH_RESULTS}`;
    const result = await requestJson(fetchImpl, url, { token });
    if (!result.ok) {
      searchStatuses.push(sourceFailure(`github_public_search_query_${index + 1}`, result));
      partial = true;
      continue;
    }
    if (
      !Array.isArray(result.body?.items) ||
      !Number.isSafeInteger(result.body?.total_count) ||
      result.body.total_count < 0 ||
      typeof result.body?.incomplete_results !== 'boolean'
    ) {
      searchStatuses.push({
        source: `github_public_search_query_${index + 1}`,
        status: 'failed',
        reasonCode: 'invalid_payload',
      });
      partial = true;
      continue;
    }
    searchStatuses.push({ source: `github_public_search_query_${index + 1}`, status: 'success' });
    const items = result.body.items.slice(0, MAX_SEARCH_RESULTS);
    partial ||=
      result.body?.incomplete_results === true ||
      (Number.isSafeInteger(result.body?.total_count) && result.body.total_count > items.length);
    matches.push(...items);
  }

  const excluded = new Set(excludeRepositories.map((repository) => repository.toLowerCase()));
  const grouped = new Map();
  for (const match of matches) {
    const fullName = match?.repository?.full_name;
    if (!validRepositorySlug(fullName)) {
      invalidSearchHit = true;
      partial = true;
      continue;
    }
    const key = fullName.toLowerCase();
    if (excluded.has(key)) continue;
    if (
      !validApiUrl(match?.repository?.url) ||
      !validApiUrl(match?.url) ||
      !validGitHubUrl(match?.html_url)
    ) {
      invalidSearchHit = true;
      partial = true;
      continue;
    }
    if (!grouped.has(key) && grouped.size >= MAX_REPOSITORIES) {
      partial = true;
      continue;
    }
    const group = grouped.get(key) ?? {
      fullName,
      repositoryApiUrl: match.repository.url,
      matches: [],
    };
    if (
      group.matches.length < MAX_FILES_PER_REPOSITORY &&
      !group.matches.some((existing) => existing.url === match.url)
    ) {
      group.matches.push(match);
    } else if (group.matches.length >= MAX_FILES_PER_REPOSITORY) {
      partial = true;
    }
    grouped.set(key, group);
  }

  const inspections = await mapWithConcurrency(
    [...grouped.values()],
    DISCOVERY_CONCURRENCY,
    (group) => inspectRepositoryGroup({ group, fetchImpl, token, retrievedAt, deadlineAt }),
  );
  const observations = inspections
    .map(({ observation }) => observation)
    .filter(Boolean)
    .sort((left, right) =>
      `${left.repository.owner}/${left.repository.name}`.localeCompare(
        `${right.repository.owner}/${right.repository.name}`,
      ),
    );
  const metadataStatuses = inspections.flatMap(({ metadataStatuses: statuses }) => statuses);
  const contentStatuses = inspections.flatMap(({ contentStatuses: statuses }) => statuses);
  partial ||= inspections.some((inspection) => inspection.partial);

  const detailedStatuses = [
    ...searchStatuses,
    ...(invalidSearchHit
      ? [
          {
            source: 'github_public_search_hits',
            status: 'failed',
            reasonCode: 'invalid_payload',
          },
        ]
      : []),
    aggregateOptionalStatus('github_public_metadata', metadataStatuses),
    aggregateOptionalStatus('github_public_content', contentStatuses),
  ].filter(Boolean);
  const aggregate = aggregateStatus('github_public_search', detailedStatuses);
  const status = {
    ...aggregate,
    ...(partial && aggregate.status === 'success' ? { status: 'partial' } : {}),
  };
  return {
    status,
    statuses: [status, ...detailedStatuses],
    observations,
    adopters: buildAdopterIndex(observations),
  };
}

async function inspectRepositoryGroup({ group, fetchImpl, token, retrievedAt, deadlineAt }) {
  const metadataStatuses = [];
  const contentStatuses = [];
  if (!validApiUrl(group.repositoryApiUrl)) {
    return { observation: null, metadataStatuses, contentStatuses, partial: true };
  }
  if (Date.now() >= deadlineAt) {
    metadataStatuses.push({
      source: 'github_public_metadata',
      status: 'delayed',
      reasonCode: 'collection_budget_exhausted',
    });
    return { observation: null, metadataStatuses, contentStatuses, partial: true };
  }

  const metadata = await requestJson(fetchImpl, group.repositoryApiUrl, { token });
  if (!metadata.ok) {
    metadataStatuses.push(sourceFailure('github_public_metadata', metadata));
    return { observation: null, metadataStatuses, contentStatuses, partial: true };
  }
  const repository = normalizeRepositoryMetadata(metadata.body);
  if (!repository) {
    metadataStatuses.push({
      source: 'github_public_metadata',
      status: 'failed',
      reasonCode: 'invalid_or_non_public_repository',
    });
    return { observation: null, metadataStatuses, contentStatuses, partial: true };
  }
  metadataStatuses.push({ source: 'github_public_metadata', status: 'success' });

  const evidence = [];
  let partial = false;
  for (const match of group.matches) {
    if (!validApiUrl(match.url)) continue;
    if (Date.now() >= deadlineAt) {
      contentStatuses.push({
        source: 'github_public_content',
        status: 'delayed',
        reasonCode: 'collection_budget_exhausted',
      });
      partial = true;
      break;
    }
    const contentResult = await requestJson(fetchImpl, match.url, { token });
    if (!contentResult.ok) {
      contentStatuses.push(sourceFailure('github_public_content', contentResult));
      partial = true;
      continue;
    }
    const content = decodeGitHubContent(contentResult.body);
    if (content === null) {
      contentStatuses.push({
        source: 'github_public_content',
        status: 'failed',
        reasonCode: 'invalid_payload',
      });
      partial = true;
      continue;
    }
    contentStatuses.push({ source: 'github_public_content', status: 'success' });
    evidence.push(
      ...extractRepositoryEvidence({
        path: match.path,
        content,
        sourceUrl: match.html_url,
        observedAt: retrievedAt,
      }),
    );
  }
  return {
    observation: evidence.length > 0 ? { repository, evidence, observedAt: retrievedAt } : null,
    metadataStatuses,
    contentStatuses,
    partial,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function requestJson(fetchImpl, url, { token } = {}) {
  try {
    const headers = {
      Accept: 'application/vnd.github+json, application/json',
      'User-Agent': 'garmin-connect-sdk-adoption-metrics',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(url, {
      headers,
      signal: globalThis.AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, headers: response.headers };
    }
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      return { ok: false, status: 'failed', reasonCode: 'response_too_large' };
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      return { ok: false, status: 'failed', reasonCode: 'response_too_large' };
    }
    return { ok: true, body: JSON.parse(text), httpStatus: response.status };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === 'TimeoutError' ? 'delayed' : 'failed',
      reasonCode: error?.name === 'TimeoutError' ? 'timeout' : 'request_failed',
    };
  }
}

function sourceFailure(source, result) {
  if (result.httpStatus) {
    return { source, ...normalizeSourceStatus(result) };
  }
  return {
    source,
    status: result.status ?? 'failed',
    reasonCode: result.reasonCode ?? 'request_failed',
  };
}

function parseNpmDaily(body, sourceUrl, retrievedAt, startDate, endDate, packageName) {
  if (
    !Array.isArray(body?.downloads) ||
    body.start !== startDate ||
    body.end !== endDate ||
    body.package !== packageName
  ) {
    return null;
  }
  const values = new Map();
  for (const entry of body.downloads) {
    if (!validDate(entry?.day) || !validCount(entry?.downloads) || values.has(entry.day))
      return null;
    values.set(entry.day, entry.downloads);
  }
  const measurements = [];
  let missingDates = 0;
  for (const day of dateRange(startDate, endDate)) {
    if (values.has(day)) {
      measurements.push(
        observedMeasurement(
          'npm',
          'package_downloads',
          day,
          values.get(day),
          'downloads',
          sourceUrl,
          retrievedAt,
        ),
      );
    } else {
      missingDates += 1;
      measurements.push(
        missingMeasurement('npm', 'package_downloads', day, 'missing', sourceUrl, retrievedAt),
      );
    }
  }
  return { measurements, missingDates };
}

function parseNpmVersions(body, sourceUrl, retrievedAt, packageName) {
  if (
    !body?.downloads ||
    typeof body.downloads !== 'object' ||
    Array.isArray(body.downloads) ||
    body.package !== packageName
  ) {
    return null;
  }
  const hasWindowMetadata = body.start !== undefined || body.end !== undefined;
  if (
    hasWindowMetadata &&
    (!validDate(body.start) || !validDate(body.end) || body.start > body.end)
  ) {
    return null;
  }
  const metricDate = retrievedAt.slice(0, 10);
  const entries = Object.entries(body.downloads);
  const measurements = entries.flatMap(([version, count]) => {
    if (!validDimension(version) || !validCount(count)) return [];
    return [
      {
        ...observedMeasurement(
          'npm',
          'version_downloads_last_week',
          metricDate,
          count,
          'downloads',
          sourceUrl,
          retrievedAt,
        ),
        dimension: version,
        windowStart: hasWindowMetadata ? body.start : null,
        windowEnd: hasWindowMetadata ? body.end : null,
      },
    ];
  });
  return measurements.length === entries.length ? measurements : null;
}

function parseTraffic(kind, body, sourceUrl, retrievedAt) {
  const rows = body?.[kind];
  if (!Array.isArray(rows) || !validCount(body?.count) || !validCount(body?.uniques)) return null;
  const names =
    kind === 'views'
      ? [
          ['views', 'count'],
          ['unique_viewers', 'uniques'],
        ]
      : [
          ['clones', 'count'],
          ['unique_cloners', 'uniques'],
        ];
  const values = new Map();
  for (const row of rows) {
    const metricDate = typeof row?.timestamp === 'string' ? row.timestamp.slice(0, 10) : null;
    if (
      !validDate(metricDate) ||
      !validCount(row.count) ||
      !validCount(row.uniques) ||
      values.has(metricDate)
    ) {
      return null;
    }
    values.set(metricDate, row);
  }
  const metricDate = retrievedAt.slice(0, 10);
  const measurements = [];
  let missingDates = 0;
  for (const day of dateRange(shiftDate(metricDate, -14), shiftDate(metricDate, -1))) {
    const row = values.get(day);
    for (const [metric, field] of names) {
      if (row) {
        measurements.push(
          observedMeasurement(
            'github',
            metric,
            day,
            row[field],
            kind === 'views' ? 'views' : 'clones',
            sourceUrl,
            retrievedAt,
          ),
        );
      } else {
        measurements.push(
          missingMeasurement('github', metric, day, 'missing', sourceUrl, retrievedAt),
        );
      }
    }
    if (!row) missingDates += 1;
  }
  measurements.push(
    observedMeasurement(
      'github',
      `${kind}_window_total`,
      metricDate,
      body.count,
      kind,
      sourceUrl,
      retrievedAt,
    ),
    observedMeasurement(
      'github',
      kind === 'views' ? 'unique_viewers_window_total' : 'unique_cloners_window_total',
      metricDate,
      body.uniques,
      kind,
      sourceUrl,
      retrievedAt,
    ),
  );
  return { measurements, missingDates };
}

function normalizeRepositoryMetadata(body) {
  if (body?.visibility !== 'public' || !validRepositorySlug(body.full_name)) return null;
  const [owner, name] = body.full_name.split('/');
  const expectedUrl = `https://github.com/${owner}/${name}`;
  if (body.html_url?.toLowerCase() !== expectedUrl.toLowerCase()) return null;
  return {
    owner,
    name,
    url: expectedUrl,
    visibility: 'public',
    archived: body.archived === true,
    fork: body.fork === true,
    disabled: body.disabled === true,
    defaultBranch: typeof body.default_branch === 'string' ? body.default_branch : null,
    pushedAt: typeof body.pushed_at === 'string' ? body.pushed_at : null,
  };
}

function decodeGitHubContent(body) {
  if (body?.encoding !== 'base64' || typeof body.content !== 'string') return null;
  if (!Number.isSafeInteger(body.size) || body.size < 0 || body.size > MAX_SOURCE_BYTES)
    return null;
  try {
    const decoded = Buffer.from(body.content.replace(/\s/g, ''), 'base64');
    return decoded.length <= MAX_SOURCE_BYTES ? decoded.toString('utf8') : null;
  } catch {
    return null;
  }
}

function observedMeasurement(source, metric, metricDate, value, unit, sourceUrl, retrievedAt) {
  return {
    source,
    metric,
    metricDate,
    dimension: null,
    status: 'observed',
    value,
    unit,
    sourceUrl,
    retrievedAt,
  };
}

function missingMeasurement(source, metric, metricDate, status, sourceUrl, retrievedAt) {
  return {
    source,
    metric,
    metricDate,
    dimension: null,
    status,
    value: null,
    unit: metric.includes('download') ? 'downloads' : 'count',
    sourceUrl,
    retrievedAt,
  };
}

function validRepositorySlug(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value);
}

function validApiUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'api.github.com';
  } catch {
    return false;
  }
}

function validGitHubUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com';
  } catch {
    return false;
  }
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validDimension(value) {
  return typeof value === 'string' && /^[A-Za-z0-9+_.-]{1,128}$/.test(value);
}

function aggregateStatus(source, statuses) {
  if (statuses.every(({ status }) => status === 'success')) return { source, status: 'success' };
  if (statuses.some(({ status }) => ['success', 'partial'].includes(status))) {
    return { source, status: 'partial' };
  }
  return { source, status: statuses[0]?.status ?? 'failed' };
}

function aggregateOptionalStatus(source, statuses) {
  return statuses.length > 0 ? aggregateStatus(source, statuses) : null;
}

function trafficFailureMeasurements(kinds, metricDate, status, sourceUrl, retrievedAt) {
  return kinds.flatMap((kind) => {
    const metrics = kind === 'views' ? ['views', 'unique_viewers'] : ['clones', 'unique_cloners'];
    return metrics.map((metric) =>
      missingMeasurement('github', metric, metricDate, status, sourceUrl, retrievedAt),
    );
  });
}

function dateRange(startDate, endDate) {
  const dates = [];
  let current = startDate;
  while (current <= endDate && dates.length <= 366) {
    dates.push(current);
    current = shiftDate(current, 1);
  }
  return dates;
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
