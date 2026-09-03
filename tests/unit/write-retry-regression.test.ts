import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../src/auth/AuthService.js';
import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { HttpClient } from '../../src/client/HttpClient.js';
import {
  GarminRequestError,
  GarminSessionExpiredError,
  GarminTimeoutError,
} from '../../src/client/GarminRequestError.js';
import { jsonResponse, tokens } from '../helpers/garmin.js';

describe('method-aware HTTP retries', () => {
  it.each(['GET', 'HEAD'])('retries bounded 429/5xx responses for %s reads', async (method) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(method === 'HEAD' ? new Response(null, { status: 204 }) : jsonResponse({ ok: true }));
    const http = await httpClient(fetchMock, {
      maxRetries: 2,
      sleep: async () => undefined,
    });

    const result = await http.request('/read', { method, skipAuth: true });

    expect(result).toEqual(method === 'HEAD' ? undefined : { ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a transient network failure for a GET read', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const http = await httpClient(fetchMock, { maxRetries: 1, sleep: async () => undefined });

    await expect(http.request('/read', { skipAuth: true })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['POST', 'DELETE', 'post'])('does not automatically retry mutating %s requests', async (method) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const http = await httpClient(fetchMock, {
      maxRetries: 4,
      shouldRetry: () => true,
      sleep: async () => undefined,
    });

    const error = await http
      .request('/write', { method, body: method.toUpperCase() === 'POST' ? { value: 1 } : undefined, skipAuth: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry PUT by default, but allows an explicit request-level override', async () => {
    const defaultFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const defaultHttp = await httpClient(defaultFetch, {
      maxRetries: 3,
      shouldRetry: () => true,
      sleep: async () => undefined,
    });

    const defaultError = await defaultHttp
      .request('/write', { method: 'PUT', skipAuth: true })
      .catch((caught: unknown) => caught);
    expect(defaultError).toBeInstanceOf(GarminRequestError);
    expect(defaultFetch).toHaveBeenCalledTimes(1);

    const overrideFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const overrideHttp = await httpClient(overrideFetch, {
      maxRetries: 3,
      shouldRetry: () => true,
      sleep: async () => undefined,
    });

    await expect(
      overrideHttp.request('/write', {
        method: 'PUT',
        skipAuth: true,
        retry: { maxRetries: 1, shouldRetry: () => true, sleep: async () => undefined },
      }),
    ).resolves.toEqual({ ok: true });
    expect(overrideFetch).toHaveBeenCalledTimes(2);
  });

  it('honors an explicit retry maxRetries: 0 over a global retry budget for GET', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const http = await httpClient(fetchMock, { maxRetries: 3, sleep: async () => undefined });

    const error = await http
      .request('/read', { skipAuth: true, retry: { maxRetries: 0 } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['fractional', 0.5],
    ['negative', -1],
  ])('normalizes an invalid %s maxRetries budget to zero', async (_label, maxRetries) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const http = await httpClient(fetchMock, { maxRetries, sleep: async () => undefined });

    const error = await http.request('/read', { skipAuth: true }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a timeout or turn an auth failure into a network retry', async () => {
    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const timeoutHttp = await httpClient(timeoutFetch, { maxRetries: 3, sleep: async () => undefined });
    await expect(timeoutHttp.request('/slow', { skipAuth: true, timeoutMs: 1 })).rejects.toBeInstanceOf(
      GarminTimeoutError,
    );
    expect(timeoutFetch).toHaveBeenCalledTimes(1);

    const authFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    const authHttp = await httpClient(authFetch, { maxRetries: 3, sleep: async () => undefined });
    await expect(authHttp.request('/private', { skipAuth: true })).rejects.toBeInstanceOf(
      GarminSessionExpiredError,
    );
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
});

async function httpClient(
  fetchMock: typeof fetch,
  retry: { maxRetries: number; sleep: () => Promise<void>; shouldRetry?: (error: unknown) => boolean },
): Promise<HttpClient> {
  const storage = new MemoryTokenStorage();
  await storage.save(tokens());
  const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
  return new HttpClient({ auth, fetch: fetchMock, retry });
}
