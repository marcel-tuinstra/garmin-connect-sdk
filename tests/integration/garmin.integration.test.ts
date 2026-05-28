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

  it('fetches workout metadata without mutating the account', async () => {
    const [workouts, types] = await Promise.all([
      garmin.workouts.list({ limit: 1 }),
      garmin.workouts.getTypes(),
    ]);

    expect(Array.isArray(workouts)).toBe(true);
    expect(types).toBeTypeOf('object');
  });

  it.skipIf(process.env.GARMIN_RUN_WORKOUT_WRITE !== '1')(
    'creates, schedules, unschedules, and deletes temporary workouts',
    async () => {
      const createdWorkoutIds: Array<string | number> = [];
      const scheduleIds: Array<string | number> = [];
      const scheduleDate = formatDate(new Date(Date.now() + 35 * 24 * 60 * 60 * 1000));

      try {
        for (const sport of ['running', 'cycling'] as const) {
          const workout = await garmin.workouts.create({
            name: `garmin-connect-sdk temporary ${sport} probe`,
            sport,
            steps: [
              { type: 'warmup', durationSeconds: 60 },
              { type: 'interval', durationSeconds: 120 },
              { type: 'cooldown', durationSeconds: 60 },
            ],
          });
          createdWorkoutIds.push(workout.workoutId);

          const schedule = await garmin.workouts.schedule({
            workoutId: workout.workoutId,
            date: scheduleDate,
          });
          const scheduleId = schedule.workoutScheduleId ?? schedule.scheduleId ?? schedule.id;
          if (scheduleId) scheduleIds.push(scheduleId);
        }

        const scheduledMonth = await garmin.calendar.getMonth(
          Number(scheduleDate.slice(0, 4)),
          Number(scheduleDate.slice(5, 7)),
        );
        const scheduledWorkoutIds = new Set(
          (scheduledMonth.calendarItems ?? [])
            .filter((item) => item.itemType === 'workout')
            .map((item) => String(item.workoutId ?? item.workout?.workoutId ?? '')),
        );

        expect(createdWorkoutIds.every((id) => scheduledWorkoutIds.has(String(id)))).toBe(true);
      } finally {
        for (const scheduleId of scheduleIds) {
          await garmin.workouts.unschedule(scheduleId).catch(() => undefined);
        }
        for (const workoutId of createdWorkoutIds) {
          await garmin.workouts.delete(workoutId).catch(() => undefined);
        }
      }
    },
    60_000,
  );
});
