import { z } from 'zod';

const timestampNumberTupleSchema = z.tuple([z.number(), z.number().nullable()]);
const optionalZoneNumberSchema = z.number().finite().nullable().optional();
const optionalZoneStringSchema = z.string().nullable().optional();

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

export const heartRateZoneSchema = z
  .object({
    trainingMethod: optionalZoneStringSchema,
    sport: optionalZoneStringSchema,
    changeState: optionalZoneStringSchema,
    restingHrAutoUpdateUsed: z.boolean().nullable().optional(),
    restingHeartRateUsed: optionalZoneNumberSchema,
    lactateThresholdHeartRateUsed: optionalZoneNumberSchema,
    zone1Floor: optionalZoneNumberSchema,
    zone2Floor: optionalZoneNumberSchema,
    zone3Floor: optionalZoneNumberSchema,
    zone4Floor: optionalZoneNumberSchema,
    zone5Floor: optionalZoneNumberSchema,
    maxHeartRateUsed: optionalZoneNumberSchema,
  })
  .passthrough();

export const heartRateZonesSchema = z.array(heartRateZoneSchema);

export const powerZoneSchema = z
  .object({
    sport: optionalZoneStringSchema,
    changeState: optionalZoneStringSchema,
    functionalThresholdPower: optionalZoneNumberSchema,
    zone1Floor: optionalZoneNumberSchema,
    zone2Floor: optionalZoneNumberSchema,
    zone3Floor: optionalZoneNumberSchema,
    zone4Floor: optionalZoneNumberSchema,
    zone5Floor: optionalZoneNumberSchema,
    zone6Floor: optionalZoneNumberSchema,
    zone7Floor: optionalZoneNumberSchema,
  })
  .passthrough();

export const powerZonesSchema = z.array(powerZoneSchema);
