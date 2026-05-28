import { describe, expect, it } from 'vitest';

import type { CreateWorkoutInput } from '../../src/types/workout.js';
import { buildWorkoutPayload, isCreateWorkoutInput } from '../../src/utils/workoutPayload.js';

describe('workout payload helpers', () => {
  it('builds Garmin repeat groups from generic workout input', () => {
    // Arrange
    const input: CreateWorkoutInput = {
      name: 'Repeat Run',
      sport: 'running',
      steps: [
        {
          type: 'repeat',
          iterations: 4,
          steps: [
            { type: 'interval', durationSeconds: 30 },
            { type: 'recovery', durationSeconds: 90 },
          ],
        },
      ],
    };

    // Act
    const payload = buildWorkoutPayload(input);

    // Assert
    expect(payload).toMatchObject({
      estimatedDurationInSecs: 480,
      workoutSegments: [
        {
          workoutSteps: [
            {
              type: 'RepeatGroupDTO',
              numberOfIterations: 4,
              workoutSteps: [
                { type: 'ExecutableStepDTO', endConditionValue: 30 },
                { type: 'ExecutableStepDTO', stepType: { stepTypeKey: 'recovery' } },
              ],
            },
          ],
        },
      ],
    });
  });

  it('builds repeat-group distance estimates from generic workout input', () => {
    // Arrange
    const input: CreateWorkoutInput = {
      name: 'Repeat Ride',
      sport: 'cycling',
      steps: [
        {
          type: 'repeat',
          iterations: 3,
          steps: [
            { type: 'interval', distanceMeters: 1000 },
            { type: 'recovery', durationSeconds: 60 },
          ],
        },
      ],
    };

    // Act
    const payload = buildWorkoutPayload(input);

    // Assert
    expect(payload).toMatchObject({
      estimatedDurationInSecs: 180,
      estimatedDistanceInMeters: 3000,
      workoutSegments: [
        {
          workoutSteps: [
            {
              type: 'RepeatGroupDTO',
              numberOfIterations: 3,
              workoutSteps: [
                {
                  type: 'ExecutableStepDTO',
                  endCondition: { conditionTypeKey: 'distance' },
                  endConditionValue: 1000,
                },
                {
                  type: 'ExecutableStepDTO',
                  endCondition: { conditionTypeKey: 'time' },
                  endConditionValue: 60,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('rejects repeat groups without child steps', () => {
    // Arrange
    const input: CreateWorkoutInput = {
      name: 'Bad Repeat',
      sport: 'running',
      steps: [{ type: 'repeat', iterations: 2, steps: [] }],
    };

    // Act
    const build = () => buildWorkoutPayload(input);

    // Assert
    expect(build).toThrow(/repeated child step/);
  });

  it('rejects invalid executable step shapes before sending them to Garmin', () => {
    // Arrange
    const withoutDuration: CreateWorkoutInput = {
      name: 'No Duration',
      sport: 'running',
      steps: [{ type: 'interval' }],
    };
    const withBothDurationAndDistance: CreateWorkoutInput = {
      name: 'Ambiguous',
      sport: 'running',
      steps: [{ type: 'interval', durationSeconds: 60, distanceMeters: 100 }],
    };

    // Act
    const missingEndCondition = () => buildWorkoutPayload(withoutDuration);
    const ambiguousEndCondition = () => buildWorkoutPayload(withBothDurationAndDistance);

    // Assert
    expect(missingEndCondition).toThrow(/durationSeconds or distanceMeters/);
    expect(ambiguousEndCondition).toThrow(/must not include both/);
  });

  it('rejects invalid target ranges and unsupported sports', () => {
    // Arrange
    const invertedHeartRateRange: CreateWorkoutInput = {
      name: 'Bad HR',
      sport: 'running',
      steps: [
        {
          type: 'interval',
          durationSeconds: 60,
          target: { type: 'heart_rate', min: 160, max: 120 },
        },
      ],
    };
    const unsupportedSport = {
      name: 'Bad Sport',
      sport: 'rowing',
      steps: [{ type: 'interval', durationSeconds: 60 }],
    } as unknown as CreateWorkoutInput;

    // Act
    const badTarget = () => buildWorkoutPayload(invertedHeartRateRange);
    const badSport = () => buildWorkoutPayload(unsupportedSport);

    // Assert
    expect(badTarget).toThrow(/Target minimum/);
    expect(badSport).toThrow(/Unsupported workout sport/);
  });

  it('identifies high-level workout input without misclassifying raw Garmin payloads', () => {
    // Arrange
    const highLevelInput: CreateWorkoutInput = {
      name: 'Run',
      sport: 'running',
      steps: [{ type: 'interval', durationSeconds: 60 }],
    };
    const rawPayload = { workoutName: 'Raw', workoutSegments: [] };

    // Act
    const highLevel = isCreateWorkoutInput(highLevelInput);
    const raw = isCreateWorkoutInput(rawPayload);

    // Assert
    expect(highLevel).toBe(true);
    expect(raw).toBe(false);
  });
});
