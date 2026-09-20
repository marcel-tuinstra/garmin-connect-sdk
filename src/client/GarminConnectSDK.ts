import { AuthService } from '../auth/AuthService.js';
import type { LoginOptions, GarminConnectSDKOptions } from '../auth/types.js';
import { ActivitiesEndpoint } from '../endpoints/ActivitiesEndpoint.js';
import { CalendarEndpoint } from '../endpoints/CalendarEndpoint.js';
import { DevicesEndpoint } from '../endpoints/DevicesEndpoint.js';
import { HealthEndpoint } from '../endpoints/HealthEndpoint.js';
import { SleepEndpoint } from '../endpoints/SleepEndpoint.js';
import { UserEndpoint } from '../endpoints/UserEndpoint.js';
import { WeightEndpoint } from '../endpoints/WeightEndpoint.js';
import { WorkoutsEndpoint } from '../endpoints/WorkoutsEndpoint.js';
import {
  GarminAuthError,
  GarminRequestError,
  GarminSessionExpiredError,
} from './GarminRequestError.js';
import { HttpClient } from './HttpClient.js';

export class GarminConnectSDK {
  #auth: AuthService;
  #http: HttpClient;
  readonly activities: ActivitiesEndpoint;
  readonly sleep: SleepEndpoint;
  readonly health: HealthEndpoint;
  readonly user: UserEndpoint;
  readonly devices: DevicesEndpoint;
  readonly weight: WeightEndpoint;
  /** Operationally experimental account-mutating workout APIs. Public signatures follow SemVer. */
  readonly workouts: WorkoutsEndpoint;
  /** Operationally experimental calendar scheduling APIs. Public signatures follow SemVer. */
  readonly calendar: CalendarEndpoint;

  constructor(options: GarminConnectSDKOptions = {}) {
    const retry = { maxRetries: options.maxRetries ?? 3, ...options.retry };
    this.#auth = new AuthService({
      storage: options.storage,
      logger: options.logger,
      fetch: options.fetch,
      retry,
    });
    this.#http = new HttpClient({
      auth: this.#auth,
      fetch: options.fetch,
      logger: options.logger,
      retry,
      timeoutMs: options.timeoutMs,
    });
    this.user = new UserEndpoint(this.#http);
    this.activities = new ActivitiesEndpoint(this.#http);
    this.sleep = new SleepEndpoint(this.#http, this.user);
    this.health = new HealthEndpoint(this.#http, this.user);
    this.devices = new DevicesEndpoint(this.#http);
    this.weight = new WeightEndpoint(this.#http);
    this.workouts = new WorkoutsEndpoint(this.#http);
    this.calendar = new CalendarEndpoint(this.#http);
  }

  async login(options: LoginOptions): Promise<void> {
    this.user.clearCachedProfile();
    const loginPromise = this.#auth.login(options, { deferCompletion: true });
    const generation = this.#auth.sessionGeneration;
    const transitionCapability = this.#auth.sessionTransitionCapability(generation);
    let tokens: Awaited<ReturnType<AuthService['login']>> | undefined;
    let resolvedProfile: Awaited<ReturnType<UserEndpoint['getProfile']>> | undefined;

    try {
      tokens = await loginPromise;
      if (generation !== this.#auth.sessionGeneration) throw transitionCancelled('login');

      if (tokens.displayName?.trim()) {
        this.user.setCachedProfile({ displayName: tokens.displayName });
      } else {
        resolvedProfile = await this.user.getProfile({
          sessionTransitionCapability: transitionCapability,
        });
        if (!resolvedProfile.displayName?.trim()) {
          throw new GarminAuthError({
            message: 'Garmin profile does not contain displayName.',
          });
        }
      }

      if (generation !== this.#auth.sessionGeneration) throw transitionCancelled('login');
      if (resolvedProfile) this.user.setCachedProfile(resolvedProfile);
      this.#auth.completeSessionTransition(generation);
    } catch (error) {
      if (generation === this.#auth.sessionGeneration) {
        this.user.clearCachedProfile();
        try {
          await this.#auth.abortSessionTransition(generation);
        } finally {
          this.user.clearCachedProfile();
        }
      }
      throw error;
    }
  }

  async restoreSession(): Promise<boolean> {
    this.user.clearCachedProfile();
    const restorePromise = this.#auth.restoreSession({ deferCompletion: true });
    const generation = this.#auth.sessionGeneration;
    const transitionCapability = this.#auth.sessionTransitionCapability(generation);

    try {
      const restored = await restorePromise;
      if (generation !== this.#auth.sessionGeneration) throw transitionCancelled('restore');
      if (!restored) return false;

      const profile = await this.user.getProfile({
        sessionTransitionCapability: transitionCapability,
      });
      if (generation !== this.#auth.sessionGeneration) throw transitionCancelled('restore');
      this.user.setCachedProfile(profile);
      this.#auth.completeSessionTransition(generation);
      return true;
    } catch (error) {
      if (generation === this.#auth.sessionGeneration) {
        this.#auth.clearSessionCache({
          quarantinePersistedSession: !(error instanceof GarminSessionExpiredError),
        });
        this.user.clearCachedProfile();
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    this.user.clearCachedProfile();
    await this.#auth.logout();
  }
}

function transitionCancelled(operation: 'login' | 'restore'): GarminRequestError {
  return new GarminRequestError({
    message: `Garmin ${operation} was superseded by another session transition.`,
  });
}
