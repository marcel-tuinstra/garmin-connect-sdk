import { describe, expect, it } from 'vitest';

import { buildAdoptionReportModel, renderAdoptionReport } from '../../tools/adoption/report.mjs';

const retrievedAt = '2026-09-21T10:00:00.000Z';

function measurement({ source, metric, metricDate, value, dimension = null, status = 'observed' }) {
  return {
    source,
    metric,
    metricDate,
    dimension,
    status,
    value: status === 'observed' ? value : null,
    unit: source === 'npm' ? 'downloads' : metric.includes('clone') ? 'clones' : 'views',
    retrievedAt,
  };
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    metricDate: '2026-09-21',
    retrievals: [
      {
        runId: 'run-1',
        retrievedAt,
        sourceStatuses: [
          { source: 'npm_downloads', status: 'partial', reasonCode: 'missing_dates' },
          { source: 'npm_versions', status: 'success' },
          { source: 'github_traffic_views', status: 'partial', reasonCode: 'missing_dates' },
          { source: 'github_traffic_clones', status: 'success' },
          { source: 'github_public_search', status: 'partial', reasonCode: 'incomplete_results' },
        ],
      },
    ],
    measurements: [],
    adopters: [],
    ...overrides,
  };
}

describe('adoption report', () => {
  it('builds one scannable overview without treating distinct signals as users', () => {
    const model = buildAdoptionReportModel(
      snapshot({
        measurements: [
          measurement({
            source: 'npm',
            metric: 'package_downloads',
            metricDate: '2026-09-19',
            value: 12,
          }),
          measurement({
            source: 'npm',
            metric: 'package_downloads',
            metricDate: '2026-09-20',
            value: 8,
          }),
          {
            ...measurement({
              source: 'npm',
              metric: 'package_downloads',
              metricDate: '2026-09-20',
              status: 'failed',
            }),
            retrievedAt: '2026-09-21T11:00:00.000Z',
          },
          measurement({
            source: 'github',
            metric: 'unique_viewers_window_total',
            metricDate: '2026-09-21',
            value: 14,
          }),
          measurement({
            source: 'github',
            metric: 'unique_cloners_window_total',
            metricDate: '2026-09-21',
            value: 64,
          }),
        ],
        adopters: [
          { repositoryKey: 'example/app', countsAsAdopter: true },
          { repositoryKey: 'example/archive', countsAsAdopter: false },
        ],
      }),
    );

    expect(model.kpis).toMatchObject({
      npmDownloads: { value: 20, observed: 2, expected: 14, partial: true },
      uniqueCloners: { value: 64, metricDate: '2026-09-21' },
      uniqueViewers: { value: 14, metricDate: '2026-09-21' },
      publicProjects: { value: 1 },
    });

    const report = renderAdoptionReport(model.snapshot, {
      assetPrefix: './assets/2026-09-21',
    });
    expect(report).toContain('# SDK adoption overview');
    expect(report).toContain('| **20** | **64** | **14** | **1** |');
    expect(report).toContain('2/14 npm days observed');
    expect(report).toContain('[![Daily npm downloads');
    expect(report).toContain('(./assets/2026-09-21/npm-downloads.svg)');
    expect(report).toContain('Active installations are not measured');
    expect(report).toContain('Public projects with usage evidence');
    expect(report).not.toMatch(/unique users/i);
  });

  it('pivots daily GitHub traffic and keeps rolling totals out of the daily table', () => {
    const measurements = [
      measurement({ source: 'github', metric: 'views', metricDate: '2026-09-19', value: 11 }),
      measurement({
        source: 'github',
        metric: 'unique_viewers',
        metricDate: '2026-09-19',
        value: 3,
      }),
      measurement({ source: 'github', metric: 'clones', metricDate: '2026-09-19', value: 31 }),
      measurement({
        source: 'github',
        metric: 'unique_cloners',
        metricDate: '2026-09-19',
        value: 17,
      }),
      measurement({
        source: 'github',
        metric: 'views_window_total',
        metricDate: '2026-09-21',
        value: 27,
      }),
      measurement({
        source: 'github',
        metric: 'unique_viewers_window_total',
        metricDate: '2026-09-21',
        value: 14,
      }),
      measurement({
        source: 'github',
        metric: 'clones_window_total',
        metricDate: '2026-09-21',
        value: 127,
      }),
      measurement({
        source: 'github',
        metric: 'unique_cloners_window_total',
        metricDate: '2026-09-21',
        value: 64,
      }),
    ];
    const report = renderAdoptionReport(snapshot({ measurements }));
    const dailySection = report
      .split('### GitHub traffic by day')[1]
      .split('### Current GitHub')[0];

    expect(dailySection).toContain('| 2026-09-19 | 11 | 3 | 31 | 17 |');
    expect(dailySection).not.toContain('window\\_total');
    expect(dailySection).not.toContain('| 27 | 14 | 127 | 64 |');
    expect(report).toContain('| Views | 2026-09-21 | current snapshot | 27 | observed |');
    expect(report).toContain('| Unique cloners | 2026-09-21 | current snapshot | 64 | observed |');
  });

  it('labels every rolling-window value with its own observation date', () => {
    const report = renderAdoptionReport(
      snapshot({
        measurements: [
          measurement({
            source: 'github',
            metric: 'views_window_total',
            metricDate: '2026-09-20',
            value: 27,
          }),
          measurement({
            source: 'github',
            metric: 'unique_viewers_window_total',
            metricDate: '2026-09-20',
            value: 14,
          }),
          measurement({
            source: 'github',
            metric: 'clones_window_total',
            metricDate: '2026-09-21',
            value: 127,
          }),
          measurement({
            source: 'github',
            metric: 'unique_cloners_window_total',
            metricDate: '2026-09-21',
            value: 64,
          }),
        ],
      }),
    );

    expect(report).toContain('| Views | 2026-09-20 | 1 day old | 27 | observed |');
    expect(report).toContain('| Unique viewers | 2026-09-20 | 1 day old | 14 | observed |');
    expect(report).toContain('| Clones | 2026-09-21 | current snapshot | 127 | observed |');
    expect(report).toContain('| Unique cloners | 2026-09-21 | current snapshot | 64 | observed |');
    expect(report).not.toContain('Observation date: `2026-09-21`');
  });

  it('uses only the newest version snapshot while retaining every exact version row', () => {
    const report = renderAdoptionReport(
      snapshot({
        measurements: [
          measurement({
            source: 'npm',
            metric: 'version_downloads_last_week',
            metricDate: '2026-09-20',
            dimension: '1.0.0',
            value: 999,
          }),
          ...['1.2.0', '1.1.1', '1.1.0', '1.0.0', '1.0.0-alpha.2', '1.0.0-alpha.1'].map(
            (version, index) =>
              measurement({
                source: 'npm',
                metric: 'version_downloads_last_week',
                metricDate: '2026-09-21',
                dimension: version,
                value: 60 - index * 7,
              }),
          ),
        ],
      }),
    );

    expect(report).toContain('Snapshot date: `2026-09-21`');
    expect(report).not.toContain('| 1\\.0\\.0 | 999 |');
    expect(report).toContain('| 1\\.0\\.0-alpha\\.1 | 25 | observed |');
  });

  it('uses the newest observed window value, labels its date, and excludes stale snapshots', () => {
    const current = buildAdoptionReportModel(
      snapshot({
        measurements: [
          measurement({
            source: 'github',
            metric: 'unique_cloners_window_total',
            metricDate: '2026-09-19',
            value: 9,
          }),
          measurement({
            source: 'github',
            metric: 'unique_cloners_window_total',
            metricDate: '2026-09-20',
            status: 'failed',
          }),
          measurement({
            source: 'github',
            metric: 'unique_cloners_window_total',
            metricDate: '2026-09-06',
            value: 99,
          }),
        ],
      }),
    );

    expect(current.kpis.uniqueCloners).toMatchObject({
      value: 9,
      metricDate: '2026-09-19',
    });

    const stale = buildAdoptionReportModel(
      snapshot({
        measurements: [
          measurement({
            source: 'github',
            metric: 'unique_cloners_window_total',
            metricDate: '2026-09-06',
            value: 99,
          }),
          measurement({
            source: 'npm',
            metric: 'version_downloads_last_week',
            metricDate: '2026-09-06',
            dimension: '9.9.9',
            value: 99,
          }),
        ],
      }),
    );
    expect(stale.kpis.uniqueCloners.value).toBeNull();
    expect(stale.versionSnapshot).toEqual([]);
  });

  it('renders absent and unavailable values as missing rather than zero', () => {
    const report = renderAdoptionReport(
      snapshot({
        measurements: [
          measurement({
            source: 'npm',
            metric: 'package_downloads',
            metricDate: '2026-09-20',
            status: 'rate_limited',
          }),
          measurement({
            source: 'github',
            metric: 'unique_viewers_window_total',
            metricDate: '2026-09-21',
            status: 'failed',
          }),
        ],
      }),
    );

    expect(report).toContain('| **—** | **—** | **—** | **—** |');
    expect(report).toContain('0/14 npm days observed');
    expect(report).toContain('Missing values remain `—`; they are never converted to zero');
  });

  it('reports zero public projects only after a successful empty search', () => {
    const report = renderAdoptionReport(
      snapshot({
        retrievals: [
          {
            runId: 'run-1',
            retrievedAt,
            sourceStatuses: [{ source: 'github_public_search', status: 'success' }],
          },
        ],
      }),
    );

    expect(report).toContain('| **—** | **—** | **—** | **0** |');
  });

  it('treats only independently owned repositories as external adoption', () => {
    const model = buildAdoptionReportModel(
      snapshot({
        adopters: [
          { repositoryKey: 'marcel-tuinstra/internal-app', countsAsAdopter: true },
          { repositoryKey: 'Tuinstra-DEV/wodiq', countsAsAdopter: true },
          { repositoryKey: 'tuinstra-dev-tools/external-app', countsAsAdopter: true },
          { repositoryKey: 'cezarsmpio/apple-to-garmin', countsAsAdopter: true },
          { repositoryKey: 'malformed', countsAsAdopter: true },
        ],
      }),
    );

    expect(model.adopters.map(({ repositoryKey }) => repositoryKey)).toEqual([
      'tuinstra-dev-tools/external-app',
      'cezarsmpio/apple-to-garmin',
    ]);
    expect(model.kpis.publicProjects.value).toBe(2);

    const report = renderAdoptionReport(model.snapshot);
    expect(report).toContain('External public projects with usage evidence');
    expect(report).toContain('cezarsmpio/apple-to-garmin');
    expect(report).not.toContain('marcel-tuinstra/internal-app');
    expect(report).not.toContain('Tuinstra-DEV/wodiq');
    expect(report).not.toContain('| malformed |');
  });

  it('labels the baseline boundary and overlapping raw lookback windows truthfully', () => {
    const preBaseline = renderAdoptionReport(snapshot({ metricDate: '2026-09-20' }));
    expect(preBaseline).toContain('External-adoption baseline: `2026-09-21`');
    expect(preBaseline).toContain('pre-baseline context');

    const baseline = renderAdoptionReport(snapshot());
    expect(baseline).toContain('External-adoption baseline: `2026-09-21`');
    expect(baseline).toContain('overlaps pre-baseline context');
    expect(baseline).toContain('Raw npm downloads · 14 days');
    expect(baseline).toContain('Raw unique cloners · GitHub window');
    expect(baseline).toContain('Raw signals can include CI, caches, repeat downloads');

    const fullyPostBaseline = renderAdoptionReport(snapshot({ metricDate: '2026-10-06' }));
    expect(fullyPostBaseline).not.toContain('overlaps pre-baseline context');
    expect(fullyPostBaseline).not.toContain('pre-baseline context and is not part');
  });

  it('escapes untrusted Markdown and spreadsheet-formula prefixes', () => {
    const report = renderAdoptionReport(
      snapshot({
        measurements: [
          measurement({
            source: 'npm',
            metric: 'version_downloads_last_week',
            metricDate: '2026-09-21',
            dimension: '=HYPERLINK("https://evil.example")<script>![pixel](https://evil.example)',
            value: 1,
          }),
        ],
        adopters: [
          {
            repositoryKey: 'example/app',
            repositoryState: 'active|spoof',
            declaredVersionRange:
              '=HYPERLINK("https://evil.example")<script>![pixel](https://evil.example)',
            resolvedVersion: null,
            evidenceTypes: ['sdk_import'],
            confidence: 'low',
            countsAsAdopter: false,
          },
        ],
      }),
    );

    expect(report).toContain("'=HYPERLINK");
    expect(report).toContain('&lt;script&gt;');
    expect(report).not.toContain('<script>');
    expect(report).not.toContain('![pixel](');
    expect(report).toContain('active\\|spoof');
  });

  it('keeps hostile retrieval metadata inside a bounded inline code span', () => {
    const report = renderAdoptionReport(
      snapshot({
        retrievals: [
          {
            runId: 'run-1',
            retrievedAt: '2026-09-21T10:00:00Z`\n[leak](https://evil.example)',
            sourceStatuses: [],
          },
        ],
      }),
    );

    expect(report).not.toContain('\n[leak]');
    expect(report).not.toContain('Z`\n');
    expect(report).toContain('Z [leak](https://evil.example)`.');
  });
});
