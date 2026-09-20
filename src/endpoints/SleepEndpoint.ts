import type { HttpClient } from '../client/HttpClient.js';
import { dailySleepSchema, sleepRangeSchema } from '../schemas/sleep.schema.js';
import type { DailySleep, SleepRange } from '../types/sleep.js';
import { eachDate, formatDate } from '../utils/dates.js';
import { encodePathSegment } from '../utils/pathSegments.js';
import type { UserEndpoint } from './UserEndpoint.js';

export class SleepEndpoint {
  #http: HttpClient;
  #user: UserEndpoint;

  constructor(http: HttpClient, user: UserEndpoint) {
    this.#http = http;
    this.#user = user;
  }

  async getDailySleep(date: Date | string): Promise<DailySleep> {
    const displayName = await this.#user.getDisplayName();
    const profileSegment = encodePathSegment(displayName, 'displayName');
    return this.#http.request(`/wellness-service/wellness/dailySleepData/${profileSegment}`, {
      query: {
        date: formatDate(date),
        nonSleepBufferMinutes: 60,
      },
      schema: dailySleepSchema,
    });
  }

  async getSleepRange(start: Date | string, end: Date | string): Promise<SleepRange> {
    const days = await Promise.all(eachDate(start, end).map((date) => this.getDailySleep(date)));
    return sleepRangeSchema.parse(days);
  }
}
