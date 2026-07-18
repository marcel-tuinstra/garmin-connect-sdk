import type { z } from 'zod';

import type {
  boundaryWeightSchema,
  dailyWeighInsSchema,
  dailyWeightSummarySchema,
  weighInRangeSchema,
  weighInSchema,
  weightAverageSchema,
} from '../schemas/weight.schema.js';

export type WeightUnit = 'kg' | 'lbs';

export interface AddWeighInInput {
  /** Weight expressed in `unit`. */
  value: number;
  unit: WeightUnit;
  /** ISO-8601 timestamp with an explicit `Z` or numeric offset. */
  measuredAt: string;
}

export interface RemoveWeighInInput {
  /** Calendar date returned with the weigh-in. */
  calendarDate: Date | string;
  /** Garmin's `samplePk` identifier returned by a weight GET. */
  samplePk: number | string;
}

export type WeighIn = z.infer<typeof weighInSchema>;
export type WeightAverage = z.infer<typeof weightAverageSchema>;
export type BoundaryWeight = z.infer<typeof boundaryWeightSchema>;
export type DailyWeighIns = z.infer<typeof dailyWeighInsSchema>;
export type DailyWeightSummary = z.infer<typeof dailyWeightSummarySchema>;
export type WeighInRange = z.infer<typeof weighInRangeSchema>;
