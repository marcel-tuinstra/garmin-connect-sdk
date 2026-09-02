import type { ZodIssue, ZodType } from 'zod';

import {
  errorFromResponse,
  GarminRequestError,
  GarminSessionExpiredError,
  GarminTimeoutError,
  GarminValidationError,
  readResponseErrorEvidence,
} from './GarminRequestError.js';
import type { AuthService } from '../auth/AuthService.js';
import type { GarminTokens } from '../auth/types.js';
import { noopLogger, summarizePayload, type Logger } from '../utils/logger.js';
import { defaultShouldRetry, withRetry, type RetryOptions } from '../utils/retry.js';

export interface RequestOptions<T> {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  schema?: ZodType<T>;
  responseType?: 'json' | 'bytes';
  skipAuth?: boolean;
  retry?: RetryOptions;
  timeoutMs?: number;
  /** Redacted path used in logs and errors while the real path is sent over the wire. */
  diagnosticPath?: string;
}

export interface HttpClientOptions {
  auth: AuthService;
  fetch?: typeof fetch;
  logger?: Logger;
  retry?: RetryOptions;
  baseUrl?: string;
  timeoutMs?: number;
}

interface DispatchedSession {
  tokens: GarminTokens;
  generation: number;
}

export class HttpClient {
  readonly baseUrl: string;
  #auth: AuthService;
  #fetch: typeof fetch;
  #logger: Logger;
  #retry: RetryOptions;
  #timeoutMs?: number;

  constructor(options: HttpClientOptions) {
    this.#auth = options.auth;
    this.#fetch = options.fetch ?? fetch;
    this.#logger = options.logger ?? noopLogger;
    this.#retry = options.retry ?? {};
    this.#timeoutMs = options.timeoutMs;
    this.baseUrl = options.baseUrl ?? 'https://connectapi.garmin.com';
  }

  async request<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    const endpoint = buildPath(path, options.query);
    const diagnosticEndpoint = buildPath(options.diagnosticPath ?? path, options.query);
    let dispatchedSession: DispatchedSession | undefined;
    const retry = { ...this.#retry, ...options.retry };
    const configuredShouldRetry = retry.shouldRetry;

    try {
      return await withRetry(
        () => {
          dispatchedSession = undefined;
          return this.#requestOnce(endpoint, diagnosticEndpoint, options, (tokens, generation) => {
            dispatchedSession = { tokens, generation };
          });
        },
        {
          ...retry,
          shouldRetry: (error, attempt) =>
            !(error instanceof GarminSessionExpiredError) &&
            (configuredShouldRetry?.(error, attempt) ?? defaultShouldRetry(error)),
        },
      );
    } catch (error) {
      if (!canRecoverRequest(error, options, dispatchedSession)) {
        if (error instanceof GarminSessionExpiredError && dispatchedSession && !options.skipAuth) {
          await this.#auth.invalidateSession(
            dispatchedSession.tokens,
            dispatchedSession.generation,
          );
        }
        throw error;
      }
      if (!dispatchedSession) throw error;
      const recoverySession = dispatchedSession;

      try {
        await this.#auth.recoverSession(recoverySession.tokens, recoverySession.generation);
      } catch (recoveryError) {
        if (recoveryError instanceof GarminRequestError) throw recoveryError;
        throw new GarminRequestError({
          message: 'Garmin session recovery failed.',
          endpoint: diagnosticEndpoint,
        });
      }

      if (this.#auth.sessionGeneration !== recoverySession.generation) {
        throw new GarminRequestError({
          message: 'Garmin session recovery was cancelled.',
          endpoint: diagnosticEndpoint,
        });
      }

      const replaySession: { current?: DispatchedSession } = {};
      try {
        return await this.#requestOnce(
          endpoint,
          diagnosticEndpoint,
          options,
          (tokens, generation) => {
            replaySession.current = { tokens, generation };
          },
        );
      } catch (replayError) {
        if (replayError instanceof GarminSessionExpiredError && replaySession.current) {
          await this.#auth.invalidateSession(
            replaySession.current.tokens,
            replaySession.current.generation,
          );
        }
        throw replayError;
      }
    }
  }

  async #requestOnce<T>(
    endpoint: string,
    diagnosticEndpoint: string,
    options: RequestOptions<T>,
    onAuthenticatedDispatch?: (tokens: GarminTokens, generation: number) => void,
  ): Promise<T> {
    const headers = new Headers({
      accept: 'application/json',
      nk: 'NT',
      'user-agent': 'garmin-connect-sdk/1.0.0',
    });

    if (!options.skipAuth) {
      const generation = this.#auth.sessionGeneration;
      const tokens = await this.#auth.refreshIfNeeded();
      if (generation !== this.#auth.sessionGeneration) {
        throw new GarminRequestError({
          message: 'Garmin session changed before request dispatch.',
        });
      }
      headers.set('authorization', `Bearer ${tokens.accessToken}`);
      onAuthenticatedDispatch?.(tokens, generation);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.body);
    }

    const response = await this.#fetchWithTimeout(new URL(endpoint, this.baseUrl), {
      method: options.method ?? 'GET',
      headers,
      body,
      timeoutMs: options.timeoutMs,
      endpoint: diagnosticEndpoint,
    });

    if (!response.ok) {
      const evidence = await readResponseErrorEvidence(response);
      const error = errorFromResponse(response, diagnosticEndpoint, evidence);
      throw error;
    }
    if (options.responseType === 'bytes') {
      const buffer = await response.arrayBuffer();
      this.#logger.debug('Garmin binary response received.', {
        endpoint: diagnosticEndpoint,
        bytes: buffer.byteLength,
      });
      return new Uint8Array(buffer) as T;
    }

    const payload = await parseJson(response);
    this.#logger.debug('Garmin response received.', {
      endpoint: diagnosticEndpoint,
      payload: summarizePayload(payload),
    });

    if (!options.schema) return payload as T;
    const result = options.schema.safeParse(payload);
    if (!result.success) {
      throw new GarminValidationError({
        message: 'Garmin response validation failed.',
        endpoint: diagnosticEndpoint,
        issues: formatZodIssues(result.error.issues),
        cause: result.error,
      });
    }

    return result.data;
  }

  async #fetchWithTimeout(
    url: URL,
    options: RequestInit & { timeoutMs?: number; endpoint: string },
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    if (!timeoutMs) return this.#fetch(url, options);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.#fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (isAbortError(error)) {
        throw new GarminTimeoutError({
          message: `Garmin request timed out after ${timeoutMs}ms.`,
          endpoint: options.endpoint,
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function canRecoverRequest<T>(
  error: unknown,
  options: RequestOptions<T>,
  dispatchedSession: DispatchedSession | undefined,
): boolean {
  const method = (options.method ?? 'GET').toUpperCase();
  return (
    error instanceof GarminSessionExpiredError &&
    !options.skipAuth &&
    (method === 'GET' || method === 'HEAD') &&
    dispatchedSession !== undefined
  );
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

export function formatZodIssues(issues: ZodIssue[]): string[] {
  const paths = new Set<string>();

  for (const issue of issues) {
    collectIssuePaths(issue, paths);
  }

  return [...paths];
}

function collectIssuePaths(issue: ZodIssue, paths: Set<string>): void {
  if ('unionErrors' in issue) {
    for (const unionError of issue.unionErrors) {
      for (const unionIssue of unionError.issues) {
        collectIssuePaths(unionIssue, paths);
      }
    }
    return;
  }

  paths.add(formatPath(issue.path));
}

function formatPath(path: Array<string | number>): string {
  if (path.length === 0) return '<root>';
  return path.map((part) => String(part)).join('.');
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException ||
      (typeof error === 'object' && error !== null && 'name' in error)) &&
    (error as { name?: string }).name === 'AbortError'
  );
}
