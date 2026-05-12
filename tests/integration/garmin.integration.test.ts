import { describe, expect, it } from 'vitest';

import { FileTokenStorage, GarminConnectSDK } from '../../src/index.js';

const enabled =
  process.env.GARMIN_RUN_INTEGRATION === '1' &&
  Boolean(process.env.GARMIN_EMAIL) &&
  Boolean(process.env.GARMIN_PASSWORD);

describe.skipIf(!enabled)('Garmin integration', () => {
  it('logs in and fetches profile', async () => {
    const garmin = new GarminConnectSDK({
      storage: new FileTokenStorage('./.garmin-tokens'),
    });

    if (!(await garmin.restoreSession())) {
      await garmin.login({
        email: process.env.GARMIN_EMAIL!,
        password: process.env.GARMIN_PASSWORD!,
        mfaCode: process.env.GARMIN_MFA_CODE,
      });
    }

    const profile = await garmin.user.getProfile();
    expect(profile.displayName).toBeTruthy();
  });
});
