import type { HttpClient } from '../client/HttpClient.js';
import {
  bodyBatterySchema,
  heartRateSchema,
  hrvStatusSchema,
  stressSchema,
} from '../schemas/health.schema.js';
import type { BodyBattery, DateRange, HeartRate, HrvStatus, Stress } from '../types/health.js';
import { formatDate } from '../utils/dates.js';
import type { UserEndpoint } from './UserEndpoint.js';

export class HealthEndpoint {
  #http: HttpClient;
  #user: UserEndpoint;

  constructor(http: HttpClient, user: UserEndpoint) {
    this.#http = http;
    this.#user = user;
  }

  async getHeartRate(date: Date | string): Promise<HeartRate> {
    const displayName = await this.#user.getDisplayName();
    return this.#http.request(`/wellness-service/wellness/dailyHeartRate/${displayName}`, {
      query: { date: formatDate(date) },
      schema: heartRateSchema,
    });
  }

  getStress(date: Date | string): Promise<Stress> {
    const day = formatDate(date);
    return this.#http.request(`/wellness-service/wellness/dailyStress/${day}`, {
      query: { date: day },
      schema: stressSchema,
    });
  }

  getBodyBattery(dateOrRange: Date | string | DateRange): Promise<BodyBattery> {
    const range =
      typeof dateOrRange === 'object' && !(dateOrRange instanceof Date) && 'start' in dateOrRange
        ? { startDate: formatDate(dateOrRange.start), endDate: formatDate(dateOrRange.end) }
        : { startDate: formatDate(dateOrRange), endDate: formatDate(dateOrRange) };

    return this.#http.request('/wellness-service/wellness/bodyBattery/reports/daily', {
      query: range,
      schema: bodyBatterySchema,
    });
  }

  getHrvStatus(date: Date | string): Promise<HrvStatus> {
    return this.#http.request(`/hrv-service/hrv/${formatDate(date)}`, {
      schema: hrvStatusSchema,
    });
  }
}
