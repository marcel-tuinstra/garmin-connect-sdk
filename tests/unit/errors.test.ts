import { describe, expect, it } from 'vitest';

import {
  GarminRateLimitError,
  GarminSessionExpiredError,
  GarminValidationError,
  errorFromResponse,
} from '../../src/client/GarminRequestError.js';

describe('errors', () => {
  it('maps 429 to GarminRateLimitError with retry-after', () => {
    const response = new Response('', { status: 429, headers: { 'retry-after': '2' } });
    const error = errorFromResponse(response, '/x');
    expect(error).toBeInstanceOf(GarminRateLimitError);
    expect((error as GarminRateLimitError).retryAfterMs).toBe(2000);
  });

  it('maps auth statuses to session expiration', () => {
    expect(errorFromResponse(new Response('', { status: 401 }), '/x')).toBeInstanceOf(
      GarminSessionExpiredError,
    );
    expect(errorFromResponse(new Response('', { status: 403 }), '/x')).toBeInstanceOf(
      GarminSessionExpiredError,
    );
  });

  it('validation errors expose paths without payloads', () => {
    const error = new GarminValidationError({
      message: 'bad',
      endpoint: '/x',
      issues: ['dailySleepDTO.calendarDate'],
    });
    expect(error.issues).toEqual(['dailySleepDTO.calendarDate']);
    expect(JSON.stringify(error)).not.toContain('access_token');
  });
});
