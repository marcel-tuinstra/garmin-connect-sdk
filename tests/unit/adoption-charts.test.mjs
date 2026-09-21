import { describe, expect, it } from 'vitest';

import { renderAdoptionCharts } from '../../tools/adoption/charts.mjs';

const retrievedAt = '2026-09-21T10:00:00.000Z';

function observed(source, metric, metricDate, value, dimension = null) {
  return {
    source,
    metric,
    metricDate,
    dimension,
    status: 'observed',
    value,
    unit: source === 'npm' ? 'downloads' : 'views',
    retrievedAt,
  };
}

function charts(measurements) {
  return renderAdoptionCharts({
    schemaVersion: 1,
    metricDate: '2026-09-21',
    retrievals: [],
    measurements,
    adopters: [],
  });
}

describe('adoption charts', () => {
  it('renders deterministic, accessible, theme-aware local SVGs', () => {
    const output = charts([
      observed('npm', 'package_downloads', '2026-09-19', 8),
      observed('npm', 'package_downloads', '2026-09-20', 12),
      observed('github', 'clones', '2026-09-19', 4),
      observed('github', 'views', '2026-09-19', 2),
      observed('npm', 'version_downloads_last_week', '2026-09-21', 7, '1.1.0'),
      observed('npm', 'version_downloads_last_week', '2026-09-21', 9, '1.2.0'),
    ]);

    expect(Object.keys(output)).toEqual([
      'npm-downloads.svg',
      'github-traffic.svg',
      'version-downloads.svg',
    ]);
    for (const svg of Object.values(output)) {
      expect(svg).toContain('role="img"');
      expect(svg).toContain('<title');
      expect(svg).toContain('<desc');
      expect(svg).toContain('#1A1A1A');
      expect(svg).toContain('#F3F3F3');
      expect(svg).not.toMatch(/<script|foreignObject|href=|data:|url\(/i);
    }
    expect(output['npm-downloads.svg']).toContain('#FFD83D');
    expect(output['npm-downloads.svg']).toContain('Latest');
    expect(output['github-traffic.svg']).not.toContain('#FFD83D');
    expect(output['github-traffic.svg']).toContain('stroke-dasharray');
    expect(output['github-traffic.svg']).toContain('<rect class="view-marker"');
    expect(output['version-downloads.svg']).toContain('Highest stable version observed');
  });

  it('preserves gaps for missing days and handles empty, zero, one-point, and outlier data', () => {
    const output = charts([
      observed('npm', 'package_downloads', '2026-09-18', 0),
      observed('npm', 'package_downloads', '2026-09-20', 10_000),
      observed('github', 'clones', '2026-09-19', 0),
    ]);

    expect(output['npm-downloads.svg']).toContain('10,000');
    expect(output['npm-downloads.svg']).toContain('Missing');
    expect(output['github-traffic.svg']).toContain('1 observed clone point');
    expect(output['github-traffic.svg']).toContain('No observed view data');
    expect(Object.values(output).join('')).not.toMatch(/NaN|Infinity/);

    const empty = charts([]);
    expect(empty['npm-downloads.svg']).toContain('No observed npm download data');
    expect(empty['github-traffic.svg']).toContain('No observed GitHub traffic data');
    expect(empty['version-downloads.svg']).toContain('No observed version download data');
    expect(Object.values(empty).join('')).not.toMatch(/NaN|Infinity/);
  });

  it('sorts out-of-order input and collapses chart-only overflow into Other versions', () => {
    const versions = ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'];
    const output = charts([
      observed('npm', 'package_downloads', '2026-09-20', 2),
      observed('npm', 'package_downloads', '2026-09-07', 1),
      ...versions.map((version, index) =>
        observed('npm', 'version_downloads_last_week', '2026-09-21', index + 1, version),
      ),
    ]);

    expect(output['npm-downloads.svg'].indexOf('7 Sep')).toBeLessThan(
      output['npm-downloads.svg'].indexOf('20 Sep'),
    );
    expect(output['version-downloads.svg']).toContain('Other versions');
    expect(output['version-downloads.svg']).toContain('Top 5 versions');
  });

  it('bounds and XML-escapes hostile version labels', () => {
    const hostile = `${'<script>alert("x")</script>&'.repeat(10)}${'x'.repeat(400)}`;
    const output = charts([
      observed('npm', 'version_downloads_last_week', '2026-09-21', 5, hostile),
    ])['version-downloads.svg'];

    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
    expect(output).toContain('…');
    expect(output.length).toBeLessThan(15_000);
  });

  it('keeps endpoint labels separated and low-value axes truthful', () => {
    const output = charts([
      observed('github', 'clones', '2026-09-20', 9),
      observed('github', 'views', '2026-09-20', 10),
      observed('npm', 'package_downloads', '2026-09-20', 1),
    ]);
    const traffic = output['github-traffic.svg'];
    const cloneY = Number(traffic.match(/data-endpoint="clones"[^>]* y="([0-9.]+)"/)?.[1]);
    const viewY = Number(traffic.match(/data-endpoint="views"[^>]* y="([0-9.]+)"/)?.[1]);

    expect(Math.abs(cloneY - viewY)).toBeGreaterThanOrEqual(18);
    expect(traffic).toContain('class="endpoint-leader"');
    expect(output['npm-downloads.svg']).not.toMatch(/>1<.*>1<.*>1</s);
    expect(output['npm-downloads.svg']).toContain('<line class="axis"');
  });
});
