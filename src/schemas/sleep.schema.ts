import { z } from 'zod';

const sleepLevelSchema = z
  .object({
    startGMT: z.string().optional(),
    endGMT: z.string().optional(),
    activityLevel: z.number().optional(),
  })
  .passthrough();

export const dailySleepSchema = z
  .object({
    dailySleepDTO: z
      .object({
        calendarDate: z.string().optional(),
        sleepStartTimestampLocal: z.string().nullable().optional(),
        sleepEndTimestampLocal: z.string().nullable().optional(),
        sleepTimeSeconds: z.number().nullable().optional(),
        deepSleepSeconds: z.number().nullable().optional(),
        lightSleepSeconds: z.number().nullable().optional(),
        remSleepSeconds: z.number().nullable().optional(),
        awakeSleepSeconds: z.number().nullable().optional(),
      })
      .passthrough()
      .optional(),
    sleepLevels: z.array(sleepLevelSchema).optional(),
  })
  .passthrough();

export const sleepRangeSchema = z.array(dailySleepSchema);
