import type { HttpClient } from '../client/HttpClient.js';
import { dailySleepSchema, sleepRangeSchema } from '../schemas/sleep.schema.js';
import type { DailySleep, SleepRange } from '../types/sleep.js';
import { eachDate, formatDate } from '../utils/dates.js';
import type { UserEndpoint } from './UserEndpoint.js';

/** Maximum daily sleep reads in flight for one range request. */
const SLEEP_RANGE_CONCURRENCY = 4;

export class SleepEndpoint {
  #http: HttpClient;
  #user: UserEndpoint;

  constructor(http: HttpClient, user: UserEndpoint) {
    this.#http = http;
    this.#user = user;
  }

  async getDailySleep(date: Date | string): Promise<DailySleep> {
    const displayName = await this.#user.getDisplayName();
    return this.#http.request(`/wellness-service/wellness/dailySleepData/${displayName}`, {
      query: {
        date: formatDate(date),
        nonSleepBufferMinutes: 60,
      },
      schema: dailySleepSchema,
    });
  }

  async getSleepRange(start: Date | string, end: Date | string): Promise<SleepRange> {
    const dates = eachDate(start, end);
    await this.#user.getDisplayName();

    const days = new Array<DailySleep>(dates.length);
    let nextIndex = 0;
    let stopped = false;
    let firstError: unknown;

    const worker = async (): Promise<void> => {
      while (!stopped) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= dates.length) return;

        try {
          days[index] = await this.getDailySleep(dates[index]!);
        } catch (error) {
          if (!stopped) {
            stopped = true;
            firstError = error;
          }
          throw firstError;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SLEEP_RANGE_CONCURRENCY, dates.length) }, () => worker()),
    );
    return sleepRangeSchema.parse(days);
  }
}
