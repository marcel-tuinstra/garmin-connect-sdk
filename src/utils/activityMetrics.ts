export interface ActivityMetricDescriptor {
  index?: number;
  key: string;
  unit?: string;
}

export type DecodedActivityMetricRow = Record<string, unknown>;

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
