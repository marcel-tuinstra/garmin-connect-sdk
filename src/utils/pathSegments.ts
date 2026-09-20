import { GarminInputError } from '../client/GarminRequestError.js';

export function positiveIntegerPathSegment(value: unknown, field: string): string {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return String(value);
  } else if (typeof value === 'string' && /^\d+$/.test(value) && !/^0+$/.test(value)) {
    return value;
  }

  throw invalidPathSegment(field, 'must be a positive integer');
}

export function encodePathSegment(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value === '.' || value === '..') {
    throw invalidPathSegment(field, 'must be a non-empty, non-traversal string');
  }

  try {
    return encodeURIComponent(value);
  } catch {
    throw invalidPathSegment(field, 'contains invalid Unicode');
  }
}

function invalidPathSegment(field: string, reason: string): GarminInputError {
  return new GarminInputError(`${field} ${reason}.`, [field]);
}
