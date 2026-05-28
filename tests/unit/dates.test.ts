import { describe, expect, it } from 'vitest';

import { eachDate, formatDate } from '../../src/utils/dates.js';

describe('dates', () => {
  it('formats Date and YYYY-MM-DD strings', () => {
    // Arrange
    const date = new Date('2026-05-12T10:20:30.000Z');

    // Act
    const formattedDate = formatDate(date);
    const formattedString = formatDate('2026-05-12');

    // Assert
    expect(formattedDate).toBe('2026-05-12');
    expect(formattedString).toBe('2026-05-12');
  });

  it('rejects invalid dates', () => {
    // Arrange
    const invalidDate = new Date('not-a-date');

    // Act
    const invalidCalendarDate = () => formatDate('2026-02-30');
    const invalidFormat = () => formatDate('12-05-2026');
    const invalidDateObject = () => formatDate(invalidDate);

    // Assert
    expect(invalidCalendarDate).toThrow(RangeError);
    expect(invalidFormat).toThrow(RangeError);
    expect(invalidDateObject).toThrow(RangeError);
  });

  it('iterates inclusive ranges and rejects reversed ranges', () => {
    // Arrange
    const reversedRange = () => eachDate('2026-05-12', '2026-05-10');

    // Act
    const range = eachDate('2026-05-10', '2026-05-12');

    // Assert
    expect(range).toEqual(['2026-05-10', '2026-05-11', '2026-05-12']);
    expect(reversedRange).toThrow(RangeError);
  });

  it('keeps leap-day ranges valid when the calendar date exists', () => {
    // Act
    const range = eachDate('2028-02-28', '2028-03-01');

    // Assert
    expect(range).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });
});
