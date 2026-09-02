export interface GarminErrorOptions {
  message: string;
  statusCode?: number;
  endpoint?: string;
  cause?: unknown;
}

/** Internal, sanitized evidence extracted from an unsuccessful response. */
export interface ResponseErrorEvidence {
  code?: 'invalid_token' | 'invalid_grant' | 'invalid_client' | 'captcha_required' | 'bot_challenge' | 'challenge_required';
  challenge?: boolean;
}

/** Fixed bounds prevent failure classification from becoming an unbounded I/O operation. */
const MAX_ERROR_EVIDENCE_BYTES = 8_192;
const MAX_ERROR_EVIDENCE_READ_MS = 250;

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

export class GarminBotChallengeError extends GarminRequestError {}

export class GarminRateLimitError extends GarminRequestError {
  readonly retryAfterMs?: number;

  constructor(options: GarminErrorOptions & { retryAfterMs?: number }) {
    super(options);
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class GarminSessionExpiredError extends GarminAuthError {}

export class GarminMfaRequiredError extends GarminAuthError {}

export class GarminTimeoutError extends GarminRequestError {}

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
  evidence?: ResponseErrorEvidence,
): GarminRequestError {
  const statusCode = response.status;
  const responseEvidence = evidence ?? headerErrorEvidence(response.headers);

  if (statusCode === 429) {
    return new GarminRateLimitError({
      message: 'Garmin rate limit exceeded.',
      statusCode,
      endpoint,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  }

  if (statusCode >= 500) {
    return new GarminRequestError({
      message: `Garmin service is unavailable (${statusCode}).`,
      statusCode,
      endpoint,
    });
  }

  if (responseEvidence.challenge || isChallengeCode(responseEvidence.code)) {
    return new GarminBotChallengeError({
      message: 'Garmin requires a bot or CAPTCHA challenge to be completed.',
      statusCode,
      endpoint,
    });
  }

  if (responseEvidence.code === 'invalid_client') {
    return new GarminRequestError({
      message: 'Garmin rejected the configured authentication client.',
      statusCode,
      endpoint,
    });
  }

  if (isSessionRejectionCode(responseEvidence.code, endpoint) || statusCode === 401) {
    return new GarminSessionExpiredError({
      message: 'Garmin session is expired or unauthorized.',
      statusCode,
      endpoint,
    });
  }

  return new GarminRequestError({
    message: `Garmin request failed (${statusCode}).`,
    statusCode,
    endpoint,
  });
}

/**
 * Reads a small, structured subset of a failed response without retaining or
 * surfacing its body. Only exact OAuth-style values are accepted as evidence.
 */
export async function readResponseErrorEvidence(response: Response): Promise<ResponseErrorEvidence> {
  const headerEvidence = headerErrorEvidence(response.headers);
  if (
    response.status !== 400 &&
    response.status !== 401 &&
    response.status !== 403
  ) {
    return headerEvidence;
  }
  if (headerEvidence.code || headerEvidence.challenge || !isJsonResponse(response)) return headerEvidence;

  const body = await readCappedBody(response);
  if (!body) return headerEvidence;

  try {
    const payload: unknown = JSON.parse(body);
    return { ...headerEvidence, code: knownErrorCode(errorField(payload)) };
  } catch {
    return headerEvidence;
  }
}

function isSessionRejectionCode(code: ResponseErrorEvidence['code'], endpoint: string): boolean {
  return (
    code === 'invalid_token' ||
    (code === 'invalid_grant' && endpoint === '/di-oauth2-service/oauth/token')
  );
}

function isChallengeCode(code: ResponseErrorEvidence['code']): boolean {
  return code === 'captcha_required' || code === 'bot_challenge' || code === 'challenge_required';
}

function knownErrorCode(value: string | undefined): ResponseErrorEvidence['code'] | undefined {
  switch (value?.trim().toLowerCase()) {
    case 'invalid_token':
    case 'invalid_grant':
    case 'invalid_client':
    case 'captcha_required':
    case 'bot_challenge':
    case 'challenge_required':
      return value.trim().toLowerCase() as ResponseErrorEvidence['code'];
    default:
      return undefined;
  }
}

function headerErrorEvidence(headers: Headers): ResponseErrorEvidence {
  return {
    code: knownErrorCode(readBearerError(headers.get('www-authenticate'))),
    challenge: headers.get('cf-mitigated')?.trim().toLowerCase() === 'challenge',
  };
}

function readBearerError(value: string | null): string | undefined {
  if (!value) return undefined;
  const bearer = /(?:^|,\s*)Bearer\s+(.+?)(?=,\s*[A-Za-z][A-Za-z0-9_-]*\s+\w+\s*=|$)/i.exec(value)?.[1];
  return bearer ? /(?:^|,\s*)error\s*=\s*"([^"]+)"/i.exec(bearer)?.[1] : undefined;
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return contentType.includes('application/json') || contentType.includes('+json');
}

function errorField(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const object = payload as Record<string, unknown>;
  if (typeof object.error === 'string') return object.error;
  const responseStatus = object.responseStatus;
  if (!responseStatus || typeof responseStatus !== 'object' || Array.isArray(responseStatus)) {
    return undefined;
  }
  const type = (responseStatus as Record<string, unknown>).type;
  return typeof type === 'string' ? type : undefined;
}

async function readCappedBody(response: Response): Promise<string | undefined> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_ERROR_EVIDENCE_BYTES) return undefined;
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + MAX_ERROR_EVIDENCE_READ_MS;
  let bytesRead = 0;
  let text = '';

  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      const result = await readWithTimeout(reader.read(), remaining);
      if (!result) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      const { done, value } = result;
      if (done) return text + decoder.decode();
      bytesRead += value.byteLength;
      if (bytesRead > MAX_ERROR_EVIDENCE_BYTES) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

async function readWithTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;

  return Math.max(0, dateMs - Date.now());
}
