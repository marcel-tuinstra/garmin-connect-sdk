import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { GarminConnectSDK } from '../../src/client/GarminConnectSDK.js';
import { GarminSessionExpiredError } from '../../src/client/GarminRequestError.js';
import { expiredTokens, fetchCall, jsonResponse, tokenResponse, tokens } from '../helpers/garmin.js';

describe('session restore regressions', () => {
  it('validates a locally fresh restored token even when displayName is cached', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ displayName: 'runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    await expect(garmin.restoreSession()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = fetchCall(fetchMock, 0);
    expect(String(url)).toContain('/userprofile-service/socialProfile');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token');
  });

  it('surfaces an auth error when Garmin rejects a locally fresh token', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    await expect(garmin.restoreSession()).rejects.toBeInstanceOf(GarminSessionExpiredError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Keep persisted credentials available for an explicit retry after a transient rejection.
    expect((await storage.load())?.accessToken).toBe('access-token');
  });

  it('refreshes an expired restored token before validating it', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(expiredTokens({ displayName: 'runner' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse('new-refresh-token'))
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    await expect(garmin.restoreSession()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchCall(fetchMock, 1).url)).toContain('/userprofile-service/socialProfile');
    expect((await storage.load())?.refreshToken).toBe('new-refresh-token');
  });

  it('does not expose a stale profile after logout', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner' }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ displayName: 'runner' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    await garmin.restoreSession();
    await garmin.logout();

    await expect(garmin.user.getDisplayName()).rejects.toBeInstanceOf(GarminSessionExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replaces the cached profile when restoring a different account', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(tokens({ displayName: 'runner-a' }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner-a' }))
      .mockResolvedValueOnce(jsonResponse({ displayName: 'runner-b' }));
    const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });

    await garmin.restoreSession();
    await garmin.logout();
    await storage.save(tokens());

    await expect(garmin.restoreSession()).resolves.toBe(true);
    await expect(garmin.user.getDisplayName()).resolves.toBe('runner-b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
