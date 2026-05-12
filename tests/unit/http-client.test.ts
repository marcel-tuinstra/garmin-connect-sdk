import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import type { GarminTokens } from '../../src/auth/types.js';
import { AuthService } from '../../src/auth/AuthService.js';
import { GarminTimeoutError, GarminValidationError } from '../../src/client/GarminRequestError.js';
import { formatZodIssues, HttpClient } from '../../src/client/HttpClient.js';

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

    // Act / Assert
    await expect(http.request('/slow', { skipAuth: true, timeoutMs: 1 })).rejects.toThrow(
      GarminTimeoutError,
    );
  });

  it('formats nested union validation issue paths', async () => {
    // Arrange
    const schema = z
      .array(z.object({ startTimestampGMT: z.string(), endTimestampGMT: z.string() }))
      .or(z.object({ calendarDate: z.string() }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{ startTimestampGMT: null }]));
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
    const result = z.object({ dailySleepDTO: z.object({ calendarDate: z.string() }) }).safeParse({
      dailySleepDTO: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodIssues(result.error.issues)).toEqual(['dailySleepDTO.calendarDate']);
    }
  });
});

function httpClient(fetchMock: typeof fetch, retry: { maxRetries: number }): HttpClient {
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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  });
}

function tokens(): GarminTokens {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  };
}
