import { describe, expect, it } from 'vitest';

import { GarminValidationError } from '../../src/client/GarminRequestError.js';
import { activityListSchema } from '../../src/schemas/activity.schema.js';
import { dailySleepSchema } from '../../src/schemas/sleep.schema.js';
import { socialProfileSchema } from '../../src/schemas/user.schema.js';

describe('schemas', () => {
  it('parses representative Garmin-like payloads', () => {
    expect(activityListSchema.parse([{ activityId: 1, extra: true }])).toHaveLength(1);
    expect(
      dailySleepSchema.parse({
        dailySleepDTO: { calendarDate: '2026-05-12' },
        unexpected: 'ok',
      }),
    ).toMatchObject({ dailySleepDTO: { calendarDate: '2026-05-12' } });
    expect(socialProfileSchema.parse({ displayName: 'runner', private: true }).displayName).toBe(
      'runner',
    );
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
