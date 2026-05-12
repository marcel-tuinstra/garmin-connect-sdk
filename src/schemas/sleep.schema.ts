import { z } from 'zod';

export const dailySleepSchema = z
  .object({
    dailySleepDTO: z
      .object({
        calendarDate: z.string().optional(),
        sleepStartTimestampLocal: z.string().optional(),
        sleepEndTimestampLocal: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const sleepRangeSchema = z.array(dailySleepSchema);
