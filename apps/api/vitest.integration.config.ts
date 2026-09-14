import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // Integration files share one marker-guarded database, and a few fixture
    // suites deliberately TRUNCATE it. File parallelism and worker concurrency are disabled so
    // fixture reset cannot race in-flight  transaction.
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    sequence: { concurrent: false },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
