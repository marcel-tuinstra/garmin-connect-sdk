export { GarminConnectSDK } from './client/GarminConnectSDK.js';
export {
  GarminAuthError,
  GarminBotChallengeError,
  GarminMfaRequiredError,
  GarminRateLimitError,
  GarminRequestError,
  GarminSessionExpiredError,
  GarminValidationError,
  errorFromResponse,
  parseRetryAfter,
  GarminTimeoutError,
} from './client/GarminRequestError.js';

export { FileTokenStorage } from './auth/FileTokenStorage.js';
export { MemoryTokenStorage } from './auth/MemoryTokenStorage.js';
export type { TokenStorage } from './auth/TokenStorage.js';
export type {
  GarminConnectSDKOptions,
  GarminTokens,
  LoginOptions,
  MfaCodeProvider,
} from './auth/types.js';

export type {
  ActivityDetail,
  ActivityDetailsOptions,
  ActivityDownloadFormat,
  ActivityList,
  ActivitySortOrder,
  ActivitySummary,
  ActivityTypes,
  ListAllActivitiesOptions,
  ListActivitiesOptions,
} from './types/activity.js';
export type { BodyBattery, DateRange, HeartRate, HrvStatus, Stress } from './types/health.js';
export type { DailySleep, SleepRange } from './types/sleep.js';
export type { Device, DeviceList, SocialProfile } from './types/user.js';
export type {
  CalendarItem,
  CalendarMonth,
  CreateWorkoutInput,
  GarminWorkoutPayload,
  GetWeekOptions,
  ListWorkoutsOptions,
  ScheduleWorkoutOptions,
  Workout,
  WorkoutCreateRequest,
  WorkoutExecutableStepInput,
  WorkoutList,
  WorkoutRepeatStepInput,
  WorkoutSchedule,
  WorkoutSport,
  WorkoutSportType,
  WorkoutStepInput,
  WorkoutStepKind,
  WorkoutStepTarget,
  WorkoutSummary,
  WorkoutTypes,
} from './types/workout.js';
export { buildWorkoutPayload } from './utils/workoutPayload.js';
export {
  decodeActivityMetricRow,
  normalizeMetricDescriptors,
  summarizeActivityDetails,
  summarizeActivityHeartRateShape,
  summarizeActivitySplits,
} from './utils/activityMetrics.js';
export type {
  ActivityDetailsSummary,
  ActivityHeartRateSampleShape,
  ActivityHeartRateShapeSummary,
  ActivityMetricDescriptor,
  ActivitySplitsSummary,
  DecodedActivityMetricRow,
  DecodeActivityMetricOptions,
} from './utils/activityMetrics.js';
