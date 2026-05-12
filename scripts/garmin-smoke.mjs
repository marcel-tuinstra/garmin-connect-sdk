#!/usr/bin/env node
/* global console, process */
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { FileTokenStorage, GarminConnectSDK, GarminMfaRequiredError } from '../dist/index.js';

const rl = createInterface({ input, output });

try {
  const tokenPath = process.env.GARMIN_TOKEN_PATH ?? './.garmin-tokens';
  const garmin = new GarminConnectSDK({
    storage: new FileTokenStorage(tokenPath),
    timeoutMs: Number(process.env.GARMIN_TIMEOUT_MS ?? 15000),
  });

  let restored = await garmin.restoreSession().catch(() => false);
  if (!restored) {
    const email = process.env.GARMIN_EMAIL ?? (await rl.question('Garmin email: '));
    const password = process.env.GARMIN_PASSWORD ?? (await questionHidden('Garmin password: '));

    try {
      await garmin.login({ email, password, mfaCode: process.env.GARMIN_MFA_CODE });
    } catch (error) {
      if (!(error instanceof GarminMfaRequiredError)) throw error;
      const mfaCode = await rl.question('Garmin MFA code: ');
      await garmin.login({ email, password, mfaCode });
    }

    restored = true;
  }

  const profile = await garmin.user.getProfile();
  const [devices, activities, sleep, bodyBattery] = await Promise.all([
    garmin.devices.list(),
    garmin.activities.list({ limit: 1 }),
    garmin.sleep.getDailySleep(formatDate(new Date())),
    garmin.health.getBodyBattery(formatDate(new Date())),
  ]);

  const latestActivityId = activities[0]?.activityId;
  const latestActivity = latestActivityId ? await garmin.activities.get(latestActivityId) : null;

  console.log(
    JSON.stringify(
      {
        restoredSession: restored,
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
      },
      null,
      2,
    ),
  );
} finally {
  rl.close();
}

async function questionHidden(prompt) {
  if (!input.isTTY) return rl.question(prompt);

  output.write(prompt);
  emitKeypressEvents(input);
  input.setRawMode(true);

  let value = '';
  return new Promise((resolve) => {
    const onKeypress = (character, key) => {
      if (key?.name === 'return') {
        input.setRawMode(false);
        input.off('keypress', onKeypress);
        output.write('\n');
        resolve(value);
        return;
      }

      if (key?.name === 'backspace') {
        value = value.slice(0, -1);
        return;
      }

      if (key?.ctrl && key.name === 'c') {
        input.setRawMode(false);
        input.off('keypress', onKeypress);
        process.kill(process.pid, 'SIGINT');
        return;
      }

      if (character) value += character;
    };

    input.on('keypress', onKeypress);
  });
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}
