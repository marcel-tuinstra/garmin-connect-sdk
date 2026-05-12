export const activityListPayload = [
  {
    activityId: 123456789,
    activityName: 'Morning Run',
    activityType: { typeKey: 'running' },
    startTimeLocal: '2026-05-12 07:10:00',
    duration: 2700.12,
    distance: 10000.4,
    averageHR: 142,
  },
];

export const activityDetailPayload = {
  activityId: 123456789,
  activityName: 'Morning Run',
  activityType: { typeKey: 'running' },
  summaryDTO: {
    distance: 10000.4,
    duration: 2700.12,
    startTimeLocal: '2026-05-12 07:10:00',
    averageHR: 142,
    maxHR: 176,
    averageSpeed: 3.7,
    calories: 720,
  },
};

export const activityDetailsPayload = {
  activityId: 123456789,
  measurementCount: 2,
  metricsCount: 1,
  totalMetricsCount: 1,
  metricDescriptors: [
    { metricsIndex: 0, key: 'directHeartRate', unit: { key: 'bpm' } },
    { metricsIndex: 1, key: 'directLatitude', unit: { key: 'dd' } },
  ],
  activityDetailMetrics: [
    {
      metrics: [142, 52.1],
    },
  ],
};

export const activitySplitsPayload = [
  {
    splitType: 'INTERVAL_ACTIVE',
    distance: 1000,
    duration: 260,
  },
];

export const dailySleepPayload = {
  dailySleepDTO: {
    calendarDate: '2026-05-12',
    sleepStartTimestampLocal: null,
    sleepEndTimestampLocal: null,
    sleepTimeSeconds: 27900,
    deepSleepSeconds: null,
    lightSleepSeconds: 14400,
    remSleepSeconds: 6300,
    awakeSleepSeconds: 1800,
  },
  sleepLevels: [
    {
      startGMT: '2026-05-11T20:30:00.0',
      endGMT: '2026-05-11T21:15:00.0',
      activityLevel: 1,
    },
  ],
};

export const heartRatePayload = {
  userProfilePK: 12345,
  calendarDate: '2026-05-12',
  heartRateValues: [
    [1778565600000, 54],
    [1778565900000, null],
  ],
};

export const stressPayload = {
  calendarDate: '2026-05-12',
  stressValues: [
    [1778565600000, 25],
    [1778565900000, -1],
  ],
};

export const bodyBatteryPayload = [
  {
    calendarDate: '2026-05-12',
    startTimestampGMT: null,
    endTimestampGMT: null,
    bodyBatteryValuesArray: [
      [1778565600000, 82],
      [1778565900000, 81],
    ],
  },
];

export const hrvStatusPayload = {
  calendarDate: '2026-05-12',
  hrvSummary: {
    status: 'BALANCED',
  },
};

export const socialProfilePayload = {
  id: 123456,
  profileId: 987654,
  displayName: 'runner',
  fullName: 'Example Runner',
  userName: 'runner@example.invalid',
};

export const devicesPayload = [
  {
    deviceId: 123,
    unitId: 456,
    productDisplayName: 'Forerunner',
  },
];
