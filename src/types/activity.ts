import type { z } from 'zod';
import type {
  activityCountSchema,
  activityDetailSchema,
  activityListSchema,
  activitySummarySchema,
  activityTypesSchema,
} from '../schemas/activity.schema.js';

export type ActivitySummary = z.infer<typeof activitySummarySchema>;
export type ActivityList = z.infer<typeof activityListSchema>;
export type ActivityCount = z.infer<typeof activityCountSchema>;
export type ActivityTypes = z.infer<typeof activityTypesSchema>;
export type ActivityDetail = z.infer<typeof activityDetailSchema>;

export type ActivityDownloadFormat = 'original' | 'tcx' | 'gpx' | 'kml' | 'csv';
export type ActivitySortOrder = 'asc' | 'desc';

export interface ListActivitiesOptions {
  start?: number;
  limit?: number;
  activityType?: string;
  startDate?: Date | string;
  endDate?: Date | string;
  sortOrder?: ActivitySortOrder;
}

export interface ListAllActivitiesOptions extends Omit<ListActivitiesOptions, 'start' | 'limit'> {
  pageSize?: number;
  maxPages?: number;
}

export interface ActivityDetailsOptions {
  maxChartSize?: number;
  maxPolylineSize?: number;
}
