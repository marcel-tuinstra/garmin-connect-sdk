import { GarminAuthError, GarminRequestError, GarminValidationError } from '../client/GarminRequestError.js';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export const DEFAULT_RETRY_OPTIONS: Required<
  Pick<RetryOptions, 'maxRetries' | 'baseDelayMs' | 'maxDelayMs' | 'jitterRatio' | 'random' | 'sleep'>
> = {
  maxRetries: 3,
  baseDelayMs: 250,
  maxDelayMs: 5000,
  jitterRatio: 0.2,
  random: Math.random,
  sleep,
};

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableStatus(statusCode?: number): boolean {
  return statusCode === 429 || (typeof statusCode === 'number' && statusCode >= 500);
}

export function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof GarminValidationError || error instanceof GarminAuthError) return false;
  if (error instanceof GarminRequestError) return isRetryableStatus(error.statusCode);
  return true;
}

export function calculateDelayMs(error: unknown, attempt: number, options: RetryOptions = {}): number {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const retryAfterMs =
    typeof error === 'object' &&
    error !== null &&
    'retryAfterMs' in error &&
    typeof error.retryAfterMs === 'number'
      ? error.retryAfterMs
      : undefined;

  if (retryAfterMs !== undefined) return retryAfterMs;

  const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = exponential * config.jitterRatio * config.random();
  return Math.round(exponential + jitter);
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const maxRetries = normalizeMaxRetries(config.maxRetries);
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      attempt += 1;
      await config.sleep(calculateDelayMs(error, attempt, config));
    }
  }
}

function normalizeMaxRetries(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}
