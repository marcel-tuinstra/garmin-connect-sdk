import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

describe('published package telemetry boundary', () => {
  it('has no install lifecycle and import/default construction make no request', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected request'));

    const { GarminConnectSDK } = await import('../../src/index.js');
    const sdk = new GarminConnectSDK();

    expect(packageJson.scripts?.preinstall).toBeUndefined();
    expect(packageJson.scripts?.install).toBeUndefined();
    expect(packageJson.scripts?.postinstall).toBeUndefined();
    expect(sdk).toBeInstanceOf(GarminConnectSDK);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
