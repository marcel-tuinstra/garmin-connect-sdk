import { describe, expect, it, vi } from 'vitest';

import { GarminAuthError, GarminRateLimitError } from '../../src/client/GarminRequestError.js';
import { calculateDelayMs, isRetryableStatus, withRetry } from '../../src/utils/retry.js';

describe('retry', () => {
  it('retries retryable failures up to maxRetries', async () => {
    // Arrange
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('ok');

    // Act
    const result = await withRetry(operation, { sleep: async () => undefined, random: () => 0 });

    // Assert
    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry auth errors', async () => {
    // Arrange
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new GarminAuthError({ message: 'no' }));

    // Act
    const error = await withRetry(operation, { sleep: async () => undefined }).catch(
      (caught: unknown) => caught,
    );

    // Assert
    expect(error).toBeInstanceOf(GarminAuthError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops after maxRetries is exhausted', async () => {
    // Arrange
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('network'));

    // Act
    const error = await withRetry(operation, {
      maxRetries: 2,
      sleep,
      random: () => 0,
    }).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('uses Retry-After ahead of backoff', () => {
    // Arrange
    const error = new GarminRateLimitError({ message: 'limited', retryAfterMs: 2500 });

    // Act
    const delay = calculateDelayMs(error, 1, { random: () => 0 });

    // Assert
    expect(delay).toBe(2500);
  });

  it('calculates bounded jitter and retryable statuses', () => {
    // Arrange
    const error = new Error('x');

    // Act
    const delay = calculateDelayMs(error, 2, { baseDelayMs: 100, random: () => 1 });

    // Assert
    expect(delay).toBe(240);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
  });
});
