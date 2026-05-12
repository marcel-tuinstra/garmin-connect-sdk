import 'dotenv/config';

import { FileTokenStorage, GarminConnectSDK } from '../src/index.js';
import { eachDate } from '../src/utils/dates.js';

const garmin = new GarminConnectSDK({
  storage: new FileTokenStorage('./.garmin-tokens'),
});

if (!(await garmin.restoreSession())) {
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!email || !password) throw new Error('Set GARMIN_EMAIL and GARMIN_PASSWORD.');
  await garmin.login({ email, password });
}

const end = new Date();
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 29);

for (const date of eachDate(start, end)) {
  const [sleep, bodyBattery] = await Promise.all([
    garmin.sleep.getDailySleep(date),
    garmin.health.getBodyBattery(date),
  ]);
  console.log({ date, sleep: Boolean(sleep), bodyBattery: Boolean(bodyBattery) });
}

const activities = await garmin.activities.list({ start: 0, limit: 100 });
console.log({ activities: activities.length });
