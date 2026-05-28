import type {
  CreateWorkoutInput,
  GarminWorkoutPayload,
  WorkoutExecutableStepInput,
  WorkoutRepeatStepInput,
  WorkoutSport,
  WorkoutStepInput,
  WorkoutStepKind,
  WorkoutStepTarget,
} from '../types/workout.js';

const SPORT_TYPES: Record<WorkoutSport, { sportTypeId: number; sportTypeKey: string; displayOrder: number }> = {
  running: { sportTypeId: 1, sportTypeKey: 'running', displayOrder: 1 },
  cycling: { sportTypeId: 2, sportTypeKey: 'cycling', displayOrder: 2 },
};

const STEP_TYPES: Record<WorkoutStepKind, { stepTypeId: number; stepTypeKey: string; displayOrder: number }> = {
  warmup: { stepTypeId: 1, stepTypeKey: 'warmup', displayOrder: 1 },
  cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown', displayOrder: 2 },
  interval: { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
  recovery: { stepTypeId: 4, stepTypeKey: 'recovery', displayOrder: 4 },
  rest: { stepTypeId: 5, stepTypeKey: 'rest', displayOrder: 5 },
};

const REPEAT_STEP_TYPE = { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 };

const TARGET_TYPES = {
  noTarget: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target', displayOrder: 1 },
  power: { workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone', displayOrder: 2 },
  cadence: { workoutTargetTypeId: 3, workoutTargetTypeKey: 'cadence.zone', displayOrder: 3 },
  heartRate: { workoutTargetTypeId: 4, workoutTargetTypeKey: 'heart.rate.zone', displayOrder: 4 },
  speed: { workoutTargetTypeId: 5, workoutTargetTypeKey: 'speed.zone', displayOrder: 5 },
  pace: { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone', displayOrder: 6 },
} as const;

const END_CONDITIONS = {
  time: { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true },
  distance: { conditionTypeId: 3, conditionTypeKey: 'distance', displayOrder: 3, displayable: true },
  iterations: { conditionTypeId: 7, conditionTypeKey: 'iterations', displayOrder: 7, displayable: false },
} as const;

export function isCreateWorkoutInput(input: unknown): input is CreateWorkoutInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'name' in input &&
    'sport' in input &&
    'steps' in input
  );
}

export function buildWorkoutPayload(input: CreateWorkoutInput): GarminWorkoutPayload {
  validateWorkoutInput(input);
  const sportType = SPORT_TYPES[input.sport];
  const steps = buildWorkoutSteps(input.steps, 1).steps;
  const estimatedDuration = input.estimatedDurationSeconds ?? estimateDuration(input.steps);
  const estimatedDistance = input.estimatedDistanceMeters ?? estimateDistance(input.steps);

  return {
    sportType,
    subSportType: null,
    workoutName: input.name,
    description: input.description ?? null,
    estimatedDistanceUnit: { unitKey: null },
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType,
        workoutSteps: steps,
      },
    ],
    avgTrainingSpeed: null,
    estimatedDurationInSecs: estimatedDuration,
    estimatedDistanceInMeters: estimatedDistance,
    estimateType: null,
  };
}

function buildWorkoutSteps(
  steps: WorkoutStepInput[] | WorkoutExecutableStepInput[],
  startOrder: number,
): { steps: GarminWorkoutPayload[]; nextOrder: number } {
  const payloads: GarminWorkoutPayload[] = [];
  let nextOrder = startOrder;

  for (const step of steps) {
    const result = step.type === 'repeat'
      ? buildRepeatStep(step, nextOrder)
      : buildWorkoutStep(step, nextOrder);
    payloads.push(result.step);
    nextOrder = result.nextOrder;
  }

  return { steps: payloads, nextOrder };
}

function buildWorkoutStep(
  step: WorkoutExecutableStepInput,
  order: number,
): { step: GarminWorkoutPayload; nextOrder: number } {
  const endCondition = step.durationSeconds !== undefined ? END_CONDITIONS.time : END_CONDITIONS.distance;
  const endConditionValue =
    step.durationSeconds !== undefined ? step.durationSeconds : (step.distanceMeters as number);

  return {
    step: {
      stepId: order,
      stepOrder: order,
      stepType: STEP_TYPES[step.type],
      type: 'ExecutableStepDTO',
      description: step.description ?? '',
      stepAudioNote: null,
      endCondition,
      endConditionValue,
      ...buildTarget(step.target),
    },
    nextOrder: order + 1,
  };
}

function buildRepeatStep(
  step: WorkoutRepeatStepInput,
  order: number,
): { step: GarminWorkoutPayload; nextOrder: number } {
  const childSteps = buildWorkoutSteps(step.steps, order + 1);

  return {
    step: {
      stepId: order,
      stepOrder: order,
      stepType: REPEAT_STEP_TYPE,
      numberOfIterations: step.iterations,
      smartRepeat: false,
      endCondition: END_CONDITIONS.iterations,
      endConditionValue: step.iterations,
      type: 'RepeatGroupDTO',
      description: step.description ?? '',
      workoutSteps: childSteps.steps,
    },
    nextOrder: childSteps.nextOrder,
  };
}

function buildTarget(target: WorkoutStepTarget = { type: 'no_target' }): GarminWorkoutPayload {
  switch (target.type) {
    case undefined:
    case 'no_target':
      return { targetType: TARGET_TYPES.noTarget };
    case 'heart_rate_zone':
      assertPositiveInteger(target.zone, 'target.zone');
      return {
        targetType: TARGET_TYPES.heartRate,
        zoneNumber: target.zone,
        targetValueUnit: null,
      };
    case 'heart_rate':
      return targetRange(TARGET_TYPES.heartRate, target.min, target.max);
    case 'power':
      return targetRange(TARGET_TYPES.power, target.min, target.max);
    case 'cadence':
      return targetRange(TARGET_TYPES.cadence, target.min, target.max);
    case 'speed':
      return targetRange(TARGET_TYPES.speed, target.minMetersPerSecond, target.maxMetersPerSecond);
    case 'pace':
      return targetRange(TARGET_TYPES.pace, target.maxMetersPerSecond, target.minMetersPerSecond);
  }
}

function targetRange(targetType: GarminWorkoutPayload, first: number, second: number): GarminWorkoutPayload {
  assertPositiveNumber(first, 'target.min');
  assertPositiveNumber(second, 'target.max');
  if (first > second && targetType !== TARGET_TYPES.pace) {
    throw new TypeError('Target minimum must be less than or equal to target maximum.');
  }

  return {
    targetType,
    targetValueOne: first,
    targetValueTwo: second,
    targetValueUnit: null,
  };
}

function validateWorkoutInput(input: CreateWorkoutInput): void {
  if (!input.name.trim()) throw new TypeError('Workout name is required.');
  if (!SPORT_TYPES[input.sport]) throw new TypeError(`Unsupported workout sport: ${input.sport}`);
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new TypeError('Workout must include at least one step.');
  }

  for (const [index, step] of input.steps.entries()) {
    validateStep(step, `Workout step ${index + 1}`);
  }
}

function validateStep(step: WorkoutStepInput | WorkoutExecutableStepInput, label: string): void {
  if (step.type === 'repeat') {
    assertPositiveInteger(step.iterations, `${label} iterations`);
    if (!Array.isArray(step.steps) || step.steps.length === 0) {
      throw new TypeError(`${label} must include at least one repeated child step.`);
    }
    for (const [index, childStep] of step.steps.entries()) {
      validateStep(childStep, `${label}.${index + 1}`);
    }
    return;
  }

  if (!STEP_TYPES[step.type]) throw new TypeError(`Unsupported workout step type: ${step.type}`);
  if (step.durationSeconds === undefined && step.distanceMeters === undefined) {
    throw new TypeError(`${label} must include durationSeconds or distanceMeters.`);
  }
  if (step.durationSeconds !== undefined && step.distanceMeters !== undefined) {
    throw new TypeError(`${label} must not include both durationSeconds and distanceMeters.`);
  }
  if (step.durationSeconds !== undefined) assertPositiveNumber(step.durationSeconds, 'durationSeconds');
  if (step.distanceMeters !== undefined) assertPositiveNumber(step.distanceMeters, 'distanceMeters');
}

function estimateDuration(steps: WorkoutStepInput[] | WorkoutExecutableStepInput[]): number | null {
  const durations = steps.map((step) => stepDuration(step)).filter((value): value is number => value !== null);
  return durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) : null;
}

function estimateDistance(steps: WorkoutStepInput[] | WorkoutExecutableStepInput[]): number | null {
  const distances = steps.map((step) => stepDistance(step)).filter((value): value is number => value !== null);
  return distances.length > 0 ? distances.reduce((sum, value) => sum + value, 0) : null;
}

function stepDuration(step: WorkoutStepInput | WorkoutExecutableStepInput): number | null {
  if (step.type === 'repeat') {
    const childDuration = estimateDuration(step.steps);
    return childDuration === null ? null : childDuration * step.iterations;
  }

  return step.durationSeconds ?? null;
}

function stepDistance(step: WorkoutStepInput | WorkoutExecutableStepInput): number | null {
  if (step.type === 'repeat') {
    const childDistance = estimateDistance(step.steps);
    return childDistance === null ? null : childDistance * step.iterations;
  }

  return step.distanceMeters ?? null;
}

function assertPositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be a positive number.`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer.`);
}
