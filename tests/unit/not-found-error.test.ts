import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { AuthService } from '../../src/auth/AuthService.js';
import {
  GarminBotChallengeError,
  GarminNotFoundError,
  GarminRateLimitError,
  GarminRequestError,
  GarminSessionExpiredError,
  errorFromResponse,
} from '../../src/client/GarminRequestError.js';
import { HttpClient } from '../../src/client/HttpClient.js';
import { tokens } from '../helpers/garmin.js';

describe('GarminNotFoundError', () => {
  it.each(['GET', 'DELETE'])(
    'maps an authenticated %s 404 without retry or recovery',
    async (method) => {
      // Arrange
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response('private response body', { status: 404 }),
      );
      const storage = new MemoryTokenStorage();
      await storage.save(tokens());
      const auth = new AuthService({ fetch: fetchMock, storage, retry: { maxRetries: 3 } });
      const http = new HttpClient({
        auth,
        fetch: fetchMock,
        retry: { maxRetries: 3, sleep: async () => undefined, random: () => 0 },
      });

      // Act
      const error = await http
        .request('/weight-service/weight/2026-09-10/byversion/987654321', {
          method,
          diagnosticPath: '/weight-service/weight/[REDACTED]/byversion/[REDACTED]',
        })
        .catch((caught: unknown) => caught);

      // Assert
      expect(error).toBeInstanceOf(GarminNotFoundError);
      expect(error).toBeInstanceOf(GarminRequestError);
      expect((error as GarminNotFoundError).statusCode).toBe(404);
      expect((error as GarminNotFoundError).endpoint).toBe(
        '/weight-service/weight/[REDACTED]/byversion/[REDACTED]',
      );
      expect(JSON.stringify(error)).not.toContain('private response body');
      expect(JSON.stringify(error)).not.toContain('987654321');
      expect(JSON.stringify(error)).not.toContain('2026-09-10');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps non-404 status mappings unchanged', () => {
    // Arrange
    const badRequest = new Response('', { status: 400 });
    const unauthorized = new Response('', { status: 401 });
    const challenge = new Response('', { status: 403 });
    const rateLimited = new Response('', { status: 429 });
    const unavailable = new Response('', { status: 500 });

    // Act
    const badRequestError = errorFromResponse(badRequest, '/bad');
    const unauthorizedError = errorFromResponse(unauthorized, '/auth');
    const challengeError = errorFromResponse(challenge, '/challenge', { challenge: true });
    const rateLimitError = errorFromResponse(rateLimited, '/limited');
    const unavailableError = errorFromResponse(unavailable, '/unavailable');

    // Assert
    expect(badRequestError).toBeInstanceOf(GarminRequestError);
    expect(badRequestError).not.toBeInstanceOf(GarminNotFoundError);
    expect(unauthorizedError).toBeInstanceOf(GarminSessionExpiredError);
    expect(unauthorizedError).not.toBeInstanceOf(GarminNotFoundError);
    expect(challengeError).toBeInstanceOf(GarminBotChallengeError);
    expect(challengeError).not.toBeInstanceOf(GarminNotFoundError);
    expect(rateLimitError).toBeInstanceOf(GarminRateLimitError);
    expect(rateLimitError).not.toBeInstanceOf(GarminNotFoundError);
    expect(unavailableError).toBeInstanceOf(GarminRequestError);
    expect(unavailableError).not.toBeInstanceOf(GarminNotFoundError);
  });

  it('preserves challenge and authentication evidence precedence for a 404', () => {
    // Arrange
    const challenge = new Response('', { status: 404 });
    const unauthorized = new Response('', { status: 404 });

    // Act
    const challengeError = errorFromResponse(challenge, '/challenge', { challenge: true });
    const unauthorizedError = errorFromResponse(unauthorized, '/auth', { code: 'invalid_token' });

    // Assert
    expect(challengeError).toBeInstanceOf(GarminBotChallengeError);
    expect(unauthorizedError).toBeInstanceOf(GarminSessionExpiredError);
  });
});
