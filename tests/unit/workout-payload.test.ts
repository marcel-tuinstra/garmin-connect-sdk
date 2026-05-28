import { describe, expect, it } from 'vitest';

import { buildWorkoutPayload } from '../../src/utils/workoutPayload.js';

describe('workout payload helpers', () => {
  it('builds Garmin repeat groups from generic workout input', () => {
    const payload = buildWorkoutPayload({
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
    });

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
    const payload = buildWorkoutPayload({
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
    });

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
    expect(() =>
      buildWorkoutPayload({
        name: 'Bad Repeat',
        sport: 'running',
        steps: [{ type: 'repeat', iterations: 2, steps: [] }],
      }),
    ).toThrow(/repeated child step/);
  });
});
