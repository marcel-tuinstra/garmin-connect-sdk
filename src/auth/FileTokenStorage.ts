import { randomBytes } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';

import type { TokenStorage } from './TokenStorage.js';
import type { GarminTokens } from './types.js';

const TOKEN_FILENAME = 'tokens.json';
const REFRESH_LOCK_POLL_MS = 25;
const REFRESH_LOCK_STALE_MS = 120_000;
const TEMP_FILE_ATTEMPTS = 16;
const OWNER_DIRECTORY_MODE = 0o700;
const OWNER_FILE_MODE = 0o600;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

export class FileTokenStorage implements TokenStorage {
  readonly filePath: string;

  constructor(path: string) {
    this.filePath = resolve(path.endsWith('.json') ? path : join(path, TOKEN_FILENAME));
  }

  async load(): Promise<GarminTokens | null> {
    if (!(await validateExistingDirectoryChain(dirname(this.filePath)))) return null;

    let file: FileHandle;
    try {
      file = await openRegularFile(this.filePath, constants.O_RDONLY);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }

    try {
      await tightenFileMode(file);
      const contents = await file.readFile('utf8');
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
    } finally {
      await file.close();
    }
  }

  async save(tokens: GarminTokens): Promise<void> {
    const directory = dirname(this.filePath);
    await ensureSecureDirectory(directory);
    await tightenExistingRegularFile(this.filePath);

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
    const contents = `${JSON.stringify(safeTokens, null, 2)}\n`;
    await writeTokenFileAtomically(this.filePath, contents);
  }

  async clear(): Promise<void> {
    if (!(await validateExistingDirectoryChain(dirname(this.filePath)))) return;
    await removeRegularFileIfPresent(this.filePath);
  }

  async withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    const directory = dirname(this.filePath);
    await ensureSecureDirectory(directory);
    const lockPath = `${this.filePath}.refresh.lock`;
    const lock = await acquireLock(lockPath);

    try {
      return await operation();
    } finally {
      await lock.file.close();
      await releaseLock(lockPath, lock.owner, lock.stats);
    }
  }
}

interface RefreshLock {
  file: FileHandle;
  owner: string;
  stats: Stats;
}

export interface ExclusiveTempFile {
  file: FileHandle;
  path: string;
}

type RenameOperation = (oldPath: string, newPath: string) => Promise<void>;

export async function writeTokenFileAtomically(
  filePath: string,
  contents: string,
  commit: RenameOperation = rename,
): Promise<void> {
  const directory = dirname(filePath);
  const temp = await createExclusiveTempFile(directory, basename(filePath));
  let tempStats: Stats | undefined;
  let isOpen = true;

  try {
    await temp.file.writeFile(contents, 'utf8');
    await tightenFileMode(temp.file);
    await temp.file.sync();
    tempStats = await temp.file.stat();
    await temp.file.close();
    isOpen = false;

    await assertSameRegularFile(temp.path, tempStats);
    if (!(await validateExistingDirectoryChain(directory))) {
      throw unsafePathError(directory, 'directory disappeared during validation');
    }
    await tightenExistingRegularFile(filePath);
    await commit(temp.path, filePath);
    tempStats = undefined;
  } catch (error) {
    if (isOpen) await temp.file.close().catch(() => undefined);
    if (tempStats !== undefined) {
      await removeMatchingRegularFile(temp.path, tempStats).catch(() => undefined);
    } else {
      await removeRegularFileIfPresent(temp.path).catch(() => undefined);
    }
    throw error;
  }
}

export async function createExclusiveTempFile(
  directory: string,
  targetBasename: string,
  createSuffix: () => string = secureRandomSuffix,
): Promise<ExclusiveTempFile> {
  for (let attempt = 0; attempt < TEMP_FILE_ATTEMPTS; attempt += 1) {
    const suffix = createSuffix();
    if (!/^[a-zA-Z0-9_-]+$/u.test(suffix)) {
      throw unsafePathError(directory, 'temporary-file suffix contains path separators');
    }
    const path = join(directory, `.${targetBasename}.${suffix}.tmp`);

    try {
      const file = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
        OWNER_FILE_MODE,
      );
      try {
        await tightenFileMode(file);
        return { file, path };
      } catch (error) {
        const stats = await file.stat().catch(() => undefined);
        await file.close().catch(() => undefined);
        if (stats !== undefined)
          await removeMatchingRegularFile(path, stats).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (isAlreadyExists(error)) continue;
      throw mapNoFollowError(path, error);
    }
  }

  throw new Error(
    `Unable to create an exclusive temporary token file after ${TEMP_FILE_ATTEMPTS} attempts.`,
  );
}

function secureRandomSuffix(): string {
  return randomBytes(16).toString('hex');
}

function normalizeDarwinSystemAlias(path: string): string {
  if (process.platform !== 'darwin') return path;
  for (const alias of ['/etc', '/tmp', '/var']) {
    if (path === alias || path.startsWith(`${alias}/`)) return `/private${path}`;
  }
  return path;
}

async function ensureSecureDirectory(path: string): Promise<void> {
  let missingSeen = false;
  for (const component of pathComponents(path)) {
    let stats = await lstatOrNull(component);
    if (stats === null) {
      missingSeen = true;
      try {
        await mkdir(component, { mode: OWNER_DIRECTORY_MODE });
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
      stats = await lstatOrNull(component);
    }

    assertDirectory(component, stats);
    if (missingSeen) await tightenDirectoryMode(component);
  }

  await tightenDirectoryMode(path);
  assertDirectory(path, await lstatOrNull(path));
}

async function validateExistingDirectoryChain(path: string): Promise<boolean> {
  for (const component of pathComponents(path)) {
    const stats = await lstatOrNull(component);
    if (stats === null) return false;
    assertDirectory(component, stats);
  }
  return true;
}

function pathComponents(path: string): string[] {
  const absolute = normalizeDarwinSystemAlias(resolve(path));
  const root = parse(absolute).root;
  const components = [root];
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    components.push(current);
  }
  return components;
}

function assertDirectory(path: string, stats: Stats | null): asserts stats is Stats {
  if (stats === null) throw unsafePathError(path, 'directory disappeared during validation');
  if (stats.isSymbolicLink()) throw unsafePathError(path, 'symbolic link is not allowed');
  if (!stats.isDirectory()) throw unsafePathError(path, 'expected a directory');
}

async function tightenDirectoryMode(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  await chmod(path, OWNER_DIRECTORY_MODE);
}

async function tightenFileMode(file: FileHandle): Promise<void> {
  if (process.platform === 'win32') return;
  await file.chmod(OWNER_FILE_MODE);
}

async function tightenExistingRegularFile(path: string): Promise<void> {
  const pathStats = await lstatOrNull(path);
  if (pathStats === null) return;
  assertRegularFile(path, pathStats);
  const file = await openRegularFile(path, constants.O_RDONLY);
  try {
    await tightenFileMode(file);
  } finally {
    await file.close();
  }
}

async function openRegularFile(path: string, flags: number): Promise<FileHandle> {
  const pathStats = await lstatOrNull(path);
  if (pathStats !== null) assertRegularFile(path, pathStats);

  let file: FileHandle;
  try {
    file = await open(path, flags | NO_FOLLOW);
  } catch (error) {
    throw mapNoFollowError(path, error);
  }

  try {
    const openedStats = await file.stat();
    if (!openedStats.isFile()) throw unsafePathError(path, 'expected a regular file');
    if (pathStats !== null && !sameFile(pathStats, openedStats)) {
      throw unsafePathError(path, 'file changed during validation');
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

function assertRegularFile(path: string, stats: Stats): void {
  if (stats.isSymbolicLink()) throw unsafePathError(path, 'symbolic link is not allowed');
  if (!stats.isFile()) throw unsafePathError(path, 'expected a regular file');
}

async function assertSameRegularFile(path: string, expected: Stats): Promise<void> {
  const current = await lstatOrNull(path);
  if (current === null) throw unsafePathError(path, 'file disappeared during validation');
  assertRegularFile(path, current);
  if (!sameFile(current, expected)) throw unsafePathError(path, 'file changed during validation');
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function removeRegularFileIfPresent(path: string): Promise<void> {
  const stats = await lstatOrNull(path);
  if (stats === null) return;
  assertRegularFile(path, stats);
  await removeMatchingRegularFile(path, stats);
}

async function removeMatchingRegularFile(path: string, expected: Stats): Promise<void> {
  await assertSameRegularFile(path, expected);
  await unlink(path);
}

function unsafePathError(path: string, reason: string): Error {
  const error = new Error(`Refusing unsafe token-storage path "${path}": ${reason}.`);
  Object.assign(error, { code: 'ERR_GARMIN_TOKEN_STORAGE_UNSAFE_PATH' });
  return error;
}

function mapNoFollowError(path: string, error: unknown): unknown {
  if (hasErrorCode(error, 'ELOOP')) return unsafePathError(path, 'symbolic link is not allowed');
  return error;
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT');
}

export async function getFileMode(path: string): Promise<number | undefined> {
  if (process.platform === 'win32') return undefined;
  return (await stat(path)).mode & 0o777;
}

async function acquireLock(path: string): Promise<RefreshLock> {
  while (true) {
    try {
      const file = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
        OWNER_FILE_MODE,
      );
      const owner = `${process.pid}:${Date.now()}:${secureRandomSuffix()}`;
      try {
        await tightenFileMode(file);
        await file.writeFile(`${owner}\n`);
        await file.sync();
        return { file, owner, stats: await file.stat() };
      } catch (error) {
        const stats = await file.stat().catch(() => undefined);
        await file.close().catch(() => undefined);
        if (stats !== undefined)
          await removeMatchingRegularFile(path, stats).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (!isAlreadyExists(error)) throw mapNoFollowError(path, error);
      await removeStaleLock(path);
      await sleep(REFRESH_LOCK_POLL_MS);
    }
  }
}

async function releaseLock(path: string, owner: string, expected: Stats): Promise<void> {
  let file: FileHandle;
  try {
    file = await openRegularFile(path, constants.O_RDONLY);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }

  try {
    const currentStats = await file.stat();
    if (!sameFile(currentStats, expected)) return;
    const currentOwner = (await file.readFile('utf8')).trim();
    if (currentOwner !== owner) return;
  } finally {
    await file.close();
  }

  await removeMatchingRegularFile(path, expected);
}

async function removeStaleLock(path: string): Promise<void> {
  const pathStats = await lstatOrNull(path);
  if (pathStats === null) return;
  assertRegularFile(path, pathStats);

  let file: FileHandle;
  try {
    file = await openRegularFile(path, constants.O_RDONLY);
  } catch (error) {
    // The current owner may release the lock after our lstat but before open.
    // That is normal contention, not a storage failure.
    if (isNotFound(error)) return;
    throw error;
  }
  let openedStats: Stats;
  try {
    await tightenFileMode(file);
    openedStats = await file.stat();
  } finally {
    await file.close();
  }

  if (Date.now() - openedStats.mtimeMs > REFRESH_LOCK_STALE_MS) {
    await removeMatchingRegularFile(path, openedStats);
  }
}

function isAlreadyExists(error: unknown): boolean {
  return hasErrorCode(error, 'EEXIST');
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
