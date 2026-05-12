export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'Authorization',
  'authorization',
  'ticket',
]);

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : redact(nested);
    }
    return output;
  }

  return value;
}

export function summarizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (value && typeof value === 'object') return { type: 'object', keys: Object.keys(value).slice(0, 20) };
  return { type: typeof value };
}
