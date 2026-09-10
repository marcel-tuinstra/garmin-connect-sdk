import { describe, expect, it } from 'vitest';

import { decodeActivityMetricRows } from '../../src/utils/activityMetrics.js';

describe('activity detail metric parser', () => {
  it('decodes every row using top-level descriptors by index', () => {
    const payload = {
      metricDescriptors: [
        { metricsIndex: 2, key: 'heartRate' },
        { metricsIndex: 0, key: 'elapsedDuration' },
        { metricsIndex: 1, key: 'cadence' },
      ],
      activityDetailMetrics: [{ metrics: [12, 84, 140] }, { metrics: [24, 85, 142] }],
    };

    expect(decodeActivityMetricRows(payload)).toEqual([
      { heartRate: 140, elapsedDuration: 12, cadence: 84 },
      { heartRate: 142, elapsedDuration: 24, cadence: 85 },
    ]);
  });

  it('uses per-row descriptors when devices or activities change channel order', () => {
    const payload = {
      metricDescriptors: [
        { metricsIndex: 0, key: 'heartRate' },
        { metricsIndex: 1, key: 'cadence' },
      ],
      activityDetailMetrics: [
        { metrics: [140, 84] },
        {
          metricDescriptors: [
            { metricsIndex: 0, key: 'cadence' },
            { metricsIndex: 1, key: 'heartRate' },
          ],
          metrics: [86, 142],
        },
      ],
    };

    expect(decodeActivityMetricRows(payload)).toEqual([
      { heartRate: 140, cadence: 84 },
      { cadence: 86, heartRate: 142 },
    ]);
  });

  it('falls back to payload descriptors when every row descriptor is unusable', () => {
    const payload = {
      metricDescriptors: [{ metricsIndex: 0, key: 'heartRate' }],
      activityDetailMetrics: [
        {
          metricDescriptors: [
            { metricsIndex: -1, key: 'negative' },
            { metricsIndex: 0.5, key: 'fractional' },
            { metricsIndex: 0, key: '__proto__' },
          ],
          metrics: [142],
        },
      ],
    };

    expect(decodeActivityMetricRows(payload)).toEqual([{ heartRate: 142 }]);
  });

  it('returns null for missing samples and out-of-range valid indexes', () => {
    const payload = {
      metricDescriptors: [
        { metricsIndex: 0, key: 'heartRate' },
        { metricsIndex: 2, key: 'power' },
        { metricsIndex: 3, key: 'speed' },
      ],
      activityDetailMetrics: [{ metrics: [null] }, { metrics: [141, 220] }],
    };

    expect(decodeActivityMetricRows(payload)).toEqual([
      { heartRate: null, power: null, speed: null },
      { heartRate: 141, power: null, speed: null },
    ]);
  });

  it('ignores missing, fractional, negative, and unsafe descriptor indexes or keys', () => {
    const payload = {
      metricDescriptors: [
        { key: 'missingIndex' },
        { metricsIndex: 1.5, key: 'fractional' },
        { metricsIndex: -1, key: 'negative' },
        { metricsIndex: 0, key: '__proto__' },
        { metricsIndex: 1, key: 'constructor' },
        { metricsIndex: 2, key: 'prototype' },
        { metricsIndex: 0, key: 'heartRate' },
        { metricsIndex: 2, key: 'heartRate' },
      ],
      activityDetailMetrics: [{ metrics: [150, 151, 152] }],
    };

    const rows = decodeActivityMetricRows(payload);
    expect(rows).toEqual([{ heartRate: 150 }]);
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('redacts location-like channels unless explicitly opted in and leaves duration keys separate', () => {
    const payload = {
      metricDescriptors: [
        { metricsIndex: 0, key: 'directLatitude' },
        { metricsIndex: 1, key: 'directLongitude' },
        { metricsIndex: 2, key: 'duration' },
        { metricsIndex: 3, key: 'elapsedDuration' },
      ],
      activityDetailMetrics: [{ metrics: [52.1, 5.7, 10, 8] }],
    };

    expect(decodeActivityMetricRows(payload)).toEqual([
      {
        directLatitude: '[REDACTED]',
        directLongitude: '[REDACTED]',
        duration: 10,
        elapsedDuration: 8,
      },
    ]);
    expect(decodeActivityMetricRows(payload, { redactLocation: false })).toEqual([
      { directLatitude: 52.1, directLongitude: 5.7, duration: 10, elapsedDuration: 8 },
    ]);
  });

  it('handles absent channels, malformed details, null rows, and empty payloads deterministically', () => {
    expect(decodeActivityMetricRows({})).toEqual([]);
    expect(decodeActivityMetricRows(null)).toEqual([]);
    expect(
      decodeActivityMetricRows({
        metricDescriptors: [{ metricsIndex: 0, key: 'heartRate' }],
        activityDetailMetrics: [null, 'not-a-row', {}, { metrics: null }, { metrics: [] }],
      }),
    ).toEqual([{}]);
  });

  it('does not mutate the supplied payload', () => {
    const payload = {
      metricDescriptors: [{ metricsIndex: 0, key: 'heartRate' }],
      activityDetailMetrics: [{ metrics: [142] }],
    };
    const before = structuredClone(payload);

    decodeActivityMetricRows(payload);

    expect(payload).toEqual(before);
  });
});
