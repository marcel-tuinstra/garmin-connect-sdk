import type { z } from 'zod';
import type { dailySleepSchema, sleepRangeSchema } from '../schemas/sleep.schema.js';

export type DailySleep = z.infer<typeof dailySleepSchema>;
export type SleepRange = z.infer<typeof sleepRangeSchema>;
