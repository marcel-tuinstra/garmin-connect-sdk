import { describe, expect, it, vi } from 'vitest';

import {
  ADOPTION_INTAKE_ORIGIN,
  ADOPTION_PRIVACY_NOTICE_URL,
  createMemoryAdoptionStateStore,
  runAdoptionCommand,
} from '../../scripts/garmin-adoption-utils.mjs';
import {
  createAdoptionIntake,
  createMemoryRegistrationStore,
} from '../../infra/adoption-intake/handler.mjs';

function captureOutput() {
  const values = [];
  return {
    values,
    stream: { write: (value) => values.push(String(value)) },
  };
}

describe('voluntary adoption opt-in CLI', () => {
  it('previews the exact minimal payload and defaults confirmation to no', async () => {
    const fetchImpl = vi.fn();
    const stateStore = createMemoryAdoptionStateStore();
    const output = captureOutput();

    const exitCode = await runAdoptionCommand({
      args: ['share', '--visibility', 'private'],
      fetchImpl,
      stateStore,
      output: output.stream,
      confirm: async () => false,
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await stateStore.load()).toBeNull();
    const rendered = output.values.join('');
    expect(rendered).toContain(`Destination: ${ADOPTION_INTAKE_ORIGIN}`);
    expect(rendered).toContain(ADOPTION_PRIVACY_NOTICE_URL);
    expect(rendered).toContain('pseudonymous');
    expect(rendered).toContain('bearer management capability');
    expect(rendered).toContain('saved before the first request');
    expect(rendered).toContain('fresh random request ID');
    expect(rendered).toContain('network edge processes your address');
    expect(rendered).toContain('backups may retain');
    expect(rendered).toContain('historical aggregates remain public');
    expect(rendered).toContain('Controller/contact');
    expect(rendered).not.toMatch(/anonymous/i);
    expect(rendered).toContain('"sdkVersion"');
    const preview = rendered.slice(rendered.indexOf('{'), rendered.indexOf('}') + 1);
    expect(preview).not.toMatch(/repository|garmin|email|path/i);
  });

  it('dry-runs without a request, confirmation, or state write', async () => {
    const fetchImpl = vi.fn();
    const confirm = vi.fn();
    const stateStore = createMemoryAdoptionStateStore();

    const exitCode = await runAdoptionCommand({
      args: ['share', '--visibility', 'unindexed', '--dry-run'],
      fetchImpl,
      stateStore,
      output: captureOutput().stream,
      confirm,
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(await stateStore.load()).toBeNull();
  });

  it('submits only an allowlisted pseudonymous payload after explicit consent', async () => {
    const stateStore = createMemoryAdoptionStateStore();
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body)).toEqual({
        schemaVersion: 1,
        consentVersion: 1,
        consent: true,
        sdkVersion: '1.1.1',
        visibility: 'private',
      });
      expect(init.headers.authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
      expect(init.headers['x-adoption-registration-id']).toMatch(/^[A-Za-z0-9_-]{22}$/);
      return globalThis.Response.json({ status: 'active', expiresAt: '2026-12-19T12:00:00.000Z' });
    });

    const exitCode = await runAdoptionCommand({
      args: ['share', '--visibility', 'private'],
      fetchImpl,
      stateStore,
      output: captureOutput().stream,
      confirm: async () => true,
      randomBytes: deterministicRandom,
      now: () => new Date('2026-09-20T12:00:00.000Z'),
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${ADOPTION_INTAKE_ORIGIN}/v1/registrations`);
    expect(await stateStore.load()).toMatchObject({
      schemaVersion: 1,
      sdkVersion: '1.1.1',
      visibility: 'private',
      expiresAt: '2026-12-19T12:00:00.000Z',
    });
    expect(JSON.stringify(await stateStore.load())).not.toMatch(/repository|garmin|email|path/i);
  });

  it.each([
    ['missing visibility', ['share']],
    ['invalid visibility', ['share', '--visibility', 'public']],
    ['unknown option', ['share', '--visibility', 'private', '--repository', 'secret/repo']],
  ])('rejects %s before network access', async (_label, args) => {
    const fetchImpl = vi.fn();
    await expect(
      runAdoptionCommand({
        args,
        fetchImpl,
        stateStore: createMemoryAdoptionStateStore(),
        output: captureOutput().stream,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports remote failure as unavailable rather than unregistered or zero', async () => {
    const stateStore = createMemoryAdoptionStateStore({
      schemaVersion: 1,
      registrationId: 'AAAAAAAAAAAAAAAAAAAAAA',
      managementToken: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      sdkVersion: '1.1.1',
      visibility: 'private',
      expiresAt: '2026-12-19T12:00:00.000Z',
    });
    const output = captureOutput();

    const exitCode = await runAdoptionCommand({
      args: ['status'],
      fetchImpl: async () => new globalThis.Response('busy', { status: 503 }),
      stateStore,
      output: output.stream,
    });

    expect(exitCode).toBe(1);
    expect(output.values.join('')).toContain('unavailable');
    expect(output.values.join('')).not.toContain('unregistered');
  });

  it('keeps a recoverable pending capability when the first response is lost', async () => {
    const stateStore = createMemoryAdoptionStateStore();
    const firstHeaders = [];
    const failedFetch = vi.fn(async (_url, init) => {
      firstHeaders.push(init.headers);
      return new globalThis.Response(null, { status: 503 });
    });
    const common = {
      args: ['share', '--visibility', 'private'],
      stateStore,
      output: captureOutput().stream,
      confirm: async () => true,
      randomBytes: deterministicRandom,
      now: () => new Date('2026-09-20T12:00:00.000Z'),
    };

    expect(await runAdoptionCommand({ ...common, fetchImpl: failedFetch })).toBe(1);
    const pending = await stateStore.load();
    expect(pending).toMatchObject({ expiresAt: null, visibility: 'private' });

    const successfulFetch = vi.fn(async (_url, init) => {
      expect(init.headers.authorization).toBe(firstHeaders[0].authorization);
      expect(init.headers['x-adoption-registration-id']).toBe(
        firstHeaders[0]['x-adoption-registration-id'],
      );
      return globalThis.Response.json({
        status: 'active',
        expiresAt: '2026-12-19T12:00:00.000Z',
      });
    });
    expect(await runAdoptionCommand({ ...common, fetchImpl: successfulFetch })).toBe(0);
    expect(await stateStore.load()).toMatchObject({
      registrationId: pending.registrationId,
      managementToken: pending.managementToken,
      expiresAt: '2026-12-19T12:00:00.000Z',
    });
  });

  it('retains pending credentials when persisting a successful first response fails', async () => {
    const backingStore = createMemoryAdoptionStateStore();
    let saves = 0;
    const stateStore = {
      ...backingStore,
      async save(value) {
        saves += 1;
        if (saves === 2) throw new Error('simulated active-state write failure');
        return backingStore.save(value);
      },
    };

    await expect(
      runAdoptionCommand({
        args: ['share', '--visibility', 'private'],
        fetchImpl: async () =>
          globalThis.Response.json({
            status: 'active',
            expiresAt: '2026-12-19T12:00:00.000Z',
          }),
        stateStore,
        output: captureOutput().stream,
        confirm: async () => true,
        randomBytes: deterministicRandom,
        now: () => new Date('2026-09-20T12:00:00.000Z'),
      }),
    ).rejects.toThrow('simulated active-state write failure');
    await expect(backingStore.load()).resolves.toMatchObject({
      expiresAt: null,
      registrationId: expect.any(String),
      managementToken: expect.any(String),
    });
  });

  it('withdraws with its capability and deletes local state only after remote success', async () => {
    const initial = {
      schemaVersion: 1,
      registrationId: 'AAAAAAAAAAAAAAAAAAAAAA',
      managementToken: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      sdkVersion: '1.1.1',
      visibility: 'private',
      expiresAt: '2026-12-19T12:00:00.000Z',
    };
    const stateStore = createMemoryAdoptionStateStore(initial);
    const fetchImpl = vi.fn(async () => new globalThis.Response(null, { status: 204 }));

    const exitCode = await runAdoptionCommand({
      args: ['withdraw'],
      fetchImpl,
      stateStore,
      output: captureOutput().stream,
      confirm: async () => true,
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
    expect(await stateStore.load()).toBeNull();
  });

  it('completes the share, status, renewal, and withdrawal protocol end to end', async () => {
    const registrationStore = createMemoryRegistrationStore();
    const intake = createAdoptionIntake({
      store: registrationStore,
      secret: 'test-only-pepper-with-at-least-32-characters',
      now: () => new Date('2026-09-20T12:00:00.000Z'),
    });
    const stateStore = createMemoryAdoptionStateStore();
    const fetchImpl = (url, init) => intake(new globalThis.Request(url, init));
    const common = {
      fetchImpl,
      stateStore,
      output: captureOutput().stream,
      confirm: async () => true,
      randomBytes: deterministicRandom,
      now: () => new Date('2026-09-20T12:00:00.000Z'),
    };

    expect(
      await runAdoptionCommand({
        ...common,
        args: ['share', '--visibility', 'private-unindexed'],
      }),
    ).toBe(0);
    expect(await runAdoptionCommand({ ...common, args: ['status'] })).toBe(0);
    expect(
      await runAdoptionCommand({
        ...common,
        args: ['share', '--visibility', 'private-unindexed'],
      }),
    ).toBe(0);
    expect(await registrationStore.count()).toBe(1);
    expect(await runAdoptionCommand({ ...common, args: ['withdraw'] })).toBe(0);
    expect(await registrationStore.count()).toBe(0);
    expect(await stateStore.load()).toBeNull();
  });
});

function deterministicRandom(size) {
  return new Uint8Array(size).fill(size);
}
