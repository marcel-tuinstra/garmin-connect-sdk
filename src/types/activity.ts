import type { z } from 'zod';
import type {
  activityDetailSchema,
  activityListSchema,
  activitySummarySchema,
} from '../schemas/activity.schema.js';

export type ActivitySummary = z.infer<typeof activitySummarySchema>;
export type ActivityList = z.infer<typeof activityListSchema>;
export type ActivityDetail = z.infer<typeof activityDetailSchema>;

export interface ListActivitiesOptions {
  start?: number;
  limit?: number;
  activityType?: string;
}

export interface ActivityDetailsOptions {
  maxChartSize?: number;
  maxPolylineSize?: number;
}
