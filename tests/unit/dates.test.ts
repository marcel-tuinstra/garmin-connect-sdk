import { describe, expect, it } from 'vitest';

import { eachDate, formatDate } from '../../src/utils/dates.js';

describe('dates', () => {
  it('formats Date and YYYY-MM-DD strings', () => {
    expect(formatDate(new Date('2026-05-12T10:20:30.000Z'))).toBe('2026-05-12');
    expect(formatDate('2026-05-12')).toBe('2026-05-12');
  });

  it('rejects invalid dates', () => {
    expect(() => formatDate('2026-02-30')).toThrow(RangeError);
    expect(() => formatDate('12-05-2026')).toThrow(RangeError);
  });

  it('iterates inclusive ranges and rejects reversed ranges', () => {
    expect(eachDate('2026-05-10', '2026-05-12')).toEqual([
      '2026-05-10',
      '2026-05-11',
      '2026-05-12',
    ]);
    expect(() => eachDate('2026-05-12', '2026-05-10')).toThrow(RangeError);
  });
});
