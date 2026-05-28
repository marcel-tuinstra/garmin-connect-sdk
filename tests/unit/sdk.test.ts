import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import type { GarminTokens } from '../../src/auth/types.js';
import { GarminConnectSDK } from '../../src/client/GarminConnectSDK.js';

const TEST_LOGIN = { email: 'runner@example.com', password: 'secret' };

describe('GarminConnectSDK', () => {
  it('restores a stored displayName and prepares authenticated endpoint requests', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        dailySleepDTO: { calendarDate: '2026-05-12' },
      }),
    );
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    // Act
    const restored = await garmin.restoreSession();
    const sleep = await garmin.sleep.getDailySleep('2026-05-12');

    // Assert
    expect(restored).toBe(true);
    expect(sleep.dailySleepDTO?.calendarDate).toBe('2026-05-12');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = fetchCall(fetchMock, 0);
    expect(String(url)).toContain('/wellness-service/wellness/dailySleepData/runner');
    expect(String(url)).toContain('nonSleepBufferMinutes=60');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token');
  });

  it('fetches profile after login when the token response has no displayName', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ serviceTicketId: 'ticket-123' }))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    // Act
    await garmin.login(TEST_LOGIN);

    // Assert
    expect((await storage.load())?.refreshToken).toBe('refresh-token');
    const { url } = fetchCall(fetchMock, 2);
    expect(String(url)).toContain('/userprofile-service/socialProfile');
  });

  it('clears persisted tokens on logout', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: vi.fn<typeof fetch>(), maxRetries: 0 });
    await garmin.restoreSession();

    // Act
    await garmin.logout();
    const restored = await garmin.restoreSession();

    // Assert
    expect(await storage.load()).toBeNull();
    expect(restored).toBe(false);
  });
});

function fetchCall(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number) {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`Missing fetch call at index ${index}.`);
  return { url: call[0], init: call[1] };
}

function tokens(overrides: Partial<GarminTokens> = {}): GarminTokens {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    ...overrides,
  };
}

function tokenResponse(): Response {
  return jsonResponse({
    access_token: jwt({ exp: futureSeconds(), client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI' }),
    refresh_token: 'refresh-token',
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

function jwt(payload: Record<string, unknown>): string {
  return [base64Url({ alg: 'none', typ: 'JWT' }), base64Url(payload), 'signature'].join('.');
}

function base64Url(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function futureSeconds(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}
