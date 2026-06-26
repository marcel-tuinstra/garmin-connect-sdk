import {
  GarminAuthError,
  GarminMfaRequiredError,
  GarminRateLimitError,
  GarminRequestError,
  GarminSessionExpiredError,
  parseRetryAfter,
} from '../client/GarminRequestError.js';
import { noopLogger, redact, type Logger } from '../utils/logger.js';
import { withRetry, type RetryOptions } from '../utils/retry.js';
import { MemoryTokenStorage } from './MemoryTokenStorage.js';
import type { TokenStorage } from './TokenStorage.js';
import type { AuthTokensResponse, GarminTokens, LoginOptions, MfaCodeProvider } from './types.js';

const SSO_BASE_URL = 'https://sso.garmin.com';
const DI_AUTH_BASE_URL = 'https://diauth.garmin.com';
const EXPIRY_SKEW_MS = 60_000;
const SSO_CLIENT_ID = 'GCM_IOS_DARK';
const MOBILE_SERVICE_URL = 'https://mobile.integration.garmin.com/gcm/ios';
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const NATIVE_API_USER_AGENT = 'GCM-Android-5.23';
const NATIVE_X_GARMIN_USER_AGENT =
  'com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0';
const DI_GRANT_TYPE = 'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket';
const DI_CLIENT_IDS = [
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI',
  'GARMIN_CONNECT_MOBILE_IOS_DI',
] as const;
const fallbackRefreshLocks = new WeakMap<TokenStorage, Promise<void>>();

export interface AuthServiceOptions {
  storage?: TokenStorage;
  logger?: Logger;
  fetch?: typeof fetch;
  retry?: RetryOptions;
}

export class AuthService {
  readonly storage: TokenStorage;
  #fetch: typeof fetch;
  #logger: Logger;
  #retry: RetryOptions;
  #tokens: GarminTokens | null = null;
  #refreshPromise: Promise<GarminTokens> | null = null;

  constructor(options: AuthServiceOptions = {}) {
    this.storage = options.storage ?? new MemoryTokenStorage();
    this.#fetch = options.fetch ?? fetch;
    this.#logger = options.logger ?? noopLogger;
    this.#retry = options.retry ?? {};
  }

  get tokens(): GarminTokens | null {
    return this.#tokens ? { ...this.#tokens } : null;
  }

  get accessToken(): string | null {
    return this.#tokens?.accessToken ?? null;
  }

  async restoreSession(): Promise<boolean> {
    const tokens = await this.storage.load();
    if (!tokens) return false;
    this.#tokens = tokens;
    await this.refreshIfNeeded();
    return true;
  }

  async login(options: LoginOptions): Promise<GarminTokens> {
    const operation = async (): Promise<GarminTokens> => {
      const loginUrl = new URL(`${SSO_BASE_URL}/mobile/api/login`);
      loginUrl.search = new URLSearchParams({
        clientId: SSO_CLIENT_ID,
        locale: 'en-US',
        service: MOBILE_SERVICE_URL,
      }).toString();

      const loginResponse = await this.#fetch(loginUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/plain, */*',
          origin: SSO_BASE_URL,
          'user-agent': MOBILE_USER_AGENT,
        },
        body: JSON.stringify({
          username: options.email,
          password: options.password,
          rememberMe: true,
          captchaToken: '',
        }),
      });

      this.#logger.debug('Garmin SSO login response received.', {
        endpoint: '/mobile/api/login',
        statusCode: loginResponse.status,
      });

      if (loginResponse.status === 429) throw rateLimit(loginResponse, '/mobile/api/login');
      if (loginResponse.status === 401 || loginResponse.status === 403) {
        throw new GarminAuthError({
          message: 'Garmin login failed. Check credentials.',
          statusCode: loginResponse.status,
          endpoint: '/mobile/api/login',
        });
      }
      if (loginResponse.status >= 500) {
        throw new GarminRequestError({
          message: 'Garmin login service is unavailable.',
          statusCode: loginResponse.status,
          endpoint: '/mobile/api/login',
        });
      }
      if (!loginResponse.ok) {
        const errorPayload = await readJsonObject(loginResponse);
        const mappedError = authErrorFromLoginPayload(errorPayload, loginResponse.status);
        if (mappedError) throw mappedError;

        throw new GarminRequestError({
          message: `Garmin login failed (${loginResponse.status}).`,
          statusCode: loginResponse.status,
          endpoint: '/mobile/api/login',
        });
      }

      const loginPayload = await readJsonObject(loginResponse);
      const ticket = await this.#extractTicketOrHandleMfa(
        loginPayload,
        options.mfaCode,
        cookieHeader(loginResponse.headers),
      );
      const tokens = await this.#exchangeTicket(ticket);
      this.#tokens = tokens;
      await this.storage.save(tokens);
      this.#logger.info('Garmin login succeeded.', { tokens: redact(tokens) });
      return { ...tokens };
    };

    return withRetry(operation, {
      ...this.#retry,
      maxRetries: Math.min(this.#retry.maxRetries ?? 1, 1),
      shouldRetry: (error) => error instanceof GarminRequestError && (error.statusCode ?? 0) >= 500,
    });
  }

  async refreshIfNeeded(): Promise<GarminTokens> {
    if (!this.#tokens) {
      const restored = await this.storage.load();
      if (!restored) {
        throw new GarminSessionExpiredError({ message: 'No Garmin session is available.' });
      }
      this.#tokens = restored;
    }

    if (Date.parse(this.#tokens.accessTokenExpiresAt) - EXPIRY_SKEW_MS <= Date.now()) {
      return this.#refresh({ skipIfFresh: true });
    }

    return { ...this.#tokens };
  }

  async refresh(): Promise<GarminTokens> {
    return this.#refresh({ skipIfFresh: false });
  }

  async #refresh({ skipIfFresh }: { skipIfFresh: boolean }): Promise<GarminTokens> {
    if (this.#refreshPromise) return { ...(await this.#refreshPromise) };

    const refreshPromise = this.#withStorageRefreshLock(async () => {
      const stored = await this.storage.load();
      if (stored) this.#tokens = stored;

      if (skipIfFresh && this.#tokens && !requiresRefresh(this.#tokens)) {
        return { ...this.#tokens };
      }

      return this.#refreshTokens();
    });
    this.#refreshPromise = refreshPromise;

    try {
      return { ...(await refreshPromise) };
    } finally {
      if (this.#refreshPromise === refreshPromise) this.#refreshPromise = null;
    }
  }

  async #withStorageRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.storage.withRefreshLock) return this.storage.withRefreshLock(operation);

    let release: () => void = () => undefined;
    const previous = fallbackRefreshLocks.get(this.storage) ?? Promise.resolve();
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    fallbackRefreshLocks.set(this.storage, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (fallbackRefreshLocks.get(this.storage) === current) {
        fallbackRefreshLocks.delete(this.storage);
      }
    }
  }

  async #refreshTokens(): Promise<GarminTokens> {
    if (!this.#tokens?.refreshToken) {
      throw new GarminSessionExpiredError({ message: 'No Garmin refresh token is available.' });
    }

    const response = await this.#fetch(`${DI_AUTH_BASE_URL}/di-oauth2-service/oauth/token`, {
      method: 'POST',
      headers: {
        ...nativeHeaders({
          authorization: buildBasicAuth(this.#tokens.clientId ?? DI_CLIENT_IDS[0]),
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          'cache-control': 'no-cache',
        }),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.#tokens.refreshToken,
        client_id: this.#tokens.clientId ?? DI_CLIENT_IDS[0],
      }),
    });

    this.#logger.debug('Garmin token refresh response received.', {
      endpoint: '/di-oauth2-service/oauth/token',
      statusCode: response.status,
    });

    if (response.status === 429) throw rateLimit(response, '/di-oauth2-service/oauth/token');
    if (response.status === 401 || response.status === 403) {
      await this.logout();
      throw new GarminSessionExpiredError({
        message: 'Garmin refresh token is expired or revoked.',
        statusCode: response.status,
        endpoint: '/di-oauth2-service/oauth/token',
      });
    }
    if (!response.ok) {
      throw new GarminRequestError({
        message: `Garmin token refresh failed (${response.status}).`,
        statusCode: response.status,
        endpoint: '/di-oauth2-service/oauth/token',
      });
    }

    const payload = (await response.json()) as AuthTokensResponse;
    const tokens = normalizeTokenResponse(payload, this.#tokens.displayName, this.#tokens.clientId);
    this.#tokens = tokens;
    await this.storage.save(tokens);
    return { ...tokens };
  }

  async logout(): Promise<void> {
    this.#tokens = null;
    await this.storage.clear();
  }

  async #extractTicketOrHandleMfa(
    payload: Record<string, unknown>,
    mfaCode?: string | MfaCodeProvider,
    cookies?: string,
  ): Promise<string> {
    const ticket = firstString(payload, [
      'serviceTicketId',
      'ticket',
      'serviceTicket',
      'oauth_token',
    ]);
    if (ticket) return ticket;

    const responseStatus = objectValue(payload, 'responseStatus');
    const responseType = typeof responseStatus?.type === 'string' ? responseStatus.type : undefined;
    const mappedError = authErrorFromLoginPayload(payload);
    if (mappedError) throw mappedError;

    const mfaRequired =
      payload.mfaRequired === true ||
      payload.mfa_required === true ||
      payload.status === 'MFA_REQUIRED' ||
      payload.status === 'MFA' ||
      responseType === 'MFA_REQUIRED' ||
      responseType === 'MFA';

    if (!mfaRequired) {
      throw new GarminAuthError({ message: 'Garmin login did not return a service ticket.' });
    }

    if (!mfaCode) {
      throw new GarminMfaRequiredError({
        message: 'Garmin MFA code is required. Provide login({ mfaCode }).',
      });
    }

    const code = typeof mfaCode === 'function' ? await mfaCode() : mfaCode;
    const mfaMethod = objectValue(payload, 'customerMfaInfo')?.mfaLastMethodUsed;
    const mfaUrl = new URL(`${SSO_BASE_URL}/mobile/api/mfa/verifyCode`);
    mfaUrl.search = new URLSearchParams({
      clientId: SSO_CLIENT_ID,
      locale: 'en-US',
      service: MOBILE_SERVICE_URL,
    }).toString();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      origin: SSO_BASE_URL,
      'user-agent': MOBILE_USER_AGENT,
    };
    if (cookies) headers.cookie = cookies;

    const response = await this.#fetch(mfaUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mfaMethod: typeof mfaMethod === 'string' ? mfaMethod : 'email',
        mfaVerificationCode: code,
        rememberMyBrowser: true,
        reconsentList: [],
        mfaSetup: false,
      }),
    });

    if (!response.ok) {
      throw new GarminAuthError({
        message: `Garmin MFA verification failed (${response.status}).`,
        statusCode: response.status,
        endpoint: '/mobile/api/mfa/verifyCode',
      });
    }

    const mfaPayload = (await response.json()) as Record<string, unknown>;
    const verifiedTicket = firstString(mfaPayload, [
      'serviceTicketId',
      'ticket',
      'serviceTicket',
      'oauth_token',
    ]);
    if (!verifiedTicket)
      throw new GarminAuthError({ message: 'Garmin MFA did not return a ticket.' });
    return verifiedTicket;
  }

  async #exchangeTicket(ticket: string): Promise<GarminTokens> {
    for (const clientId of DI_CLIENT_IDS) {
      const response = await this.#fetch(`${DI_AUTH_BASE_URL}/di-oauth2-service/oauth/token`, {
        method: 'POST',
        headers: nativeHeaders({
          authorization: buildBasicAuth(clientId),
          accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
          'content-type': 'application/x-www-form-urlencoded',
          'cache-control': 'no-cache',
        }),
        body: new URLSearchParams({
          client_id: clientId,
          service_ticket: ticket,
          grant_type: DI_GRANT_TYPE,
          service_url: MOBILE_SERVICE_URL,
        }),
      });

      this.#logger.debug('Garmin DI OAuth exchange response received.', {
        endpoint: '/di-oauth2-service/oauth/token',
        statusCode: response.status,
        clientId,
      });

      if (response.status === 429) throw rateLimit(response, '/di-oauth2-service/oauth/token');
      if (!response.ok) continue;

      try {
        const payload = (await response.json()) as AuthTokensResponse;
        return normalizeTokenResponse(
          payload,
          undefined,
          extractClientId(payload.access_token) ?? clientId,
        );
      } catch {
        continue;
      }
    }

    throw new GarminAuthError({
      message: 'Garmin OAuth exchange failed for all mobile DI client ids.',
      endpoint: '/di-oauth2-service/oauth/token',
    });
  }
}

function requiresRefresh(tokens: GarminTokens): boolean {
  return Date.parse(tokens.accessTokenExpiresAt) - EXPIRY_SKEW_MS <= Date.now();
}

function normalizeTokenResponse(
  payload: AuthTokensResponse,
  existingDisplayName?: string,
  existingClientId?: string,
): GarminTokens {
  if (!payload.access_token || !payload.refresh_token) {
    throw new GarminAuthError({ message: 'Garmin token response was missing required tokens.' });
  }

  const now = Date.now();
  const jwtExpiresAt = extractJwtExpiry(payload.access_token);
  const accessExpiresIn = payload.expires_in ?? 3600;
  const refreshExpiresIn = payload.refresh_token_expires_in;

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    accessTokenExpiresAt: jwtExpiresAt ?? new Date(now + accessExpiresIn * 1000).toISOString(),
    refreshTokenExpiresAt: refreshExpiresIn
      ? new Date(now + refreshExpiresIn * 1000).toISOString()
      : undefined,
    tokenType: payload.token_type,
    scope: payload.scope,
    displayName: payload.displayName ?? payload.display_name ?? existingDisplayName,
    clientId: existingClientId ?? DI_CLIENT_IDS[0],
  };
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function objectValue(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = payload[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = (await response.json()) as unknown;
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function authErrorFromLoginPayload(
  payload: Record<string, unknown>,
  statusCode?: number,
): GarminAuthError | GarminRateLimitError | undefined {
  const responseStatus = objectValue(payload, 'responseStatus');
  const responseType = typeof responseStatus?.type === 'string' ? responseStatus.type : undefined;
  const error = objectValue(payload, 'error');
  const errorCode = typeof error?.['status-code'] === 'string' ? error['status-code'] : undefined;

  if (responseType === 'INVALID_USERNAME_PASSWORD') {
    return new GarminAuthError({
      message: 'Garmin login failed. Check credentials.',
      statusCode,
      endpoint: '/mobile/api/login',
    });
  }

  if (responseType === 'RATE_LIMITED' || errorCode === '429') {
    return new GarminRateLimitError({
      message: 'Garmin rate limit exceeded.',
      statusCode: statusCode ?? 429,
      endpoint: '/mobile/api/login',
    });
  }

  if (responseType === 'ACCOUNT_LOCKED') {
    return new GarminAuthError({
      message: 'Garmin account is locked or requires action in Garmin Connect.',
      statusCode,
      endpoint: '/mobile/api/login',
    });
  }

  return undefined;
}

function buildBasicAuth(clientId: string): string {
  return `Basic ${Buffer.from(`${clientId}:`).toString('base64')}`;
}

function nativeHeaders(extra: Record<string, string>): Record<string, string> {
  return {
    'user-agent': NATIVE_API_USER_AGENT,
    'x-garmin-user-agent': NATIVE_X_GARMIN_USER_AGENT,
    'x-garmin-paired-app-version': '10861',
    'x-garmin-client-platform': 'Android',
    'x-app-ver': '10861',
    'x-lang': 'en',
    'x-gcexperience': 'GC5',
    'accept-language': 'en-US,en;q=0.9',
    ...extra,
  };
}

function extractJwtExpiry(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === 'number' ? payload.exp : undefined;
  return exp ? new Date(exp * 1000).toISOString() : undefined;
}

function extractClientId(token?: string): string | undefined {
  if (!token) return undefined;
  const payload = decodeJwtPayload(token);
  const clientId = payload?.client_id;
  return typeof clientId === 'string' && clientId.length > 0 ? clientId : undefined;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const [, payload] = token.split('.');
    if (!payload) return undefined;
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function cookieHeader(headers: Headers): string | undefined {
  const maybeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = maybeHeaders.getSetCookie?.() ?? [];
  const cookieParts = new Set(
    setCookies
      .map((cookie) => cookie.split(';')[0])
      .filter((cookie): cookie is string => typeof cookie === 'string' && cookie.length > 0),
  );
  const singleCookie = headers.get('set-cookie')?.split(';')[0];
  if (singleCookie) cookieParts.add(singleCookie);
  return cookieParts.size > 0 ? [...cookieParts].join('; ') : undefined;
}

function rateLimit(response: Response, endpoint: string): GarminRateLimitError {
  return new GarminRateLimitError({
    message: 'Garmin rate limit exceeded.',
    statusCode: response.status,
    endpoint,
    retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
  });
}
