import type { z } from 'zod';
import type {
  bodyBatterySchema,
  heartRateSchema,
  hrvStatusSchema,
  stressSchema,
} from '../schemas/health.schema.js';

export type HeartRate = z.infer<typeof heartRateSchema>;
export type Stress = z.infer<typeof stressSchema>;
export type BodyBattery = z.infer<typeof bodyBatterySchema>;
export type HrvStatus = z.infer<typeof hrvStatusSchema>;

export interface DateRange {
  start: Date | string;
  end: Date | string;
}
