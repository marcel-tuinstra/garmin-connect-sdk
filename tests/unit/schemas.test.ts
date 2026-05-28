import { describe, expect, it } from 'vitest';

import { GarminValidationError } from '../../src/client/GarminRequestError.js';
import {
  activityDetailSchema,
  activityDetailsPayloadSchema,
  activityListSchema,
  activitySplitsSchema,
} from '../../src/schemas/activity.schema.js';
import {
  bodyBatterySchema,
  heartRateSchema,
  hrvStatusSchema,
  stressSchema,
} from '../../src/schemas/health.schema.js';
import { dailySleepSchema } from '../../src/schemas/sleep.schema.js';
import { devicesSchema, socialProfileSchema } from '../../src/schemas/user.schema.js';
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

    // Assert
    expect(activityList).toHaveLength(1);
    expect(activityDetail.activityId).toBe(123456789);
    expect(activityDetail.summaryDTO?.averageHR).toBe(142);
    expect(activityDetails).toMatchObject({
      activityId: 123456789,
    });
    expect(activitySplits).toHaveLength(1);
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
