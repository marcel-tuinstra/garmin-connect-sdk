#!/usr/bin/env node
import { createGarminFromCli, createPrompt, formatDate, writeJson } from './garmin-cli-utils.mjs';

const rl = createPrompt();

try {
  const { garmin, restoredSession } = await createGarminFromCli(rl);

  const profile = await garmin.user.getProfile();
  const [devices, activities, sleep, bodyBattery] = await Promise.all([
    garmin.devices.list(),
    garmin.activities.list({ limit: 1 }),
    garmin.sleep.getDailySleep(formatDate(new Date())),
    garmin.health.getBodyBattery(formatDate(new Date())),
  ]);

  const latestActivityId = activities[0]?.activityId;
  const latestActivity = latestActivityId ? await garmin.activities.get(latestActivityId) : null;

  writeJson({
    restoredSession,
    profile: true,
    displayNamePresent: Boolean(profile.displayName),
    devices: devices.length,
    activities: activities.length,
    latestActivity: latestActivity
      ? {
          idMatches: String(latestActivity.activityId) === String(latestActivityId),
          type: latestActivity.activityType?.typeKey ?? null,
        }
      : null,
    sleep: Boolean(sleep),
    bodyBattery: Boolean(bodyBattery),
  });
} finally {
  rl.close();
}
