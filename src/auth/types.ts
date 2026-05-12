import type { Logger } from '../utils/logger.js';
import type { RetryOptions } from '../utils/retry.js';
import type { TokenStorage } from './TokenStorage.js';

export interface GarminTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt?: string;
  tokenType?: string;
  scope?: string;
  displayName?: string;
  clientId?: string;
}

export interface MfaCodeProvider {
  (): Promise<string> | string;
}

export interface LoginOptions {
  email: string;
  password: string;
  mfaCode?: string | MfaCodeProvider;
}

export interface GarminConnectSDKOptions {
  storage?: TokenStorage;
  logger?: Logger;
  fetch?: typeof fetch;
  retry?: RetryOptions;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface AuthTokensResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  display_name?: string;
  displayName?: string;
}
