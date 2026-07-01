import { describe, expect, it } from 'vitest';

import {
  decodeActivityMetricRow,
  normalizeMetricDescriptors,
  summarizeActivityDetails,
  summarizeActivityHeartRateShape,
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

  it('counts heart-rate samples from activity detail metric rows', () => {
    // Arrange
    const detailsPayload = {
      metricDescriptors: [
        { metricsIndex: 0, key: 'sampleTime', unit: { key: 's' } },
        { metricsIndex: 1, key: 'directHeartRate', unit: { key: 'bpm' } },
      ],
      activityDetailMetrics: [
        { metrics: [0, 120] },
        { metrics: [30, 130] },
        { metrics: [60, null] },
      ],
    };

    // Act
    const details = summarizeActivityDetails(detailsPayload);

    // Assert
    expect(details).toMatchObject({
      metricRows: 3,
      metricDescriptorCount: 2,
      heartRateSamples: 2,
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

  it('returns no heart-rate shape samples for empty or non-object details', () => {
    // Act
    const nonObject = summarizeActivityHeartRateShape(null);
    const empty = summarizeActivityHeartRateShape({});

    // Assert
    expect(nonObject).toMatchObject({
      hasHeartRateSamples: false,
      sampleCount: 0,
      hasTimestampOrOffset: false,
      sampleShape: 'unknown',
      descriptorKeys: [],
    });
    expect(empty).toMatchObject({
      hasHeartRateSamples: false,
      sampleCount: 0,
      sampleShape: 'unknown',
    });
  });

  it('detects heartRateDTO timestamp tuple samples without returning raw samples', () => {
    // Arrange
    const details = {
      heartRateDTO: {
        heartRateValues: [
          [1_778_565_600_000, 142],
          [1_778_565_660_000, 145],
        ],
      },
    };

    // Act
    const shape = summarizeActivityHeartRateShape(details);

    // Assert
    expect(shape).toMatchObject({
      hasHeartRateSamples: true,
      sampleCount: 2,
      hasTimestampOrOffset: true,
      sampleShape: 'timestamp-value',
      firstSampleOffsetSecondsAvailable: false,
    });
    expect(JSON.stringify(shape)).not.toContain('1778565600000');
    expect(JSON.stringify(shape)).not.toContain('142');
  });

  it('merges heartRateDTOs offset tuple samples', () => {
    // Arrange
    const details = {
      heartRateDTOs: [
        { heartRateValues: [[0, 101]] },
        { heartRateValues: [[30, 111], [60, 121]] },
      ],
    };

    // Act
    const shape = summarizeActivityHeartRateShape(details);

    // Assert
    expect(shape).toMatchObject({
      hasHeartRateSamples: true,
      sampleCount: 3,
      hasTimestampOrOffset: true,
      sampleShape: 'offset-value',
      firstSampleOffsetSecondsAvailable: true,
    });
  });

  it('detects metric-row heart-rate samples with timestamp descriptors', () => {
    // Arrange
    const details = {
      metricDescriptors: [
        { metricsIndex: 0, key: 'sampleTime', unit: { key: 's' } },
        { metricsIndex: 1, key: 'directHeartRate', unit: { key: 'bpm' } },
      ],
      activityDetailMetrics: [
        { metrics: [0, 120] },
        { metrics: [30, 130] },
      ],
    };

    // Act
    const shape = summarizeActivityHeartRateShape(details);

    // Assert
    expect(shape).toMatchObject({
      hasHeartRateSamples: true,
      sampleCount: 2,
      hasTimestampOrOffset: true,
      sampleShape: 'metric-row',
      firstSampleOffsetSecondsAvailable: true,
      descriptorKeys: ['directHeartRate', 'sampleTime'],
    });
  });

  it('omits location descriptors from heart-rate shape output', () => {
    // Arrange
    const details = {
      metricDescriptors: [
        { metricsIndex: 0, key: 'elapsedDuration' },
        { metricsIndex: 1, key: 'directHeartRate' },
        { metricsIndex: 2, key: 'directLatitude' },
        { metricsIndex: 3, key: 'directLongitude' },
      ],
      activityDetailMetrics: [{ metrics: [30, 142, 52.1, 5.7] }],
    };

    // Act
    const shape = summarizeActivityHeartRateShape(details);
    const serialized = JSON.stringify(shape);

    // Assert
    expect(shape.descriptorKeys).toEqual(['directHeartRate', 'elapsedDuration']);
    expect(serialized).not.toContain('directLatitude');
    expect(serialized).not.toContain('directLongitude');
    expect(serialized).not.toContain('52.1');
    expect(serialized).not.toContain('5.7');
  });

  it('marks unknown shape when metric-row heart rate exists without timing descriptors', () => {
    // Arrange
    const details = {
      metricDescriptors: [{ metricsIndex: 0, key: 'hr', unit: { key: 'bpm' } }],
      activityDetailMetrics: [{ metrics: [155] }],
    };

    // Act
    const shape = summarizeActivityHeartRateShape(details);

    // Assert
    expect(shape).toMatchObject({
      hasHeartRateSamples: true,
      sampleCount: 1,
      hasTimestampOrOffset: false,
      sampleShape: 'unknown',
      descriptorKeys: ['hr'],
    });
  });

  it('keeps heart-rate shape output summary-only and raw-payload-free', () => {
    // Arrange
    const details = {
      activityId: 123456789,
      activityDetailMetrics: [
        {
          metricDescriptors: [
            { metricsIndex: 0, key: 'offsetSeconds' },
            { metricsIndex: 1, key: 'directHeartRate' },
            { metricsIndex: 2, key: 'directLatitude' },
          ],
          metrics: [45, 177, 52.12345],
        },
      ],
    };

    // Act
    const serialized = JSON.stringify(summarizeActivityHeartRateShape(details));

    // Assert
    expect(serialized).not.toContain('123456789');
    expect(serialized).not.toContain('177');
    expect(serialized).not.toContain('52.12345');
    expect(serialized).not.toContain('metrics');
  });
});
