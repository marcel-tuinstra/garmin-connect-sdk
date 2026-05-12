import { describe, expect, it } from 'vitest';

import { ActivitiesEndpoint } from '../../src/endpoints/ActivitiesEndpoint.js';
import { DevicesEndpoint } from '../../src/endpoints/DevicesEndpoint.js';
import { HealthEndpoint } from '../../src/endpoints/HealthEndpoint.js';
import { SleepEndpoint } from '../../src/endpoints/SleepEndpoint.js';
import { UserEndpoint } from '../../src/endpoints/UserEndpoint.js';

class MockHttp {
  calls: Array<{ path: string; query?: Record<string, unknown> }> = [];

  async request(path: string, options: { query?: Record<string, unknown> } = {}): Promise<any> {
    this.calls.push({ path, query: options.query });
    if (path === '/userprofile-service/socialProfile') return { displayName: 'runner' };
    if (path === '/device-service/deviceregistration/devices') return [];
    if (path.includes('activities/search')) return [];
    if (path.includes('activity-service/activity/')) return { activityId: 123 };
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

    await user.getProfile();
    await sleep.getDailySleep('2026-05-12');
    await health.getHeartRate('2026-05-12');
    await health.getStress('2026-05-12');
    await health.getBodyBattery('2026-05-12');
    await health.getHrvStatus('2026-05-12');
    await devices.list();

    expect(http.calls[1]).toEqual({
      path: '/wellness-service/wellness/dailySleepData/runner',
      query: { date: '2026-05-12', nonSleepBufferMinutes: 60 },
    });
    expect(http.calls[2]).toEqual({
      path: '/wellness-service/wellness/dailyHeartRate/runner',
      query: { date: '2026-05-12' },
    });
    expect(http.calls[3]?.path).toBe('/wellness-service/wellness/dailyStress/2026-05-12');
    expect(http.calls[4]).toEqual({
      path: '/wellness-service/wellness/bodyBattery/reports/daily',
      query: { startDate: '2026-05-12', endDate: '2026-05-12' },
    });
    expect(http.calls[5]?.path).toBe('/hrv-service/hrv/2026-05-12');
    expect(http.calls[6]?.path).toBe('/device-service/deviceregistration/devices');
  });
});
