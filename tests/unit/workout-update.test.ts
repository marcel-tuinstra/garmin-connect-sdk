import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { GarminConnectSDK } from '../../src/client/GarminConnectSDK.js';
import { GarminRequestError, GarminTimeoutError } from '../../src/client/GarminRequestError.js';
import { WorkoutsEndpoint } from '../../src/endpoints/WorkoutsEndpoint.js';
import { tokens } from '../helpers/garmin.js';

class MockHttp {
  calls: Array<{ path: string; method?: string; body?: unknown; retry?: { maxRetries?: number } }> =
    [];
  response: unknown = { workoutId: 123, workoutName: 'updated' };

  async request(
    path: string,
    options: { method?: string; body?: unknown; retry?: { maxRetries?: number } } = {},
  ): Promise<unknown> {
    this.calls.push({ path, method: options.method, body: options.body, retry: options.retry });
    return this.response;
  }
}

describe('workout update endpoint', () => {
  it('sends a typed workout as a complete PUT payload and does not mutate the input', async () => {
    const http = new MockHttp();
    const workouts = new WorkoutsEndpoint(http as any);
    const input = {
      name: 'Tempo run',
      sport: 'running' as const,
      description: 'Updated description',
      steps: [{ type: 'interval' as const, durationSeconds: 600 }],
    };
    const before = structuredClone(input);

    await workouts.update(123, input);

    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]).toMatchObject({
      path: '/workout-service/workout/123',
      method: 'PUT',
      retry: { maxRetries: 0 },
      body: {
        workoutName: 'Tempo run',
        description: 'Updated description',
        workoutSegments: [{ workoutSteps: [{ endConditionValue: 600 }] }],
      },
    });
    expect(input).toEqual(before);
  });

  it('sends a raw payload without mutating it and overrides its conflicting workoutId', async () => {
    const http = new MockHttp();
    const workouts = new WorkoutsEndpoint(http as any);
    const payload = {
      workoutId: 999,
      workoutName: 'Raw update',
      workoutSegments: [{ workoutSteps: [{ description: 'keep nested data' }] }],
    };
    const before = structuredClone(payload);

    await workouts.updateRaw('123', payload);

    expect(http.calls[0]).toMatchObject({
      path: '/workout-service/workout/123',
      method: 'PUT',
      retry: { maxRetries: 0 },
      body: { ...payload, workoutId: '123' },
    });
    expect(payload).toEqual(before);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '', '0', '-1', '1.5', '123/456'])(
    'rejects invalid workout id %s before dispatch',
    async (workoutId) => {
      const http = new MockHttp();
      const workouts = new WorkoutsEndpoint(http as any);

      await expect(
        workouts.update(workoutId as string | number, validInput()),
      ).rejects.toBeInstanceOf(TypeError);
      expect(http.calls).toHaveLength(0);
    },
  );

  it.each([null, undefined, [], {}, 'payload'])(
    'rejects malformed raw payload %j before dispatch',
    async (payload) => {
      const http = new MockHttp();
      const workouts = new WorkoutsEndpoint(http as any);

      await expect(workouts.updateRaw(123, payload as never)).rejects.toBeInstanceOf(TypeError);
      expect(http.calls).toHaveLength(0);
    },
  );

  it('rejects malformed typed input before dispatch', async () => {
    const http = new MockHttp();
    const workouts = new WorkoutsEndpoint(http as any);

    await expect(
      workouts.update(123, {
        name: 'No steps',
        sport: 'running',
        steps: [],
      }),
    ).rejects.toThrow(/at least one step/);
    expect(http.calls).toHaveLength(0);
  });

  it.each([
    ['401', new Response('', { status: 401 })],
    ['429', new Response('', { status: 429 })],
    ['503', new Response('', { status: 503 })],
  ])('does not retry a %s update response', async (_status, response) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    const garmin = await sdk(fetchMock);

    await expect(garmin.workouts.updateRaw(123, validRawPayload())).rejects.toBeInstanceOf(
      GarminRequestError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry transport failures or timeouts for an update', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('socket closed'));
    const transportGarmin = await sdk(transport);
    await expect(transportGarmin.workouts.updateRaw(123, validRawPayload())).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(transport).toHaveBeenCalledTimes(1);

    const timeout = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const timeoutGarmin = await sdk(timeout, { timeoutMs: 1 });
    await expect(timeoutGarmin.workouts.updateRaw(123, validRawPayload())).rejects.toBeInstanceOf(
      GarminTimeoutError,
    );
    expect(timeout).toHaveBeenCalledTimes(1);
  });
});

function validInput() {
  return {
    name: 'Valid run',
    sport: 'running' as const,
    steps: [{ type: 'interval' as const, durationSeconds: 60 }],
  };
}

function validRawPayload() {
  return { workoutId: 123, workoutName: 'Raw update', workoutSegments: [] };
}

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
