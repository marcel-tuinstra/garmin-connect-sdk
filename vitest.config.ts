import { defineConfig } from 'vitest/config';

const runIntegration = process.env.GARMIN_RUN_INTEGRATION === '1';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: runIntegration
      ? ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts']
      : ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
    },
  },
});
