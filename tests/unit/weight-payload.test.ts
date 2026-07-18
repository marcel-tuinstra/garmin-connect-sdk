import { describe, expect, it } from 'vitest';

import { buildWeighInPayload } from '../../src/utils/weightPayload.js';

describe('weight payload', () => {
  it('builds deterministic local and GMT timestamps from an offset ISO timestamp', () => {
    // Act
    const payload = buildWeighInPayload({
      value: 75.4,
      unit: 'kg',
      measuredAt: '2026-07-18T14:30:00.123+02:00',
    });

    // Assert
    expect(payload).toEqual({
      dateTimestamp: '2026-07-18T14:30:00.123',
      gmtTimestamp: '2026-07-18T12:30:00.123',
      unitKey: 'kg',
      sourceType: 'MANUAL',
      value: 75.4,
    });
  });

  it('distinguishes the repeated local hour across a DST transition', () => {
    // Act
    const summerOffset = buildWeighInPayload({
      value: 80,
      unit: 'kg',
      measuredAt: '2026-10-25T02:30:00.000+02:00',
    });
    const winterOffset = buildWeighInPayload({
      value: 80,
      unit: 'kg',
      measuredAt: '2026-10-25T02:30:00.000+01:00',
    });

    // Assert
    expect(summerOffset.dateTimestamp).toBe(winterOffset.dateTimestamp);
    expect(summerOffset.gmtTimestamp).toBe('2026-10-25T00:30:00.000');
    expect(winterOffset.gmtTimestamp).toBe('2026-10-25T01:30:00.000');
  });

  it('normalizes missing fractional seconds to milliseconds', () => {
    // Act
    const payload = buildWeighInPayload({
      value: 184.3,
      unit: 'lbs',
      measuredAt: '2026-07-18T14:30:00Z',
    });

    // Assert
    expect(payload.dateTimestamp).toBe('2026-07-18T14:30:00.000');
    expect(payload.gmtTimestamp).toBe('2026-07-18T14:30:00.000');
  });

  it.each([
    { value: 0, unit: 'kg', measuredAt: '2026-07-18T14:30:00+02:00' },
    { value: -1, unit: 'kg', measuredAt: '2026-07-18T14:30:00+02:00' },
    { value: Number.NaN, unit: 'kg', measuredAt: '2026-07-18T14:30:00+02:00' },
    { value: Number.POSITIVE_INFINITY, unit: 'kg', measuredAt: '2026-07-18T14:30:00+02:00' },
    { value: 80, unit: 'stone', measuredAt: '2026-07-18T14:30:00+02:00' },
    { value: 80, unit: 'kg', measuredAt: '2026-07-18T14:30:00' },
    { value: 80, unit: 'kg', measuredAt: 'not-a-date' },
  ])('rejects invalid input before making a request: $value $unit $measuredAt', (input) => {
    // Act
    const build = () => buildWeighInPayload(input as any);

    // Assert
    expect(build).toThrow();
  });
});
