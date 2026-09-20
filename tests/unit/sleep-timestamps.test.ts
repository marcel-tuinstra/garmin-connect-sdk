import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../../src/auth/MemoryTokenStorage.js';
import { GarminConnectSDK } from '../../src/client/GarminConnectSDK.js';
import { GarminValidationError } from '../../src/client/GarminRequestError.js';
import type { DailySleep, SleepRange } from '../../src/index.js';
import { dailySleepSchema } from '../../src/schemas/sleep.schema.js';
import { jsonResponse, tokens } from '../helpers/garmin.js';

type SleepResponse = Response | Record<string, unknown>;

describe('sleep local timestamps', () => {
  it.each([
    ['string', '2026-05-11T22:30:00.0'],
    ['number', 1_778_538_600_000],
    ['null', null],
    ['missing', undefined],
  ])('preserves the %s representation through getDailySleep', async (_label, value) => {
    // Arrange
    const { garmin } = await restoredSdk({
      '2026-05-12': sleepPayload(value, value),
    });

    // Act
    const result = await garmin.sleep.getDailySleep('2026-05-12');
    const publicResult: DailySleep = result;

    // Assert
    expect(publicResult.dailySleepDTO?.sleepStartTimestampLocal).toBe(value);
    expect(publicResult.dailySleepDTO?.sleepEndTimestampLocal).toBe(value);
    if (value === undefined) {
      expect(publicResult.dailySleepDTO).not.toHaveProperty('sleepStartTimestampLocal');
      expect(publicResult.dailySleepDTO).not.toHaveProperty('sleepEndTimestampLocal');
    }
  });

  it('preserves supported representations and numeric boundaries through getSleepRange', async () => {
    // Arrange
    const { garmin } = await restoredSdk({
      '2026-05-10': sleepPayload('2026-05-09T22:30:00.0', '2026-05-10T06:30:00.0'),
      '2026-05-11': sleepPayload(0, Number.MAX_SAFE_INTEGER),
      '2026-05-12': sleepPayload(null, null),
      '2026-05-13': sleepPayload(undefined, undefined),
    });

    // Act
    const result = await garmin.sleep.getSleepRange('2026-05-10', '2026-05-13');
    const publicResult: SleepRange = result;

    // Assert
    expect(publicResult.map((day) => day.dailySleepDTO?.sleepStartTimestampLocal)).toEqual([
      '2026-05-09T22:30:00.0',
      0,
      null,
      undefined,
    ]);
    expect(publicResult.map((day) => day.dailySleepDTO?.sleepEndTimestampLocal)).toEqual([
      '2026-05-10T06:30:00.0',
      Number.MAX_SAFE_INTEGER,
      null,
      undefined,
    ]);
  });

  it.each([
    ['sleepStartTimestampLocal', { nested: true }],
    ['sleepEndTimestampLocal', false],
    ['sleepStartTimestampLocal', ['2026-05-11T22:30:00.0']],
  ] as const)('rejects an invalid %s through getDailySleep', async (field, value) => {
    // Arrange
    const { garmin } = await restoredSdk({
      '2026-05-12': {
        dailySleepDTO: {
          calendarDate: '2026-05-12',
          [field]: value,
        },
      },
    });

    // Act
    const error = await garmin.sleep.getDailySleep('2026-05-12').catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminValidationError);
    expect((error as GarminValidationError).issues).toContain(`dailySleepDTO.${field}`);
  });

  it('rejects non-finite numeric timestamps through getDailySleep', async () => {
    // Arrange
    const response = new Response(
      '{"dailySleepDTO":{"calendarDate":"2026-05-12","sleepStartTimestampLocal":1e400,"sleepEndTimestampLocal":-1e400}}',
      { headers: { 'content-type': 'application/json' } },
    );
    const { garmin } = await restoredSdk({ '2026-05-12': response });

    // Act
    const error = await garmin.sleep.getDailySleep('2026-05-12').catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminValidationError);
    expect((error as GarminValidationError).issues).toEqual([
      'dailySleepDTO.sleepStartTimestampLocal',
      'dailySleepDTO.sleepEndTimestampLocal',
    ]);
  });

  it('rejects NaN before it can enter the public sleep type', () => {
    expect(() => dailySleepSchema.parse(sleepPayload(Number.NaN, Number.NaN))).toThrow();
  });

  it('rejects an invalid one-day getSleepRange response without a partial result', async () => {
    // Arrange
    const { garmin } = await restoredSdk({
      '2026-05-11': sleepPayload({ invalid: true }, 1_778_481_000_000),
    });

    // Act
    const error = await garmin.sleep
      .getSleepRange('2026-05-11', '2026-05-11')
      .catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(GarminValidationError);
    expect((error as GarminValidationError).issues).toContain(
      'dailySleepDTO.sleepStartTimestampLocal',
    );
  });
});

function sleepPayload(start: unknown, end: unknown): Record<string, unknown> {
  return {
    dailySleepDTO: {
      calendarDate: '2026-05-12',
      sleepStartTimestampLocal: start,
      sleepEndTimestampLocal: end,
    },
  };
}

async function restoredSdk(responses: Record<string, SleepResponse>) {
  const storage = new MemoryTokenStorage();
  await storage.save(tokens({ displayName: 'runner' }));
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/userprofile-service/socialProfile') {
      return jsonResponse({ displayName: 'runner' });
    }

    const date = url.searchParams.get('date');
    const response = date ? responses[date] : undefined;
    if (!response) throw new Error(`Unexpected sleep request for ${date ?? 'missing date'}.`);
    return response instanceof Response ? response : jsonResponse(response);
  });
  const garmin = new GarminConnectSDK({ storage, fetch: fetchMock, maxRetries: 0 });
  await garmin.restoreSession();
  return { garmin, fetchMock };
}
