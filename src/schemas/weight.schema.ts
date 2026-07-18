import { z } from 'zod';

const nullableNumber = z.number().nullable().optional();
const nullableString = z.string().nullable().optional();
const identifierSchema = z.union([z.number(), z.string()]).nullable().optional();

export const weighInSchema = z
  .object({
    samplePk: identifierSchema,
    version: identifierSchema,
    date: nullableNumber,
    calendarDate: z.string(),
    weight: z.number(),
    bmi: nullableNumber,
    bodyFat: nullableNumber,
    bodyWater: nullableNumber,
    boneMass: nullableNumber,
    muscleMass: nullableNumber,
    physiqueRating: nullableNumber,
    visceralFat: nullableNumber,
    metabolicAge: nullableNumber,
    sourceType: z.string(),
    timestampGMT: z.number(),
    weightDelta: nullableNumber,
  })
  .passthrough()
  .refine((value) => value.samplePk != null || value.version != null, {
    message: 'A weigh-in must include samplePk or version.',
    path: ['samplePk'],
  });

export const weightAverageSchema = z
  .object({
    from: nullableNumber,
    until: nullableNumber,
    weight: nullableNumber,
    bmi: nullableNumber,
    bodyFat: nullableNumber,
    bodyWater: nullableNumber,
    boneMass: nullableNumber,
    muscleMass: nullableNumber,
    physiqueRating: nullableNumber,
    visceralFat: nullableNumber,
    metabolicAge: nullableNumber,
  })
  .passthrough();

export const boundaryWeightSchema = z
  .object({
    samplePk: identifierSchema,
    version: identifierSchema,
    date: nullableNumber,
    calendarDate: nullableString,
    weight: nullableNumber,
    sourceType: nullableString,
    timestampGMT: nullableNumber,
  })
  .passthrough();

export const dailyWeighInsSchema = z
  .object({
    startDate: nullableString,
    endDate: nullableString,
    dateWeightList: z.array(weighInSchema),
    totalAverage: weightAverageSchema.nullable().optional(),
  })
  .passthrough();

export const dailyWeightSummarySchema = z
  .object({
    summaryDate: nullableString,
    numOfWeightEntries: nullableNumber,
    minWeight: nullableNumber,
    maxWeight: nullableNumber,
    latestWeight: weighInSchema.nullable().optional(),
    allWeightMetrics: z.array(weighInSchema),
  })
  .passthrough();

export const weighInRangeSchema = z
  .object({
    dailyWeightSummaries: z.array(dailyWeightSummarySchema),
    totalAverage: weightAverageSchema.nullable().optional(),
    previousDateWeight: boundaryWeightSchema.nullable().optional(),
    nextDateWeight: boundaryWeightSchema.nullable().optional(),
  })
  .passthrough();
