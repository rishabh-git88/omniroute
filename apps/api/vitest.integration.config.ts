import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // Integration files share one marker-guarded database, and a few fixture
    // suites deliberately TRUNCATE it. A single fork is required to prevent a
    // fixture reset from racing an in-flight execution transaction.
    pool: 'forks',
    singleFork: true,
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    sequence: { concurrent: false },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
