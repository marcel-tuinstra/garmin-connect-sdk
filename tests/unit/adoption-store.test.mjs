import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  mergeCanonicalMeasurements,
  mergeSnapshot,
  persistSnapshot,
} from '../../tools/adoption/store.mjs';

const incoming = {
  schemaVersion: 1,
  metricDate: '2026-09-20',
  retrievedAt: '2026-09-20T10:00:00.000Z',
  runId: 'local-1',
  runStatus: 'complete',
  sourceStatuses: [{ source: 'npm_downloads', status: 'success' }],
  measurements: [
    {
      source: 'npm',
      metric: 'package_downloads',
      metricDate: '2026-09-19',
      dimension: null,
      status: 'observed',
      value: 0,
      unit: 'downloads',
      retrievedAt: '2026-09-20T10:00:00.000Z',
    },
  ],
  adopterObservations: [],
};

describe('adoption snapshot storage', () => {
  it('upserts the same source, metric, date, and dimension while retaining retrieval metadata', () => {
    const first = mergeSnapshot(null, incoming);
    const second = mergeSnapshot(first, {
      ...incoming,
      retrievedAt: '2026-09-20T11:00:00.000Z',
      runId: 'local-2',
      measurements: [
        {
          ...incoming.measurements[0],
          value: 3,
          retrievedAt: '2026-09-20T11:00:00.000Z',
        },
      ],
    });

    expect(second.measurements).toHaveLength(1);
    expect(second.measurements[0]).toMatchObject({ status: 'observed', value: 3 });
    expect(second.retrievals).toHaveLength(2);
    expect(second.retrievals[0].runStatus).toBe('complete');
  });

  it('is byte-stable for an exact repeated collection', () => {
    const first = mergeSnapshot(null, incoming);
    const second = mergeSnapshot(first, incoming);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('deduplicates exact repository observations on repeated collection', () => {
    const repositoryObservation = {
      repository: {
        owner: 'example',
        name: 'app',
        url: 'https://github.com/example/app',
        visibility: 'public',
        archived: false,
        fork: false,
        disabled: false,
      },
      evidence: [
        {
          type: 'sdk_import',
          path: 'src/index.ts',
          sourceUrl: 'https://github.com/example/app/blob/main/src/index.ts',
          observedAt: incoming.retrievedAt,
        },
      ],
      observedAt: incoming.retrievedAt,
    };
    const withAdopter = { ...incoming, adopterObservations: [repositoryObservation] };
    const first = mergeSnapshot(null, withAdopter);
    const second = mergeSnapshot(first, withAdopter);

    expect(second.adopters).toHaveLength(1);
    expect(second.adopters[0].evidence).toHaveLength(1);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('keeps missing distinct from a successfully observed zero', () => {
    const merged = mergeSnapshot(null, {
      ...incoming,
      measurements: [
        incoming.measurements[0],
        {
          ...incoming.measurements[0],
          source: 'github',
          metric: 'views',
          status: 'missing',
          value: null,
        },
      ],
    });

    expect(merged.measurements.map(({ status, value }) => ({ status, value }))).toEqual([
      { status: 'missing', value: null },
      { status: 'observed', value: 0 },
    ]);
  });

  it('keeps a canonical observed value when a later collection for the same key fails', () => {
    const observed = incoming.measurements[0];
    const failed = {
      ...observed,
      status: 'rate_limited',
      value: null,
      retrievedAt: '2026-09-20T11:00:00.000Z',
    };

    expect(mergeCanonicalMeasurements([observed], [failed])).toEqual([
      expect.objectContaining({ status: 'observed', value: 0 }),
    ]);
  });

  it('accepts a later observed correction without duplicating its canonical key', () => {
    const observed = incoming.measurements[0];
    const corrected = {
      ...observed,
      value: 9,
      retrievedAt: '2026-09-20T11:00:00.000Z',
    };

    expect(mergeCanonicalMeasurements([observed], [corrected])).toEqual([
      expect.objectContaining({ value: 9, retrievedAt: corrected.retrievedAt }),
    ]);
  });

  it('writes a dated snapshot atomically and leaves no temporary files', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'gcs-adoption-'));
    const result = await persistSnapshot({ dataDir, incoming });

    expect(result.snapshotPath).toBe(join(dataDir, 'snapshots', '2026-09-20.json'));
    expect(JSON.parse(await readFile(result.snapshotPath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      metricDate: '2026-09-20',
    });
    expect(
      (await readdir(join(dataDir, 'snapshots'))).filter((name) => name.includes('.tmp')),
    ).toEqual([]);
  });

  it('surfaces storage failure instead of reporting a successful run', async () => {
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    const fsApi = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      writeFile: vi.fn().mockRejectedValue(failure),
      rename: vi.fn(),
      rm: vi.fn(),
    };

    await expect(persistSnapshot({ dataDir: '/metrics', incoming, fsApi })).rejects.toMatchObject({
      code: 'ENOSPC',
    });
    expect(fsApi.rename).not.toHaveBeenCalled();
  });
});
