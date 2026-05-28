import { describe, expect, it } from 'vitest';

import {
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

  it('maps auth statuses to session expiration', () => {
    // Arrange
    const unauthorized = new Response('', { status: 401 });
    const forbidden = new Response('', { status: 403 });

    // Act
    const unauthorizedError = errorFromResponse(unauthorized, '/x');
    const forbiddenError = errorFromResponse(forbidden, '/x');

    // Assert
    expect(unauthorizedError).toBeInstanceOf(GarminSessionExpiredError);
    expect(forbiddenError).toBeInstanceOf(GarminSessionExpiredError);
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
    expect(badRequestError.message).toContain('400 Bad Request');
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
