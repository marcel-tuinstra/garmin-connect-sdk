import { describe, expect, it } from 'vitest';

import {
  decodeActivityMetricRows,
  summarizeActivityDetails,
} from '../../src/utils/activityMetrics.js';
import type {
  ActivityDetailsSummary,
  DecodeActivityMetricOptions,
} from '../../src/utils/activityMetrics.js';

describe('activity summary row descriptors', () => {
  it('matches reordered first-row descriptors and keeps location redacted by default', () => {
    // Arrange
    const payload = {
      metricDescriptors: [
        { metricsIndex: 0, key: 'heartRate' },
        { metricsIndex: 1, key: 'directLatitude' },
      ],
      activityDetailMetrics: [
        {
          metricDescriptors: [
            { metricsIndex: 0, key: 'directLatitude' },
            { metricsIndex: 1, key: 'heartRate' },
          ],
          metrics: [52.1, 142],
        },
      ],
    };

    // Act
    const summary = summaryFor(payload);
    const decoded = decodeActivityMetricRows(payload);
    const privateSummary = summaryFor(payload, { redactLocation: false });
    const privateDecoded = decodeActivityMetricRows(payload, { redactLocation: false });

    // Assert
    expect(summary.firstMetricRow).toEqual(decoded[0]);
    expect(summary.firstMetricRow).toEqual({
      directLatitude: '[REDACTED]',
      heartRate: 142,
    });
    expect(JSON.stringify(summary.firstMetricRow)).not.toContain('52.1');
    expect(privateSummary.firstMetricRow).toEqual(privateDecoded[0]);
    expect(privateSummary.firstMetricRow).toEqual({ directLatitude: 52.1, heartRate: 142 });
  });

  it('keeps later descriptor changes out of firstMetricRow while preserving aggregates', () => {
    // Arrange
    const payload = {
      metricDescriptors: [{ metricsIndex: 0, key: 'heartRate' }],
      activityDetailMetrics: [
        {
          metricDescriptors: [{ metricsIndex: 0, key: 'cadence' }],
          metrics: [88],
        },
        {
          metricDescriptors: [{ metricsIndex: 0, key: 'power' }],
          metrics: [250],
        },
        {
          metricDescriptors: [{ metricsIndex: 0, key: 'speed' }],
          metrics: [3.5],
        },
      ],
    };

    // Act
    const summary = summaryFor(payload);
    const decoded = decodeActivityMetricRows(payload);

    // Assert
    expect(summary.firstMetricRow).toEqual(decoded[0]);
    expect(summary.firstMetricRow).toEqual({ cadence: 88 });
    expect(summary.metricRows).toBe(3);
    expect(summary.metricDescriptorCount).toBe(4);
    expect(summary.metricDescriptors.map((descriptor) => descriptor.key)).toEqual([
      'heartRate',
      'cadence',
      'power',
      'speed',
    ]);
  });

  it.each([
    ['missing', undefined, { heartRate: 142 }],
    ['empty', [], { heartRate: 142 }],
    [
      'all unusable',
      [
        { metricsIndex: -1, key: 'negative' },
        { metricsIndex: 0.5, key: 'fractional' },
        { metricsIndex: 0, key: '__proto__' },
      ],
      { heartRate: 142 },
    ],
    [
      'partially usable',
      [
        { metricsIndex: 0, key: 'cadence' },
        { metricsIndex: -1, key: 'invalid' },
      ],
      { cadence: 142 },
    ],
    ['out-of-range but usable', [{ metricsIndex: 3, key: 'cadence' }], { cadence: null }],
  ] as const)(
    'uses the correct fallback rule for %s row descriptors',
    (_label, rowDescriptors, expected) => {
      // Arrange
      const row: Record<string, unknown> = { metrics: [142] };
      if (rowDescriptors !== undefined) row.metricDescriptors = rowDescriptors;
      const payload = {
        metricDescriptors: [{ metricsIndex: 0, key: 'heartRate' }],
        activityDetailMetrics: [row],
      };

      // Act
      const summary = summaryFor(payload);
      const decoded = decodeActivityMetricRows(payload);

      // Assert
      expect(summary.firstMetricRow).toEqual(decoded[0]);
      expect(summary.firstMetricRow).toEqual(expected);
    },
  );

  it('uses the first decodable row and preserves an explicitly empty metrics row', () => {
    // Arrange
    const payload = {
      metricDescriptors: [{ metricsIndex: 0, key: 'heartRate' }],
      activityDetailMetrics: [
        null,
        'bad-row',
        {},
        { metrics: null },
        { metrics: [] },
        { metrics: [142] },
      ],
    };

    // Act
    const summary = summaryFor(payload);
    const decoded = decodeActivityMetricRows(payload);

    // Assert
    expect(decoded).toEqual([{}, { heartRate: 142 }]);
    expect(summary.firstMetricRow).toEqual(decoded[0]);
    expect(summary.firstMetricRow).toEqual({});
  });

  it('keeps null when no metric row is decodable', () => {
    // Arrange
    const payload = {
      metricDescriptors: [{ metricsIndex: 0, key: 'heartRate' }],
      activityDetailMetrics: [null, 'bad-row', {}, { metrics: null }],
    };

    // Act / Assert
    expect(decodeActivityMetricRows(payload)).toEqual([]);
    expect(summaryFor(payload).firstMetricRow).toBeNull();
  });

  it('keeps top-level-only descriptor behavior unchanged', () => {
    // Arrange
    const payload = {
      metricDescriptors: [
        { metricsIndex: 1, key: 'heartRate' },
        { metricsIndex: 0, key: 'elapsedDuration' },
      ],
      activityDetailMetrics: [{ metrics: [30, 145] }],
    };

    // Act
    const summary = summaryFor(payload);
    const decoded = decodeActivityMetricRows(payload);

    // Assert
    expect(summary.firstMetricRow).toEqual(decoded[0]);
    expect(summary.firstMetricRow).toEqual({ heartRate: 145, elapsedDuration: 30 });
    expect(summary.metricDescriptorCount).toBe(2);
  });
});

function summaryFor(
  payload: Record<string, unknown>,
  options: DecodeActivityMetricOptions = {},
): ActivityDetailsSummary {
  const summary = summarizeActivityDetails(payload, options);
  if ('type' in summary) throw new Error('Expected an activity details summary.');
  return summary;
}
