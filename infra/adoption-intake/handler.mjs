import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

const BODY_LIMIT = 4096;
const FRESHNESS_DAYS = 90;
const REQUEST_SKEW_MS = 5 * 60_000;
const REVOCATION_TTL_MS = 24 * 60 * 60_000;
const PURGE_INTERVAL_MS = 5 * 60_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const VISIBILITIES = new Set(['private', 'unindexed', 'private-unindexed']);
const PAYLOAD_KEYS = ['consent', 'consentVersion', 'schemaVersion', 'sdkVersion', 'visibility'];

export function createAdoptionIntake({
  store,
  secret,
  aggregateToken = '',
  aggregateThreshold = 5,
  rateLimit = 30,
  now = () => new Date(),
}) {
  if (!store || typeof secret !== 'string' || secret.length < 32) {
    throw new Error('A registration store and secret of at least 32 characters are required.');
  }
  if (!Number.isSafeInteger(aggregateThreshold) || aggregateThreshold < 5) {
    throw new Error('Aggregate threshold must be an integer of at least five.');
  }
  if (!Number.isSafeInteger(rateLimit) || rateLimit < 1) {
    throw new Error('Rate limit must be a positive integer.');
  }
  let nextPurgeAt = 0;

  const purgeIfDue = async (timestamp) => {
    if (timestamp.getTime() < nextPurgeAt) return;
    nextPurgeAt = timestamp.getTime() + PURGE_INTERVAL_MS;
    try {
      await store.purgeExpired(timestamp.toISOString());
    } catch (error) {
      nextPurgeAt = 0;
      throw error;
    }
  };

  return async function handle(request) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return json({ error: 'https_required' }, 400);
    if (url.search || url.hash) return json({ error: 'query_not_allowed' }, 400);
    const timestamp = now();

    if (url.pathname === '/v1/aggregate' && request.method === 'GET') {
      if (!aggregateToken || !safeEqual(bearer(request), aggregateToken)) {
        return json({ error: 'not_found' }, 404);
      }
      if (!(await consumeRateLimit(request, store, secret, timestamp, rateLimit))) {
        return json({ error: 'rate_limited' }, 429, { 'retry-after': '3600' });
      }
      await purgeIfDue(timestamp);
      const measuredAt = timestamp.toISOString();
      const aggregate = await store.aggregate(measuredAt);
      return json(thresholdAggregate(aggregate, aggregateThreshold, measuredAt), 200);
    }

    if (!(await consumeRateLimit(request, store, secret, timestamp, rateLimit))) {
      return json({ error: 'rate_limited' }, 429, { 'retry-after': '3600' });
    }

    if (!validProtocolMetadata(request, timestamp)) {
      return json({ error: 'invalid_request_metadata' }, 400);
    }

    if (url.pathname === '/v1/registrations/status' && request.method === 'POST') {
      const credentials = credentialsFor(request, secret);
      if (!credentials) return registrationNotFound();
      await purgeIfDue(timestamp);
      const registration = await store.find(credentials.registrationKey);
      if (!registration || !safeEqual(registration.capabilityHash, credentials.capabilityHash)) {
        return registrationNotFound();
      }
      return json({ status: 'active', expiresAt: registration.expiresAt }, 200);
    }

    if (url.pathname !== '/v1/registrations') return json({ error: 'not_found' }, 404);
    const credentials = credentialsFor(request, secret);
    if (!credentials) return registrationNotFound();

    if (request.method === 'DELETE') {
      await purgeIfDue(timestamp);
      const revoked = await store.findRevocation(credentials.registrationKey);
      if (revoked) {
        if (!safeEqual(revoked.capabilityHash, credentials.capabilityHash)) {
          return registrationNotFound();
        }
        await store.checkpoint?.();
        return noContent();
      }
      const existing = await store.find(credentials.registrationKey);
      if (!existing || !safeEqual(existing.capabilityHash, credentials.capabilityHash)) {
        return registrationNotFound();
      }
      await store.revoke({
        registrationKey: credentials.registrationKey,
        capabilityHash: credentials.capabilityHash,
        revokedAt: timestamp.toISOString(),
        expiresAt: new Date(timestamp.getTime() + REVOCATION_TTL_MS).toISOString(),
      });
      return noContent();
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
      return json({ error: 'json_required' }, 415);
    }

    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > BODY_LIMIT) return json({ error: 'payload_too_large' }, 413);
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > BODY_LIMIT) {
      return json({ error: 'payload_too_large' }, 413);
    }
    const payload = parsePayload(text);
    if (!payload) return json({ error: 'invalid_payload' }, 400);

    await purgeIfDue(timestamp);
    const expiresAt = new Date(timestamp.getTime() + FRESHNESS_DAYS * 86_400_000).toISOString();
    const result = await store.upsertUnlessRevoked({
      registrationKey: credentials.registrationKey,
      capabilityHash: credentials.capabilityHash,
      sdkVersion: payload.sdkVersion,
      visibility: payload.visibility,
      consentVersion: payload.consentVersion,
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
      expiresAt,
    });
    if (result.status === 'revoked') return json({ error: 'registration_revoked' }, 410);
    if (result.status === 'conflict') return registrationNotFound();
    return json({ status: 'active', expiresAt }, result.status === 'renewed' ? 200 : 201);
  };
}

async function consumeRateLimit(request, store, secret, timestamp, limit) {
  const rateKey = digest(
    secret,
    `rate:${request.headers.get('cf-connecting-ip') ?? request.headers.get('x-adoption-registration-id') ?? 'unknown'}`,
  );
  const windowStart = new Date(
    Math.floor(timestamp.getTime() / 3_600_000) * 3_600_000,
  ).toISOString();
  return store.consumeRateLimit(rateKey, windowStart, limit);
}

export function createMemoryRegistrationStore() {
  const registrations = new Map();
  const rateLimits = new Map();
  const revocations = new Map();
  return {
    async find(key) {
      return globalThis.structuredClone(registrations.get(key) ?? null);
    },
    async upsertUnlessRevoked(registration) {
      const revoked = revocations.get(registration.registrationKey);
      if (revoked) {
        return {
          status: safeEqual(revoked.capabilityHash, registration.capabilityHash)
            ? 'revoked'
            : 'conflict',
        };
      }
      const existing = registrations.get(registration.registrationKey);
      if (existing && !safeEqual(existing.capabilityHash, registration.capabilityHash)) {
        return { status: 'conflict' };
      }
      registrations.set(
        registration.registrationKey,
        globalThis.structuredClone({
          ...registration,
          createdAt: existing?.createdAt ?? registration.createdAt,
        }),
      );
      return { status: existing ? 'renewed' : 'created' };
    },
    async remove(key) {
      registrations.delete(key);
    },
    async findRevocation(key) {
      return globalThis.structuredClone(revocations.get(key) ?? null);
    },
    async revoke(revocation) {
      registrations.delete(revocation.registrationKey);
      revocations.set(revocation.registrationKey, globalThis.structuredClone(revocation));
    },
    async checkpoint() {},
    async purgeExpired(referenceTime) {
      for (const [key, value] of registrations) {
        if (value.expiresAt <= referenceTime) registrations.delete(key);
      }
      for (const [key, value] of rateLimits) {
        if (Date.parse(value.windowStart) + 3_600_000 <= Date.parse(referenceTime)) {
          rateLimits.delete(key);
        }
      }
      for (const [key, value] of revocations) {
        if (value.expiresAt <= referenceTime) revocations.delete(key);
      }
    },
    async consumeRateLimit(key, windowStart, limit) {
      const composite = `${key}:${windowStart}`;
      const current = rateLimits.get(composite) ?? { key, windowStart, hits: 0 };
      current.hits += 1;
      rateLimits.set(composite, current);
      return current.hits <= limit;
    },
    async aggregate() {
      const values = [...registrations.values()];
      return {
        activeRegistrations: values.length,
        sdkVersions: counts(
          values.map(({ sdkVersion }) => sdkVersion.split('.').slice(0, 2).join('.')),
        ),
        visibility: counts(values.map(({ visibility }) => visibility)),
      };
    },
    async count() {
      return registrations.size;
    },
    async inspect() {
      return globalThis.structuredClone([...registrations.values()]);
    },
    async inspectRateLimits() {
      return globalThis.structuredClone([...rateLimits.values()]);
    },
    async inspectRevocations() {
      return globalThis.structuredClone([...revocations.values()]);
    },
  };
}

function credentialsFor(request, secret) {
  const registrationId = request.headers.get('x-adoption-registration-id') ?? '';
  const managementToken = bearer(request);
  if (!ID_PATTERN.test(registrationId) || !TOKEN_PATTERN.test(managementToken)) return null;
  return {
    registrationKey: digest(secret, `registration:${registrationId}`),
    capabilityHash: digest(secret, `capability:${managementToken}`),
  };
}

function validProtocolMetadata(request, now) {
  const requestId = request.headers.get('x-adoption-request-id') ?? '';
  const requestedAt = request.headers.get('x-adoption-requested-at') ?? '';
  const requestedTime = Date.parse(requestedAt);
  return (
    ID_PATTERN.test(requestId) &&
    Number.isFinite(requestedTime) &&
    Math.abs(now.getTime() - requestedTime) <= REQUEST_SKEW_MS
  );
}

function parsePayload(text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = Object.keys(value).sort();
    if (
      keys.length !== PAYLOAD_KEYS.length ||
      keys.some((key, index) => key !== PAYLOAD_KEYS[index])
    ) {
      return null;
    }
    if (value.schemaVersion !== 1 || value.consentVersion !== 1 || value.consent !== true) {
      return null;
    }
    if (
      typeof value.sdkVersion !== 'string' ||
      value.sdkVersion.length > 64 ||
      !VERSION_PATTERN.test(value.sdkVersion) ||
      !VISIBILITIES.has(value.visibility)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function thresholdAggregate(aggregate, threshold, measuredAt) {
  const active = aggregate.activeRegistrations;
  return {
    schemaVersion: 1,
    measuredAt,
    activeRegistrations: releasedCount(active, threshold),
    threshold,
    sdkVersions: thresholdBuckets(aggregate.sdkVersions, threshold),
    visibility: thresholdBuckets(aggregate.visibility, threshold),
  };
}

function thresholdBuckets(buckets, threshold) {
  return Object.fromEntries(
    Object.entries(buckets)
      .map(([key, value]) => [key, releasedCount(value, threshold)])
      .filter(([, value]) => value !== null && value > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function releasedCount(value, threshold) {
  if (value === 0) return 0;
  if (value < threshold) return null;
  return Math.floor(value / threshold) * threshold;
}

function counts(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function bearer(request) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? '';
}

function digest(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function registrationNotFound() {
  return json({ error: 'registration_not_found' }, 404);
}

function json(body, status, extraHeaders = {}) {
  return globalThis.Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function noContent() {
  return new globalThis.Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
