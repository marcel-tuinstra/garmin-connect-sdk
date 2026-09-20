import {
  collectGitHubTraffic,
  collectNpmDownloads,
  collectPublicRepositoryEvidence,
  collectVoluntaryRegistrations,
} from './sources.mjs';

export const DEFAULT_SEARCH_QUERIES = Object.freeze([
  '"garmin-connect-sdk" filename:package.json',
  '"garmin-connect-sdk" filename:package-lock.json',
  '"garmin-connect-sdk" filename:pnpm-lock.yaml',
  '"garmin-connect-sdk" filename:yarn.lock',
  '"garmin-connect-sdk" language:TypeScript',
  '"garmin-connect-sdk" language:JavaScript',
]);

export async function collectAdoption({
  source,
  now = new Date(),
  runId,
  fetchImpl = globalThis.fetch,
  packageName = 'garmin-connect-sdk',
  repository = 'marcel-tuinstra/garmin-connect-sdk',
  trafficToken = '',
  discoveryToken = '',
  aggregateToken = '',
  suppressions = [],
  npmCollector = collectNpmDownloads,
  trafficCollector = collectGitHubTraffic,
  adopterCollector = collectPublicRepositoryEvidence,
  voluntaryCollector = collectVoluntaryRegistrations,
}) {
  const retrievedAt = validDateObject(now).toISOString();
  const metricDate = retrievedAt.slice(0, 10);
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(runId)) {
    throw new Error('runId must contain only letters, numbers, dots, underscores, and dashes.');
  }

  let result;
  if (source === 'npm') {
    const endDate = shiftDate(metricDate, -1);
    result = await npmCollector({
      fetchImpl,
      packageName,
      startDate: shiftDate(endDate, -13),
      endDate,
      retrievedAt,
    });
  } else if (source === 'github-traffic') {
    result = await trafficCollector({ fetchImpl, repository, token: trafficToken, retrievedAt });
  } else if (source === 'github-adopters') {
    result = await adopterCollector({
      fetchImpl,
      token: discoveryToken,
      retrievedAt,
      queries: DEFAULT_SEARCH_QUERIES,
      excludeRepositories: [repository, ...suppressions],
    });
  } else if (source === 'voluntary-opt-in') {
    result = await voluntaryCollector({ fetchImpl, token: aggregateToken, retrievedAt });
  } else {
    throw new Error(`Unsupported adoption source: ${source}`);
  }

  const sourceStatuses = result.statuses ?? (result.status ? [result.status] : []);
  return {
    schemaVersion: 1,
    collectionSource: source,
    metricDate,
    retrievedAt,
    runId,
    runStatus: deriveRunStatus(sourceStatuses),
    sourceStatuses,
    measurements: result.measurements ?? [],
    adopterObservations: result.observations ?? [],
  };
}

export function combineCollectionResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('At least one collection result is required.');
  }
  const [first] = results;
  if (results.some((result) => result.schemaVersion !== 1)) {
    throw new Error('All collection results must use schema version 1.');
  }
  if (results.some((result) => result.metricDate !== first.metricDate)) {
    throw new Error('Collection results must use the same metric date.');
  }

  const statuses = uniqueBy(
    results.flatMap((result) => result.sourceStatuses ?? []),
    (status) => status.source,
  );
  const measurements = uniqueBy(
    results.flatMap((result) => result.measurements ?? []),
    (measurement) =>
      [
        measurement.source,
        measurement.metric,
        measurement.metricDate,
        measurement.dimension ?? '',
      ].join('|'),
  );
  const adopterObservations = uniqueBy(
    results.flatMap((result) => result.adopterObservations ?? []),
    (observation) =>
      `${observation?.repository?.owner ?? ''}/${observation?.repository?.name ?? ''}`.toLowerCase(),
  );
  const runIds = [...new Set(results.map((result) => result.runId))];
  const retrievedAt = results
    .map((result) => result.retrievedAt)
    .sort()
    .at(-1);

  return {
    schemaVersion: 1,
    metricDate: first.metricDate,
    retrievedAt,
    runId: runIds.length === 1 ? runIds[0] : `merged-${first.metricDate.replaceAll('-', '')}`,
    runStatus: deriveRunStatus(statuses),
    sourceStatuses: statuses.sort((left, right) => left.source.localeCompare(right.source)),
    measurements: measurements.sort((left, right) =>
      measurementKey(left).localeCompare(measurementKey(right)),
    ),
    adopterObservations,
  };
}

function deriveRunStatus(statuses) {
  if (statuses.length === 0) return 'failed';
  if (statuses.every(({ status }) => status === 'success')) return 'complete';
  if (statuses.some(({ status }) => ['success', 'partial'].includes(status))) return 'partial';
  return 'failed';
}

function uniqueBy(items, keyFor) {
  const map = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function measurementKey(measurement) {
  return [
    measurement.source,
    measurement.metric,
    measurement.metricDate,
    measurement.dimension ?? '',
  ].join('|');
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validDateObject(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error('Invalid collection time.');
  return value;
}
