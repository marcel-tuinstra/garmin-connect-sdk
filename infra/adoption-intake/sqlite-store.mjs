import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

export function createSqliteRegistrationStore(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS registrations (
      registration_key TEXT PRIMARY KEY,
      capability_hash TEXT NOT NULL,
      sdk_version TEXT NOT NULL,
      visibility TEXT NOT NULL,
      consent_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS registrations_expires_at ON registrations(expires_at);
    CREATE TABLE IF NOT EXISTS rate_limits (
      rate_key TEXT NOT NULL,
      window_start TEXT NOT NULL,
      hits INTEGER NOT NULL,
      PRIMARY KEY (rate_key, window_start)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS rate_limits_window_start ON rate_limits(window_start);
    CREATE TABLE IF NOT EXISTS revocations (
      registration_key TEXT PRIMARY KEY,
      capability_hash TEXT NOT NULL,
      revoked_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS revocations_expires_at ON revocations(expires_at);
  `);

  const find = database.prepare(`
    SELECT registration_key, capability_hash, sdk_version, visibility,
           consent_version, created_at, updated_at, expires_at
      FROM registrations
     WHERE registration_key = ?
  `);
  const upsert = database.prepare(`
    INSERT INTO registrations (
      registration_key, capability_hash, sdk_version, visibility,
      consent_version, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(registration_key) DO UPDATE SET
      capability_hash = excluded.capability_hash,
      sdk_version = excluded.sdk_version,
      visibility = excluded.visibility,
      consent_version = excluded.consent_version,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `);
  const remove = database.prepare('DELETE FROM registrations WHERE registration_key = ?');
  const purgeRegistrations = database.prepare('DELETE FROM registrations WHERE expires_at <= ?');
  const findRevocation = database.prepare(`
    SELECT registration_key, capability_hash, revoked_at, expires_at
      FROM revocations
     WHERE registration_key = ?
  `);
  const upsertRevocation = database.prepare(`
    INSERT INTO revocations (registration_key, capability_hash, revoked_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(registration_key) DO UPDATE SET
      capability_hash = excluded.capability_hash,
      revoked_at = excluded.revoked_at,
      expires_at = excluded.expires_at
  `);
  const purgeRevocations = database.prepare('DELETE FROM revocations WHERE expires_at <= ?');
  const purgeRateLimits = database.prepare('DELETE FROM rate_limits WHERE window_start < ?');
  const incrementRateLimit = database.prepare(`
    INSERT INTO rate_limits (rate_key, window_start, hits) VALUES (?, ?, 1)
    ON CONFLICT(rate_key, window_start) DO UPDATE SET hits = hits + 1
    RETURNING hits
  `);
  const aggregate = database.prepare('SELECT sdk_version, visibility FROM registrations');

  return {
    async findRegistration(key) {
      return rowToRegistration(find.get(key));
    },
    async find(key) {
      return rowToRegistration(find.get(key));
    },
    async upsertUnlessRevoked(registration) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const revoked = findRevocation.get(registration.registrationKey);
        if (revoked) {
          database.exec('COMMIT');
          return {
            status: safeEqual(revoked.capability_hash, registration.capabilityHash)
              ? 'revoked'
              : 'conflict',
          };
        }
        const existing = find.get(registration.registrationKey);
        if (existing && !safeEqual(existing.capability_hash, registration.capabilityHash)) {
          database.exec('COMMIT');
          return { status: 'conflict' };
        }
        upsert.run(
          registration.registrationKey,
          registration.capabilityHash,
          registration.sdkVersion,
          registration.visibility,
          registration.consentVersion,
          existing?.created_at ?? registration.createdAt,
          registration.updatedAt,
          registration.expiresAt,
        );
        database.exec('COMMIT');
        return { status: existing ? 'renewed' : 'created' };
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    async remove(key) {
      remove.run(key);
    },
    async findRevocation(key) {
      return revocationFromRow(findRevocation.get(key));
    },
    async revoke(revocation) {
      database.exec('BEGIN IMMEDIATE');
      try {
        upsertRevocation.run(
          revocation.registrationKey,
          revocation.capabilityHash,
          revocation.revokedAt,
          revocation.expiresAt,
        );
        remove.run(revocation.registrationKey);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      checkpoint(database);
    },
    async checkpoint() {
      checkpoint(database);
    },
    async purgeExpired(referenceTime) {
      purgeRegistrations.run(referenceTime);
      purgeRevocations.run(referenceTime);
      const priorWindow = new Date(Date.parse(referenceTime) - 3_600_000).toISOString();
      purgeRateLimits.run(priorWindow);
    },
    async consumeRateLimit(key, windowStart, limit) {
      return incrementRateLimit.get(key, windowStart).hits <= limit;
    },
    async aggregate() {
      const rows = aggregate.all();
      return {
        activeRegistrations: rows.length,
        sdkVersions: count(
          rows.map(({ sdk_version: version }) => version.split('.').slice(0, 2).join('.')),
        ),
        visibility: count(rows.map(({ visibility }) => visibility)),
      };
    },
  };
}

function revocationFromRow(row) {
  return row
    ? {
        registrationKey: row.registration_key,
        capabilityHash: row.capability_hash,
        revokedAt: row.revoked_at,
        expiresAt: row.expires_at,
      }
    : null;
}

function checkpoint(database) {
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function rowToRegistration(row) {
  return row
    ? {
        registrationKey: row.registration_key,
        capabilityHash: row.capability_hash,
        sdkVersion: row.sdk_version,
        visibility: row.visibility,
        consentVersion: row.consent_version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      }
    : null;
}

function count(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}
