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
import { summarizeActivityDetails, summarizeActivitySplits } from '../dist/index.js';

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
          splits: splits ? summarizeActivitySplits(splits) : undefined,
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
      throw new Error(`Unknown command "${command}". Run "garmin-connect help".`);
  }
} finally {
  rl.close();
}

function printHelp() {
  console.log(`Garmin Connect SDK CLI

Usage:
  garmin-connect profile
  garmin-connect devices
  garmin-connect activities [--limit 10] [--start 0] [--type running]
  garmin-connect activity --id <activityId> [--details] [--raw]
  garmin-connect sleep [--date YYYY-MM-DD]
  garmin-connect body-battery [--date YYYY-MM-DD]

Repo script:
  pnpm garmin -- <command>

Auth:
  Restores GARMIN_TOKEN_PATH or ./.garmin-tokens first.
  If no valid session exists, prompts for email, password, and MFA when needed.
  GARMIN_EMAIL, GARMIN_PASSWORD, and GARMIN_MFA_CODE can be set for non-interactive use.

Output:
  JSON summaries by default. --raw prints raw Garmin payloads for private local debugging.
`);
}
