import type { AddWeighInInput, WeightUnit } from '../types/weight.js';

const OFFSET_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

export interface GarminWeighInPayload {
  dateTimestamp: string;
  gmtTimestamp: string;
  unitKey: WeightUnit;
  sourceType: 'MANUAL';
  value: number;
}

export function buildWeighInPayload(input: AddWeighInInput): GarminWeighInPayload {
  if (!Number.isFinite(input.value) || input.value <= 0) {
    throw new RangeError('Weight value must be a finite positive number.');
  }
  if (input.unit !== 'kg' && input.unit !== 'lbs') {
    throw new RangeError('Weight unit must be "kg" or "lbs".');
  }

  const match = OFFSET_TIMESTAMP_PATTERN.exec(input.measuredAt);
  if (!match) {
    throw new RangeError('measuredAt must be an ISO-8601 timestamp with Z or a numeric offset.');
  }

  const [, calendarDate, time, fraction = ''] = match;
  const milliseconds = fraction.padEnd(3, '0').slice(0, 3);
  const dateTimestamp = `${calendarDate}T${time}.${milliseconds}`;
  const localDate = new Date(`${dateTimestamp}Z`);
  const instant = new Date(input.measuredAt);

  if (
    Number.isNaN(localDate.getTime()) ||
    localDate.toISOString().slice(0, -1) !== dateTimestamp ||
    Number.isNaN(instant.getTime())
  ) {
    throw new RangeError('measuredAt must contain a valid calendar date and time.');
  }

  return {
    dateTimestamp,
    gmtTimestamp: instant.toISOString().slice(0, -1),
    unitKey: input.unit,
    sourceType: 'MANUAL',
    value: input.value,
  };
}
