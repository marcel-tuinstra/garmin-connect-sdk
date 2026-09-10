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
  WorkoutUpdateRequest,
} from '../types/workout.js';
import { formatDate } from '../utils/dates.js';
import { buildWorkoutPayload, isCreateWorkoutInput } from '../utils/workoutPayload.js';

/**
 * Experimental Garmin workout APIs.
 *
 * Methods on this endpoint can create, update, schedule, unschedule, and delete workouts in the
 * Garmin account. Reads use the SDK's bounded retry policy; writes deliberately do not retry
 * because an interrupted request may already have changed the account. The public signatures
 * follow SemVer, while Garmin's unsupported behavior may drift.
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

  /**
   * Creates a workout definition without automatic retries. If its outcome is uncertain,
   * reconcile by listing workouts and applying application-specific matching before retrying.
   */
  create(input: WorkoutCreateRequest): Promise<Workout> {
    const payload = isCreateWorkoutInput(input) ? buildWorkoutPayload(input) : input;
    return this.createRaw(payload);
  }

  createRaw(payload: GarminWorkoutPayload): Promise<Workout> {
    return this.#http.request('/workout-service/workout', {
      method: 'POST',
      body: payload,
      schema: workoutSchema,
      retry: { maxRetries: 0 },
    });
  }

  /**
   * Replaces a workout definition in place without automatic retries or auth replay. PUT is a
   * full replacement: this method never reads or merges the existing workout. If the response is
   * interrupted, reconcile with {@link get} before deciding whether another replacement is safe.
   */
  async update(workoutId: string | number, input: WorkoutUpdateRequest): Promise<Workout> {
    assertPositiveWorkoutId(workoutId);
    const payload = isCreateWorkoutInput(input) ? buildWorkoutPayload(input) : input;
    return this.updateRaw(workoutId, payload);
  }

  async updateRaw(workoutId: string | number, payload: GarminWorkoutPayload): Promise<Workout> {
    assertPositiveWorkoutId(workoutId);
    assertWorkoutPayload(payload);

    // Copy the top-level payload before overriding the path identifier. No read-modify-write or
    // retry is implicit here: an uncertain PUT may already have fully replaced the workout.
    const replacement = { ...payload, workoutId };
    return this.#http.request(`/workout-service/workout/${workoutId}`, {
      method: 'PUT',
      body: replacement,
      schema: workoutSchema,
      retry: { maxRetries: 0 },
    });
  }

  /**
   * Schedules a workout without automatic retries. If its outcome is uncertain, inspect the
   * relevant calendar week or month before attempting another schedule.
   */
  schedule(options: ScheduleWorkoutOptions): Promise<WorkoutSchedule> {
    return this.#http.request(`/workout-service/schedule/${options.workoutId}`, {
      method: 'POST',
      body: { date: formatDate(options.date) },
      schema: workoutScheduleSchema,
      retry: { maxRetries: 0 },
    });
  }

  /**
   * Removes a scheduled workout without automatic retries. If its outcome is uncertain, inspect
   * the relevant calendar week or month before attempting another removal.
   */
  unschedule(scheduleId: string | number): Promise<unknown> {
    return this.#http.request(`/workout-service/schedule/${scheduleId}`, {
      method: 'DELETE',
      retry: { maxRetries: 0 },
    });
  }

  /**
   * Deletes a workout definition without automatic retries. If its outcome is uncertain, use
   * {@link get} to reconcile the workout's availability before deciding whether to retry.
   */
  delete(workoutId: string | number): Promise<unknown> {
    return this.#http.request(`/workout-service/workout/${workoutId}`, {
      method: 'DELETE',
      retry: { maxRetries: 0 },
    });
  }
}

function assertPositiveWorkoutId(workoutId: string | number): void {
  if (typeof workoutId === 'number') {
    if (!Number.isSafeInteger(workoutId) || workoutId <= 0) {
      throw new TypeError('workoutId must be a positive integer.');
    }
    return;
  }

  if (typeof workoutId !== 'string' || !/^\d+$/.test(workoutId) || BigInt(workoutId) <= 0n) {
    throw new TypeError('workoutId must be a positive integer.');
  }
}

function assertWorkoutPayload(payload: GarminWorkoutPayload): void {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).length === 0
  ) {
    throw new TypeError('Workout update payload must be a non-empty object.');
  }
}
