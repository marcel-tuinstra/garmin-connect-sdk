import { describe, expect, it, vi } from 'vitest';

import { GarminAuthError, GarminRateLimitError } from '../../src/client/GarminRequestError.js';
import { calculateDelayMs, isRetryableStatus, withRetry } from '../../src/utils/retry.js';

describe('retry', () => {
  it('retries retryable failures up to maxRetries', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(operation, { sleep: async () => undefined, random: () => 0 })).resolves.toBe(
      'ok',
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry auth errors', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new GarminAuthError({ message: 'no' }));

    await expect(withRetry(operation, { sleep: async () => undefined })).rejects.toBeInstanceOf(
      GarminAuthError,
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('uses Retry-After ahead of backoff', () => {
    const error = new GarminRateLimitError({ message: 'limited', retryAfterMs: 2500 });
    expect(calculateDelayMs(error, 1, { random: () => 0 })).toBe(2500);
  });

  it('calculates bounded jitter and retryable statuses', () => {
    expect(calculateDelayMs(new Error('x'), 2, { baseDelayMs: 100, random: () => 1 })).toBe(240);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
  });
});
