import type { HttpClient } from '../client/HttpClient.js';
import {
  activityDetailSchema,
  activityDetailsPayloadSchema,
  activityListSchema,
  activitySplitsSchema,
} from '../schemas/activity.schema.js';
import type {
  ActivityDetail,
  ActivityDetailsOptions,
  ActivityList,
  ListActivitiesOptions,
} from '../types/activity.js';

export class ActivitiesEndpoint {
  #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  list(options: ListActivitiesOptions = {}): Promise<ActivityList> {
    return this.#http.request('/activitylist-service/activities/search/activities', {
      query: {
        start: options.start ?? 0,
        limit: options.limit ?? 20,
        activityType: options.activityType,
      },
      schema: activityListSchema,
    });
  }

  get(activityId: string | number): Promise<ActivityDetail> {
    return this.#http.request(`/activity-service/activity/${activityId}`, {
      schema: activityDetailSchema,
    });
  }

  getDetails(activityId: string | number, options: ActivityDetailsOptions = {}): Promise<unknown> {
    return this.#http.request(`/activity-service/activity/${activityId}/details`, {
      query: {
        maxChartSize: options.maxChartSize,
        maxPolylineSize: options.maxPolylineSize,
      },
      schema: activityDetailsPayloadSchema,
    });
  }

  getSplits(activityId: string | number): Promise<unknown> {
    return this.#http.request(`/activity-service/activity/${activityId}/typedsplits`, {
      schema: activitySplitsSchema,
    });
  }
}
