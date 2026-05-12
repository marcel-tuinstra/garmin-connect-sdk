import type { ZodType } from 'zod';

import { errorFromResponse, GarminValidationError } from './GarminRequestError.js';
import type { AuthService } from '../auth/AuthService.js';
import { noopLogger, summarizePayload, type Logger } from '../utils/logger.js';
import { withRetry, type RetryOptions } from '../utils/retry.js';

export interface RequestOptions<T> {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  schema?: ZodType<T>;
  skipAuth?: boolean;
}

export interface HttpClientOptions {
  auth: AuthService;
  fetch?: typeof fetch;
  logger?: Logger;
  retry?: RetryOptions;
  baseUrl?: string;
}

export class HttpClient {
  readonly baseUrl: string;
  #auth: AuthService;
  #fetch: typeof fetch;
  #logger: Logger;
  #retry: RetryOptions;

  constructor(options: HttpClientOptions) {
    this.#auth = options.auth;
    this.#fetch = options.fetch ?? fetch;
    this.#logger = options.logger ?? noopLogger;
    this.#retry = options.retry ?? {};
    this.baseUrl = options.baseUrl ?? 'https://connectapi.garmin.com';
  }

  async request<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    const endpoint = buildPath(path, options.query);

    return withRetry(async () => {
      const headers = new Headers({
        accept: 'application/json',
        'nk': 'NT',
        'user-agent': 'garmin-connect-sdk/0.1',
      });

      if (!options.skipAuth) {
        const tokens = await this.#auth.refreshIfNeeded();
        headers.set('authorization', `Bearer ${tokens.accessToken}`);
      }

      let body: BodyInit | undefined;
      if (options.body !== undefined) {
        headers.set('content-type', 'application/json');
        body = JSON.stringify(options.body);
      }

      const response = await this.#fetch(new URL(endpoint, this.baseUrl), {
        method: options.method ?? 'GET',
        headers,
        body,
      });

      if (!response.ok) throw errorFromResponse(response, endpoint);
      const payload = await parseJson(response);
      this.#logger.debug('Garmin response received.', { endpoint, payload: summarizePayload(payload) });

      if (!options.schema) return payload as T;
      const result = options.schema.safeParse(payload);
      if (!result.success) {
        throw new GarminValidationError({
          message: 'Garmin response validation failed.',
          endpoint,
          issues: result.error.issues.map((issue) => issue.path.join('.') || '<root>'),
          cause: result.error,
        });
      }

      return result.data;
    }, this.#retry);
  }
}

export function buildPath(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const queryString = search.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function parseJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  return JSON.parse(text) as unknown;
}
