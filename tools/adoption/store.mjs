import * as defaultFs from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildAdopterIndex } from './model.mjs';
import { isExternalRepositoryKey } from './policy.mjs';

export function mergeSnapshot(existing, incoming, { suppressions = [] } = {}) {
  validateIncoming(incoming);
  if (existing && existing.metricDate !== incoming.metricDate) {
    throw new Error('Cannot merge snapshots for different metric dates.');
  }

  const retrieval = {
    runId: incoming.runId,
    runStatus: incoming.runStatus,
    retrievedAt: incoming.retrievedAt,
    sourceStatuses: sortStatuses(incoming.sourceStatuses ?? []),
  };
  const retrievals = [...(existing?.retrievals ?? [])];
  const retrievalKey = `${retrieval.runId}|${retrieval.retrievedAt}`;
  if (!retrievals.some((item) => `${item.runId}|${item.retrievedAt}` === retrievalKey)) {
    retrievals.push(retrieval);
  }

  const measurements = new Map(
    (existing?.measurements ?? []).map((measurement) => [measurementKey(measurement), measurement]),
  );
  for (const measurement of incoming.measurements ?? []) {
    validateMeasurement(measurement);
    const key = measurementKey(measurement);
    measurements.set(
      key,
      preferMeasurement(measurements.get(key), canonicalMeasurement(measurement)),
    );
  }

  const priorObservations = (existing?.adopters ?? []).map(adopterToObservation);
  const suppressionSet = new Set(suppressions.map((value) => String(value).toLowerCase()));
  const adopters = buildAdopterIndex([
    ...priorObservations,
    ...(incoming.adopterObservations ?? []),
  ]).filter(
    ({ repositoryKey }) =>
      isExternalRepositoryKey(repositoryKey) && !suppressionSet.has(repositoryKey),
  );

  return {
    schemaVersion: 1,
    metricDate: incoming.metricDate,
    retrievals: retrievals.sort((left, right) =>
      `${left.retrievedAt}|${left.runId}`.localeCompare(`${right.retrievedAt}|${right.runId}`),
    ),
    measurements: [...measurements.values()].sort((left, right) =>
      measurementKey(left).localeCompare(measurementKey(right)),
    ),
    adopters,
  };
}

export function mergeCanonicalMeasurements(existing = [], incoming = []) {
  const measurements = new Map();
  for (const measurement of [...existing, ...incoming]) {
    validateMeasurement(measurement);
    const canonical = canonicalMeasurement(measurement);
    const key = measurementKey(canonical);
    measurements.set(key, preferMeasurement(measurements.get(key), canonical));
  }
  return [...measurements.values()].sort((left, right) =>
    measurementKey(left).localeCompare(measurementKey(right)),
  );
}

export async function persistSnapshot({ dataDir, incoming, suppressions = [], fsApi = defaultFs }) {
  const snapshotPath = join(dataDir, 'snapshots', `${incoming.metricDate}.json`);
  const temporaryPath = `${snapshotPath}.tmp`;
  await fsApi.mkdir(dirname(snapshotPath), { recursive: true });

  let existing = null;
  try {
    existing = JSON.parse(await fsApi.readFile(snapshotPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const snapshot = mergeSnapshot(existing, incoming, { suppressions });
  try {
    await fsApi.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fsApi.rename(temporaryPath, snapshotPath);
  } catch (error) {
    if (fsApi.rm) {
      try {
        await fsApi.rm(temporaryPath, { force: true });
      } catch {
        // Preserve the original storage failure.
      }
    }
    throw error;
  }

  return { snapshotPath, snapshot };
}

function validateIncoming(incoming) {
  if (!incoming || incoming.schemaVersion !== 1) throw new Error('Unsupported snapshot schema.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incoming.metricDate ?? '')) {
    throw new Error('Invalid snapshot metric date.');
  }
  if (!Number.isFinite(Date.parse(incoming.retrievedAt))) {
    throw new Error('Invalid snapshot retrieval time.');
  }
  if (typeof incoming.runId !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(incoming.runId)) {
    throw new Error('Invalid run identifier.');
  }
  if (!['complete', 'partial', 'failed'].includes(incoming.runStatus)) {
    throw new Error('Invalid run status.');
  }
}

function validateMeasurement(measurement) {
  if (!measurement || typeof measurement !== 'object') throw new Error('Invalid measurement.');
  if (
    !['observed', 'missing', 'delayed', 'failed', 'rate_limited', 'denied', 'mismatch'].includes(
      measurement.status,
    )
  ) {
    throw new Error('Invalid measurement status.');
  }
  if (measurement.status === 'observed') {
    if (!Number.isFinite(measurement.value) || measurement.value < 0) {
      throw new Error('Observed measurements require a non-negative value.');
    }
  } else if (measurement.value !== null) {
    throw new Error('Unavailable measurements must use null, never zero.');
  }
}

function canonicalMeasurement(measurement) {
  return {
    source: measurement.source,
    metric: measurement.metric,
    metricDate: measurement.metricDate,
    dimension: measurement.dimension ?? null,
    status: measurement.status,
    value: measurement.value,
    unit: measurement.unit,
    windowStart: measurement.windowStart ?? null,
    windowEnd: measurement.windowEnd ?? null,
    sourceUrl: measurement.sourceUrl ?? null,
    retrievedAt: measurement.retrievedAt,
  };
}

function measurementKey(measurement) {
  return [
    measurement.source,
    measurement.metric,
    measurement.metricDate,
    measurement.dimension ?? '',
  ].join('|');
}

function preferMeasurement(existing, incoming) {
  if (!existing) return incoming;
  if (existing.status === 'observed' && incoming.status !== 'observed') return existing;
  if (existing.status !== 'observed' && incoming.status === 'observed') return incoming;
  return String(incoming.retrievedAt ?? '') >= String(existing.retrievedAt ?? '')
    ? incoming
    : existing;
}

function sortStatuses(statuses) {
  return statuses
    .map((status) => ({
      source: status.source,
      status: status.status,
      httpStatus: status.httpStatus ?? null,
      reasonCode: status.reasonCode ?? null,
      rateLimitRemaining: status.rateLimitRemaining ?? null,
      retryAfterSeconds: status.retryAfterSeconds ?? null,
    }))
    .sort((left, right) => left.source.localeCompare(right.source));
}

function adopterToObservation(adopter) {
  const state = adopter.repositoryState ?? 'active';
  return {
    repository: {
      owner: adopter.owner,
      name: adopter.repository,
      url: adopter.repositoryUrl,
      visibility: 'public',
      archived: state.includes('archived'),
      fork: state.includes('fork'),
      disabled: state === 'disabled',
      defaultBranch: adopter.defaultBranch,
      pushedAt: adopter.pushedAt,
    },
    evidence: adopter.evidence ?? [],
    observedAt: adopter.observedAt,
  };
}
