import type { HttpClient } from '../client/HttpClient.js';
import { calendarMonthSchema, workoutScheduleSchema } from '../schemas/workout.schema.js';
import type {
  CalendarMonth,
  GetWeekOptions,
  ScheduleWorkoutOptions,
  WorkoutSchedule,
} from '../types/workout.js';
import { formatDate } from '../utils/dates.js';

/**
 * Experimental Garmin calendar APIs.
 *
 * Month/week reads are safe, but workout scheduling helpers mutate the Garmin account. Treat this
 * namespace uses unsupported Garmin behavior, but its public signatures follow SemVer.
 */
export class CalendarEndpoint {
  #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  getMonth(year: number, month: number): Promise<CalendarMonth> {
    validateMonth(month);
    return this.#http.request(`/calendar-service/year/${year}/month/${month - 1}`, {
      schema: calendarMonthSchema,
    });
  }

  getWeek(date: Date | string, options: GetWeekOptions = {}): Promise<CalendarMonth> {
    const day = new Date(`${formatDate(date)}T00:00:00.000Z`);
    return this.#http.request(
      `/calendar-service/year/${day.getUTCFullYear()}/month/${day.getUTCMonth()}/day/${day.getUTCDate()}/start/${options.start ?? 1}`,
      { schema: calendarMonthSchema },
    );
  }

  addWorkout(options: ScheduleWorkoutOptions): Promise<WorkoutSchedule> {
    return this.#http.request(`/workout-service/schedule/${options.workoutId}`, {
      method: 'POST',
      body: { date: formatDate(options.date) },
      schema: workoutScheduleSchema,
      retry: { maxRetries: 0 },
    });
  }

  removeWorkout(scheduleId: string | number): Promise<unknown> {
    return this.#http.request(`/workout-service/schedule/${scheduleId}`, {
      method: 'DELETE',
      retry: { maxRetries: 0 },
    });
  }
}

function validateMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new TypeError('Calendar month must be an integer from 1 to 12.');
  }
}
