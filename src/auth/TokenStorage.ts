import type { GarminTokens } from './types.js';

export interface TokenStorage {
  load(): Promise<GarminTokens | null>;
  save(tokens: GarminTokens): Promise<void>;
  clear(): Promise<void>;
}
