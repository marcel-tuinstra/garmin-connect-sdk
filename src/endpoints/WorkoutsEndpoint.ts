import type { HttpClient } from '../client/HttpClient.js';
import {
  workoutListSchema,
  workoutScheduleSchema,
  workoutSchema,
  workoutTypesSchema,
} from '../schemas/workout.schema.js';
import type {
  GarminWorkoutPayload,
  ListWorkoutsOptions,
  ScheduleWorkoutOptions,
  Workout,
  WorkoutCreateRequest,
  WorkoutList,
  WorkoutSchedule,
  WorkoutTypes,
} from '../types/workout.js';
import { formatDate } from '../utils/dates.js';
import { buildWorkoutPayload, isCreateWorkoutInput } from '../utils/workoutPayload.js';

/**
 * Experimental Garmin workout APIs.
 *
 * Methods on this endpoint can create, schedule, unschedule, and delete workouts in the Garmin
 * account. The public signatures follow SemVer, while Garmin's unsupported behavior may drift.
 */
export class WorkoutsEndpoint {
  #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  list(options: ListWorkoutsOptions = {}): Promise<WorkoutList> {
    return this.#http.request('/workout-service/workouts', {
      query: {
        start: options.start ?? 0,
        limit: options.limit ?? 20,
        myWorkoutsOnly: options.myWorkoutsOnly ?? true,
      },
      schema: workoutListSchema,
    });
  }

  get(workoutId: string | number): Promise<Workout> {
    return this.#http.request(`/workout-service/workout/${workoutId}`, {
      schema: workoutSchema,
    });
  }

  getTypes(): Promise<WorkoutTypes> {
    return this.#http.request('/workout-service/workout/types', {
      schema: workoutTypesSchema,
    });
  }

  create(input: WorkoutCreateRequest): Promise<Workout> {
    const payload = isCreateWorkoutInput(input) ? buildWorkoutPayload(input) : input;
    return this.createRaw(payload);
  }

  createRaw(payload: GarminWorkoutPayload): Promise<Workout> {
    return this.#http.request('/workout-service/workout', {
      method: 'POST',
      body: payload,
      schema: workoutSchema,
    });
  }

  schedule(options: ScheduleWorkoutOptions): Promise<WorkoutSchedule> {
    return this.#http.request(`/workout-service/schedule/${options.workoutId}`, {
      method: 'POST',
      body: { date: formatDate(options.date) },
      schema: workoutScheduleSchema,
    });
  }

  unschedule(scheduleId: string | number): Promise<unknown> {
    return this.#http.request(`/workout-service/schedule/${scheduleId}`, {
      method: 'DELETE',
    });
  }

  delete(workoutId: string | number): Promise<unknown> {
    return this.#http.request(`/workout-service/workout/${workoutId}`, {
      method: 'DELETE',
    });
  }
}
