#!/usr/bin/env node
/* global console, process */
import {
  createGarminFromCli,
  createPrompt,
  formatDate,
  numberFlag,
  parseArgs,
  writeJson,
} from './garmin-cli-utils.mjs';

const rl = createPrompt();

try {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help' || flags.help) {
    printHelp();
    process.exit(0);
  }

  const { garmin, restoredSession } = await createGarminFromCli(rl);

  switch (command) {
    case 'profile': {
      const profile = await garmin.user.getProfile();
      writeJson({
        restoredSession,
        profile: true,
        displayNamePresent: Boolean(profile.displayName),
        idPresent: Boolean(profile.id),
      });
      break;
    }

    case 'devices': {
      const devices = await garmin.devices.list();
      writeJson({
        restoredSession,
        count: devices.length,
        devices: devices.map((device) => ({
          productDisplayName: device.productDisplayName ?? null,
          hasDeviceId: Boolean(device.deviceId),
          hasUnitId: Boolean(device.unitId),
        })),
      });
      break;
    }

    case 'activities': {
      const limit = numberFlag(flags, 'limit', 10);
      const start = numberFlag(flags, 'start', 0);
      const activities = await garmin.activities.list({
        start,
        limit,
        activityType: typeof flags.type === 'string' ? flags.type : undefined,
      });
      writeJson({
        restoredSession,
        count: activities.length,
        activities: activities.map((activity) => ({
          id: activity.activityId,
          name: activity.activityName ?? null,
          type: activity.activityType?.typeKey ?? null,
          start: activity.startTimeLocal ?? null,
          distance: activity.distance ?? null,
          duration: activity.duration ?? null,
        })),
      });
      break;
    }

    case 'activity': {
      if (typeof flags.id !== 'string') {
        throw new Error('Missing required --id for activity command.');
      }

      const activity = await garmin.activities.get(flags.id);
      const includeDetails = Boolean(flags.details) || Boolean(flags.raw);
      const [details, splits] = includeDetails
        ? await Promise.all([
            garmin.activities.getDetails(flags.id, {
              maxChartSize: numberFlag(flags, 'max-chart-size', 2000),
              maxPolylineSize: numberFlag(flags, 'max-polyline-size', 2000),
            }),
            garmin.activities.getSplits(flags.id),
          ])
        : [null, null];

      writeJson({
        restoredSession,
        activity: {
          id: activity.activityId,
          name: activity.activityName ?? null,
          type: activity.activityType?.typeKey ?? null,
          summary: activity.summaryDTO
            ? {
                distance: activity.summaryDTO.distance ?? null,
                duration: activity.summaryDTO.duration ?? null,
                start: activity.summaryDTO.startTimeLocal ?? null,
                averageHR: activity.summaryDTO.averageHR ?? null,
                maxHR: activity.summaryDTO.maxHR ?? null,
                calories: activity.summaryDTO.calories ?? null,
              }
            : null,
          details: details ? summarizeActivityDetails(details) : undefined,
          splits: splits ? summarizeSplits(splits) : undefined,
          raw: flags.raw ? { activity, details, splits } : undefined,
        },
      });
      break;
    }

    case 'sleep': {
      const date = typeof flags.date === 'string' ? flags.date : formatDate(new Date());
      const sleep = await garmin.sleep.getDailySleep(date);
      writeJson({
        restoredSession,
        date,
        sleep: Boolean(sleep),
        calendarDate: sleep.dailySleepDTO?.calendarDate ?? null,
        sleepTimeSeconds: sleep.dailySleepDTO?.sleepTimeSeconds ?? null,
      });
      break;
    }

    case 'body-battery': {
      const date = typeof flags.date === 'string' ? flags.date : formatDate(new Date());
      const bodyBattery = await garmin.health.getBodyBattery(date);
      writeJson({
        restoredSession,
        date,
        bodyBattery: Boolean(bodyBattery),
        records: Array.isArray(bodyBattery) ? bodyBattery.length : 1,
      });
      break;
    }

    default:
      throw new Error(`Unknown command "${command}". Run "pnpm garmin -- help".`);
  }
} finally {
  rl.close();
}

function printHelp() {
  console.log(`Garmin Connect SDK manual test CLI

Usage:
  pnpm garmin -- profile
  pnpm garmin -- devices
  pnpm garmin -- activities [--limit 10] [--start 0] [--type running]
  pnpm garmin -- activity --id <activityId> [--details] [--raw]
  pnpm garmin -- sleep [--date YYYY-MM-DD]
  pnpm garmin -- body-battery [--date YYYY-MM-DD]

Auth:
  Restores GARMIN_TOKEN_PATH or ./.garmin-tokens first.
  If no valid session exists, prompts for email, password, and MFA when needed.
  GARMIN_EMAIL, GARMIN_PASSWORD, and GARMIN_MFA_CODE can be set for non-interactive use.

Output:
  JSON summaries by default. Raw Garmin payloads are printed only with --raw.
`);
}

function summarizeActivityDetails(details) {
  if (!isObject(details)) return { type: typeof details };

  const metrics = arrayValue(details.activityDetailMetrics);
  const descriptors = arrayValue(details.metricDescriptors).concat(
    metrics.flatMap((metric) => arrayValue(metric.metricDescriptors)),
  );
  const metricDescriptors = descriptors
    .map((descriptor) => ({
      index: numberValue(descriptor.metricsIndex),
      key: stringValue(descriptor.key) ?? stringValue(descriptor.metricsKey) ?? null,
      unit: isObject(descriptor.unit) ? stringValue(descriptor.unit.key) ?? null : null,
    }))
    .filter((descriptor) => descriptor.key);

  const geoPolyline = arrayValue(details.geoPolylineDTO?.polyline);
  const heartRateValues = arrayValue(details.heartRateDTO?.heartRateValues).concat(
    arrayValue(details.heartRateDTOs).flatMap((dto) => arrayValue(dto.heartRateValues)),
  );
  const powerValues = arrayValue(details.powerDTO?.powerValues).concat(
    arrayValue(details.powerDTOs).flatMap((dto) => arrayValue(dto.powerValues)),
  );
  const speedValues = arrayValue(details.speedDTO?.speedValues).concat(
    arrayValue(details.speedDTOs).flatMap((dto) => arrayValue(dto.speedValues)),
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
    firstMetricRow: firstMetric.length > 0 ? mapMetricRow(firstMetric, metricDescriptors) : null,
    hasPolyline: geoPolyline.length > 0,
    polylinePoints: geoPolyline.length,
    heartRateSamples: heartRateValues.length,
    powerSamples: powerValues.length,
    speedSamples: speedValues.length,
    topLevelKeys: Object.keys(details).sort(),
  };
}

function summarizeSplits(splits) {
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
        .map((split) => stringValue(split.splitType) ?? stringValue(split.type)),
    ),
    topLevelKeys: Object.keys(splits).sort(),
  };
}

function mapMetricRow(values, descriptors) {
  const output = {};
  for (const descriptor of descriptors) {
    if (descriptor.index === undefined || !descriptor.key) continue;
    if (isLocationMetric(descriptor.key)) {
      output[descriptor.key] = '[REDACTED]';
      continue;
    }
    output[descriptor.key] = values[descriptor.index] ?? null;
  }
  return output;
}

function isLocationMetric(key) {
  return key.toLowerCase().includes('latitude') || key.toLowerCase().includes('longitude');
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}
