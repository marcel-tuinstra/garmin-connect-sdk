import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
});
