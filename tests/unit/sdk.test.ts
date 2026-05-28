import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { GarminConnectSDK } from '../../src/client/GarminConnectSDK.js';
import { fetchCall, jsonResponse, tokenResponse, tokens } from '../helpers/garmin.js';

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
