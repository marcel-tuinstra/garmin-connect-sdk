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
  activityDetailPayload,
  activityDetailsPayload,
  activityListPayload,
  activitySplitsPayload,
  bodyBatteryPayload,
  dailySleepPayload,
  devicesPayload,
  heartRatePayload,
  hrvStatusPayload,
  socialProfilePayload,
  stressPayload,
} from '../fixtures/garminPayloads.js';

describe('schemas', () => {
  it('parses representative Garmin-like activity payloads', () => {
    expect(activityListSchema.parse(activityListPayload)).toHaveLength(1);
    const activityDetail = activityDetailSchema.parse(activityDetailPayload);
    expect(activityDetail.activityId).toBe(123456789);
    expect(activityDetail.summaryDTO?.averageHR).toBe(142);
    expect(activityDetailsPayloadSchema.parse(activityDetailsPayload)).toMatchObject({
      activityId: 123456789,
    });
    expect(activitySplitsSchema.parse(activitySplitsPayload)).toHaveLength(1);
  });

  it('parses representative Garmin-like sleep and health payloads', () => {
    expect(dailySleepSchema.parse(dailySleepPayload)).toMatchObject({
      dailySleepDTO: { calendarDate: '2026-05-12' },
    });
    expect(heartRateSchema.parse(heartRatePayload).heartRateValues).toHaveLength(2);
    expect(stressSchema.parse(stressPayload).stressValues).toHaveLength(2);
    expect(bodyBatterySchema.parse(bodyBatteryPayload)).toHaveLength(1);
    expect(hrvStatusSchema.parse(hrvStatusPayload).hrvSummary).toMatchObject({
      status: 'BALANCED',
    });
  });

  it('parses representative Garmin-like user and device payloads', () => {
    expect(socialProfileSchema.parse(socialProfilePayload).displayName).toBe('runner');
    expect(devicesSchema.parse(devicesPayload)).toHaveLength(1);
  });

  it('reports validation paths without private payloads', () => {
    const result = socialProfileSchema.safeParse({ displayName: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = new GarminValidationError({
        message: 'bad',
        endpoint: '/profile',
        issues: result.error.issues.map((issue) => issue.path.join('.')),
        cause: result.error,
      });
      expect(error.issues).toEqual(['displayName']);
      expect(error.message).not.toContain('runner');
    }
  });
});
