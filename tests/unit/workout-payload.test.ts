import { describe, expect, it } from 'vitest';

import type { CreateWorkoutInput } from '../../src/types/workout.js';
import { buildWorkoutPayload, isCreateWorkoutInput } from '../../src/utils/workoutPayload.js';

describe('workout payload helpers', () => {
  it('pins Garmin workout type constants used by generated payloads', () => {
    // Arrange
    const input: CreateWorkoutInput = {
      name: 'Constant Pin',
      sport: 'running',
      steps: [
        { type: 'warmup', durationSeconds: 300 },
        { type: 'interval', distanceMeters: 1000, target: { type: 'heart_rate_zone', zone: 3 } },
        { type: 'interval', durationSeconds: 120, target: { type: 'heart_rate', min: 130, max: 150 } },
        { type: 'recovery', durationSeconds: 90, target: { type: 'power', min: 180, max: 220 } },
        { type: 'cooldown', durationSeconds: 300, target: { type: 'cadence', min: 80, max: 95 } },
        {
          type: 'rest',
          durationSeconds: 60,
          target: { type: 'speed', minMetersPerSecond: 2.5, maxMetersPerSecond: 4 },
        },
        {
          type: 'interval',
          durationSeconds: 60,
          target: { type: 'pace', minMetersPerSecond: 3, maxMetersPerSecond: 5 },
        },
        {
          type: 'repeat',
          iterations: 2,
          steps: [{ type: 'interval', durationSeconds: 30 }],
        },
      ],
    };

    // Act
    const payload = buildWorkoutPayload(input);
    const steps = payload.workoutSegments as Array<{ workoutSteps: Array<Record<string, unknown>> }>;
    const workoutSteps = steps[0]!.workoutSteps;

    // Assert
    expect(payload.sportType).toEqual({ sportTypeId: 1, sportTypeKey: 'running', displayOrder: 1 });
    expect(workoutSteps.map((step) => step.stepType)).toEqual([
      { stepTypeId: 1, stepTypeKey: 'warmup', displayOrder: 1 },
      { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
      { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
      { stepTypeId: 4, stepTypeKey: 'recovery', displayOrder: 4 },
      { stepTypeId: 2, stepTypeKey: 'cooldown', displayOrder: 2 },
      { stepTypeId: 5, stepTypeKey: 'rest', displayOrder: 5 },
      { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
      { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 },
    ]);
    expect(workoutSteps.map((step) => step.endCondition)).toEqual([
      { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true },
      { conditionTypeId: 3, conditionTypeKey: 'distance', displayOrder: 3, displayable: true },
      { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true },
      { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true },
      { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true },
      { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true },
      { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true },
      { conditionTypeId: 7, conditionTypeKey: 'iterations', displayOrder: 7, displayable: false },
    ]);
    expect(workoutSteps.map((step) => step.targetType)).toEqual([
      { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target', displayOrder: 1 },
      { workoutTargetTypeId: 4, workoutTargetTypeKey: 'heart.rate.zone', displayOrder: 4 },
      { workoutTargetTypeId: 4, workoutTargetTypeKey: 'heart.rate.zone', displayOrder: 4 },
      { workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone', displayOrder: 2 },
      { workoutTargetTypeId: 3, workoutTargetTypeKey: 'cadence.zone', displayOrder: 3 },
      { workoutTargetTypeId: 5, workoutTargetTypeKey: 'speed.zone', displayOrder: 5 },
      { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone', displayOrder: 6 },
      undefined,
    ]);
  });

  it('builds swimming workouts with the Garmin workout sport type id', () => {
    // Arrange
    const input: CreateWorkoutInput = {
      name: 'Pool Swim',
      sport: 'swimming',
      steps: [{ type: 'interval', durationSeconds: 600 }],
    };

    // Act
    const payload = buildWorkoutPayload(input);

    // Assert
    expect(payload).toMatchObject({
      sportType: { sportTypeId: 4, sportTypeKey: 'swimming', displayOrder: 3 },
      workoutSegments: [
        {
          sportType: { sportTypeId: 4, sportTypeKey: 'swimming', displayOrder: 3 },
        },
      ],
    });
  });

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
