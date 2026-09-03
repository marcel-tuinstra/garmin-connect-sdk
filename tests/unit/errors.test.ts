import { describe, expect, it } from 'vitest';

import {
  GarminBotChallengeError,
  GarminRateLimitError,
  GarminRequestError,
  GarminSessionExpiredError,
  GarminValidationError,
  errorFromResponse,
  parseRetryAfter,
} from '../../src/client/GarminRequestError.js';

describe('errors', () => {
  it('maps 429 to GarminRateLimitError with retry-after', () => {
    // Arrange
    const response = new Response('', { status: 429, headers: { 'retry-after': '2' } });

    // Act
    const error = errorFromResponse(response, '/x');

    // Assert
    expect(error).toBeInstanceOf(GarminRateLimitError);
    expect((error as GarminRateLimitError).retryAfterMs).toBe(2000);
  });

  it('keeps bare 401 compatibility but treats a generic 403 as a request error', () => {
    // Arrange
    const unauthorized = new Response('', { status: 401 });
    const forbidden = new Response('', { status: 403 });

    // Act
    const unauthorizedError = errorFromResponse(unauthorized, '/x');
    const forbiddenError = errorFromResponse(forbidden, '/x');

    // Assert
    expect(unauthorizedError).toBeInstanceOf(GarminSessionExpiredError);
    expect(forbiddenError).toBeInstanceOf(GarminRequestError);
    expect(forbiddenError).not.toBeInstanceOf(GarminSessionExpiredError);
  });

  it('uses explicit token and challenge evidence without changing 429 or server errors', () => {
    // Arrange
    const rejected = new Response('', { status: 403 });
    const challenge = new Response('', { status: 401 });
    const rateLimited = new Response('', { status: 429 });
    const unavailable = new Response('', { status: 503 });

    // Act
    const rejectedError = errorFromResponse(rejected, '/x', { code: 'invalid_token' });
    const challengeError = errorFromResponse(challenge, '/x', { challenge: true });
    const rateLimitError = errorFromResponse(rateLimited, '/x', { code: 'invalid_token' });
    const unavailableError = errorFromResponse(unavailable, '/x', { challenge: true });

    // Assert
    expect(rejectedError).toBeInstanceOf(GarminSessionExpiredError);
    expect(challengeError).toBeInstanceOf(GarminBotChallengeError);
    expect(rateLimitError).toBeInstanceOf(GarminRateLimitError);
    expect(unavailableError).toBeInstanceOf(GarminRequestError);
    expect(unavailableError).not.toBeInstanceOf(GarminBotChallengeError);
  });

  it('derives only Bearer header evidence when no explicit evidence is supplied', () => {
    // Arrange
    const bearerRejected = new Response('', {
      status: 403,
      headers: { 'www-authenticate': 'Bearer error="invalid_token"' },
    });
    const basicRejected = new Response('', {
      status: 403,
      headers: { 'www-authenticate': 'Basic error="invalid_token"' },
    });

    // Act
    const bearerError = errorFromResponse(bearerRejected, '/x');
    const basicError = errorFromResponse(basicRejected, '/x');

    // Assert
    expect(bearerError).toBeInstanceOf(GarminSessionExpiredError);
    expect(basicError).toBeInstanceOf(GarminRequestError);
    expect(basicError).not.toBeInstanceOf(GarminSessionExpiredError);
  });

  it('maps unavailable and generic failures without losing endpoint context', () => {
    // Arrange
    const unavailable = new Response('', { status: 503, statusText: 'Service Unavailable' });
    const badRequest = new Response('', { status: 400, statusText: 'Bad Request' });

    // Act
    const unavailableError = errorFromResponse(unavailable, '/unavailable');
    const badRequestError = errorFromResponse(badRequest, '/bad');

    // Assert
    expect(unavailableError).toBeInstanceOf(GarminRequestError);
    expect(unavailableError.message).toContain('unavailable');
    expect(unavailableError.endpoint).toBe('/unavailable');
    expect(badRequestError).toBeInstanceOf(GarminRequestError);
    expect(badRequestError.message).toContain('400');
    expect(badRequestError.message).not.toContain('Bad Request');
    expect(badRequestError.endpoint).toBe('/bad');
  });

  it('parses numeric, date, past, and invalid Retry-After values', () => {
    // Arrange
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const pastDate = new Date(Date.now() - 60_000).toUTCString();

    // Act
    const numeric = parseRetryAfter('2');
    const future = parseRetryAfter(futureDate);
    const past = parseRetryAfter(pastDate);
    const invalid = parseRetryAfter('not-a-date');

    // Assert
    expect(numeric).toBe(2000);
    expect(future).toBeGreaterThan(0);
    expect(past).toBe(0);
    expect(invalid).toBeUndefined();
  });

  it('validation errors expose paths without payloads', () => {
    // Arrange
    const error = new GarminValidationError({
      message: 'bad',
      endpoint: '/x',
      issues: ['dailySleepDTO.calendarDate'],
    });

    // Act
    const serialized = JSON.stringify(error);

    // Assert
    expect(error.issues).toEqual(['dailySleepDTO.calendarDate']);
    expect(serialized).not.toContain('access_token');
  });
});
