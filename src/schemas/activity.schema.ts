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

export const activityDetailSchema = z
  .object({
    activityId: numberOrStringSchema,
    activityName: z.string().optional(),
    activityType: activityTypeSchema.optional(),
  })
  .passthrough();

export const activityDetailsPayloadSchema = z.record(z.unknown());
export const activitySplitSchema = z.record(z.unknown());
export const activitySplitsSchema = z.array(activitySplitSchema).or(z.record(z.unknown()));
