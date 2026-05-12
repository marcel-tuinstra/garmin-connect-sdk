import 'dotenv/config';

import { FileTokenStorage, GarminConnectSDK } from '../src/index.js';

const garmin = new GarminConnectSDK({
  storage: new FileTokenStorage('./.garmin-tokens'),
});

if (!(await garmin.restoreSession())) {
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!email || !password) throw new Error('Set GARMIN_EMAIL and GARMIN_PASSWORD.');
  await garmin.login({ email, password });
}

const today = new Date();
const activities = await garmin.activities.list({ limit: 20 });
const sleep = await garmin.sleep.getDailySleep(today);
const bodyBattery = await garmin.health.getBodyBattery(today);

console.log({
  activities: activities.length,
  sleep: Boolean(sleep),
  bodyBattery: Boolean(bodyBattery),
});
