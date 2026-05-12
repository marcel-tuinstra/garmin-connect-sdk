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
  ListAllActivitiesOptions,
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

  async listAll(options: ListAllActivitiesOptions = {}): Promise<ActivityList> {
    const pageSize = options.pageSize ?? 100;
    const maxPages = options.maxPages ?? 10;
    const activities: ActivityList = [];

    for (let page = 0; page < maxPages; page += 1) {
      const batch = await this.list({
        activityType: options.activityType,
        start: page * pageSize,
        limit: pageSize,
      });
      activities.push(...batch);
      if (batch.length < pageSize) break;
    }

    return activities;
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
