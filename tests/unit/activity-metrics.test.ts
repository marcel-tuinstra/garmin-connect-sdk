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
    // Arrange
    const descriptors = normalizeMetricDescriptors([
      { metricsIndex: 0, key: 'directHeartRate', unit: { key: 'bpm' } },
      { metricsIndex: 1, key: 'directLatitude', unit: { key: 'dd' } },
      { metricsIndex: 2, key: 'directLongitude', unit: { key: 'dd' } },
    ]);

    // Act
    const row = decodeActivityMetricRow([142, 52.1, 5.7], descriptors);

    // Assert
    expect(row).toEqual({
      directHeartRate: 142,
      directLatitude: '[REDACTED]',
      directLongitude: '[REDACTED]',
    });
  });

  it('can decode location metrics when explicitly requested', () => {
    // Arrange
    const descriptors = normalizeMetricDescriptors([
      { metricsIndex: 0, key: 'directLatitude' },
      { metricsIndex: 1, key: 'directLongitude' },
    ]);

    // Act
    const row = decodeActivityMetricRow([52.1, 5.7], descriptors, { redactLocation: false });

    // Assert
    expect(row).toEqual({
      directLatitude: 52.1,
      directLongitude: 5.7,
    });
  });

  it('summarizes activity details and splits', () => {
    // Act
    const details = summarizeActivityDetails(activityDetailsPayload);
    const splits = summarizeActivitySplits(activitySplitsPayload);

    // Assert
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

  it('handles missing descriptors and non-object payloads conservatively', () => {
    // Arrange
    const descriptors = normalizeMetricDescriptors([
      null,
      { metricsIndex: 0 },
      { metricsIndex: 1, metricsKey: 'directSpeed' },
      { key: 'missingIndex' },
    ]);

    // Act
    const row = decodeActivityMetricRow([3.2], descriptors);
    const detailsSummary = summarizeActivityDetails(null);
    const splitsSummary = summarizeActivitySplits('bad');

    // Assert
    expect(descriptors).toEqual([
      { index: 1, key: 'directSpeed', unit: undefined },
      { key: 'missingIndex' },
    ]);
    expect(row).toEqual({ directSpeed: null });
    expect(detailsSummary).toEqual({ type: 'object' });
    expect(splitsSummary).toEqual({ type: 'string' });
  });
});
