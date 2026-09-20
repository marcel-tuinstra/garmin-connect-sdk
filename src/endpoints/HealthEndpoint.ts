import type { HttpClient } from '../client/HttpClient.js';
import { GarminInputError } from '../client/GarminRequestError.js';
import {
  bodyBatterySchema,
  heartRateZonesSchema,
  heartRateSchema,
  hrvStatusSchema,
  powerZoneSchema,
  powerZonesSchema,
  stressSchema,
} from '../schemas/health.schema.js';
import type {
  BodyBattery,
  DateRange,
  HeartRate,
  HeartRateZones,
  HrvStatus,
  PowerZone,
  PowerZones,
  Stress,
} from '../types/health.js';
import { formatDate } from '../utils/dates.js';
import { encodePathSegment } from '../utils/pathSegments.js';
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
    const profileSegment = encodePathSegment(displayName, 'displayName');
    return this.#http.request(`/wellness-service/wellness/dailyHeartRate/${profileSegment}`, {
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

  getHeartRateZones(): Promise<HeartRateZones> {
    return this.#http.request('/biometric-service/heartRateZones', {
      schema: heartRateZonesSchema,
    });
  }

  getPowerZones(): Promise<PowerZones> {
    return this.#http.request('/biometric-service/powerZones/sports/all', {
      schema: powerZonesSchema,
    });
  }

  getPowerZonesForSport(sport: string): Promise<PowerZone> {
    const sportKey = encodePathSegment(normalizeSportKey(sport), 'sport');
    return this.#http.request(`/biometric-service/powerZones/sport/${sportKey}`, {
      schema: powerZoneSchema,
    });
  }
}

function normalizeSportKey(sport: unknown): string {
  if (typeof sport === 'string') {
    const trimmed = sport.trim();
    if (/^[A-Za-z]+(?:_[A-Za-z]+)*$/.test(trimmed)) return trimmed.toUpperCase();
  }

  throw new GarminInputError(
    'sport must be a Garmin sport key containing letter groups separated by underscores.',
    ['sport'],
  );
}
