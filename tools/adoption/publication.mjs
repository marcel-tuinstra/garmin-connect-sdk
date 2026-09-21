import * as defaultFs from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { combineCollectionResults } from './collector.mjs';
import { renderAdoptionCharts } from './charts.mjs';
import { mergeAdopterIndex } from './model.mjs';
import { isExternalRepositoryKey } from './policy.mjs';
import { renderAdoptionReport } from './report.mjs';
import { mergeCanonicalMeasurements, persistSnapshot } from './store.mjs';

const MAX_INPUT_FILES = 12;
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

export async function publishCollection({ inputDir, dataDir, reportDir, fsApi = defaultFs }) {
  const inputPaths = await listJsonFiles(inputDir, fsApi);
  if (inputPaths.length === 0) throw new Error('No collection files were found.');
  if (inputPaths.length > MAX_INPUT_FILES) throw new Error('Too many collection files.');

  const results = [];
  for (const path of inputPaths) {
    const info = await fsApi.stat(path);
    if (!info.isFile() || info.size > MAX_INPUT_BYTES) throw new Error('Invalid collection file.');
    results.push(JSON.parse(await fsApi.readFile(path, 'utf8')));
  }

  const combined = combineCollectionResults(completeSourceSet(results));
  const suppressions = await readJsonOrDefault(
    join(dataDir, 'adopters', 'suppressions.json'),
    [],
    fsApi,
  );
  const publishable = applySuppressions(combined, suppressions);
  const { snapshot } = await persistSnapshot({
    dataDir,
    incoming: publishable,
    suppressions,
    fsApi,
  });
  const currentMeasurements = await readCanonicalMeasurements(dataDir, fsApi);
  const currentAdopters = await readJsonOrDefault(
    join(dataDir, 'adopters', 'index.json'),
    [],
    fsApi,
  );
  const currentLatest = await readJsonOrDefault(join(dataDir, 'latest.json'), null, fsApi);
  const measurements = mergeCanonicalMeasurements(currentMeasurements, publishable.measurements);
  const referenceDate =
    currentLatest?.metricDate && currentLatest.metricDate > publishable.metricDate
      ? currentLatest.metricDate
      : publishable.metricDate;
  const historicalReplay = referenceDate > publishable.metricDate;
  const adopterSourceStatus = publishable.sourceStatuses.find(
    ({ source }) => source === 'github_public_search',
  );
  const canUpdateAdopters = ['success', 'partial'].includes(adopterSourceStatus?.status);
  const adopters = canUpdateAdopters
    ? mergeAdopterIndex(currentAdopters, publishable.adopterObservations, {
        observedAt: `${referenceDate}T23:59:59.999Z`,
        suppressions,
        completeObservation: adopterSourceStatus.status === 'success' && !historicalReplay,
      })
    : mergeAdopterIndex(currentAdopters, [], {
        observedAt: `${referenceDate}T23:59:59.999Z`,
        suppressions,
        completeObservation: false,
      });
  const reportSnapshot = {
    ...snapshot,
    measurements: recentMeasurements(measurements, referenceDate),
    adopters,
  };
  const datedReport = renderAdoptionReport({
    ...snapshot,
    measurements: recentMeasurements(measurements, publishable.metricDate).filter(
      ({ metricDate }) => metricDate <= publishable.metricDate,
    ),
    adopters: snapshot.adopters,
  });
  const latestReport = renderAdoptionReport(reportSnapshot);
  const datedCharts = renderAdoptionCharts({
    ...snapshot,
    measurements: recentMeasurements(measurements, publishable.metricDate).filter(
      ({ metricDate }) => metricDate <= publishable.metricDate,
    ),
    adopters: snapshot.adopters,
  });

  await writeMeasurementShards(dataDir, measurements, publishable.measurements, fsApi);
  await writeJsonAtomic(join(dataDir, 'adopters', 'index.json'), adopters, fsApi);
  await writeJsonAtomic(join(dataDir, 'adopters', 'suppressions.json'), suppressions, fsApi);
  await writeJsonAtomic(
    join(
      dataDir,
      'runs',
      publishable.metricDate.slice(0, 4),
      publishable.metricDate.slice(5, 7),
      `${publishable.runId}.json`,
    ),
    runManifest(publishable),
    fsApi,
  );
  await writeChartAssets(reportDir, snapshot.metricDate, datedCharts, fsApi);
  await writeTextAtomic(join(reportDir, `${snapshot.metricDate}.md`), datedReport, fsApi);
  if (!currentLatest?.metricDate || publishable.metricDate >= currentLatest.metricDate) {
    await writeJsonAtomic(join(dataDir, 'latest.json'), reportSnapshot, fsApi);
    await writeTextAtomic(join(reportDir, 'latest.md'), latestReport, fsApi);
  }

  return {
    metricDate: snapshot.metricDate,
    runStatus: combined.runStatus,
    measurementCount: snapshot.measurements.length,
    adopterCount: adopters.length,
  };
}

async function writeChartAssets(reportDir, metricDate, assets, fsApi) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) throw new Error('Invalid chart metric date.');
  const expected = ['github-traffic.svg', 'npm-downloads.svg', 'version-downloads.svg'];
  const names = Object.keys(assets).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error('Invalid chart asset set.');
  }
  for (const name of names) {
    if (!/^[a-z-]+\.svg$/.test(name)) throw new Error('Invalid chart asset name.');
    await writeTextAtomic(join(reportDir, 'assets', metricDate, name), assets[name], fsApi);
  }
}

function completeSourceSet(results) {
  const [first] = results;
  const runIds = new Set(results.map(({ runId }) => runId));
  if (runIds.size !== 1) throw new Error('Collection files must use the same run ID.');
  const expected = ['npm', 'github-traffic', 'github-adopters'];
  const coverage = new Map(expected.map((source) => [source, 0]));
  for (const result of results) {
    for (const source of coveredSources(result)) coverage.set(source, coverage.get(source) + 1);
  }
  if ([...coverage.values()].some((count) => count > 1)) {
    throw new Error('Duplicate collection source artifacts.');
  }
  return [
    ...results,
    ...expected
      .filter((source) => coverage.get(source) === 0)
      .map((source) => missingSourceResult(source, first)),
  ];
}

function coveredSources(result) {
  if (['npm', 'github-traffic', 'github-adopters'].includes(result.collectionSource)) {
    return [result.collectionSource];
  }
  const statuses = result.sourceStatuses ?? [];
  const covered = [];
  if (statuses.some(({ source }) => source.startsWith('npm_'))) covered.push('npm');
  if (statuses.some(({ source }) => source.startsWith('github_traffic'))) {
    covered.push('github-traffic');
  }
  if (statuses.some(({ source }) => source.startsWith('github_public_'))) {
    covered.push('github-adopters');
  }
  return covered;
}

function missingSourceResult(source, base) {
  const statusSource =
    source === 'npm'
      ? 'npm_collection'
      : source === 'github-traffic'
        ? 'github_traffic'
        : 'github_public_search';
  return {
    schemaVersion: 1,
    collectionSource: source,
    metricDate: base.metricDate,
    retrievedAt: base.retrievedAt,
    runId: base.runId,
    runStatus: 'failed',
    sourceStatuses: [{ source: statusSource, status: 'missing', reasonCode: 'artifact_missing' }],
    measurements: [],
    adopterObservations: [],
  };
}

function runManifest(collection) {
  return {
    schemaVersion: 1,
    metricDate: collection.metricDate,
    retrievedAt: collection.retrievedAt,
    runId: collection.runId,
    runStatus: collection.runStatus,
    sourceStatuses: collection.sourceStatuses,
    measurementCount: collection.measurements.length,
    adopterObservationCount: collection.adopterObservations.length,
  };
}

function applySuppressions(collection, suppressions) {
  const suppressed = new Set(
    suppressions.filter((value) => typeof value === 'string').map((value) => value.toLowerCase()),
  );
  return {
    ...collection,
    adopterObservations: (collection.adopterObservations ?? []).filter((observation) => {
      const owner = observation?.repository?.owner;
      const repository = observation?.repository?.name;
      const repositoryKey =
        typeof owner === 'string' && typeof repository === 'string'
          ? `${owner}/${repository}`.toLowerCase()
          : null;
      return isExternalRepositoryKey(repositoryKey) && !suppressed.has(repositoryKey);
    }),
  };
}

async function readCanonicalMeasurements(dataDir, fsApi) {
  const paths = await listJsonFilesOrEmpty(join(dataDir, 'measurements'), fsApi);
  const legacy = await readJsonOrDefault(join(dataDir, 'measurements.json'), [], fsApi);
  const values = [...legacy];
  for (const path of paths) values.push(...JSON.parse(await fsApi.readFile(path, 'utf8')));
  return mergeCanonicalMeasurements([], values);
}

async function writeMeasurementShards(dataDir, measurements, incoming, fsApi) {
  const touched = new Set(incoming.map(({ metricDate }) => measurementBucket(metricDate)));
  for (const bucket of [...touched].sort()) {
    await writeJsonAtomic(
      join(dataDir, 'measurements', `${bucket}.json`),
      measurements.filter(({ metricDate }) => measurementBucket(metricDate) === bucket),
      fsApi,
    );
  }
}

function measurementBucket(metricDate) {
  if (typeof metricDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) {
    throw new Error('Invalid measurement date.');
  }
  return `${metricDate.slice(0, 4)}/${metricDate.slice(5, 7)}`;
}

function recentMeasurements(measurements, referenceDate) {
  const cutoff = new Date(`${referenceDate}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 89);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  return measurements.filter(({ metricDate }) => metricDate >= cutoffDate);
}

async function readJsonOrDefault(path, fallback, fsApi) {
  try {
    return JSON.parse(await fsApi.readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function listJsonFiles(directory, fsApi) {
  const entries = await fsApi.readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await listJsonFiles(path, fsApi)));
    else if (entry.isFile() && entry.name.endsWith('.json')) paths.push(path);
  }
  return paths.sort();
}

async function listJsonFilesOrEmpty(directory, fsApi) {
  try {
    return await listJsonFiles(directory, fsApi);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJsonAtomic(path, value, fsApi) {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`, fsApi);
}

async function writeTextAtomic(path, value, fsApi) {
  await fsApi.mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  try {
    await fsApi.writeFile(temporaryPath, value, { encoding: 'utf8', mode: 0o600 });
    await fsApi.rename(temporaryPath, path);
  } catch (error) {
    try {
      await fsApi.rm(temporaryPath, { force: true });
    } catch {
      // Preserve the original storage failure.
    }
    throw error;
  }
}
