import type { TokenStorage } from './TokenStorage.js';
import type { GarminTokens } from './types.js';

export class MemoryTokenStorage implements TokenStorage {
  #tokens: GarminTokens | null = null;
  #refreshLock: Promise<void> = Promise.resolve();

  async load(): Promise<GarminTokens | null> {
    return this.#tokens ? { ...this.#tokens } : null;
  }

  async save(tokens: GarminTokens): Promise<void> {
    this.#tokens = { ...tokens };
  }

  async clear(): Promise<void> {
    this.#tokens = null;
  }

  async withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.#refreshLock;
    this.#refreshLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
