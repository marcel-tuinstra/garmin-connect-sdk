import type { HttpClient } from '../client/HttpClient.js';
import { dailyWeighInsSchema, weighInRangeSchema } from '../schemas/weight.schema.js';
import type {
  AddWeighInInput,
  DailyWeighIns,
  RemoveWeighInInput,
  WeighInRange,
} from '../types/weight.js';
import { formatDate } from '../utils/dates.js';
import { buildWeighInPayload } from '../utils/weightPayload.js';

export class WeightEndpoint {
  #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  getDailyWeighIns(date: Date | string): Promise<DailyWeighIns> {
    const day = formatDate(date);
    return this.#http.request(`/weight-service/weight/dayview/${day}`, {
      query: { includeAll: true },
      schema: dailyWeighInsSchema,
      diagnosticPath: '/weight-service/weight/dayview/[REDACTED]',
    });
  }

  getWeighIns(start: Date | string, end: Date | string): Promise<WeighInRange> {
    const startDate = formatDate(start);
    const endDate = formatDate(end);
    if (startDate > endDate) {
      return Promise.reject(new RangeError('Start date must be before or equal to end date.'));
    }

    return this.#http.request(`/weight-service/weight/range/${startDate}/${endDate}`, {
      query: { includeAll: true },
      schema: weighInRangeSchema,
      diagnosticPath: '/weight-service/weight/range/[REDACTED]/[REDACTED]',
    });
  }

  /** Operationally experimental write. Public signature follows SemVer; repeated calls may duplicate. */
  async addWeighIn(input: AddWeighInInput): Promise<void> {
    await this.#http.request<void>('/weight-service/user-weight', {
      method: 'POST',
      body: buildWeighInPayload(input),
      retry: { maxRetries: 0 },
    });
  }

  /** Operationally experimental DELETE. Public signature follows SemVer; reconcile timeouts by GET. */
  async removeWeighIn(input: RemoveWeighInInput): Promise<void> {
    const calendarDate = formatDate(input.calendarDate);
    const samplePk = normalizeSamplePk(input.samplePk);

    await this.#http.request<void>(`/weight-service/weight/${calendarDate}/byversion/${samplePk}`, {
      method: 'DELETE',
      retry: { maxRetries: 0 },
      diagnosticPath: '/weight-service/weight/[REDACTED]/byversion/[REDACTED]',
    });
  }
}

function normalizeSamplePk(value: number | string): string {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return String(value);
  } else if (/^[1-9]\d*$/.test(value)) {
    return value;
  }

  throw new RangeError('samplePk must be a positive integer or digit string.');
}
