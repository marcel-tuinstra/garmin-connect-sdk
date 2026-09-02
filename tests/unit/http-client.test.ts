import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { AuthService } from '../../src/auth/AuthService.js';
import {
  GarminBotChallengeError,
  GarminRequestError,
  GarminSessionExpiredError,
  GarminTimeoutError,
  GarminValidationError,
} from '../../src/client/GarminRequestError.js';
import { buildPath, formatZodIssues, HttpClient } from '../../src/client/HttpClient.js';
import type { RetryOptions } from '../../src/utils/retry.js';
import { expiredTokens, jsonResponse, tokenResponse, tokens } from '../helpers/garmin.js';

describe('HttpClient', () => {
  it('supports per-request retry overrides', async () => {
    // Arrange
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const result = await http.request('/test', {
      retry: { maxRetries: 1, sleep: async () => undefined, random: () => 0 },
    });

    // Assert
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries GET and HEAD network, rate-limit, and server failures', async () => {
    // Arrange
    const getFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(jsonResponse({ get: true }));
    const headFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const getHttp = httpClient(getFetch, { maxRetries: 1 });
    const headHttp = httpClient(headFetch, { maxRetries: 1 });

    // Act
    const getResult = await getHttp.request('/read', {
      retry: { sleep: async () => undefined, random: () => 0 },
    });
    const headResult = await headHttp.request('/read', {
      method: 'head',
      retry: { sleep: async () => undefined, random: () => 0 },
    });

    // Assert
    expect(getResult).toEqual({ get: true });
    expect(headResult).toBeUndefined();
    expect(getFetch).toHaveBeenCalledTimes(2);
    expect(headFetch).toHaveBeenCalledTimes(2);
    expect(headFetch.mock.calls[0]?.[1]?.method).toBe('HEAD');
  });

  it('does not let global retry settings or predicates retry writes by default', async () => {
    // Arrange
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ shouldNotRun: true }));
    const http = httpClient(fetchMock, { maxRetries: 3, shouldRetry: () => true });

    // Act
    const error = await http.request('/write', { method: 'post', body: { value: 1 } }).catch(
      (caught: unknown) => caught,
    );

    // Assert
    expect(error).toBeInstanceOf(GarminRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a write only when the request explicitly supplies a retry budget', async () => {
    // Arrange
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ saved: true }));
    const http = httpClient(fetchMock, { maxRetries: 3 });

    // Act
    const result = await http.request('/write', {
      method: 'PUT',
      body: { value: 1 },
      retry: { maxRetries: 1, sleep: async () => undefined, random: () => 0 },
    });

    // Assert
    expect(result).toEqual({ saved: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unsafe timeout by default', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const http = httpClient(fetchMock, { maxRetries: 3 });

    // Act
    const error = await http
      .request('/write', { method: 'DELETE', timeoutMs: 1 })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminTimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('builds query strings, serializes JSON bodies, and supports skipAuth requests', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ saved: true }));
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const result = await http.request('/write', {
      method: 'POST',
      query: { start: 0, limit: 20, includePrivate: false, omitted: undefined },
      body: { name: 'Workout' },
      skipAuth: true,
    });

    // Assert
    expect(result).toEqual({ saved: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://connectapi.garmin.com/write?start=0&limit=20&includePrivate=false',
    );
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('user-agent')).toBe('garmin-connect-sdk/1.0.0');
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ name: 'Workout' }));
  });

  it('returns undefined for 204 and empty JSON responses', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const result = await http.request('/empty', { skipAuth: true });

    // Assert
    expect(result).toBeUndefined();
  });

  it('returns binary responses without parsing JSON', async () => {
    // Arrange
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes));
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const result = await http.request('/download', {
      responseType: 'bytes',
      skipAuth: true,
    });

    // Assert
    expect(result).toEqual(bytes);
  });

  it('shares one token refresh across concurrent authenticated requests', async () => {
    // Arrange
    let resolveRefresh: (response: Response) => void = () => undefined;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const storage = new MemoryTokenStorage();
    await storage.save(expiredTokens());
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (String(input).includes('/di-oauth2-service/oauth/token')) return refreshResponse;
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const auth = new AuthService({ fetch: fetchMock, storage });
    const http = new HttpClient({ auth, fetch: fetchMock, retry: { maxRetries: 0 } });

    // Act
    const first = http.request('/first');
    const second = http.request('/second');
    await Promise.resolve();
    resolveRefresh(tokenResponse('new-refresh-token'));
    await Promise.all([first, second]);

    // Assert
    const refreshCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/di-oauth2-service/oauth/token'),
    );
    const requestCalls = fetchMock.mock.calls.filter(
      ([input]) => !String(input).includes('/di-oauth2-service/oauth/token'),
    );
    expect(refreshCalls).toHaveLength(1);
    expect(requestCalls).toHaveLength(2);
    for (const [, init] of requestCalls) {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${auth.tokens?.accessToken}`,
      );
    }
  });

  it('maps unauthorized API responses to session expiration errors', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const error = await http
      .request('/private', { skipAuth: true })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect((error as GarminSessionExpiredError).endpoint).toBe('/private');
  });

  it('recovers once and replays an authenticated GET after a definitive rejection', async () => {
    // Arrange
    let apiCalls = 0;
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ refreshToken: 'recover-refresh-token' }));
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (String(input).includes('/di-oauth2-service/oauth/token')) {
        return Promise.resolve(tokenResponse('recovered-refresh-token'));
      }
      apiCalls += 1;
      return Promise.resolve(
        apiCalls === 1 ? new Response('', { status: 401 }) : jsonResponse({ recovered: true }),
      );
    });
    const auth = new AuthService({ fetch: fetchMock, storage });
    const http = new HttpClient({ auth, fetch: fetchMock, retry: { maxRetries: 0 } });

    // Act
    const result = await http.request('/private');

    // Assert
    expect(result).toEqual({ recovered: true });
    expect(apiCalls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await storage.load())?.refreshToken).toBe('recovered-refresh-token');
  });

  it('does not recover or replay a mutating request', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    const http = httpClient(fetchMock, { maxRetries: 3 });

    // Act
    const error = await http
      .request('/private', { method: 'POST', body: { mutation: true } })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry after a failed controlled recovery even with an always-retry policy', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ refreshToken: 'recover-refresh-token' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const auth = new AuthService({ fetch: fetchMock, storage });
    const http = new HttpClient({
      auth,
      fetch: fetchMock,
      retry: { maxRetries: 3, shouldRetry: () => true, sleep: async () => undefined },
    });

    // Act
    const error = await http.request('/private').catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminRequestError);
    expect((error as GarminRequestError).statusCode).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses explicit JSON token rejection and challenge headers to classify failed requests', async () => {
    // Arrange
    const tokenRejected = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'invalid_token' }, { status: 403 }));
    const cloudflareChallenge = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
      );

    // Act
    const rejectionError = await httpClient(tokenRejected, { maxRetries: 0 })
      .request('/private', { skipAuth: true })
      .catch((caught: unknown) => caught);
    const challengeError = await httpClient(cloudflareChallenge, { maxRetries: 0 })
      .request('/private', { skipAuth: true })
      .catch((caught: unknown) => caught);

    // Assert
    expect(rejectionError).toBeInstanceOf(GarminSessionExpiredError);
    expect(challengeError).toBeInstanceOf(GarminBotChallengeError);
  });

  it('does not classify a generic 403 response as an expired session', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 }));
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const error = await http
      .request('/private', { skipAuth: true })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminRequestError);
    expect(error).not.toBeInstanceOf(GarminSessionExpiredError);
  });

  it('does not clear a session when a skipAuth request is rejected', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens());
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    const auth = new AuthService({ fetch: fetchMock, storage });
    const http = new HttpClient({ auth, fetch: fetchMock, retry: { maxRetries: 0 } });

    // Act
    const error = await http
      .request('/public', { skipAuth: true })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect(await storage.load()).toMatchObject({ accessToken: 'access-token' });
  });

  it('does not wait for a failed response body cancellation', async () => {
    // Arrange
    const oversizedJson = new Uint8Array(8_193);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(oversizedJson);
          },
          cancel() {
            return Promise.reject(new Error('cancellation failed'));
          },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const error = await http
      .request('/private', { skipAuth: true })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminRequestError);
  });

  it('bounds structured error inspection when a response body stalls', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          pull() {
            return new Promise<void>(() => undefined);
          },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const error = await Promise.race([
      http.request('/private', { skipAuth: true }).catch((caught: unknown) => caught),
      new Promise<unknown>((resolve) => setTimeout(() => resolve('timed out'), 500)),
    ]);

    // Assert
    expect(error).toBeInstanceOf(GarminRequestError);
  });

  it('throws a timeout error when the request is aborted', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const error = await http
      .request('/slow', { skipAuth: true, timeoutMs: 1 })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminTimeoutError);
  });

  it('formats nested union validation issue paths', async () => {
    // Arrange
    const schema = z
      .array(z.object({ startTimestampGMT: z.string(), endTimestampGMT: z.string() }))
      .or(z.object({ calendarDate: z.string() }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse([{ startTimestampGMT: null }]));
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const error = await http.request('/bad', { schema }).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminValidationError);
    expect((error as GarminValidationError).issues).toEqual([
      '0.startTimestampGMT',
      '0.endTimestampGMT',
      '<root>',
    ]);
  });

  it('formats standalone Zod issue paths', () => {
    // Arrange
    const result = z.object({ dailySleepDTO: z.object({ calendarDate: z.string() }) }).safeParse({
      dailySleepDTO: {},
    });

    // Act
    const issues = result.success ? [] : formatZodIssues(result.error.issues);

    // Assert
    expect(result.success).toBe(false);
    expect(issues).toEqual(['dailySleepDTO.calendarDate']);
  });

  it('omits undefined query values while preserving false and zero', () => {
    // Arrange
    const query = { start: 0, includePrivate: false, omitted: undefined };

    // Act
    const path = buildPath('/activities', query);

    // Assert
    expect(path).toBe('/activities?start=0&includePrivate=false');
  });

  it('uses a redacted diagnostic endpoint while requesting the real URL', async () => {
    // Arrange
    const debug = vi.fn();
    const logger = {
      debug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ deleted: true }));
    const auth = new AuthService({
      fetch: fetchMock,
      storage: new MemoryTokenStorage(),
      retry: { maxRetries: 0 },
    });
    void auth.storage.save(tokens());
    const http = new HttpClient({ auth, fetch: fetchMock, logger, retry: { maxRetries: 0 } });

    // Act
    await http.request('/weight-service/weight/2026-07-18/byversion/987654321', {
      method: 'DELETE',
      diagnosticPath: '/weight-service/weight/[REDACTED]/byversion/[REDACTED]',
    });

    // Assert
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/weight-service/weight/2026-07-18/byversion/987654321',
    );
    expect(JSON.stringify(debug.mock.calls)).not.toContain('987654321');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('2026-07-18');
  });

  it('uses the redacted diagnostic endpoint in response errors', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const error = await http
      .request('/weight-service/weight/2026-07-18/byversion/987654321', {
        method: 'DELETE',
        diagnosticPath: '/weight-service/weight/[REDACTED]/byversion/[REDACTED]',
      })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toContain('987654321');
    expect(JSON.stringify(error)).not.toContain('2026-07-18');
  });

  it('uses the redacted diagnostic endpoint in timeout errors', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const http = httpClient(fetchMock, { maxRetries: 0 });

    // Act
    const error = await http
      .request('/weight-service/weight/2026-07-18/byversion/987654321', {
        method: 'DELETE',
        timeoutMs: 1,
        diagnosticPath: '/weight-service/weight/[REDACTED]/byversion/[REDACTED]',
      })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminTimeoutError);
    expect(JSON.stringify(error)).not.toContain('987654321');
    expect(JSON.stringify(error)).not.toContain('2026-07-18');
  });
});

function httpClient(fetchMock: typeof fetch, retry: RetryOptions): HttpClient {
  const auth = new AuthService({
    fetch: fetchMock,
    storage: new MemoryTokenStorage(),
    retry,
  });
  void auth.storage.save(tokens());
  return new HttpClient({
    auth,
    fetch: fetchMock,
    retry,
  });
}
