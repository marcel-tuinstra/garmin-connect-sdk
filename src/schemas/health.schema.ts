import { z } from 'zod';

const timestampNumberTupleSchema = z.tuple([z.number(), z.number().nullable()]);

export const heartRateSchema = z
  .object({
    userProfilePK: z.number().optional(),
    calendarDate: z.string().optional(),
    heartRateValues: z.array(timestampNumberTupleSchema).optional(),
  })
  .passthrough();

export const stressSchema = z
  .object({
    calendarDate: z.string().optional(),
    stressValues: z.array(timestampNumberTupleSchema).optional(),
  })
  .passthrough();

export const bodyBatteryPointSchema = z
  .object({
    calendarDate: z.string().optional(),
    startTimestampGMT: z.string().nullable().optional(),
    endTimestampGMT: z.string().nullable().optional(),
    bodyBatteryValuesArray: z.array(timestampNumberTupleSchema).optional(),
  })
  .passthrough();

export const bodyBatterySchema = z.array(bodyBatteryPointSchema).or(bodyBatteryPointSchema);

export const hrvStatusSchema = z
  .object({
    calendarDate: z.string().optional(),
    hrvSummary: z.record(z.unknown()).optional(),
  })
  .passthrough();
