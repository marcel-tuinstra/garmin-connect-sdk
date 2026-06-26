import type { GarminTokens } from './types.js';

export interface TokenStorage {
  load(): Promise<GarminTokens | null>;
  save(tokens: GarminTokens): Promise<void>;
  clear(): Promise<void>;
  /**
   * Runs a refresh operation while holding this storage's refresh lock.
   *
   * Custom storage may omit this method. AuthService will fall back to an
   * in-process lock, which protects one SDK instance but cannot coordinate
   * separate SDK instances or processes that share token state.
   */
  withRefreshLock?<T>(operation: () => Promise<T>): Promise<T>;
}
