import { AuthService } from '../auth/AuthService.js';
import type { LoginOptions, GarminConnectSDKOptions } from '../auth/types.js';
import { ActivitiesEndpoint } from '../endpoints/ActivitiesEndpoint.js';
import { DevicesEndpoint } from '../endpoints/DevicesEndpoint.js';
import { HealthEndpoint } from '../endpoints/HealthEndpoint.js';
import { SleepEndpoint } from '../endpoints/SleepEndpoint.js';
import { UserEndpoint } from '../endpoints/UserEndpoint.js';
import { HttpClient } from './HttpClient.js';

export class GarminConnectSDK {
  readonly auth: AuthService;
  readonly http: HttpClient;
  readonly activities: ActivitiesEndpoint;
  readonly sleep: SleepEndpoint;
  readonly health: HealthEndpoint;
  readonly user: UserEndpoint;
  readonly devices: DevicesEndpoint;

  constructor(options: GarminConnectSDKOptions = {}) {
    const retry = { maxRetries: options.maxRetries ?? 3, ...options.retry };
    this.auth = new AuthService({
      storage: options.storage,
      logger: options.logger,
      fetch: options.fetch,
      retry,
    });
    this.http = new HttpClient({
      auth: this.auth,
      fetch: options.fetch,
      logger: options.logger,
      retry,
    });
    this.user = new UserEndpoint(this.http);
    this.activities = new ActivitiesEndpoint(this.http);
    this.sleep = new SleepEndpoint(this.http, this.user);
    this.health = new HealthEndpoint(this.http, this.user);
    this.devices = new DevicesEndpoint(this.http);
  }

  async login(options: LoginOptions): Promise<void> {
    const tokens = await this.auth.login(options);
    if (tokens.displayName) {
      this.user.setCachedProfile({ displayName: tokens.displayName });
    } else {
      await this.user.getProfile();
    }
  }

  async restoreSession(): Promise<boolean> {
    const restored = await this.auth.restoreSession();
    const displayName = this.auth.tokens?.displayName;
    if (displayName) this.user.setCachedProfile({ displayName });
    return restored;
  }

  logout(): Promise<void> {
    return this.auth.logout();
  }
}
