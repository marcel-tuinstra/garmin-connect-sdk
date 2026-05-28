import { describe, expect, it } from 'vitest';

import { ActivitiesEndpoint } from '../../src/endpoints/ActivitiesEndpoint.js';
import { CalendarEndpoint } from '../../src/endpoints/CalendarEndpoint.js';
import { DevicesEndpoint } from '../../src/endpoints/DevicesEndpoint.js';
import { HealthEndpoint } from '../../src/endpoints/HealthEndpoint.js';
import { SleepEndpoint } from '../../src/endpoints/SleepEndpoint.js';
import { UserEndpoint } from '../../src/endpoints/UserEndpoint.js';
import { WorkoutsEndpoint } from '../../src/endpoints/WorkoutsEndpoint.js';

class MockHttp {
  calls: Array<{
    path: string;
    method?: string;
    query?: Record<string, unknown>;
    body?: unknown;
  }> = [];

  async request(
    path: string,
    options: { method?: string; query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<any> {
    this.calls.push({ path, method: options.method, query: options.query, body: options.body });
    if (path === '/userprofile-service/socialProfile') return { displayName: 'runner' };
    if (path === '/device-service/deviceregistration/devices') return [];
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
    const http = new MockHttp();
    const endpoint = new ActivitiesEndpoint(http as any);
    await endpoint.list({ limit: 20 });
    await endpoint.get(123);
    await endpoint.getDetails(123);
    await endpoint.getSplits(123);

    expect(http.calls[0]).toEqual({
      path: '/activitylist-service/activities/search/activities',
      query: { start: 0, limit: 20, activityType: undefined },
    });
    expect(http.calls[1]?.path).toBe('/activity-service/activity/123');
    expect(http.calls[2]?.path).toBe('/activity-service/activity/123/details');
    expect(http.calls[3]?.path).toBe('/activity-service/activity/123/typedsplits');
  });

  it('paginates activity lists with conservative bounds', async () => {
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

    const activities = await endpoint.listAll({ pageSize: 2, maxPages: 3 });

    expect(activities.map((activity) => activity.activityId)).toEqual([1, 2, 3]);
    expect(http.calls.map((call) => call.query)).toEqual([
      { start: 0, limit: 2, activityType: undefined },
      { start: 2, limit: 2, activityType: undefined },
    ]);
  });

  it('builds sleep, health, user, and device paths', async () => {
    const http = new MockHttp();
    const user = new UserEndpoint(http as any);
    const sleep = new SleepEndpoint(http as any, user);
    const health = new HealthEndpoint(http as any, user);
    const devices = new DevicesEndpoint(http as any);
    const workouts = new WorkoutsEndpoint(http as any);
    const calendar = new CalendarEndpoint(http as any);

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

  it('builds workout create, schedule, unschedule, and delete requests', async () => {
    const http = new MockHttp();
    const workouts = new WorkoutsEndpoint(http as any);
    const calendar = new CalendarEndpoint(http as any);

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

    expect(http.calls[0]?.path).toBe('/workout-service/workout');
    expect(http.calls[0]?.method).toBe('POST');
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
    });
    expect(http.calls[2]).toMatchObject({
      path: '/workout-service/schedule/789',
      method: 'DELETE',
    });
    expect(http.calls[3]).toMatchObject({
      path: '/workout-service/workout/456',
      method: 'DELETE',
    });
    expect(http.calls[4]).toMatchObject({
      path: '/workout-service/schedule/456',
      method: 'POST',
      body: { date: '2026-06-16' },
    });
    expect(http.calls[5]).toMatchObject({
      path: '/workout-service/schedule/790',
      method: 'DELETE',
    });
  });
});
