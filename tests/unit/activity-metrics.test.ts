import { describe, expect, it } from 'vitest';

import {
  decodeActivityMetricRow,
  normalizeMetricDescriptors,
  summarizeActivityDetails,
  summarizeActivitySplits,
} from '../../src/utils/activityMetrics.js';
import { activityDetailsPayload, activitySplitsPayload } from '../fixtures/garminPayloads.js';

describe('activity metrics', () => {
  it('normalizes descriptors and decodes metric rows with location redaction by default', () => {
    const descriptors = normalizeMetricDescriptors([
      { metricsIndex: 0, key: 'directHeartRate', unit: { key: 'bpm' } },
      { metricsIndex: 1, key: 'directLatitude', unit: { key: 'dd' } },
      { metricsIndex: 2, key: 'directLongitude', unit: { key: 'dd' } },
    ]);

    expect(decodeActivityMetricRow([142, 52.1, 5.7], descriptors)).toEqual({
      directHeartRate: 142,
      directLatitude: '[REDACTED]',
      directLongitude: '[REDACTED]',
    });
  });

  it('can decode location metrics when explicitly requested', () => {
    const descriptors = normalizeMetricDescriptors([
      { metricsIndex: 0, key: 'directLatitude' },
      { metricsIndex: 1, key: 'directLongitude' },
    ]);

    expect(decodeActivityMetricRow([52.1, 5.7], descriptors, { redactLocation: false })).toEqual({
      directLatitude: 52.1,
      directLongitude: 5.7,
    });
  });

  it('summarizes activity details and splits', () => {
    const details = summarizeActivityDetails(activityDetailsPayload);
    const splits = summarizeActivitySplits(activitySplitsPayload);

    expect(details).toMatchObject({
      metricRows: 1,
      metricDescriptorCount: 2,
      hasPolyline: false,
    });
    expect(splits).toMatchObject({
      count: 1,
      splitTypes: ['INTERVAL_ACTIVE'],
    });
  });
});
