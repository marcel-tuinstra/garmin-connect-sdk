import type { z } from 'zod';
import type {
  bodyBatterySchema,
  heartRateZoneSchema,
  heartRateZonesSchema,
  heartRateSchema,
  hrvStatusSchema,
  powerZoneSchema,
  powerZonesSchema,
  stressSchema,
} from '../schemas/health.schema.js';

export type HeartRate = z.infer<typeof heartRateSchema>;
export type Stress = z.infer<typeof stressSchema>;
export type BodyBattery = z.infer<typeof bodyBatterySchema>;
export type HrvStatus = z.infer<typeof hrvStatusSchema>;
export type HeartRateZone = z.infer<typeof heartRateZoneSchema>;
export type HeartRateZones = z.infer<typeof heartRateZonesSchema>;
export type PowerZone = z.infer<typeof powerZoneSchema>;
export type PowerZones = z.infer<typeof powerZonesSchema>;

export interface DateRange {
  start: Date | string;
  end: Date | string;
}
