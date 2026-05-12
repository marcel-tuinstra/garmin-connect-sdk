import 'dotenv/config';

import {
  FileTokenStorage,
  GarminConnectSDK,
  summarizeActivityDetails,
} from '../src/index.js';

const garmin = new GarminConnectSDK({
  storage: new FileTokenStorage('./.garmin-tokens'),
  timeoutMs: 15_000,
});

if (!(await garmin.restoreSession())) {
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!email || !password) throw new Error('Set GARMIN_EMAIL and GARMIN_PASSWORD.');

  await garmin.login({
    email,
    password,
    mfaCode: process.env.GARMIN_MFA_CODE,
  });
}

const activities = await garmin.activities.list({ limit: 10 });
const summaries = await Promise.all(
  activities.map(async (activity) => {
    const details = await garmin.activities.getDetails(activity.activityId, {
      maxChartSize: 1000,
      maxPolylineSize: 1000,
    });
    const detailSummary = summarizeActivityDetails(details);

    return {
      id: activity.activityId,
      name: activity.activityName ?? null,
      type: activity.activityType?.typeKey ?? null,
      start: activity.startTimeLocal ?? null,
      distance: activity.distance ?? null,
      duration: activity.duration ?? null,
      details: 'metricRows' in detailSummary
        ? {
            metricRows: detailSummary.metricRows,
            metricDescriptors: detailSummary.metricDescriptors.map((descriptor) => descriptor.key),
            firstMetricRow: detailSummary.firstMetricRow,
          }
        : detailSummary,
    };
  }),
);

console.log(JSON.stringify({ count: summaries.length, activities: summaries }, null, 2));
