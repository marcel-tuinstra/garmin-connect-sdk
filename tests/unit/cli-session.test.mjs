import { describe, expect, it, vi } from 'vitest';

import { restoreSessionForCli } from '../../scripts/garmin-session-utils.mjs';
import {
  GarminBotChallengeError,
  GarminRateLimitError,
  GarminRequestError,
  GarminSessionExpiredError,
  GarminTimeoutError,
} from '../../src/client/GarminRequestError.ts';

describe('CLI session restore policy', () => {
  it.each([true, false])('preserves the restore result %s', async (restored) => {
    const garmin = { restoreSession: vi.fn().mockResolvedValue(restored) };
    await expect(restoreSessionForCli(garmin, GarminSessionExpiredError)).resolves.toBe(restored);
    expect(garmin.restoreSession).toHaveBeenCalledOnce();
  });

  it('allows credential prompting for a definitively expired session', async () => {
    const garmin = {
      restoreSession: vi
        .fn()
        .mockRejectedValue(new GarminSessionExpiredError({ message: 'Expired' })),
    };
    await expect(restoreSessionForCli(garmin, GarminSessionExpiredError)).resolves.toBe(false);
  });

  it.each([
    new GarminBotChallengeError({ message: 'Challenge', statusCode: 403 }),
    new GarminRateLimitError({ message: 'Rate limited', statusCode: 429 }),
    new GarminRequestError({ message: 'Forbidden', statusCode: 403 }),
    new GarminRequestError({ message: 'Unavailable', statusCode: 503 }),
    new GarminTimeoutError({ message: 'Timeout' }),
    new TypeError('Network unavailable'),
  ])('surfaces $name without requesting a password login', async (error) => {
    const garmin = { restoreSession: vi.fn().mockRejectedValue(error) };
    await expect(restoreSessionForCli(garmin, GarminSessionExpiredError)).rejects.toBe(error);
    expect(garmin.restoreSession).toHaveBeenCalledOnce();
  });
});
