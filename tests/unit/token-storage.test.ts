import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { FileTokenStorage, getFileMode } from '../../src/auth/FileTokenStorage.js';
import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import type { GarminTokens } from '../../src/auth/types.js';

const tokens: GarminTokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  displayName: 'runner',
};

describe('token storage', () => {
  it('saves, loads, and clears memory tokens', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();

    // Act
    await storage.save(tokens);
    const loaded = await storage.load();
    await storage.clear();

    // Assert
    expect(loaded).toEqual(tokens);
    expect(await storage.load()).toBeNull();
  });

  it('serializes memory refresh locks within one storage instance', async () => {
    // Arrange
    const storage = new MemoryTokenStorage();
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    // Act
    const first = storage.withRefreshLock(async () => {
      events.push('first-start');
      await firstCanFinish;
      events.push('first-end');
      return 'first';
    });
    await Promise.resolve();
    const second = storage.withRefreshLock(async () => {
      events.push('second-start');
      return 'second';
    });
    await Promise.resolve();

    // Assert
    expect(events).toEqual(['first-start']);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('saves file tokens without email or password fields', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-test-'));
    const storage = new FileTokenStorage(dir);

    // Act
    await storage.save({ ...tokens, ...(JSON.parse('{"email":"x","password":"y"}') as object) });
    const loaded = await storage.load();
    const raw = await readFile(storage.filePath, 'utf8');
    const mode = await getFileMode(storage.filePath);

    // Assert
    expect(loaded).toEqual(tokens);
    expect(raw).not.toContain('email');
    expect(raw).not.toContain('password');
    if (mode !== undefined) expect(mode).toBe(0o600);

    await storage.clear();
    expect(await storage.load()).toBeNull();
  });

  it('serializes file refresh locks across storage instances', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-lock-'));
    const firstStorage = new FileTokenStorage(dir);
    const secondStorage = new FileTokenStorage(dir);
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    // Act
    const first = firstStorage.withRefreshLock(async () => {
      events.push('first-start');
      await firstCanFinish;
      events.push('first-end');
      return 'first';
    });
    await waitFor(() => events.includes('first-start'));
    const second = secondStorage.withRefreshLock(async () => {
      events.push('second-start');
      return 'second';
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert
    expect(events).toEqual(['first-start']);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('returns null when a token file has not been created yet', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-empty-'));
    const storage = new FileTokenStorage(join(dir, 'missing.json'));

    // Act
    const loaded = await storage.load();

    // Assert
    expect(loaded).toBeNull();
  });
});

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition.');
}
