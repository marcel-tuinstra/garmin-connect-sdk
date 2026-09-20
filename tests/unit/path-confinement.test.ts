import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { AuthService } from '../../src/auth/AuthService.js';
import { GarminInputError } from '../../src/client/GarminRequestError.js';
import { HttpClient } from '../../src/client/HttpClient.js';
import { ActivitiesEndpoint } from '../../src/endpoints/ActivitiesEndpoint.js';
import { CalendarEndpoint } from '../../src/endpoints/CalendarEndpoint.js';
import { HealthEndpoint } from '../../src/endpoints/HealthEndpoint.js';
import { SleepEndpoint } from '../../src/endpoints/SleepEndpoint.js';
import { UserEndpoint } from '../../src/endpoints/UserEndpoint.js';
import { WorkoutsEndpoint } from '../../src/endpoints/WorkoutsEndpoint.js';
import { positiveIntegerPathSegment } from '../../src/utils/pathSegments.js';
import { jsonResponse, tokens } from '../helpers/garmin.js';

class MockHttp {
  calls: Array<{ path: string; options: Record<string, unknown> }> = [];

  async request(path: string, options: Record<string, unknown> = {}): Promise<any> {
    this.calls.push({ path, options });
    if (path.includes('/activity-service/activity/')) return { activityId: 123 };
    if (path.includes('/workout-service/workout/')) return { workoutId: 456 };
    if (path.includes('/workout-service/schedule/')) return { workoutScheduleId: 789 };
    if (path.includes('dailySleepData')) return { dailySleepDTO: { calendarDate: '2026-09-20' } };
    return {};
  }
}

describe('dynamic Garmin path confinement', () => {
  it.each([
    ['number', 42, '42'],
    ['digit string', '0042', '0042'],
    ['large digit string', '900719925474099312345', '900719925474099312345'],
  ])('accepts a positive %s identifier', (_label, input, expected) => {
    expect(positiveIntegerPathSegment(input, 'activityId')).toBe(expected);
  });

  it.each([
    '../1',
    '%2e%2e',
    '1/2',
    '1\\2',
    '1?x=2',
    '1#fragment',
    ' 1',
    '1 ',
    '',
    '0',
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    true,
    {},
  ])('rejects unsafe identifier %j locally', (input) => {
    expect(() => positiveIntegerPathSegment(input, 'activityId')).toThrow(GarminInputError);
  });

  it('keeps input failures compatible with TypeError and exposes only the field name', () => {
    const error = (() => {
      try {
        positiveIntegerPathSegment('../private-id', 'activityId');
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(GarminInputError);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as GarminInputError).issues).toEqual(['activityId']);
    expect(String(error)).not.toContain('private-id');
  });

  it('validates every activity, workout, and calendar identifier before dispatch', async () => {
    const http = new MockHttp();
    const activities = new ActivitiesEndpoint(http as any);
    const workouts = new WorkoutsEndpoint(http as any);
    const calendar = new CalendarEndpoint(http as any);
    const invalid = '../456';
    const calls = [
      () => activities.download(invalid),
      () => activities.get(invalid),
      () => activities.getDetails(invalid),
      () => activities.getSplits(invalid),
      () => workouts.get(invalid),
      () => workouts.updateRaw(invalid, { workoutName: 'unsafe' } as any),
      () => workouts.schedule({ workoutId: invalid, date: '2026-09-20' }),
      () => workouts.unschedule(invalid),
      () => workouts.delete(invalid),
      () => calendar.addWorkout({ workoutId: invalid, date: '2026-09-20' }),
      () => calendar.removeWorkout(invalid),
    ];

    for (const call of calls) {
      await expect(Promise.resolve().then(call)).rejects.toBeInstanceOf(GarminInputError);
    }
    expect(http.calls).toHaveLength(0);
  });

  it('preserves valid identifier paths and write no-retry options', async () => {
    const http = new MockHttp();
    const activities = new ActivitiesEndpoint(http as any);
    const workouts = new WorkoutsEndpoint(http as any);
    const calendar = new CalendarEndpoint(http as any);

    await activities.download('00123', 'gpx');
    await activities.get(123);
    await workouts.get('00456');
    await workouts.schedule({ workoutId: '00456', date: '2026-09-20' });
    await workouts.unschedule(789);
    await workouts.delete('00456');
    await calendar.addWorkout({ workoutId: 456, date: '2026-09-21' });
    await calendar.removeWorkout('00790');

    expect(http.calls.map(({ path }) => path)).toEqual([
      '/download-service/export/gpx/activity/00123',
      '/activity-service/activity/123',
      '/workout-service/workout/00456',
      '/workout-service/schedule/00456',
      '/workout-service/schedule/789',
      '/workout-service/workout/00456',
      '/workout-service/schedule/456',
      '/workout-service/schedule/00790',
    ]);
    for (const call of http.calls.slice(3)) {
      expect(call.options.retry).toEqual({ maxRetries: 0 });
    }
  });

  it('encodes a server-derived displayName as exactly one path segment', async () => {
    const http = new MockHttp();
    const user = new UserEndpoint(http as any);
    const sleep = new SleepEndpoint(http as any, user);
    const health = new HealthEndpoint(http as any, user);
    user.setCachedProfile({ displayName: 'runner/name?tab#section%2F' });

    await sleep.getDailySleep('2026-09-20');
    await health.getHeartRate('2026-09-20');

    expect(http.calls.map(({ path }) => path)).toEqual([
      '/wellness-service/wellness/dailySleepData/runner%2Fname%3Ftab%23section%252F',
      '/wellness-service/wellness/dailyHeartRate/runner%2Fname%3Ftab%23section%252F',
    ]);
  });

  it.each(['.', '..', '\uD800'])(
    'rejects unsafe displayName %j before dispatch',
    async (displayName) => {
      const http = new MockHttp();
      const user = new UserEndpoint(http as any);
      const sleep = new SleepEndpoint(http as any, user);
      user.setCachedProfile({ displayName });

      const error = await sleep.getDailySleep('2026-09-20').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(GarminInputError);
      expect(http.calls).toHaveLength(0);
    },
  );

  it.each([
    '//evil.example/steal',
    'https://evil.example/steal',
    '/safe/../escape',
    '/safe/%2e%2e/escape',
    '/safe\\@evil.example/steal',
    '/safe?embedded=true',
    '/safe#fragment',
  ])('rejects an escaping HttpClient path %j before auth or fetch', async (path) => {
    const storage = new MemoryTokenStorage();
    const load = vi.spyOn(storage, 'load');
    const fetchMock = vi.fn<typeof fetch>();
    const auth = new AuthService({ storage, fetch: fetchMock, retry: { maxRetries: 0 } });
    const http = new HttpClient({ auth, fetch: fetchMock, retry: { maxRetries: 0 } });

    const error = await http.request(path).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminInputError);
    expect(load).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a valid request on the configured origin with encoded query data', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens());
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const auth = new AuthService({ storage, fetch: fetchMock, retry: { maxRetries: 0 } });
    const http = new HttpClient({
      auth,
      fetch: fetchMock,
      retry: { maxRetries: 0 },
      baseUrl: 'https://connectapi.garmin.com',
    });

    await http.request('/safe/path', { query: { value: '../?secret#fragment' } });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://connectapi.garmin.com/safe/path?value=..%2F%3Fsecret%23fragment',
    );
  });
});
