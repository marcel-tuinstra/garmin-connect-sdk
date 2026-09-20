import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { createAdoptionIntake } from '../../infra/adoption-intake/handler.mjs';
import { createSqliteRegistrationStore } from '../../infra/adoption-intake/sqlite-store.mjs';

describe('adoption intake SQLite store', () => {
  it('persists only hashed capabilities and supports aggregate deletion', async () => {
    const database = new DatabaseSync(':memory:');
    const execCalls = [];
    const store = createSqliteRegistrationStore({
      exec(statement) {
        execCalls.push(statement);
        return database.exec(statement);
      },
      prepare(statement) {
        return database.prepare(statement);
      },
    });
    const intake = createAdoptionIntake({
      store,
      secret: 'test-only-pepper-with-at-least-32-characters',
      aggregateToken: 'aggregate-read-token',
      aggregateThreshold: 5,
      now: () => new Date('2026-09-20T12:00:00.000Z'),
    });
    const headers = {
      authorization: `Bearer ${'B'.repeat(43)}`,
      'content-type': 'application/json',
      'x-adoption-registration-id': 'A'.repeat(22),
      'x-adoption-request-id': 'C'.repeat(22),
      'x-adoption-requested-at': '2026-09-20T12:00:00.000Z',
    };
    const body = JSON.stringify({
      schemaVersion: 1,
      consentVersion: 1,
      consent: true,
      sdkVersion: '1.2.0',
      visibility: 'private-unindexed',
    });

    expect(
      (
        await intake(
          new globalThis.Request('https://intake.test/v1/registrations', {
            method: 'POST',
            headers,
            body,
          }),
        )
      ).status,
    ).toBe(201);
    const raw = JSON.stringify(database.prepare('SELECT * FROM registrations').all());
    expect(raw).not.toContain('A'.repeat(22));
    expect(raw).not.toContain('B'.repeat(43));

    const aggregate = await intake(
      new globalThis.Request('https://intake.test/v1/aggregate', {
        headers: { authorization: 'Bearer aggregate-read-token' },
      }),
    );
    expect(await aggregate.json()).toMatchObject({
      activeRegistrations: null,
      sdkVersions: {},
      visibility: {},
    });

    expect(
      (
        await intake(
          new globalThis.Request('https://intake.test/v1/registrations', {
            method: 'DELETE',
            headers,
          }),
        )
      ).status,
    ).toBe(204);
    expect(database.prepare('SELECT COUNT(*) AS count FROM registrations').get().count).toBe(0);
    const revocations = database.prepare('SELECT * FROM revocations').all();
    expect(revocations).toHaveLength(1);
    expect(JSON.stringify(revocations)).not.toContain('A'.repeat(22));
    expect(JSON.stringify(revocations)).not.toContain('B'.repeat(43));
    expect(execCalls).toContain('PRAGMA wal_checkpoint(TRUNCATE)');

    const idempotentDelete = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'DELETE',
        headers: { ...headers, 'x-adoption-request-id': 'D'.repeat(22) },
      }),
    );
    expect(idempotentDelete.status).toBe(204);

    const replayedCreate = await intake(
      new globalThis.Request('https://intake.test/v1/registrations', {
        method: 'POST',
        headers: { ...headers, 'x-adoption-request-id': 'E'.repeat(22) },
        body,
      }),
    );
    expect(replayedCreate.status).toBe(410);
    expect(database.prepare('SELECT COUNT(*) AS count FROM registrations').get().count).toBe(0);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'rate_limits_window_start'",
        )
        .get(),
    ).toEqual({ name: 'rate_limits_window_start' });
  });
});
