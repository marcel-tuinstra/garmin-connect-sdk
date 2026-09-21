import { access, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { publishCollection } from '../../tools/adoption/publication.mjs';

describe('adoption publication', () => {
  it('publishes a dated snapshot, latest data, adopter index, and reports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gcs-adoption-publication-'));
    const inputDir = join(root, 'inputs');
    const dataDir = join(root, 'data');
    const reportDir = join(root, 'reports');
    await mkdir(inputDir);
    const base = {
      schemaVersion: 1,
      metricDate: '2026-09-20',
      retrievedAt: '2026-09-20T10:00:00.000Z',
      runId: 'run-1',
      runStatus: 'complete',
      sourceStatuses: [],
      measurements: [],
      adopterObservations: [],
    };
    await writeFile(
      join(inputDir, 'npm.json'),
      JSON.stringify({
        ...base,
        sourceStatuses: [{ source: 'npm_downloads', status: 'success' }],
        measurements: [
          {
            source: 'npm',
            metric: 'package_downloads',
            metricDate: '2026-09-19',
            dimension: null,
            status: 'observed',
            value: 8,
            unit: 'downloads',
            retrievedAt: base.retrievedAt,
          },
        ],
      }),
    );

    const result = await publishCollection({ inputDir, dataDir, reportDir });

    expect(result).toMatchObject({ metricDate: '2026-09-20', runStatus: 'partial' });
    expect(JSON.parse(await readFile(join(dataDir, 'latest.json'), 'utf8'))).toMatchObject({
      metricDate: '2026-09-20',
    });
    expect(JSON.parse(await readFile(join(dataDir, 'adopters', 'index.json'), 'utf8'))).toEqual([]);
    expect(
      JSON.parse(await readFile(join(dataDir, 'measurements', '2026', '09.json'), 'utf8')),
    ).toHaveLength(1);
    const manifest = JSON.parse(
      await readFile(join(dataDir, 'runs', '2026', '09', 'run-1.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({ runStatus: 'partial', measurementCount: 1 });
    expect(manifest).not.toHaveProperty('measurements');
    expect(await readFile(join(reportDir, 'latest.md'), 'utf8')).toContain(
      '| 2026-09-19 | 8 | observed |',
    );
    expect(await readFile(join(reportDir, '2026-09-20.md'), 'utf8')).toContain(
      '# SDK adoption overview',
    );
    for (const filename of ['npm-downloads.svg', 'github-traffic.svg', 'version-downloads.svg']) {
      const asset = join(reportDir, 'assets', '2026-09-20', filename);
      expect((await stat(asset)).isFile()).toBe(true);
      expect(await readFile(asset, 'utf8')).toContain('role="img"');
    }
    expect(await readFile(join(reportDir, 'latest.md'), 'utf8')).toContain(
      './assets/2026-09-20/npm-downloads.svg',
    );
  });

  it('keeps canonical observations and adopters across consecutive collection dates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gcs-adoption-canonical-'));
    const inputDir = join(root, 'inputs');
    const dataDir = join(root, 'data');
    const reportDir = join(root, 'reports');
    await mkdir(inputDir);
    const observedAt = '2026-09-20T10:00:00.000Z';
    const measurement = {
      source: 'github',
      metric: 'views',
      metricDate: '2026-09-19',
      dimension: null,
      status: 'observed',
      value: 4,
      unit: 'views',
      retrievedAt: observedAt,
    };
    const adopterObservation = {
      repository: {
        owner: 'example',
        name: 'app',
        url: 'https://github.com/example/app',
        visibility: 'public',
        archived: false,
        fork: false,
        disabled: false,
      },
      evidence: [{ type: 'active_use_evidence', observedAt }],
      observedAt,
    };
    await writeFile(
      join(inputDir, 'run.json'),
      JSON.stringify({
        schemaVersion: 1,
        metricDate: '2026-09-20',
        retrievedAt: observedAt,
        runId: 'run-day-one',
        runStatus: 'complete',
        sourceStatuses: [
          { source: 'github_traffic_views', status: 'success' },
          { source: 'github_public_search', status: 'success' },
        ],
        measurements: [measurement],
        adopterObservations: [adopterObservation],
      }),
    );
    await publishCollection({ inputDir, dataDir, reportDir });

    await writeFile(
      join(inputDir, 'run.json'),
      JSON.stringify({
        schemaVersion: 1,
        metricDate: '2026-09-21',
        retrievedAt: '2026-09-21T10:00:00.000Z',
        runId: 'run-day-two',
        runStatus: 'partial',
        sourceStatuses: [
          { source: 'github_traffic_views', status: 'rate_limited' },
          { source: 'github_public_search', status: 'partial' },
        ],
        measurements: [
          {
            ...measurement,
            status: 'rate_limited',
            value: null,
            retrievedAt: '2026-09-21T10:00:00.000Z',
          },
        ],
        adopterObservations: [],
      }),
    );
    await publishCollection({ inputDir, dataDir, reportDir });

    expect(
      JSON.parse(await readFile(join(dataDir, 'measurements', '2026', '09.json'), 'utf8')),
    ).toEqual([expect.objectContaining({ metric: 'views', status: 'observed', value: 4 })]);
    expect(JSON.parse(await readFile(join(dataDir, 'adopters', 'index.json'), 'utf8'))).toEqual([
      expect.objectContaining({
        repositoryKey: 'example/app',
        observationState: 'observed',
        stale: false,
      }),
    ]);

    const beforeFailedDiscovery = await readFile(join(dataDir, 'adopters', 'index.json'), 'utf8');
    await writeFile(
      join(inputDir, 'run.json'),
      JSON.stringify({
        schemaVersion: 1,
        metricDate: '2026-11-01',
        retrievedAt: '2026-11-01T10:00:00.000Z',
        runId: 'run-failed-discovery',
        runStatus: 'failed',
        sourceStatuses: [{ source: 'github_public_search', status: 'rate_limited' }],
        measurements: [],
        adopterObservations: [],
      }),
    );
    await publishCollection({ inputDir, dataDir, reportDir });

    expect(await readFile(join(dataDir, 'adopters', 'index.json'), 'utf8')).toBe(
      beforeFailedDiscovery,
    );
  });

  it('does not move latest pointers backwards during an older npm replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gcs-adoption-latest-'));
    const inputDir = join(root, 'inputs');
    const dataDir = join(root, 'data');
    const reportDir = join(root, 'reports');
    await mkdir(inputDir);
    const writeRun = async (metricDate, runId) => {
      await writeFile(
        join(inputDir, 'run.json'),
        JSON.stringify({
          schemaVersion: 1,
          metricDate,
          retrievedAt: `${metricDate}T10:00:00.000Z`,
          runId,
          runStatus: 'complete',
          sourceStatuses: [
            { source: 'npm_downloads', status: 'success' },
            { source: 'github_public_search', status: 'success' },
          ],
          measurements: [
            {
              source: 'npm',
              metric: 'package_downloads',
              metricDate,
              dimension: null,
              status: 'observed',
              value: metricDate === '2026-09-20' ? 20 : 19,
              unit: 'downloads',
              retrievedAt: `${metricDate}T10:00:00.000Z`,
            },
          ],
          adopterObservations:
            metricDate === '2026-09-20'
              ? [
                  {
                    repository: {
                      owner: 'example',
                      name: 'app',
                      url: 'https://github.com/example/app',
                      visibility: 'public',
                    },
                    evidence: [
                      { type: 'active_use_evidence', observedAt: `${metricDate}T10:00:00.000Z` },
                    ],
                    observedAt: `${metricDate}T10:00:00.000Z`,
                  },
                ]
              : [],
        }),
      );
      await publishCollection({ inputDir, dataDir, reportDir });
    };

    await writeRun('2026-09-20', 'newer-run');
    const latestChartBeforeReplay = await readFile(
      join(reportDir, 'assets', '2026-09-20', 'npm-downloads.svg'),
      'utf8',
    );
    await writeRun('2026-09-19', 'older-run');

    expect(JSON.parse(await readFile(join(dataDir, 'latest.json'), 'utf8'))).toMatchObject({
      metricDate: '2026-09-20',
    });
    expect(await readFile(join(reportDir, 'latest.md'), 'utf8')).toContain(
      'Generated from the `2026-09-20` snapshot',
    );
    expect(await readFile(join(reportDir, '2026-09-19.md'), 'utf8')).not.toContain('2026-09-20');
    expect(JSON.parse(await readFile(join(dataDir, 'adopters', 'index.json'), 'utf8'))).toEqual([
      expect.objectContaining({ repositoryKey: 'example/app', observationState: 'observed' }),
    ]);
    expect(
      await readFile(join(reportDir, 'assets', '2026-09-20', 'npm-downloads.svg'), 'utf8'),
    ).toBe(latestChartBeforeReplay);
    expect(await readFile(join(reportDir, '2026-09-19.md'), 'utf8')).toContain(
      './assets/2026-09-19/npm-downloads.svg',
    );
    await access(join(reportDir, 'assets', '2026-09-19', 'npm-downloads.svg'));
  });

  it('overwrites same-day report assets deterministically without duplicate chart paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gcs-adoption-same-day-'));
    const inputDir = join(root, 'inputs');
    const dataDir = join(root, 'data');
    const reportDir = join(root, 'reports');
    await mkdir(inputDir);
    const writeRun = async (runId, value, retrievedHour) => {
      await writeFile(
        join(inputDir, 'run.json'),
        JSON.stringify({
          schemaVersion: 1,
          metricDate: '2026-09-21',
          retrievedAt: `2026-09-21T${retrievedHour}:00:00.000Z`,
          runId,
          runStatus: 'complete',
          sourceStatuses: [{ source: 'npm_downloads', status: 'success' }],
          measurements: [
            {
              source: 'npm',
              metric: 'package_downloads',
              metricDate: '2026-09-20',
              dimension: null,
              status: 'observed',
              value,
              unit: 'downloads',
              retrievedAt: `2026-09-21T${retrievedHour}:00:00.000Z`,
            },
          ],
          adopterObservations: [],
        }),
      );
      await publishCollection({ inputDir, dataDir, reportDir });
    };

    await writeRun('run-one', 4, '09');
    await writeRun('run-two', 9, '10');

    const chart = await readFile(
      join(reportDir, 'assets', '2026-09-21', 'npm-downloads.svg'),
      'utf8',
    );
    expect(chart).toContain('9 downloads');
    expect(chart).not.toContain('4 downloads');
    expect(await readFile(join(reportDir, 'latest.md'), 'utf8')).toContain(
      '| 2026-09-20 | 9 | observed |',
    );
  });

  it('removes suppressed repositories before every public persistence boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gcs-adoption-suppression-'));
    const inputDir = join(root, 'inputs');
    const dataDir = join(root, 'data');
    const reportDir = join(root, 'reports');
    await mkdir(inputDir, { recursive: true });
    await mkdir(join(dataDir, 'adopters'), { recursive: true });
    await writeFile(
      join(dataDir, 'adopters', 'suppressions.json'),
      JSON.stringify(['example/app']),
    );
    await writeFile(
      join(inputDir, 'adopters.json'),
      JSON.stringify({
        schemaVersion: 1,
        collectionSource: 'github-adopters',
        metricDate: '2026-09-20',
        retrievedAt: '2026-09-20T10:00:00.000Z',
        runId: 'suppressed-run',
        runStatus: 'complete',
        sourceStatuses: [{ source: 'github_public_search', status: 'success' }],
        measurements: [],
        adopterObservations: [
          {
            repository: {
              owner: 'Example',
              name: 'App',
              url: 'https://github.com/Example/App',
              visibility: 'public',
            },
            evidence: [{ type: 'active_use_evidence' }],
            observedAt: '2026-09-20T10:00:00.000Z',
          },
        ],
      }),
    );

    await publishCollection({ inputDir, dataDir, reportDir });

    for (const path of [
      join(dataDir, 'snapshots', '2026-09-20.json'),
      join(dataDir, 'runs', '2026', '09', 'suppressed-run.json'),
      join(dataDir, 'adopters', 'index.json'),
      join(dataDir, 'latest.json'),
      join(reportDir, 'latest.md'),
    ]) {
      expect((await readFile(path, 'utf8')).toLowerCase()).not.toContain('example/app');
    }
  });

  it('rejects artifacts from different workflow runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gcs-adoption-run-mismatch-'));
    const inputDir = join(root, 'inputs');
    await mkdir(inputDir);
    const base = {
      schemaVersion: 1,
      metricDate: '2026-09-20',
      retrievedAt: '2026-09-20T10:00:00.000Z',
      runStatus: 'complete',
      measurements: [],
      adopterObservations: [],
    };
    await writeFile(
      join(inputDir, 'npm.json'),
      JSON.stringify({
        ...base,
        collectionSource: 'npm',
        runId: 'run-1',
        sourceStatuses: [{ source: 'npm_downloads', status: 'success' }],
      }),
    );
    await writeFile(
      join(inputDir, 'traffic.json'),
      JSON.stringify({
        ...base,
        collectionSource: 'github-traffic',
        runId: 'run-2',
        sourceStatuses: [{ source: 'github_traffic', status: 'success' }],
      }),
    );

    await expect(
      publishCollection({
        inputDir,
        dataDir: join(root, 'data'),
        reportDir: join(root, 'reports'),
      }),
    ).rejects.toThrow('same run ID');
  });

  it('refuses empty input rather than publishing an all-zero report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gcs-adoption-empty-'));
    const inputDir = join(root, 'inputs');
    await mkdir(inputDir);

    await expect(
      publishCollection({
        inputDir,
        dataDir: join(root, 'data'),
        reportDir: join(root, 'reports'),
      }),
    ).rejects.toThrow('No collection files');
  });
});
