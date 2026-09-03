import { describe, expect, it } from 'vitest';

import { GarminAuthError } from '../../src/client/GarminRequestError.js';
import { ActivitiesEndpoint } from '../../src/endpoints/ActivitiesEndpoint.js';
import { CalendarEndpoint } from '../../src/endpoints/CalendarEndpoint.js';
import { DevicesEndpoint } from '../../src/endpoints/DevicesEndpoint.js';
import { HealthEndpoint } from '../../src/endpoints/HealthEndpoint.js';
import { SleepEndpoint } from '../../src/endpoints/SleepEndpoint.js';
import { UserEndpoint } from '../../src/endpoints/UserEndpoint.js';
import { WeightEndpoint } from '../../src/endpoints/WeightEndpoint.js';
import { WorkoutsEndpoint } from '../../src/endpoints/WorkoutsEndpoint.js';

class MockHttp {
  calls: Array<{
    path: string;
    method?: string;
    query?: Record<string, unknown>;
    body?: unknown;
    responseType?: string;
    retry?: { maxRetries?: number };
    diagnosticPath?: string;
  }> = [];

  async request(
    path: string,
    options: {
      method?: string;
      query?: Record<string, unknown>;
      body?: unknown;
      responseType?: string;
      retry?: { maxRetries?: number };
      diagnosticPath?: string;
    } = {},
  ): Promise<any> {
    this.calls.push({
      path,
      method: options.method,
      query: options.query,
      body: options.body,
      responseType: options.responseType,
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.diagnosticPath ? { diagnosticPath: options.diagnosticPath } : {}),
    });
    if (path === '/userprofile-service/socialProfile') return { displayName: 'runner' };
    if (path === '/device-service/deviceregistration/devices') return [];
    if (path === '/activitylist-service/activities/count') return { totalCount: 42 };
    if (path === '/activity-service/activity/activityTypes') return { activityTypes: [] };
    if (path.includes('/download-service/')) return new Uint8Array([1, 2, 3]);
    if (path.includes('activities/search')) return [];
    if (path.includes('activity-service/activity/')) return { activityId: 123 };
    if (path === '/workout-service/workouts') return [];
    if (path === '/workout-service/workout/types') return {};
    if (path === '/workout-service/workout') return { workoutId: 456 };
    if (path.includes('/workout-service/workout/')) return { workoutId: 456 };
    if (path.includes('/workout-service/schedule/')) return { workoutScheduleId: 789 };
    if (path.includes('/calendar-service/')) return { calendarItems: [] };
    if (path.includes('dailySleepData')) return { dailySleepDTO: { calendarDate: '2026-05-12' } };
    if (path.includes('bodyBattery')) return [];
    return {};
  }
}

describe('endpoints', () => {
  it('builds activity paths and queries', async () => {
    // Arrange
    const http = new MockHttp();
    const endpoint = new ActivitiesEndpoint(http as any);

    // Act
    const count = await endpoint.count();
    await endpoint.list({
      limit: 20,
      activityType: 'running',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      sortOrder: 'desc',
    });
    await endpoint.download(123);
    await endpoint.download(123, 'gpx');
    await endpoint.getTypes();
    await endpoint.get(123);
    await endpoint.getDetails(123);
    await endpoint.getSplits(123);

    // Assert
    expect(count).toBe(42);
    expect(http.calls[0]?.path).toBe('/activitylist-service/activities/count');
    expect(http.calls[1]).toEqual({
      path: '/activitylist-service/activities/search/activities',
      method: undefined,
      query: {
        start: 0,
        limit: 20,
        activityType: 'running',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        sortOrder: 'desc',
      },
      body: undefined,
      responseType: undefined,
    });
    expect(http.calls[2]).toMatchObject({
      path: '/download-service/export/tcx/activity/123',
      responseType: 'bytes',
    });
    expect(http.calls[3]).toMatchObject({
      path: '/download-service/export/gpx/activity/123',
      responseType: 'bytes',
    });
    expect(http.calls[4]?.path).toBe('/activity-service/activity/activityTypes');
    expect(http.calls[5]?.path).toBe('/activity-service/activity/123');
    expect(http.calls[6]?.path).toBe('/activity-service/activity/123/details');
    expect(http.calls[7]?.path).toBe('/activity-service/activity/123/typedsplits');
  });

  it('paginates activity lists with conservative bounds', async () => {
    // Arrange
    class PaginatedHttp extends MockHttp {
      override async request(
        path: string,
        options: { query?: Record<string, unknown> } = {},
      ): Promise<any> {
        this.calls.push({ path, query: options.query });
        return options.query?.start === 0
          ? [{ activityId: 1 }, { activityId: 2 }]
          : [{ activityId: 3 }];
      }
    }

    const http = new PaginatedHttp();
    const endpoint = new ActivitiesEndpoint(http as any);

    // Act
    const activities = await endpoint.listAll({
      pageSize: 2,
      maxPages: 3,
      activityType: 'cycling',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      sortOrder: 'asc',
    });

    // Assert
    expect(activities.map((activity) => activity.activityId)).toEqual([1, 2, 3]);
    expect(http.calls.map((call) => call.query)).toEqual([
      {
        start: 0,
        limit: 2,
        activityType: 'cycling',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        sortOrder: 'asc',
      },
      {
        start: 2,
        limit: 2,
        activityType: 'cycling',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        sortOrder: 'asc',
      },
    ]);
  });

  it('builds sleep, health, user, and device paths', async () => {
    // Arrange
    const http = new MockHttp();
    const user = new UserEndpoint(http as any);
    const sleep = new SleepEndpoint(http as any, user);
    const health = new HealthEndpoint(http as any, user);
    const devices = new DevicesEndpoint(http as any);
    const workouts = new WorkoutsEndpoint(http as any);
    const calendar = new CalendarEndpoint(http as any);

    // Act
    await user.getProfile();
    await sleep.getDailySleep('2026-05-12');
    await health.getHeartRate('2026-05-12');
    await health.getStress('2026-05-12');
    await health.getBodyBattery('2026-05-12');
    await health.getHrvStatus('2026-05-12');
    await devices.list();
    await workouts.list({ limit: 2 });
    await workouts.getTypes();
    await workouts.get(456);
    await calendar.getMonth(2026, 6);
    await calendar.getWeek('2026-06-15', { start: 0 });

    // Assert
    expect(http.calls[1]).toEqual({
      path: '/wellness-service/wellness/dailySleepData/runner',
      method: undefined,
      query: { date: '2026-05-12', nonSleepBufferMinutes: 60 },
      body: undefined,
    });
    expect(http.calls[2]).toEqual({
      path: '/wellness-service/wellness/dailyHeartRate/runner',
      method: undefined,
      query: { date: '2026-05-12' },
      body: undefined,
    });
    expect(http.calls[3]?.path).toBe('/wellness-service/wellness/dailyStress/2026-05-12');
    expect(http.calls[4]).toEqual({
      path: '/wellness-service/wellness/bodyBattery/reports/daily',
      method: undefined,
      query: { startDate: '2026-05-12', endDate: '2026-05-12' },
      body: undefined,
    });
    expect(http.calls[5]?.path).toBe('/hrv-service/hrv/2026-05-12');
    expect(http.calls[6]?.path).toBe('/device-service/deviceregistration/devices');
    expect(http.calls[7]).toEqual({
      path: '/workout-service/workouts',
      method: undefined,
      query: { start: 0, limit: 2, myWorkoutsOnly: true },
      body: undefined,
    });
    expect(http.calls[8]?.path).toBe('/workout-service/workout/types');
    expect(http.calls[9]?.path).toBe('/workout-service/workout/456');
    expect(http.calls[10]?.path).toBe('/calendar-service/year/2026/month/5');
    expect(http.calls[11]?.path).toBe('/calendar-service/year/2026/month/5/day/15/start/0');
  });

  it('builds weight day and range reads', async () => {
    // Arrange
    const http = new MockHttp();
    const weight = new WeightEndpoint(http as any);

    // Act
    await weight.getDailyWeighIns('2026-07-18');
    await weight.getWeighIns('2026-07-11', '2026-07-18');

    // Assert
    expect(http.calls[0]).toMatchObject({
      path: '/weight-service/weight/dayview/2026-07-18',
      query: { includeAll: true },
      diagnosticPath: '/weight-service/weight/dayview/[REDACTED]',
    });
    expect(http.calls[1]).toMatchObject({
      path: '/weight-service/weight/range/2026-07-11/2026-07-18',
      query: { includeAll: true },
      diagnosticPath: '/weight-service/weight/range/[REDACTED]/[REDACTED]',
    });
  });

  it('adds a weigh-in once with retries disabled', async () => {
    // Arrange
    const http = new MockHttp();
    const weight = new WeightEndpoint(http as any);

    // Act
    const result = await weight.addWeighIn({
      value: 75.4,
      unit: 'kg',
      measuredAt: '2026-07-18T14:30:00.000+02:00',
    });

    // Assert
    expect(result).toBeUndefined();
    expect(http.calls[0]).toEqual({
      path: '/weight-service/user-weight',
      method: 'POST',
      query: undefined,
      body: {
        dateTimestamp: '2026-07-18T14:30:00.000',
        gmtTimestamp: '2026-07-18T12:30:00.000',
        unitKey: 'kg',
        sourceType: 'MANUAL',
        value: 75.4,
      },
      responseType: undefined,
      retry: { maxRetries: 0 },
    });
  });

  it('removes one weigh-in by calendar date and samplePk with retries disabled', async () => {
    // Arrange
    const http = new MockHttp();
    const weight = new WeightEndpoint(http as any);

    // Act
    const result = await weight.removeWeighIn({
      calendarDate: '2026-07-18',
      samplePk: 123456,
    });

    // Assert
    expect(result).toBeUndefined();
    expect(http.calls[0]).toEqual({
      path: '/weight-service/weight/2026-07-18/byversion/123456',
      method: 'DELETE',
      query: undefined,
      body: undefined,
      responseType: undefined,
      retry: { maxRetries: 0 },
      diagnosticPath: '/weight-service/weight/[REDACTED]/byversion/[REDACTED]',
    });
  });

  it('accepts a digit-string samplePk without numeric coercion', async () => {
    // Arrange
    const http = new MockHttp();
    const weight = new WeightEndpoint(http as any);

    // Act
    await weight.removeWeighIn({ calendarDate: '2026-07-18', samplePk: '9007199254740993' });

    // Assert
    expect(http.calls[0]?.path).toBe(
      '/weight-service/weight/2026-07-18/byversion/9007199254740993',
    );
  });

  it.each([
    { calendarDate: '2026-07-18', samplePk: 0 },
    { calendarDate: '2026-07-18', samplePk: -1 },
    { calendarDate: '2026-07-18', samplePk: 1.5 },
    { calendarDate: '2026-07-18', samplePk: '' },
    { calendarDate: '2026-07-18', samplePk: '123/456' },
    { calendarDate: 'not-a-date', samplePk: 123456 },
  ])('rejects an invalid weigh-in removal target: $calendarDate $samplePk', async (input) => {
    // Arrange
    const http = new MockHttp();
    const weight = new WeightEndpoint(http as any);

    // Act
    const error = await weight.removeWeighIn(input).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect(http.calls).toHaveLength(0);
  });

  it('rejects reversed weight ranges before making a request', async () => {
    // Arrange
    const http = new MockHttp();
    const weight = new WeightEndpoint(http as any);

    // Act
    const error = await weight
      .getWeighIns('2026-07-18', '2026-07-11')
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(RangeError);
    expect(http.calls).toHaveLength(0);
  });

  it('builds workout create, schedule, unschedule, and delete requests', async () => {
    // Arrange
    const http = new MockHttp();
    const workouts = new WorkoutsEndpoint(http as any);
    const calendar = new CalendarEndpoint(http as any);

    // Act
    await workouts.create({
      name: 'SDK Test Run',
      sport: 'running',
      steps: [
        { type: 'warmup', durationSeconds: 300 },
        { type: 'interval', distanceMeters: 1000, target: { type: 'heart_rate_zone', zone: 2 } },
      ],
    });
    await workouts.schedule({ workoutId: 456, date: '2026-06-15' });
    await workouts.unschedule(789);
    await workouts.delete(456);
    await calendar.addWorkout({ workoutId: 456, date: '2026-06-16' });
    await calendar.removeWorkout(790);

    // Assert
    expect(http.calls[0]?.path).toBe('/workout-service/workout');
    expect(http.calls[0]?.method).toBe('POST');
    expect(http.calls[0]?.retry).toEqual({ maxRetries: 0 });
    expect(http.calls[0]?.body).toMatchObject({
      workoutName: 'SDK Test Run',
      sportType: { sportTypeKey: 'running' },
      workoutSegments: [
        {
          workoutSteps: [
            { stepType: { stepTypeKey: 'warmup' }, endConditionValue: 300 },
            {
              stepType: { stepTypeKey: 'interval' },
              endCondition: { conditionTypeKey: 'distance' },
              endConditionValue: 1000,
              targetType: { workoutTargetTypeKey: 'heart.rate.zone' },
              zoneNumber: 2,
            },
          ],
        },
      ],
    });
    expect(http.calls[1]).toMatchObject({
      path: '/workout-service/schedule/456',
      method: 'POST',
      body: { date: '2026-06-15' },
      retry: { maxRetries: 0 },
    });
    expect(http.calls[2]).toMatchObject({
      path: '/workout-service/schedule/789',
      method: 'DELETE',
      retry: { maxRetries: 0 },
    });
    expect(http.calls[3]).toMatchObject({
      path: '/workout-service/workout/456',
      method: 'DELETE',
      retry: { maxRetries: 0 },
    });
    expect(http.calls[4]).toMatchObject({
      path: '/workout-service/schedule/456',
      method: 'POST',
      body: { date: '2026-06-16' },
      retry: { maxRetries: 0 },
    });
    expect(http.calls[5]).toMatchObject({
      path: '/workout-service/schedule/790',
      method: 'DELETE',
      retry: { maxRetries: 0 },
    });
  });

  it('splits sleep ranges into daily requests', async () => {
    // Arrange
    const http = new MockHttp();
    const user = new UserEndpoint(http as any);
    const sleep = new SleepEndpoint(http as any, user);

    // Act
    const range = await sleep.getSleepRange('2026-05-10', '2026-05-12');

    // Assert
    expect(range).toHaveLength(3);
    expect(http.calls.filter((call) => call.path.includes('dailySleepData'))).toHaveLength(3);
    expect(http.calls.map((call) => call.query?.date).filter(Boolean)).toEqual([
      '2026-05-10',
      '2026-05-11',
      '2026-05-12',
    ]);
  });

  it('rejects invalid calendar months before making a request', () => {
    // Arrange
    const http = new MockHttp();
    const calendar = new CalendarEndpoint(http as any);

    // Act
    const getMonth = () => calendar.getMonth(2026, 13);

    // Assert
    expect(getMonth).toThrow(TypeError);
    expect(http.calls).toHaveLength(0);
  });

  it('throws a clear auth error when displayName is unavailable', async () => {
    // Arrange
    const http = new MockHttp();
    const user = new UserEndpoint(http as any);
    user.setCachedProfile({} as any);
    const sleep = new SleepEndpoint(http as any, user);

    // Act
    const error = await sleep.getDailySleep('2026-05-12').catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminAuthError);
    expect(http.calls).toHaveLength(0);
  });
});
