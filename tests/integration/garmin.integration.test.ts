import { beforeAll, describe, expect, it } from 'vitest';

import { FileTokenStorage, GarminConnectSDK } from '../../src/index.js';
import { formatDate } from '../../src/utils/dates.js';

const enabled = process.env.GARMIN_RUN_INTEGRATION === '1';
const tokenPath = process.env.GARMIN_TOKEN_PATH ?? './.garmin-tokens';

describe.skipIf(!enabled)('Garmin integration', () => {
  let garmin: GarminConnectSDK;

  beforeAll(async () => {
    garmin = new GarminConnectSDK({
      storage: new FileTokenStorage(tokenPath),
    });

    if (!(await garmin.restoreSession())) {
      if (!process.env.GARMIN_EMAIL || !process.env.GARMIN_PASSWORD) {
        throw new Error(
          'Set GARMIN_EMAIL and GARMIN_PASSWORD when no stored Garmin session is available.',
        );
      }

      await garmin.login({
        email: process.env.GARMIN_EMAIL,
        password: process.env.GARMIN_PASSWORD,
        mfaCode: process.env.GARMIN_MFA_CODE,
      });
    }
  });

  it('fetches profile', async () => {
    const profile = await garmin.user.getProfile();

    expect(profile.displayName).toBeTruthy();
  });

  it('fetches devices', async () => {
    const devices = await garmin.devices.list();

    expect(Array.isArray(devices)).toBe(true);
  });

  it('fetches recent activities and the latest activity detail when available', async () => {
    const activities = await garmin.activities.list({ limit: 1 });

    expect(Array.isArray(activities)).toBe(true);
    const activityId = activities[0]?.activityId;
    if (!activityId) return;

    const activity = await garmin.activities.get(activityId);
    expect(String(activity.activityId)).toBe(String(activityId));
  });

  it('fetches today sleep and body battery summaries', async () => {
    const today = formatDate(new Date());
    const [sleep, bodyBattery] = await Promise.all([
      garmin.sleep.getDailySleep(today),
      garmin.health.getBodyBattery(today),
    ]);

    expect(sleep).toBeTypeOf('object');
    expect(bodyBattery).toBeTruthy();
  });
});
