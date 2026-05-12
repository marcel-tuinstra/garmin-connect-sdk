export interface GarminErrorOptions {
  message: string;
  statusCode?: number;
  endpoint?: string;
  cause?: unknown;
}

export class GarminRequestError extends Error {
  readonly statusCode?: number;
  readonly endpoint?: string;
  override readonly cause?: unknown;

  constructor({ message, statusCode, endpoint, cause }: GarminErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.cause = cause;
  }
}

export class GarminAuthError extends GarminRequestError {}

export class GarminRateLimitError extends GarminRequestError {
  readonly retryAfterMs?: number;

  constructor(options: GarminErrorOptions & { retryAfterMs?: number }) {
    super(options);
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class GarminSessionExpiredError extends GarminAuthError {}

export class GarminMfaRequiredError extends GarminAuthError {}

export class GarminValidationError extends GarminRequestError {
  readonly issues: string[];

  constructor(options: GarminErrorOptions & { issues: string[] }) {
    super(options);
    this.issues = options.issues;
  }
}

export function errorFromResponse(
  response: Pick<Response, 'status' | 'statusText' | 'headers'>,
  endpoint: string,
): GarminRequestError {
  const statusCode = response.status;

  if (statusCode === 429) {
    return new GarminRateLimitError({
      message: 'Garmin rate limit exceeded.',
      statusCode,
      endpoint,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  }

  if (statusCode === 401 || statusCode === 403) {
    return new GarminSessionExpiredError({
      message: 'Garmin session is expired or unauthorized.',
      statusCode,
      endpoint,
    });
  }

  if (statusCode >= 500) {
    return new GarminRequestError({
      message: `Garmin service is unavailable (${statusCode}).`,
      statusCode,
      endpoint,
    });
  }

  return new GarminRequestError({
    message: `Garmin request failed (${statusCode} ${response.statusText}).`,
    statusCode,
    endpoint,
  });
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;

  return Math.max(0, dateMs - Date.now());
}
