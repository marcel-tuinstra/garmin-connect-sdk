import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../src/auth/AuthService.js';
import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import {
  GarminAuthError,
  GarminMfaRequiredError,
  GarminRateLimitError,
  GarminSessionExpiredError,
} from '../../src/client/GarminRequestError.js';
import {
  DI_CLIENT_ID,
  expiredTokens,
  fetchCall,
  futureSeconds,
  jsonResponse,
  jwt,
  textResponse,
  tokenResponse,
  type FetchMock,
} from '../helpers/garmin.js';

const TEST_LOGIN = { email: 'runner@example.com', password: 'secret' };
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
    expect(String((exchangeInit?.headers as Record<string, string>).authorization)).toMatch(
      /^Basic /,
    );
    const exchangeBody = exchangeInit?.body as URLSearchParams;
    expect(exchangeBody.get('service_ticket')).toBe('ticket-123');
    expect(exchangeBody.get('grant_type')).toBe(DI_GRANT_TYPE);
  });

  it('maps invalid credentials without exposing credentials', async () => {
    // Arrange
    const { auth } = setupAuth({
      responses: [ssoStatusResponse('INVALID_USERNAME_PASSWORD')],
    });

    // Act
    const error = await auth.login(TEST_LOGIN).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminAuthError);
  });

  it('throws MFA-required when Garmin asks for MFA and no code is supplied', async () => {
    // Arrange
    const { auth, fetchMock } = setupAuth({
      responses: [
        ssoStatusResponse('MFA_REQUIRED', { customerMfaInfo: { mfaLastMethodUsed: 'email' } }),
      ],
    });

    // Act
    const error = await auth.login(TEST_LOGIN).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminMfaRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('submits MFA codes from a provider and forwards the SSO cookie', async () => {
    // Arrange
    const mfaCode = vi.fn<() => Promise<string>>().mockResolvedValue('123456');
    const { auth, fetchMock } = setupAuth({
      responses: [
        ssoStatusResponse(
          'MFA_REQUIRED',
          { customerMfaInfo: { mfaLastMethodUsed: 'sms' } },
          { headers: { 'set-cookie': 'SESSION=abc; Path=/; HttpOnly' } },
        ),
        ssoTicketResponse('mfa-ticket'),
        tokenResponse('refresh-token'),
      ],
    });

    // Act
    const tokens = await auth.login({ ...TEST_LOGIN, mfaCode });

    // Assert
    expect(tokens.refreshToken).toBe('refresh-token');
    expect(mfaCode).toHaveBeenCalledTimes(1);
    const { init } = fetchCall(fetchMock, 1);
    expect((init?.headers as Record<string, string>).cookie).toBe('SESSION=abc');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      mfaMethod: 'sms',
      mfaVerificationCode: '123456',
      rememberMyBrowser: true,
    });
  });

  it('maps login rate limits', async () => {
    // Arrange
    const { auth } = setupAuth({
      responses: [jsonResponse({ error: { 'status-code': '429' } }, { status: 400 })],
    });

    // Act
    const error = await auth.login(TEST_LOGIN).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminRateLimitError);
  });

  it('falls back to the next DI client id when the first OAuth exchange is malformed', async () => {
    // Arrange
    const { auth, fetchMock } = setupAuth({
      responses: [
        ssoTicketResponse('ticket-123'),
        textResponse('not-json'),
        tokenResponse('fallback-refresh-token', 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4'),
      ],
    });

    // Act
    const tokens = await auth.login(TEST_LOGIN);

    // Assert
    expect(tokens.refreshToken).toBe('fallback-refresh-token');
    const firstExchangeBody = fetchCall(fetchMock, 1).init?.body as URLSearchParams;
    const secondExchangeBody = fetchCall(fetchMock, 2).init?.body as URLSearchParams;
    expect(firstExchangeBody.get('client_id')).toBe('GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2');
    expect(secondExchangeBody.get('client_id')).toBe('GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4');
  });

  it('does not persist tokens when every OAuth exchange response is unusable', async () => {
    // Arrange
    const { auth, storage } = setupAuth({
      responses: [
        ssoTicketResponse('ticket-123'),
        jsonResponse({ access_token: jwt({ exp: futureSeconds() }) }),
        jsonResponse({ refresh_token: 'refresh-only' }),
        textResponse('not-json'),
        new Response('', { status: 401 }),
      ],
    });

    // Act
    const error = await auth.login(TEST_LOGIN).catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminAuthError);
    expect(await storage.load()).toBeNull();
  });

  it('returns false when no stored session exists', async () => {
    // Arrange
    const { auth, fetchMock } = setupAuth({ responses: [] });

    // Act
    const restored = await auth.restoreSession();

    // Assert
    expect(restored).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes restored expired tokens', async () => {
    // Arrange
    const { auth, fetchMock, storage } = await setupAuthWithExpiredSession([
      tokenResponse('new-refresh-token'),
    ]);

    // Act
    const restored = await auth.restoreSession();

    // Assert
    expect(restored).toBe(true);
    expect((await storage.load())?.refreshToken).toBe('new-refresh-token');

    const { init } = fetchCall(fetchMock, 0);
    const body = init?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh-token');
  });

  it('clears stored tokens when refresh is revoked', async () => {
    // Arrange
    const { auth, storage } = await setupAuthWithExpiredSession([
      new Response('', { status: 401 }),
    ]);

    // Act
    const error = await auth.restoreSession().catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect(await storage.load()).toBeNull();
  });
});

interface AuthFixture {
  auth: AuthService;
  fetchMock: FetchMock;
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

function ssoTicketResponse(serviceTicketId: string): Response {
  return jsonResponse({ serviceTicketId });
}

function ssoStatusResponse(
  type: string,
  extra: Record<string, unknown> = {},
  init: ResponseInit = {},
): Response {
  return jsonResponse({ responseStatus: { type }, ...extra }, init);
}
