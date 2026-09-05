import { describe, expect, it } from 'vitest';

import { GarminValidationError } from '../../src/client/GarminRequestError.js';
import {
  activityCountSchema,
  activityDetailSchema,
  activityDetailsPayloadSchema,
  activityListSchema,
  activitySplitsSchema,
  activityTypesSchema,
} from '../../src/schemas/activity.schema.js';
import {
  bodyBatterySchema,
  heartRateSchema,
  hrvStatusSchema,
  stressSchema,
} from '../../src/schemas/health.schema.js';
import { dailySleepSchema } from '../../src/schemas/sleep.schema.js';
import { devicesSchema, socialProfileSchema } from '../../src/schemas/user.schema.js';
import { dailyWeighInsSchema, weighInRangeSchema } from '../../src/schemas/weight.schema.js';
import {
  calendarMonthSchema,
  workoutListSchema,
  workoutScheduleSchema,
  workoutSchema,
  workoutTypesSchema,
} from '../../src/schemas/workout.schema.js';
import {
  activityDetailPayload,
  activityDetailsPayload,
  activityListPayload,
  activitySplitsPayload,
  bodyBatteryPayload,
  calendarMonthPayload,
  dailySleepPayload,
  devicesPayload,
  heartRatePayload,
  hrvStatusPayload,
  socialProfilePayload,
  stressPayload,
  workoutListPayload,
  workoutPayload,
  workoutSchedulePayload,
  workoutTypesPayload,
} from '../fixtures/garminPayloads.js';

describe('schemas', () => {
  it('parses representative Garmin-like activity payloads', () => {
    // Act
    const activityList = activityListSchema.parse(activityListPayload);
    const activityDetail = activityDetailSchema.parse(activityDetailPayload);
    const activityDetails = activityDetailsPayloadSchema.parse(activityDetailsPayload);
    const activitySplits = activitySplitsSchema.parse(activitySplitsPayload);
    const activityCount = activityCountSchema.parse({ totalCount: 123 });
    const activityTypes = activityTypesSchema.parse({ activityTypes: [{ typeKey: 'running' }] });

    // Assert
    expect(activityList).toHaveLength(1);
    expect(activityDetail.activityId).toBe(123456789);
    expect(activityDetail.summaryDTO?.averageHR).toBe(142);
    expect(activityDetails).toMatchObject({
      activityId: 123456789,
    });
    expect(activitySplits).toHaveLength(1);
    expect(activityCount.totalCount).toBe(123);
    expect(activityTypes).toMatchObject({ activityTypes: [{ typeKey: 'running' }] });
  });

  it('parses representative Garmin-like sleep and health payloads', () => {
    // Act
    const sleep = dailySleepSchema.parse(dailySleepPayload);
    const sleepWithNullLevels = dailySleepSchema.parse({ ...dailySleepPayload, sleepLevels: null });
    const heartRate = heartRateSchema.parse(heartRatePayload);
    const stress = stressSchema.parse(stressPayload);
    const bodyBattery = bodyBatterySchema.parse(bodyBatteryPayload);
    const hrvStatus = hrvStatusSchema.parse(hrvStatusPayload);

    // Assert
    expect(sleep).toMatchObject({ dailySleepDTO: { calendarDate: '2026-05-12' } });
    expect(sleepWithNullLevels.sleepLevels).toBeNull();
    expect(heartRate.heartRateValues).toHaveLength(2);
    expect(stress.stressValues).toHaveLength(2);
    expect(bodyBattery).toHaveLength(1);
    expect(hrvStatus.hrvSummary).toMatchObject({ status: 'BALANCED' });
  });

  it('parses representative Garmin-like user and device payloads', () => {
    // Act
    const profile = socialProfileSchema.parse(socialProfilePayload);
    const devices = devicesSchema.parse(devicesPayload);

    // Assert
    expect(profile.displayName).toBe('runner');
    expect(devices).toHaveLength(1);
  });

  it('parses representative Garmin-like workout and calendar payloads', () => {
    // Act
    const workoutList = workoutListSchema.parse(workoutListPayload);
    const workout = workoutSchema.parse(workoutPayload);
    const workoutTypes = workoutTypesSchema.parse(workoutTypesPayload);
    const workoutSchedule = workoutScheduleSchema.parse(workoutSchedulePayload);
    const calendarMonth = calendarMonthSchema.parse(calendarMonthPayload);

    // Assert
    expect(workoutList).toHaveLength(1);
    expect(workout.workoutSegments).toHaveLength(1);
    expect(workoutTypes.workoutSportTypes).toHaveLength(1);
    expect(workoutSchedule.workoutScheduleId).toBe(3003);
    expect(calendarMonth.calendarItems).toHaveLength(1);
  });

  it('accepts mixed activity and scheduled-workout calendar items', () => {
    // Arrange
    const payload = {
      calendarItems: [
        {
          date: '2026-09-01',
          title: 'Morning Run',
          itemType: 'activity',
          activityId: 111,
          workoutId: null,
          workoutScheduleId: null,
        },
        {
          date: '2026-09-05',
          title: 'Intervals',
          itemType: 'workout',
          workoutId: 1687133685,
          workoutScheduleId: '1766781002',
        },
      ],
    };

    // Act
    const result = calendarMonthSchema.parse(payload);

    // Assert
    expect(result.calendarItems).toMatchObject([
      { workoutId: null, workoutScheduleId: null, activityId: 111 },
      { workoutId: 1687133685, workoutScheduleId: '1766781002' },
    ]);
    expect(
      calendarMonthSchema.safeParse({
        calendarItems: [{ workoutId: true, workoutScheduleId: {} }],
      }).success,
    ).toBe(false);
  });

  it('parses Garmin weight day and range payloads while preserving gram values', () => {
    // Arrange
    const rangeMetric = {
      samplePk: 123,
      calendarDate: '2026-07-18',
      weight: 75400,
      sourceType: 'MANUAL',
      timestampGMT: 1784368800000,
      bmi: null,
      privateFutureField: true,
    };
    const dayMetric = { ...rangeMetric, samplePk: undefined, version: 456 };

    // Act
    const day = dailyWeighInsSchema.parse({
      startDate: '2026-07-18',
      endDate: '2026-07-18',
      dateWeightList: [dayMetric, { ...dayMetric, version: 457 }],
      totalAverage: { weight: 75400, bmi: null },
    });
    const range = weighInRangeSchema.parse({
      dailyWeightSummaries: [
        {
          summaryDate: '2026-07-18',
          numOfWeightEntries: 1,
          minWeight: 75400,
          maxWeight: 75400,
          latestWeight: rangeMetric,
          allWeightMetrics: [rangeMetric],
        },
      ],
      totalAverage: { weight: 75400 },
      previousDateWeight: { calendarDate: null, weight: null },
      nextDateWeight: null,
    });

    // Assert
    expect(day.dateWeightList[0]?.weight).toBe(75400);
    expect(day.dateWeightList).toHaveLength(2);
    expect(day.dateWeightList[0]?.privateFutureField).toBe(true);
    expect(range.dailyWeightSummaries[0]?.allWeightMetrics[0]?.weight).toBe(75400);
    expect(range.dailyWeightSummaries[0]?.latestWeight?.weight).toBe(75400);
    expect(range.previousDateWeight).toEqual({ calendarDate: null, weight: null });
  });

  it('parses an empty weight day with nullable averages', () => {
    // Act
    const day = dailyWeighInsSchema.parse({
      startDate: '2026-07-18',
      endDate: '2026-07-18',
      dateWeightList: [],
      totalAverage: { weight: null, bmi: null, bodyFat: null },
    });

    // Assert
    expect(day.dateWeightList).toEqual([]);
    expect(day.totalAverage?.weight).toBeNull();
  });

  it('rejects a weight metric without reconciliation fields', () => {
    // Act
    const result = dailyWeighInsSchema.safeParse({ dateWeightList: [{ weight: 75400 }] });

    // Assert
    expect(result.success).toBe(false);
  });

  it('reports validation paths without private payloads', () => {
    // Arrange
    const result = socialProfileSchema.safeParse({ displayName: '' });

    // Act
    const error = result.success
      ? null
      : new GarminValidationError({
          message: 'bad',
          endpoint: '/profile',
          issues: result.error.issues.map((issue) => issue.path.join('.')),
          cause: result.error,
        });

    // Assert
    expect(result.success).toBe(false);
    expect(error?.issues).toEqual(['displayName']);
    expect(error?.message).not.toContain('runner');
  });
});
