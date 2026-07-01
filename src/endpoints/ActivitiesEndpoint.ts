import type { HttpClient } from '../client/HttpClient.js';
import {
  activityCountSchema,
  activityDetailSchema,
  activityDetailsPayloadSchema,
  activityListSchema,
  activitySplitsSchema,
  activityTypesSchema,
} from '../schemas/activity.schema.js';
import type {
  ActivityDownloadFormat,
  ActivityDetail,
  ActivityDetailsOptions,
  ActivityList,
  ActivityTypes,
  ListAllActivitiesOptions,
  ListActivitiesOptions,
} from '../types/activity.js';
import { formatDate } from '../utils/dates.js';

const ACTIVITY_DOWNLOAD_PATHS: Record<ActivityDownloadFormat, string> = {
  original: '/download-service/files/activity',
  tcx: '/download-service/export/tcx/activity',
  gpx: '/download-service/export/gpx/activity',
  kml: '/download-service/export/kml/activity',
  csv: '/download-service/export/csv/activity',
};

export class ActivitiesEndpoint {
  #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async count(): Promise<number> {
    const payload = await this.#http.request('/activitylist-service/activities/count', {
      schema: activityCountSchema,
    });
    return payload.totalCount;
  }

  list(options: ListActivitiesOptions = {}): Promise<ActivityList> {
    return this.#http.request('/activitylist-service/activities/search/activities', {
      query: {
        start: options.start ?? 0,
        limit: options.limit ?? 20,
        activityType: options.activityType,
        startDate: options.startDate ? formatDate(options.startDate) : undefined,
        endDate: options.endDate ? formatDate(options.endDate) : undefined,
        sortOrder: options.sortOrder,
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
        startDate: options.startDate,
        endDate: options.endDate,
        sortOrder: options.sortOrder,
        start: page * pageSize,
        limit: pageSize,
      });
      activities.push(...batch);
      if (batch.length < pageSize) break;
    }

    return activities;
  }

  download(
    activityId: string | number,
    format: ActivityDownloadFormat = 'tcx',
  ): Promise<Uint8Array> {
    return this.#http.request(`${ACTIVITY_DOWNLOAD_PATHS[format]}/${activityId}`, {
      responseType: 'bytes',
    });
  }

  getTypes(): Promise<ActivityTypes> {
    return this.#http.request('/activity-service/activity/activityTypes', {
      schema: activityTypesSchema,
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
