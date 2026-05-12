const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(date: Date | string): string {
  if (typeof date === 'string') {
    if (!isValidDateString(date)) {
      throw new RangeError(`Invalid date string "${date}". Expected YYYY-MM-DD.`);
    }
    return date;
  }

  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid Date object.');
  }

  return date.toISOString().slice(0, 10);
}

export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === value;
}

export function eachDate(start: Date | string, end: Date | string): string[] {
  const startDate = formatDate(start);
  const endDate = formatDate(end);

  if (startDate > endDate) {
    throw new RangeError('Start date must be before or equal to end date.');
  }

  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const last = new Date(`${endDate}T00:00:00.000Z`);

  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}
