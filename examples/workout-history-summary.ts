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
const detailSummaries = await Promise.all(
  activities.map(async (activity) => {
    const details = await garmin.activities.getDetails(activity.activityId, {
      maxChartSize: 1000,
      maxPolylineSize: 1000,
    });
    return summarizeActivityDetails(details);
  }),
);

console.log(JSON.stringify({
  activityCount: activities.length,
  detailSummariesAvailable: detailSummaries.length,
  metricRowSummariesAvailable: detailSummaries.filter((summary) => 'metricRows' in summary).length,
}, null, 2));
