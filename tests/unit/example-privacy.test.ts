import { afterEach, describe, expect, it, vi } from 'vitest';

describe('workout history summary example', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('dotenv/config');
    vi.doUnmock('../../src/index.js');
  });

  it('logs aggregate availability only, never activity or metric payload data', async () => {
    // Arrange
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const activityId = 987_654;
    const activityName = 'Private Moonlight Run';
    const calendarDate = '2026-07-18T21:30:00';
    const metricValue = 'private-metric-value';
    vi.doMock('dotenv/config', () => ({}));
    vi.doMock('../../src/index.js', () => ({
      FileTokenStorage: class {},
      GarminConnectSDK: class {
        activities = {
          list: vi.fn().mockResolvedValue([
            {
              activityId,
              activityName,
              startTimeLocal: calendarDate,
              distance: 12_345,
              duration: 3_600,
            },
            { activityId: 123_456, activityName: 'Private Workout' },
          ]),
          getDetails: vi.fn().mockResolvedValue({
            metricRows: 1,
            metricDescriptors: [{ key: 'heartRate' }],
            firstMetricRow: metricValue,
          }),
        };

        async restoreSession(): Promise<boolean> {
          return true;
        }
      },
      summarizeActivityDetails: vi.fn((details: unknown) => details),
    }));

    // Act
    await import('../../examples/workout-history-summary.js');

    // Assert
    expect(log).toHaveBeenCalledOnce();
    const output = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(output)).toEqual({
      activityCount: 2,
      detailSummariesAvailable: 2,
      metricRowSummariesAvailable: 2,
    });
    for (const privateValue of [
      String(activityId),
      activityName,
      calendarDate,
      metricValue,
      'Private Workout',
    ]) {
      expect(output).not.toContain(privateValue);
    }
  });
});
