import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { GarminConnectSDK } from '../../src/client/GarminConnectSDK.js';
import {
  GarminTimeoutError,
  GarminValidationError,
} from '../../src/client/GarminRequestError.js';
import { jsonResponse, tokens } from '../helpers/garmin.js';

describe('ambiguous write reconciliation', () => {
  it('returns a successful workout create without an implicit readback or second mutation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ workoutId: 123, workoutName: 'created workout' }),
    );
    const garmin = await sdk(fetchMock);

    const created = await garmin.workouts.createRaw({ workoutName: 'created workout' });

    expect(created.workoutId).toBe(123);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(countCalls(fetchMock, '/workout-service/workout', 'POST')).toBe(1);
  });

  it('does not repeat a malformed workout create and exposes the applied workout on readback', async () => {
    let applied = false;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = urlPath(input);
      if (path === '/workout-service/workout' && init?.method === 'POST') {
        applied = true;
        return jsonResponse({ malformed: true });
      }
      if (path === '/workout-service/workout/123' && applied) {
        return jsonResponse({ workoutId: 123, workoutName: 'applied workout' });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const garmin = await sdk(fetchMock);

    await expect(garmin.workouts.createRaw({ workoutName: 'applied workout' })).rejects.toBeInstanceOf(
      GarminValidationError,
    );
    const readback = await garmin.workouts.get(123);

    expect(readback.workoutId).toBe(123);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countCalls(fetchMock, '/workout-service/workout', 'POST')).toBe(1);
    expect(countCalls(fetchMock, '/workout-service/workout/123', 'GET')).toBe(1);
  });

  it('does not repeat a timed-out schedule and exposes the applied schedule on calendar readback', async () => {
    let applied = false;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const path = urlPath(input);
      if (path === '/workout-service/schedule/123' && init?.method === 'POST') {
        applied = true;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      if (path === '/calendar-service/year/2026/month/9' && applied) {
        return Promise.resolve(
          jsonResponse({
            calendarItems: [{ id: 456, workoutId: 123, workoutScheduleId: 456, date: '2026-10-01' }],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    const garmin = await sdk(fetchMock, { timeoutMs: 1 });

    await expect(garmin.workouts.schedule({ workoutId: 123, date: '2026-10-01' })).rejects.toBeInstanceOf(
      GarminTimeoutError,
    );
    const readback = await garmin.calendar.getMonth(2026, 10);

    expect(readback.calendarItems?.[0]?.workoutScheduleId).toBe(456);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countCalls(fetchMock, '/workout-service/schedule/123', 'POST')).toBe(1);
    expect(countCalls(fetchMock, '/calendar-service/year/2026/month/9', 'GET')).toBe(1);
  });

  it('does not repeat an ambiguous unschedule and returns calendar readback evidence', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = urlPath(input);
      if (path === '/workout-service/schedule/456' && init?.method === 'DELETE') {
        throw new TypeError('connection lost after delete');
      }
      if (path === '/calendar-service/year/2026/month/9') return jsonResponse({ calendarItems: [] });
      throw new Error(`Unexpected request: ${path}`);
    });
    const garmin = await sdk(fetchMock);

    await expect(garmin.workouts.unschedule(456)).rejects.toBeInstanceOf(TypeError);
    const readback = await garmin.calendar.getMonth(2026, 10);

    expect(readback.calendarItems).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countCalls(fetchMock, '/workout-service/schedule/456', 'DELETE')).toBe(1);
    expect(countCalls(fetchMock, '/calendar-service/year/2026/month/9', 'GET')).toBe(1);
  });

  it('does not repeat an ambiguous workout delete and returns workout readback evidence', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = urlPath(input);
      if (path === '/workout-service/workout/123' && init?.method === 'DELETE') {
        throw new TypeError('connection lost after delete');
      }
      if (path === '/workout-service/workouts') return jsonResponse([]);
      throw new Error(`Unexpected request: ${path}`);
    });
    const garmin = await sdk(fetchMock);

    await expect(garmin.workouts.delete(123)).rejects.toBeInstanceOf(TypeError);
    const readback = await garmin.workouts.list();

    expect(readback).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countCalls(fetchMock, '/workout-service/workout/123', 'DELETE')).toBe(1);
    expect(countCalls(fetchMock, '/workout-service/workouts', 'GET')).toBe(1);
  });

  it('does not repeat an ambiguous weigh-in add and exposes the applied record on day readback', async () => {
    let applied = false;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = urlPath(input);
      if (path === '/weight-service/user-weight' && init?.method === 'POST') {
        applied = true;
        throw new TypeError('connection lost after add');
      }
      if (path === '/weight-service/weight/dayview/2026-07-18' && applied) {
        return jsonResponse({ startDate: '2026-07-18', endDate: '2026-07-18', dateWeightList: [weighIn()] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const garmin = await sdk(fetchMock);

    await expect(
      garmin.weight.addWeighIn({
        value: 75.4,
        unit: 'kg',
        measuredAt: '2026-07-18T14:30:00.000+02:00',
      }),
    ).rejects.toBeInstanceOf(TypeError);
    const readback = await garmin.weight.getDailyWeighIns('2026-07-18');

    expect(readback.dateWeightList[0]?.samplePk).toBe(789);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countCalls(fetchMock, '/weight-service/user-weight', 'POST')).toBe(1);
    expect(countCalls(fetchMock, '/weight-service/weight/dayview/2026-07-18', 'GET')).toBe(1);
  });

  it('does not repeat an ambiguous weigh-in removal and returns day readback evidence', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = urlPath(input);
      if (path === '/weight-service/weight/2026-07-18/byversion/789' && init?.method === 'DELETE') {
        throw new TypeError('connection lost after delete');
      }
      if (path === '/weight-service/weight/dayview/2026-07-18') {
        return jsonResponse({ startDate: '2026-07-18', endDate: '2026-07-18', dateWeightList: [] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const garmin = await sdk(fetchMock);

    await expect(
      garmin.weight.removeWeighIn({ calendarDate: '2026-07-18', samplePk: 789 }),
    ).rejects.toBeInstanceOf(TypeError);
    const readback = await garmin.weight.getDailyWeighIns('2026-07-18');

    expect(readback.dateWeightList).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countCalls(fetchMock, '/weight-service/weight/2026-07-18/byversion/789', 'DELETE')).toBe(1);
    expect(countCalls(fetchMock, '/weight-service/weight/dayview/2026-07-18', 'GET')).toBe(1);
  });
});

async function sdk(
  fetchMock: typeof fetch,
  options: { timeoutMs?: number } = {},
): Promise<GarminConnectSDK> {
  const storage = new MemoryTokenStorage();
  await storage.save(tokens({ displayName: 'runner' }));
  return new GarminConnectSDK({
    storage,
    fetch: fetchMock,
    maxRetries: 5,
    retry: { sleep: async () => undefined },
    ...options,
  });
}

function urlPath(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function countCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, path: string, method: string): number {
  return fetchMock.mock.calls.filter(([input, init]) => urlPath(input) === path && (init?.method ?? 'GET') === method).length;
}

function weighIn(): Record<string, unknown> {
  return {
    samplePk: 789,
    version: 1,
    calendarDate: '2026-07-18',
    weight: 75400,
    sourceType: 'MANUAL',
    timestampGMT: 1784381400000,
  };
}
