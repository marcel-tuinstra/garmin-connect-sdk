import type { HttpClient } from '../client/HttpClient.js';
import { GarminAuthError } from '../client/GarminRequestError.js';
import { socialProfileSchema } from '../schemas/user.schema.js';
import type { SocialProfile } from '../types/user.js';

export class UserEndpoint {
  #http: HttpClient;
  #profile: SocialProfile | null = null;
  #profileRevision = 0;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async getProfile(
    options: { /** @internal */ sessionTransitionCapability?: symbol } = {},
  ): Promise<SocialProfile> {
    const requestRevision = ++this.#profileRevision;
    const profile = await this.#http.request('/userprofile-service/socialProfile', {
      schema: socialProfileSchema,
      sessionTransitionCapability: options.sessionTransitionCapability,
    });
    if (requestRevision === this.#profileRevision) this.#profile = profile;
    return profile;
  }

  async getDisplayName(): Promise<string> {
    const profile = this.#profile ?? (await this.getProfile());
    if (!profile.displayName?.trim()) {
      throw new GarminAuthError({ message: 'Garmin profile does not contain displayName.' });
    }
    return profile.displayName;
  }

  setCachedProfile(profile: SocialProfile): void {
    this.#profileRevision += 1;
    this.#profile = profile;
  }

  clearCachedProfile(): void {
    this.#profileRevision += 1;
    this.#profile = null;
  }
}
