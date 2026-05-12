import { z } from 'zod';

export const activitySummarySchema = z
  .object({
    activityId: z.union([z.number(), z.string()]),
    activityName: z.string().optional(),
    activityType: z
      .object({
        typeKey: z.string().optional(),
      })
      .passthrough()
      .optional(),
    startTimeLocal: z.string().optional(),
  })
  .passthrough();

export const activityListSchema = z.array(activitySummarySchema);

export const activityDetailSchema = z
  .object({
    activityId: z.union([z.number(), z.string()]),
  })
  .passthrough();

export const activityDetailsPayloadSchema = z.unknown();
export const activitySplitsSchema = z.unknown();
