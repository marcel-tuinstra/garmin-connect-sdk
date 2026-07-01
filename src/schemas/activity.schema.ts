import { z } from 'zod';

const numberOrStringSchema = z.union([z.number(), z.string()]);

const activityTypeSchema = z
  .object({
    typeKey: z.string().min(1).optional(),
  })
  .passthrough();

export const activitySummarySchema = z
  .object({
    activityId: numberOrStringSchema,
    activityName: z.string().optional(),
    activityType: activityTypeSchema.optional(),
    startTimeLocal: z.string().optional(),
    duration: z.number().optional(),
    distance: z.number().optional(),
  })
  .passthrough();

export const activityListSchema = z.array(activitySummarySchema);

export const activityCountSchema = z
  .object({
    totalCount: z.number(),
  })
  .passthrough();

export const activityTypesSchema = z.record(z.unknown());

export const activityDetailSchema = z
  .object({
    activityId: numberOrStringSchema,
    activityName: z.string().optional(),
    activityType: activityTypeSchema.optional(),
    summaryDTO: z
      .object({
        distance: z.number().nullable().optional(),
        duration: z.number().nullable().optional(),
        startTimeLocal: z.string().nullable().optional(),
        averageHR: z.number().nullable().optional(),
        maxHR: z.number().nullable().optional(),
        averageSpeed: z.number().nullable().optional(),
        maxSpeed: z.number().nullable().optional(),
        calories: z.number().nullable().optional(),
        trainingEffect: z.number().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const activityDetailsPayloadSchema = z.record(z.unknown());
export const activitySplitSchema = z.record(z.unknown());
export const activitySplitsSchema = z.array(activitySplitSchema).or(z.record(z.unknown()));
