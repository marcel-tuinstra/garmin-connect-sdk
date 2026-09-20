import { describe, expect, it, vi } from 'vitest';

import {
  createAdoptionIntake,
  createMemoryRegistrationStore,
} from '../../infra/adoption-intake/handler.mjs';

const registrationId = 'AAAAAAAAAAAAAAAAAAAAAA';
const managementToken = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const fixedNow = () => new Date('2026-09-20T12:00:00.000Z');
const headers = {
  authorization: `Bearer ${managementToken}`,
  'content-type': 'application/json',
  'x-adoption-registration-id': registrationId,
  'x-adoption-request-id': 'C'.repeat(22),
  'x-adoption-requested-at': fixedNow().toISOString(),
};
const payload = {
  schemaVersion: 1,
  consentVersion: 1,
  consent: true,
  sdkVersion: '1.2.0',
  visibility: 'private',
};

describe('adoption intake', () => {
  it('creates and idempotently renews a pseudonymous 90-day registration', async () => {
    const store = createMemoryRegistrationStore();
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      now: fixedNow,
    });

    const first = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
    );
    const second = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({
      status: 'active',
      expiresAt: '2026-12-19T12:00:00.000Z',
    });
    expect(await store.count()).toBe(1);
    expect(JSON.stringify(await store.inspect())).not.toContain(registrationId);
    expect(JSON.stringify(await store.inspect())).not.toContain(managementToken);
  });

  it.each([
    ['unknown field', { ...payload, repository: 'secret/repo' }],
    ['invalid version', { ...payload, sdkVersion: '../../etc/passwd' }],
    ['missing consent', { ...payload, consent: false }],
    ['public visibility', { ...payload, visibility: 'public' }],
    ['control character', { ...payload, sdkVersion: '1.2.0\nsecret' }],
  ])('rejects %s without storing it', async (_label, body) => {
    const store = createMemoryRegistrationStore();
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      now: fixedNow,
    });
    const response = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(400);
    expect(await store.count()).toBe(0);
  });

  it('rejects non-HTTPS and oversized requests', async () => {
    const intake = createAdoptionIntake({
      store: createMemoryRegistrationStore(),
      secret: 'test-only-pepper-with-at-least-32-characters',
      now: fixedNow,
    });
    const insecure = await intake(
      new globalThis.Request('http://intake.test/v1/registrations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
    );
    const oversized = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, padding: 'x'.repeat(4096) }),
      }),
    );

    expect(insecure.status).toBe(400);
    expect(oversized.status).toBe(413);
  });

  it('rejects query parameters and non-JSON registration bodies', async () => {
    const intake = createAdoptionIntake({
      store: createMemoryRegistrationStore(),
      secret: 'test-only-pepper-with-at-least-32-characters',
      now: fixedNow,
    });
    const withQuery = await intake(
      new globalThis.Request('https://intake.test/v1/registrations?token=forbidden', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
    );
    const textBody = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'text/plain' },
        body: JSON.stringify(payload),
      }),
    );

    expect(withQuery.status).toBe(400);
    expect(textBody.status).toBe(415);
  });

  it('uses a non-enumerating denial for a wrong management capability', async () => {
    const store = createMemoryRegistrationStore();
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      now: fixedNow,
    });
    await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
    );
    const response = await intake(
      new globalThis.Request('https://intake.test/v1/registrations/status', {
        method: 'POST',
        headers: { ...headers, authorization: `Bearer ${'C'.repeat(43)}` },
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'registration_not_found' });
  });

  it('rate-limits repeated requests without retaining a raw IP address', async () => {
    const store = createMemoryRegistrationStore();
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      rateLimit: 2,
      now: fixedNow,
    });
    const request = () =>
      new globalThis.Request('https://intake.test/v1/registrations/status', {
        method: 'POST',
        headers: { ...headers, 'cf-connecting-ip': '203.0.113.42' },
      });

    expect((await intake(request())).status).toBe(404);
    expect((await intake(request())).status).toBe(404);
    expect((await intake(request())).status).toBe(429);
    expect(JSON.stringify(await store.inspectRateLimits())).not.toContain('203.0.113.42');
  });

  it('authenticates before maintenance and runs expiry purges on a bounded cadence', async () => {
    let current = new Date('2026-09-20T12:00:00.000Z');
    const store = createMemoryRegistrationStore();
    const originalPurge = store.purgeExpired.bind(store);
    store.purgeExpired = vi.fn(originalPurge);
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      aggregateToken: 'aggregate-read-token',
      now: () => current,
    });
    const aggregateRequest = (token) =>
      new globalThis.Request('https://intake.test/v1/aggregate', {
        headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '203.0.113.42' },
      });

    expect((await intake(aggregateRequest('wrong-token'))).status).toBe(404);
    expect(store.purgeExpired).not.toHaveBeenCalled();
    expect((await intake(aggregateRequest('aggregate-read-token'))).status).toBe(200);
    expect((await intake(aggregateRequest('aggregate-read-token'))).status).toBe(200);
    expect(store.purgeExpired).toHaveBeenCalledTimes(1);

    current = new Date('2026-09-20T12:05:00.000Z');
    expect((await intake(aggregateRequest('aggregate-read-token'))).status).toBe(200);
    expect(store.purgeExpired).toHaveBeenCalledTimes(2);
  });

  it('withdraws the active record and excludes it from the next aggregate', async () => {
    const store = createMemoryRegistrationStore();
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      aggregateToken: 'aggregate-read-token',
      aggregateThreshold: 5,
      now: fixedNow,
    });
    await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
    );
    const before = await intake(
      new globalThis.Request('https://intake.test/v1/aggregate', {
        headers: { authorization: 'Bearer aggregate-read-token' },
      }),
    );
    const removed = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'DELETE',
        headers,
      }),
    );
    const after = await intake(
      new globalThis.Request('https://intake.test/v1/aggregate', {
        headers: { authorization: 'Bearer aggregate-read-token' },
      }),
    );

    expect(await before.json()).toMatchObject({ activeRegistrations: null });
    expect(removed.status).toBe(204);
    expect(await after.json()).toMatchObject({ activeRegistrations: 0 });
    expect(await store.count()).toBe(0);
  });

  it('suppresses low-cardinality buckets and purges expired registrations', async () => {
    let current = new Date('2026-09-20T12:00:00.000Z');
    const store = createMemoryRegistrationStore();
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      aggregateToken: 'aggregate-read-token',
      aggregateThreshold: 5,
      now: () => current,
    });
    await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
    );
    let aggregate = await intake(
      new globalThis.Request('https://intake.test/v1/aggregate', {
        headers: { authorization: 'Bearer aggregate-read-token' },
      }),
    );
    expect(await aggregate.json()).toEqual({
      schemaVersion: 1,
      measuredAt: '2026-09-20T12:00:00.000Z',
      activeRegistrations: null,
      threshold: 5,
      sdkVersions: {},
      visibility: {},
    });

    current = new Date('2026-12-20T12:00:00.000Z');
    aggregate = await intake(
      new globalThis.Request('https://intake.test/v1/aggregate', {
        headers: { authorization: 'Bearer aggregate-read-token' },
      }),
    );
    expect((await aggregate.json()).activeRegistrations).toBe(0);
    expect(await store.count()).toBe(0);
  });

  it('blocks a captured registration replay after withdrawal', async () => {
    const store = createMemoryRegistrationStore();
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      now: fixedNow,
    });
    const registration = () =>
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

    expect((await intake(registration())).status).toBe(201);
    const withdrawn = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'DELETE',
        headers: { ...headers, 'x-adoption-request-id': 'D'.repeat(22) },
      }),
    );
    expect(withdrawn.status).toBe(204);
    expect((await intake(registration())).status).toBe(410);
    expect(await store.count()).toBe(0);
  });

  it('cannot resurrect a withdrawn registration when renewal is already in flight', async () => {
    const backingStore = createMemoryRegistrationStore();
    let releaseRenewal;
    let markRenewalEntered;
    let pauseUsed = true;
    const renewalEntered = new Promise((resolve) => {
      markRenewalEntered = resolve;
    });
    const mayFinishRenewal = new Promise((resolve) => {
      releaseRenewal = resolve;
    });
    const pauseRenewal = async () => {
      if (pauseUsed) return;
      pauseUsed = true;
      markRenewalEntered();
      await mayFinishRenewal;
    };
    const store = {
      ...backingStore,
      async find(key) {
        const registration = await backingStore.find(key);
        await pauseRenewal();
        return registration;
      },
      async upsertUnlessRevoked(registration) {
        await pauseRenewal();
        return backingStore.upsertUnlessRevoked(registration);
      },
    };
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      now: fixedNow,
    });
    const registration = (requestId) =>
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers: { ...headers, 'x-adoption-request-id': requestId },
        body: JSON.stringify(payload),
      });

    expect((await intake(registration('F'.repeat(22)))).status).toBe(201);
    pauseUsed = false;
    const renewal = intake(registration('G'.repeat(22)));
    await renewalEntered;
    const withdrawal = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'DELETE',
        headers: { ...headers, 'x-adoption-request-id': 'H'.repeat(22) },
      }),
    );
    releaseRenewal();

    expect(withdrawal.status).toBe(204);
    expect((await renewal).status).toBe(410);
    expect(await backingStore.count()).toBe(0);
    expect(await backingStore.inspectRevocations()).toHaveLength(1);
  });

  it('rejects stale protocol requests', async () => {
    const intake = createAdoptionIntake({
      store: createMemoryRegistrationStore(),
      secret: 'test-only-pepper-with-at-least-32-characters',
      now: fixedNow,
    });
    const response = await intake(
      new globalThis.Request('https://intake.test/v1/registrations/status', {
        method: 'POST',
        headers: { ...headers, 'x-adoption-requested-at': '2026-09-20T11:54:59.000Z' },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('enforces a minimum threshold of five and rounds released counts down', async () => {
    expect(() =>
      createAdoptionIntake({
        store: createMemoryRegistrationStore(),
        secret: 'test-only-pepper-with-at-least-32-characters',
        aggregateThreshold: 4,
      }),
    ).toThrow(/at least five/i);

    const store = createMemoryRegistrationStore();
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      aggregateToken: 'aggregate-read-token',
      aggregateThreshold: 5,
      now: fixedNow,
    });
    for (let index = 0; index < 6; index += 1) {
      const response = await intake(
        new globalThis.Request('https://intake.test/v1/registrations', {
          method: 'POST',
          headers: {
            ...headers,
            'x-adoption-registration-id': `${'A'.repeat(21)}${index}`,
            'x-adoption-request-id': `${'C'.repeat(21)}${index}`,
          },
          body: JSON.stringify({
            ...payload,
            visibility: index === 5 ? 'unindexed' : 'private',
          }),
        }),
      );
      expect(response.status).toBe(201);
    }
    const aggregate = await intake(
      new globalThis.Request('https://intake.test/v1/aggregate', {
        headers: { authorization: 'Bearer aggregate-read-token' },
      }),
    );
    expect(await aggregate.json()).toMatchObject({
      activeRegistrations: 5,
      sdkVersions: { 1.2: 5 },
      visibility: { private: 5 },
    });
  });
});
