export { GarminConnectSDK } from './client/GarminConnectSDK.js';
export { HttpClient, buildPath } from './client/HttpClient.js';
export {
  GarminAuthError,
  GarminMfaRequiredError,
  GarminRateLimitError,
  GarminRequestError,
  GarminSessionExpiredError,
  GarminValidationError,
  errorFromResponse,
  parseRetryAfter,
  GarminTimeoutError,
} from './client/GarminRequestError.js';

export { AuthService } from './auth/AuthService.js';
export { FileTokenStorage } from './auth/FileTokenStorage.js';
export { MemoryTokenStorage } from './auth/MemoryTokenStorage.js';
export type { TokenStorage } from './auth/TokenStorage.js';
export type {
  AuthTokensResponse,
  GarminConnectSDKOptions,
  GarminTokens,
  LoginOptions,
  MfaCodeProvider,
} from './auth/types.js';

export type {
  ActivityDetail,
  ActivityDetailsOptions,
  ActivityList,
  ActivitySummary,
  ListAllActivitiesOptions,
  ListActivitiesOptions,
} from './types/activity.js';
export type { BodyBattery, DateRange, HeartRate, HrvStatus, Stress } from './types/health.js';
export type { DailySleep, SleepRange } from './types/sleep.js';
export type { Device, DeviceList, SocialProfile } from './types/user.js';
