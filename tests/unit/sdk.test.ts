import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { GarminConnectSDK } from '../../src/client/GarminConnectSDK.js';
import { GarminRequestError, GarminSessionExpiredError } from '../../src/client/GarminRequestError.js';
import { fetchCall, jsonResponse, tokenResponse, tokens } from '../helpers/garmin.js';

const TEST_LOGIN = { email: 'runner@example.com', password: 'secret' };

describe('GarminConnectSDK', () => {
  it('validates a stored session through the profile endpoint before reusing its displayName', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }))
      .mockResolvedValueOnce(
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const { url: validationUrl, init: validationInit } = fetchCall(fetchMock, 0);
    expect(String(validationUrl)).toContain('/userprofile-service/socialProfile');
    expect(new Headers(validationInit?.headers).get('authorization')).toBe('Bearer access-token');
    const { url, init } = fetchCall(fetchMock, 1);
    expect(String(url)).toContain('/wellness-service/wellness/dailySleepData/runner');
    expect(String(url)).toContain('nonSleepBufferMinutes=60');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token');
  });

  it('returns false without a profile request when there is no stored session', async () => {
    // Arrange
    const fetchMock = vi.fn<typeof fetch>();
    const garmin = new GarminConnectSDK({
      storage: new MemoryTokenStorage(),
      fetch: fetchMock,
      maxRetries: 0,
    });

    // Act
    const restored = await garmin.restoreSession();

    // Assert
    expect(restored).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes an expired stored session before validating it', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(
      tokens({
        accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        refreshToken: 'old-refresh-token',
      }),
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse('new-refresh-token'))
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    // Act
    const restored = await garmin.restoreSession();

    // Assert
    expect(restored).toBe(true);
    expect(String(fetchCall(fetchMock, 0).url)).toContain('/di-oauth2-service/oauth/token');
    expect(String(fetchCall(fetchMock, 1).url)).toContain('/userprofile-service/socialProfile');
    expect(new Headers(fetchCall(fetchMock, 1).init?.headers).get('authorization')).not.toBe(
      'Bearer access-token',
    );
  });

  it('surfaces an auth error when an unexpired stored token is rejected during validation', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    // Act
    const error = await garmin.restoreSession().catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect(await storage.load()).toMatchObject({ accessToken: 'access-token' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps stored tokens after a transient session-validation failure', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    // Act
    const error = await garmin.restoreSession().catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminRequestError);
    expect(await storage.load()).toMatchObject({ accessToken: 'access-token' });
  });

  it('clears a stale profile cache when session validation fails', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ displayName: 'new-runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.restoreSession();

    // Act
    const error = await garmin.restoreSession().catch((caught: unknown) => caught);
    const displayName = await garmin.user.getDisplayName();

    // Assert
    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect(displayName).toBe('new-runner');
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ displayName: 'runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.restoreSession();

    // Act
    await garmin.logout();
    const restored = await garmin.restoreSession();

    // Assert
    expect(await storage.load()).toBeNull();
    expect(restored).toBe(false);
  });

  it('does not return a cached profile after logout', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ displayName: 'runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.restoreSession();
    await garmin.logout();

    // Act
    const error = await garmin.user.getDisplayName().catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not send a protected request after a later restore finds no stored session', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ displayName: 'runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
    await garmin.restoreSession();
    await storage.clear();

    // Act
    const restored = await garmin.restoreSession();
    const error = await garmin.user.getDisplayName().catch((caught: unknown) => caught);

    // Assert
    expect(restored).toBe(false);
    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry an ambiguous weigh-in failure', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const garmin = new GarminConnectSDK({
      storage,
      fetch: fetchMock,
      maxRetries: 3,
      retry: { sleep: async () => undefined },
    });
    await garmin.restoreSession();

    // Act
    const error = await garmin.weight
      .addWeighIn({
        value: 75.4,
        unit: 'kg',
        measuredAt: '2026-07-18T14:30:00.000+02:00',
      })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('normalizes a 204 weigh-in response to void', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 3 });
    await garmin.restoreSession();

    // Act
    const result = await garmin.weight.addWeighIn({
      value: 75.4,
      unit: 'kg',
      measuredAt: '2026-07-18T14:30:00.000+02:00',
    });

    // Assert
    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an ambiguous weigh-in timeout', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }))
      .mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      );
    const garmin = new GarminConnectSDK({
      storage,
      fetch: fetchMock,
      maxRetries: 3,
      timeoutMs: 1,
      retry: { sleep: async () => undefined },
    });
    await garmin.restoreSession();

    // Act
    const error = await garmin.weight
      .addWeighIn({
        value: 75.4,
        unit: 'kg',
        measuredAt: '2026-07-18T14:30:00.000+02:00',
      })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an ambiguous weigh-in removal failure', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const garmin = new GarminConnectSDK({
      storage,
      fetch: fetchMock,
      maxRetries: 3,
      retry: { sleep: async () => undefined },
    });
    await garmin.restoreSession();

    // Act
    const error = await garmin.weight
      .removeWeighIn({ calendarDate: '2026-07-18', samplePk: 123456 })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an ambiguous weigh-in removal timeout', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }))
      .mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      );
    const garmin = new GarminConnectSDK({
      storage,
      fetch: fetchMock,
      maxRetries: 3,
      timeoutMs: 1,
      retry: { sleep: async () => undefined },
    });
    await garmin.restoreSession();

    // Act
    const error = await garmin.weight
      .removeWeighIn({ calendarDate: '2026-07-18', samplePk: 123456 })
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
