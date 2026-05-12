import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../src/auth/AuthService.js';
import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import type { GarminTokens } from '../../src/auth/types.js';
import {
  GarminAuthError,
  GarminMfaRequiredError,
  GarminRateLimitError,
  GarminSessionExpiredError,
} from '../../src/client/GarminRequestError.js';

const TEST_LOGIN = { email: 'runner@example.com', password: 'secret' };
const DI_CLIENT_ID = 'GARMIN_CONNECT_MOBILE_ANDROID_DI';
const DI_GRANT_TYPE = 'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket';

describe('AuthService', () => {
  it('logs in with Garmin mobile SSO and DI service-ticket exchange', async () => {
    // Arrange
    const { auth, fetchMock, storage } = setupAuth({
      responses: [ssoTicketResponse('ticket-123'), tokenResponse('refresh-token')],
    });

    // Act
    const tokens = await auth.login(TEST_LOGIN);

    // Assert
    expect(tokens.accessToken).toContain('.');
    expect(tokens.refreshToken).toBe('refresh-token');
    expect(tokens.clientId).toBe(DI_CLIENT_ID);
    expect(await storage.load()).toMatchObject({
      refreshToken: 'refresh-token',
      clientId: DI_CLIENT_ID,
    });

    const { url: loginUrl, init: loginInit } = fetchCall(fetchMock, 0);
    expect(String(loginUrl)).toContain('/mobile/api/login');
    expect(String(loginUrl)).toContain('clientId=GCM_IOS_DARK');
    expect(JSON.parse(String(loginInit?.body))).toEqual({
      username: TEST_LOGIN.email,
      password: TEST_LOGIN.password,
      rememberMe: true,
      captchaToken: '',
    });

    const { url: exchangeUrl, init: exchangeInit } = fetchCall(fetchMock, 1);
    expect(String(exchangeUrl)).toBe('https://diauth.garmin.com/di-oauth2-service/oauth/token');
    expect(String((exchangeInit?.headers as Record<string, string>).authorization)).toMatch(/^Basic /);
    const exchangeBody = exchangeInit?.body as URLSearchParams;
    expect(exchangeBody.get('service_ticket')).toBe('ticket-123');
    expect(exchangeBody.get('grant_type')).toBe(DI_GRANT_TYPE);
  });

  it('maps invalid credentials without exposing credentials', async () => {
    // Arrange
    const { auth } = setupAuth({
      responses: [ssoStatusResponse('INVALID_USERNAME_PASSWORD')],
    });

    // Act / Assert
    await expect(auth.login(TEST_LOGIN)).rejects.toThrow(GarminAuthError);
  });

  it('throws MFA-required when Garmin asks for MFA and no code is supplied', async () => {
    // Arrange
    const { auth, fetchMock } = setupAuth({
      responses: [ssoStatusResponse('MFA_REQUIRED', { customerMfaInfo: { mfaLastMethodUsed: 'email' } })],
    });

    // Act / Assert
    await expect(auth.login(TEST_LOGIN)).rejects.toThrow(GarminMfaRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps login rate limits', async () => {
    // Arrange
    const { auth } = setupAuth({
      responses: [jsonResponse({ error: { 'status-code': '429' } }, { status: 400 })],
    });

    // Act / Assert
    await expect(auth.login(TEST_LOGIN)).rejects.toThrow(GarminRateLimitError);
  });

  it('refreshes restored expired tokens', async () => {
    // Arrange
    const { auth, fetchMock, storage } = await setupAuthWithExpiredSession([
      tokenResponse('new-refresh-token'),
    ]);

    // Act / Assert
    await expect(auth.restoreSession()).resolves.toBe(true);
    expect((await storage.load())?.refreshToken).toBe('new-refresh-token');

    const { init } = fetchCall(fetchMock, 0);
    const body = init?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh-token');
  });

  it('clears stored tokens when refresh is revoked', async () => {
    // Arrange
    const { auth, storage } = await setupAuthWithExpiredSession([new Response('', { status: 401 })]);

    // Act / Assert
    await expect(auth.restoreSession()).rejects.toThrow(GarminSessionExpiredError);
    expect(await storage.load()).toBeNull();
  });
});

interface AuthFixture {
  auth: AuthService;
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  storage: MemoryTokenStorage;
}

function setupAuth({ responses }: { responses: Response[] }): AuthFixture {
  const storage = new MemoryTokenStorage();
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  return {
    auth: new AuthService({ fetch: fetchMock, storage }),
    fetchMock,
    storage,
  };
}

async function setupAuthWithExpiredSession(responses: Response[]): Promise<AuthFixture> {
  const fixture = setupAuth({ responses });
  await fixture.storage.save(expiredTokens());
  return fixture;
}

function fetchCall(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number) {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`Missing fetch call at index ${index}.`);
  return { url: call[0], init: call[1] };
}

function ssoTicketResponse(serviceTicketId: string): Response {
  return jsonResponse({ serviceTicketId });
}

function ssoStatusResponse(type: string, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ responseStatus: { type }, ...extra });
}

function tokenResponse(refreshToken: string): Response {
  return jsonResponse({
    access_token: jwt({ exp: futureSeconds(), client_id: DI_CLIENT_ID }),
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: 3600,
  });
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

function expiredTokens(): GarminTokens {
  return {
    accessToken: jwt({ exp: pastSeconds(), client_id: DI_CLIENT_ID }),
    refreshToken: 'old-refresh-token',
    accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    clientId: DI_CLIENT_ID,
  };
}

function jwt(payload: Record<string, unknown>): string {
  return [
    base64Url({ alg: 'none', typ: 'JWT' }),
    base64Url(payload),
    'signature',
  ].join('.');
}

function base64Url(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function futureSeconds(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

function pastSeconds(): number {
  return Math.floor(Date.now() / 1000) - 3600;
}
