import { z } from 'zod';

export const heartRateSchema = z
  .object({
    userProfilePK: z.number().optional(),
    calendarDate: z.string().optional(),
    heartRateValues: z.array(z.tuple([z.number(), z.number().nullable()])).optional(),
  })
  .passthrough();

export const stressSchema = z
  .object({
    calendarDate: z.string().optional(),
  })
  .passthrough();

export const bodyBatterySchema = z.array(z.record(z.unknown())).or(z.record(z.unknown()));

export const hrvStatusSchema = z.record(z.unknown());
