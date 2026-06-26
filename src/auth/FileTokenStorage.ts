import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { TokenStorage } from './TokenStorage.js';
import type { GarminTokens } from './types.js';

const TOKEN_FILENAME = 'tokens.json';
const REFRESH_LOCK_POLL_MS = 25;
const REFRESH_LOCK_STALE_MS = 120_000;

export class FileTokenStorage implements TokenStorage {
  readonly filePath: string;

  constructor(path: string) {
    this.filePath = resolve(path.endsWith('.json') ? path : join(path, TOKEN_FILENAME));
  }

  async load(): Promise<GarminTokens | null> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(contents) as GarminTokens;
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        accessTokenExpiresAt: parsed.accessTokenExpiresAt,
        refreshTokenExpiresAt: parsed.refreshTokenExpiresAt,
        tokenType: parsed.tokenType,
        scope: parsed.scope,
        displayName: parsed.displayName,
        clientId: parsed.clientId,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async save(tokens: GarminTokens): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const safeTokens: GarminTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      tokenType: tokens.tokenType,
      scope: tokens.scope,
      displayName: tokens.displayName,
      clientId: tokens.clientId,
    };
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(safeTokens, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(tempPath, this.filePath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }

  async withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const lockPath = `${this.filePath}.refresh.lock`;
    const lock = await acquireLock(lockPath);

    try {
      return await operation();
    } finally {
      await lock.file.close();
      await releaseLock(lockPath, lock.owner);
    }
  }
}

interface RefreshLock {
  file: FileHandle;
  owner: string;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export async function getFileMode(path: string): Promise<number | undefined> {
  if (process.platform === 'win32') return undefined;
  return (await stat(path)).mode & 0o777;
}

async function acquireLock(path: string): Promise<RefreshLock> {
  while (true) {
    try {
      const file = await open(path, 'wx', 0o600);
      const owner = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      await file.writeFile(`${owner}\n`);
      return { file, owner };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await removeStaleLock(path);
      await sleep(REFRESH_LOCK_POLL_MS);
    }
  }
}

async function releaseLock(path: string, owner: string): Promise<void> {
  try {
    const currentOwner = (await readFile(path, 'utf8')).trim();
    if (currentOwner === owner) await rm(path, { force: true });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

async function removeStaleLock(path: string): Promise<void> {
  try {
    const stats = await stat(path);
    if (Date.now() - stats.mtimeMs > REFRESH_LOCK_STALE_MS) {
      await rm(path, { force: true });
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
