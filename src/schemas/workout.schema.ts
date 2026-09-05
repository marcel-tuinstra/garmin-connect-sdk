import { z } from 'zod';

const numberOrStringSchema = z.union([z.number(), z.string()]);

export const workoutSportTypeSchema = z
  .object({
    sportTypeId: z.number().optional(),
    sportTypeKey: z.string().optional(),
    displayOrder: z.number().optional(),
  })
  .passthrough();

const unitSchema = z
  .object({
    unitId: z.number().nullable().optional(),
    unitKey: z.string().nullable().optional(),
    factor: z.number().nullable().optional(),
  })
  .passthrough();

export const workoutSummarySchema = z
  .object({
    workoutId: numberOrStringSchema,
    ownerId: numberOrStringSchema.optional(),
    workoutName: z.string().optional(),
    description: z.string().nullable().optional(),
    createdDate: z.string().optional(),
    updatedDate: z.string().optional(),
    updateDate: z.string().optional(),
    sportType: workoutSportTypeSchema.optional(),
    estimatedDurationInSecs: z.number().nullable().optional(),
    estimatedDistanceInMeters: z.number().nullable().optional(),
    estimatedDistanceUnit: unitSchema.nullable().optional(),
  })
  .passthrough();

export const workoutStepSchema = z.record(z.unknown());

export const workoutSegmentSchema = z
  .object({
    segmentOrder: z.number().optional(),
    sportType: workoutSportTypeSchema.optional(),
    workoutSteps: z.array(workoutStepSchema).optional(),
  })
  .passthrough();

export const workoutSchema = workoutSummarySchema
  .extend({
    workoutSegments: z.array(workoutSegmentSchema).optional(),
  })
  .passthrough();

export const workoutListSchema = z.array(workoutSummarySchema);

export const workoutTypesSchema = z
  .object({
    workoutStepTypes: z.array(z.record(z.unknown())).optional(),
    workoutSportTypes: z.array(workoutSportTypeSchema).optional(),
    workoutConditionTypes: z.array(z.record(z.unknown())).optional(),
    workoutIntensityTypes: z.array(z.record(z.unknown())).optional(),
    workoutTargetTypes: z.array(z.record(z.unknown())).optional(),
    workoutEquipmentTypes: z.array(z.record(z.unknown())).optional(),
    workoutStrokeTypes: z.array(z.record(z.unknown())).optional(),
    workoutSwimInstructionTypes: z.array(z.record(z.unknown())).optional(),
    workoutDrillTypes: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const workoutScheduleSchema = z
  .object({
    workoutScheduleId: numberOrStringSchema.optional(),
    scheduleId: numberOrStringSchema.optional(),
    id: numberOrStringSchema.optional(),
    workoutId: numberOrStringSchema.optional(),
    calendarDate: z.string().optional(),
    date: z.string().optional(),
  })
  .passthrough();

export const calendarItemSchema = z
  .object({
    id: numberOrStringSchema.optional(),
    itemType: z.string().optional(),
    date: z.string().optional(),
    title: z.string().optional(),
    workoutId: numberOrStringSchema.nullable().optional(),
    workoutScheduleId: numberOrStringSchema.nullable().optional(),
    workout: workoutSummarySchema.optional(),
  })
  .passthrough();

export const calendarMonthSchema = z
  .object({
    startDayOfMonth: z.number().optional(),
    numOfDaysInMonth: z.number().optional(),
    numOfDaysInPrevMonth: z.number().optional(),
    month: z.number().optional(),
    year: z.number().optional(),
    calendarItems: z.array(calendarItemSchema).optional(),
  })
  .passthrough();
