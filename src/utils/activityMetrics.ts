export interface ActivityMetricDescriptor {
  index?: number;
  key: string;
  unit?: string;
}

export type DecodedActivityMetricRow = Record<string, unknown>;

export type ActivityHeartRateSampleShape =
  | 'timestamp-value'
  | 'offset-value'
  | 'metric-row'
  | 'unknown';

export interface ActivityHeartRateShapeSummary {
  hasHeartRateSamples: boolean;
  sampleCount: number;
  hasTimestampOrOffset: boolean;
  sampleShape: ActivityHeartRateSampleShape;
  descriptorKeys: string[];
  firstSampleOffsetSecondsAvailable: boolean;
  notes: string[];
}

export interface ActivityDetailsSummary {
  detailsAvailable?: boolean;
  measurementCount?: number;
  metricsCount?: number;
  totalMetricsCount?: number;
  metricRows: number;
  metricDescriptorCount: number;
  metricDescriptors: ActivityMetricDescriptor[];
  firstMetricRow: DecodedActivityMetricRow | null;
  hasPolyline: boolean;
  polylinePoints: number;
  heartRateSamples: number;
  powerSamples: number;
  speedSamples: number;
  topLevelKeys: string[];
}

export interface ActivitySplitsSummary {
  count: number;
  typedSplits?: number;
  splitSummaries?: number;
  splits?: number;
  splitTypes: string[];
  topLevelKeys?: string[];
}

export interface DecodeActivityMetricOptions {
  redactLocation?: boolean;
}

export function summarizeActivityDetails(
  details: unknown,
  options: DecodeActivityMetricOptions = {},
): ActivityDetailsSummary | { type: string } {
  if (!isObject(details)) return { type: typeof details };

  const metrics = arrayValue(details.activityDetailMetrics);
  const descriptors = arrayValue(details.metricDescriptors).concat(
    metrics.flatMap((metric) => arrayValue(objectValue(metric)?.metricDescriptors)),
  );
  const metricDescriptors = normalizeMetricDescriptors(descriptors);

  const geoPolyline = arrayValue(objectValue(details.geoPolylineDTO)?.polyline);
  const heartRateValues = arrayValue(objectValue(details.heartRateDTO)?.heartRateValues).concat(
    arrayValue(details.heartRateDTOs).flatMap((dto) => arrayValue(objectValue(dto)?.heartRateValues)),
  );
  const powerValues = arrayValue(objectValue(details.powerDTO)?.powerValues).concat(
    arrayValue(details.powerDTOs).flatMap((dto) => arrayValue(objectValue(dto)?.powerValues)),
  );
  const speedValues = arrayValue(objectValue(details.speedDTO)?.speedValues).concat(
    arrayValue(details.speedDTOs).flatMap((dto) => arrayValue(objectValue(dto)?.speedValues)),
  );
  const firstMetric = isObject(metrics[0]) ? arrayValue(metrics[0].metrics) : [];

  return {
    detailsAvailable: booleanValue(details.detailsAvailable),
    measurementCount: numberValue(details.measurementCount),
    metricsCount: numberValue(details.metricsCount),
    totalMetricsCount: numberValue(details.totalMetricsCount),
    metricRows: metrics.length,
    metricDescriptorCount: metricDescriptors.length,
    metricDescriptors,
    firstMetricRow:
      firstMetric.length > 0
        ? decodeActivityMetricRow(firstMetric, metricDescriptors, options)
        : null,
    hasPolyline: geoPolyline.length > 0,
    polylinePoints: geoPolyline.length,
    heartRateSamples: heartRateValues.length,
    powerSamples: powerValues.length,
    speedSamples: speedValues.length,
    topLevelKeys: Object.keys(details).sort(),
  };
}

export function summarizeActivitySplits(
  splits: unknown,
): ActivitySplitsSummary | { type: string } {
  if (Array.isArray(splits)) {
    return {
      count: splits.length,
      splitTypes: uniqueStrings(splits.map((split) => stringValue(split.splitType))),
    };
  }

  if (!isObject(splits)) return { type: typeof splits };

  const typedSplits = arrayValue(splits.typedSplits);
  const splitSummaries = arrayValue(splits.splitSummaries);
  const splitsArray = arrayValue(splits.splits);
  return {
    count: typedSplits.length || splitSummaries.length || splitsArray.length,
    typedSplits: typedSplits.length,
    splitSummaries: splitSummaries.length,
    splits: splitsArray.length,
    splitTypes: uniqueStrings(
      typedSplits
        .concat(splitSummaries)
        .concat(splitsArray)
        .map((split) => {
          const value = objectValue(split);
          return stringValue(value?.splitType) ?? stringValue(value?.type);
        }),
    ),
    topLevelKeys: Object.keys(splits).sort(),
  };
}

export function summarizeActivityHeartRateShape(details: unknown): ActivityHeartRateShapeSummary {
  if (!isObject(details)) {
    return heartRateShapeSummary({
      notes: ['Activity details payload is not an object.'],
    });
  }

  const metrics = arrayValue(details.activityDetailMetrics);
  const metricDescriptors = collectMetricDescriptors(details, metrics);
  const publicDescriptors = metricDescriptors.filter((descriptor) => !isLocationMetric(descriptor.key));
  const heartRateDescriptors = publicDescriptors.filter((descriptor) => isHeartRateMetric(descriptor.key));
  const timeDescriptors = publicDescriptors.filter((descriptor) => isTimeOrOffsetMetric(descriptor.key));
  const dtoSamples = collectHeartRateValueSamples(details);
  const tupleShape = classifyTupleSamples(dtoSamples);
  const metricRowHrSamples = countMetricRowsWithHeartRate(metrics, heartRateDescriptors);
  const hasMetricRowTiming = heartRateDescriptors.length > 0 && timeDescriptors.length > 0;
  const notes: string[] = [];

  if (dtoSamples.length > 0) notes.push('Heart-rate tuple samples found in activity detail DTOs.');
  if (metricRowHrSamples > 0) notes.push('Heart-rate samples found in activity detail metric rows.');
  if (heartRateDescriptors.length > 0 && timeDescriptors.length === 0) {
    notes.push('Heart-rate metric descriptors were present without timestamp or offset descriptors.');
  }
  if (metricDescriptors.length !== publicDescriptors.length) {
    notes.push('Location-like metric descriptors were omitted from descriptorKeys.');
  }
  if (dtoSamples.length === 0 && metricRowHrSamples === 0) {
    notes.push('No heart-rate time-series samples were detected.');
  }

  const hasTimestampOrOffset =
    tupleShape === 'timestamp-value' || tupleShape === 'offset-value' || hasMetricRowTiming;
  const firstTupleShape = classifyTupleSamples(dtoSamples.slice(0, 1));
  const sampleShape = chooseHeartRateSampleShape(tupleShape, metricRowHrSamples, hasMetricRowTiming);

  return heartRateShapeSummary({
    hasHeartRateSamples: dtoSamples.length + metricRowHrSamples > 0,
    sampleCount: dtoSamples.length + metricRowHrSamples,
    hasTimestampOrOffset,
    sampleShape,
    descriptorKeys: uniqueStrings(publicDescriptors.map((descriptor) => descriptor.key)).sort(),
    firstSampleOffsetSecondsAvailable:
      firstTupleShape === 'offset-value' || (dtoSamples.length === 0 && hasMetricRowTiming),
    notes,
  });
}

export function normalizeMetricDescriptors(descriptors: unknown[]): ActivityMetricDescriptor[] {
  return descriptors
    .reduce<ActivityMetricDescriptor[]>((normalized, descriptor) => {
      const value = objectValue(descriptor);
      if (!value) return normalized;

      const key = stringValue(value.key) ?? stringValue(value.metricsKey);
      if (!key) return normalized;

      normalized.push({
        index: numberValue(value.metricsIndex),
        key,
        unit: stringValue(objectValue(value.unit)?.key),
      });
      return normalized;
    }, []);
}

export function decodeActivityMetricRow(
  values: unknown[],
  descriptors: ActivityMetricDescriptor[],
  options: DecodeActivityMetricOptions = {},
): DecodedActivityMetricRow {
  const output: DecodedActivityMetricRow = {};

  for (const descriptor of descriptors) {
    if (descriptor.index === undefined) continue;
    if (options.redactLocation !== false && isLocationMetric(descriptor.key)) {
      output[descriptor.key] = '[REDACTED]';
      continue;
    }
    output[descriptor.key] = values[descriptor.index] ?? null;
  }

  return output;
}

function isLocationMetric(key: string): boolean {
  return key.toLowerCase().includes('latitude') || key.toLowerCase().includes('longitude');
}

function isHeartRateMetric(key: string): boolean {
  const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
  return normalized.includes('heartrate') || normalized === 'hr' || normalized.endsWith('hr');
}

function isTimeOrOffsetMetric(key: string): boolean {
  return /timestamp|starttime|elapsed|duration|timer|offset|seconds|sampletime/i.test(
    key.replace(/[_\-\s]/g, ''),
  );
}

function collectMetricDescriptors(
  details: Record<string, unknown>,
  metrics: unknown[],
): ActivityMetricDescriptor[] {
  return normalizeMetricDescriptors(
    arrayValue(details.metricDescriptors).concat(
      metrics.flatMap((metric) => arrayValue(objectValue(metric)?.metricDescriptors)),
    ),
  );
}

function collectHeartRateValueSamples(details: Record<string, unknown>): unknown[] {
  return arrayValue(objectValue(details.heartRateDTO)?.heartRateValues).concat(
    arrayValue(details.heartRateDTOs).flatMap((dto) => arrayValue(objectValue(dto)?.heartRateValues)),
  );
}

function classifyTupleSamples(samples: unknown[]): ActivityHeartRateSampleShape {
  for (const sample of samples) {
    if (!Array.isArray(sample) || sample.length < 2) continue;
    const first = sample[0];
    if (typeof first !== 'number' || !Number.isFinite(first)) continue;
    return first > 1_000_000_000 ? 'timestamp-value' : 'offset-value';
  }
  return 'unknown';
}

function countMetricRowsWithHeartRate(
  metrics: unknown[],
  heartRateDescriptors: ActivityMetricDescriptor[],
): number {
  const heartRateIndexes = heartRateDescriptors
    .map((descriptor) => descriptor.index)
    .filter((index): index is number => index !== undefined);
  if (heartRateIndexes.length === 0) return 0;

  return metrics.filter((metric) => {
    const values = arrayValue(objectValue(metric)?.metrics);
    return heartRateIndexes.some((index) => numberValue(values[index]) !== undefined);
  }).length;
}

function chooseHeartRateSampleShape(
  tupleShape: ActivityHeartRateSampleShape,
  metricRowHrSamples: number,
  hasMetricRowTiming: boolean,
): ActivityHeartRateSampleShape {
  if (tupleShape !== 'unknown') return tupleShape;
  if (metricRowHrSamples > 0 && hasMetricRowTiming) return 'metric-row';
  return 'unknown';
}

function heartRateShapeSummary(
  overrides: Partial<ActivityHeartRateShapeSummary> = {},
): ActivityHeartRateShapeSummary {
  return {
    hasHeartRateSamples: false,
    sampleCount: 0,
    hasTimestampOrOffset: false,
    sampleShape: 'unknown',
    descriptorKeys: [],
    firstSampleOffsetSecondsAvailable: false,
    notes: [],
    ...overrides,
  };
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
