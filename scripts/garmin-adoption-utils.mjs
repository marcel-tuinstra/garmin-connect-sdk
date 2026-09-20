import { Buffer } from 'node:buffer';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import process from 'node:process';

export const ADOPTION_INTAKE_ORIGIN = 'https://adoption.tuinstra.dev';
export const ADOPTION_PRIVACY_NOTICE_URL =
  'https://github.com/marcel-tuinstra/garmin-connect-sdk/blob/v1.2.0/docs/operations/adoption-measurement.md#voluntary-registration-privacy';

const packageManifest = JSON.parse(
  await readFile(new globalThis.URL('../package.json', import.meta.url), 'utf8'),
);
const SDK_VERSION = packageManifest.version;
const VISIBILITIES = new Set(['private', 'unindexed', 'private-unindexed']);
const REQUEST_TIMEOUT_MS = 10_000;
const OWNER_DIRECTORY_MODE = 0o700;
const OWNER_FILE_MODE = 0o600;
const TEMP_FILE_ATTEMPTS = 16;
const LOCK_ATTEMPTS = 400;
const LOCK_POLL_MS = 25;
const LOCK_STALE_MS = 120_000;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

export async function runAdoptionCommand({
  args,
  fetchImpl = globalThis.fetch,
  stateStore = createFileAdoptionStateStore(),
  output = process.stdout,
  confirm = async () => false,
  randomBytes = nodeRandomBytes,
  now = () => new Date(),
} = {}) {
  const [command = 'help', ...options] = args ?? [];
  if (command === 'help' || command === '--help' || command === '-h') {
    output.write(helpText());
    return 0;
  }
  if (command === 'share') {
    return share({ options, fetchImpl, stateStore, output, confirm, randomBytes, now });
  }
  if (command === 'status') {
    rejectOptions(options);
    return status({ fetchImpl, stateStore, output, randomBytes, now });
  }
  if (command === 'withdraw') {
    rejectOptions(options);
    return withdraw({ fetchImpl, stateStore, output, confirm, randomBytes, now });
  }
  throw new Error(`Unknown adoption command: ${command}`);
}

export function createMemoryAdoptionStateStore(initial = null) {
  let state = globalThis.structuredClone(initial);
  let lock = Promise.resolve();
  return {
    async load() {
      return globalThis.structuredClone(state);
    },
    async save(next) {
      state = globalThis.structuredClone(next);
    },
    async remove() {
      state = null;
    },
    async withLock(operation) {
      const previous = lock;
      let release;
      lock = new Promise((resolveLock) => {
        release = resolveLock;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
}

export function createFileAdoptionStateStore(
  path = defaultStatePath(),
  { createSuffix = secureRandomSuffix, commit = rename } = {},
) {
  const filePath = normalizeDarwinSystemAlias(resolve(path));
  return {
    async load() {
      if (!(await validateExistingDirectoryChain(dirname(filePath)))) return null;
      let file;
      try {
        file = await openRegularFile(filePath, constants.O_RDONLY);
        await tightenFileMode(file);
        const state = JSON.parse(await file.readFile('utf8'));
        validateStoredState(state);
        return state;
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      } finally {
        await file?.close();
      }
    },
    async save(state) {
      validateStoredState(state);
      await ensureSecureDirectory(dirname(filePath));
      await tightenExistingRegularFile(filePath);
      await writeStateAtomically(
        filePath,
        `${JSON.stringify(state, null, 2)}\n`,
        createSuffix,
        commit,
      );
    },
    async remove() {
      if (!(await validateExistingDirectoryChain(dirname(filePath)))) return;
      await removeRegularFileIfPresent(filePath);
    },
    async withLock(operation) {
      return withStateLock(filePath, operation);
    },
  };
}

async function withStateLock(filePath, operation) {
  const directory = dirname(filePath);
  const lockPath = `${filePath}.lock`;
  await ensureSecureDirectory(directory);
  let lock;

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      const file = await open(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
        OWNER_FILE_MODE,
      );
      try {
        await tightenFileMode(file);
        await file.writeFile(base64url(nodeRandomBytes(32)), 'utf8');
        await file.sync();
        lock = { file, stats: await file.stat() };
        break;
      } catch (error) {
        const stats = await file.stat().catch(() => null);
        await file.close().catch(() => undefined);
        if (stats) await removeMatchingRegularFile(lockPath, stats).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw mapNoFollowError(lockPath, error);
      const existing = await lstatOrNull(lockPath);
      if (existing === null) continue;
      assertRegularFile(lockPath, existing);
      if (Date.now() - existing.mtimeMs > LOCK_STALE_MS) {
        await removeMatchingRegularFile(lockPath, existing);
        continue;
      }
      await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, LOCK_POLL_MS));
    }
  }

  if (!lock) throw new Error('Timed out waiting for the adoption state lock.');
  try {
    return await operation();
  } finally {
    await lock.file.close().catch(() => undefined);
    await removeMatchingRegularFile(lockPath, lock.stats).catch(() => undefined);
  }
}

async function writeStateAtomically(filePath, contents, createSuffix, commit) {
  const directory = dirname(filePath);
  const temporary = await createExclusiveTempFile(directory, basename(filePath), createSuffix);
  let openHandle = true;
  try {
    await temporary.file.writeFile(contents, 'utf8');
    await tightenFileMode(temporary.file);
    await temporary.file.sync();
    const stats = await temporary.file.stat();
    await temporary.file.close();
    openHandle = false;
    await assertSameRegularFile(temporary.path, stats);
    if (!(await validateExistingDirectoryChain(directory))) {
      throw unsafePathError(directory, 'directory disappeared during validation');
    }
    await tightenExistingRegularFile(filePath);
    await commit(temporary.path, filePath);
  } catch (error) {
    if (openHandle) await temporary.file.close().catch(() => undefined);
    await removeRegularFileIfPresent(temporary.path).catch(() => undefined);
    throw error;
  }
}

async function createExclusiveTempFile(directory, targetBasename, createSuffix) {
  for (let attempt = 0; attempt < TEMP_FILE_ATTEMPTS; attempt += 1) {
    const suffix = createSuffix();
    if (!/^[A-Za-z0-9_-]+$/.test(suffix)) {
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
        const stats = await file.stat().catch(() => null);
        await file.close().catch(() => undefined);
        if (stats) await removeMatchingRegularFile(path, stats).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw mapNoFollowError(path, error);
    }
  }
  throw new Error(
    `Unable to create an exclusive adoption state file after ${TEMP_FILE_ATTEMPTS} attempts.`,
  );
}

async function ensureSecureDirectory(path) {
  let missingSeen = false;
  for (const component of pathComponents(path)) {
    let stats = await lstatOrNull(component);
    if (stats === null) {
      missingSeen = true;
      try {
        await mkdir(component, { mode: OWNER_DIRECTORY_MODE });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
      stats = await lstatOrNull(component);
    }
    assertDirectory(component, stats);
    if (missingSeen) await tightenDirectoryMode(component);
  }
  await tightenDirectoryMode(path);
  assertDirectory(path, await lstatOrNull(path));
}

async function validateExistingDirectoryChain(path) {
  for (const component of pathComponents(path)) {
    const stats = await lstatOrNull(component);
    if (stats === null) return false;
    assertDirectory(component, stats);
  }
  return true;
}

function pathComponents(path) {
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

function normalizeDarwinSystemAlias(path) {
  if (process.platform !== 'darwin') return path;
  for (const alias of ['/etc', '/tmp', '/var']) {
    if (path === alias || path.startsWith(`${alias}/`)) return `/private${path}`;
  }
  return path;
}

function assertDirectory(path, stats) {
  if (stats === null) throw unsafePathError(path, 'directory disappeared during validation');
  if (stats.isSymbolicLink()) throw unsafePathError(path, 'symbolic link is not allowed');
  if (!stats.isDirectory()) throw unsafePathError(path, 'expected a directory');
}

async function tightenDirectoryMode(path) {
  if (process.platform !== 'win32') await chmod(path, OWNER_DIRECTORY_MODE);
}

async function tightenFileMode(file) {
  if (process.platform !== 'win32') await file.chmod(OWNER_FILE_MODE);
}

async function tightenExistingRegularFile(path) {
  const stats = await lstatOrNull(path);
  if (stats === null) return;
  assertRegularFile(path, stats);
  const file = await openRegularFile(path, constants.O_RDONLY);
  try {
    await tightenFileMode(file);
  } finally {
    await file.close();
  }
}

async function openRegularFile(path, flags) {
  const before = await lstatOrNull(path);
  if (before !== null) assertRegularFile(path, before);
  let file;
  try {
    file = await open(path, flags | NO_FOLLOW);
  } catch (error) {
    throw mapNoFollowError(path, error);
  }
  try {
    const after = await file.stat();
    if (!after.isFile()) throw unsafePathError(path, 'expected a regular file');
    if (before !== null && !sameFile(before, after)) {
      throw unsafePathError(path, 'file changed during validation');
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

function assertRegularFile(path, stats) {
  if (stats.isSymbolicLink()) throw unsafePathError(path, 'symbolic link is not allowed');
  if (!stats.isFile()) throw unsafePathError(path, 'expected a regular file');
}

async function assertSameRegularFile(path, expected) {
  const current = await lstatOrNull(path);
  if (current === null) throw unsafePathError(path, 'file disappeared during validation');
  assertRegularFile(path, current);
  if (!sameFile(current, expected)) throw unsafePathError(path, 'file changed during validation');
}

async function removeRegularFileIfPresent(path) {
  const stats = await lstatOrNull(path);
  if (stats === null) return;
  assertRegularFile(path, stats);
  await assertSameRegularFile(path, stats);
  await unlink(path);
}

async function removeMatchingRegularFile(path, expected) {
  const current = await lstatOrNull(path);
  if (current === null) return;
  assertRegularFile(path, current);
  if (!sameFile(current, expected)) throw unsafePathError(path, 'file changed during validation');
  await unlink(path);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function lstatOrNull(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function mapNoFollowError(path, error) {
  if (['ELOOP', 'EMLINK'].includes(error?.code)) {
    return unsafePathError(path, 'symbolic link is not allowed');
  }
  return error;
}

function unsafePathError(path, reason) {
  return new Error(`Unsafe adoption state path ${path}: ${reason}.`);
}

function secureRandomSuffix() {
  return nodeRandomBytes(16).toString('hex');
}

async function share({ options, fetchImpl, stateStore, output, confirm, randomBytes, now }) {
  const { visibility, dryRun } = parseShareOptions(options);
  const payload = Object.freeze({
    schemaVersion: 1,
    consentVersion: 1,
    consent: true,
    sdkVersion: SDK_VERSION,
    visibility,
  });
  output.write(
    [
      'Voluntary pseudonymous adoption registration',
      `Destination: ${ADOPTION_INTAKE_ORIGIN}`,
      `Privacy notice (consent version 1): ${ADOPTION_PRIVACY_NOTICE_URL}`,
      'Exact payload:',
      JSON.stringify(payload, null, 2),
      '',
      'After consent, a random registration ID and bearer management capability are also sent as request headers; the service stores only keyed hashes of them.',
      'Their local management state is saved before the first request so an uncertain network outcome can be retried.',
      'Each request also sends a fresh random request ID and the current request timestamp for replay resistance.',
      'The network edge processes your address for delivery and hourly abuse prevention; the application retains only a short-lived keyed hash.',
      'No repository identity, paths, source, Garmin data, Garmin/repository credentials, personal identity, commercial-use claim, or usage frequency is sent.',
      'The active record expires after 90 days. Withdrawal deletes it and keeps a keyed 24-hour replay-prevention tombstone.',
      'Encrypted operator backups may retain a withdrawn active record for no more than 30 days.',
      'Rounded, thresholded historical aggregates remain public in project history and cannot be removed per registration.',
      'Controller/contact: Marcel Tuinstra via the repository private security-reporting channel.',
      '',
    ].join('\n'),
  );
  if (dryRun) {
    output.write('Dry run only; nothing was sent or stored.\n');
    return 0;
  }
  if (!(await confirm('Share this exact payload? [y/N] '))) {
    output.write('Not shared; nothing was sent or stored.\n');
    return 0;
  }

  return stateStore.withLock(async () => {
    const existing = await stateStore.load();
    const credentials = existing ?? {
      registrationId: base64url(randomBytes(16)),
      managementToken: base64url(randomBytes(32)),
    };
    validateCredentialShape(credentials);
    if (!existing) {
      await stateStore.save({
        schemaVersion: 1,
        registrationId: credentials.registrationId,
        managementToken: credentials.managementToken,
        sdkVersion: SDK_VERSION,
        visibility,
        expiresAt: null,
        updatedAt: now().toISOString(),
      });
    }
    const response = await request('/v1/registrations', {
      method: 'POST',
      fetchImpl,
      credentials,
      body: payload,
      randomBytes,
      now,
    });
    if (!response.ok) {
      output.write(
        `Registration outcome unavailable (HTTP ${response.status}); local management state was kept so you can retry.\n`,
      );
      return 1;
    }
    const result = await responseJson(response);
    if (result?.status !== 'active' || !validIso(result?.expiresAt)) {
      output.write(
        'Registration outcome unavailable (invalid response); local management state was kept so you can retry.\n',
      );
      return 1;
    }
    await stateStore.save({
      schemaVersion: 1,
      registrationId: credentials.registrationId,
      managementToken: credentials.managementToken,
      sdkVersion: SDK_VERSION,
      visibility,
      expiresAt: result.expiresAt,
      updatedAt: now().toISOString(),
    });
    output.write(`Registration active until ${result.expiresAt}.\n`);
    return 0;
  });
}

async function status({ fetchImpl, stateStore, output, randomBytes, now }) {
  const state = await stateStore.load();
  if (!state) {
    output.write('No local voluntary adoption registration.\n');
    return 0;
  }
  const response = await request('/v1/registrations/status', {
    method: 'POST',
    fetchImpl,
    credentials: state,
    randomBytes,
    now,
  });
  if (!response.ok) {
    output.write(`Remote registration status unavailable (HTTP ${response.status}).\n`);
    return 1;
  }
  const result = await responseJson(response);
  if (result?.status !== 'active' || !validIso(result?.expiresAt)) {
    output.write('Remote registration status unavailable (invalid response).\n');
    return 1;
  }
  output.write(`Registration active until ${result.expiresAt}.\n`);
  return 0;
}

async function withdraw({ fetchImpl, stateStore, output, confirm, randomBytes, now }) {
  const state = await stateStore.load();
  if (!state) {
    output.write('No local voluntary adoption registration to withdraw.\n');
    return 0;
  }
  if (!(await confirm('Withdraw this voluntary registration? [y/N] '))) {
    output.write('Registration kept.\n');
    return 0;
  }
  return stateStore.withLock(async () => {
    const current = await stateStore.load();
    if (!current) {
      output.write('Registration was already removed locally.\n');
      return 0;
    }
    const response = await request('/v1/registrations', {
      method: 'DELETE',
      fetchImpl,
      credentials: current,
      randomBytes,
      now,
    });
    if (response.status !== 204) {
      output.write(`Withdrawal unavailable (HTTP ${response.status}); local state was kept.\n`);
      return 1;
    }
    await stateStore.remove();
    output.write('Active registration withdrawn and local management state removed.\n');
    return 0;
  });
}

async function request(path, { method, fetchImpl, credentials, body, randomBytes, now }) {
  validateCredentialShape(credentials);
  try {
    return await fetchImpl(`${ADOPTION_INTAKE_ORIGIN}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${credentials.managementToken}`,
        'content-type': 'application/json',
        'x-adoption-registration-id': credentials.registrationId,
        'x-adoption-request-id': base64url(randomBytes(16)),
        'x-adoption-requested-at': now().toISOString(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return new globalThis.Response(null, { status: 503 });
  }
}

function parseShareOptions(options) {
  let visibility = null;
  let dryRun = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === '--dry-run') {
      dryRun = true;
    } else if (option === '--visibility') {
      visibility = options[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown share option: ${option}`);
    }
  }
  if (!VISIBILITIES.has(visibility)) {
    throw new Error('Use --visibility private, unindexed, or private-unindexed.');
  }
  return { visibility, dryRun };
}

function rejectOptions(options) {
  if (options.length > 0) throw new Error('This command does not accept options.');
}

function validateStoredState(state) {
  const keys = Object.keys(state ?? {}).sort();
  const allowed = [
    'expiresAt',
    'managementToken',
    'registrationId',
    'schemaVersion',
    'sdkVersion',
    'updatedAt',
    'visibility',
  ];
  if (keys.some((key) => !allowed.includes(key))) throw new Error('Invalid adoption state.');
  validateCredentialShape(state);
  if (
    state.schemaVersion !== 1 ||
    !VISIBILITIES.has(state.visibility) ||
    typeof state.sdkVersion !== 'string' ||
    state.sdkVersion.length > 64 ||
    (state.expiresAt !== null && !validIso(state.expiresAt)) ||
    !validIso(state.updatedAt)
  ) {
    throw new Error('Invalid adoption state.');
  }
}

function validateCredentialShape(value) {
  if (
    !/^[A-Za-z0-9_-]{22}$/.test(value?.registrationId ?? '') ||
    !/^[A-Za-z0-9_-]{43}$/.test(value?.managementToken ?? '')
  ) {
    throw new Error('Invalid local adoption management state.');
  }
}

function responseJson(response) {
  return response.json().catch(() => null);
}

function base64url(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('Secure random bytes are unavailable.');
  return Buffer.from(bytes).toString('base64url');
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function defaultStatePath() {
  const base =
    process.env.XDG_STATE_HOME ||
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : join(homedir(), '.local', 'state'));
  return join(base, 'garmin-connect-sdk', 'adoption.json');
}

function helpText() {
  return [
    'Usage: garmin-connect-adoption <command>',
    '',
    'Commands:',
    '  share --visibility <private|unindexed|private-unindexed> [--dry-run]',
    '  status',
    '  withdraw',
    '',
  ].join('\n');
}
