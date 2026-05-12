import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { TokenStorage } from './TokenStorage.js';
import type { GarminTokens } from './types.js';

const TOKEN_FILENAME = 'tokens.json';

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
    await writeFile(this.filePath, `${JSON.stringify(safeTokens, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
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
