import type { z } from 'zod';
import type {
  calendarItemSchema,
  calendarMonthSchema,
  workoutListSchema,
  workoutScheduleSchema,
  workoutSchema,
  workoutSportTypeSchema,
  workoutSummarySchema,
  workoutTypesSchema,
} from '../schemas/workout.schema.js';

export type WorkoutSportType = z.infer<typeof workoutSportTypeSchema>;
export type WorkoutSummary = z.infer<typeof workoutSummarySchema>;
export type Workout = z.infer<typeof workoutSchema>;
export type WorkoutList = z.infer<typeof workoutListSchema>;
export type WorkoutTypes = z.infer<typeof workoutTypesSchema>;
export type WorkoutSchedule = z.infer<typeof workoutScheduleSchema>;
export type CalendarItem = z.infer<typeof calendarItemSchema>;
export type CalendarMonth = z.infer<typeof calendarMonthSchema>;

export type WorkoutSport = 'running' | 'cycling';
export type WorkoutStepKind = 'warmup' | 'interval' | 'recovery' | 'cooldown' | 'rest';

export type WorkoutStepTarget =
  | { type?: 'no_target' }
  | { type: 'heart_rate_zone'; zone: number }
  | { type: 'heart_rate'; min: number; max: number }
  | { type: 'power'; min: number; max: number }
  | { type: 'cadence'; min: number; max: number }
  | { type: 'speed'; minMetersPerSecond: number; maxMetersPerSecond: number }
  | { type: 'pace'; minMetersPerSecond: number; maxMetersPerSecond: number };

export interface WorkoutExecutableStepInput {
  type: WorkoutStepKind;
  description?: string;
  durationSeconds?: number;
  distanceMeters?: number;
  target?: WorkoutStepTarget;
}

export interface WorkoutRepeatStepInput {
  type: 'repeat';
  description?: string;
  iterations: number;
  steps: WorkoutExecutableStepInput[];
}

export type WorkoutStepInput = WorkoutExecutableStepInput | WorkoutRepeatStepInput;

export interface CreateWorkoutInput {
  name: string;
  sport: WorkoutSport;
  description?: string | null;
  steps: WorkoutStepInput[];
  estimatedDurationSeconds?: number;
  estimatedDistanceMeters?: number;
}

export type GarminWorkoutPayload = Record<string, unknown>;
export type WorkoutCreateRequest = CreateWorkoutInput | GarminWorkoutPayload;

export interface ListWorkoutsOptions {
  start?: number;
  limit?: number;
  myWorkoutsOnly?: boolean;
}

export interface ScheduleWorkoutOptions {
  workoutId: string | number;
  date: Date | string;
}

export interface GetWeekOptions {
  start?: number;
}
