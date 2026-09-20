import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { createFileAdoptionStateStore } from '../../scripts/garmin-adoption-utils.mjs';

const state = {
  schemaVersion: 1,
  registrationId: 'A'.repeat(22),
  managementToken: 'B'.repeat(43),
  sdkVersion: '1.2.0',
  visibility: 'private',
  expiresAt: '2026-12-19T12:00:00.000Z',
  updatedAt: '2026-09-20T12:00:00.000Z',
};
const posixIt = process.platform === 'win32' ? it.skip : it;

describe('adoption management state storage', () => {
  posixIt('tightens existing directory and file permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gcs-adoption-state-mode-'));
    const path = join(directory, 'adoption.json');
    await chmod(directory, 0o777);
    await writeFile(path, '{}\n', { mode: 0o666 });
    await chmod(path, 0o666);

    const store = createFileAdoptionStateStore(path);
    await store.save(state);

    expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    await expect(store.load()).resolves.toEqual(state);
  });

  posixIt('rejects a state-file symlink without touching its target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gcs-adoption-state-link-'));
    const path = join(directory, 'adoption.json');
    const target = join(directory, 'target.json');
    await writeFile(target, 'leave-me-alone\n', { mode: 0o600 });
    await symlink(target, path);
    const store = createFileAdoptionStateStore(path);

    await expect(store.load()).rejects.toThrow(/symbolic link/i);
    await expect(store.save(state)).rejects.toThrow(/symbolic link/i);
    await expect(store.remove()).rejects.toThrow(/symbolic link/i);
    expect(await readFile(target, 'utf8')).toBe('leave-me-alone\n');
  });

  posixIt('rejects a symlink in the ancestor chain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gcs-adoption-state-parent-'));
    const actual = join(root, 'actual');
    const linked = join(root, 'linked');
    await mkdir(actual, { mode: 0o700 });
    await symlink(actual, linked);
    const store = createFileAdoptionStateStore(join(linked, 'nested', 'adoption.json'));

    await expect(store.load()).rejects.toThrow(/symbolic link/i);
    await expect(store.save(state)).rejects.toThrow(/symbolic link/i);
    await expect(store.remove()).rejects.toThrow(/symbolic link/i);
  });

  it('uses exclusive unpredictable temp files and retries collisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gcs-adoption-state-collision-'));
    const path = join(directory, 'adoption.json');
    const collision = join(directory, '.adoption.json.collision.tmp');
    await writeFile(collision, 'existing\n', { mode: 0o600 });
    const suffixes = ['collision', 'unique'];
    const store = createFileAdoptionStateStore(path, {
      createSuffix: () => suffixes.shift() ?? 'unused',
    });

    await store.save(state);

    expect(await readFile(collision, 'utf8')).toBe('existing\n');
    expect(await readdir(directory)).toEqual(['.adoption.json.collision.tmp', 'adoption.json']);
  });

  posixIt('does not follow a pre-planted temp or lock symlink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gcs-adoption-state-temp-link-'));
    const path = join(directory, 'adoption.json');
    const target = join(directory, 'target');
    const tempLink = join(directory, '.adoption.json.collision.tmp');
    await writeFile(target, 'leave-me-alone\n', { mode: 0o600 });
    await symlink(target, tempLink);
    const suffixes = ['collision', 'unique'];
    await createFileAdoptionStateStore(path, {
      createSuffix: () => suffixes.shift() ?? 'unused',
    }).save(state);
    expect(await readFile(target, 'utf8')).toBe('leave-me-alone\n');
    expect((await lstat(tempLink)).isSymbolicLink()).toBe(true);

    await symlink(target, `${path}.lock`);
    await expect(
      createFileAdoptionStateStore(path).withLock(async () => undefined),
    ).rejects.toThrow(/symbolic link/i);
    expect(await readFile(target, 'utf8')).toBe('leave-me-alone\n');
  });

  it('serializes state changes across storage instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gcs-adoption-state-lock-'));
    const path = join(directory, 'adoption.json');
    const first = createFileAdoptionStateStore(path);
    const second = createFileAdoptionStateStore(path);
    const events = [];
    let releaseFirst;
    const canFinish = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const firstRun = first.withLock(async () => {
      events.push('first-start');
      await canFinish;
      events.push('first-end');
    });
    await waitFor(() => events.includes('first-start'));
    const secondRun = second.withLock(async () => {
      events.push('second-start');
    });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 75));
    expect(events).toEqual(['first-start']);
    releaseFirst();
    await Promise.all([firstRun, secondRun]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('keeps the previous state and removes its temp file when commit fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gcs-adoption-state-commit-'));
    const path = join(directory, 'adoption.json');
    await createFileAdoptionStateStore(path).save(state);
    const store = createFileAdoptionStateStore(path, {
      commit: async () => {
        throw new Error('simulated rename failure');
      },
    });

    await expect(store.save({ ...state, visibility: 'unindexed' })).rejects.toThrow(
      'simulated rename failure',
    );
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(state);
    expect(await readdir(directory)).toEqual(['adoption.json']);
  });

  it('removes only a regular state file, never a directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gcs-adoption-state-remove-'));
    const path = join(directory, 'adoption.json');
    await mkdir(path);
    const store = createFileAdoptionStateStore(path);

    await expect(store.remove()).rejects.toThrow(/regular file/i);
    expect((await lstat(path)).isDirectory()).toBe(true);
  });
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for state-lock test condition.');
}
