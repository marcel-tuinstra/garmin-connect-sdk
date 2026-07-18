import { closeSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    // Act
    const profile = await garmin.user.getProfile();

    // Assert
    expect(profile.displayName).toBeTruthy();
  });

  it('fetches devices', async () => {
    // Act
    const devices = await garmin.devices.list();

    // Assert
    expect(Array.isArray(devices)).toBe(true);
  });

  it('fetches recent activities and the latest activity detail when available', async () => {
    // Act
    const activities = await garmin.activities.list({ limit: 1 });

    // Assert
    expect(Array.isArray(activities)).toBe(true);
    const activityId = activities[0]?.activityId;
    if (!activityId) return;

    // Act
    const activity = await garmin.activities.get(activityId);

    // Assert
    expect(String(activity.activityId)).toBe(String(activityId));
  });

  it('fetches today sleep and body battery summaries', async () => {
    // Arrange
    const today = formatDate(new Date());

    // Act
    const [sleep, bodyBattery] = await Promise.all([
      garmin.sleep.getDailySleep(today),
      garmin.health.getBodyBattery(today),
    ]);

    // Assert
    expect(sleep).toBeTypeOf('object');
    expect(bodyBattery).toBeTruthy();
  });

  it('fetches workout metadata without mutating the account', async () => {
    // Act
    const [workouts, types] = await Promise.all([
      garmin.workouts.list({ limit: 1 }),
      garmin.workouts.getTypes(),
    ]);

    // Assert
    expect(Array.isArray(workouts)).toBe(true);
    expect(types).toBeTypeOf('object');
  });

  it('fetches recent weigh-ins without exposing raw health data', async () => {
    // Arrange
    const end = formatDate(new Date());
    const start = formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    // Act
    const result = await garmin.weight.getWeighIns(start, end);

    // Assert
    expect(Array.isArray(result.dailyWeightSummaries)).toBe(true);
  });

  it.skipIf(process.env.GARMIN_RUN_WEIGHT_WRITE !== '1')(
    'adds requested weigh-ins only when an exact daily value is absent',
    async () => {
      // Arrange
      const currentWeight = requiredPositiveNumber('GARMIN_TEST_CURRENT_WEIGHT_KG');
      const previousWeight = requiredPositiveNumber('GARMIN_TEST_PREVIOUS_WEIGHT_KG');
      const now = new Date();
      const previous = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const currentMeasuredAt = formatTimestampInZone(now, 'Europe/Amsterdam');
      const previousMeasuredAt = formatTimestampInZone(previous, 'Europe/Amsterdam');
      const currentDate = currentMeasuredAt.slice(0, 10);
      const previousDate = previousMeasuredAt.slice(0, 10);
      const releaseLock = acquireWeightWriteLock();
      try {
        const preflight = await garmin.weight.getWeighIns(previousDate, currentDate);

        // Act
        const previousStatus = await addAndReconcile({
          garmin,
          preflight,
          date: previousDate,
          measuredAt: previousMeasuredAt,
          value: previousWeight,
        });
        const currentStatus = await addAndReconcile({
          garmin,
          preflight: await garmin.weight.getWeighIns(previousDate, currentDate),
          date: currentDate,
          measuredAt: currentMeasuredAt,
          value: currentWeight,
        });

        // Assert
        expect(['already_present', 'committed_verified']).toContain(previousStatus);
        expect(['already_present', 'committed_verified']).toContain(currentStatus);
      } finally {
        releaseLock();
      }
    },
    60_000,
  );

  it.skipIf(process.env.GARMIN_RUN_WEIGHT_DELETE !== '1')(
    'creates and removes one temporary synthetic weigh-in',
    async () => {
      // Arrange
      const value = requiredPositiveNumber('GARMIN_TEST_DELETE_WEIGHT_KG');
      const measuredAt = formatTimestampInZone(new Date(), 'Europe/Amsterdam');
      const calendarDate = measuredAt.slice(0, 10);
      const targetGrams = Math.round(value * 1000);
      const releaseLock = acquireWeightWriteLock();

      try {
        const before = await garmin.weight.getDailyWeighIns(calendarDate);
        if (before.dateWeightList.some((entry) => entry.weight === targetGrams)) {
          throw new Error(
            'GARMIN_TEST_DELETE_WEIGHT_KG already exists today; choose another synthetic value.',
          );
        }
        const beforeIds = new Set(
          before.dateWeightList.flatMap((entry) =>
            entry.samplePk == null ? [] : [String(entry.samplePk)],
          ),
        );

        // Act
        let addError: unknown;
        try {
          await garmin.weight.addWeighIn({ value, unit: 'kg', measuredAt });
        } catch (error) {
          addError = error;
        }
        const created = await waitForNewWeighIn({
          garmin,
          calendarDate,
          targetGrams,
          beforeIds,
        }).catch((error: unknown) => {
          throw new Error(
            addError
              ? 'Temporary weigh-in outcome is unknown after reconciliation; do not retry.'
              : 'Temporary weigh-in could not be found after Garmin accepted the POST.',
            { cause: error },
          );
        });
        await removeAndReconcile({
          garmin,
          calendarDate,
          samplePk: created.samplePk,
        });

        // Assert
        const after = await garmin.weight.getDailyWeighIns(calendarDate);
        expect(
          after.dateWeightList.some(
            (entry) => entry.samplePk != null && String(entry.samplePk) === created.samplePk,
          ),
        ).toBe(false);
      } finally {
        releaseLock();
      }
    },
    60_000,
  );

  it.skipIf(process.env.GARMIN_RUN_WORKOUT_WRITE !== '1')(
    'creates, schedules, unschedules, and deletes temporary workouts',
    async () => {
      // Arrange
      const createdWorkoutIds: Array<string | number> = [];
      const scheduleIds: Array<string | number> = [];
      const scheduleDate = formatDate(new Date(Date.now() + 35 * 24 * 60 * 60 * 1000));

      try {
        // Act
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

        // Assert
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

function requiredPositiveNumber(name: string): number {
  const value = Number(process.env[name]);
  if (
    !Number.isFinite(value) ||
    value < 20 ||
    value > 300 ||
    Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6
  ) {
    throw new Error(`${name} must be between 20 and 300 kg with at most 3 decimals.`);
  }
  return value;
}

function acquireWeightWriteLock(): () => void {
  const lockPath = join(tmpdir(), 'garmin-connect-sdk-weight-write.lock');
  const descriptor = openSync(lockPath, 'wx', 0o600);
  return () => {
    closeSync(descriptor);
    unlinkSync(lockPath);
  };
}

function formatTimestampInZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const offset = parts.timeZoneName?.replace('GMT', '') || 'Z';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000${offset}`;
}

async function addAndReconcile(options: {
  garmin: GarminConnectSDK;
  preflight: Awaited<ReturnType<GarminConnectSDK['weight']['getWeighIns']>>;
  date: string;
  measuredAt: string;
  value: number;
}): Promise<'already_present' | 'committed_verified'> {
  const targetGrams = Math.round(options.value * 1000);
  if (hasDailyWeight(options.preflight, options.date, targetGrams)) return 'already_present';

  let writeError: unknown;
  try {
    await options.garmin.weight.addWeighIn({
      value: options.value,
      unit: 'kg',
      measuredAt: options.measuredAt,
    });
  } catch (error) {
    writeError = error;
  }

  for (const delayMs of [0, 1000, 3000]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const day = await options.garmin.weight.getDailyWeighIns(options.date);
    const matches = day.dateWeightList.filter((entry) => entry.weight === targetGrams);
    if (matches.length === 1) return 'committed_verified';
    if (matches.length > 1) {
      throw new Error('Duplicate weigh-ins detected during reconciliation; stop and review.');
    }
  }

  throw new Error(
    writeError
      ? 'Weigh-in outcome is unknown after reconciliation; do not retry automatically.'
      : 'Garmin accepted the weigh-in but it could not be verified; do not retry automatically.',
  );
}

function hasDailyWeight(
  range: Awaited<ReturnType<GarminConnectSDK['weight']['getWeighIns']>>,
  date: string,
  targetGrams: number,
): boolean {
  return range.dailyWeightSummaries.some(
    (summary) =>
      summary.summaryDate === date &&
      summary.allWeightMetrics.some((entry) => entry.weight === targetGrams),
  );
}

async function waitForNewWeighIn(options: {
  garmin: GarminConnectSDK;
  calendarDate: string;
  targetGrams: number;
  beforeIds: Set<string>;
}): Promise<{ samplePk: string }> {
  for (const delayMs of [0, 1000, 3000]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const day = await options.garmin.weight.getDailyWeighIns(options.calendarDate);
    const created = day.dateWeightList.flatMap((entry) => {
      if (entry.weight !== options.targetGrams || entry.samplePk == null) return [];
      const samplePk = String(entry.samplePk);
      return options.beforeIds.has(samplePk) ? [] : [{ samplePk }];
    });
    if (created.length === 1) return created[0]!;
    if (created.length > 1) {
      throw new Error('Multiple new weigh-ins matched the temporary value; stop and review.');
    }
  }

  throw new Error('The temporary weigh-in could not be identified; do not create another one.');
}

async function removeAndReconcile(options: {
  garmin: GarminConnectSDK;
  calendarDate: string;
  samplePk: string;
}): Promise<void> {
  let deleteError: unknown;
  try {
    await options.garmin.weight.removeWeighIn({
      calendarDate: options.calendarDate,
      samplePk: options.samplePk,
    });
  } catch (error) {
    deleteError = error;
  }

  for (const delayMs of [0, 1000, 3000]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const day = await options.garmin.weight.getDailyWeighIns(options.calendarDate);
    const stillPresent = day.dateWeightList.some(
      (entry) => entry.samplePk != null && String(entry.samplePk) === options.samplePk,
    );
    if (!stillPresent) return;
  }

  throw new Error(
    deleteError
      ? 'Weigh-in removal is still present after an ambiguous DELETE; do not retry automatically.'
      : 'Garmin accepted the DELETE but the weigh-in is still present; do not retry automatically.',
  );
}
