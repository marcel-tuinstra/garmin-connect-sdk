import type { TokenStorage } from './TokenStorage.js';
import type { GarminTokens } from './types.js';

export class MemoryTokenStorage implements TokenStorage {
  #tokens: GarminTokens | null = null;

  async load(): Promise<GarminTokens | null> {
    return this.#tokens ? { ...this.#tokens } : null;
  }

  async save(tokens: GarminTokens): Promise<void> {
    this.#tokens = { ...tokens };
  }

  async clear(): Promise<void> {
    this.#tokens = null;
  }
}
