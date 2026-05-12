import type { HttpClient } from '../client/HttpClient.js';
import { GarminAuthError } from '../client/GarminRequestError.js';
import { socialProfileSchema } from '../schemas/user.schema.js';
import type { SocialProfile } from '../types/user.js';

export class UserEndpoint {
  #http: HttpClient;
  #profile: SocialProfile | null = null;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async getProfile(): Promise<SocialProfile> {
    this.#profile = await this.#http.request('/userprofile-service/socialProfile', {
      schema: socialProfileSchema,
    });
    return this.#profile;
  }

  async getDisplayName(): Promise<string> {
    const profile = this.#profile ?? (await this.getProfile());
    if (!profile.displayName) {
      throw new GarminAuthError({ message: 'Garmin profile does not contain displayName.' });
    }
    return profile.displayName;
  }

  setCachedProfile(profile: SocialProfile): void {
    this.#profile = profile;
  }
}
