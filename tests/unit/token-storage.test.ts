import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  createExclusiveTempFile,
  FileTokenStorage,
  getFileMode,
  writeTokenFileAtomically,
} from '../../src/auth/FileTokenStorage.js';
import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import type { GarminTokens } from '../../src/auth/types.js';

const tokens: GarminTokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  displayName: 'runner',
};

const posixIt = process.platform === 'win32' ? it.skip : it;

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
    if (process.platform !== 'win32') await chmod(dir, 0o777);
    const firstStorage = new FileTokenStorage(dir);
    const secondStorage = new FileTokenStorage(dir);
    const events: string[] = [];
    let directoryMode: number | undefined;
    let lockMode: number | undefined;
    let releaseFirst: () => void = () => undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    // Act
    const first = firstStorage.withRefreshLock(async () => {
      events.push('first-start');
      directoryMode = await getFileMode(dir);
      lockMode = await getFileMode(`${firstStorage.filePath}.refresh.lock`);
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
    expect(directoryMode).toBe(process.platform === 'win32' ? undefined : 0o700);
    expect(lockMode).toBe(process.platform === 'win32' ? undefined : 0o600);
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

  posixIt('tightens permissive token directories and files before replacement', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-permissions-'));
    const storage = new FileTokenStorage(dir);
    await chmod(dir, 0o777);
    await writeFile(storage.filePath, '{}\n', { mode: 0o666 });
    await chmod(storage.filePath, 0o666);

    // Act
    await storage.save(tokens);

    // Assert
    expect(await getFileMode(dir)).toBe(0o700);
    expect(await getFileMode(storage.filePath)).toBe(0o600);
    await expect(storage.load()).resolves.toEqual(tokens);
  });

  posixIt(
    'rejects token-file symlinks without reading, replacing, or deleting their target',
    async () => {
      // Arrange
      const dir = await mkdtemp(join(tmpdir(), 'garmin-token-symlink-'));
      const target = join(dir, 'target.json');
      const storage = new FileTokenStorage(join(dir, 'tokens.json'));
      await writeFile(target, `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
      await symlink(target, storage.filePath);
      const original = await readFile(target, 'utf8');

      // Act / Assert
      await expect(storage.load()).rejects.toThrow(/symbolic link/i);
      await expect(storage.save(tokens)).rejects.toThrow(/symbolic link/i);
      await expect(storage.clear()).rejects.toThrow(/symbolic link/i);
      expect(await readFile(target, 'utf8')).toBe(original);
      expect((await lstat(storage.filePath)).isSymbolicLink()).toBe(true);
    },
  );

  posixIt('rejects a symlink in the token directory ancestor chain', async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), 'garmin-token-ancestor-'));
    const actual = join(root, 'actual');
    const linked = join(root, 'linked');
    await mkdir(actual, { mode: 0o700 });
    await symlink(actual, linked);
    const storage = new FileTokenStorage(join(linked, 'nested', 'tokens.json'));

    // Act / Assert
    await expect(storage.load()).rejects.toThrow(/symbolic link/i);
    await expect(storage.save(tokens)).rejects.toThrow(/symbolic link/i);
    await expect(storage.clear()).rejects.toThrow(/symbolic link/i);
    await expect(lstat(join(actual, 'nested', 'tokens.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  posixIt('rejects a pre-planted refresh-lock symlink without touching its target', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-lock-symlink-'));
    const storage = new FileTokenStorage(dir);
    const target = join(dir, 'lock-target');
    const lockPath = `${storage.filePath}.refresh.lock`;
    await writeFile(target, 'leave-me-alone\n', { mode: 0o600 });
    await symlink(target, lockPath);

    // Act / Assert
    await expect(storage.withRefreshLock(async () => undefined)).rejects.toThrow(/symbolic link/i);
    expect(await readFile(target, 'utf8')).toBe('leave-me-alone\n');
    expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);
  });

  it('clear removes only regular token files and never recursively removes a directory', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-clear-'));
    const storage = new FileTokenStorage(dir);
    await mkdir(storage.filePath);
    await writeFile(join(storage.filePath, 'unrelated.txt'), 'keep\n');

    // Act / Assert
    await expect(storage.clear()).rejects.toThrow(/regular file/i);
    await expect(readFile(join(storage.filePath, 'unrelated.txt'), 'utf8')).resolves.toBe('keep\n');
  });

  it('creates unpredictable temporary files exclusively and retries name collisions', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-temp-'));
    const collision = join(dir, '.tokens.json.collision.tmp');
    await writeFile(collision, 'existing\n', { mode: 0o600 });
    const names = ['collision', 'unique'];

    // Act
    const temp = await createExclusiveTempFile(dir, 'tokens.json', () => names.shift() ?? 'unused');
    await temp.file.close();

    // Assert
    expect(temp.path).toBe(join(dir, '.tokens.json.unique.tmp'));
    expect(await readFile(collision, 'utf8')).toBe('existing\n');
    expect(await getFileMode(temp.path)).toBe(process.platform === 'win32' ? undefined : 0o600);
    await rm(temp.path);
  });

  posixIt('does not follow a pre-planted temporary-file symlink on collision', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-temp-symlink-'));
    const target = join(dir, 'target');
    const collision = join(dir, '.tokens.json.collision.tmp');
    await writeFile(target, 'leave-me-alone\n', { mode: 0o600 });
    await symlink(target, collision);
    const names = ['collision', 'unique'];

    // Act
    const temp = await createExclusiveTempFile(dir, 'tokens.json', () => names.shift() ?? 'unused');
    await temp.file.close();

    // Assert
    expect(temp.path).toBe(join(dir, '.tokens.json.unique.tmp'));
    expect(await readFile(target, 'utf8')).toBe('leave-me-alone\n');
    expect((await lstat(collision)).isSymbolicLink()).toBe(true);
    await rm(temp.path);
  });

  it('atomically replaces tokens without leaving temporary files behind', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-atomic-'));
    const storage = new FileTokenStorage(dir);
    await storage.save(tokens);
    const replacement = { ...tokens, accessToken: 'replacement' };

    // Act
    await storage.save(replacement);

    // Assert
    await expect(storage.load()).resolves.toEqual(replacement);
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('preserves the existing token file and cleans up after an atomic commit failure', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'garmin-token-failed-commit-'));
    const storage = new FileTokenStorage(join(dir, 'session.json'));
    await writeFile(storage.filePath, 'original\n', { mode: 0o600 });

    // Act
    const write = writeTokenFileAtomically(storage.filePath, 'replacement\n', async () =>
      Promise.reject(new Error('forced commit failure')),
    );

    // Assert
    await expect(write).rejects.toThrow('forced commit failure');
    await expect(readFile(storage.filePath, 'utf8')).resolves.toBe('original\n');
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('supports an explicit JSON path and creates missing secure parent directories', async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), 'garmin-token-explicit-json-'));
    const storage = new FileTokenStorage(join(root, 'nested', 'session.json'));

    // Act
    await storage.save(tokens);

    // Assert
    await expect(storage.load()).resolves.toEqual(tokens);
    expect(await getFileMode(dirname(storage.filePath))).toBe(
      process.platform === 'win32' ? undefined : 0o700,
    );
    expect(await getFileMode(storage.filePath)).toBe(
      process.platform === 'win32' ? undefined : 0o600,
    );
  });
});

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition.');
}
