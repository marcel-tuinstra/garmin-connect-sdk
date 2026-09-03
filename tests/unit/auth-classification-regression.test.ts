import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../src/auth/AuthService.js';
import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { HttpClient } from '../../src/client/HttpClient.js';
import {
  GarminBotChallengeError,
  GarminRateLimitError,
  GarminRequestError,
  GarminSessionExpiredError,
} from '../../src/client/GarminRequestError.js';
import type { Logger } from '../../src/utils/logger.js';
import { tokens } from '../helpers/garmin.js';

describe('auth classification regressions', () => {
  it('treats refresh invalid_grant as definitive and clears persisted tokens', async () => {
    const storage = new MemoryTokenStorage();
    const stored = tokens({ refreshToken: 'refresh-secret' });
    await storage.save(stored);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonErrorResponse(
        {
          error: 'invalid_grant',
          error_description: 'refresh token has been revoked',
          access_token: 'should-not-leak',
        },
        400,
      ),
    );
    const auth = new AuthService({ fetch: fetchMock, storage });

    await expect(auth.refresh()).rejects.toBeInstanceOf(GarminSessionExpiredError);

    expect(await storage.load()).toBeNull();
  });

  it('does not discard persisted tokens for refresh invalid_client', async () => {
    const storage = new MemoryTokenStorage();
    const stored = tokens({ refreshToken: 'refresh-secret' });
    await storage.save(stored);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonErrorResponse(
        { error: 'invalid_client', error_description: 'client rejected', client_secret: 'secret' },
        400,
      ),
    );
    const auth = new AuthService({ fetch: fetchMock, storage });

    const error = await auth.refresh().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminRequestError);
    expect(error).not.toBeInstanceOf(GarminSessionExpiredError);
    expect(await storage.load()).toEqual(stored);
  });

  it('classifies an API invalid_token response as definitive session expiration', async () => {
    const { auth, storage, http } = setupHttp(
      new Response(JSON.stringify({ error: 'invalid_token', access_token: 'expired-secret' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(http.request('/userprofile-service/socialProfile')).rejects.toBeInstanceOf(
      GarminSessionExpiredError,
    );

    expect(await storage.load()).toBeNull();
    expect(auth.tokens).toBeNull();
  });

  it('keeps tokens for an ambiguous generic API 403', async () => {
    const stored = tokens({ accessToken: 'access-secret' });
    const { auth, storage, http } = setupHttp(
      jsonErrorResponse({ message: 'forbidden', access_token: 'must-not-leak' }, 403),
      stored,
    );

    const error = await http.request('/userprofile-service/socialProfile').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminRequestError);
    expect(error).not.toBeInstanceOf(GarminSessionExpiredError);
    expect(error).not.toBeInstanceOf(GarminBotChallengeError);
    expect(auth.tokens?.accessToken).toBe('access-secret');
    expect(await storage.load()).toEqual(stored);
  });

  it('does not clear the session for a skipAuth request receiving 401', async () => {
    const stored = tokens({ accessToken: 'access-secret' });
    const { storage, http } = setupHttp(new Response('', { status: 401 }), stored);

    const error = await http
      .request('/public/status', { skipAuth: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect(await storage.load()).toEqual(stored);
  });

  it('does not treat invalid_token on a Basic challenge as bearer-session rejection', async () => {
    const stored = tokens({ accessToken: 'access-secret' });
    const { auth, storage, http } = setupHttp(
      new Response('', {
        status: 403,
        headers: { 'www-authenticate': 'Basic realm="garmin", error="invalid_token"' },
      }),
      stored,
    );

    const error = await http.request('/userprofile-service/socialProfile').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminRequestError);
    expect(error).not.toBeInstanceOf(GarminSessionExpiredError);
    expect(auth.tokens?.accessToken).toBe('access-secret');
    expect(await storage.load()).toEqual(stored);
  });

  it('does not treat API invalid_grant responses as OAuth refresh rejection', async () => {
    const stored = tokens({ accessToken: 'access-secret' });
    const { auth, storage, http } = setupHttp(
      jsonErrorResponse({ error: 'invalid_grant' }, 403),
      stored,
    );

    const error = await http.request('/userprofile-service/socialProfile').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminRequestError);
    expect(error).not.toBeInstanceOf(GarminSessionExpiredError);
    expect(auth.tokens?.accessToken).toBe('access-secret');
    expect(await storage.load()).toEqual(stored);
  });

  it('classifies Cloudflare mitigation challenges as bot challenges', async () => {
    const stored = tokens({ accessToken: 'access-secret' });
    const { auth, storage, http } = setupHttp(
      new Response('<html>challenge</html>', {
        status: 403,
        headers: { 'cf-mitigated': 'challenge' },
      }),
      stored,
    );

    const error = await http.request('/userprofile-service/socialProfile').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminBotChallengeError);
    expect(auth.tokens?.accessToken).toBe('access-secret');
    expect(await storage.load()).toEqual(stored);
  });

  it('preserves server-error classification when a 5xx payload says invalid_token', async () => {
    const stored = tokens({ accessToken: 'access-secret' });
    const { auth, storage, http } = setupHttp(
      jsonErrorResponse({ error: 'invalid_token', access_token: 'must-not-leak' }, 503),
      stored,
    );

    const error = await http.request('/userprofile-service/socialProfile').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminRequestError);
    expect(error).not.toBeInstanceOf(GarminSessionExpiredError);
    expect(error).not.toBeInstanceOf(GarminBotChallengeError);
    expect((error as GarminRequestError).statusCode).toBe(503);
    expect(auth.tokens?.accessToken).toBe('access-secret');
    expect(await storage.load()).toEqual(stored);
  });

  it('keeps rate-limit classification independent of an error payload', async () => {
    const stored = tokens({ accessToken: 'access-secret' });
    const { storage, http } = setupHttp(
      jsonErrorResponse({ error: 'invalid_token', access_token: 'must-not-leak' }, 429),
      stored,
    );

    const error = await http.request('/userprofile-service/socialProfile').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GarminRateLimitError);
    expect(await storage.load()).toEqual(stored);
  });

  it('does not echo response bodies, credentials, tokens, or status text in errors or logs', async () => {
    const debug = vi.fn<Logger['debug']>();
    const logger: Logger = {
      debug,
      info: vi.fn<Logger['info']>(),
      warn: vi.fn<Logger['warn']>(),
      error: vi.fn<Logger['error']>(),
    };
    const statusText = 'private-status-text';
    const body = JSON.stringify({
      username: 'runner@example.com',
      password: 'password-secret',
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
    });
    const { http } = setupHttp(
      new Response(body, {
        status: 500,
        statusText,
        headers: { 'content-type': 'application/json' },
      }),
      tokens({ accessToken: 'access-secret' }),
      logger,
    );

    const error = await http
      .request('/weight-service/weight/2026-07-18/byversion/123', {
        diagnosticPath: '/weight-service/weight/[REDACTED]/byversion/[REDACTED]',
      })
      .catch((caught: unknown) => caught);
    const serializedError = JSON.stringify(error);
    const serializedLogs = JSON.stringify(debug.mock.calls);

    expect(error).toBeInstanceOf(GarminRequestError);
    expect((error as GarminRequestError).endpoint).toBe(
      '/weight-service/weight/[REDACTED]/byversion/[REDACTED]',
    );
    for (const secret of ['runner@example.com', 'password-secret', 'access-secret', 'refresh-secret', statusText]) {
      expect(serializedError).not.toContain(secret);
      expect(serializedLogs).not.toContain(secret);
    }
  });
});

function setupHttp(
  response: Response,
  stored = tokens(),
  logger?: Logger,
): { auth: AuthService; storage: MemoryTokenStorage; http: HttpClient } {
  const storage = new MemoryTokenStorage();
  void storage.save(stored);
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 0 } });
  const http = new HttpClient({ auth, fetch: fetchMock, logger, retry: { maxRetries: 0 } });
  return { auth, storage, http };
}

function jsonErrorResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
